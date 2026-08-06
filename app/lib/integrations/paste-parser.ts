import { INTEGRATION_PROVIDERS, type IntegrationProvider } from './catalog';

/**
 * Smart-paste parser: accepts whatever the user copied — a bare key, an .env
 * blob, a JSON config object, a curl snippet from docs — and maps it onto
 * catalog providers and their env vars.
 *
 * Pure and deterministic; the UI decides what to do with multiple candidates.
 */

export interface PasteCandidate {
  provider: IntegrationProvider;

  /** env var name → sanitized value */
  values: Record<string, string>;

  /**
   * Env vars filled by derivation rather than the paste itself (e.g. the
   * Supabase project URL decoded from the anon-key JWT) — shown in the UI.
   */
  derived: string[];
}

interface CompiledKeyPattern {
  provider: IntegrationProvider;
  envName: string;

  /** anchored — full-token match */
  regex: RegExp;

  /** unanchored — substring scan of raw pastes */
  searchRegex: RegExp;

  /** JWT patterns need payload verification before claiming a provider */
  isJwt: boolean;
}

const KEY_PATTERNS: CompiledKeyPattern[] = INTEGRATION_PROVIDERS.flatMap((provider) =>
  provider.keys
    .filter((key) => key.pattern)
    .map((key) => ({
      provider,
      envName: key.name,
      regex: new RegExp(`^(?:${key.pattern as string})$`),
      searchRegex: new RegExp(key.pattern as string, 'g'),
      isJwt: (key.pattern as string).includes('eyJ'),
    })),
);

/** env var name → catalog keys that claim it (DATABASE_URL is claimed by two) */
const ENV_NAME_INDEX = new Map<string, { provider: IntegrationProvider; envName: string }[]>();

for (const provider of INTEGRATION_PROVIDERS) {
  for (const key of provider.keys) {
    const list = ENV_NAME_INDEX.get(key.name) ?? [];
    list.push({ provider, envName: key.name });
    ENV_NAME_INDEX.set(key.name, list);
  }
}

/**
 * Strips surrounding quotes and trailing commas/semicolons. Returns null for
 * empty values and — critically — any value containing a newline, so a pasted
 * blob can never smuggle extra lines into .env.
 */
export function sanitizeValue(raw: string): string | null {
  let value = raw
    .trim()
    .replace(/[,;]+$/, '')
    .trim();

  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1);
  }

  if (value.length === 0 || /[\n\r]/.test(value)) {
    return null;
  }

  return value;
}

/** decodes a JWT payload without verifying the signature (we only read `ref`) */
function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));

    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** KEY=value / export KEY=value lines */
function extractEnvPairs(text: string): [string, string][] {
  const pairs: [string, string][] = [];

  for (const line of text.split('\n')) {
    const match = line.trim().match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/);

    if (match) {
      pairs.push([match[1], match[2]]);
    }
  }

  return pairs;
}

/** string values of a JSON object, one level deep (covers Firebase web configs) */
function extractJsonValues(text: string): Record<string, string> | undefined {
  if (!text.startsWith('{')) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text) as unknown;

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }

    const values: Record<string, string> = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        values[key] = value;
      }
    }

    return values;
  } catch {
    return undefined;
  }
}

