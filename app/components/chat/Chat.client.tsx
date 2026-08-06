import { useStore } from '@nanostores/react';
import { useRouteLoaderData } from '@remix-run/react';
import { useClerk, useAuth } from '@clerk/remix';
import type { Message } from 'ai';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import { memo, useEffect, useRef, useState } from 'react';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import { getGraphSnapshot, initGraphify } from '~/lib/graphify';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { setActionReplaySuppressed } from '~/lib/hooks/useMessageParser';
import { findSecrets, maskSecret, type DetectedSecret } from '~/lib/integrations/detect';
import { chatId, useChatHistory } from '~/lib/persistence';
import {
  loadWorkspaceSnapshot,
  saveWorkspaceSnapshot,
  startWorkspaceDevServer,
} from '~/lib/persistence/workspace-snapshot.client';
import { chatStore } from '~/lib/stores/chat';
import { integrationsAutoPrompt, openIntegrations } from '~/lib/stores/integrations';
import { workbenchStore } from '~/lib/stores/workbench';
import { webcontainer } from '~/lib/webcontainer';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { fileModificationsToHTML } from '~/utils/diff';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import {
  controlTag,
  hasThinking,
  stripThinking,
  THINKING_CHOICE_SENTINEL,
  type ControlChoice,
  type ThinkingMode,
} from '~/utils/thinking';
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

/**
 * Storage key for the thinking-mode preference. Auto is the default: deep
 * plan→expand→build on first builds, fast follow-ups.
 */
const THINKING_MODE_STORAGE_KEY = 'jayc_thinking_mode';
const LEGACY_TURBO_STORAGE_KEY = 'jayc_turbo_mode';

// max cadence for persisting message history while a response is streaming
const STREAMING_SAVE_INTERVAL_MS = 5_000;

// max cadence for exporting workspace snapshots (node_modules included — heavy)
const SNAPSHOT_SAVE_INTERVAL_MS = 60_000;

/**
 * BYOK (bring-your-own-key): the user's OpenRouter key + model, kept in
 * localStorage and sent with each request. Never stored server-side.
 */
const BYOK_KEY_STORAGE = 'jayc_byok_key';
const BYOK_MODEL_STORAGE = 'jayc_byok_model';

/**
 * Session-storage key for a prompt typed while signed out: the sign-in gate
 * stashes it, and it sends itself once the session is active (modal sign-in
 * or full-page redirect return).
 */
const PENDING_PROMPT_STORAGE_KEY = 'jayc_pending_prompt';

interface ByokState {
  apiKey: string;
  model: string;
}

function readByokConfig(): ByokState | null {
  try {
    const apiKey = window.localStorage.getItem(BYOK_KEY_STORAGE)?.trim() ?? '';
    const model = window.localStorage.getItem(BYOK_MODEL_STORAGE)?.trim() ?? '';

    return apiKey.length > 0 && model.length > 0 ? { apiKey, model } : null;
  } catch {
    return null;
  }
}

function readThinkingMode(): ThinkingMode {
  try {
    const stored = window.localStorage.getItem(THINKING_MODE_STORAGE_KEY);

    if (stored === 'auto' || stored === 'turbo' || stored === 'power') {
      return stored;
    }

    // migrate the legacy turbo/power boolean preference
    const legacy = window.localStorage.getItem(LEGACY_TURBO_STORAGE_KEY);

    if (legacy !== null) {
      const migrated: ThinkingMode = legacy === 'false' ? 'power' : 'turbo';

      window.localStorage.setItem(THINKING_MODE_STORAGE_KEY, migrated);
      window.localStorage.removeItem(LEGACY_TURBO_STORAGE_KEY);

      return migrated;
    }

    return 'auto';
  } catch {
    return 'auto';
  }
}

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

/**
 * The sign-in gate for the prompt flow: lets ChatImpl check session state
 * and open the sign-in modal from event handlers, and notifies subscribers
 * when a session becomes active so a stashed prompt can send itself.
 * Registered by the bridge (ClerkProvider trees only); undefined when Clerk
 * is not configured, in which case no gating happens.
 */
