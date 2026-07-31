import { streamText as _streamText, convertToCoreMessages } from 'ai';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import { getMoonshotModel } from '~/lib/.server/llm/model';
import { WORK_DIR } from '~/utils/constants';
import { DEFAULT_GENERATION_MODE, GENERATION_MODES, type GenerationMode } from './constants';
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

export interface StreamTextOptions {
  /** forwarded verbatim to the AI SDK (onFinish callbacks, maxTokens overrides, …) */
  requestOptions?: StreamingOptions;

  /** serialized graphify snapshot — injected into the system prompt */
  projectGraph?: string;

  /** web-search digest for the current request — injected into the system prompt */
  webSearch?: string;

  /** generation mode; falls back to DEFAULT_GENERATION_MODE */
  mode?: GenerationMode;
}

export function streamText(messages: Messages, env: Env, options?: StreamTextOptions) {
  const { requestOptions, projectGraph, webSearch, mode } = options ?? {};
  const { reasoningEffort, maxTokens } = GENERATION_MODES[mode ?? DEFAULT_GENERATION_MODE];

  return _streamText({
    model: getMoonshotModel(getAPIKey(env), env, reasoningEffort),
    system: getSystemPrompt(WORK_DIR, projectGraph, webSearch),
    maxTokens,
    temperature: 1, // K3 requires temperature=1

    /**
     * Strip superseded file contents from older assistant messages so long
     * sessions stay small, fast, and free of stale-code confusion (see
     * prune-context.ts). Displayed/persisted history is unaffected.
     */
    messages: convertToCoreMessages(pruneMessages(messages)),
    ...requestOptions,
  });
}
