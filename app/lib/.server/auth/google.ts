import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface GoogleUser {
  id: string; // Google's stable unique user id (the "sub" claim)
  email: string;
  name: string;
  picture?: string;
}

interface GoogleIdTokenPayload {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
}

const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

// jose caches Google's public keys and rotates them automatically.
const googleJWKS = createRemoteJWKSet(GOOGLE_JWKS_URL);

/**
 * Verifies a Google ID token (the "credential" returned by the Sign in with Google button)
 * against Google's public keys. Throws if the token is invalid, expired, or was not issued
 * for this application's client id.
 */
export async function verifyGoogleCredential(clientId: string, credential: string): Promise<GoogleUser> {
  const { payload } = await jwtVerify<GoogleIdTokenPayload>(credential, googleJWKS, {
    issuer: GOOGLE_ISSUERS,
    audience: clientId,
  });

  if (!payload.sub || !payload.email) {
    throw new Error('Google ID token is missing required claims (sub/email).');
  }

  const user: GoogleUser = {
    id: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email,
  };

  if (payload.picture) {
    user.picture = payload.picture;
  }

  return user;
}
