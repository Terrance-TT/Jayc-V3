import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { deleteChat, getChat, resolveSyncContext } from '~/lib/.server/db/chats.server';

/**
 * GET    /api/chats/:id — fetch one chat by internal id OR shareable url id
 * DELETE /api/chats/:id — delete one chat (owner-scoped)
 */
export async function loader(args: LoaderFunctionArgs) {
  const ctx = await resolveSyncContext(args);

  if (ctx instanceof Response) {
    return ctx;
  }

  const id = args.params.id;

  if (!id) {
    return json({ error: 'missing_id' }, { status: 400 });
  }

  const chat = await getChat(ctx.db, ctx.userId, id);

  if (!chat) {
    return json({ error: 'not_found' }, { status: 404 });
  }

  return json({ chat });
}

export async function action(args: ActionFunctionArgs) {
  const ctx = await resolveSyncContext(args);

  if (ctx instanceof Response) {
    return ctx;
  }

  if (args.request.method !== 'DELETE') {
    return json({ error: 'method_not_allowed' }, { status: 405 });
  }

  const id = args.params.id;

  if (!id) {
    return json({ error: 'missing_id' }, { status: 400 });
  }

  await deleteChat(ctx.db, ctx.userId, id);

  return json({ ok: true });
}
