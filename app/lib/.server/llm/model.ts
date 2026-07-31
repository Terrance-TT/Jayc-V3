import { createOpenAI } from '@ai-sdk/openai';
import { DEFAULT_GENERATION_MODE, GENERATION_MODES, type GenerationModeSettings } from './constants';
import { rewriteReasoningResponse } from './reasoning-stream';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Wraps fetch with two Kimi-compatibility behaviors:
 *
 * 1. Injects Moonshot's `reasoning_effort` parameter into chat completion
 *    requests. The pinned @ai-sdk/openai version (0.0.44) predates native
 *    reasoningEffort support, so passing it through fetch is the only
 *    reliable way.
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
  (baseFetch: FetchLike, effort: GenerationModeSettings['reasoningEffort'], includeThinking: boolean): FetchLike =>
  async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
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
  effort: GenerationModeSettings['reasoningEffort'] = GENERATION_MODES[DEFAULT_GENERATION_MODE].reasoningEffort,
  includeThinking = false,
) {
  const moonshot = createOpenAI({
    apiKey,
    baseURL: env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1',
    fetch: withKimiCompat(fetch, effort, includeThinking),
  });

  return moonshot(env.MOONSHOT_MODEL || 'kimi-k3');
}
