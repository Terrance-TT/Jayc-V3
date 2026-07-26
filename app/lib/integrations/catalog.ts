/**
 * Integration advisory layer — service catalog.
 *
 * Pure data + types: the curated list of third-party services (and honest
 * browser-only defaults) the AI can suggest when a user request implies a
 * capability like auth, maps, or payments. Every option listed here must
 * actually work inside Jayc's WebContainer sandbox: client-side code only,
 * `VITE_*` env vars for keys, no native binaries, no server secrets.
 *
 * Consumed by `detect.ts` (regex matching), `advisory.ts` (prompt injection)
 * and `SuggestionCard.tsx` (UI labels). Keep this file dependency-free.
 */

export interface IntegrationOption {
  /** Stable kebab-case identifier; emitted in the <jaycSuggestions> JSON. */
  id: string;

  /** Human-readable name shown in prose and in the suggestion card. */
  name: string;

  /** One-line summary of what the option is. */
  tagline: string;
  pros: string[];
  cons: string[];

  /** True when the user must create an account and provide a key/endpoint. */
  needsKey: boolean;

  /** The default the model picks unless the user named a different service. */
  recommended?: boolean;
}

export interface IntegrationCategory {
  /** Stable kebab-case identifier; also used for session-level dedupe. */
  id: string;

  /** Human-readable label shown in the suggestion card. */
  label: string;

  /** Case-insensitive patterns matched against the LATEST user message. */
  triggerPatterns: RegExp[];

  /**
   * Set when "you may not need any service at all" is a common right answer.
   * The advisory surfaces this note so the model says so explicitly.
   */
  browserOnlyNote?: string;
  options: IntegrationOption[];
}

