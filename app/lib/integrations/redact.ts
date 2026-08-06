import { findSecrets } from './detect';

/**
 * Replaces detected credentials with `[redacted: <label>]` placeholders.
 * Applied to chat messages before they leave the browser for server-side
 * persistence, so the D1 copy of chat history never holds a live key — even
 * when the user chose "send anyway" in the chat-input interceptor.
 */
export function redactSecrets(text: string): string {
  let result = text;

  for (const { label, match } of findSecrets(text)) {
    result = result.split(match).join(`[redacted: ${label}]`);
  }

  return result;
}
