import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { getAuth } from '@clerk/remix/ssr.server';
import { searchFacts } from '~/lib/.server/fact-check/search';

const MAX_QUERY_LENGTH = 500;

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

export async function action(args: ActionFunctionArgs) {
  const userId = await resolveUserId(args);

  if (!userId) {
    return new Response(
      JSON.stringify({ error: 'auth_required', message: 'Please sign in to use fact-check.' }),
      { status: 401, headers: JSON_HEADERS },
    );
  }

  const apiKey = args.context.cloudflare.env.TAVILY_API_KEY;

  if (!apiKey) {
    // the feature is dormant until the key is configured
    return new Response(
      JSON.stringify({ error: 'not_configured', message: 'Fact-check is not configured on this deployment yet.' }),
      { status: 501, headers: JSON_HEADERS },
    );
  }

  const body = await args.request.json<{ query?: unknown }>().catch(() => ({ query: undefined }));

  if (typeof body.query !== 'string' || body.query.trim().length === 0 || body.query.length > MAX_QUERY_LENGTH) {
    return new Response(JSON.stringify({ error: 'bad_request', message: 'A query string is required.' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const facts = await searchFacts(body.query.trim(), apiKey);

  if (!facts) {
    return new Response(JSON.stringify({ error: 'no_results', message: 'No reference facts found for this topic.' }), {
      status: 404,
      headers: JSON_HEADERS,
    });
  }

  return new Response(JSON.stringify({ facts }), { status: 200, headers: JSON_HEADERS });
}

/**
 * Mirrors the auth gate used by api.chat.ts: resolves the authenticated
 * Clerk user with the secret key from the Cloudflare env.
 */
async function resolveUserId(args: ActionFunctionArgs): Promise<string | null> {
  const env = args.context.cloudflare.env;

  const publishableKey = env.CLERK_PUBLISHABLE_KEY;
  const secretKey = env.CLERK_SECRET_KEY;

  if (!publishableKey || !secretKey) {
    return null;
  }

  const { userId } = await getAuth(args, { secretKey });

  return userId;
}
