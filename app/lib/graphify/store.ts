import type { MapStore } from 'nanostores';
import type { FileMap } from '~/lib/stores/files';
import { createBareNode, extractNode, hashContent, isCodeFile } from './extract';
import { createGraph, removeNode, resolveEdges, upsertNode } from './graph';
import { serializeGraph } from './serialize';
import type { ProjectGraph } from './types';

const DEBOUNCE_MS = 300;

/**
 * Incrementally keeps a `ProjectGraph` in sync with the workbench files
 * store. Subscribes to the map (client-side only), diffs by content hash,
 * re-extracts only new/changed files, drops deleted ones and re-resolves
 * edges — debounced so bursts of watcher events only trigger one pass.
 */
export class GraphifyStore {
  #filesStore: MapStore<FileMap>;
  #graph: ProjectGraph = createGraph();
  #unsubscribe?: () => void;
  #timer?: ReturnType<typeof setTimeout>;
  #disposed = false;

  constructor(filesStore: MapStore<FileMap>) {
    this.#filesStore = filesStore;

    // SSR-safe: the module may be imported server-side, but the graph is
    // only ever built in the browser.
    if (typeof window !== 'undefined') {
      // nanostores `subscribe` fires immediately with the current value,
      // which also covers the initial sync.
      this.#unsubscribe = this.#filesStore.subscribe(() => this.#scheduleSync());
    }
  }

  getSnapshot(): string {
    return serializeGraph(this.#graph);
  }

  dispose(): void {
    this.#disposed = true;

    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }

    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  #scheduleSync() {
    if (this.#disposed) {
      return;
    }

    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
    }

    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#sync();
    }, DEBOUNCE_MS);
  }

  #sync() {
    const files = this.#filesStore.get();
    const seen = new Set<string>();
    let changed = false;

    for (const [path, dirent] of Object.entries(files)) {
      if (dirent === undefined || dirent.type !== 'file') {
        continue;
      }

      seen.add(path);

      const content = dirent.content ?? '';
      const existing = this.#graph.nodes.get(path);

      if (existing && existing.contentHash === hashContent(content)) {
        continue;
      }

      const node = isCodeFile(path) ? extractNode(path, content) : createBareNode(path, content);

      upsertNode(this.#graph, node);
      changed = true;
    }

    for (const path of [...this.#graph.nodes.keys()]) {
      if (!seen.has(path)) {
        removeNode(this.#graph, path);
        changed = true;
      }
    }

    if (changed) {
      resolveEdges(this.#graph);
    }
  }
}
