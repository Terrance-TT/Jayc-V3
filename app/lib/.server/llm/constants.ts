// Maximum output tokens per model response segment.
//
// TEMPORARILY UNCAPPED (owner request, 2026-07-26): set to the K3 API
// maximum (1,048,576) so the model can think as long as it wants while the
// turbo feature is built. WARNING: K3 reasoning tokens are billed as output
// tokens (~$15/M) — a single long turn can cost real money. RE-CAP THIS
// (e.g. 32768) once the turbo toggle ships.
export const MAX_TOKENS = 1048576;

// Limits the number of model responses that can be returned in a single request.
export const MAX_RESPONSE_SEGMENTS = 2;

// How hard Kimi K3 thinks before answering: 'low' | 'high' | 'max'.
// 'high' is the deliberate default (near-max code quality). NOTE: reasoning
// tokens produce NO visible stream output, so long thinking leaves the
// connection silent and can get the stream killed mid-generation
// (ERR_HTTP2_PROTOCOL_ERROR). A user-facing speed/quality ("turbo") toggle
// is being added separately to expose the fast 'low' mode.
export const REASONING_EFFORT = 'high';
