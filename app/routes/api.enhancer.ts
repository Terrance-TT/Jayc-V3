import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { getAuth } from '@clerk/remix/ssr.server';
import { StreamingTextResponse, parseStreamPart } from 'ai';
import { streamText } from '~/lib/.server/llm/stream-text';
import { stripIndents } from '~/utils/stripIndent';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const MAX_MESSAGE_LENGTH = 10_000;

export async function action(args: ActionFunctionArgs) {
  return enhancerAction(args);
}

async function enhancerAction(args: ActionFunctionArgs) {
  const { context, request } = args;

  const userId = await resolveUserId(args);

  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { message } = await request.json<{ message: string }>();

  if (typeof message !== 'string' || message.length === 0) {
    return new Response('Bad Request', { status: 400 });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return new Response('Payload Too Large', { status: 413 });
  }

  try {
    const result = await streamText(
      [
        {
          role: 'user',
          content: stripIndents`
          I want you to improve the user prompt that is wrapped in \`<original_prompt>\` tags.

          IMPORTANT: Only respond with the improved prompt and nothing else!

          <original_prompt>
            ${message}
          </original_prompt>
        `,
        },
      ],
      context.cloudflare.env,
    );

    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const processedChunk = decoder
          .decode(chunk)
          .split('\n')
          .filter((line) => line !== '')
          .map(parseStreamPart)
          .map((part) => part.value)
          .join('');

        controller.enqueue(encoder.encode(processedChunk));
      },
    });

    const transformedStream = result.toAIStream().pipeThrough(transformStream);

    return new StreamingTextResponse(transformedStream);
  } catch (error) {
    console.log(error);

    throw new Response(null, {
      status: 500,
      statusText: 'Internal Server Error',
    });
  }
}

/**
 * Mirrors the auth gate used by api.chats.ts: resolves the authenticated
 * Clerk user with the secret key from the Cloudflare env. Returns null when
 * auth is not configured or the visitor is signed out.
 */
async function resolveUserId(args: ActionFunctionArgs): Promise<string | null> {
  const env = args.context.cloudflare.env;

  const publishableKey = env.CLERK_PUBLISHABLE_KEY;
  const secretKey = env.CLERK_SECRET_KEY;

  if (!publishableKey || !secretKey) {
    return null;
  }

  const { userId } = await getAuth(args, { secretKey });

  return userId;
}
