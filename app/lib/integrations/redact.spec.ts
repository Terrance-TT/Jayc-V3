import { describe, expect, it } from 'vitest';
import { redactSecrets } from './redact';

describe('redactSecrets', () => {
  it('redacts a key embedded in prose', () => {
    const key = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx';
    const result = redactSecrets(`my key is ${key} please use it`);

    expect(result).toBe('my key is [redacted: Anthropic secret] please use it');
    expect(result).not.toContain(key);
  });

  it('redacts every occurrence of the same key', () => {
    const key = 'ghp_16C7e42F292c6912E7710c838347Ae178B4a';
    const result = redactSecrets(`${key} and again ${key}`);

    expect(result).not.toContain(key);
    expect(result.match(/\[redacted: /g)?.length).toBe(2);
  });

  it('redacts multiple different keys', () => {
    const result = redactSecrets(
      `openai sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz and slack xoxb-${'1'.repeat(12)}-${'2'.repeat(13)}-${'a'.repeat(24)}`,
    );

    expect(result).toContain('[redacted: OpenAI secret]');
    expect(result).toContain('[redacted: Slack secret]');
  });

  it('leaves ordinary text and code untouched', () => {
    const innocent = [
      'OPENAI_API_KEY=paste-your-key-here',
      'const result = await fetch("/v1/models");',
      'how do I get an Anthropic key?',
      'sk-...',
    ];

    for (const text of innocent) {
      expect(redactSecrets(text)).toBe(text);
    }
  });
});
