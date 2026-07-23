import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuth } from '@clerk/remix/ssr.server';
import type { Message } from 'ai';

/**
 * Server-side chat persistence on Cloudflare D1.
 *
 * This module is the ONLY place that talks to the `chats` table. Route
 * handlers in `api.chats.ts` / `api.chats.$id.ts` stay thin and delegate here.
 */

export interface ChatPayload {
  id: string;
  urlId?: string;
  description?: string;
  messages: Message[];
  timestamp: string;
}

/** Shape returned to the client (mirrors `ChatHistoryItem` on the client). */
export interface ServerChatItem {
  id: string;
  urlId?: string;
  description?: string;
  messages: Message[];
  timestamp: string;
}

interface ChatRow {
  id: string;
  url_id: string | null;
  description: string | null;
  messages: string;
  timestamp: string;
}

export interface SyncContext {
  db: D1Database;
  userId: string;
}

/**
 * Resolves the D1 binding + authenticated Clerk user for a request.
 *
 * Returns a ready-to-return `Response` (503/401) when sync is unavailable so
 * the client can silently fall back to IndexedDB-only persistence:
 *  - 503 `database_not_configured` — the DB binding is not wired up yet
 *  - 401 `auth_not_configured`     — Clerk keys are missing (app runs without auth)
 *  - 401 `unauthorized`            — the visitor is signed out
 */
export async function resolveSyncContext(
  args: LoaderFunctionArgs | ActionFunctionArgs,
): Promise<SyncContext | Response> {
  const env = args.context.cloudflare.env;

  if (!env.DB) {
    return json({ error: 'database_not_configured' }, { status: 503 });
  }

  const publishableKey = env.CLERK_PUBLISHABLE_KEY;
  const secretKey = env.CLERK_SECRET_KEY;

  if (!publishableKey || !secretKey) {
    return json({ error: 'auth_not_configured' }, { status: 401 });
  }

  const { userId } = await getAuth(args, { secretKey });

  if (!userId) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }

  return { db: env.DB, userId };
}

/** Validates an untrusted request body into a `ChatPayload` (no schema dep). */
export function parseChatPayload(data: unknown): ChatPayload | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }

  const { id, urlId, description, messages, timestamp } = data as Record<string, unknown>;

  if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
    return undefined;
  }

  if (!Array.isArray(messages)) {
    return undefined;
  }

  if (typeof timestamp !== 'string' || timestamp.length === 0) {
    return undefined;
  }

  return {
    id,
    urlId: typeof urlId === 'string' ? urlId : undefined,
    description: typeof description === 'string' ? description : undefined,
    messages: messages as Message[],
    timestamp,
  };
}

function rowToItem(row: ChatRow): ServerChatItem {
  let messages: Message[] = [];

  try {
    messages = JSON.parse(row.messages) as Message[];
  } catch {
    messages = [];
  }

  return {
    id: row.id,
    urlId: row.url_id ?? undefined,
    description: row.description ?? undefined,
    messages,
    timestamp: row.timestamp,
  };
}

export async function listChats(db: D1Database, userId: string): Promise<ServerChatItem[]> {
  const { results } = await db
    .prepare(
      'SELECT id, url_id, description, messages, timestamp FROM chats WHERE user_id = ? ORDER BY updated_at DESC',
    )
    .bind(userId)
    .all<ChatRow>();

  return (results ?? []).map(rowToItem);
}

/** Finds a chat by its internal id OR its shareable url id (owner-scoped). */
export async function getChat(db: D1Database, userId: string, idOrUrlId: string): Promise<ServerChatItem | undefined> {
  const row = await db
    .prepare(
      'SELECT id, url_id, description, messages, timestamp FROM chats WHERE user_id = ? AND (id = ? OR url_id = ?) LIMIT 1',
    )
    .bind(userId, idOrUrlId, idOrUrlId)
    .first<ChatRow>();

  return row ? rowToItem(row) : undefined;
}

export async function upsertChat(db: D1Database, userId: string, chat: ChatPayload): Promise<void> {
  await db
    .prepare(
      `INSERT INTO chats (user_id, id, url_id, description, messages, timestamp, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT (user_id, id) DO UPDATE SET
         url_id      = excluded.url_id,
         description = excluded.description,
         messages    = excluded.messages,
         timestamp   = excluded.timestamp,
         updated_at  = excluded.updated_at`,
    )
    .bind(userId, chat.id, chat.urlId ?? null, chat.description ?? null, JSON.stringify(chat.messages), chat.timestamp)
    .run();
}

export async function deleteChat(db: D1Database, userId: string, id: string): Promise<void> {
  await db.prepare('DELETE FROM chats WHERE user_id = ? AND id = ?').bind(userId, id).run();
}
