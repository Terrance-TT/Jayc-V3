import { map } from 'nanostores';
import { createScopedLogger } from '~/utils/logger';
import { stripIndents } from '~/utils/stripIndent';

const logger = createScopedLogger('ErrorMonitor');

export type ErrorSource = 'shell' | 'file-write' | 'action';

export interface DetectedError {
  id: string;
  source: ErrorSource;

  /** short summary, e.g. the command that failed */
  title: string;

  /** exit code, output tail, or exception message */
  detail: string;
  timestamp: number;
  acknowledged: boolean;
}

/**
 * ErrorMonitorStore is the central, chat-agnostic place where runtime
 * failures are reported (failed shell commands, file write errors, etc.).
 *
 * It deliberately knows NOTHING about the chat or the LLM — it only records
 * errors, deduplicates them, and can format them into a fix-request prompt.
 * The bridge to the chat lives in `app/lib/hooks/useErrorFeedback.ts`.
 */
export class ErrorMonitorStore {
  errors = map<Record<string, DetectedError>>({});

  /**
   * Content fingerprints of every error ever reported. Identical failures
   * are only reported once per session — this is what prevents infinite
   * auto-fix loops when a fix attempt reproduces the exact same error.
   */
  #seen = new Set<string>();

  reportError(error: Pick<DetectedError, 'source' | 'title' | 'detail'>) {
    const fingerprint = `${error.source}:${error.title}:${error.detail.slice(-500)}`;

    if (this.#seen.has(fingerprint)) {
      logger.debug('Duplicate error suppressed:', error.title);

      return;
    }

    this.#seen.add(fingerprint);

    const id = `error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    this.errors.setKey(id, {
      ...error,
      id,
      timestamp: Date.now(),
      acknowledged: false,
    });

    logger.warn('Error detected:', error.title);
  }

  get unacknowledged(): DetectedError[] {
    return Object.values(this.errors.get()).filter((error) => !error.acknowledged);
  }

  acknowledgeAll() {
    const errors = this.errors.get();

    for (const [id, error] of Object.entries(errors)) {
      if (!error.acknowledged) {
        this.errors.setKey(id, { ...error, acknowledged: true });
      }
    }
  }

  clear() {
    this.errors.set({});
    this.#seen.clear();
  }
}

export const errorMonitorStore = new ErrorMonitorStore();

/**
 * Formats detected errors into a user-role message asking the model to fix
 * the problem. Kept here (not in the hook) so the prompt wording lives next
 * to the error shape it consumes.
 */
export function formatErrorsForPrompt(errors: DetectedError[]): string {
  const blocks = errors
    .map(
      (error) =>
        `<error source="${error.source}">\n${error.title}\n\n${error.detail}\n</error>`,
    )
    .join('\n\n');

  return stripIndents`
    The following error(s) occurred while running the project:

    ${blocks}

    Analyze the root cause and fix it. If a dependency is missing, install it. If a file is broken, rewrite it with the FULL corrected content. Do not explain — just apply the fix.
  `;
}
