import type { ThinkingMode } from '~/utils/thinking';

/**
 * Generation settings: the client sends a `mode` field with each /api/chat
 * request and the server resolves it into a generation plan here.
 *
 * - turbo: single light pass (low effort, small budget) — fastest.
 * - power: the full plan→expand→build pipeline on every turn.
 * - auto (default): pipeline on first builds, single light pass on follow-ups.
 *
 * Cost note: K3 reasoning tokens are billed as output tokens (~$15/M), so
 * every deep phase is budgeted explicitly. The pipeline's thinking phases
 * are visible to the user (see reasoning-stream.ts) and bounded by tokens
 * plus a wall-clock backstop that transitions into the build phase — never
 * a session kill.
 */
export type ReasoningEffort = 'low' | 'high' | 'max';

export const DEFAULT_THINKING_MODE: ThinkingMode = 'auto';

export interface SinglePassGeneration {
  pipeline: false;
  effort: ReasoningEffort;
  maxTokens: number;
}

export interface PipelineGeneration {
  pipeline: true;
}

export type GenerationPlan = SinglePassGeneration | PipelineGeneration;

// single-pass settings (turbo, and auto on follow-ups)
export const LIGHT_EFFORT: ReasoningEffort = 'low';
export const LIGHT_MAX_TOKENS = 32_768;

/**
 * Pipeline phase bounds. Phase 1 is deliberately tight so the core draft
 * lands in well under two minutes; phase 2 gets the deep expansion budget;
 * the build phase is bounded per segment with continuations on top.
 */
export const PLAN_EFFORT: ReasoningEffort = 'high';
export const PLAN_MAX_TOKENS = 6_144;
export const EXPAND_EFFORT: ReasoningEffort = 'high';
export const EXPAND_MAX_TOKENS = 49_152;
export const BUILD_EFFORT: ReasoningEffort = 'high';
export const BUILD_MAX_TOKENS = 65_536;

/**
 * Wall-clock budget for the two THINKING phases of a pipeline run. Reaching
 * it never stops the session: the active pass is aborted and the build
 * phase starts with whatever the design already covers.
 */
export const THINKING_BUDGET_MS = 10 * 60_000;

// generous ceiling: 3 pipeline phases + build continuations
export const MAX_RESPONSE_SEGMENTS = 6;

/**
 * Resolves a requested thinking mode into a concrete generation plan.
 */
export function resolveGeneration(mode: ThinkingMode, isFirstMessage: boolean): GenerationPlan {
  if (mode === 'power') {
    return { pipeline: true };
  }

  if (mode === 'auto' && isFirstMessage) {
    return { pipeline: true };
  }

  return { pipeline: false, effort: LIGHT_EFFORT, maxTokens: LIGHT_MAX_TOKENS };
}
