import type { Messages } from './stream-text';

/**
 * Replaces the body of superseded file actions with a short pointer.
 * The artifact structure (title, file paths, shell commands) is preserved
 * so the model retains the *history* of what was built without re-reading
 * tens of kilobytes of outdated code per old message.
 */
const PLACEHOLDER = '// (superseded — a newer version of this file appears later in the conversation)';

const FILE_ACTION_PATTERN = /<boltAction\s+type="file"\s+filePath="([^"]*)"\s*>[\s\S]*?<\/boltAction>/g;

const FILE_BODY_PATTERN = /(<boltAction\s+type="file"\s+filePath="[^"]*"\s*>)[\s\S]*?(<\/boltAction>)/;

/**
 * Prunes message history before it is sent to the model.
 *
 * Rule: for every file path, keep the NEWEST version of its contents —
 * wherever in the conversation that version lives — and strip the bodies
 * of all older (superseded) occurrences of that same file.
 *
 * Why per-file instead of per-message: a file written in turn 1 and never
 * modified again must keep its contents even in turn 10, or the model
 * would be editing it blind (the project graph only carries structure,
 * not file bodies). A file rewritten in turn 5 has its turn 1 body
 * stripped, because the turn 5 version is the current one.
 *
 * User messages are never modified (they are small and contain diffs that
 * are essential context). Displayed and persisted history are unaffected —
 * this only transforms the copy sent to the API.
 */
export function pruneMessages(messages: Messages): Messages {
  // 1. locate the last occurrence of every file path across assistant messages
  const lastOccurrence = new Map<string, { messageIndex: number; actionIndex: number }>();

  messages.forEach((message, messageIndex) => {
    if (message.role !== 'assistant') {
      return;
    }

    let actionIndex = 0;

    for (const match of message.content.matchAll(FILE_ACTION_PATTERN)) {
      lastOccurrence.set(match[1], { messageIndex, actionIndex });
      actionIndex++;
    }
  });

  // 2. strip the body of every file action that is not the newest version of its path
  return messages.map((message, messageIndex) => {
    if (message.role !== 'assistant' || !message.content.includes('<boltAction')) {
      return message;
    }

    let actionIndex = 0;

    const content = message.content.replace(FILE_ACTION_PATTERN, (fullMatch, filePath: string) => {
      const currentActionIndex = actionIndex++;
      const last = lastOccurrence.get(filePath);

      if (last && last.messageIndex === messageIndex && last.actionIndex === currentActionIndex) {
        return fullMatch; // newest version of this file — keep the contents
      }

      return fullMatch.replace(FILE_BODY_PATTERN, `$1\n    ${PLACEHOLDER}\n  $2`);
    });

    return { ...message, content };
  });
}
