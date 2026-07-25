import { useStore } from '@nanostores/react';
import { useRouteLoaderData } from '@remix-run/react';
import { useClerk } from '@clerk/remix';
import type { Message } from 'ai';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import { memo, useEffect, useRef, useState } from 'react';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import { getGraphSnapshot, initGraphify } from '~/lib/graphify';
import { useErrorFeedback, useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { useChatHistory } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { fileModificationsToHTML } from '~/utils/diff';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

const logger = createScopedLogger('Chat');

/**
 * Headroom under the 800_000-character server cap in api.chat.ts (which also
 * counts the project graph snapshot). Long build sessions are trimmed to fit
 * this budget instead of hard-failing with a 413.
 */
const MAX_OUTGOING_MESSAGES_LENGTH = 700_000;

interface RootLoaderData {
  clerkState?: unknown;
}

/**
 * The API routes answer signed-out requests with a JSON 401. Clerk's
 * redirectToSignIn is only callable under ClerkProvider, so this bridge
 * (rendered only when the root loader provided Clerk state) captures it for
 * the fetch handlers below. Clerk sends the user to the sign-in page and
 * back to the current page after they sign in.
 */
let clerkSignInRedirect: (() => void) | undefined;

function ClerkSignInBridge() {
  const { redirectToSignIn } = useClerk();

  useEffect(() => {
    clerkSignInRedirect = () => redirectToSignIn();

    return () => {
      clerkSignInRedirect = undefined;
    };
  }, [redirectToSignIn]);

  return null;
}

function handleAuthRequired(message?: string) {
  toast.error(message ?? 'Please sign in to use the AI builder. Your chats are saved to your account.');

  clerkSignInRedirect?.();
}

/**
 * Returns a copy of the history with the oldest non-system messages dropped
 * until the next request (history + the message about to be sent + the
 * project graph snapshot) fits the client-side budget, or null when nothing
 * needs to be trimmed. The very first user message carries the original
 * project description and is always kept, as are the most recent messages.
 */
function trimMessagesToBudget(
  messages: Message[],
  newMessageContent: string,
  projectGraphLength: number,
): Message[] | null {
  const newMessage = { role: 'user', content: newMessageContent };

  if (JSON.stringify([...messages, newMessage]).length + projectGraphLength <= MAX_OUTGOING_MESSAGES_LENGTH) {
    return null;
  }

  const firstUserMessage = messages.find((message) => message.role === 'user');

  const trimmed = [...messages];

  while (JSON.stringify([...trimmed, newMessage]).length + projectGraphLength > MAX_OUTGOING_MESSAGES_LENGTH) {
    // drop the oldest message that is neither a system message nor the first user message
    const dropIndex = trimmed.findIndex((message) => message.role !== 'system' && message !== firstUserMessage);

    if (dropIndex === -1) {
      break;
    }

    trimmed.splice(dropIndex, 1);
  }

  return trimmed.length === messages.length ? null : trimmed;
}

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory } = useChatHistory();

  const rootData = useRouteLoaderData<RootLoaderData>('root');

  return (
    <>
      {ready && <ChatImpl initialMessages={initialMessages} storeMessageHistory={storeMessageHistory} />}
      {rootData?.clerkState && <ClerkSignInBridge />}
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          /**
           * @todo Handle more types if we need them. This may require extra color palettes.
           */
          switch (type) {
            case 'success': {
              return <div className="i-ph:check-bold text-bolt-elements-icon-success text-2xl" />;
            }
            case 'error': {
              return <div className="i-ph:warning-circle-bold text-bolt-elements-icon-error text-2xl" />;
            }
          }

          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
      />
    </>
  );
}

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
}

