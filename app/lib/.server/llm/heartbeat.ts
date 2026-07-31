/**
 * An AI data-stream frame carrying an empty text part: protocol-valid and a
 * no-op for the client (it appends an empty string).
 */
const HEARTBEAT_FRAME = new TextEncoder().encode('0:""\n');

const DEFAULT_INTERVAL_MS = 10_000;

/**
 * Wraps a response stream and injects an empty AI-stream text part every
 * `intervalMs`. Reasoning models can think for minutes without emitting a
 * single byte, and a silent stream gets killed mid-generation by idle
 * timeouts — Cloudflare answers with 502/524, browsers with
 * ERR_HTTP2_PROTOCOL_ERROR. Heartbeat frames keep the connection warm from
 * the first token to the last, including the gaps between continuation
 * segments.
 *
 * Frame-safety: the AI data-stream protocol is newline-delimited and the
 * source (SwitchableStream) forwards complete frames, so injecting whole
 * frames between reads can never corrupt a line.
 */
export function withHeartbeat(
  source: ReadableStream<Uint8Array>,
  intervalMs = DEFAULT_INTERVAL_MS,
): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setInterval> | undefined;

  const stopTimer = () => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      timer = setInterval(() => {
        try {
          controller.enqueue(HEARTBEAT_FRAME);
        } catch {
          // stream already closed — stop beating
          stopTimer();
        }
      }, intervalMs);

      const reader = source.getReader();

      try {
        for (;;) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          if (value) {
            controller.enqueue(value);
          }
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        stopTimer();
      }
    },

    cancel(reason) {
      stopTimer();

      return source.cancel(reason);
    },
  });
}
