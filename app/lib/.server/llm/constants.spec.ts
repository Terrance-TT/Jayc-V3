import { describe, expect, it } from 'vitest';
import {
  isComplexBuildRequest,
  LIGHT_EFFORT,
  LIGHT_MAX_TOKENS,
  looksLikeBuildRequest,
  resolveGeneration,
  SINGLE_EFFORT,
  SINGLE_MAX_TOKENS,
} from './constants';

describe('resolveGeneration', () => {
  it('runs the pipeline for power mode on any turn', () => {
    expect(resolveGeneration('power', true)).toEqual({ pipeline: true });
    expect(resolveGeneration('power', false)).toEqual({ pipeline: true });
  });

  it('runs the pipeline for auto only when the turn is pipeline-worthy', () => {
    expect(resolveGeneration('auto', true)).toEqual({ pipeline: true });
    expect(resolveGeneration('auto', false)).toEqual({
      pipeline: false,
      effort: SINGLE_EFFORT,
      maxTokens: SINGLE_MAX_TOKENS,
    });
  });

  it('never runs the pipeline for turbo and stays light', () => {
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

  it('gives auto the golden recipe (single deep pass) on non-pipeline turns', () => {
    const plan = resolveGeneration('auto', false);

    expect(plan).toEqual({ pipeline: false, effort: 'high', maxTokens: 65_536 });
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

describe('isComplexBuildRequest', () => {
  it('treats simple and medium builds as not complex', () => {
    expect(isComplexBuildRequest('Build a todo app in React using Tailwind')).toBe(false);
    expect(isComplexBuildRequest('Make a space invaders game')).toBe(false);
    expect(isComplexBuildRequest('create a sailing app to teach beginners wind direction')).toBe(false);
  });

  it('flags long requests as complex', () => {
    const long =
      'Build a recipe sharing platform where home cooks can publish their recipes with step by step photos and full ingredient lists, rate and review other peoples dishes, create weekly meal plans for their families, and automatically generate categorized shopping lists from any of the plans they choose to follow';

    expect(isComplexBuildRequest(long)).toBe(true);
  });

  it('flags multi-segment requests as complex', () => {
    expect(isComplexBuildRequest('Build a chat app. It needs channels and DMs. Add typing indicators too.')).toBe(true);
  });

  it('flags multi-feature requests as complex', () => {
    expect(isComplexBuildRequest('Build an app with auth, a dashboard, and Stripe payments')).toBe(true);
  });
});
