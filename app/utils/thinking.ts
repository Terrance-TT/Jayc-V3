/**
 * Thinking-span markers. The server rewrites `reasoning_content` stream
 * deltas into regular text wrapped in these tags (see
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
 * Thinking-clock choice flow (pipeline.ts + api.chat.ts): when the thinking
 * budget runs out on a complex build, the server ends the reply with a
 * choice note carrying this sentinel; the client offers "Think longer" /
 * "Build now" buttons that reply with control tags.
 */
export const THINKING_CHOICE_SENTINEL = '<!--jayc:think-choice-->';

export type ControlChoice = 'think_longer' | 'build_now';

// routing pattern: the whole user message is one control tag
const CONTROL_TAG_FULL_PATTERN = /^\s*<jayc_control>(think_longer|build_now)<\/jayc_control>\s*$/;

export function controlTag(choice: ControlChoice): string {
  return `<jayc_control>${choice}</jayc_control>`;
}

/**
 * Parses a control message from the client. Returns null for anything that
 * is not exactly one control tag.
 */
export function parseControlTag(content: string): ControlChoice | null {
  const match = CONTROL_TAG_FULL_PATTERN.exec(content);

  return match ? (match[1] as ControlChoice) : null;
}

/**
 * Stateless extension counting: prior "think longer" choices in the
 * history, so the server can cap extensions without keeping state.
 */
export function countThinkLongerChoices(messages: Array<{ role: string; content: string }>): number {
  let count = 0;

  for (const message of messages) {
    if (message.role === 'user' && parseControlTag(message.content) === 'think_longer') {
      count += 1;
    }
  }

  return count;
}

/**
 * Replaces control tags with plain-language equivalents so the model sees
 * clean context when the tags ride along in later-turn history.
 */
export function describeControlTags(raw: string): string {
  return raw
    .replace(/<jayc_control>think_longer<\/jayc_control>/g, '(user chose: think longer — keep deepening the design)')
    .replace(/<jayc_control>build_now<\/jayc_control>/g, '(user chose: build now — build from the current design)');
}

/**
 * Renders control tags as friendly labels for display in the chat.
 */
export function displayControlTags(raw: string): string {
  return raw
    .replace(/<jayc_control>think_longer<\/jayc_control>/g, '🧭 Think longer')
    .replace(/<jayc_control>build_now<\/jayc_control>/g, '⌘ Build now');
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