interface AuthGate {
  isLoaded: () => boolean;
  isSignedIn: () => boolean;
  openSignIn: () => void;
  subscribe: (listener: () => void) => () => void;
}

let authGate: AuthGate | undefined;

function ClerkSignInBridge() {
  const { redirectToSignIn, openSignIn } = useClerk();
  const { isLoaded, isSignedIn } = useAuth();
  const loadedRef = useRef(false);
  const signedInRef = useRef<boolean | undefined>(undefined);
  const listenersRef = useRef(new Set<() => void>());

  useEffect(() => {
    clerkSignInRedirect = () => redirectToSignIn();

    authGate = {
      isLoaded: () => loadedRef.current,
      isSignedIn: () => signedInRef.current === true,
      openSignIn: () => openSignIn(),
      subscribe: (listener) => {
        listenersRef.current.add(listener);

        return () => {
          listenersRef.current.delete(listener);
        };
      },
    };

    return () => {
      clerkSignInRedirect = undefined;
      authGate = undefined;
    };
  }, [redirectToSignIn, openSignIn]);

  // fire listeners on the signed-out → signed-in transition (modal sign-in)
  useEffect(() => {
    const wasSignedIn = signedInRef.current;

    loadedRef.current = isLoaded;
    signedInRef.current = isSignedIn ?? false;

    if (wasSignedIn === false && signedInRef.current) {
      listenersRef.current.forEach((listener) => listener());
    }
  }, [isLoaded, isSignedIn]);

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
      {/* bridge first: it registers the auth gate before ChatImpl's effects run */}
      {rootData?.clerkState && <ClerkSignInBridge />}
      {ready && <ChatImpl initialMessages={initialMessages} storeMessageHistory={storeMessageHistory} />}
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
  const [factChecking, setFactChecking] = useState(false);
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>(readThinkingMode);
  const [byok, setByok] = useState<ByokState | null>(readByokConfig);

  /**
   * Project-reopen fast path: while a stored workspace snapshot is being
   * attempted, the history parse (and its action replay) waits. Settled
   * immediately for new chats.
   */
  const [restoreSettled, setRestoreSettled] = useState(() => !chatId.get());
  const restoredFromSnapshotRef = useRef(false);
  const lastSnapshotSaveAtRef = useRef(0);

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
      // a 401 was already handled in onResponse with a sign-in redirect
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

  const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

  useEffect(() => {
    chatStore.setKey('started', initialMessages.length > 0);
  }, []);

  useEffect(() => {
    initGraphify(workbenchStore.files);
  }, []);

  /**
   * Fast project reopen: when this chat has a stored workspace snapshot,
   * mount it and skip the history action replay entirely (no file rewrites,
   * no npm reinstall), then restart the dev server from the snapshot.
   * Falls back to the classic replay when no snapshot exists.
   */
  useEffect(() => {
    if (restoreSettled) {
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const id = chatId.get();
        const tree = id ? await loadWorkspaceSnapshot(id) : undefined;

        if (cancelled) {
          return;
        }

        if (tree) {
          setActionReplaySuppressed(true);
          restoredFromSnapshotRef.current = true;

          const container = await webcontainer;
          await container.mount(tree);

          if (!cancelled) {
            void startWorkspaceDevServer();
          }
        }
      } catch (error) {
        logger.error('Workspace snapshot restore failed — falling back to action replay', error);
        setActionReplaySuppressed(false);
        restoredFromSnapshotRef.current = false;
      } finally {
        if (!cancelled) {
          setRestoreSettled(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Persisted-history throttle: while a response is streaming, messages change
   * on every chunk, so saving each time would hammer IndexedDB. Saves are
   * throttled to at most one per STREAMING_SAVE_INTERVAL_MS (latest messages
   * always win), flushed immediately when streaming finishes, and flushed once
   * more on unmount so the final state is never lost.
   */
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Message[] | null>(null);
  const lastSaveAtRef = useRef(0);

  const flushPendingSave = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;

    if (pending) {
      lastSaveAtRef.current = Date.now();
      storeMessageHistory(pending).catch((error) => toast.error(error.message));
    }
  };

  useEffect(() => {
    // wait for the snapshot restore attempt before parsing history
    if (!restoreSettled) {
      return;
    }

    parseMessages(messages, isLoading);

    // the initial history parse ran with action replay suppressed (snapshot restored) — new messages act normally
    if (restoredFromSnapshotRef.current) {
      restoredFromSnapshotRef.current = false;
      setActionReplaySuppressed(false);
    }

    if (messages.length <= initialMessages.length) {
      return;
    }

    /**
     * Record the latest state; when streaming has finished, flush it
     * immediately, otherwise save at a throttled cadence.
     */
    pendingSaveRef.current = messages;

    if (!isLoading) {
      flushPendingSave();

      const id = chatId.get();

      if (id && Date.now() - lastSnapshotSaveAtRef.current > SNAPSHOT_SAVE_INTERVAL_MS) {
        lastSnapshotSaveAtRef.current = Date.now();
        void saveWorkspaceSnapshot(id);
      }

      return;
    }

    if (!saveTimerRef.current) {
      const delay = Math.max(0, STREAMING_SAVE_INTERVAL_MS - (Date.now() - lastSaveAtRef.current));

      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        flushPendingSave();
      }, delay);
    }
  }, [messages, isLoading, parseMessages, restoreSettled]);

  // never lose an in-flight save when the chat unmounts mid-stream
  useEffect(() => flushPendingSave, []);

  /**
   * Best-effort snapshot on exit — the async export may not finish, the
   * throttled saves above are the reliable path.
   */
  useEffect(() => {
    const onPageHide = () => {
      const id = chatId.get();

      if (id) {
        void saveWorkspaceSnapshot(id);
      }
    };

    window.addEventListener('pagehide', onPageHide);

    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  /**
   * Thinking spans are display-only scratch: they stay visible while a
   * response streams so long reasoning phases show live progress, and are
   * stripped the moment it finishes. Keeping them would bloat persisted
   * history and every subsequent request payload with reasoning text.
   */
  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (!messages.some((message) => message.role === 'assistant' && hasThinking(message.content))) {
      return;
    }

    setMessages(
      messages.map((message) =>
        message.role === 'assistant' && hasThinking(message.content)
          ? { ...message, content: stripThinking(message.content) }
          : message,
      ),
    );
  }, [messages, isLoading]);

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

  /**
   * Secret interceptor: a credential pasted into chat would be sent to the
   * AI provider and stored in chat history. Catch it before the send — and
   * before the sign-in gate stashes it — and offer the Integrations panel.
   */
  const [secretWarning, setSecretWarning] = useState<{ text: string; secrets: DetectedSecret[] } | undefined>(
    undefined,
  );
  const skipSecretCheckRef = useRef(false);

  const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
    const _input = messageInput || input;

    if (_input.length === 0 || isLoading) {
      return;
    }

    if (!skipSecretCheckRef.current) {
      const found = findSecrets(_input);

      if (found.length > 0) {
        setSecretWarning({ text: _input, secrets: found });

        return;
      }
    }

    skipSecretCheckRef.current = false;

    /**
     * Sign-in gate: a signed-out user's prompt never dies. It is stashed,
     * the sign-in modal opens, and the pending-prompt effect below sends it
     * once the session is active — generation starts with zero retyping.
     */
    if (authGate?.isLoaded() === true && !authGate.isSignedIn()) {
      try {
        window.sessionStorage.setItem(PENDING_PROMPT_STORAGE_KEY, _input);
      } catch {
        // storage unavailable — the modal still opens, the prompt just won't auto-send
      }

      authGate.openSignIn();

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

    /**
     * The ai SDK v3 merges `body` into the POST JSON; the projectGraph field is
     * omitted when the snapshot is empty. `mode` selects the thinking depth:
     * auto = pipeline on first builds, turbo = single light pass, power =
     * pipeline on every turn.
     */
    const projectGraph = getGraphSnapshot();
    const body = {
      ...(projectGraph ? { projectGraph } : {}),
      mode: thinkingMode,
      ...(byok ? { byok } : {}),
    };

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

  const sendMessageRef = useRef(sendMessage);

  sendMessageRef.current = sendMessage;

  /**
   * Prompts stashed while signing in send themselves once the session is
   * active — after a modal sign-in (bridge listener) and after a full-page
   * redirect return (already signed in on mount).
   */
  useEffect(() => {
    const sendPendingPrompt = () => {
      let pending: string | null = null;

      try {
        pending = window.sessionStorage.getItem(PENDING_PROMPT_STORAGE_KEY);
        window.sessionStorage.removeItem(PENDING_PROMPT_STORAGE_KEY);
      } catch {
        return;
      }

      if (pending && pending.length > 0) {
        setInput(pending);
        void sendMessageRef.current({} as React.UIEvent, pending);
      }
    };

    if (!authGate) {
      return undefined;
    }

    if (authGate.isSignedIn()) {
      sendPendingPrompt();

      return undefined;
    }

    return authGate.subscribe(sendPendingPrompt);
  }, []);

  /**
   * Auto-continue after the Integrations panel saves keys: the panel sets a
   * key-free resume message and the chat sends it, so the model's
   * secrets-handling rules (restart the dev server, keep building) fire
   * without the user typing anything.
   */
  const autoPrompt = useStore(integrationsAutoPrompt);

  useEffect(() => {
    if (!autoPrompt || isLoading) {
      return;
    }

    integrationsAutoPrompt.set(undefined);
    void sendMessageRef.current({} as React.UIEvent, autoPrompt);
  }, [autoPrompt, isLoading]);

  /**
   * Fact-check (user-triggered): searches the web for reference facts about
   * the project domain (via /api.fact-check) and asks the model to compare
   * them against the current project and fix any inaccuracies. Dormant with
   * a friendly notice when the deployment has no TAVILY_API_KEY configured.
   */
  const runFactCheck = async () => {
    if (factChecking || isLoading) {
      return;
    }

    const firstUserMessage = messages.find((message) => message.role === 'user');

    if (!firstUserMessage) {
      return;
    }

    setFactChecking(true);

    try {
      // strip any diff/markup tags from the original request to form the search query
      const query = firstUserMessage.content
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);

      const response = await fetch('/api/fact-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      if (response.status === 401) {
        const body = await response.json<{ message?: string }>().catch((): { message?: string } => ({}));

        handleAuthRequired(body?.message);

        return;
      }

      if (response.status === 501) {
        toast.info('Fact-check is not configured on this deployment yet.');

        return;
      }

      if (response.status === 404) {
        toast.info('No reference facts found for this topic.');

        return;
      }

      if (!response.ok) {
        throw new Error(`Fact-check request failed with status ${response.status}`);
      }

      const { facts } = await response.json<{ facts: string }>();

      const projectGraph = getGraphSnapshot();
      const body = {
        ...(projectGraph ? { projectGraph } : {}),
        mode: thinkingMode,
        ...(byok ? { byok } : {}),
      };

      append(
        {
          role: 'user',
          content: [
            '<fact_check>',
            'Reference facts gathered from the web about this project:',
            '',
            facts,
            '',
            'Compare these facts against the current project (the project graph and the latest file versions in this conversation). If you find inaccuracies, fix them with FULL updated file contents. If everything checks out, briefly say the project is verified — do not change anything.',
            '</fact_check>',
          ].join('\n'),
        },
        { body },
      );
    } catch (error) {
      logger.error('Fact-check failed\n\n', error);
      toast.error('Fact-check failed — please try again');
    } finally {
      setFactChecking(false);
    }
  };

  const cycleThinkingMode = () => {
    setThinkingMode((previous) => {
      const next: ThinkingMode = previous === 'auto' ? 'turbo' : previous === 'turbo' ? 'power' : 'auto';

      try {
        window.localStorage.setItem(THINKING_MODE_STORAGE_KEY, next);
      } catch {
        // storage unavailable (private mode etc.) — keep the in-memory value
      }

      return next;
    });
  };

  const handleByokChange = (config: ByokState | null) => {
    setByok(config);

    try {
      if (config) {
        window.localStorage.setItem(BYOK_KEY_STORAGE, config.apiKey);
        window.localStorage.setItem(BYOK_MODEL_STORAGE, config.model);
      } else {
        window.localStorage.removeItem(BYOK_KEY_STORAGE);
        window.localStorage.removeItem(BYOK_MODEL_STORAGE);
      }
    } catch {
      // storage unavailable — keep the in-memory value
    }
  };

  const [messageRef, scrollRef] = useSnapScroll();

  /**
   * Thinking-clock choice: when the server ends a reply with the choice
   * sentinel (complex build, thinking budget exhausted), offer the two
   * paths. Clicking sends a control message the pipeline routes.
   */
  const lastAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant');
  const thinkingChoiceOffered =
    !isLoading && (lastAssistantMessage?.content.includes(THINKING_CHOICE_SENTINEL) ?? false);

  const handleThinkingChoice = (choice: ControlChoice) => {
    if (isLoading) {
      return;
    }

    const content = controlTag(choice);
    const projectGraph = getGraphSnapshot();
    const body = {
      ...(projectGraph ? { projectGraph } : {}),
      mode: thinkingMode,
      ...(byok ? { byok } : {}),
    };

    // keep the outgoing request under the server cap, same as normal sends
    const trimmedMessages = trimMessagesToBudget(messages, content, projectGraph?.length ?? 0);

    if (trimmedMessages) {
      setMessages(trimmedMessages);
    }

    append({ role: 'user', content }, { body });
  };

  return (
    <>
      <DialogRoot
        open={secretWarning !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setSecretWarning(undefined);
          }
        }}
      >
        <Dialog
          className="max-w-[440px]"
          onBackdrop={() => setSecretWarning(undefined)}
          onClose={() => setSecretWarning(undefined)}
        >
          <DialogTitle>That looks like an API key</DialogTitle>
          <DialogDescription>
            <div className="flex flex-col gap-4">
              <div className="text-sm text-bolt-elements-textSecondary">
                Your message contains what looks like{' '}
                {secretWarning && secretWarning.secrets.length > 1 ? 'live credentials' : 'a live credential'}. Sending
                it to chat shares it with the AI provider and stores it in chat history — the Integrations panel keeps
                it in the project's .env instead.
              </div>
              <div className="flex flex-col gap-1 rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2">
                {secretWarning?.secrets.map((secret, index) => (
                  <div key={index} className="font-mono text-xs text-bolt-elements-textSecondary">
                    {secret.label}: {maskSecret(secret.match)}
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <DialogButton type="secondary" onClick={() => setSecretWarning(undefined)}>
                  Cancel
                </DialogButton>
                <DialogButton
                  type="secondary"
                  onClick={() => {
                    const text = secretWarning?.text;

                    setSecretWarning(undefined);

                    if (text) {
                      skipSecretCheckRef.current = true;
                      void sendMessageRef.current({} as React.UIEvent, text);
                    }
                  }}
                >
                  Send anyway
                </DialogButton>
                <DialogButton
                  type="primary"
                  onClick={() => {
                    const text = secretWarning?.text;

                    setSecretWarning(undefined);

                    if (text) {
                      openIntegrations(text);
                    }
                  }}
                >
                  Move to Integrations
                </DialogButton>
              </div>
            </div>
          </DialogDescription>
        </Dialog>
      </DialogRoot>
      <BaseChat
        ref={animationScope}
        textareaRef={textareaRef}
        input={input}
        showChat={showChat}
        chatStarted={chatStarted}
        isStreaming={isLoading}
        enhancingPrompt={enhancingPrompt}
        promptEnhanced={promptEnhanced}
        factChecking={factChecking}
        factCheck={runFactCheck}
        sendMessage={sendMessage}
        messageRef={messageRef}
        scrollRef={scrollRef}
        handleInputChange={handleInputChange}
        handleStop={abort}
        thinkingMode={thinkingMode}
        onCycleThinkingMode={cycleThinkingMode}
        byokConfig={byok}
        onByokChange={handleByokChange}
        thinkingChoiceOffered={thinkingChoiceOffered}
        onThinkingChoice={handleThinkingChoice}
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
    </>
  );
});
