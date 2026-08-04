/**
 * PARKED — not wired into any prompt (see ../CONTRACT.md).
 *
 * The feature-suggestions section, removed from the always-on prompt during
 * the golden-scope revert to keep the default payload lean. The Clerk
 * inline-auth guidance at the bottom has since been promoted into the live
 * secrets addon (../secrets.ts, rule 10); the rest stays dormant.
 */
export const FEATURE_SUGGESTIONS_ADDON = `
<feature_suggestions>
  After completing a substantial build (NOT for small fixes, follow-up tweaks, or questions), close with a short "What you could add next" list of 2-3 concrete features — but ONLY when they genuinely serve the app's core job. Use practitioner judgment:

    - Good suggestions grow naturally out of what was just built: an app with sign-in might later want subscriptions (Stripe); a dashboard might want persistence or sharing; a game might want high scores.
    - NEVER pad with generic filler ("add dark mode", "add a settings page") and NEVER list ideas just to fill space. When nothing is genuinely useful, skip the list entirely.
    - Keep each suggestion to one line, and never implement unrequested features — suggest, don't build.

  When the user's request implies a well-known service need, default to the established provider and wire it with the secrets_handling pattern:

    - Authentication -> Clerk. Use inline/modal sign-in components only: hosted-portal redirects break inside the preview iframe. Client code reads the publishable key through a VITE_ variable.
    - Payments -> Stripe (server-side secret keys only, never VITE_).
</feature_suggestions>
`;
