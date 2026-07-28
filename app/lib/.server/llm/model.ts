import { createOpenAI } from '@ai-sdk/openai';
import { REASONING_EFFORT } from './constants';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Wraps fetch to inject Moonshot's `reasoning_effort` parameter into chat
 * completion requests. The pinned @ai-sdk/openai version (0.0.44) predates
 * native reasoningEffort support, so passing it through fetch is the only
 * reliable way.
 *
 * Defensive by design: the parameter is ONLY injected into JSON request
 * bodies that contain a `messages` array (i.e. actual chat completions).
 * Anything else — GETs, non-JSON bodies, unexpected shapes — is passed
 * through completely untouched, and any parsing error falls back to the
 * original request.
 */
const withReasoningEffort =
  (baseFetch: FetchLike): FetchLike =>
  async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);

        if (Array.isArray(body.messages)) {
          body.reasoning_effort = REASONING_EFFORT;

          init = { ...init, body: JSON.stringify(body) };
        }
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
