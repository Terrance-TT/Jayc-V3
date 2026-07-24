import { WebContainer } from '@webcontainer/api';
import { map, type MapStore } from 'nanostores';
import * as nodePath from 'node:path';
import { errorMonitorStore } from '~/lib/stores/error-monitor';
import type { BoltAction } from '~/types/actions';
import { createScopedLogger } from '~/utils/logger';
import { unreachable } from '~/utils/unreachable';
import type { ActionCallbackData } from './message-parser';

const logger = createScopedLogger('ActionRunner');

export type ActionStatus = 'pending' | 'running' | 'complete' | 'aborted' | 'failed';

export type BaseActionState = BoltAction & {
  status: Exclude<ActionStatus, 'failed'>;
  abort: () => void;
  executed: boolean;
  abortSignal: AbortSignal;
};

export type FailedActionState = BoltAction &
  Omit<BaseActionState, 'status'> & {
    status: Extract<ActionStatus, 'failed'>;
    error: string;
  };

export type ActionState = BaseActionState | FailedActionState;

type BaseActionUpdate = Partial<Pick<BaseActionState, 'status' | 'abort' | 'executed'>>;

export type ActionStateUpdate =
  | BaseActionUpdate
  | (Omit<BaseActionUpdate, 'status'> & { status: 'failed'; error: string });

type ActionsMap = MapStore<Record<string, ActionState>>;

/** how much of a command's output tail is kept for error reports */
const OUTPUT_BUFFER_LIMIT = 4000;

/**
 * Patterns that match commands which start a long-running process (dev servers,
 * watchers, previews). These never exit on their own, so awaiting their exit
 * code would block the action queue forever and prevent any subsequent actions
 * (e.g. file writes) from ever running.
 */
const LONG_RUNNING_COMMAND_PATTERNS = [
  // package manager scripts that typically start servers or watchers
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview|watch|storybook)\b/,

  // direct invocations of common dev servers / watchers
  /\b(vite|next|nuxt|astro|remix-dev|serve|servor|http-server|live-server|nodemon|ts-node-dev|storybook)\b/,
  /\btsx\s+watch\b/,
  /\bwrangler\s+dev\b/,
];

