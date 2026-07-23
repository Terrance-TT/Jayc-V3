interface Env {
  MOONSHOT_API_KEY: string;
  MOONSHOT_MODEL?: string;
  MOONSHOT_BASE_URL?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;

  // Cloudflare D1 binding (see [[d1_databases]] in wrangler.toml).
  // Optional: until the database is created, sync routes report
  // "database_not_configured" and the client falls back to IndexedDB only.
  DB?: D1Database;
}
