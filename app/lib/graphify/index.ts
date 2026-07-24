import type { MapStore } from 'nanostores';
import type { FileMap } from '~/lib/stores/files';
import { GraphifyStore } from './store';
import type { GraphSnapshot } from './types';

let instance: GraphifyStore | undefined;

/**
 * Idempotent singleton init. Safe to call on every render/effect — only the
 * first call has any effect.
 */
export function initGraphify(filesStore: MapStore<FileMap>): void {
  if (instance) {
    return;
  }

  instance = new GraphifyStore(filesStore);
}

/**
 * The current serialized project graph snapshot. Returns an empty string
 * when graphify was not initialized or the graph is empty.
 */
export function getGraphSnapshot(): GraphSnapshot {
  return instance?.getSnapshot() ?? '';
}

export type { GraphSnapshot };
