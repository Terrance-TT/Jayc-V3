import { atom } from 'nanostores';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export const authUserStore = atom<AuthUser | null>(null);
export const authCheckedStore = atom<boolean>(false);

/** Loads the current session user (called once on app mount from the auth button). */
export async function fetchAuthUser(): Promise<void> {
  try {
    const response = await fetch('/api/auth/me');
    const data = (await response.json()) as { user: AuthUser | null };

    authUserStore.set(data.user);
  } catch {
    authUserStore.set(null);
  } finally {
    authCheckedStore.set(true);
  }
}

/** Exchanges a Google ID token (credential) for a server session. Throws on failure. */
export async function loginWithGoogleCredential(credential: string): Promise<void> {
  const response = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });

  if (!response.ok) {
    throw new Error(`Google sign-in failed (HTTP ${response.status})`);
  }

  const data = (await response.json()) as { user: AuthUser };

  authUserStore.set(data.user);
  authCheckedStore.set(true);
}

/** Clears the server session and resets the local auth state. */
export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    authUserStore.set(null);
  }
}
