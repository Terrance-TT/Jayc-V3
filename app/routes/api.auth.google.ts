import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { verifyGoogleCredential } from '~/lib/.server/auth/google';
import { buildSessionCookie, createSessionToken } from '~/lib/.server/auth/session';

/**
 * POST /api/auth/google
 * Body: { credential: string } — the ID token from the Google button.
 * Verifies it with Google, then sets an HttpOnly session cookie.
 */
export async function action({ context, request }: ActionFunctionArgs) {
  const env = context.cloudflare.env;

  if (!env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET) {
    return json({ error: 'Google sign-in is not configured on this deployment.' }, { status: 503 });
  }

  let credential: string | undefined;

  try {
    const body = await request.json<{ credential?: string }>();
    credential = body.credential;
  } catch {
    return json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!credential) {
    return json({ error: 'Missing Google credential.' }, { status: 400 });
  }

  try {
    const user = await verifyGoogleCredential(env.GOOGLE_CLIENT_ID, credential);
    const token = await createSessionToken(env.SESSION_SECRET, user);
    const secure = new URL(request.url).protocol === 'https:';

    return json({ user }, { headers: { 'Set-Cookie': buildSessionCookie(token, secure) } });
  } catch (error) {
    console.error('Google credential verification failed:', error);

    return json({ error: 'Google credential could not be verified.' }, { status: 401 });
  }
}
