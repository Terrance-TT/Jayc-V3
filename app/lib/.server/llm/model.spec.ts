import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withRetry } from './model';

/**
 * The gateway retry wrapper: 429s and 5xx are routine on shared gateways,
 * and without retries a single transient response killed a whole generation
 * pass. Retries must be bounded, backoff must grow, and non-retryable
 * failures must come back immediately.
 */
describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Drives the wrapped fetch while flushing the backoff timers. */
  async function run(fetchImpl: ReturnType<typeof vi.fn>) {
    const promise = withRetry(fetchImpl)('https://example.com/v1/chat', { method: 'POST' });

    // 3 attempts max → at most 2 backoff waits to flush through
    await vi.advanceTimersByTimeAsync(30_000);

    return promise;
  }

  it('returns a success immediately, without retrying', async () => {
    const stub = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));

    const response = await run(stub);

    expect(response.status).toBe(200);
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 and returns the eventual success', async () => {
    const stub = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const response = await run(stub);

    expect(response.status).toBe(200);
    expect(stub).toHaveBeenCalledTimes(2);
  });

  it('honors Retry-After before the next attempt', async () => {
    const stub = vi
      .fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'retry-after': '5' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const promise = withRetry(stub)('https://example.com/v1/chat', { method: 'POST' });

    // retry-After (5s) plus the standard backoff before the second attempt
    await vi.advanceTimersByTimeAsync(10_000);

    const response = await promise;

    expect(response.status).toBe(200);
    expect(stub).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt ceiling and returns the last failure', async () => {
    const stub = vi.fn().mockImplementation(() => Promise.resolve(new Response('broken', { status: 500 })));

    const response = await run(stub);

    expect(response.status).toBe(500);
    expect(stub).toHaveBeenCalledTimes(3);
  });

  it('retries network-level failures', async () => {
    const stub = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const response = await run(stub);

    expect(response.status).toBe(200);
    expect(stub).toHaveBeenCalledTimes(2);
  });

  it('rethrows when every attempt fails at the network level', async () => {
    const stub = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    const promise = withRetry(stub)('https://example.com/v1/chat', { method: 'POST' });

    /**
     * Attach the rejection handler before flushing timers so vitest never
     * sees an unhandled rejection.
     */
    const assertion = expect(promise).rejects.toThrow('fetch failed');

    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(stub).toHaveBeenCalledTimes(3);
  });

  it('never retries client errors like 400', async () => {
    const stub = vi.fn().mockResolvedValue(new Response('bad request', { status: 400 }));

    const response = await run(stub);

    expect(response.status).toBe(400);
    expect(stub).toHaveBeenCalledTimes(1);
  });
});
