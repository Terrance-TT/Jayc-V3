import { atom } from 'nanostores';
import type { WebContainerProcess } from '@webcontainer/api';
import { webcontainer } from '~/lib/webcontainer';
import { createScopedLogger } from '~/utils/logger';
import { workbenchStore } from './workbench';

const logger = createScopedLogger('DevServer');

export type DevServerStatus = 'idle' | 'starting' | 'running' | 'error';

const MAX_AUTO_RESTARTS = 1;

// how long to wait for the model's own dev server to open a port before spawning ours
const PORT_GRACE_MS = 15_000;

/**
 * Dev-server supervisor: owns the lifecycle that used to require the
 * terminal. Watches the action runners, and once an artifact's queue has
 * drained makes sure a dev server is actually coming up — spawning
 * `npm run dev` itself when the model didn't, restarting once when the
 * server dies unexpectedly, and surfacing an explicit error state (with a
 * Restart button in the preview) when it dies again.
 *
 * The model's own `npm run dev` shell action wins: after the queue drains
 * we wait PORT_GRACE_MS for a port to open before spawning a second
 * server, so we never fight it for the port.
 */
class DevServerStore {
  status = import.meta.hot?.data.devServerStatus ?? atom<DevServerStatus>('idle');

  #process: WebContainerProcess | undefined;
  #restarts = 0;
  #userStop = false;
  #initialized = false;

  constructor() {
    if (import.meta.hot) {
      import.meta.hot.data.devServerStatus = this.status;
    }
  }

  init() {
    if (this.#initialized) {
      return;
    }

    this.#initialized = true;

    const subscribedRunners = new WeakSet<object>();

    workbenchStore.artifacts.subscribe((artifacts) => {
      for (const artifact of Object.values(artifacts)) {
        if (subscribedRunners.has(artifact.runner)) {
          continue;
        }

        subscribedRunners.add(artifact.runner);
        artifact.runner.actions.subscribe(() => this.#onActionsChanged());
      }
    });

    workbenchStore.previews.subscribe((previews) => {
      const anyReady = previews.some((preview) => preview.ready);

      if (anyReady) {
        if (this.status.get() === 'starting') {
          this.status.set('running');
        }

        this.#restarts = 0;
      } else if (this.status.get() === 'running') {
        // the server that owned the port just died
        this.#handleUnexpectedStop();
      }
    });
  }

  /** Queue drained → make sure a dev server comes up. */
  #onActionsChanged() {
    const anyBusy = Object.values(workbenchStore.artifacts.get()).some((artifact) =>
      Object.values(artifact.runner.actions.get()).some(
        (action) => action.status === 'pending' || action.status === 'running',
      ),
    );

    if (!anyBusy) {
      void this.ensureRunning();
    }
  }

  /**
   * Spawns `npm run dev` when the project has a dev script and nothing is
   * serving yet. Idempotent: a live process, a starting one, or an open
   * port all make this a no-op. Safe to call from anywhere — the snapshot
   * restore path uses it as its only entry point.
   */
  async ensureRunning() {
    if (this.#process || this.status.get() === 'starting') {
      return;
    }

    const container = await webcontainer;

    let hasDevScript = false;

    try {
      const pkg = JSON.parse(await container.fs.readFile('package.json', 'utf-8')) as {
        scripts?: Record<string, string>;
      };

      hasDevScript = Boolean(pkg.scripts?.dev);
    } catch {
      // no package.json (yet) — nothing to supervise
      return;
    }

    if (!hasDevScript) {
      return;
    }

    // the model's own dev server may still be booting — give it the port first
    if (await this.#waitForPort()) {
      this.status.set('running');
      return;
    }

    await this.#spawn();
  }

  /** Manual restart from the preview's error state. */
  async restart() {
    this.#restarts = 0;
    this.#userStop = true;
    this.#process?.kill();
    this.#process = undefined;
    this.status.set('idle');
    await this.ensureRunning();
  }

  async #spawn() {
    this.status.set('starting');

    const container = await webcontainer;
    const process = await container.spawn('npm', ['run', 'dev']);

    this.#process = process;

    process.output.pipeTo(
      new WritableStream({
        write(data) {
          logger.debug(data);
        },
      }),
    );

    void process.exit.then(() => {
      this.#process = undefined;

      if (this.#userStop) {
        this.#userStop = false;

        if (this.status.get() !== 'error') {
          this.status.set('idle');
        }

        return;
      }

      // a port owned by a different server is open — nothing to do
      if (workbenchStore.previews.get().some((preview) => preview.ready)) {
        return;
      }

      this.#handleUnexpectedStop();
    });
  }

  #handleUnexpectedStop() {
    if (this.#restarts < MAX_AUTO_RESTARTS) {
      this.#restarts++;
      logger.warn('dev server stopped unexpectedly — restarting');
      this.status.set('idle');
      void this.#spawn();
    } else {
      logger.error('dev server died repeatedly — giving up, user can restart from the preview');
      this.status.set('error');
    }
  }

  /** Resolves true when a preview port opens, false after PORT_GRACE_MS. */
  #waitForPort(): Promise<boolean> {
    if (workbenchStore.previews.get().some((preview) => preview.ready)) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, PORT_GRACE_MS);

      const unsubscribe = workbenchStore.previews.subscribe((previews) => {
        if (previews.some((preview) => preview.ready)) {
          clearTimeout(timeout);
          unsubscribe();
          resolve(true);
        }
      });
    });
  }
}

export const devServerStore = new DevServerStore();
