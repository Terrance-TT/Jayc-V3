import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { getAuth } from '@clerk/remix/ssr.server';
import {
  DEFAULT_THINKING_MODE,
  isComplexBuildRequest,
  looksLikeBuildRequest,
  resolveGeneration,
  runGeneration,
  SwitchableStream,
  withHeartbeat,
  type ByokConfig,
  type Messages,
} from '~/lib/.server/llm';
import { searchFacts, queryFromMessage } from '~/lib/.server/fact-check/search';
import { createScopedLogger } from '~/utils/logger';
import { countThinkLongerChoices, isClarifyingQuestions, parseControlTag, type ThinkingMode } from '~/utils/thinking';

const logger = createScopedLogger('ChatAction');

const MAX_MESSAGES = 200;
const MAX_MESSAGES_TOTAL_LENGTH = 800_000;
const MAX_PROJECT_GRAPH_LENGTH = 20_000;

const VALID_MODES = new Set<ThinkingMode>(['auto', 'turbo', 'power']);

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

  const body = await request.json<{ messages: Messages; projectGraph?: unknown; mode?: unknown; byok?: unknown }>();
  const { messages } = body;

  // whitelist-validate the requested thinking mode; anything else uses the default
  const mode: ThinkingMode = VALID_MODES.has(body.mode as ThinkingMode)
    ? (body.mode as ThinkingMode)
    : DEFAULT_THINKING_MODE;

  // bring-your-own-key: validated per request, used in-memory only
  const byok = parseByok(body.byok);

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

  /**
   * Thinking-choice control replies (think_longer / build_now) bypass the
   * normal generation resolution entirely — the pipeline routes them.
   */
  const lastMessage = messages[messages.length - 1];
  const control = lastMessage?.role === 'user' ? parseControlTag(lastMessage.content) : null;

  // prior extensions only — the current click does not count toward its own cap
  const extensionsUsed = control === 'think_longer' ? countThinkLongerChoices(messages.slice(0, -1)) : 0;

  /**
   * The pipeline runs only when the turn deserves it: a COMPLEX build-like
   * first message, or the answer to a previous set of clarifying questions.
   * Simple/medium builds get the single deep golden pass; questions and
   * chat get a fast single pass. Power mode pipelines regardless.
   */
  const firstMessage = messages[0];
  const isBuildLikeFirstMessage =
    messages.length === 1 && firstMessage?.role === 'user' && looksLikeBuildRequest(firstMessage.content);
  const isComplexFirstBuild = isBuildLikeFirstMessage && isComplexBuildRequest(firstMessage.content);
  const pipelineWorthy = isComplexFirstBuild || hasPendingQuestions(messages);
  const generation = resolveGeneration(mode, pipelineWorthy);

  /**
   * Control replies (think_longer / build_now) only exist after a thinking
   * clock fired mid-pipeline — the build they trigger IS the first build,
   * so post-build phases (review, verify) must run for them too.
   */
  const isFirstBuild = pipelineWorthy || control !== null;

  const stream = new SwitchableStream();

  /**
   * Fire-and-forget: the pipeline drives the stream (thinking phases, build
   * pass, continuations) while the response returns immediately. The
   * heartbeat wrapper keeps the connection warm through every silent gap.
   */
  runGeneration({
    messages,
    env,
    stream,
    generation,
    projectGraph,
    webSearch,
    byok,
    control: control ?? undefined,
    extensionsUsed,
    isFirstBuild,
    skipReview: mode === 'turbo',
  }).catch((error) => {
    logger.error('Generation pipeline crashed', error);
    stream.error(error);
  });

  return new Response(withHeartbeat(stream.readable), {
    status: 200,
    headers: {
      /**
       * SSE content type (instead of text/plain): the body is a
       * newline-delimited event stream, and marking it as such stops
       * intermediate proxies/ISPs from buffering or killing it as an
       * idle download. The AI SDK client parses the body generically,
       * so this changes nothing client-side.
       */
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
    },
  });
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
  const query = queryFromMessage(messages[0].content);

  if (query.length === 0) {
    return undefined;
  }

  return (await searchFacts(query, apiKey)) ?? undefined;
}

/**
 * True when the latest assistant message is an unanswered set of
 * clarifying questions — the user's reply should be treated as
 * pipeline-worthy even though it is not the first message.
 */
function hasPendingQuestions(messages: Messages): boolean {
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');

  return lastAssistant ? isClarifyingQuestions(lastAssistant.content) : false;
}

/**
 * Validates the client's bring-your-own-key config. The key travels from
 * the client's localStorage with each request and is used in memory only —
 * never logged, never persisted server-side. The base URL is pinned
 * server-side (see model.ts) so this cannot be turned into an SSRF relay.
 */
function parseByok(raw: unknown): ByokConfig | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }

  const { apiKey, model } = raw as Record<string, unknown>;

  if (typeof apiKey !== 'string' || typeof model !== 'string') {
    return undefined;
  }

  const trimmedKey = apiKey.trim();
  const trimmedModel = model.trim();

  if (trimmedKey.length < 8 || trimmedKey.length > 256 || trimmedModel.length === 0 || trimmedModel.length > 128) {
    return undefined;
  }

  return { apiKey: trimmedKey, model: trimmedModel };
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