export const ChatImpl = memo(({ initialMessages, storeMessageHistory }: ChatProps) => {
  useShortcuts();

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);

  const { showChat } = useStore(chatStore);

  const [animationScope, animate] = useAnimate();

  const { messages, isLoading, input, handleInputChange, setInput, stop, append, setMessages } = useChat({
    api: '/api/chat',
    onResponse: (response) => {
      if (response.status === 401) {
        response
          .clone()
          .json<{ message?: string }>()
          .then((body) => handleAuthRequired(body?.message))
          .catch(() => handleAuthRequired());
      }
    },
    onError: (error) => {
      // 401s are already handled in onResponse with a sign-in redirect.
      if (error.message.includes('auth_required')) {
        return;
      }

      logger.error('Request failed\n\n', error);
      toast.error('There was an error processing your request');
    },
    onFinish: () => {
      logger.debug('Finished streaming');
    },
    initialMessages,
  });

  const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
  const { parsedMessages, parseMessages } = useMessageParser();

  /**
   * Self-healing loop: when a shell command or file write fails at runtime,
   * the ErrorMonitorStore (bridged by useErrorFeedback) automatically asks
   * the model to fix it. Identical errors are deduplicated in the store and
   * the hook enforces a cooldown, so this cannot loop forever.
   */
  useErrorFeedback({
    isLoading,
    sendFixRequest: (message) => {
      toast.info('Detected a runtime error — asking the AI to fix it');

      // attach the graph snapshot like sendMessage does (field omitted when empty)
      const projectGraph = getGraphSnapshot();

      append({ role: 'user', content: message }, { body: projectGraph ? { projectGraph } : {} });
    },
  });

  const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

  useEffect(() => {
    chatStore.setKey('started', initialMessages.length > 0);
  }, []);

  useEffect(() => {
    initGraphify(workbenchStore.files);
  }, []);

  useEffect(() => {
    parseMessages(messages, isLoading);

    if (messages.length > initialMessages.length) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  }, [messages, isLoading, parseMessages]);

  const scrollTextArea = () => {
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.scrollTop = textarea.scrollHeight;
    }
  };

  const abort = () => {
    stop();
    chatStore.setKey('aborted', true);
    workbenchStore.abortAllActions();
  };

  useEffect(() => {
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.style.height = 'auto';

      const scrollHeight = textarea.scrollHeight;

      textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
      textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
    }
  }, [input, textareaRef]);

  const runAnimation = async () => {
    if (chatStarted) {
      return;
    }

    await Promise.all([
      animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
      animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
    ]);

    chatStore.setKey('started', true);

    setChatStarted(true);
  };

  const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
    const _input = messageInput || input;

    if (_input.length === 0 || isLoading) {
      return;
    }

    /**
     * @note (delm) Usually saving files shouldn't take long but it may take longer if there
     * many unsaved files. In that case we need to block user input and show an indicator
     * of some kind so the user is aware that something is happening. But I consider the
     * happy case to be no unsaved files and I would expect users to save their changes
     * before they send another message.
     */
    await workbenchStore.saveAllFiles();

    const fileModifications = workbenchStore.getFileModifcations();

    chatStore.setKey('aborted', false);

    runAnimation();

    // the ai SDK v3 merges `body` into the POST JSON; omit the field when the snapshot is empty
    const projectGraph = getGraphSnapshot();
    const body = projectGraph ? { projectGraph } : {};

    const newMessageContent =
      fileModifications !== undefined ? `${fileModificationsToHTML(fileModifications)}\n\n${_input}` : _input;

    /**
     * Keep the outgoing request below the server-side size cap so long sessions
     * do not hard-fail with a 413: drop the oldest non-system messages first,
     * but always keep the very first user message (the original project
     * description) and the most recent messages. `setMessages` updates the
     * chat state synchronously, so the trimmed history is what `append` sends.
     */
    const trimmedMessages = trimMessagesToBudget(messages, newMessageContent, projectGraph?.length ?? 0);

    if (trimmedMessages) {
      setMessages(trimmedMessages);
      toast.info(
        'This chat got long — the oldest messages were trimmed so the AI can keep working on your project. Your files are not affected.',
      );
    }

    if (fileModifications !== undefined) {
      /**
       * If we have file modifications we append a new user message manually since we have to prefix
       * the user input with the file modifications and we don't want the new user input to appear
       * in the prompt. Using `append` is almost the same as `handleSubmit` except that we have to
       * manually reset the input and we'd have to manually pass in file attachments. However, those
       * aren't relevant here.
       */
      append({ role: 'user', content: newMessageContent }, { body });

      /**
       * After sending a new message we reset all modifications since the model
       * should now be aware of all the changes.
       */
      workbenchStore.resetAllFileModifications();
    } else {
      append({ role: 'user', content: newMessageContent }, { body });
    }

    setInput('');

    resetEnhancer();

    textareaRef.current?.blur();
  };

  const [messageRef, scrollRef] = useSnapScroll();

  return (
    <BaseChat
      ref={animationScope}
      textareaRef={textareaRef}
      input={input}
      showChat={showChat}
      chatStarted={chatStarted}
      isStreaming={isLoading}
      enhancingPrompt={enhancingPrompt}
      promptEnhanced={promptEnhanced}
      sendMessage={sendMessage}
      messageRef={messageRef}
      scrollRef={scrollRef}
      handleInputChange={handleInputChange}
      handleStop={abort}
      messages={messages.map((message, i) => {
        if (message.role === 'user') {
          return message;
        }

        return {
          ...message,
          content: parsedMessages[i] || '',
        };
      })}
      enhancePrompt={() => {
        enhancePrompt(
          input,
          (input) => {
            setInput(input);
            scrollTextArea();
          },
          handleAuthRequired,
        );
      }}
    />
  );
});
