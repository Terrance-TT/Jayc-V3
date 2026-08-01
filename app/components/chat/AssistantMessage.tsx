import { memo, useEffect, useRef, useState } from 'react';
import { extractThinking, stripQuestionsMarker } from '~/utils/thinking';
import { Markdown } from './Markdown';

interface AssistantMessageProps {
  content: string;
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

/**
 * Renders the model's reasoning as it streams in (Power mode can think for
 * minutes — seeing it beats staring at silence). The pane follows the
 * growing text and is stripped from the message once the response finishes,
 * so it never reaches history or the model's own input.
 */
function ThinkingBlock({ thinking, inProgress }: { thinking: string; inProgress: boolean }) {
  const paneRef = useRef<HTMLDivElement>(null);

  // follow the reasoning as it grows
  useEffect(() => {
    const pane = paneRef.current;

    if (pane) {
      pane.scrollTop = pane.scrollHeight;
    }
  }, [thinking]);

  return (
    <div className="mb-3 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-bg-depth-2 px-3 py-2">
      <div className="flex items-center gap-2 text-xs font-medium text-bolt-elements-textTertiary">
        {inProgress ? (
          <div className="i-svg-spinners:3-dots-fade text-base" />
        ) : (
          <div className="i-ph:brain text-base" />
        )}
        {inProgress ? 'Thinking…' : 'Thought process'}
      </div>
      <div
        ref={paneRef}
        className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-bolt-elements-textTertiary"
      >
        {thinking}
      </div>
    </div>
  );
}

export const AssistantMessage = memo(({ content }: AssistantMessageProps) => {
  /**
   * Streaming chunks arrive far faster than markdown can re-render; throttle
   * to keep the UI responsive without ever dropping the final content.
   */
  const throttledContent = useThrottledValue(content, 150);
  const { thinking, content: visibleContent, thinkingInProgress } = extractThinking(throttledContent);

  // the QUESTIONS: marker steers the pipeline; it is not for display
  const displayContent = stripQuestionsMarker(visibleContent);

  return (
    <div className="overflow-hidden w-full">
      {(thinking.length > 0 || thinkingInProgress) && (
        <ThinkingBlock thinking={thinking} inProgress={thinkingInProgress} />
      )}
      <Markdown html>{displayContent}</Markdown>
    </div>
  );
});
