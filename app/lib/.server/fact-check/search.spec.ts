import { describe, expect, it } from 'vitest';
import { queryFromMessage } from './search';

describe('queryFromMessage', () => {
  it('strips markup and diff tags', () => {
    expect(
      queryFromMessage('<bolt_file_modifications><diff path="/a">x</diff></bolt_file_modifications> build a game'),
    ).toBe('x build a game');
  });

  it('collapses whitespace', () => {
    expect(queryFromMessage('build   a\n\nsailing\t\tapp')).toBe('build a sailing app');
  });

  it('trims and caps the length', () => {
    const long = `  ${'a'.repeat(400)}  `;
    const query = queryFromMessage(long);

    expect(query.length).toBe(300);
    expect(query).toBe('a'.repeat(300));
  });

  it('respects a custom cap', () => {
    expect(queryFromMessage('a'.repeat(100), 50).length).toBe(50);
  });

  it('returns an empty string for empty/tag-only input', () => {
    expect(queryFromMessage('')).toBe('');
    expect(queryFromMessage('<div></div>')).toBe('');
  });
});
