import { memo, useEffect, useRef, useState } from 'react';
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

export const AssistantMessage = memo(({ content }: AssistantMessageProps) => {
  /**
   * Streaming chunks arrive far faster than markdown can re-render; throttle
   * to keep the UI responsive without ever dropping the final content.
   */
  const throttledContent = useThrottledValue(content, 150);

  return (
    <div className="overflow-hidden w-full">
      <Markdown html>{throttledContent}</Markdown>
    </div>
  );
});
