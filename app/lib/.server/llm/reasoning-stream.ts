import { THINKING_CLOSE_TAG, THINKING_OPEN_TAG } from '~/utils/thinking';

const DATA_PREFIX = 'data:';
const DONE_MARKER = '[DONE]';

interface MoonshotStreamChunk {
  choices?: Array<{
    delta?: {
      content?: unknown;
      reasoning_content?: unknown;
    };
  }>;
}

/**
 * Creates a transform that rewrites Moonshot's `reasoning_content` stream
 * deltas into regular `content` deltas wrapped in <jayc-thinking> markers.
 *
 * Why: K3 always reasons and streams the reasoning as `reasoning_content`,
 * but the pinned @ai-sdk/openai version predates that field and silently
 * drops it — so at higher reasoning efforts the stream looks dead for
 * minutes. Rewriting the deltas upstream of the SDK makes the reasoning
 * visible as live progress. The markers let the client keep reasoning out
 * of the artifact parser and out of the model's own future input (see
 * app/utils/thinking.ts).
 *
 * Defensive by design: anything that is not a parseable SSE `data:` line
 * with a choices[0].delta passes through byte-identical.
 */
export function createReasoningRewriteStream(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let buffer = '';
  let inThinking = false;

  const processLine = (line: string): string => {
    if (!line.startsWith(DATA_PREFIX)) {
      return line;
    }

    const payload = line.slice(DATA_PREFIX.length).trim();

    if (payload.length === 0 || payload === DONE_MARKER) {
      return line;
    }

    let chunk: MoonshotStreamChunk;

    try {
      chunk = JSON.parse(payload) as MoonshotStreamChunk;
    } catch {
      // not a JSON payload — pass the line through untouched
      return line;
    }

    const delta = chunk.choices?.[0]?.delta;

    if (!delta) {
      return line;
    }

    const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '';
    const content = typeof delta.content === 'string' ? delta.content : '';
    let changed = false;

    if (reasoning.length > 0) {
      let injected = reasoning;

      if (!inThinking) {
        injected = THINKING_OPEN_TAG + injected;
        inThinking = true;
      }

      if (content.length > 0) {
        injected += THINKING_CLOSE_TAG + content;
        inThinking = false;
      }

      delta.content = injected;
      changed = true;
    } else if (content.length > 0 && inThinking) {
      delta.content = THINKING_CLOSE_TAG + content;
      inThinking = false;
      changed = true;
    }

    if (delta.reasoning_content !== undefined) {
      delete delta.reasoning_content;
      changed = true;
    }

    return changed ? `${DATA_PREFIX} ${JSON.stringify(chunk)}` : line;
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      const lines = buffer.split('\n');

      // the last fragment may be incomplete — keep it buffered
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        controller.enqueue(encoder.encode(`${processLine(line)}\n`));
      }
    },

    flush(controller) {
      const tail = buffer + decoder.decode();

      if (tail.length > 0) {
        controller.enqueue(encoder.encode(processLine(tail)));
      }
    },
  });
}

/**
 * Wraps a fetch response so reasoning deltas are rewritten on the way
 * through. Only touches streaming SSE bodies — errors, JSON responses, and
 * anything else pass through untouched. The content-length header is
 * dropped because the rewrite changes the body size.
 */
export function rewriteReasoningResponse(response: Response): Response {
  const contentType = response.headers.get('content-type') ?? '';

  if (!response.body || !contentType.includes('text/event-stream')) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');

  return new Response(response.body.pipeThrough(createReasoningRewriteStream()), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
