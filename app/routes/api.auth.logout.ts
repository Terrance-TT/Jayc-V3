import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { buildLogoutCookie } from '~/lib/.server/auth/session';

/** POST /api/auth/logout — clears the session cookie. */
export async function action({ request }: ActionFunctionArgs) {
  const secure = new URL(request.url).protocol === 'https:';

  return json({ ok: true }, { headers: { 'Set-Cookie': buildLogoutCookie(secure) } });
}
