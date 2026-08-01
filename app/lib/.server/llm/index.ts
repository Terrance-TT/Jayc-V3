/**
 * Public API barrel for the llm module (see CONTRACT.md). Routes import
 * from here; internals stay relative.
 */
export { getAPIKey } from './api-key';
export { getTriggeredAddons } from './addons';
export * from './constants';
export { withHeartbeat } from './heartbeat';
export { getMoonshotModel, type ByokConfig } from './model';
export { runGeneration } from './pipeline';
export {
  BUILD_PHASE_PROMPT,
  BUILD_TIMEOUT_PROMPT,
  CONTINUE_PROMPT,
  CONTINUE_THINKING_PROMPT,
  CONTINUE_THINKING_SUFFIX,
  EXPAND_BRIDGE_PROMPT,
  EXPAND_PHASE_SUFFIX,
  getSystemPrompt,
  PLAN_PHASE_SUFFIX,
  VERIFY_BRIDGE_PROMPT,
  VERIFY_PHASE_SUFFIX,
} from './prompts';
export { streamText, type Messages, type StreamingOptions, type StreamTextOptions } from './stream-text';
export { default as SwitchableStream } from './switchable-stream';
