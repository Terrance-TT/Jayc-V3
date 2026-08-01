import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuth } from '@clerk/remix/ssr.server';
import { generateText } from 'ai';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import { getMoonshotModel } from '~/lib/.server/llm/model';
import { getSystemPrompt } from '~/lib/.server/llm/prompts';
import { streamText } from '~/lib/.server/llm/stream-text';
import { searchFacts } from '~/lib/.server/fact-check/search';
import { WORK_DIR } from '~/utils/constants';

/**
 * TEMPORARY diagnostic route (delete after the streaming failure is fixed).
 *
 * Visit while signed in:
 *   /api/debug-llm                                — non-streaming Moonshot call with the failing sailing prompt
 *   /api/debug-llm?mode=stream                    — same call through the real streaming path
 *   /api/debug-llm?mode=search                    — probe TAVILY_API_KEY end-to-end.
 *   /api/debug-llm?msg=...                        — custom prompt (max 2000 chars)
 *   /api/debug-llm?effort=high&maxTokens=131072   — reproduce Power mode exactly.
 *
 * Parameters:
 *   effort    low | high | max (default: high — the failing configuration)
 *   maxTokens 1..200000 (default: 512 to keep casual checks cheap)
 *
 * Interpretation:
 *   - sync fails  -> Moonshot rejects the request itself (error body included)
 *   - sync ok, stream fails -> the streaming relay / Cloudflare limits are at fault
 *   - search fails -> the verdict says exactly which side is broken (missing key vs Tavily)
 */
const DEFAULT_MESSAGE =
  'create a sailing app to educate a beginner on wind direction and how much their sail should be pulled in/pushed out';

const MAX_MESSAGE_LENGTH = 2_000;
const DEBUG_MAX_TOKENS = 512;
const DEBUG_MAX_TOKENS_CEILING = 200_000;

const VALID_EFFORTS = new Set(['low', 'high', 'max'] as const);
type Effort = 'low' | 'high' | 'max';

export async function loader(args: LoaderFunctionArgs) {
  const userId = await resolveUserId(args);

  if (!userId) {
    return new Response('Unauthorized — sign in to Jayc first, then revisit this URL.', { status: 401 });
  }

  const env = args.context.cloudflare.env;
  const url = new URL(args.request.url);
  const message = (url.searchParams.get('msg') ?? DEFAULT_MESSAGE).slice(0, MAX_MESSAGE_LENGTH);
  const mode = url.searchParams.get('mode') ?? 'sync';

  // effort defaults to 'high' so a bare visit reproduces the Power-mode failure
  const effortParam = url.searchParams.get('effort');
  const effort: Effort = VALID_EFFORTS.has(effortParam as Effort) ? (effortParam as Effort) : 'high';

  const maxTokensParam = Number(url.searchParams.get('maxTokens'));
  const maxTokens =
    Number.isInteger(maxTokensParam) && maxTokensParam > 0
      ? Math.min(maxTokensParam, DEBUG_MAX_TOKENS_CEILING)
      : DEBUG_MAX_TOKENS;

  if (mode === 'stream') {
    return json(await runStreamTest(message, env, effort, maxTokens));
  }

  if (mode === 'search') {
    return json(await runSearchTest(env));
  }

  return json(await runSyncTest(message, env, effort, maxTokens));
}

/**
 * Probes the web-search path end-to-end: is TAVILY_API_KEY reaching the
 * server, and does Tavily accept it? Distinguishes "key missing" from
 * "key present but rejected" so misconfiguration is a one-click diagnosis.
 */
async function runSearchTest(env: Env) {
  const apiKey = env.TAVILY_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      mode: 'search',
      verdict:
        'TAVILY_API_KEY is NOT reaching the server. Add it in Cloudflare Pages → Settings → Environment variables (Production), then redeploy. Until then every search feature stays silently off.',
    };
  }

  const facts = await searchFacts('sail trim wind direction no-go zone', apiKey);

  if (!facts) {
    return {
      ok: false,
      mode: 'search',
      verdict:
        'The key reaches the server but Tavily returned nothing — the key is wrong, expired, or the account has an issue. Check the Tavily dashboard.',
    };
  }

  return {
    ok: true,
    mode: 'search',
    verdict:
      'Search works end-to-end: the key reaches the server and Tavily answered. Auto-enrichment and the verify phase are live on first builds.',
    factsPreview: facts.slice(0, 300),
  };
}

async function runSyncTest(message: string, env: Env, effort: Effort, maxTokens: number) {
  const startedAt = Date.now();

  try {
    const result = await generateText({
      model: getMoonshotModel(getAPIKey(env), env, effort),
      system: getSystemPrompt(WORK_DIR),
      maxTokens,
      temperature: 1, // K3 requires temperature=1
      messages: [{ role: 'user', content: message }],
    });

    return {
      ok: true,
      mode: 'sync',
      effort,
      maxTokens,
      elapsedMs: Date.now() - startedAt,
      verdict:
        'Moonshot accepted a NON-streaming request with these exact settings. If Power mode still fails on the site, the problem is in the streaming path (Cloudflare stream relay or idle kill), not the request parameters.',
      finishReason: result.finishReason,
      replyPreview: result.text.slice(0, 300),
      usage: result.usage,
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'sync',
      effort,
      maxTokens,
      elapsedMs: Date.now() - startedAt,
      verdict: 'Moonshot itself rejected the request. The error below is the exact reason.',
      error: describeError(error),
    };
  }
}

async function runStreamTest(message: string, env: Env, effort: Effort, maxTokens: number) {
  const startedAt = Date.now();

  try {
    const result = await streamText([{ role: 'user', content: message }], env, {
      requestOptions: {
        toolChoice: 'none',
        maxTokens,
      },

      // mirror production: the requested effort with the same token budget
      effort,
      includeThinking: true,
    });

    let chunks = 0;
    let chars = 0;
    let firstChunkMs: number | null = null;

    for await (const part of result.textStream) {
      if (firstChunkMs === null) {
        firstChunkMs = Date.now() - startedAt;
      }

      chunks += 1;
      chars += part.length;
    }

    return {
      ok: true,
      mode: 'stream',
      effort,
      maxTokens,
      elapsedMs: Date.now() - startedAt,
      firstChunkMs,
      verdict:
        'Streaming worked end-to-end for these settings — Moonshot streamed without dying. If the site still 502s, the failure is between our response and your browser (edge buffering/timeouts), not upstream.',
      chunks,
      chars,
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'stream',
      effort,
      maxTokens,
      elapsedMs: Date.now() - startedAt,
      verdict:
        'The STREAMING path failed server-side — this reproduces the site bug. The error below is the exact reason (responseBody is Moonshot’s own message when present).',
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
