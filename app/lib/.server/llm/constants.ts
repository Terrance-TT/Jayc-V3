// Maximum output tokens per model response segment.
//
// TEMPORARILY UNCAPPED (diagnostic): set to the K3 API maximum (1,048,576)
// to rule out max_tokens as the cause of empty responses (finishReason
// "length" with zero content — K3 reasoning tokens count against this budget).
//
// WARNING: reasoning tokens are billed as output tokens (~$15/M). With no
// practical cap, a single runaway turn can cost real money. Once generation
// is confirmed working, LOWER THIS to a sane value (e.g. 65536).
export const MAX_TOKENS = 1048576;

// Limits the number of model responses that can be returned in a single request.
export const MAX_RESPONSE_SEGMENTS = 2;
