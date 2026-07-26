import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from './Markdown';
import { parseJaycSuggestions, SuggestionCard } from './SuggestionCard';

interface AssistantMessageProps {
  content: string;

  /**
   * Integration advisory layer: sends a follow-up user message when the user
   * picks an alternative service in the suggestion card.
   */
  onSelectAlternative?: (message: string) => void;

  /** Disables the suggestion-card buttons while a response is streaming. */
  suggestionsDisabled?: boolean;
}

/**
 * Throttles a rapidly changing value to at most one update per `interval` ms.
 * The trailing edge is guaranteed: the latest value always renders, so the
 * final streamed content can never be swallowed by the throttle window.
 */
function useThrottledValue<T>(value: T, interval: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastUpdateAtRef = useRef(0);
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const elapsed = Date.now() - lastUpdateAtRef.current;

    if (elapsed >= interval) {
      lastUpdateAtRef.current = Date.now();
      setThrottled(value);

      return;
    }

    if (trailingTimerRef.current) {
      clearTimeout(trailingTimerRef.current);
    }

    trailingTimerRef.current = setTimeout(() => {
      trailingTimerRef.current = null;
      lastUpdateAtRef.current = Date.now();
      setThrottled(value);
    }, interval - elapsed);
  }, [value, interval]);

  // cancel a pending trailing update on unmount
  useEffect(() => {
    return () => {
      if (trailingTimerRef.current) {
        clearTimeout(trailingTimerRef.current);
      }
    };
  }, []);

  return throttled;
}

export const AssistantMessage = memo(({ content, onSelectAlternative, suggestionsDisabled }: AssistantMessageProps) => {
  /**
   * Streaming chunks arrive far faster than markdown can re-render; throttle
   * to keep the UI responsive without ever dropping the final content.
   */
  const throttledContent = useThrottledValue(content, 150);

  /**
   * Integration advisory layer: extract the machine-readable
   * <jaycSuggestions> block so it renders as a card instead of raw text and
   * never leaks into the displayed markdown.
   */
  const { text, suggestions } = useMemo(() => parseJaycSuggestions(throttledContent), [throttledContent]);

  return (
    <div className="overflow-hidden w-full">
      <Markdown html>{text}</Markdown>
      {suggestions && (
        <SuggestionCard
          suggestions={suggestions}
          onSelectAlternative={onSelectAlternative}
          disabled={suggestionsDisabled}
        />
      )}
    </div>
  );
});