function isLongRunningCommand(command: string): boolean {
  return LONG_RUNNING_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

/**
 * Patterns that match dependency install commands. These are non-destructive
 * and are a hard prerequisite for any dev server, so they are safe to run
 * without manual confirmation.
 */
const INSTALL_COMMAND_PATTERNS = [
  /\b(npm|pnpm|yarn|bun)\s+(install|ci|i|add)\b/,

  // bare `yarn` / `pnpm` with no arguments also performs an install
  /^\s*(yarn|pnpm)\s*$/,
];

/**
 * Decides whether a shell action is safe to execute without manual
 * confirmation. Dependency installs and long-running dev servers auto-run
 * because both are required for the preview to come up; everything else —
 * especially anything potentially destructive — still requires the user to
 * click "Run command".
 */
export function shouldAutoRunCommand(command: string): boolean {
  return isLongRunningCommand(command) || INSTALL_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

export class ActionRunner {
  #webcontainer: Promise<WebContainer>;
  #currentExecutionPromise: Promise<void> = Promise.resolve();

  actions: ActionsMap = map({});

  constructor(webcontainerPromise: Promise<WebContainer>) {
    this.#webcontainer = webcontainerPromise;
  }

  addAction(data: ActionCallbackData) {
    const { actionId } = data;

    const actions = this.actions.get();
    const action = actions[actionId];

    if (action) {
      // action already added
      return;
    }

    const abortController = new AbortController();

    this.actions.setKey(actionId, {
      ...data.action,
      status: 'pending',
      executed: false,
      abort: () => {
        abortController.abort();
        this.#updateAction(actionId, { status: 'aborted' });
      },
      abortSignal: abortController.signal,
    });

    /**
     * Shell actions stay pending until the user explicitly confirms them via
     * runAction (see useMessageParser / Artifact), so only file actions are
     * optimistically marked as running here.
     */
    if (data.action.type !== 'shell') {
      this.#currentExecutionPromise.then(() => {
        this.#updateAction(actionId, { status: 'running' });
      });
    }
  }

  async runAction(data: ActionCallbackData) {
    const { actionId } = data;
    const action = this.actions.get()[actionId];

    if (!action) {
      unreachable(`Action ${actionId} not found`);
    }

    if (action.executed) {
      return;
    }

    this.#updateAction(actionId, { ...action, ...data.action, executed: true });

    this.#currentExecutionPromise = this.#currentExecutionPromise
      .then(() => {
        return this.#executeAction(actionId);
      })
      .catch((error) => {
        console.error('Action failed:', error);
      });
  }

  abortAllActions() {
    const actions = this.actions.get();

    for (const action of Object.values(actions)) {
      if (action.status === 'running' || action.status === 'pending') {
        action.abort();
      }
    }
  }

  async #executeAction(actionId: string) {
    const action = this.actions.get()[actionId];

    this.#updateAction(actionId, { status: 'running' });

    try {
      switch (action.type) {
        case 'shell': {
          await this.#runShellAction(action);
          break;
        }
        case 'file': {
          await this.#runFileAction(action);
          break;
        }
      }

      this.#updateAction(actionId, { status: action.abortSignal.aborted ? 'aborted' : 'complete' });
    } catch (error) {
      this.#updateAction(actionId, { status: 'failed', error: 'Action failed' });

      // re-throw the error to be caught in the promise chain
      throw error;
    }
  }

  async #runShellAction(action: ActionState) {
    if (action.type !== 'shell') {
      unreachable('Expected shell action');
    }

    const webcontainer = await this.#webcontainer;

    const process = await webcontainer.spawn('jsh', ['-c', action.content], {
      env: { npm_config_yes: true },
    });

    action.abortSignal.addEventListener('abort', () => {
      process.kill();
    });

    // keep a rolling tail of the output so failures can be reported with context
    let outputBuffer = '';

    process.output.pipeTo(
      new WritableStream({
        write(data) {
          console.log(data);
          outputBuffer = (outputBuffer + data).slice(-OUTPUT_BUFFER_LIMIT);
        },
      }),
    );

    if (isLongRunningCommand(action.content)) {
      /**
       * Long-running commands (dev servers, watchers) never exit on their own.
       * Awaiting `process.exit` here would block the action queue forever, so
       * we keep streaming output in the background and return immediately,
       * allowing subsequent actions (file writes, installs, etc.) to run.
       *
       * If the process DOES exit later with a non-zero code (e.g. the dev
       * server crashed at startup), report it to the error monitor so the
       * self-healing loop can pick it up.
       */
      logger.debug('Detected long-running command, not awaiting exit:', action.content);

      process.exit.then((exitCode) => {
        if (exitCode !== 0 && !action.abortSignal.aborted) {
          errorMonitorStore.reportError({
            source: 'shell',
            title: `Command failed: ${action.content}`,
            detail: `The dev server / watch process exited with code ${exitCode}.\n\nOutput:\n${outputBuffer}`,
          });
        }
      });

      return;
    }

    const exitCode = await process.exit;

    logger.debug(`Process terminated with code ${exitCode}`);

    if (exitCode !== 0 && !action.abortSignal.aborted) {
      errorMonitorStore.reportError({
        source: 'shell',
        title: `Command failed: ${action.content}`,
        detail: `The command exited with code ${exitCode}.\n\nOutput:\n${outputBuffer}`,
      });

      throw new Error(`Command exited with code ${exitCode}`);
    }
  }

  async #runFileAction(action: ActionState) {
    if (action.type !== 'file') {
      unreachable('Expected file action');
    }

    const webcontainer = await this.#webcontainer;

    // guard against path traversal: only relative paths that stay inside the webcontainer workdir are allowed
    const filePath = nodePath.normalize(action.filePath);

    if (nodePath.isAbsolute(filePath) || filePath.split(/[\\/]+/).includes('..')) {
      logger.error(`Skipping file action with unsafe file path: ${action.filePath}`);

      return;
    }

    let folder = nodePath.dirname(filePath);

    // remove trailing slashes
    folder = folder.replace(/\/+$/g, '');

    if (folder !== '.') {
      try {
        await webcontainer.fs.mkdir(folder, { recursive: true });
        logger.debug('Created folder', folder);
      } catch (error) {
        logger.error('Failed to create folder\n\n', error);
      }
    }

    try {
      await webcontainer.fs.writeFile(filePath, action.content);
      logger.debug(`File written ${filePath}`);
    } catch (error) {
      logger.error('Failed to write file\n\n', error);

      errorMonitorStore.reportError({
        source: 'file-write',
        title: `Failed to write file: ${filePath}`,
        detail: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  #updateAction(id: string, newState: ActionStateUpdate) {
    const actions = this.actions.get();

    this.actions.setKey(id, { ...actions[id], ...newState });
  }
}
