/**
 * Integration advisory layer — suggestion card.
 *
 * When the model emits a `<jaycSuggestions>` JSON block (instructed by the
 * <integration_advisory> prompt section, see app/lib/integrations), the
 * assistant-message renderer strips that block from the markdown and renders
 * this card instead. The card shows each detected capability category with
 * the chosen option highlighted; the other options are buttons that send a
 * follow-up user message through the normal chat send path (non-blocking —
 * generation has already proceeded with the default).
 */

import { memo } from 'react';
import { INTEGRATION_CATALOG } from '~/lib/integrations/catalog';
import { classNames } from '~/utils/classNames';

export interface JaycSuggestionOption {
  id: string;
  name: string;
}

export interface JaycSuggestion {
  category: string;
  chosen: string;
  options: JaycSuggestionOption[];
}

export interface ParsedSuggestions {
  /** Assistant text with the <jaycSuggestions> block removed. */
  text: string;

  /** Parsed suggestions, or null when absent/unparseable/still streaming. */
  suggestions: JaycSuggestion[] | null;
}

const BLOCK_OPEN = '<jaycSuggestions>';
const BLOCK_CLOSE = '</jaycSuggestions>';

function isValidSuggestion(value: unknown): value is JaycSuggestion {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.category === 'string' &&
    typeof candidate.chosen === 'string' &&
    Array.isArray(candidate.options) &&
    candidate.options.every(
      (option) =>
        typeof option === 'object' &&
        option !== null &&
        typeof (option as Record<string, unknown>).id === 'string' &&
        typeof (option as Record<string, unknown>).name === 'string',
    )
  );
}

/**
 * Extract the `<jaycSuggestions>` block from assistant text. Robust to
 * streaming (a half-written block is hidden from the markdown but not yet
 * rendered as a card) and to malformed JSON (block stripped, no card).
 */
export function parseJaycSuggestions(content: string): ParsedSuggestions {
  const openIndex = content.indexOf(BLOCK_OPEN);

  if (openIndex === -1) {
    return { text: content, suggestions: null };
  }

  const closeIndex = content.indexOf(BLOCK_CLOSE, openIndex);

  if (closeIndex === -1) {
    // still streaming: hide the partial block, render no card yet
    return { text: content.slice(0, openIndex), suggestions: null };
  }

  const json = content.slice(openIndex + BLOCK_OPEN.length, closeIndex);
  const text = (content.slice(0, openIndex) + content.slice(closeIndex + BLOCK_CLOSE.length)).trim();

  try {
    const parsed: unknown = JSON.parse(json);

    const raw = (parsed as { suggestions?: unknown }).suggestions;

    if (!Array.isArray(raw)) {
      return { text, suggestions: null };
    }

    const suggestions = raw.filter(isValidSuggestion);

    return { text, suggestions: suggestions.length > 0 ? suggestions : null };
  } catch {
    return { text, suggestions: null };
  }
}

/** Human-readable category label, falling back to the raw id. */
function categoryLabel(categoryId: string): string {
  return INTEGRATION_CATALOG.find((category) => category.id === categoryId)?.label ?? categoryId;
}

interface SuggestionCardProps {
  suggestions: JaycSuggestion[];

  /** Sends a follow-up user message via the normal chat send path. */
  onSelectAlternative?: (message: string) => void;

  /** Disable the option buttons while a response is still streaming. */
  disabled?: boolean;
}

export const SuggestionCard = memo(({ suggestions, onSelectAlternative, disabled = false }: SuggestionCardProps) => {
  return (
    <div className="mt-3 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-bg-depth-2 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-bolt-elements-textPrimary">
        <div className="i-ph:plugs-connected text-base" />
        Suggested integrations
      </div>
      <div className="mt-2 flex flex-col gap-3">
        {suggestions.map((suggestion) => {
          const chosenOption = suggestion.options.find((option) => option.id === suggestion.chosen);

          return (
            <div key={suggestion.category}>
              <div className="text-xs uppercase tracking-wide text-bolt-elements-textTertiary">
                {categoryLabel(suggestion.category)}
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                {suggestion.options.map((option) => {
                  const isChosen = option.id === suggestion.chosen;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={disabled || isChosen}
                      title={isChosen ? `${option.name} (selected)` : `Use ${option.name} instead`}
                      onClick={() => {
                        if (isChosen || !onSelectAlternative) {
                          return;
                        }

                        /**
                         * Follow-up through the normal send path; the model
                         * regenerates with the alternative service.
                         */
                        onSelectAlternative(
                          `For ${suggestion.category}, use ${option.name} instead of ${chosenOption?.name ?? suggestion.chosen}.`,
                        );
                      }}
                      className={classNames(
                        'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-theme',
                        isChosen
                          ? 'border-bolt-elements-borderColorActive bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent font-medium'
                          : 'border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:border-bolt-elements-borderColorActive disabled:opacity-50',
                      )}
                    >
                      {isChosen && <div className="i-ph:check-circle-fill text-sm" />}
                      {option.name}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
