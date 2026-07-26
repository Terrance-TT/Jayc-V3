// Maximum output tokens per model response segment.
//
// Capped at 32k: K3 reasoning tokens count against this budget and are
// billed as output tokens (~$15/M), so an uncapped budget lets a single
// runaway turn cost real money. 32k leaves ample room for thinking plus a
// full artifact while bounding worst-case cost per segment.
export const MAX_TOKENS = 32768;

// Limits the number of model responses that can be returned in a single request.
export const MAX_RESPONSE_SEGMENTS = 2;

// How hard Kimi K3 thinks before answering: 'low' | 'high' | 'max'.
// 'high' is the deliberate default (near-max code quality). NOTE: reasoning
// tokens produce NO visible stream output, so long thinking leaves the
// connection silent and can get the stream killed mid-generation
// (ERR_HTTP2_PROTOCOL_ERROR). A user-facing speed/quality ("turbo") toggle
// is being added separately to expose the fast 'low' mode.
export const REASONING_EFFORT = 'high';
