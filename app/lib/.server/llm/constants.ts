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

// turbo: one light pass
export const LIGHT_EFFORT: ReasoningEffort = 'low';
export const LIGHT_MAX_TOKENS = 49_152;

/**
 * Auto on non-pipeline turns: one deep pass at high effort — the "golden
 * recipe" (single pass, high effort, generous budget), bounded, with
 * continuations as the safety net.
 */
export const SINGLE_EFFORT: ReasoningEffort = 'high';
export const SINGLE_MAX_TOKENS = 65_536;

/**
 * Pipeline phase bounds. Phase 1 runs LIGHT: its only job is a quick core
 * draft (~30s), because the depth lives in phase 2 (the user's "thinks
 * quickly, then spiderwebs" design). Phase 2 gets the deep expansion
 * budget, capped so the design wraps up instead of wandering; the build
 * phase is bounded per segment with continuations on top.
 */
export const PLAN_EFFORT: ReasoningEffort = 'low';
export const PLAN_MAX_TOKENS = 6_144;
export const EXPAND_EFFORT: ReasoningEffort = 'high';
export const EXPAND_MAX_TOKENS = 32_768;
export const BUILD_EFFORT: ReasoningEffort = 'high';
export const BUILD_MAX_TOKENS = 65_536;

// verify phase (post-build domain-facts check, first-build pipelines only)
export const VERIFY_EFFORT: ReasoningEffort = 'high';
export const VERIFY_MAX_TOKENS = 16_384;

// review phase (post-build second-opinion pass, first builds except turbo)
export const REVIEW_EFFORT: ReasoningEffort = 'high';
export const REVIEW_MAX_TOKENS = 16_384;

/**
 * Wall-clock budget for the two THINKING phases of a pipeline run. Reaching
 * it never stops the session: the user gets a choice — keep thinking in a
 * fresh window, or build from the salvaged design (see pipeline.ts).
 */
export const THINKING_BUDGET_MS = 10 * 60_000;

// how many "think longer" extensions a user may take before the build is forced
export const MAX_THINK_EXTENSIONS = 2;

// generous ceiling: 3 pipeline phases + build continuations
export const MAX_RESPONSE_SEGMENTS = 6;

/**
 * Resolves a requested thinking mode into a concrete generation plan.
 * `pipelineWorthy` is the server-side judgment that this turn deserves the
 * full pipeline (a complex build-like first message or a freshly answered
 * set of clarifying questions) — power mode ignores it and always
 * pipelines. Everything else is one pass: light for turbo, the deep
 * golden-recipe pass for auto.
 */
export function resolveGeneration(mode: ThinkingMode, pipelineWorthy: boolean): GenerationPlan {
  if (mode === 'power') {
    return { pipeline: true };
  }

  if (mode === 'auto' && pipelineWorthy) {
    return { pipeline: true };
  }

  if (mode === 'turbo') {
    return { pipeline: false, effort: LIGHT_EFFORT, maxTokens: LIGHT_MAX_TOKENS };
  }

  return { pipeline: false, effort: SINGLE_EFFORT, maxTokens: SINGLE_MAX_TOKENS };
}

// matches openings that read as questions, not build requests
const QUESTION_OPENING_PATTERN =
  /^(how|what|why|when|where|which|who|whom|whose|is|are|was|were|do|does|did|can|could|should|would|will|explain|tell me)\b/i;

/**
 * Decides whether a first user message is a BUILD request (deserving the
 * plan→expand→build pipeline) or something lighter — a question, a chatty
 * opener, or too vague to plan against. Prevents the deep pipeline from
 * burning minutes on "How do I center a div?".
 */
export function looksLikeBuildRequest(message: string): boolean {
  const text = message.trim();

  if (text.length < 24) {
    return false;
  }

  if (QUESTION_OPENING_PATTERN.test(text)) {
    return false;
  }

  return true;
}

// signals that the request is a genuinely complex, multi-part build
const COMPLEXITY_SIGNAL_PATTERN =
  /\b(auth|login|log[ -]?in|sign[ -]?up|signup|payments?|stripe|checkout|databases?|dashboards?|admin|real[ -]?time|multiplayer|websockets?|apis?|backends?|cms|blogs?|stores?|carts?|bookings?|social|feeds?|uploads?|files?)\b/gi;

/**
 * Decides whether a build request is COMPLEX enough to deserve the
 * plan→expand→build pipeline. Simple and medium builds get the golden
 * recipe (one deep pass) — faster and just as good; the pipeline is
 * reserved for genuinely multi-part applications.
 */
export function isComplexBuildRequest(message: string): boolean {
  const text = message.trim();

  const wordCount = text.split(/\s+/).length;

  if (wordCount >= 40) {
    return true;
  }

  const segmentCount = text.split(/[.!?\n;]+/).filter((segment) => segment.trim().length > 0).length;

  if (segmentCount >= 3) {
    return true;
  }

  const signals = text.match(COMPLEXITY_SIGNAL_PATTERN) ?? [];

  return signals.length >= 3;
}
