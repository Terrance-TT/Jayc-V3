import { useRouteLoaderData } from '@remix-run/react';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/remix';

interface RootLoaderData {
  clerkState?: unknown;
}

/**
 * Clerk auth controls for the header.
 * - Renders nothing when the Clerk keys are not configured on the server.
 * - Shows a "Sign in" button (Clerk modal) when signed out.
 * - Shows Clerk's user avatar menu (profile / sign out) when signed in.
 */
export function ClerkAuthButtons() {
  const rootData = useRouteLoaderData<RootLoaderData>('root');

  if (!rootData?.clerkState) {
    return null;
  }

  return (
    <div className="flex items-center gap-3">
      <SignedOut>
        <SignInButton mode="modal">
          <button className="flex items-center px-3 py-1.5 rounded-md text-sm font-medium bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent hover:opacity-90 transition-opacity">
            Sign in
          </button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <UserButton />
      </SignedIn>
    </div>
  );
}
