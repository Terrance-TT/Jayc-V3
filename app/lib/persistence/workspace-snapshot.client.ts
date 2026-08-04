import type { FileSystemTree } from '@webcontainer/api';
import { webcontainer } from '~/lib/webcontainer';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('WorkspaceSnapshot');

const DB_NAME = 'jayc-workspace-snapshots';
const STORE_NAME = 'snapshots';
const MAX_SNAPSHOT_BYTES = 300 * 1024 * 1024;
const READ_CONCURRENCY = 25;

/**
 * Workspace snapshots: the whole WebContainer filesystem (node_modules
 * included) exported to IndexedDB per chat, so reopening a project mounts
 * one tree instead of replaying every artifact action — no file rewrites,
 * no npm reinstall. Snapshots are per-browser; chats synced from another
 * device fall back to the classic action replay.
 */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Reads the whole workspace into a mountable FileSystemTree. Returns
 * undefined when the workspace exceeds the size guard — a partial snapshot
 * would restore a broken project, so we keep none at all.
 */
async function exportWorkspace(): Promise<FileSystemTree | undefined> {
  const container = await webcontainer;

  let bytes = 0;
  let tooBig = false;

  const readDir = async (dir: string): Promise<FileSystemTree> => {
    const entries = await container.fs.readdir(dir, { withFileTypes: true });
    const tree: FileSystemTree = {};

    for (let i = 0; i < entries.length; i += READ_CONCURRENCY) {
      await Promise.all(
        entries.slice(i, i + READ_CONCURRENCY).map(async (entry) => {
          if (tooBig) {
            return;
          }

          const path = `${dir}/${entry.name}`;

          if (entry.isDirectory()) {
            tree[entry.name] = { directory: await readDir(path) };
          } else if (entry.isFile()) {
            const contents = await container.fs.readFile(path);

            bytes += contents.byteLength;

            if (bytes > MAX_SNAPSHOT_BYTES) {
              tooBig = true;
              return;
            }

            tree[entry.name] = { file: { contents } };
          }
        }),
      );
    }

    return tree;
  };

  const tree = await readDir('.');

  if (tooBig) {
    logger.warn(`snapshot skipped: workspace exceeds ${MAX_SNAPSHOT_BYTES / 1024 / 1024}MB`);
    return undefined;
  }

  return tree;
}

export async function saveWorkspaceSnapshot(chatId: string): Promise<void> {
  try {
    const tree = await exportWorkspace();

    if (!tree) {
      return;
    }

    const db = await openDb();

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');

      tx.objectStore(STORE_NAME).put(tree, chatId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    logger.info(`workspace snapshot saved for chat ${chatId}`);
  } catch (error) {
    logger.error('failed to save workspace snapshot', error);
  }
}

export async function loadWorkspaceSnapshot(chatId: string): Promise<FileSystemTree | undefined> {
  try {
    const db = await openDb();

    return await new Promise<FileSystemTree | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(chatId);

      request.onsuccess = () => resolve(request.result as FileSystemTree | undefined);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    logger.error('failed to load workspace snapshot', error);
    return undefined;
  }
}

/**
 * After a snapshot mount, bring the preview back up: spawn the project's
 * dev server in the background (same pattern as the action runner — output
 * is logged, exit never awaited). No-op for projects without a dev script.
 */
export async function startWorkspaceDevServer(): Promise<void> {
  try {
    const container = await webcontainer;
    const pkg = JSON.parse(await container.fs.readFile('package.json', 'utf-8')) as {
      scripts?: Record<string, string>;
    };

    if (!pkg.scripts?.dev) {
      return;
    }

    const process = await container.spawn('npm', ['run', 'dev']);

    process.output.pipeTo(
      new WritableStream({
        write(data) {
          logger.debug(data);
        },
      }),
    );
  } catch (error) {
    logger.error('failed to start dev server after snapshot restore', error);
  }
}
