/**
 * Catalog of common app integrations for the Integrations panel. Providers
 * like Clerk and Stripe have no provisioning API (accounts and keys are
 * dashboard-only), so the panel's job is guided capture: exact click-path,
 * a deep link to the right dashboard page, and key fields whose values Jayc
 * writes into the project's .env automatically. Providers WITH management
 * APIs (Supabase projects, Railway deploys) can graduate to full automation
 * later via a proxy like api.railway.ts.
 *
 * Every entry here is hand-verified (tier 1): real key names, real console
 * URLs. When adding providers, prefer the console root over a guessed
 * subpath.
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

  /** extra search terms (aliases, product names) */
  keywords?: string[];

  /** 'webhook' providers hand out a URL instead of API keys (e.g. Zapier) */
  kind?: 'keys' | 'webhook';
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
    keywords: ['auth', 'login', 'signup', 'users'],
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
    keywords: ['payments', 'checkout', 'billing', 'subscriptions'],
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
    keywords: ['postgres', 'database', 'auth', 'storage'],
  },

  // --- AI ---
  {
    id: 'openai',
    name: 'OpenAI',
    icon: 'i-ph:brain',
    blurb: 'GPT models for text, vision, and images.',
    steps: ['Create an OpenAI platform account', 'Open API keys → Create new secret key', 'Copy the key below'],
    dashboardUrl: 'https://platform.openai.com/api-keys',
    keys: [{ name: 'OPENAI_API_KEY', label: 'API key (sk-…)', secret: true }],
    keywords: ['gpt', 'chatgpt', 'ai', 'llm', 'dall-e'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: 'i-ph:brain',
    blurb: 'Claude models for reasoning, writing, and coding.',
    steps: ['Create an Anthropic Console account', 'Open Settings → API keys → Create Key', 'Copy the key below'],
    dashboardUrl: 'https://console.anthropic.com/settings/keys',
    keys: [{ name: 'ANTHROPIC_API_KEY', label: 'API key (sk-ant-…)', secret: true }],
    keywords: ['claude', 'ai', 'llm'],
  },
  {
    id: 'google-ai',
    name: 'Google AI (Gemini)',
    icon: 'i-ph:brain',
    blurb: 'Gemini models for multimodal AI.',
    steps: ['Open Google AI Studio', 'Click Get API key → Create API key', 'Copy the key below'],
    dashboardUrl: 'https://aistudio.google.com/app/apikey',
    keys: [{ name: 'GEMINI_API_KEY', label: 'API key', secret: true }],
    keywords: ['google', 'gemini', 'ai', 'llm'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    icon: 'i-ph:brain',
    blurb: 'One key for 200+ models (Meta, Mistral, DeepSeek, …).',
    steps: ['Create an OpenRouter account', 'Open Keys → Create Key', 'Copy the key below'],
    dashboardUrl: 'https://openrouter.ai/keys',
    keys: [{ name: 'OPENROUTER_API_KEY', label: 'API key (sk-or-…)', secret: true }],
    keywords: ['ai', 'llm', 'models'],
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    icon: 'i-ph:speaker-high',
    blurb: 'AI voice generation and text-to-speech.',
    steps: ['Create an ElevenLabs account', 'Open your profile → API keys', 'Copy the key below'],
    dashboardUrl: 'https://elevenlabs.io/app/settings/api-keys',
    keys: [{ name: 'ELEVENLABS_API_KEY', label: 'API key', secret: true }],
    keywords: ['voice', 'tts', 'audio', 'speech'],
  },

  // --- Email & messaging ---
  {
    id: 'resend',
    name: 'Resend',
    icon: 'i-ph:envelope-simple',
    blurb: 'Transactional email with a clean API.',
    steps: ['Create a Resend account', 'Open API Keys → Create API Key', 'Copy the key below'],
    dashboardUrl: 'https://resend.com/api-keys',
    keys: [{ name: 'RESEND_API_KEY', label: 'API key (re_…)', secret: true }],
    keywords: ['email', 'transactional'],
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    icon: 'i-ph:envelope-simple',
    blurb: 'Transactional and marketing email at scale.',
    steps: ['Create a SendGrid account', 'Open Settings → API Keys → Create API Key', 'Copy the key below'],
    dashboardUrl: 'https://app.sendgrid.com/settings/api_keys',
    keys: [{ name: 'SENDGRID_API_KEY', label: 'API key (SG.…)', secret: true }],
    keywords: ['email', 'transactional'],
  },
  {
    id: 'twilio',
    name: 'Twilio',
    icon: 'i-ph:chat-text',
    blurb: 'SMS, verification codes, and voice calls.',
    steps: [
      'Create a Twilio account',
      'The Console dashboard shows your Account SID and Auth Token',
      'Copy both below',
    ],
    dashboardUrl: 'https://console.twilio.com',
    keys: [
      { name: 'TWILIO_ACCOUNT_SID', label: 'Account SID (AC…)', secret: false },
      { name: 'TWILIO_AUTH_TOKEN', label: 'Auth token', secret: true },
    ],
    keywords: ['sms', 'text', 'phone', '2fa'],
  },
  {
    id: 'slack',
    name: 'Slack',
    icon: 'i-ph:slack-logo',
    blurb: 'Post messages and alerts to Slack channels.',
    steps: [
      'Create a Slack app at api.slack.com/apps',
      'Add the chat:write scope under OAuth & Permissions, install to your workspace',
      'Copy the Bot User OAuth Token below',
    ],
    dashboardUrl: 'https://api.slack.com/apps',
    keys: [{ name: 'SLACK_BOT_TOKEN', label: 'Bot token (xoxb-…)', secret: true }],
    keywords: ['messages', 'notifications', 'chat'],
  },
  {
    id: 'discord',
    name: 'Discord',
    icon: 'i-ph:discord-logo',
    blurb: 'Bots that read and post in your server.',
    steps: [
      'Create an application in the Discord Developer Portal',
      'Open Bot → Reset Token',
      'Copy the bot token below',
    ],
    dashboardUrl: 'https://discord.com/developers/applications',
    keys: [{ name: 'DISCORD_BOT_TOKEN', label: 'Bot token', secret: true }],
    keywords: ['bot', 'chat', 'community'],
  },

  // --- Data ---
  {
    id: 'neon',
    name: 'Neon',
    icon: 'i-ph:database',
    blurb: 'Serverless Postgres with branching.',
    steps: ['Create a Neon project', 'Open the dashboard Connection Details', 'Copy the connection string below'],
    dashboardUrl: 'https://console.neon.tech',
    keys: [{ name: 'DATABASE_URL', label: 'Connection string (postgres://…)', secret: true }],
    keywords: ['postgres', 'database', 'sql'],
  },
  {
    id: 'turso',
    name: 'Turso',
    icon: 'i-ph:database',
    blurb: 'SQLite at the edge (libsql).',
    steps: [
      'Create a Turso account and database',
      'Open the database → Create Token',
      'Copy the database URL and token below',
    ],
    dashboardUrl: 'https://turso.tech/app',
    keys: [
      { name: 'TURSO_DATABASE_URL', label: 'Database URL (libsql://…)', secret: false },
      { name: 'TURSO_AUTH_TOKEN', label: 'Auth token', secret: true },
    ],
    keywords: ['sqlite', 'database', 'libsql'],
  },
  {
    id: 'upstash',
    name: 'Upstash',
    icon: 'i-ph:database',
    blurb: 'Serverless Redis over REST.',
    steps: ['Create an Upstash Redis database', 'Open the database Details tab', 'Copy the REST URL and token below'],
    dashboardUrl: 'https://console.upstash.com',
    keys: [
      { name: 'UPSTASH_REDIS_REST_URL', label: 'REST URL', secret: false },
      { name: 'UPSTASH_REDIS_REST_TOKEN', label: 'REST token', secret: true },
    ],
    keywords: ['redis', 'cache', 'kv'],
  },
  {
    id: 'planetscale',
    name: 'PlanetScale',
    icon: 'i-ph:database',
    blurb: 'Serverless MySQL platform.',
    steps: ['Create a PlanetScale database', 'Open Connect → create a password', 'Copy the connection string below'],
    dashboardUrl: 'https://app.planetscale.com',
    keys: [{ name: 'DATABASE_URL', label: 'Connection string (mysql://…)', secret: true }],
    keywords: ['mysql', 'database', 'sql'],
  },
  {
    id: 'mongodb',
    name: 'MongoDB Atlas',
    icon: 'i-ph:database',
    blurb: 'Hosted document database.',
    steps: [
      'Create an Atlas cluster (free tier is fine)',
      'Open Database → Connect → Drivers',
      'Copy the connection string below',
    ],
    dashboardUrl: 'https://cloud.mongodb.com',
    keys: [{ name: 'MONGODB_URI', label: 'Connection string (mongodb+srv://…)', secret: true }],
    keywords: ['mongo', 'database', 'document', 'nosql'],
  },
  {
    id: 'firebase',
    name: 'Firebase',
    icon: 'i-ph:fire',
    blurb: 'Google app platform: auth, Firestore, storage.',
    steps: [
      'Create a Firebase project',
      'Add a web app (</> icon) and register it',
      'Copy the config values below from Project Settings',
    ],
    dashboardUrl: 'https://console.firebase.google.com',
    keys: [
      { name: 'VITE_FIREBASE_API_KEY', label: 'API key', secret: false },
      { name: 'VITE_FIREBASE_AUTH_DOMAIN', label: 'Auth domain', secret: false },
      { name: 'VITE_FIREBASE_PROJECT_ID', label: 'Project ID', secret: false },
      { name: 'VITE_FIREBASE_APP_ID', label: 'App ID', secret: false },
    ],
    keywords: ['google', 'firestore', 'auth', 'realtime'],
  },
  {
    id: 'airtable',
    name: 'Airtable',
    icon: 'i-ph:table',
    blurb: 'Spreadsheet-database with a simple API.',
    steps: [
      'Open airtable.com/create/tokens',
      'Create a personal access token with data.records scopes',
      'Copy it below',
    ],
    dashboardUrl: 'https://airtable.com/create/tokens',
    keys: [{ name: 'AIRTABLE_API_KEY', label: 'Personal access token (pat…)', secret: true }],
    keywords: ['spreadsheet', 'database', 'tables'],
  },
  {
    id: 'notion',
    name: 'Notion',
    icon: 'i-ph:notebook',
    blurb: 'Read and write Notion workspaces and pages.',
    steps: [
      'Open notion.so/my-integrations → New integration',
      'Copy the internal integration secret below',
      'Share your pages/databases with the integration in Notion',
    ],
    dashboardUrl: 'https://www.notion.so/my-integrations',
    keys: [{ name: 'NOTION_API_KEY', label: 'Integration secret (ntn_…)', secret: true }],
    keywords: ['docs', 'wiki', 'notes', 'cms'],
  },

  // --- Payments & commerce ---
  {
    id: 'square',
    name: 'Square',
    icon: 'i-ph:credit-card',
    blurb: 'Payments, orders, and inventory.',
    steps: [
      'Create a Square developer account and application',
      'Open Credentials (sandbox is fine)',
      'Copy the Application ID and Access Token below',
    ],
    dashboardUrl: 'https://developer.squareup.com/apps',
    keys: [
      { name: 'VITE_SQUARE_APPLICATION_ID', label: 'Application ID', secret: false },
      { name: 'SQUARE_ACCESS_TOKEN', label: 'Access token', secret: true },
    ],
    keywords: ['payments', 'pos', 'commerce'],
  },
  {
    id: 'shopify',
    name: 'Shopify',
    icon: 'i-ph:storefront',
    blurb: 'Storefronts, products, and orders.',
    steps: [
      'In your Shopify admin, open Settings → Apps and sales channels → Develop apps',
      'Create an app, configure Storefront/Admin scopes, install it',
      'Copy your store domain and access token below',
    ],
    dashboardUrl: 'https://admin.shopify.com',
    keys: [
      { name: 'SHOPIFY_STORE_DOMAIN', label: 'Store domain (your-store.myshopify.com)', secret: false },
      { name: 'SHOPIFY_ACCESS_TOKEN', label: 'Access token', secret: true },
    ],
    keywords: ['ecommerce', 'store', 'products'],
  },
  {
    id: 'plaid',
    name: 'Plaid',
    icon: 'i-ph:bank',
    blurb: 'Bank account balances and transactions.',
    steps: [
      'Create a Plaid account',
      'Open Developers → Keys (sandbox is fine)',
      'Copy the client ID and secret below',
    ],
    dashboardUrl: 'https://dashboard.plaid.com/developers/keys',
    keys: [
      { name: 'PLAID_CLIENT_ID', label: 'Client ID', secret: false },
      { name: 'PLAID_SECRET', label: 'Secret', secret: true },
    ],
    keywords: ['banking', 'finance', 'fintech'],
  },
  {
    id: 'revenuecat',
    name: 'RevenueCat',
    icon: 'i-ph:currency-circle-dollar',
    blurb: 'In-app purchases and subscriptions.',
    steps: ['Create a RevenueCat project', 'Open API keys', 'Copy the public SDK key below'],
    dashboardUrl: 'https://app.revenuecat.com',
    keys: [{ name: 'VITE_REVENUECAT_PUBLIC_SDK_KEY', label: 'Public SDK key', secret: false }],
    keywords: ['iap', 'subscriptions', 'mobile', 'monetization'],
  },

  // --- CMS & media ---
  {
    id: 'sanity',
    name: 'Sanity',
    icon: 'i-ph:article',
    blurb: 'Headless CMS with real-time content APIs.',
    steps: [
      'Create a Sanity project',
      'Open sanity.io/manage → your project → API → Tokens',
      'Copy the project ID and token below',
    ],
    dashboardUrl: 'https://www.sanity.io/manage',
    keys: [
      { name: 'VITE_SANITY_PROJECT_ID', label: 'Project ID', secret: false },
      { name: 'SANITY_API_TOKEN', label: 'API token', secret: true },
    ],
    keywords: ['cms', 'content', 'headless'],
  },
  {
    id: 'contentful',
    name: 'Contentful',
    icon: 'i-ph:article',
    blurb: 'Headless CMS for structured content.',
    steps: [
      'Create a Contentful space',
      'Open Settings → API keys → Add API key',
      'Copy the Space ID and Content Delivery token below',
    ],
    dashboardUrl: 'https://app.contentful.com',
    keys: [
      { name: 'CONTENTFUL_SPACE_ID', label: 'Space ID', secret: false },
      { name: 'CONTENTFUL_ACCESS_TOKEN', label: 'Delivery API token', secret: true },
    ],
    keywords: ['cms', 'content', 'headless'],
  },
  {
    id: 'cloudinary',
    name: 'Cloudinary',
    icon: 'i-ph:image',
    blurb: 'Image and video hosting, transforms, CDN.',
    steps: [
      'Create a Cloudinary account',
      'The Console dashboard shows your cloud name and API keys',
      'Copy all three below',
    ],
    dashboardUrl: 'https://console.cloudinary.com',
    keys: [
      { name: 'VITE_CLOUDINARY_CLOUD_NAME', label: 'Cloud name', secret: false },
      { name: 'CLOUDINARY_API_KEY', label: 'API key', secret: false },
      { name: 'CLOUDINARY_API_SECRET', label: 'API secret', secret: true },
    ],
    keywords: ['images', 'video', 'cdn', 'media', 'uploads'],
  },
  {
    id: 'uploadthing',
    name: 'Uploadthing',
    icon: 'i-ph:upload-simple',
    blurb: 'File uploads for TypeScript apps.',
    steps: ['Create an Uploadthing account and app', 'Open the dashboard API keys section', 'Copy the token below'],
    dashboardUrl: 'https://uploadthing.com/dashboard',
    keys: [{ name: 'UPLOADTHING_TOKEN', label: 'API token', secret: true }],
    keywords: ['uploads', 'files', 'storage'],
  },

  // --- Analytics & ops ---
  {
    id: 'sentry',
    name: 'Sentry',
    icon: 'i-ph:bug',
    blurb: 'Error tracking and performance monitoring.',
    steps: [
      'Create a Sentry project',
      'Copy the DSN from the project setup wizard (or Settings → Client Keys)',
      'For API access, create an auth token under User Settings → Auth Tokens',
    ],
    dashboardUrl: 'https://sentry.io/settings/account/api/auth-tokens/',
    keys: [
      { name: 'VITE_SENTRY_DSN', label: 'DSN (https://…@….ingest.sentry.io/…)', secret: false },
      { name: 'SENTRY_AUTH_TOKEN', label: 'Auth token (optional, for API)', secret: true },
    ],
    keywords: ['errors', 'monitoring', 'crashes'],
  },
  {
    id: 'posthog',
    name: 'PostHog',
    icon: 'i-ph:chart-line-up',
    blurb: 'Product analytics, funnels, and feature flags.',
    steps: ['Create a PostHog project', 'Open Project Settings', 'Copy the project API key and host below'],
    dashboardUrl: 'https://app.posthog.com',
    keys: [
      { name: 'VITE_POSTHOG_KEY', label: 'Project API key (phc_…)', secret: false },
      { name: 'VITE_POSTHOG_HOST', label: 'Host (https://us.i.posthog.com)', secret: false },
    ],
    keywords: ['analytics', 'events', 'flags'],
  },
  {
    id: 'amplitude',
    name: 'Amplitude',
    icon: 'i-ph:chart-line-up',
    blurb: 'Product analytics and user behavior.',
    steps: ['Create an Amplitude project', 'Open Settings → Projects → your project', 'Copy the API key below'],
    dashboardUrl: 'https://amplitude.com',
    keys: [{ name: 'VITE_AMPLITUDE_API_KEY', label: 'API key', secret: false }],
    keywords: ['analytics', 'events'],
  },
  {
    id: 'segment',
    name: 'Segment',
    icon: 'i-ph:chart-line-up',
    blurb: 'Customer data pipeline to every tool.',
    steps: ['Create a Segment source', 'Open the source Settings → API Keys', 'Copy the write key below'],
    dashboardUrl: 'https://app.segment.com',
    keys: [{ name: 'VITE_SEGMENT_WRITE_KEY', label: 'Write key', secret: false }],
    keywords: ['analytics', 'events', 'cdp'],
  },
  {
    id: 'linear',
    name: 'Linear',
    icon: 'i-ph:kanban',
    blurb: 'Issue tracking read/write API.',
    steps: ['Open Linear → Settings → API', 'Create a personal API key', 'Copy it below'],
    dashboardUrl: 'https://linear.app/settings/api',
    keys: [{ name: 'LINEAR_API_KEY', label: 'Personal API key (lin_api_…)', secret: true }],
    keywords: ['issues', 'tickets', 'project management'],
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: 'i-ph:github-logo',
    blurb: 'Repos, issues, and Actions via API.',
    steps: ['Open github.com/settings/tokens', 'Generate a new token (classic) with the repo scope', 'Copy it below'],
    dashboardUrl: 'https://github.com/settings/tokens',
    keys: [{ name: 'GITHUB_TOKEN', label: 'Personal access token (ghp_…)', secret: true }],
    keywords: ['git', 'repos', 'version control'],
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    icon: 'i-ph:gitlab-logo',
    blurb: 'Projects, MRs, and pipelines via API.',
    steps: [
      'Open GitLab → Preferences → Access Tokens',
      'Create a personal access token with the api scope',
      'Copy it below',
    ],
    dashboardUrl: 'https://gitlab.com/-/user_settings/personal_access_tokens',
    keys: [{ name: 'GITLAB_TOKEN', label: 'Personal access token (glpat-…)', secret: true }],
    keywords: ['git', 'repos', 'ci'],
  },

  // --- Misc ---
  {
    id: 'spotify',
    name: 'Spotify',
    icon: 'i-ph:spotify-logo',
    blurb: 'Playlists, library, and playback data.',
    steps: [
      'Create an app in the Spotify Developer Dashboard',
      'Open the app Settings',
      'Copy the Client ID and Client Secret below',
    ],
    dashboardUrl: 'https://developer.spotify.com/dashboard',
    keys: [
      { name: 'SPOTIFY_CLIENT_ID', label: 'Client ID', secret: false },
      { name: 'SPOTIFY_CLIENT_SECRET', label: 'Client secret', secret: true },
    ],
    keywords: ['music', 'audio', 'playlists'],
  },
  {
    id: 'youtube',
    name: 'YouTube Data',
    icon: 'i-ph:youtube-logo',
    blurb: 'Videos, channels, and playlists via API.',
    steps: [
      'Open Google Cloud Console → APIs & Services',
      'Enable the YouTube Data API v3, then create an API key under Credentials',
      'Copy it below',
    ],
    dashboardUrl: 'https://console.cloud.google.com/apis/credentials',
    keys: [{ name: 'YOUTUBE_API_KEY', label: 'API key', secret: true }],
    keywords: ['video', 'google'],
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    icon: 'i-ph:envelope-simple',
    blurb: 'Audiences, campaigns, and email marketing.',
    steps: [
      'Open Mailchimp → Account → Extras → API keys',
      'Create a key; your server prefix is the suffix after the dash (e.g. us21)',
      'Copy both below',
    ],
    dashboardUrl: 'https://admin.mailchimp.com',
    keys: [
      { name: 'MAILCHIMP_API_KEY', label: 'API key', secret: true },
      { name: 'MAILCHIMP_SERVER_PREFIX', label: 'Server prefix (e.g. us21)', secret: false },
    ],
    keywords: ['email', 'marketing', 'newsletter'],
  },
  {
    id: 'calendly',
    name: 'Calendly',
    icon: 'i-ph:calendar',
    blurb: 'Read and manage scheduled events.',
    steps: [
      'Open Calendly → Integrations & apps → API & webhooks',
      'Generate a personal access token',
      'Copy it below',
    ],
    dashboardUrl: 'https://calendly.com/integrations/api_webhooks',
    keys: [{ name: 'CALENDLY_API_TOKEN', label: 'Personal access token', secret: true }],
    keywords: ['scheduling', 'calendar', 'bookings'],
  },
  {
    id: 'todoist',
    name: 'Todoist',
    icon: 'i-ph:check-square',
    blurb: 'Create and manage tasks and projects.',
    steps: ['Open Todoist → Settings → Integrations → Developer', 'Copy your API token below'],
    dashboardUrl: 'https://todoist.com/app/settings/integrations/developer',
    keys: [{ name: 'TODOIST_API_TOKEN', label: 'API token', secret: true }],
    keywords: ['tasks', 'todo', 'productivity'],
  },

  // --- Automation ---
  {
    id: 'zapier',
    name: 'Zapier',
    icon: 'i-ph:lightning',
    blurb: 'Trigger Zaps from your app via a webhook — connect to 7,000+ apps.',
    steps: [
      'Create a free Zapier account',
      'Create a Zap → trigger: Webhooks by Zapier → "Catch Hook"',
      'Copy the webhook URL Zapier gives you and paste it below',
    ],
    dashboardUrl: 'https://zapier.com/app/zaps',
    keys: [{ name: 'ZAPIER_WEBHOOK_URL', label: 'Webhook URL (https://hooks.zapier.com/…)', secret: false }],
    keywords: ['automation', 'webhook', 'zap', 'workflows'],
    kind: 'webhook',
  },
];
