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
// 'low' is deliberate: reasoning tokens produce NO visible stream output,
// so long thinking leaves the connection silent for minutes and the stream
// gets killed mid-generation (the ERR_HTTP2_PROTOCOL_ERROR failures).
// 'high'/'max' (the API default) caused 30+ minute silent generations.
export const REASONING_EFFORT = 'low';
