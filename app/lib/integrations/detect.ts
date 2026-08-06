import { INTEGRATION_PROVIDERS } from './catalog';

/**
 * Coarse "does this text contain something that looks like a live credential"
 * detection. Used by the chat-input interceptor (warn before a key gets sent
 * to the LLM provider / stored in history) and by redact.ts.
 *
 * Deliberately separate from paste-parser.ts: detection only needs a yes/no
 * plus a rough label — precise provider mapping (incl. JWT payload decoding)
 * lives in the parser.
 */

export interface DetectedSecret {
  /** human label, e.g. "Anthropic API key" or "API token (JWT)" */
  label: string;

  /** catalog provider id when the match maps to one */
  providerId?: string;

  /** the matched secret text — never render unmasked, never log */
  match: string;
}

interface SecretPattern {
  label: string;
  providerId?: string;
  regex: RegExp;
}

/** generic credential shapes that don't map to exactly one catalog entry */
const GENERIC_PATTERNS: SecretPattern[] = [
  { label: 'private key block', regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { label: 'OpenAI-style API key', regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: 'live publishable/secret key', regex: /\b[ps]k_live_[A-Za-z0-9_-]{16,}\b/ },
  { label: 'GitHub token', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { label: 'Slack token', regex: /\bxox[bapors]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: 'API token (JWT)', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/ },
  {
    label: 'database connection string',
    regex: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"']+/,
  },
];

/**
 * Catalog key patterns, most specific first so dedup keeps the better label.
 * JWT-shaped catalog patterns (e.g. Supabase's anon key) are excluded — every
 * JWT matches them, so the generic "API token (JWT)" label is the honest one
 * here; precise JWT→provider mapping is paste-parser.ts's job.
 */
const CATALOG_PATTERNS: SecretPattern[] = INTEGRATION_PROVIDERS.flatMap((provider) =>
  provider.keys
    .filter((key) => key.pattern && !key.pattern.includes('eyJ'))
    .map((key) => ({
      label: `${provider.name} ${key.secret ? 'secret' : 'key'}`,
      providerId: provider.id,
      regex: new RegExp(key.pattern as string),
    })),
).sort((a, b) => b.regex.source.length - a.regex.source.length);

const ALL_PATTERNS: SecretPattern[] = [...CATALOG_PATTERNS, ...GENERIC_PATTERNS];

/**
 * Returns every distinct secret-looking match in `text`, deduplicated by
 * matched text (the first — most specific — pattern wins the label).
 */
export function findSecrets(text: string): DetectedSecret[] {
  const found: DetectedSecret[] = [];
  const seen = new Set<string>();

  for (const { label, providerId, regex } of ALL_PATTERNS) {
    const global = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);

    for (const match of text.matchAll(global)) {
      const value = match[0];

      if (!seen.has(value)) {
        seen.add(value);
        found.push({ label, providerId, match: value });
      }
    }
  }

  return found;
}

/** mask a secret for display: `sk-ant-…3f9a` (never more than a prefix + last 4) */
export function maskSecret(value: string): string {
  if (value.length <= 12) {
    return '•••';
  }

  const prefixMatch = value.match(/^([a-z0-9]{1,6}[-_.:]){1,2}/i);
  const prefix = prefixMatch ? prefixMatch[0] : value.slice(0, 3);

  return `${prefix}…${value.slice(-4)}`;
}
