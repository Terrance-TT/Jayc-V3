import { createOpenAI } from '@ai-sdk/openai';
import { REASONING_EFFORT } from './constants';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Wraps fetch to inject Moonshot's `reasoning_effort` parameter into every
 * request body. The pinned @ai-sdk/openai version (0.0.44) predates native
 * reasoningEffort support, so passing it through fetch is the reliable way.
 * Anything that isn't a JSON request body is passed through untouched.
 */
const withReasoningEffort =
  (baseFetch: FetchLike): FetchLike =>
  async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);

        body.reasoning_effort = REASONING_EFFORT;

        init = { ...init, body: JSON.stringify(body) };
      } catch {
        // not a JSON body — leave the request untouched
      }
    }

    return baseFetch(input, init);
  };

export function getMoonshotModel(apiKey: string, env: Env) {
  const moonshot = createOpenAI({
    apiKey,
    baseURL: env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1',
    fetch: withReasoningEffort(fetch),
  });

  return moonshot(env.MOONSHOT_MODEL || 'kimi-k3');
}
