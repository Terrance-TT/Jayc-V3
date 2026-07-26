import { describe, expect, it } from 'vitest';
import { INTEGRATION_CATALOG } from './catalog';
import { detectCapabilities } from './detect';

describe('detectCapabilities (integration advisory layer)', () => {
  it('detects auth from a login request', () => {
    const detected = detectCapabilities('Add user login and sign up pages to my app', '');

    expect(detected.map((d) => d.category.id)).toContain('auth');
    expect(detected.find((d) => d.category.id === 'auth')?.matchedSnippet).toBeTruthy();
  });

  it('detects maps from a map request', () => {
    const detected = detectCapabilities('Show nearby coffee shops on a map', '');

    expect(detected.map((d) => d.category.id)).toContain('maps');
  });

  it('detects multiple categories from one message', () => {
    const detected = detectCapabilities('Build a store with login, a map of locations, and stripe checkout', '');

    const ids = detected.map((d) => d.category.id);

    expect(ids).toContain('auth');
    expect(ids).toContain('maps');
    expect(ids).toContain('payments');
  });

  it('returns nothing for a generic coding request', () => {
    expect(detectCapabilities('How do I center a div in CSS?', '')).toEqual([]);
    expect(detectCapabilities('Make a bouncing ball with real gravity using React', '')).toEqual([]);
  });

  it('returns nothing for an empty message', () => {
    expect(detectCapabilities('', '')).toEqual([]);
  });

  it('dedupes categories already suggested in prior assistant output', () => {
    const priorAssistant =
      'Plan: interactive map first. <jaycSuggestions>{"suggestions":[{"category":"maps","chosen":"leaflet","options":[{"id":"leaflet","name":"Leaflet + OpenStreetMap"}]}]}</jaycSuggestions>';

    const detected = detectCapabilities('Now also add a map of our offices', priorAssistant);

    expect(detected.map((d) => d.category.id)).not.toContain('maps');
  });

  it('does not match inside unrelated words (word boundaries)', () => {
    // "email" must not fire on "email" embedded in a larger token, etc.
    const detected = detectCapabilities('Style the primary button and add a subtle animation', '');

    expect(detected).toEqual([]);
  });

  it('every catalog category has at least one option and one trigger pattern', () => {
    for (const category of INTEGRATION_CATALOG) {
      expect(category.options.length).toBeGreaterThan(0);
      expect(category.triggerPatterns.length).toBeGreaterThan(0);
      expect(category.options.some((o) => o.recommended)).toBe(true);
    }
  });
});