/** tokens from curl/docs snippets: Authorization: Bearer …, x-api-key: …, api-key: … */
function extractHeaderTokens(text: string): string[] {
  const tokens: string[] = [];
  const headerRegex = /(?:authorization|x-api-key|api-key|xi-api-key|apikey)\s*:\s*(?:bearer\s+)?([^\s"']+)/gi;

  for (const match of text.matchAll(headerRegex)) {
    tokens.push(match[1]);
  }

  return tokens;
}

const FIREBASE_FIELD_MAP: Record<string, string> = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  appId: 'VITE_FIREBASE_APP_ID',
};

export function parsePaste(raw: string): PasteCandidate[] {
  const text = raw.trim();

  if (!text) {
    return [];
  }

  const byProvider = new Map<string, { provider: IntegrationProvider; values: Record<string, string> }>();

  const addValue = (provider: IntegrationProvider, envName: string, rawValue: string) => {
    const value = sanitizeValue(rawValue);

    if (value === null) {
      return;
    }

    const entry = byProvider.get(provider.id) ?? { provider, values: {} };

    entry.values[envName] ??= value;
    byProvider.set(provider.id, entry);
  };

  /** match one token against every catalog key pattern (JWTs need a `ref` claim) */
  const matchToken = (token: string) => {
    const value = sanitizeValue(token);

    if (value === null) {
      return;
    }

    for (const { provider, envName, regex, isJwt } of KEY_PATTERNS) {
      if (!regex.test(value)) {
        continue;
      }

      if (isJwt && value.startsWith('eyJ')) {
        const payload = decodeJwtPayload(value);

        if (typeof payload?.ref !== 'string') {
          continue; // a JWT without a Supabase project ref is not attributed
        }
      }

      addValue(provider, envName, value);
    }
  };

  // 1. Firebase-style JSON configs map by field name and stop there
  const jsonValues = extractJsonValues(text);

  if (jsonValues && ('apiKey' in jsonValues || 'authDomain' in jsonValues) && 'projectId' in jsonValues) {
    const firebase = INTEGRATION_PROVIDERS.find((p) => p.id === 'firebase');

    if (firebase) {
      for (const [field, envName] of Object.entries(FIREBASE_FIELD_MAP)) {
        if (jsonValues[field]) {
          addValue(firebase, envName, jsonValues[field]);
        }
      }
    }

    return buildResult();
  }

  /**
   * 2. .env blobs: map by variable name. A value that contradicts the name's
   *    own pattern (OPENAI_API_KEY=sk-ant-…) is ALSO pattern-scanned — the
   *    name claim alone then looks like a wrong-var-name paste.
   */
  const nameConsistentValues = new Set<string>();

  for (const [name, rawValue] of extractEnvPairs(text)) {
    const claimants = ENV_NAME_INDEX.get(name) ?? [];

    for (const { provider, envName } of claimants) {
      addValue(provider, envName, rawValue);
    }

    const value = sanitizeValue(rawValue);

    if (value === null) {
      continue;
    }

    const consistent = claimants.some(({ provider, envName }) => {
      const compiled = KEY_PATTERNS.find((p) => p.provider.id === provider.id && p.envName === envName);

      return !compiled || compiled.regex.test(value);
    });

    if (consistent) {
      nameConsistentValues.add(value);
    } else {
      matchToken(rawValue);
    }
  }

  // 3. curl/docs snippets
  for (const token of extractHeaderTokens(text)) {
    matchToken(token);
  }

  // 4. fallback: scan the raw text for any catalog pattern (bare keys)
  for (const { provider, envName, searchRegex, isJwt } of KEY_PATTERNS) {
    for (const match of text.matchAll(searchRegex)) {
      const value = sanitizeValue(match[0]);

      if (value === null || nameConsistentValues.has(value)) {
        continue;
      }

      if (isJwt && value.startsWith('eyJ') && typeof decodeJwtPayload(value)?.ref !== 'string') {
        continue;
      }

      addValue(provider, envName, value);
    }
  }

  return buildResult();

  function buildResult(): PasteCandidate[] {
    const candidates: PasteCandidate[] = [];

    for (const { provider, values } of byProvider.values()) {
      const derived = deriveValues(provider, values);

      candidates.push({ provider, values, derived });
    }

    return candidates.sort((a, b) => Object.keys(b.values).length - Object.keys(a.values).length);
  }
}

/**
 * Fills values that can be computed from the pasted ones. Today: the Supabase
 * project URL from the anon-key JWT's `ref` claim (one paste, both fields).
 */
function deriveValues(provider: IntegrationProvider, values: Record<string, string>): string[] {
  const derived: string[] = [];

  if (provider.id === 'supabase' && values.VITE_SUPABASE_ANON_KEY && !values.VITE_SUPABASE_URL) {
    const payload = decodeJwtPayload(values.VITE_SUPABASE_ANON_KEY);

    if (typeof payload?.ref === 'string' && /^[a-z0-9]{10,}$/.test(payload.ref)) {
      values.VITE_SUPABASE_URL = `https://${payload.ref}.supabase.co`;
      derived.push('VITE_SUPABASE_URL');
    }
  }

  return derived;
}
