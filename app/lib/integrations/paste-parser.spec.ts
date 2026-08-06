import { describe, expect, it } from 'vitest';
import { parsePaste, sanitizeValue } from './paste-parser';

const JWT_SEGMENTS = {
  header: 'eyJhbGciOiJIUzI1NiJ9',
  signature: 'x'.repeat(30),
};

function makeJwt(payload: Record<string, unknown>): string {
  return `${JWT_SEGMENTS.header}.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${JWT_SEGMENTS.signature}`;
}

const SUPABASE_JWT = makeJwt({ ref: 'abcdefghijklmnopqrst', role: 'anon' });

describe('sanitizeValue', () => {
  it('strips quotes, whitespace, and trailing commas', () => {
    expect(sanitizeValue('  "sk-ant-abc"  ')).toBe('sk-ant-abc');
    expect(sanitizeValue("'re_abc',")).toBe('re_abc');
  });

  it('rejects empty values and values containing newlines', () => {
    expect(sanitizeValue('   ')).toBeNull();
    expect(sanitizeValue('abc\ndef')).toBeNull();
    expect(sanitizeValue('abc\rdef')).toBeNull();
  });
});

describe('parsePaste', () => {
  it('returns nothing for empty or unrecognized input', () => {
    expect(parsePaste('')).toEqual([]);
    expect(parsePaste('hello world, how do I set up auth?')).toEqual([]);
  });

  it('maps a bare prefixed key to its provider', () => {
    const candidates = parsePaste('sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx');

    expect(candidates.length).toBe(1);
    expect(candidates[0].provider.id).toBe('anthropic');
    expect(candidates[0].values.ANTHROPIC_API_KEY).toBe('sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx');
  });

  it('returns both candidates for a plain sk- key (OpenAI vs Moonshot ambiguity)', () => {
    const key = `sk-${'a'.repeat(48)}`;
    const candidates = parsePaste(key);

    expect(candidates.map((c) => c.provider.id).sort()).toEqual(['moonshot', 'openai']);
  });

  it('distinguishes sk-proj- as OpenAI only', () => {
    const candidates = parsePaste(`sk-proj-${'a'.repeat(40)}`);

    expect(candidates.map((c) => c.provider.id)).toEqual(['openai']);
  });

  it('parses an .env blob with quotes and export prefixes', () => {
    const candidates = parsePaste(
      'export OPENAI_API_KEY="sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890"\nRESEND_API_KEY=re_AbCdEfGh_1234567890ijklMNOP',
    );
    const byId = Object.fromEntries(candidates.map((c) => [c.provider.id, c]));

    expect(byId.openai.values.OPENAI_API_KEY).toBe('sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890');
    expect(byId.resend.values.RESEND_API_KEY).toBe('re_AbCdEfGh_1234567890ijklMNOP');
  });

  it('parses a Firebase JSON config by field name', () => {
    const config = JSON.stringify({
      apiKey: 'AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe',
      authDomain: 'my-app.firebaseapp.com',
      projectId: 'my-app',
      appId: '1:123:web:abc',
    });
    const candidates = parsePaste(config);

    expect(candidates.length).toBe(1);
    expect(candidates[0].provider.id).toBe('firebase');
    expect(candidates[0].values.VITE_FIREBASE_PROJECT_ID).toBe('my-app');
    expect(candidates[0].values.VITE_FIREBASE_API_KEY).toBe('AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe');
  });

  it('derives the Supabase project URL from the anon-key JWT', () => {
    const candidates = parsePaste(SUPABASE_JWT);

    expect(candidates.length).toBe(1);
    expect(candidates[0].provider.id).toBe('supabase');
    expect(candidates[0].values.VITE_SUPABASE_URL).toBe('https://abcdefghijklmnopqrst.supabase.co');
    expect(candidates[0].derived).toEqual(['VITE_SUPABASE_URL']);
  });

  it('does not attribute a JWT without a ref claim to Supabase', () => {
    expect(parsePaste(makeJwt({ sub: 'user_123' }))).toEqual([]);
  });

  it('extracts a bearer token from a curl snippet', () => {
    const candidates = parsePaste(
      `curl https://openrouter.ai/api/v1/chat/completions -H "Authorization: Bearer sk-or-v1-${'a'.repeat(40)}"`,
    );

    expect(candidates.length).toBe(1);
    expect(candidates[0].provider.id).toBe('openrouter');
  });

  it('never lets a pasted blob smuggle extra env lines', () => {
    const candidates = parsePaste(`sk-proj-${'a'.repeat(40)}\nMALICIOUS=1`);

    expect(candidates.length).toBe(1);

    for (const candidate of candidates) {
      expect(Object.keys(candidate.values)).not.toContain('MALICIOUS');

      for (const value of Object.values(candidate.values)) {
        expect(value).not.toMatch(/[\n\r]/);
      }
    }
  });

  it('merges multiple keys of the same provider into one candidate', () => {
    // assembled from parts so secret scanners don't flag the fixtures
    const publishable = `pk_live_${'a'.repeat(24)}`;
    const secret = `sk_live_${'a'.repeat(24)}`;
    const candidates = parsePaste(
      `VITE_STRIPE_PUBLISHABLE_KEY=${publishable}\nSTRIPE_SECRET_KEY=${secret}`,
    );

    expect(candidates.length).toBe(1);
    expect(candidates[0].provider.id).toBe('stripe');
    expect(Object.keys(candidates[0].values).sort()).toEqual(['STRIPE_SECRET_KEY', 'VITE_STRIPE_PUBLISHABLE_KEY']);
  });
});
