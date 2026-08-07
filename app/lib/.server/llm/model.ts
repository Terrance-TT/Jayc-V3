import { createOpenAI } from '@ai-sdk/openai';
import { LIGHT_EFFORT, type ReasoningEffort } from './constants';
import { rewriteReasoningResponse } from './reasoning-stream';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** pinned server-side — clients can never steer the backend to another host */
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * The default model: a reasoning model in the Kimi family so the streamed
 * thinking display (reasoning-stream.ts) keeps working, at roughly a sixth
 * of K3's output price. Override with OPENROUTER_MODEL — a config change,
 * not a code change.
 */
const DEFAULT_MODEL = 'moonshotai/kimi-k2-thinking';

/**
 * Bring-your-own-key config: the user's own OpenRouter key and model,
 * validated in api.chat.ts and used in memory for a single request.
 */
export interface ByokConfig {
  apiKey: string;
  model: string;
}

/** Retryable conditions: rate limits, server errors, and network failures. */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 3_000];

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after');

  if (!header) {
    return undefined;
  }

  const seconds = Number(header);

  return Number.isFinite(seconds) ? Math.min(seconds * 1_000, 30_000) : undefined;
}

function jitter(ms: number): number {
  return ms + Math.floor(Math.random() * 500);
}

/**
 * Wraps fetch with retry-on-transient-failure: 429s and 5xx are routine on
 * shared gateways (and near-guaranteed on free-tier keys), and without this
 * wrapper a single transient response killed a whole generation pass.
 * Streaming responses are never retried once they've started — only the
 * initial request, where a retry is always safe.
 */
export function withRetry(baseFetch: FetchLike): FetchLike {
  return async (input, init) => {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const wait = jitter(BACKOFF_MS[attempt - 1] ?? 3_000);

        await new Promise((resolve) => setTimeout(resolve, wait));
      }

      let response: Response;

      try {
        response = await baseFetch(input, init);
      } catch (error) {
        // network-level failure — retry if attempts remain
        lastError = error;
        continue;
      }

      if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_ATTEMPTS - 1) {
        return response;
      }

      const retryAfter = retryAfterMs(response);

      if (retryAfter !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, retryAfter));
      }

      // drain and discard so the connection can be reused, then loop
      await response.body?.cancel().catch(() => undefined);
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };
}

/** Our efforts go up to 'max'; OpenRouter's reasoning parameter tops out at 'high'. */
function mapEffort(effort: ReasoningEffort): string {
  return effort === 'max' ? 'high' : effort;
}

/**
 * Wraps fetch with three compatibility behaviors:
 *
 * 1. Injects reasoning configuration into chat completion requests, using
 *    OpenRouter's normalized `reasoning` parameter — only for Kimi-family
 *    models (other families would reject or misread it, and non-reasoning
 *    models have nothing to configure).
 * 2. Injects OpenRouter resilience routing (default backend only, never
 *    BYOK): `provider.allow_fallbacks` routes around a degraded upstream,
 *    and OPENROUTER_FALLBACK_MODELS provides model-level fallback.
 * 3. When `includeThinking` is set, rewrites the streaming response so
 *    `reasoning_content` deltas become visible text (see
 *    reasoning-stream.ts). Off for callers like the prompt enhancer whose
 *    output must stay clean.
 *
 * Defensive by design: parameters are ONLY injected into JSON bodies that
 * contain a `messages` array (i.e. actual chat completions), and the
 * response rewrite only touches SSE streams. Anything else passes through
 * untouched, and any parsing error falls back to the original.
 */
const withGatewayCompat = ({
  effort,
  includeThinking,
  isKimi,
  fallbackModels,
}: {
  effort: ReasoningEffort;
  includeThinking: boolean;
  isKimi: boolean;
  fallbackModels?: string[];
}): FetchLike =>
  withRetry(async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);

        if (Array.isArray(body.messages)) {
          if (isKimi) {
            body.reasoning = { effort: mapEffort(effort) };
          }

          if (fallbackModels && fallbackModels.length > 0) {
            body.models = [body.model, ...fallbackModels];
            body.provider = { ...(body.provider ?? {}), allow_fallbacks: true };
          }

          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {
        // not a JSON body — leave the request untouched
      }
    }

    const response = await fetch(input, init);

    return includeThinking ? rewriteReasoningResponse(response) : response;
  });

function parseFallbackModels(env: Env): string[] | undefined {
  const raw = env.OPENROUTER_FALLBACK_MODELS;

  if (!raw) {
    return undefined;
  }

  const models = raw
    .split(',')
    .map((model) => model.trim())
    .filter((model) => model.length > 0);

  return models.length > 0 ? models : undefined;
}

/** The model id a request will actually use — BYOK wins, then env, then the default. */
export function resolveModelId(env: Env, byok?: ByokConfig): string {
  return byok?.model ?? env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
}

export function getChatModel(
  apiKey: string,
  env: Env,
  effort: ReasoningEffort = LIGHT_EFFORT,
  includeThinking = false,
  byok?: ByokConfig,
) {
  /**
   * BYOK: the user's own OpenRouter key + model, in memory for one request.
   * No fallback routing or model lists — their key, their choice, exactly as
   * entered.
   */
  if (byok) {
    const openrouter = createOpenAI({
      apiKey: byok.apiKey,
      baseURL: OPENROUTER_BASE_URL,
      fetch: withGatewayCompat({ effort, includeThinking, isKimi: /kimi/i.test(byok.model) }),
    });

    return openrouter(byok.model);
  }

  const model = env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const openrouter = createOpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    fetch: withGatewayCompat({
      effort,
      includeThinking,
      isKimi: /kimi/i.test(model),
      fallbackModels: parseFallbackModels(env),
    }),
  });

  return openrouter(model);
}
