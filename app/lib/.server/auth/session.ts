import { SignJWT, jwtVerify } from 'jose';

import type { GoogleUser } from './google';

export const SESSION_COOKIE_NAME = 'jayc_session';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** Creates a signed session token (HS256 JWT) carrying the user's profile. */
export async function createSessionToken(secret: string, user: GoogleUser): Promise<string> {
  return new SignJWT({ user })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecretKey(secret));
}

/** Returns the session user from a request's cookie, or null when absent/invalid. */
export async function getSessionUser(request: Request, secret: string | undefined): Promise<GoogleUser | null> {
  if (!secret) {
    return null;
  }

  const token = getSessionTokenFromRequest(request);

  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify<{ user: GoogleUser }>(token, getSecretKey(secret));

    return payload.user ?? null;
  } catch {
    return null;
  }
}

function getSessionTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie');

  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(';')) {
    const [name, ...valueParts] = part.trim().split('=');

    if (name === SESSION_COOKIE_NAME) {
      return valueParts.join('=');
    }
  }

  return null;
}

/** Builds the Set-Cookie value that stores the session token. */
export function buildSessionCookie(token: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];

  if (secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/** Builds the Set-Cookie value that immediately expires the session. */
export function buildLogoutCookie(secure: boolean): string {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];

  if (secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}
