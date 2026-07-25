import type { Messages } from './stream-text';

/**
 * Replaces the body of superseded file actions with a short pointer.
 * The artifact structure (title, file paths, shell commands) is preserved
 * so the model retains the *history* of what was built without re-reading
 * tens of kilobytes of outdated code per old message.
 */
const PLACEHOLDER =
  '// (superseded — the current state of this file is in the latest artifact, user diffs, and the project graph)';

const FILE_ACTION_PATTERN = /(<boltAction\s+type="file"\s+filePath="[^"]*"\s*>)[\s\S]*?(<\/boltAction>)/g;

/**
 * Prunes message history before it is sent to the model.
 *
 * Rule: every assistant message EXCEPT the most recent one has its file
 * action contents stripped. The latest assistant message stays intact —
 * it carries the current full file contents that the model edits against
 * (the project graph only contains structure, not file bodies).
 *
 * User messages are never modified (they are small and contain diffs that
 * are essential context). Display and persisted history are unaffected —
 * this only transforms the copy sent to the API.
 */
export function pruneMessages(messages: Messages): Messages {
  let lastAssistantIndex = -1;

  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'assistant') {
      lastAssistantIndex = i;
    }
  }

  return messages.map((message, index) => {
    if (message.role !== 'assistant' || index === lastAssistantIndex) {
      return message;
    }

    if (!message.content.includes('<boltAction')) {
      return message;
    }

    return {
      ...message,
      content: message.content.replace(FILE_ACTION_PATTERN, `$1\n    ${PLACEHOLDER}\n  $2`),
    };
  });
}
