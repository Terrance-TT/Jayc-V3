import { useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import {
  authCheckedStore,
  authUserStore,
  fetchAuthUser,
  loginWithGoogleCredential,
  logout,
} from '~/lib/stores/auth';

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

interface GoogleCredentialResponse {
  credential: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

let gisScriptPromise: Promise<void> | undefined;

function loadGisScript(): Promise<void> {
  if (!gisScriptPromise) {
    gisScriptPromise = new Promise<void>((resolve, reject) => {
      if (window.google) {
        resolve();

        return;
      }

      const script = document.createElement('script');
      script.src = GIS_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load the Google sign-in script.'));
      document.head.appendChild(script);
    });
  }

  return gisScriptPromise;
}

/**
 * Self-contained Google SSO control for the header.
 * - Renders nothing when GOOGLE_CLIENT_ID is not configured on the server.
 * - Shows the official "Sign in with Google" button when logged out.
 * - Shows the user's avatar + a sign-out button when logged in.
 */
export function GoogleAuthButton() {
  const user = useStore(authUserStore);
  const authChecked = useStore(authCheckedStore);
  const [clientId, setClientId] = useState<string | null>(null);
  const [configChecked, setConfigChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchAuthUser();

    fetch('/api/auth/config')
      .then(async (response) => (await response.json()) as { clientId: string | null })
      .then((data) => {
        setClientId(data.clientId);
        setConfigChecked(true);
      })
      .catch(() => {
        setClientId(null);
        setConfigChecked(true);
      });
  }, []);

  useEffect(() => {
    if (!clientId || !authChecked || user) {
      return;
    }

    let cancelled = false;

    loadGisScript()
      .then(() => {
        if (cancelled || !window.google || !buttonRef.current) {
          return;
        }

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            loginWithGoogleCredential(response.credential).catch(() => {
              setError('Sign-in failed. Please try again.');
            });
          },
        });

        buttonRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: 'outline',
          size: 'medium',
          type: 'standard',
          shape: 'pill',
          text: 'signin_with',
        });
      })
      .catch(() => {
        if (!cancelled) {
          setError('Google sign-in could not be loaded.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, authChecked, user]);

  // SSO not configured for this deployment — keep the header unchanged.
  if (!configChecked || !clientId) {
    return null;
  }

  if (user) {
    return (
      <div className="flex items-center gap-3">
        {user.picture ? (
          <img
            src={user.picture}
            alt={user.name}
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-full border border-bolt-elements-borderColor"
            title={user.email}
          />
        ) : null}
        <button
          onClick={() => {
            void logout();
          }}
          className="text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div ref={buttonRef} />
      {error ? <span className="text-xs text-bolt-elements-textSecondary">{error}</span> : null}
    </div>
  );
}
