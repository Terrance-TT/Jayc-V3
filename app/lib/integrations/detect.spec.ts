import { describe, expect, it } from 'vitest';
import { findSecrets, maskSecret } from './detect';

describe('findSecrets', () => {
  it('detects common provider keys with the most specific label', () => {
    const cases: Array<[string, string, string | undefined]> = [
      ['sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx', 'Anthropic secret', 'anthropic'],
      ['sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz', 'OpenAI secret', 'openai'],
      ['sk-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890AbCdEf', 'OpenAI secret', 'openai'],
      // assembled from parts so secret scanners don't flag the fixture
      [`sk_live_${'a'.repeat(24)}`, 'Stripe secret', 'stripe'],
      ['ghp_16C7e42F292c6912E7710c838347Ae178B4a', 'GitHub secret', 'github'],
      ['github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz0123456789abcdefghij_', 'GitHub secret', 'github'],
      [`xoxb-${'1'.repeat(12)}-${'2'.repeat(13)}-${'a'.repeat(24)}`, 'Slack secret', 'slack'],
      ['AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe', 'Google AI (Gemini) secret', 'google-ai'],
      ['re_AbCdEfGh_1234567890ijklMNOP', 'Resend secret', 'resend'],
      ['SG.AbCdEfGhIjKlMnOpQr.StUvWxYz1234567890AbCdEfGhIjKlMnOp', 'SendGrid secret', 'sendgrid'],
      ['lin_api_' + 'a'.repeat(40), 'Linear secret', 'linear'],
      ['ntn_' + 'a'.repeat(32), 'Notion secret', 'notion'],
      ['glpat-' + 'a'.repeat(20), 'GitLab secret', 'gitlab'],
    ];

    for (const [key, label, providerId] of cases) {
      const found = findSecrets(`here is my key: ${key} thanks`);
      expect(found.length, `expected exactly one match for ${key}`).toBe(1);
      expect(found[0].label).toBe(label);
      expect(found[0].providerId).toBe(providerId);
      expect(found[0].match).toBe(key);
    }
  });

  it('labels pure-alnum pk_live_/sk_live_ keys as Stripe or Clerk (genuinely ambiguous)', () => {
    const found = findSecrets(`pk_live_${'a'.repeat(24)}`);

    expect(found.length).toBe(1);
    expect(['stripe', 'clerk']).toContain(found[0].providerId);
  });

  it('detects generic shapes (JWT, connection strings, private keys)', () => {
    const jwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${'a'.repeat(30)}.${'b'.repeat(20)}`;

    expect(findSecrets(jwt)[0]?.label).toBe('API token (JWT)');
    expect(findSecrets('DATABASE_URL=postgres://user:pass@host:5432/db')[0]?.label).toBe('database connection string');
    expect(findSecrets('mongodb+srv://u:p@cluster0.example.net/db')[0]?.label).toBe('MongoDB Atlas secret');
    expect(findSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIE...')[0]?.label).toBe('private key block');
  });

  it('deduplicates overlapping patterns by matched text', () => {
    // sk-ant-… matches both the Anthropic catalog pattern and the generic sk- pattern
    const found = findSecrets('sk-ant-' + 'x'.repeat(30));

    expect(found.length).toBe(1);
    expect(found[0].providerId).toBe('anthropic');
  });

  it('does not false-positive on ordinary prose, code, or placeholders', () => {
    const innocent = [
      'OPENAI_API_KEY=paste-your-key-here',
      'VITE_SUPABASE_URL=https://your-project.supabase.co',
      'sk-...',
      'const result = await fetch(url);',
      'I need help setting up my Stripe account, where do I find the key?',
      'the skirt-length is fine',
      'pk_test is short',
    ];

    for (const text of innocent) {
      expect(findSecrets(text), `expected no match in: ${text}`).toEqual([]);
    }
  });
});

describe('maskSecret', () => {
  it('shows only a prefix and the last 4 characters', () => {
    expect(maskSecret('sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx')).toBe('sk-ant-…UvWx');
    expect(maskSecret('ghp_16C7e42F292c6912E7710c838347Ae178B4a')).toBe('ghp_…8B4a');
  });

  it('fully masks short values', () => {
    expect(maskSecret('short')).toBe('•••');
  });
});
