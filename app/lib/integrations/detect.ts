/**
 * Integration advisory layer — capability detection.
 *
 * Pure, synchronous, fully unit-testable: regex-matches the catalog's
 * trigger patterns against the LATEST user message and returns the implied
 * capability categories. No LLM call, no async, no I/O.
 *
 * Session-level dedupe: a category is skipped when its id already appears in
 * prior assistant output (the emitted <jaycSuggestions> block contains
 * `"category":"<id>"`, so anything already suggested is never re-suggested).
 */

import { INTEGRATION_CATALOG, type IntegrationCategory } from './catalog';

export interface DetectedCapability {
  /** The catalog category that matched. */
  category: IntegrationCategory;

  /** The exact text snippet that fired the pattern (useful for debugging). */
  matchedSnippet: string;
}

/**
 * Detect capability categories implied by the user's latest message.
 *
 * @param latestUserText content of the most recent user message only
 * @param priorAssistantText concatenated content of earlier assistant messages
 */
export function detectCapabilities(latestUserText: string, priorAssistantText: string): DetectedCapability[] {
  if (!latestUserText) {
    return [];
  }

  const alreadySuggested = priorAssistantText.toLowerCase();
  const detected: DetectedCapability[] = [];

  for (const category of INTEGRATION_CATALOG) {
    // dedupe: never suggest a category twice in one session
    if (alreadySuggested.includes(category.id.toLowerCase())) {
      continue;
    }

    for (const pattern of category.triggerPatterns) {
      const match = pattern.exec(latestUserText);

      if (match) {
        detected.push({ category, matchedSnippet: match[0] });
        break; // first matching pattern is enough for this category
      }
    }
  }

  return detected;
}
