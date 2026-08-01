import { streamText as _streamText, convertToCoreMessages } from 'ai';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import { getMoonshotModel, type ByokConfig } from '~/lib/.server/llm/model';
import { getTriggeredAddons } from '~/lib/.server/llm/addons';
import { WORK_DIR } from '~/utils/constants';
import { describeControlTags, hasThinking, stripThinking } from '~/utils/thinking';
import { LIGHT_EFFORT, LIGHT_MAX_TOKENS, type ReasoningEffort } from './constants';
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

/**
 * Output cap for bring-your-own-key calls: free-tier models have smaller
 * limits than K3, so passes are clamped to this and continuations handle
 * the rest.
 */
const BYOK_MAX_TOKENS = 32_768;

export interface StreamTextOptions {
  /** forwarded verbatim to the AI SDK (onFinish, maxTokens, abortSignal, …) */
  requestOptions?: StreamingOptions;

  /** serialized graphify snapshot — injected into the system prompt */
  projectGraph?: string;

  /** web-search digest for the current request — injected into the system prompt */
  webSearch?: string;

  /** reasoning effort for this call; defaults to the light single-pass effort */
  effort?: ReasoningEffort;

  /** appended after the system prompt (pipeline phase instructions) */
  systemSuffix?: string;

  /**
   * When true, the model's reasoning stream is rewritten into visible
   * <jayc-thinking> text (see reasoning-stream.ts). Off for callers whose
   * output must stay clean (e.g. the prompt enhancer).
   */
  includeThinking?: boolean;

  /** bring-your-own-key config (OpenRouter); replaces the default Moonshot backend */
  byok?: ByokConfig;
}

export function streamText(messages: Messages, env: Env, options?: StreamTextOptions) {
  const { requestOptions, projectGraph, webSearch, effort, systemSuffix, includeThinking, byok } = options ?? {};

  const requestedMaxTokens = requestOptions?.maxTokens ?? LIGHT_MAX_TOKENS;
  const maxTokens = byok ? Math.min(requestedMaxTokens, BYOK_MAX_TOKENS) : requestedMaxTokens;

  // conditional addons ride only when the request actually involves them
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  const addons = getTriggeredAddons({ userMessage: lastUserMessage, projectGraph });

  return _streamText({
    model: getMoonshotModel(getAPIKey(env), env, effort ?? LIGHT_EFFORT, includeThinking ?? false, byok),
    system: getSystemPrompt(WORK_DIR, projectGraph, webSearch) + addons + (systemSuffix ?? ''),
    temperature: 1, // K3 requires temperature=1

    /**
     * Strip reasoning scratch and superseded file contents from older
     * assistant messages before they go to the model: thinking spans are
     * display-only (app/utils/thinking.ts), and pruning keeps long sessions
     * small and free of stale-code confusion (see prune-context.ts).
     * Displayed/persisted history is unaffected.
     */
    messages: convertToCoreMessages(pruneMessages(sanitizeMessagesForModel(messages))),
    ...requestOptions,

    // after the spread so the BYOK clamp always wins
    maxTokens,
  });
}

/**
 * Message hygiene before anything goes to the model: removes
 * <jayc-thinking> reasoning scratch from assistant messages and translates
 * thinking-choice control tags in user messages into plain language.
 */
function sanitizeMessagesForModel(messages: Messages): Messages {
  return messages.map((message) => {
    if (message.role === 'assistant' && hasThinking(message.content)) {
      return { ...message, content: stripThinking(message.content) };
    }

    if (message.role === 'user' && message.content.includes('<jayc_control>')) {
      return { ...message, content: describeControlTags(message.content) };
    }

    return message;
  });
}
