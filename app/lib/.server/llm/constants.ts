// maximum output tokens per model response segment
export const MAX_TOKENS = 8192;

// limits the number of model responses that can be returned in a single request.
// with the modular architecture rules (full file contents + CONTRACT.md files),
// generations regularly exceed a single segment — 6 segments (~49k tokens total)
// gives enough headroom for multi-module projects without truncating mid-file.
export const MAX_RESPONSE_SEGMENTS = 6;
