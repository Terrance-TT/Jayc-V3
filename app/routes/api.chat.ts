import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { getAuth } from '@clerk/remix/ssr.server';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/.server/llm/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';

const MAX_MESSAGES = 100;
const MAX_MESSAGES_TOTAL_LENGTH = 200_000;

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

async function chatAction(args: ActionFunctionArgs) {
  const { context, request } = args;

  const userId = await resolveUserId(args);

  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { messages, projectGraph } = await request.json<{ messages: Messages; projectGraph?: string }>();

  if (!Array.isArray(messages)) {
    return new Response('Bad Request', { status: 400 });
  }

  if (
    messages.length > MAX_MESSAGES ||
    JSON.stringify(messages).length + (projectGraph?.length ?? 0) > MAX_MESSAGES_TOTAL_LENGTH
  ) {
    return new Response('Payload Too Large', { status: 413 });
  }

  const stream = new SwitchableStream();

  try {
    const options: StreamingOptions = {
      toolChoice: 'none',
      onFinish: async ({ text: content, finishReason }) => {
        if (finishReason !== 'length') {
          return stream.close();
        }

        if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
          throw Error('Cannot continue message: Maximum segments reached');
        }

        const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

        console.log(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

        messages.push({ role: 'assistant', content });
        messages.push({ role: 'user', content: CONTINUE_PROMPT });

        const result = await streamText(messages, context.cloudflare.env, options, projectGraph);

        return stream.switchSource(result.toAIStream());
      },
    };

    const result = await streamText(messages, context.cloudflare.env, options, projectGraph);

    stream.switchSource(result.toAIStream());

    return new Response(stream.readable, {
      status: 200,
      headers: {
        contentType: 'text/plain; charset=utf-8',
      },
    });
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
