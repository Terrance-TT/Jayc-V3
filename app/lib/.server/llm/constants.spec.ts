import { describe, expect, it } from 'vitest';
import { LIGHT_EFFORT, LIGHT_MAX_TOKENS, looksLikeBuildRequest, resolveGeneration } from './constants';

describe('resolveGeneration', () => {
  it('runs the pipeline for power mode on any turn', () => {
    expect(resolveGeneration('power', true)).toEqual({ pipeline: true });
    expect(resolveGeneration('power', false)).toEqual({ pipeline: true });
  });

  it('runs the pipeline for auto only when the turn is pipeline-worthy', () => {
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

describe('looksLikeBuildRequest', () => {
  it('accepts clear build requests', () => {
    expect(looksLikeBuildRequest('Build a todo app in React using Tailwind')).toBe(true);
    expect(looksLikeBuildRequest('Make a space invaders game')).toBe(true);
    expect(looksLikeBuildRequest('create a sailing app to teach beginners wind direction')).toBe(true);
  });

  it('rejects questions', () => {
    expect(looksLikeBuildRequest('How do I center a div?')).toBe(false);
    expect(looksLikeBuildRequest('What is the best way to structure a React app?')).toBe(false);
    expect(looksLikeBuildRequest('Can you explain how closures work in JavaScript?')).toBe(false);
  });

  it('rejects very short messages', () => {
    expect(looksLikeBuildRequest('hi')).toBe(false);
    expect(looksLikeBuildRequest('make a game')).toBe(false);
  });
});
