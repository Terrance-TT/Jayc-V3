import { describe, expect, it } from 'vitest';
import { withHeartbeat } from './heartbeat';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Builds a source that emits each chunk after the matching delay (ms).
 */
function streamFrom(chunks: string[], delays: number[] = []) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let i = 0; i < chunks.length; i++) {
        if (delays[i]) {
          await new Promise((resolve) => setTimeout(resolve, delays[i]));
        }

        controller.enqueue(encoder.encode(chunks[i]));
      }

      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let output = '';

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    output += decoder.decode(value);
  }

  return output;
}

describe('withHeartbeat', () => {
  it('passes source frames through unchanged when the source is fast', async () => {
    const output = await readAll(withHeartbeat(streamFrom(['0:"hi"\n', '0:"there"\n']), 60_000));

    expect(output).toBe('0:"hi"\n0:"there"\n');
  });

  it('injects empty text frames while the source is silent, before the real content', async () => {
    const output = await readAll(withHeartbeat(streamFrom(['0:"done"\n'], [60]), 10));

    expect(output).toContain('0:""\n');
    expect(output).toContain('0:"done"\n');

    // heartbeats always precede the delayed content
    expect(output.indexOf('0:""\n')).toBeLessThan(output.indexOf('0:"done"\n'));
  });

  it('beats multiple times during long silence and still terminates cleanly', async () => {
    const output = await readAll(withHeartbeat(streamFrom(['0:"end"\n'], [100]), 10));
    const beats = output.split('0:""\n').length - 1;

    expect(beats).toBeGreaterThanOrEqual(2);
    expect(output.endsWith('0:"end"\n')).toBe(true);
  });

  it('forwards source errors to the wrapped stream', async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('boom'));
      },
    });

    await expect(readAll(withHeartbeat(failing, 10))).rejects.toThrow('boom');
  });
});
