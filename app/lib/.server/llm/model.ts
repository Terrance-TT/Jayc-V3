import { createOpenAI } from '@ai-sdk/openai';
import { LIGHT_EFFORT, type ReasoningEffort } from './constants';
import { rewriteReasoningResponse } from './reasoning-stream';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Bring-your-own-key config: the user's own OpenRouter key and model,
 * validated in api.chat.ts and used in memory for a single request. The
 * base URL is pinned here — clients can never steer it.
 */
export interface ByokConfig {
  apiKey: string;
  model: string;
}

/**
 * Wraps fetch with two compatibility behaviors:
 *
 * 1. Injects Moonshot's `reasoning_effort` parameter into chat completion
 *    requests (only when `injectEffort` is set — off for BYOK providers
 *    whose models would reject the unknown parameter). The pinned version
 *    of @ai-sdk/openai (0.0.44) predates native reasoningEffort support,
 *    so passing it through fetch is the only reliable way.
 * 2. When `includeThinking` is set, rewrites the streaming response so
 *    `reasoning_content` deltas become visible text (see
 *    reasoning-stream.ts). Off for callers like the prompt enhancer whose
 *    output must stay clean.
 *
 * Defensive by design: the request parameter is ONLY injected into JSON
 * bodies that contain a `messages` array (i.e. actual chat completions), and
 * the response rewrite only touches SSE streams. Anything else passes
 * through untouched, and any parsing error falls back to the original.
 */
const withKimiCompat =
  (baseFetch: FetchLike, effort: ReasoningEffort, includeThinking: boolean, injectEffort: boolean): FetchLike =>
  async (input, init) => {
    if (injectEffort && init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);

        if (Array.isArray(body.messages)) {
          body.reasoning_effort = effort;

          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {
        // not a JSON body — leave the request untouched
      }
    }

    const response = await baseFetch(input, init);

    return includeThinking ? rewriteReasoningResponse(response) : response;
  };

export function getMoonshotModel(
  apiKey: string,
  env: Env,
  effort: ReasoningEffort = LIGHT_EFFORT,
  includeThinking = false,
  byok?: ByokConfig,
) {
  /**
   * BYOK: the user's own OpenRouter key + model. reasoning_effort is only
   * injected for Kimi-family models; other providers can reject unknown
   * parameters.
   */
  if (byok) {
    const openrouter = createOpenAI({
      apiKey: byok.apiKey,

      // pinned server-side — the client can never steer this to another host
      baseURL: 'https://openrouter.ai/api/v1',
      fetch: withKimiCompat(fetch, effort, includeThinking, /kimi/i.test(byok.model)),
    });

    return openrouter(byok.model);
  }

  const moonshot = createOpenAI({
    apiKey,
    baseURL: env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1',
    fetch: withKimiCompat(fetch, effort, includeThinking, true),
  });

  return moonshot(env.MOONSHOT_MODEL || 'kimi-k3');
}
