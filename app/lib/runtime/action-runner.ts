import { WebContainer } from '@webcontainer/api';
import { map, type MapStore } from 'nanostores';
import * as nodePath from 'node:path';
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

export function isLongRunningCommand(command: string): boolean {
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

export function isInstallCommand(command: string): boolean {
  return INSTALL_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

/**
 * Patterns that match genuinely destructive commands. Shell actions come
 * from our own pipeline, so they auto-run by default — the user may never
 * see a terminal, and a command that sits pending means a broken app. Only
 * commands that can destroy data or escape the sandbox stay gated behind
 * the manual "Run command" button in the artifact.
 */
const DANGEROUS_COMMAND_PATTERNS = [
  /\bsudo\b/,

  // rm with recursive and/or force flags
  /\brm\s+(-\S*[rf]\S*\s)/,

  // piping a remote script straight into a shell
  /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/,

  // disk/device level operations
  /\bmkfs\b/,
  /\bdd\s+[^|]*\bof=\/dev\//,
  />\s*\/dev\/(sd|nvme|hd|mapper)/,

  // shutting down the container or its init
  /\b(shutdown|reboot|halt|poweroff)\b/,
  /\bkill\s+-?\d*\s*1\b/,
];

/**
 * Decides whether a shell action must wait for manual confirmation. The
 * default flipped from opt-in (only installs/dev servers auto-ran) to
 * opt-out (everything auto-runs except this denylist) so non-technical
 * users never have to find a "Run command" button to make their app work.
 */
export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

export class ActionRunner {
  #webcontainer: Promise<WebContainer>;
  #currentExecutionPromise: Promise<void> = Promise.resolve();

  /**
   * Package.json watcher: #packageJsonTouched is set when this artifact
   * writes a package.json; #installHandled flips once an install has run
   * (or is pending) so we never auto-install twice for one artifact. The
   * pair drives #maybeAutoInstall, which guarantees dependencies get
   * installed even when the model forgets the install action — a
   * non-technical user can't recover from "missing node_modules" alone.
   */
  #packageJsonTouched = false;
  #installHandled = false;

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

      if (action.type === 'shell' && isInstallCommand(action.content)) {
        this.#installHandled = true;
      }

      await this.#maybeAutoInstall();
    } catch (error) {
      this.#updateAction(actionId, { status: 'failed', error: 'Action failed' });

      // re-throw the error to be caught in the promise chain
      throw error;
    }
  }

  /**
   * Runs `npm install` when this artifact wrote a package.json but no
   * install command has run (or is about to run). Runs inside the execution
   * chain, so it is serialized with the model's own actions — a duplicate
   * install is a fast no-op, a missing one is a dead preview.
   */
  async #maybeAutoInstall() {
    if (!this.#packageJsonTouched || this.#installHandled) {
      return;
    }

    const installPending = Object.values(this.actions.get()).some(
      (action) =>
        action.type === 'shell' &&
        isInstallCommand(action.content) &&
        (action.status === 'pending' || action.status === 'running'),
    );

    if (installPending) {
      return;
    }

    this.#installHandled = true;
    logger.info('package.json written without an install action — running npm install automatically');

    const webcontainer = await this.#webcontainer;
    const process = await webcontainer.spawn('jsh', ['-c', 'npm install'], {
      env: { npm_config_yes: true },
    });

    process.output.pipeTo(
      new WritableStream({
        write(data) {
          logger.debug(data);
        },
      }),
    );

    const exitCode = await process.exit;

    if (exitCode !== 0) {
      // let a later action (or the dev-server supervisor's next cycle) retry
      this.#installHandled = false;
      logger.error(`automatic npm install exited with code ${exitCode}`);
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

    process.output.pipeTo(
      new WritableStream({
        write(data) {
          logger.debug(data);
        },
      }),
    );

    if (isLongRunningCommand(action.content)) {
      /**
       * Long-running commands (dev servers, watchers) never exit on their own.
       * Awaiting `process.exit` here would block the action queue forever, so
       * we keep streaming output in the background and return immediately,
       * allowing subsequent actions (file writes, installs, etc.) to run.
       */
      logger.debug('Detected long-running command, not awaiting exit:', action.content);

      return;
    }

    const exitCode = await process.exit;

    logger.debug(`Process terminated with code ${exitCode}`);

    if (exitCode !== 0 && !action.abortSignal.aborted) {
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

    if (nodePath.isAbsolute(filePath) || filePath.split(/[\/]+/).includes('..')) {
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

      if (filePath === 'package.json' || filePath.endsWith('/package.json')) {
        this.#packageJsonTouched = true;
      }
    } catch (error) {
      logger.error('Failed to write file\n\n', error);

      throw error;
    }
  }

  #updateAction(id: string, newState: ActionStateUpdate) {
    const actions = this.actions.get();

    this.actions.setKey(id, { ...actions[id], ...newState });
  }
}
