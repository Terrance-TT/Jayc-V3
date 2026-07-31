import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { getAuth } from '@clerk/remix/ssr.server';
import {
  DEFAULT_GENERATION_MODE,
  GENERATION_MODES,
  MAX_RESPONSE_SEGMENTS,
  type GenerationMode,
} from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/.server/llm/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import { withHeartbeat } from '~/lib/.server/llm/heartbeat';
import { searchFacts } from '~/lib/.server/fact-check/search';

const MAX_MESSAGES = 200;
const MAX_MESSAGES_TOTAL_LENGTH = 800_000;
const MAX_PROJECT_GRAPH_LENGTH = 20_000;
const MAX_SEARCH_QUERY_LENGTH = 300;

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

async function chatAction(args: ActionFunctionArgs) {
  const { context, request } = args;

  const userId = await resolveUserId(args);

  if (!userId) {
    /**
     * JSON body (instead of bare text) so the client can explain why the
     * request failed and send the user to the sign-in page.
     */
    return new Response(
      JSON.stringify({
        error: 'auth_required',
        message: 'Please sign in to use the AI builder. Your chats are saved to your account.',
      }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    );
  }

  const body = await request.json<{ messages: Messages; projectGraph?: unknown; mode?: unknown }>();
  const { messages } = body;

  // whitelist-validate the requested generation mode; anything else uses the server default
  const mode: GenerationMode | undefined = body.mode === 'power' || body.mode === 'turbo' ? body.mode : undefined;

  /**
   * Server-side validation: a non-string or oversized graph snapshot is
   * ignored instead of being trusted blindly.
   */
  const projectGraph =
    typeof body.projectGraph === 'string' && body.projectGraph.length <= MAX_PROJECT_GRAPH_LENGTH
      ? body.projectGraph
      : undefined;

  if (!Array.isArray(messages)) {
    return new Response('Bad Request', { status: 400 });
  }

  if (
    messages.length > MAX_MESSAGES ||
    JSON.stringify(messages).length + (projectGraph?.length ?? 0) > MAX_MESSAGES_TOTAL_LENGTH
  ) {
    return new Response('Payload Too Large', { status: 413 });
  }

  const env = context.cloudflare.env;

  // live web-search enrichment for new projects (dormant without TAVILY_API_KEY)
  const webSearch = await maybeSearchWeb(messages, env);

  const { maxTokens } = GENERATION_MODES[mode ?? DEFAULT_GENERATION_MODE];

  const stream = new SwitchableStream();

  try {
    // guards the empty-response retry so it fires at most once per request
    let emptyRetryUsed = false;

    const options: StreamingOptions = {
      toolChoice: 'none',
      onFinish: async ({ text: content, finishReason }) => {
        const isEmpty = content.trim().length === 0;

        if (finishReason !== 'length' && !isEmpty) {
          return stream.close();
        }

        if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
          if (isEmpty) {
            // out of segments — close rather than hang on an empty answer
            return stream.close();
          }

          throw Error('Cannot continue message: Maximum segments reached');
        }

        if (isEmpty) {
          /**
           * The model produced no visible output (can happen with long
           * reasoning at higher effort, including a 'length' finish with
           * empty text). Retry once at turbo settings so the user never
           * gets a silently empty answer.
           */
          if (emptyRetryUsed) {
            return stream.close();
          }

          emptyRetryUsed = true;

          console.log('Model returned an empty response: retrying once at turbo settings');

          if (content.length > 0) {
            // preserve whitespace-only output so message ordering stays intact
            messages.push({ role: 'assistant', content });
          }

          messages.push({ role: 'user', content: CONTINUE_PROMPT });

          const retry = await streamText(messages, env, {
            requestOptions: options,
            projectGraph,
            mode: 'turbo',
          });

          return stream.switchSource(retry.toAIStream());
        }

        const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

        console.log(`Reached max token limit (${maxTokens}): Continuing message (${switchesLeft} switches left)`);

        messages.push({ role: 'assistant', content });
        messages.push({ role: 'user', content: CONTINUE_PROMPT });

        const result = await streamText(messages, env, { requestOptions: options, projectGraph, webSearch, mode });

        return stream.switchSource(result.toAIStream());
      },
    };

    const result = await streamText(messages, env, { requestOptions: options, projectGraph, webSearch, mode });

    stream.switchSource(result.toAIStream());

    /**
     * Heartbeats keep the response alive while the model thinks in silence
     * (Power mode's deep reasoning can go minutes without a token; an idle
     * stream gets killed and surfaces as a 502).
     */
    return new Response(withHeartbeat(stream.readable), {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
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
 * Web-search enrichment (dormant unless TAVILY_API_KEY is configured): on the
 * FIRST message of a chat, fetch live reference material about the request so
 * the model builds on current facts (library versions, API details, niche
 * domains) instead of training data alone. Best-effort — a missing key,
 * failed request, or empty result never blocks or fails the chat.
 */
async function maybeSearchWeb(messages: Messages, env: Env): Promise<string | undefined> {
  const apiKey = env.TAVILY_API_KEY;

  if (!apiKey) {
    return undefined;
  }

  // only enrich the opening message of a new chat; later turns have context
  if (messages.length !== 1 || messages[0]?.role !== 'user') {
    return undefined;
  }

  // strip any diff/markup tags from the request to form the search query
  const query = messages[0].content
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SEARCH_QUERY_LENGTH);

  if (query.length === 0) {
    return undefined;
  }

  return (await searchFacts(query, apiKey)) ?? undefined;
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
