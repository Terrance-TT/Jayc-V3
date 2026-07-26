import { streamText as _streamText, convertToCoreMessages } from 'ai';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import { getMoonshotModel } from '~/lib/.server/llm/model';
import { buildAdvisoryBlock } from '~/lib/integrations/advisory';
import { detectCapabilities } from '~/lib/integrations/detect';
import { WORK_DIR } from '~/utils/constants';
import { MAX_TOKENS } from './constants';
import { pruneMessages } from './prune-context';
import { getSystemPrompt } from './prompts';

interface ToolResult<Name extends string, Args, Result> {
  toolCallId: string;
  toolName: Name;
  args: Args;
  result: Result;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolInvocations?: ToolResult<string, unknown, unknown>[];
}

export type Messages = Message[];

export type StreamingOptions = Omit<Parameters<typeof _streamText>[0], 'model'>;

export function streamText(
  messages: Messages,
  env: Env,
  options?: StreamingOptions,
  projectGraph?: string,
  effort?: string,

  /**
   * Integration advisory layer gate: only the main chat flow (api.chat.ts)
   * passes `true`. The prompt enhancer (api.enhancer.ts) shares this function
   * and must NOT receive advisory injection, so it defaults to off.
   */
  enableAdvisory = false,
) {
  /**
   * Deterministic service-suggestion detection (no LLM call): match the
   * latest user message against the integration catalog, deduped against
   * categories already suggested earlier in the session, and render the
   * result as an <integration_advisory> section in the system prompt.
   * Returns '' when nothing matched, leaving the base prompt untouched.
   */
  const advisory = enableAdvisory
    ? buildAdvisoryBlock(detectCapabilities(latestUserText(messages), priorAssistantText(messages)))
    : '';

  return _streamText({
    model: getMoonshotModel(getAPIKey(env), env, effort),
    system: getSystemPrompt(WORK_DIR, projectGraph, advisory),
    maxTokens: MAX_TOKENS,
    temperature: 1, // Kimi K3 requires temperature=1

    // strip superseded file contents from older assistant messages so long
    // sessions stay small, fast, and free of stale-code confusion (see
    // prune-context.ts). Displayed/persisted history is unaffected.
    messages: convertToCoreMessages(pruneMessages(messages)),
    ...options,
  });
}

/** Content of the most recent user message — the only text detection runs on. */
function latestUserText(messages: Messages): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i].content;
    }
  }

  return '';
}

/** All prior assistant output, used for session-level suggestion dedupe. */
function priorAssistantText(messages: Messages): string {
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content)
    .join('\n');
}
