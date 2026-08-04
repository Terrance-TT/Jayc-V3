import { describe, expect, it } from 'vitest';
import { sanitizeMessagesForModel } from './stream-text';
import type { Messages } from './stream-text';

describe('sanitizeMessagesForModel', () => {
  it('strips thinking scratch from assistant messages', () => {
    const messages: Messages = [
      { role: 'user', content: 'build a thing' },
      { role: 'assistant', content: '<jayc-thinking>scratch</jayc-thinking>Here is the app.' },
    ];

    const result = sanitizeMessagesForModel(messages);

    expect(result).toHaveLength(2);
    expect(result[1].content).toBe('Here is the app.');
  });

  it('drops assistant messages left empty by stripping (pause mid-thinking)', () => {
    const messages: Messages = [
      { role: 'user', content: 'build a thing' },
      { role: 'assistant', content: '<jayc-thinking>partial reasoning, aborted' },
      { role: 'user', content: 'actually build something else' },
    ];

    const result = sanitizeMessagesForModel(messages);

    expect(result.map((message) => message.role)).toEqual(['user', 'user']);
  });

  it('drops messages with literally empty content', () => {
    const messages: Messages = [
      { role: 'user', content: 'build a thing' },
      { role: 'assistant', content: '' },
      { role: 'assistant', content: '   \n  ' },
      { role: 'user', content: 'next request' },
    ];

    expect(sanitizeMessagesForModel(messages).map((message) => message.content)).toEqual([
      'build a thing',
      'next request',
    ]);
  });

  it('translates control tags into plain language', () => {
    const messages: Messages = [{ role: 'user', content: '<jayc_control>build_now</jayc_control>' }];

    const result = sanitizeMessagesForModel(messages);

    expect(result[0].content).toContain('build now');
    expect(result[0].content).not.toContain('<jayc_control>');
  });

  it('keeps ordinary history untouched and in order', () => {
    const messages: Messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'one' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'two' },
    ];

    expect(sanitizeMessagesForModel(messages)).toEqual(messages);
  });
});
