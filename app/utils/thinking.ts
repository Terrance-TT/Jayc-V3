/**
 * Thinking-span markers. The server rewrites K3's `reasoning_content`
 * stream deltas into regular text wrapped in these tags (see
 * app/lib/.server/llm/reasoning-stream.ts), so Power mode's long reasoning
 * phases render as live progress instead of silence. They are display-only:
 * the artifact parser and the model's own input never see them.
 */
export const THINKING_OPEN_TAG = '<jayc-thinking>';
export const THINKING_CLOSE_TAG = '</jayc-thinking>';

/**
 * Thinking modes selectable per request: 'auto' runs the plan→expand→build
 * pipeline on first builds and stays light on follow-ups, 'turbo' is always
 * a single light pass, 'power' runs the pipeline on every turn. Mirrored
 * client-side (the toggle) and server-side (generation resolution).
 */
export type ThinkingMode = 'auto' | 'turbo' | 'power';

// a span may be unclosed while its thinking text is still streaming in
const THINKING_SPAN_REGEX = /<jayc-thinking>([\s\S]*?)(?:<\/jayc-thinking>|$)/g;

export interface ThinkingExtraction {
  /** concatenated thinking text from all spans (empty when there are none) */
  thinking: string;

  /** the message with every thinking span removed */
  content: string;

  /** true while the last span is still open (reasoning in progress) */
  thinkingInProgress: boolean;
}

/**
 * Splits a message into its thinking text and its thinking-free content.
 */
export function extractThinking(raw: string): ThinkingExtraction {
  if (!hasThinking(raw)) {
    return { thinking: '', content: raw, thinkingInProgress: false };
  }

  const thinkingParts: string[] = [];
  let thinkingInProgress = false;

  const content = raw.replace(THINKING_SPAN_REGEX, (_match, text: string, offset: number, full: string) => {
    thinkingParts.push(text);

    // a span that reaches the end of the string unclosed is still streaming
    if (!full.slice(offset).includes(THINKING_CLOSE_TAG)) {
      thinkingInProgress = true;
    }

    return '';
  });

  return { thinking: thinkingParts.join('\n'), content, thinkingInProgress };
}

/**
 * Returns the message with all thinking spans removed.
 */
export function stripThinking(raw: string): string {
  return extractThinking(raw).content;
}

export function hasThinking(raw: string): boolean {
  return raw.includes(THINKING_OPEN_TAG);
}

/**
 * Clarifying-questions flow (pipeline plan phase): when the request is too
 * ambiguous to plan against, the model is instructed to reply with up to 3
 * short questions starting with the exact marker line `QUESTIONS:`. The
 * server detects the marker to stop the pipeline and to treat the user's
 * answer as pipeline-worthy; the client hides the marker line on display.
 */
export const QUESTIONS_MARKER = 'QUESTIONS:';

/**
 * True when a message is a clarifying-questions reply: its first non-empty
 * line (after removing any thinking spans) is the QUESTIONS: marker.
 */
export function isClarifyingQuestions(raw: string): boolean {
  const content = stripThinking(raw);
  const firstLine = content.split('\n').find((line) => line.trim().length > 0) ?? '';

  return firstLine.trim().toUpperCase().startsWith(QUESTIONS_MARKER);
}

/**
 * Removes the marker line for display (keeps the questions themselves).
 */
export function stripQuestionsMarker(raw: string): string {
  return raw.replace(new RegExp(`^(\\s*)${QUESTIONS_MARKER}\\s*`, 'i'), '$1');
}
