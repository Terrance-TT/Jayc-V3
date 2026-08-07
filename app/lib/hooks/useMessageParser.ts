import type { Message } from 'ai';
import { useCallback, useState } from 'react';
import { isDangerousCommand } from '~/lib/runtime/action-runner';
import { StreamingMessageParser } from '~/lib/runtime/message-parser';
import { workbenchStore } from '~/lib/stores/workbench';
import { createScopedLogger } from '~/utils/logger';
import { stripThinking } from '~/utils/thinking';

const logger = createScopedLogger('useMessageParser');

/**
 * When a workspace snapshot was mounted on load (workspace-snapshot.client.ts),
 * the project files and node_modules already exist — executing history
 * actions would rewrite files and reinstall dependencies for no reason.
 * The flag is set before the initial history parse and cleared right after,
 * so only NEW streamed messages execute their actions.
 */
let actionReplaySuppressed = false;

export function setActionReplaySuppressed(suppressed: boolean) {
  actionReplaySuppressed = suppressed;
}

const messageParser = new StreamingMessageParser({
  callbacks: {
    onArtifactOpen: (data) => {
      logger.trace('onArtifactOpen', data);

      workbenchStore.showWorkbench.set(true);
      workbenchStore.addArtifact(data);
    },
    onArtifactClose: (data) => {
      logger.trace('onArtifactClose');

      workbenchStore.updateArtifact(data, { closed: true });
    },
    onActionOpen: (data) => {
      logger.trace('onActionOpen', data.action);

      // we only add shell actions when when the close tag got parsed because only then we have the content
      if (data.action.type !== 'shell') {
        workbenchStore.addAction(data);
      }
    },
    onActionClose: (data) => {
      logger.trace('onActionClose', data.action);

      if (data.action.type === 'shell') {
        /**
         * Shell actions auto-run by default: they come from our own
         * pipeline, and a command left pending means a broken app for a
         * user who may never see a terminal. Only denylisted destructive
         * commands (isDangerousCommand) stay gated behind the manual
         * "Run command" button in the artifact.
         */
        workbenchStore.addAction(data);

        if (!actionReplaySuppressed && !isDangerousCommand(data.action.content)) {
          workbenchStore.runAction(data);
        }

        return;
      }

      if (!actionReplaySuppressed) {
        workbenchStore.runAction(data);
      }
    },
  },
});

export function useMessageParser() {
  const [parsedMessages, setParsedMessages] = useState<{ [key: number]: string }>({});

  const parseMessages = useCallback((messages: Message[], isLoading: boolean) => {
    let reset = false;

    if (import.meta.env.DEV && !isLoading) {
      reset = true;
      messageParser.reset();
    }

    for (const [index, message] of messages.entries()) {
      if (message.role === 'assistant') {
        /**
         * Thinking spans are display-only scratch: reasoning text may draft
         * artifact-like markup, so it must never reach the artifact parser.
         */
        const newParsedContent = messageParser.parse(message.id, stripThinking(message.content));

        setParsedMessages((prevParsed) => ({
          ...prevParsed,
          [index]: !reset ? (prevParsed[index] || '') + newParsedContent : newParsedContent,
        }));
      }
    }
  }, []);

  return { parsedMessages, parseMessages };
}
