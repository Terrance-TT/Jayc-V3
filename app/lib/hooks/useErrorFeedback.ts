import { useStore } from '@nanostores/react';
import { useEffect, useRef } from 'react';
import { errorMonitorStore, formatErrorsForPrompt } from '~/lib/stores/error-monitor';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('useErrorFeedback');

interface UseErrorFeedbackOptions {
  /** whether the model is currently streaming a response */
  isLoading: boolean;

  /** called with a formatted fix-request message when new errors are detected */
  sendFixRequest: (message: string) => void;

  /** minimum time between automatic fix requests (default: 30s) */
  cooldownMs?: number;
}

/**
 * Bridges the ErrorMonitorStore into the chat: whenever new runtime errors
 * are detected and the model is idle, it asks the model to fix them.
 *
 * Loop safety is handled in two places:
 *  - ErrorMonitorStore deduplicates identical errors (a fix attempt that
 *    reproduces the exact same error is never re-reported).
 *  - This hook enforces a cooldown between automatic fix requests.
 */
export function useErrorFeedback({ isLoading, sendFixRequest, cooldownMs = 30_000 }: UseErrorFeedbackOptions) {
  const errors = useStore(errorMonitorStore.errors);
  const lastSentAtRef = useRef(0);
  const sendFixRequestRef = useRef(sendFixRequest);

  sendFixRequestRef.current = sendFixRequest;

  useEffect(() => {
    if (isLoading) {
      return;
    }

    const pending = Object.values(errors).filter((error) => !error.acknowledged);

    if (pending.length === 0) {
      return;
    }

    const now = Date.now();

    if (now - lastSentAtRef.current < cooldownMs) {
      return;
    }

    lastSentAtRef.current = now;

    const message = formatErrorsForPrompt(pending);

    errorMonitorStore.acknowledgeAll();

    logger.info(`Requesting automatic fix for ${pending.length} error(s)`);

    sendFixRequestRef.current(message);
  }, [errors, isLoading, cooldownMs]);
}
