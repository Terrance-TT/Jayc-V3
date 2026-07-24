// Maximum output tokens per model response segment.
//
// Kimi K3 always reasons, and its reasoning tokens count AGAINST this same
// budget (reasoning_content + content <= max_tokens). At 8192 the model
// regularly spent the entire budget thinking and returned ZERO visible
// content (finishReason "length" with an empty body). K3 supports up to
// 1,048,576 completion tokens — 64k leaves ample room for deep reasoning
// plus a full multi-module code artifact.
export const MAX_TOKENS = 65536;

// Limits the number of model responses that can be returned in a single request.
// With 64k tokens per segment, 2 segments (~131k tokens total) is plenty of
// headroom for even large modular projects. Note: reasoning tokens are billed
// as output tokens, so higher budgets mean higher worst-case cost per turn.
export const MAX_RESPONSE_SEGMENTS = 2;
