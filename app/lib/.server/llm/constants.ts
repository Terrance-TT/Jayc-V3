/**
 * Generation modes: the client sends a `mode` field with each /api/chat
 * request and the server maps it to concrete model settings here.
 *
 * Cost note: K3 reasoning tokens are billed as output tokens (~$15/M) and
 * produce NO visible stream output while the model thinks, so long reasoning
 * also leaves the connection silent and can get the stream killed
 * mid-generation (ERR_HTTP2_PROTOCOL_ERROR). Turbo mode ('low' effort, hard
 * output cap) is the fast/cheap default; Power mode ('high' effort, generous
 * budget) is opt-in for hard problems. Both modes are capped — the earlier
 * fully-uncapped MAX_TOKENS was a temporary owner request while this toggle
 * was being built.
 */
export type GenerationMode = 'turbo' | 'power';

export interface GenerationModeSettings {
  reasoningEffort: 'low' | 'high' | 'max';
  maxTokens: number;
}

export const DEFAULT_GENERATION_MODE: GenerationMode = 'turbo';

export const GENERATION_MODES: Record<GenerationMode, GenerationModeSettings> = {
  turbo: {
    reasoningEffort: 'low',
    maxTokens: 32_768,
  },
  power: {
    reasoningEffort: 'high',
    maxTokens: 131_072,
  },
};

// limits the number of model responses that can be returned in a single request
export const MAX_RESPONSE_SEGMENTS = 2;
