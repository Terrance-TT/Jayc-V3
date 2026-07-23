import { getAll, setMessages } from './db';
import type { ChatHistoryItem } from './useChatHistory';

/**
 * Best-effort server sync for chat history (Cloudflare D1 backend).
 *
 * Design rules:
 *  - NEVER throws and NEVER blocks the UI — IndexedDB stays the local cache
 *    and source of truth while offline.
 *  - When the server answers 401 (signed out / auth not configured) or 503
 *    (database not configured), sync latches OFF for the rest of the session
 *    so we don't spam failing requests. Signing in takes effect on reload.
 */

let serverAvailable: boolean | undefined;

async function request(input: string, init?: RequestInit): Promise<Response | undefined> {
  if (serverAvailable === false) {
    return undefined;
  }

  try {
    const response = await fetch(input, { credentials: 'same-origin', ...init });

    if (response.status === 401 || response.status === 503) {
      serverAvailable = false;

      return undefined;
    }

    if (!response.ok) {
      return undefined;
    }

    serverAvailable = true;

    return response;
  } catch {
    // offline / network error — stay quiet, IndexedDB still has the data
    return undefined;
  }
}

/** Push one chat (create or update) to the server. Fire-and-forget safe. */
export async function syncChatToServer(item: ChatHistoryItem): Promise<void> {
  await request('/api/chats', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
}

/** Pull the full chat list for the signed-in user, or `undefined` when unavailable. */
export async function fetchChatsFromServer(): Promise<ChatHistoryItem[] | undefined> {
  const response = await request('/api/chats');

  if (!response) {
    return undefined;
  }

  try {
    const data = (await response.json()) as { chats?: ChatHistoryItem[] };

    return data.chats;
  } catch {
    return undefined;
  }
}

/** Pull one chat by internal id or url id, or `undefined` when unavailable/missing. */
export async function fetchChatFromServer(idOrUrlId: string): Promise<ChatHistoryItem | undefined> {
  const response = await request(`/api/chats/${encodeURIComponent(idOrUrlId)}`);

  if (!response) {
    return undefined;
  }

  try {
    const data = (await response.json()) as { chat?: ChatHistoryItem };

    return data.chat;
  } catch {
    return undefined;
  }
}

/** Delete one chat on the server. Fire-and-forget safe. */
export async function deleteChatFromServer(id: string): Promise<void> {
  await request(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

let hydrationAttempted = false;

/**
 * One-time background pull that copies server-side chats into the local
 * IndexedDB cache.
 *
 * Besides making cross-device history available offline, this prevents id
 * collisions: `getNextId` derives new chat ids from local keys only, so
 * without hydration a second browser would reuse ids and overwrite another
 * device's chat on the server. Runs at most once per session, never throws.
 */
export async function hydrateLocalCacheFromServer(db: IDBDatabase): Promise<void> {
  if (hydrationAttempted) {
    return;
  }

  hydrationAttempted = true;

  const remote = await fetchChatsFromServer();

  if (!remote || remote.length === 0) {
    return;
  }

  try {
    const local = await getAll(db);
    const localIds = new Set(local.map((item) => item.id));

    await Promise.all(
      remote
        .filter((item) => !localIds.has(item.id))
        .map((item) => setMessages(db, item.id, item.messages, item.urlId, item.description).catch(() => undefined)),
    );
  } catch {
    // local cache unavailable — server data is still reachable via fetch helpers
  }
}
