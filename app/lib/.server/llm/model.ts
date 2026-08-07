import { createOpenAI } from '@ai-sdk/openai';
import { LIGHT_EFFORT, type ReasoningEffort } from './constants';
import { rewriteReasoningResponse } from './reasoning-stream';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** both pinned server-side — clients can never steer the backend to another host */
const MOONSHOT_BASE_URL = 'https://api.moonshot.ai/v1';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const DEFAULT_MODEL = 'kimi-k3';

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
 * shared gateways (and near-guaranteed on free-tier BYOK keys), and without
 * this wrapper a single transient response killed a whole generation pass.
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

/** OpenRouter's normalized reasoning parameter tops out at 'high'. */
function mapEffort(effort: ReasoningEffort): string {
  return effort === 'max' ? 'high' : effort;
}

// how reasoning effort reaches the model, per backend
type ReasoningInjection = 'moonshot' | 'openrouter';

/**
 * Wraps fetch with three compatibility behaviors:
 *
 * 1. Injects reasoning effort into chat completion requests, in the form
 *    each backend understands: the vendor `reasoning_effort` parameter for
 *    Moonshot-direct (K3), OpenRouter's normalized `reasoning` parameter
 *    for BYOK (ignored there by non-reasoning models). The pinned
 *    ai-sdk/openai (0.0.44) predates native reasoning support, so passing
 *    it through fetch is the only reliable way.
 * 2. For BYOK, sets OpenRouter's `provider.allow_fallbacks` so a degraded
 *    upstream provider is routed around instead of failing the request.
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
  reasoning,
  allowFallbacks = false,
}: {
  effort: ReasoningEffort;
  includeThinking: boolean;
  reasoning: ReasoningInjection;
  allowFallbacks?: boolean;
}): FetchLike =>
  withRetry(async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);

        if (Array.isArray(body.messages)) {
          if (reasoning === 'moonshot') {
            body.reasoning_effort = effort;
          } else if (reasoning === 'openrouter') {
            body.reasoning = { effort: mapEffort(effort) };
          }

          if (allowFallbacks) {
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

/** The model id a request will actually use — BYOK wins, then env, then the default. */
export function resolveModelId(env: Env, byok?: ByokConfig): string {
  return byok?.model ?? env.MOONSHOT_MODEL ?? DEFAULT_MODEL;
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
   * Their key, their choice — Jayc is never billed for it.
   *
   * Reasoning effort is sent in OpenRouter's normalized form for every BYOK
   * model: the gateway silently ignores it for non-reasoning models
   * (require_parameters defaults to false), so there is no family check to
   * maintain, and reasoning models the user picks (Kimi, DeepSeek R1, …)
   * get a sane effort out of the box.
   */
  if (byok) {
    const openrouter = createOpenAI({
      apiKey: byok.apiKey,
      baseURL: OPENROUTER_BASE_URL,
      fetch: withGatewayCompat({
        effort,
        includeThinking,
        reasoning: 'openrouter',
        allowFallbacks: true,
      }),
    });

    return openrouter(byok.model);
  }

  const moonshot = createOpenAI({
    apiKey,
    baseURL: env.MOONSHOT_BASE_URL || MOONSHOT_BASE_URL,
    fetch: withGatewayCompat({ effort, includeThinking, reasoning: 'moonshot' }),
  });

  return moonshot(env.MOONSHOT_MODEL || DEFAULT_MODEL);
}
