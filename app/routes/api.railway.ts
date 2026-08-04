import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { getAuth } from '@clerk/remix/ssr.server';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('RailwayProxy');

const RAILWAY_GRAPHQL_URL = 'https://backboard.railway.app/graphql/v2';
const MAX_OPERATION_LENGTH = 10_000;

/**
 * Railway GraphQL proxy: the browser cannot call backboard.railway.app
 * directly (CORS), so deploy wizard operations tunnel through here. The
 * user's personal Railway token travels per request and is used in memory
 * only — never logged, never persisted server-side (same BYOK pattern as
 * api.chat.ts).
 */
export async function action(args: ActionFunctionArgs) {
  const env = args.context.cloudflare.env;

  if (!env.CLERK_PUBLISHABLE_KEY || !env.CLERK_SECRET_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { userId } = await getAuth(args, { secretKey: env.CLERK_SECRET_KEY });

  if (!userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = await args.request.json<{ token?: unknown; query?: unknown; variables?: unknown }>().catch(() => null);

  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const query = typeof body?.query === 'string' ? body.query : '';
  const variables = typeof body?.variables === 'object' && body.variables !== null ? body.variables : {};

  if (token.length < 8 || token.length > 256 || query.length === 0 || query.length > MAX_OPERATION_LENGTH) {
    return new Response('Bad Request', { status: 400 });
  }

  try {
    const upstream = await fetch(RAILWAY_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    const payload = await upstream.text();

    return new Response(payload, {
      status: upstream.status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  } catch (error) {
    logger.error('Railway upstream request failed', error);

    return new Response(JSON.stringify({ errors: [{ message: 'Could not reach the Railway API' }] }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
}
