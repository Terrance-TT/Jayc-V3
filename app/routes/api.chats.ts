import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { listChats, parseChatPayload, resolveSyncContext, upsertChat } from '~/lib/.server/db/chats.server';

/**
 * GET  /api/chats — list the signed-in user's chats (newest first)
 * PUT  /api/chats — create or update one chat  { id, urlId?, description?, messages, timestamp }
 *
 * All responses are scoped to the authenticated Clerk user. When auth or the
 * D1 binding is not configured, this route answers 401/503 and the client
 * silently keeps using IndexedDB only.
 */
export async function loader(args: LoaderFunctionArgs) {
  const ctx = await resolveSyncContext(args);

  if (ctx instanceof Response) {
    return ctx;
  }

  const chats = await listChats(ctx.db, ctx.userId);

  return json({ chats });
}

export async function action(args: ActionFunctionArgs) {
  const ctx = await resolveSyncContext(args);

  if (ctx instanceof Response) {
    return ctx;
  }

  if (args.request.method !== 'PUT' && args.request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, { status: 405 });
  }

  let body: unknown;

  try {
    body = await args.request.json();
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 });
  }

  const payload = parseChatPayload(body);

  if (!payload) {
    return json({ error: 'invalid_payload' }, { status: 400 });
  }

  await upsertChat(ctx.db, ctx.userId, payload);

  return json({ ok: true });
}