export const INTEGRATION_CATALOG: IntegrationCategory[] = [
  {
    id: 'auth',
    label: 'Authentication',
    triggerPatterns: [
      /\b(log ?in|sign ?in|sign ?up)\b/i,
      /\bauth(entication|orization)?\b/i,
      /\buser accounts?\b/i,
      /\b(oauth|magic links?|passwordless)\b/i,
    ],
    options: [
      {
        id: 'clerk',
        name: 'Clerk',
        tagline: 'Hosted auth UI and sessions that run fully client-side.',
        pros: ['Drop-in React components for sign-in/sign-up', 'Generous free tier', 'No backend code required'],
        cons: ['Requires a Clerk account and publishable key', 'User identity data lives with a third party'],
        needsKey: true,
        recommended: true,
      },
      {
        id: 'no-auth',
        name: 'No auth (local profile)',
        tagline: 'Skip accounts; keep a local profile in browser storage.',
        pros: ['Zero setup and no keys', 'Fastest path to a working app'],
        cons: ['No real identity; profile is tied to one browser'],
        needsKey: false,
      },
    ],
  },
  {
    id: 'database',
    label: 'Database',
    triggerPatterns: [
      /\bdatabases?\b/i,
      /\b(persist|persistence)\b/i,
      /\b(save|store)\s+(user\s+)?data\b/i,
      /\bmulti-?user\b/i,
      /\b(postgres|mysql|sqlite|sql)\b/i,
    ],
    browserOnlyNote: 'Single-user apps usually need no service — browser storage is enough.',
    options: [
      {
        id: 'browser-local',
        name: 'Browser storage',
        tagline: 'Persist data locally in the user’s browser.',
        pros: ['No account or key', 'Instant and offline-capable', 'Ideal for single-user apps'],
        cons: ['Data stays on one device/browser', 'No sharing between users'],
        needsKey: false,
        recommended: true,
      },
      {
        id: 'supabase',
        name: 'Supabase',
        tagline: 'Hosted Postgres with a client-side SDK for shared data.',
        pros: ['Real database with multi-user shared data', 'Works from browser code via the JS client', 'Free tier'],
        cons: [
          'Requires a Supabase account, project URL, and anon key',
          'The anon key is public — row-level security must be configured',
        ],
        needsKey: true,
      },
    ],
  },
  {
    id: 'payments',
    label: 'Payments',
    triggerPatterns: [
      /\bpayments?\b/i,
      /\bcheckout\b/i,
      /\bstripe\b/i,
      /\bsubscriptions?\b/i,
      /\bdonations?\b/i,
      /\b(buy|purchase|pricing)\b/i,
    ],
    options: [
      {
        id: 'stripe-payment-links',
        name: 'Stripe Payment Links',
        tagline: 'Hosted Stripe checkout opened via a plain URL.',
        pros: ['No backend required — a link works from pure client code', 'Real card processing handled by Stripe'],
        cons: [
          'Requires a Stripe account and a pre-created Payment Link URL',
          'Honest limitation: no server-side fulfillment or webhooks are possible inside the sandbox',
        ],
        needsKey: false,
        recommended: true,
      },
      {
        id: 'mock-checkout',
        name: 'Simulated checkout',
        tagline: 'Client-side cart with a fake confirmation for demos.',
        pros: ['Zero setup, no account', 'Good for prototypes and UI demos'],
        cons: ['Not real payments — no money moves'],
        needsKey: false,
      },
    ],
  },
  {
    id: 'maps',
    label: 'Maps',
    triggerPatterns: [/\bmaps?\b/i, /\b(geo)?locations?\b/i, /\bdirections\b/i, /\bnearby\b/i, /\bplaces\b/i],
    options: [
      {
        id: 'leaflet',
        name: 'Leaflet + OpenStreetMap',
        tagline: 'Free interactive maps with open tile data.',
        pros: ['Free, no API key', 'Lightweight and fully client-side'],
        cons: ['OpenStreetMap tiles have usage limits under heavy traffic'],
        needsKey: false,
        recommended: true,
      },
      {
        id: 'google-maps',
        name: 'Google Maps',
        tagline: 'Google Maps JavaScript API with places and geocoding.',
        pros: ['Rich places/geocoding data', 'Familiar UX'],
        cons: ['Requires a Google Cloud API key with billing enabled', 'The key is visible in client code'],
        needsKey: true,
      },
    ],
  },
  {
    id: 'ai-llm',
    label: 'AI / LLM',
    triggerPatterns: [
      /\b(ai|llm)\b/i,
      /\b(gpt|chatgpt|openai|anthropic|claude|moonshot|kimi)\b/i,
      /\bchatbots?\b/i,
      /\btext generation\b/i,
      /\bsummari[sz]e\b/i,
    ],
    browserOnlyNote: 'Trivial AI features may not need a hosted model or key at all.',
    options: [
      {
        id: 'byok',
        name: 'Hosted LLM (BYOK)',
        tagline: 'Call a hosted LLM from the browser with the user’s own key.',
        pros: ['Best model quality', 'Simple fetch from client code'],
        cons: [
          'The key is visible to anyone who opens the site — the user must supply their own',
          'Per-token costs land on the user’s account',
        ],
        needsKey: true,
        recommended: true,
      },
      {
        id: 'in-browser',
        name: 'In-browser small model',
        tagline: 'Run a small model locally in the browser via WebGPU/WASM.',
        pros: ['No key and no account', 'Private — inference stays on device'],
        cons: ['Large model download on first run', 'Only suitable for trivial tasks'],
        needsKey: false,
      },
    ],
  },
  {
    id: 'email',
    label: 'Email',
    triggerPatterns: [/\be-?mails?\b/i, /\bnewsletters?\b/i, /\bcontact forms?\b/i, /\bmailing list\b/i],
    options: [
      {
        id: 'emailjs',
        name: 'EmailJS',
        tagline: 'Send email straight from client-side code.',
        pros: ['No backend required', 'Free tier'],
        cons: ['Requires an EmailJS account plus service/template/public key'],
        needsKey: true,
        recommended: true,
      },
      {
        id: 'formspree',
        name: 'Formspree',
        tagline: 'Hosted form endpoints, ideal for contact forms.',
        pros: ['No code beyond a form POST', 'Spam filtering included'],
        cons: ['Requires a Formspree form endpoint URL (tied to an account)'],
        needsKey: true,
      },
    ],
  },
  {
    id: 'storage',
    label: 'File storage',
    triggerPatterns: [
      /\bfile uploads?\b/i,
      /\buploads?\b/i,
      /\battachments?\b/i,
      /\b(photo|image|file) storage\b/i,
      /\bbuckets?\b/i,
    ],
    browserOnlyNote: 'Files for one user can stay in the browser (IndexedDB/Cache API) — no key needed.',
    options: [
      {
        id: 'browser-files',
        name: 'Browser storage',
        tagline: 'Keep files locally in the user’s browser.',
        pros: ['No account or key', 'Works offline', 'Fine for single-user apps'],
        cons: ['Files stay on one device/browser', 'Storage quota varies by browser'],
        needsKey: false,
        recommended: true,
      },
      {
        id: 'supabase-storage',
        name: 'Supabase Storage',
        tagline: 'Hosted file buckets with a client-side SDK.',
        pros: ['Files shared across devices and users', 'Works from browser code via the JS client'],
        cons: ['Requires a Supabase account, project URL, and anon key', 'Bucket policies must be configured'],
        needsKey: true,
      },
    ],
  },
  {
    id: 'realtime',
    label: 'Realtime',
    triggerPatterns: [
      /\breal-?time\b/i,
      /\blive (chat|updates?|feed)\b/i,
      /\bcollaborat(e|ion|ive)\b/i,
      /\bmultiplayer\b/i,
      /\bpresence\b/i,
      /\bwebsockets?\b/i,
    ],
    options: [
      {
        id: 'supabase-realtime',
        name: 'Supabase Realtime',
        tagline: 'Shared live state across users via Supabase channels.',
        pros: ['Works across devices and users', 'Client-side SDK, no custom server'],
        cons: ['Requires a Supabase account, project URL, and anon key'],
        needsKey: true,
        recommended: true,
      },
      {
        id: 'partykit',
        name: 'PartyKit',
        tagline: 'WebSocket rooms backed by a tiny party server.',
        pros: ['Runs locally in the sandbox during development (npx partykit dev)', 'Simple room-based API'],
        cons: ['Sharing beyond the sandbox requires deploying the party server', 'Extra moving part to maintain'],
        needsKey: false,
      },
    ],
  },
];
