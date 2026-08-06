import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createClerkClient } from '@clerk/remix/api.server';
import { resolveSyncContext } from '~/lib/.server/db/chats.server';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('FeedbackAction');

/**
 * The sender's sign-in email, looked up from Clerk so the feedback dialog
 * never asks for it. Best-effort: returns null when the lookup fails (the
 * feedback itself must never fail because of this).
 */
async function resolveUserEmail(secretKey: string | undefined, userId: string): Promise<string | null> {
  if (!secretKey) {
    return null;
  }

  try {
    const user = await createClerkClient({ secretKey }).users.getUser(userId);
    const primary = user.emailAddresses.find((entry) => entry.id === user.primaryEmailAddressId);

    return (primary ?? user.emailAddresses[0])?.emailAddress ?? null;
  } catch (error) {
    logger.warn(`email lookup failed for user ${userId}:`, error);
    return null;
  }
}

const MAX_MESSAGE_LENGTH = 4_000;
const MAX_EMAIL_LENGTH = 254;
const MAX_CHAT_ID_LENGTH = 64;
const MAX_PROJECT_LENGTH = 400_000;
const MAX_USER_AGENT_LENGTH = 300;
const ADMIN_LIST_LIMIT = 100;

/**
 * POST /api/feedback — store one feedback entry with the user's project
 * attached (signed-in users only, same auth+D1 context as api.chats).
 *
 * GET /api/feedback?key=… — owner-only review. With &id=… returns one full
 * entry including the project JSON; otherwise lists the newest entries.
 * Gated by the FEEDBACK_ADMIN_KEY env var (404 when unset).
 */
export async function action(args: ActionFunctionArgs) {
  const ctx = await resolveSyncContext(args);

  if (ctx instanceof Response) {
    return ctx;
  }

  if (args.request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, { status: 405 });
  }

  let body: unknown;

  try {
    body = await args.request.json();
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 });
  }

  const { message, email, chatId, project } = (body ?? {}) as Record<string, unknown>;

  const cleanMessage = typeof message === 'string' ? message.trim() : '';

  if (cleanMessage.length === 0 || cleanMessage.length > MAX_MESSAGE_LENGTH) {
    return json({ error: 'invalid_message' }, { status: 400 });
  }

  // the sign-in email wins; the body's field only remains as a fallback
  const clerkEmail = await resolveUserEmail(args.context.cloudflare.env.CLERK_SECRET_KEY, ctx.userId);
  const bodyEmail =
    typeof email === 'string' && email.trim().length > 0 && email.length <= MAX_EMAIL_LENGTH ? email.trim() : null;
  const cleanEmail = clerkEmail ?? bodyEmail;
  const cleanChatId = typeof chatId === 'string' && chatId.length <= MAX_CHAT_ID_LENGTH ? chatId : null;
  const cleanProject = typeof project === 'string' && project.length > 0 ? project : null;

  if (cleanProject && cleanProject.length > MAX_PROJECT_LENGTH) {
    return json({ error: 'project_too_large' }, { status: 413 });
  }

  const id = crypto.randomUUID();
  const userAgent = (args.request.headers.get('user-agent') ?? '').slice(0, MAX_USER_AGENT_LENGTH) || null;

  await ctx.db
    .prepare(
      'INSERT INTO feedback (id, user_id, message, email, chat_id, project, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(id, ctx.userId, cleanMessage, cleanEmail, cleanChatId, cleanProject, userAgent)
    .run();

  logger.info(`feedback ${id} from user ${ctx.userId} (project: ${cleanProject ? 'attached' : 'none'})`);

  return json({ ok: true, id });
}

export async function loader(args: LoaderFunctionArgs) {
  const env = args.context.cloudflare.env;
  const url = new URL(args.request.url);

  if (!env.FEEDBACK_ADMIN_KEY || url.searchParams.get('key') !== env.FEEDBACK_ADMIN_KEY) {
    return new Response('Not found', { status: 404 });
  }

  if (!env.DB) {
    return json({ error: 'database_not_configured' }, { status: 503 });
  }

  const id = url.searchParams.get('id');

  if (id) {
    const row = await env.DB.prepare('SELECT * FROM feedback WHERE id = ?').bind(id).first();

    return row ? json(row) : new Response('Not found', { status: 404 });
  }

  const { results } = await env.DB.prepare(
    `SELECT id, user_id, email, chat_id, substr(message, 1, 200) AS message_preview,
            project IS NOT NULL AS has_project, user_agent, created_at
     FROM feedback ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(ADMIN_LIST_LIMIT)
    .all();

  return json({ feedback: results });
}
