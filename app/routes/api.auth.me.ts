import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getSessionUser } from '~/lib/.server/auth/session';

/** GET /api/auth/me — returns the signed-in user from the session cookie, or null. */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const user = await getSessionUser(request, context.cloudflare.env.SESSION_SECRET);

  return json({ user });
}
