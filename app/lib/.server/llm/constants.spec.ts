import { describe, expect, it } from 'vitest';
import { LIGHT_EFFORT, LIGHT_MAX_TOKENS, resolveGeneration } from './constants';

describe('resolveGeneration', () => {
  it('runs the pipeline for power mode on any turn', () => {
    expect(resolveGeneration('power', true)).toEqual({ pipeline: true });
    expect(resolveGeneration('power', false)).toEqual({ pipeline: true });
  });

  it('runs the pipeline for auto only on the first message', () => {
    expect(resolveGeneration('auto', true)).toEqual({ pipeline: true });
    expect(resolveGeneration('auto', false)).toEqual({
      pipeline: false,
      effort: LIGHT_EFFORT,
      maxTokens: LIGHT_MAX_TOKENS,
    });
  });

  it('never runs the pipeline for turbo', () => {
    expect(resolveGeneration('turbo', true)).toEqual({
      pipeline: false,
      effort: LIGHT_EFFORT,
      maxTokens: LIGHT_MAX_TOKENS,
    });
    expect(resolveGeneration('turbo', false)).toEqual({
      pipeline: false,
      effort: LIGHT_EFFORT,
      maxTokens: LIGHT_MAX_TOKENS,
    });
  });
});
