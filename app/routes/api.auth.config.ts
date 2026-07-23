import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';

/**
 * GET /api/auth/config
 * Returns the public Google OAuth client id so the client can render the
 * "Sign in with Google" button. Returns null when SSO is not configured,
 * which tells the UI to hide the button entirely.
 */
export async function loader({ context }: LoaderFunctionArgs) {
  const clientId = context.cloudflare.env.GOOGLE_CLIENT_ID ?? null;

  return json({ clientId });
}
