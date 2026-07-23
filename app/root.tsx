import { useStore } from '@nanostores/react';
import { json, type LinksFunction, type LoaderFunction } from '@remix-run/cloudflare';
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from '@remix-run/react';
import { ClerkProvider } from '@clerk/remix';
import { rootAuthLoader } from '@clerk/remix/ssr.server';
import tailwindReset from '@unocss/reset/tailwind-compat.css?url';
import { themeStore } from './lib/stores/theme';
import { stripIndents } from './utils/stripIndent';
import { createHead } from 'remix-island';
import { useEffect, type ComponentProps } from 'react';

import reactToastifyStyles from 'react-toastify/dist/ReactToastify.css?url';
import globalStyles from './styles/index.scss?url';
import xtermStyles from '@xterm/xterm/css/xterm.css?url';

import 'virtual:uno.css';

type ClerkState = ComponentProps<typeof ClerkProvider>['clerkState'];

export const links: LinksFunction = () => [
  {
    rel: 'icon',
    href: '/favicon.svg',
    type: 'image/svg+xml',
  },
  { rel: 'stylesheet', href: reactToastifyStyles },
  { rel: 'stylesheet', href: tailwindReset },
  { rel: 'stylesheet', href: globalStyles },
  { rel: 'stylesheet', href: xtermStyles },
  {
    rel: 'preconnect',
    href: 'https://fonts.googleapis.com',
  },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
];

export const loader: LoaderFunction = (args) => {
  const publishableKey = args.context.cloudflare.env.CLERK_PUBLISHABLE_KEY ?? '';
  const secretKey = args.context.cloudflare.env.CLERK_SECRET_KEY ?? '';

  // Clerk is optional: when the keys are not configured, the app runs without auth.
  if (!publishableKey || !secretKey) {
    return json({});
  }

  return rootAuthLoader(args, () => ({}), { publishableKey, secretKey });
};

const inlineThemeCode = stripIndents`
  setTutorialKitTheme();

  function setTutorialKitTheme() {
    let theme = localStorage.getItem('bolt_theme');

    if (!theme) {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    document.querySelector('html')?.setAttribute('data-theme', theme);
  }
`;

export const Head = createHead(() => (
  <>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <Meta />
    <Links />
    <script dangerouslySetInnerHTML={{ __html: inlineThemeCode }} />
  </>
));

export function Layout({ children }: { children: React.ReactNode }) {
  const theme = useStore(themeStore);

  useEffect(() => {
    document.querySelector('html')?.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <>
      {children}
      <ScrollRestoration />
      <Scripts />
    </>
  );
}

export default function App() {
  const { clerkState } = useLoaderData<{ clerkState?: ClerkState }>();

  // Without configured Clerk keys there is no auth state — render the app as-is.
  if (!clerkState) {
    return <Outlet />;
  }

  return (
    <ClerkProvider clerkState={clerkState}>
      <Outlet />
    </ClerkProvider>
  );
}
