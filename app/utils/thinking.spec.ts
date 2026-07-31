import { describe, expect, it } from 'vitest';
import { extractThinking, hasThinking, stripThinking } from './thinking';

describe('extractThinking', () => {
  it('returns the input untouched when there are no thinking spans', () => {
    const result = extractThinking('plain message with <boltArtifact> tags');

    expect(result).toEqual({
      thinking: '',
      content: 'plain message with <boltArtifact> tags',
      thinkingInProgress: false,
    });
  });

  it('extracts a closed span and removes it from the content', () => {
    const raw = '<jayc-thinking>reasoning here</jayc-thinking>The actual answer.';
    const result = extractThinking(raw);

    expect(result.thinking).toBe('reasoning here');
    expect(result.content).toBe('The actual answer.');
    expect(result.thinkingInProgress).toBe(false);
  });

  it('handles multiple spans', () => {
    const raw = '<jayc-thinking>first</jayc-thinking>Some text.<jayc-thinking>second</jayc-thinking>More text.';
    const result = extractThinking(raw);

    expect(result.thinking).toBe('first\nsecond');
    expect(result.content).toBe('Some text.More text.');
    expect(result.thinkingInProgress).toBe(false);
  });

  it('treats an unclosed span at the end as in-progress and strips it', () => {
    const raw = '<jayc-thinking>still reasoning';
    const result = extractThinking(raw);

    expect(result.thinking).toBe('still reasoning');
    expect(result.content).toBe('');
    expect(result.thinkingInProgress).toBe(true);
  });

  it('handles content before an unclosed span', () => {
    const raw = 'Partial answer.<jayc-thinking>more reasoning';
    const result = extractThinking(raw);

    expect(result.content).toBe('Partial answer.');
    expect(result.thinkingInProgress).toBe(true);
  });

  it('preserves thinking text that contains artifact-like markup', () => {
    const raw = '<jayc-thinking>maybe a <boltArtifact id="draft"> tag?</jayc-thinking>Done.';
    const result = extractThinking(raw);

    expect(result.thinking).toBe('maybe a <boltArtifact id="draft"> tag?');
    expect(result.content).toBe('Done.');
  });
});

describe('stripThinking / hasThinking', () => {
  it('strips spans and reports their presence', () => {
    const raw = '<jayc-thinking>scratch</jayc-thinking>Clean.';

    expect(hasThinking(raw)).toBe(true);
    expect(stripThinking(raw)).toBe('Clean.');
  });

  it('is a no-op without spans', () => {
    expect(hasThinking('Clean.')).toBe(false);
    expect(stripThinking('Clean.')).toBe('Clean.');
  });
});
