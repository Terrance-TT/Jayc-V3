/**
 * Hand-maintained: wrangler.toml declares no [vars], so `wrangler types` would
 * wipe this file. Keep it in sync with the bindings the code actually uses.
 */
interface Env {
  OPENROUTER_API_KEY: string;

  /** optional: overrides the default chat model (moonshotai/kimi-k2-thinking) */
  OPENROUTER_MODEL?: string;

  /** optional: comma-separated model-level fallbacks routed by OpenRouter */
  OPENROUTER_FALLBACK_MODELS?: string;

  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;

  /**
   * Optional: enables web-search features (chat enrichment + fact-check).
   * Without it both stay dormant (fact-check reports "not_configured").
   */
  TAVILY_API_KEY?: string;

  /**
   * Optional: gates the owner-only GET /api/feedback review endpoint.
   * Without it the endpoint answers 404.
   */
  FEEDBACK_ADMIN_KEY?: string;

  /**
   * Cloudflare D1 binding (see [[d1_databases]] in wrangler.toml).
   * Optional: until the database is created, sync routes report
   * "database_not_configured" and the client falls back to IndexedDB only.
   */
  DB?: D1Database;
}
