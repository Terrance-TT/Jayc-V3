import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuth } from '@clerk/remix/ssr.server';
import { generateText } from 'ai';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import { getMoonshotModel } from '~/lib/.server/llm/model';
import { getSystemPrompt } from '~/lib/.server/llm/prompts';
import { streamText } from '~/lib/.server/llm/stream-text';
import { WORK_DIR } from '~/utils/constants';

/**
 * TEMPORARY diagnostic route (delete after the streaming failure is fixed).
 *
 * Visit while signed in:
 *   /api/debug-llm              — non-streaming Moonshot call with the failing sailing prompt
 *   /api/debug-llm?mode=stream  — same call through the real streaming path
 *   /api/debug-llm?msg=...      — custom prompt (max 2000 chars)
 *
 * Interpretation:
 *   - sync fails  -> Moonshot rejects the request itself (error body included)
 *   - sync ok, stream fails -> the streaming relay / Cloudflare limits are at fault
 */
const DEFAULT_MESSAGE =
  'create a sailing app to educate a beginner on wind direction and how much their sail should be pulled in/pushed out';

const MAX_MESSAGE_LENGTH = 2_000;
const DEBUG_MAX_TOKENS = 512;

export async function loader(args: LoaderFunctionArgs) {
  const userId = await resolveUserId(args);

  if (!userId) {
    return new Response('Unauthorized — sign in to Jayc first, then revisit this URL.', { status: 401 });
  }

  const env = args.context.cloudflare.env;
  const url = new URL(args.request.url);
  const message = (url.searchParams.get('msg') ?? DEFAULT_MESSAGE).slice(0, MAX_MESSAGE_LENGTH);
  const mode = url.searchParams.get('mode') ?? 'sync';

  if (mode === 'stream') {
    return json(await runStreamTest(message, env));
  }

  return json(await runSyncTest(message, env));
}

async function runSyncTest(message: string, env: Env) {
  try {
    const result = await generateText({
      model: getMoonshotModel(getAPIKey(env), env),
      system: getSystemPrompt(WORK_DIR),
      maxTokens: DEBUG_MAX_TOKENS,
      temperature: 1, // K3 requires temperature=1
      messages: [{ role: 'user', content: message }],
    });

    return {
      ok: true,
      mode: 'sync',
      verdict:
        'Moonshot accepted a NON-streaming request with the real system prompt. If the site still fails, the problem is in the streaming path (Cloudflare CPU limit or stream relay), not Moonshot.',
      finishReason: result.finishReason,
      replyPreview: result.text.slice(0, 300),
      usage: result.usage,
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'sync',
      verdict: 'Moonshot itself rejected the request. The error below is the exact reason.',
      error: describeError(error),
    };
  }
}

async function runStreamTest(message: string, env: Env) {
  try {
    const result = await streamText([{ role: 'user', content: message }], env, {
      requestOptions: {
        toolChoice: 'none',
        maxTokens: DEBUG_MAX_TOKENS,
      },
    });

    let chunks = 0;
    let chars = 0;

    for await (const part of result.textStream) {
      chunks += 1;
      chars += part.length;
    }

    return {
      ok: true,
      mode: 'stream',
      verdict:
        'Streaming worked end-to-end for this prompt — try the real site again; the failure may be intermittent.',
      chunks,
      chars,
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'stream',
      verdict:
        'The STREAMING path failed server-side — this reproduces the site bug. The error below is the exact reason.',
      error: describeError(error),
    };
  }
}

function describeError(error: unknown) {
  const anyError = (error ?? {}) as Record<string, unknown>;

  return {
    name: typeof anyError.name === 'string' ? anyError.name : typeof error,
    message: typeof anyError.message === 'string' ? anyError.message : String(error),
    status: (anyError.statusCode as number | undefined) ?? (anyError.status as number | undefined) ?? null,
    responseBody: typeof anyError.responseBody === 'string' ? anyError.responseBody.slice(0, 2000) : null,
    cause: anyError.cause ? String(anyError.cause).slice(0, 500) : null,
  };
}

function json(payload: unknown) {
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Same Clerk gate as api.chat.ts: resolve the authenticated user with the
 * secret key from the Cloudflare env; null when signed out or unconfigured.
 */
async function resolveUserId(args: LoaderFunctionArgs): Promise<string | null> {
  const env = args.context.cloudflare.env;

  const publishableKey = env.CLERK_PUBLISHABLE_KEY;
  const secretKey = env.CLERK_SECRET_KEY;

  if (!publishableKey || !secretKey) {
    return null;
  }

  const { userId } = await getAuth(args, { secretKey });

  return userId;
}
