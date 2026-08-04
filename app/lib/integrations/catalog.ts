/**
 * Catalog of common app integrations for the Integrations panel. Providers
 * like Clerk and Stripe have no provisioning API (accounts and keys are
 * dashboard-only), so the panel's job is guided capture: exact click-path,
 * a deep link to the right dashboard page, and key fields whose values Jayc
 * writes into the project's .env automatically. Providers WITH management
 * APIs (Supabase projects, Railway deploys) can graduate to full automation
 * later via a proxy like api.railway.ts.
 */

export interface IntegrationKey {
  /** env var name written into .env */
  name: string;

  /** human label shown next to the field */
  label: string;

  /** true for secret keys (password field, server-side naming) */
  secret: boolean;
}

export interface IntegrationProvider {
  id: string;
  name: string;
  icon: string;

  /** one-line what-you-get */
  blurb: string;

  /** exact click-path to the keys, shown as numbered steps */
  steps: string[];

  /** deep link to the dashboard page holding the keys */
  dashboardUrl: string;

  keys: IntegrationKey[];
}

export const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  {
    id: 'clerk',
    name: 'Clerk',
    icon: 'i-ph:shield-check',
    blurb: 'Sign-in, sign-up, and user accounts.',
    steps: [
      'Create a free Clerk account',
      'Create an application (enable Email only — social logins use hosted redirects, which break in the preview)',
      'Open Configure → API keys and copy both keys below',
    ],
    dashboardUrl: 'https://dashboard.clerk.com/last-active?path=api-keys',
    keys: [
      { name: 'VITE_CLERK_PUBLISHABLE_KEY', label: 'Publishable key (pk_…)', secret: false },
      { name: 'CLERK_SECRET_KEY', label: 'Secret key (sk_…)', secret: true },
    ],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    icon: 'i-ph:credit-card',
    blurb: 'Payments, checkout, and subscriptions.',
    steps: [
      'Create a free Stripe account (test mode is fine)',
      'Open Developers → API keys',
      'Copy the publishable key and reveal + copy the secret key',
    ],
    dashboardUrl: 'https://dashboard.stripe.com/apikeys',
    keys: [
      { name: 'VITE_STRIPE_PUBLISHABLE_KEY', label: 'Publishable key (pk_…)', secret: false },
      { name: 'STRIPE_SECRET_KEY', label: 'Secret key (sk_…)', secret: true },
    ],
  },
  {
    id: 'supabase',
    name: 'Supabase',
    icon: 'i-ph:database',
    blurb: 'Hosted Postgres database and auth.',
    steps: [
      'Create a free Supabase account and a new project',
      'Open Project Settings → API',
      'Copy the Project URL and the anon public key',
    ],
    dashboardUrl: 'https://supabase.com/dashboard/project/_/settings/api',
    keys: [
      { name: 'VITE_SUPABASE_URL', label: 'Project URL', secret: false },
      { name: 'VITE_SUPABASE_ANON_KEY', label: 'Anon public key', secret: false },
    ],
  },
];
