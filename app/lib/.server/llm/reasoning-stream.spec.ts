import { describe, expect, it } from 'vitest';
import { createReasoningRewriteStream, rewriteReasoningResponse } from './reasoning-stream';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function runThrough(writes: string[]): Promise<string> {
  const stream = createReasoningRewriteStream();
  const writer = stream.writable.getWriter();

  const readPromise = (async () => {
    const reader = stream.readable.getReader();
    let output = '';

    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      output += decoder.decode(value);
    }

    return output;
  })();

  for (const write of writes) {
    await writer.write(encoder.encode(write));
  }

  await writer.close();

  return readPromise;
}

function dataLine(delta: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ id: '1', choices: [{ index: 0, delta }] })}\n`;
}

describe('createReasoningRewriteStream', () => {
  it('rewrites a reasoning-only delta into a tagged content delta', async () => {
    const output = await runThrough([dataLine({ reasoning_content: 'Let me think' })]);

    expect(output).toBe(dataLine({ content: '<jayc-thinking>Let me think' }));
  });

  it('opens the span once across consecutive reasoning deltas', async () => {
    const output = await runThrough([
      dataLine({ reasoning_content: 'First' }),
      dataLine({ reasoning_content: ' second' }),
    ]);

    expect(output).toBe(dataLine({ content: '<jayc-thinking>First' }) + dataLine({ content: ' second' }));
  });

  it('closes the span when real content arrives', async () => {
    const output = await runThrough([dataLine({ reasoning_content: 'Thinking' }), dataLine({ content: 'Hello' })]);

    expect(output).toBe(
      dataLine({ content: '<jayc-thinking>Thinking' }) + dataLine({ content: '</jayc-thinking>Hello' }),
    );
  });

  it('handles a delta carrying both reasoning and content', async () => {
    const output = await runThrough([dataLine({ reasoning_content: 'R', content: 'C' })]);

    expect(output).toBe(dataLine({ content: '<jayc-thinking>R</jayc-thinking>C' }));
  });

  it('passes role deltas, DONE markers, and comments through byte-identical', async () => {
    const input = `: keep-alive\n${dataLine({ role: 'assistant' })}data: [DONE]\n`;
    const output = await runThrough([input]);

    expect(output).toBe(input);
  });

  it('passes non-JSON data lines through untouched', async () => {
    const input = 'data: not json at all\n';
    const output = await runThrough([input]);

    expect(output).toBe(input);
  });

  it('reassembles lines split across network chunks', async () => {
    const whole = dataLine({ reasoning_content: 'split me' });
    const output = await runThrough([whole.slice(0, 12), whole.slice(12, 30), whole.slice(30)]);

    expect(output).toBe(dataLine({ content: '<jayc-thinking>split me' }));
  });

  it('leaves an unclosed span unharmed at the end of the stream', async () => {
    const output = await runThrough([dataLine({ reasoning_content: 'never finishes' })]);

    expect(output).toBe(dataLine({ content: '<jayc-thinking>never finishes' }));
  });
});

describe('rewriteReasoningResponse', () => {
  it('passes non-SSE responses through untouched', async () => {
    const response = new Response('{"error":"nope"}', {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });

    const result = rewriteReasoningResponse(response);

    expect(result.status).toBe(400);
    expect(await result.text()).toBe('{"error":"nope"}');
  });

  it('rewrites SSE bodies and drops content-length', async () => {
    const body = dataLine({ reasoning_content: 'hi' });
    const response = new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'content-length': '999' },
    });

    const result = rewriteReasoningResponse(response);

    expect(result.headers.get('content-length')).toBeNull();
    expect(await result.text()).toBe(dataLine({ content: '<jayc-thinking>hi' }));
  });
});
