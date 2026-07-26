/**
 * Integration advisory layer — prompt block builder.
 *
 * Turns the detected capabilities into a compact `<integration_advisory>`
 * section that is injected into the system prompt (see prompts.ts). The block
 * is a SCOPED exception to the prompt's "do not be verbose" rule: the model
 * may write 2-3 short advisory lines plus one machine-readable
 * `<jaycSuggestions>` JSON block, which the chat UI renders as a suggestion
 * card (see app/components/chat/SuggestionCard.tsx).
 *
 * Pure and synchronous — no LLM call, no I/O.
 */

import type { IntegrationCategory, IntegrationOption } from './catalog';
import type { DetectedCapability } from './detect';

/**
 * Budget guard: the whole advisory section must stay compact (roughly under
 * 1200 characters), so at most this many categories are ever injected.
 */
const MAX_ADVISORY_CATEGORIES = 3;

/** The default the model picks unless the user named a different service. */
function defaultOption(category: IntegrationCategory): IntegrationOption {
  return category.options.find((option) => option.recommended) ?? category.options[0];
}

/** Compact machine-readable block the UI parses into the suggestion card. */
function buildSuggestionsJson(detected: DetectedCapability[]): string {
  const suggestions = detected.map(({ category }) => ({
    category: category.id,
    chosen: defaultOption(category).id,
    options: category.options.map((option) => ({ id: option.id, name: option.name })),
  }));

  return `<jaycSuggestions>${JSON.stringify({ suggestions })}</jaycSuggestions>`;
}

/**
 * Build the `<integration_advisory>` system-prompt section. Returns an empty
 * string when nothing was detected, in which case the base prompt is left
 * completely untouched.
 */
export function buildAdvisoryBlock(detected: DetectedCapability[]): string {
  if (detected.length === 0) {
    return '';
  }

  const capped = detected.slice(0, MAX_ADVISORY_CATEGORIES);

  const categoryIds = capped.map(({ category }) => category.id).join(', ');

  const browserOnlyNotes = capped
    .map(({ category }) => category.browserOnlyNote)
    .filter((note): note is string => Boolean(note))
    .map((note) => `Note: ${note}`)
    .join('\n');

  return `<integration_advisory>
Request matches: ${categoryIds}.
This is a SCOPED EXCEPTION to the "do not be verbose" rule: 2-3 short lines plus one block.
1. Before the artifact, write 2-3 short lines: the plan and which option you chose per category and why. Default to "chosen" below unless the user named a service (then update "chosen").
2. When a browser-only approach is enough, say so explicitly: no service or API key needed.${browserOnlyNotes ? `\n${browserOnlyNotes}` : ''}
3. Emit this block exactly (compact JSON, no prose inside the tags):
${buildSuggestionsJson(capped)}
</integration_advisory>`;
}
