import type { Message } from 'ai';
import React, { type RefCallback, useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { Menu } from '~/components/sidebar/Menu.client';
import { IconButton } from '~/components/ui/IconButton';
import { Workbench } from '~/components/workbench/Workbench.client';
import { classNames } from '~/utils/classNames';
import type { ThinkingMode } from '~/utils/thinking';
import type { ControlChoice } from '~/utils/thinking';
import { ByokDialog } from './ByokDialog';
import { Messages } from './Messages.client';
import { SendButton } from './SendButton.client';

import styles from './BaseChat.module.scss';

interface ByokConfig {
  apiKey: string;
  model: string;
}

interface BaseChatProps {
  textareaRef?: React.RefObject<HTMLTextAreaElement> | undefined;
  messageRef?: RefCallback<HTMLDivElement> | undefined;
  scrollRef?: RefCallback<HTMLDivElement> | undefined;
  showChat?: boolean;
  chatStarted?: boolean;
  isStreaming?: boolean;
  messages?: Message[];
  enhancingPrompt?: boolean;
  promptEnhanced?: boolean;
  factChecking?: boolean;
  thinkingMode?: ThinkingMode;
  byokConfig?: ByokConfig | null;
  thinkingChoiceOffered?: boolean;
  input?: string;
  handleStop?: () => void;
  sendMessage?: (event: React.UIEvent, messageInput?: string) => void;
  handleInputChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  enhancePrompt?: () => void;
  factCheck?: () => void;
  onCycleThinkingMode?: () => void;
  onByokChange?: (config: ByokConfig | null) => void;
  onThinkingChoice?: (choice: ControlChoice) => void;
}

const EXAMPLE_PROMPTS = [
  { text: 'Build a todo app in React using Tailwind' },
  { text: 'Build a simple blog using Astro' },
  { text: 'Create a cookie consent form using Material UI' },
  { text: 'Make a space invaders game' },
  { text: 'How do I center a div?' },
];

const TEXTAREA_MIN_HEIGHT = 76;

const MODE_DISPLAY = {
  auto: {
    icon: 'i-ph:sparkle',
    label: 'Auto',
    title: 'Auto: plans first, thinks deeply, then builds on new projects — fast follow-ups. Click for Turbo.',
  },
  turbo: {
    icon: 'i-ph:lightning-fill',
    label: 'Turbo',
    title: 'Turbo: fastest answers — one light pass on every request. Click for Power.',
  },
  power: {
    icon: 'i-ph:brain',
    label: 'Power',
    title: 'Power: plan → expand → build on every request — deepest, slowest. Click for Auto.',
  },
} as const;

const MODE_HINT = {
  auto: 'Auto: quick plan, deep design, then build on new projects — fast follow-ups.',
  turbo: 'Turbo: fastest answers with light thinking.',
  power: 'Power: plan → expand → build on every request — slowest, deepest.',
} as const;

export const BaseChat = React.forwardRef<HTMLDivElement, BaseChatProps>(
  (
    {
      textareaRef,
      messageRef,
      scrollRef,
      showChat = true,
      chatStarted = false,
      isStreaming = false,
      enhancingPrompt = false,
      promptEnhanced = false,
      factChecking = false,
      thinkingMode = 'auto',
      byokConfig = null,
      thinkingChoiceOffered = false,
      messages,
      input = '',
      sendMessage,
      handleInputChange,
      enhancePrompt,
      factCheck,
      onCycleThinkingMode,
      onByokChange,
      onThinkingChoice,
      handleStop,
    },
    ref,
  ) => {
    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

    const [byokDialogOpen, setByokDialogOpen] = useState(false);
    const byokActive = byokConfig !== null;

    /**
     * The prompt card is shared by the start screen (centered hero) and the
     * in-chat floating dock (pinned to the dock's bottom).
     */
    const promptBox = (
      <>
        {!chatStarted && (
          <div className="mb-4 flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 px-5 py-3 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent text-center">
              <div className="i-ph:lock-key-fill text-lg" />
              <span className="text-sm font-medium">Sign in required to generate code</span>
            </div>
            <p className="text-xs text-bolt-elements-textTertiary text-center max-w-sm">
              Jayc uses modular architecture to generate maintainable, production-ready code.
            </p>
          </div>
        )}
        <div
          className={classNames(
            'shadow-[0_8px_32px_rgba(0,0,0,0.08)] border border-bolt-elements-borderColor focus-within:border-bolt-elements-borderColorActive bg-bolt-elements-prompt-background backdrop-filter backdrop-blur-[8px] rounded-2xl overflow-hidden transition-theme',
          )}
        >
          <textarea
            ref={textareaRef}
            className={`w-full pl-4 pt-4 pr-16 focus:outline-none resize-none text-md text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary bg-transparent`}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                if (event.shiftKey) {
                  return;
                }

                event.preventDefault();

                sendMessage?.(event);
              }
            }}
            value={input}
            onChange={(event) => {
              handleInputChange?.(event);
            }}
            style={{
              minHeight: TEXTAREA_MIN_HEIGHT,
              maxHeight: TEXTAREA_MAX_HEIGHT,
            }}
            placeholder="How can Jayc help you today?"
            translate="no"
          />
          <ClientOnly>
            {() => (
              <SendButton
                show={input.length > 0 || isStreaming}
                isStreaming={isStreaming}
                onClick={(event) => {
                  if (isStreaming) {
                    handleStop?.();
                    return;
                  }

                  sendMessage?.(event);
                }}
              />
            )}
          </ClientOnly>
          <div className="flex justify-between text-sm p-4 pt-2">
            <div className="flex gap-1 items-center flex-wrap">
              <IconButton
                title="Enhance prompt"
                disabled={input.length === 0 || enhancingPrompt}
                className={classNames({
                  'opacity-100!': enhancingPrompt,
                  'text-bolt-elements-item-contentAccent! pr-1.5 enabled:hover:bg-bolt-elements-item-backgroundAccent!':
                    promptEnhanced,
                })}
                onClick={() => enhancePrompt?.()}
              >
                {enhancingPrompt ? (
                  <>
                    <div className="i-svg-spinners:90-ring-with-bg text-bolt-elements-loader-progress text-xl"></div>
                    <div className="ml-1.5">Enhancing prompt...</div>
                  </>
                ) : (
                  <>
                    <div className="i-bolt:stars text-xl"></div>
                    {promptEnhanced && <div className="ml-1.5">Prompt enhanced</div>}
                  </>
                )}
              </IconButton>
              {chatStarted && (
                <IconButton
                  title="Fact-check project against web sources"
                  disabled={isStreaming || factChecking}
                  onClick={() => factCheck?.()}
                >
                  {factChecking ? (
                    <>
                      <div className="i-svg-spinners:90-ring-with-bg text-bolt-elements-loader-progress text-xl"></div>
                      <div className="ml-1.5">Fact-checking...</div>
                    </>
                  ) : (
                    <div className="i-ph:magnifying-glass text-xl"></div>
                  )}
                </IconButton>
              )}
              <IconButton
                title={MODE_DISPLAY[thinkingMode].title}
                className="text-bolt-elements-item-contentAccent!"
                onClick={() => onCycleThinkingMode?.()}
              >
                <div className={`${MODE_DISPLAY[thinkingMode].icon} text-xl`}></div>
                <div className="ml-1.5">{MODE_DISPLAY[thinkingMode].label}</div>
              </IconButton>
              <IconButton
                title={
                  byokActive
                    ? `BYOK active: ${byokConfig.model} via your OpenRouter key. Click to change.`
                    : 'Use your own OpenRouter key (BYOK) — free models available'
                }
                className={classNames({
                  'text-bolt-elements-item-contentAccent!': byokActive,
                })}
                onClick={() => setByokDialogOpen(true)}
              >
                <div className="i-ph:key-fill text-xl"></div>
              </IconButton>
              {thinkingChoiceOffered && (
                <>
                  <IconButton
                    title="Keep deepening the design (about 10 more minutes)"
                    className="text-bolt-elements-item-contentAccent!"
                    onClick={() => onThinkingChoice?.('think_longer')}
                  >
                    <div className="i-ph:brain text-xl"></div>
                    <div className="ml-1.5">Think longer</div>
                  </IconButton>
                  <IconButton
                    title="Build from the current design now — gaps filled with best judgment"
                    className="text-bolt-elements-item-contentAccent!"
                    onClick={() => onThinkingChoice?.('build_now')}
                  >
                    <div className="i-ph:hammer text-xl"></div>
                    <div className="ml-1.5">Build now</div>
                  </IconButton>
                </>
              )}
            </div>
            {input.length > 3 ? (
              <div className="text-xs text-bolt-elements-textTertiary">
                Use <kbd className="kdb">Shift</kbd> + <kbd className="kdb">Return</kbd> for a new line
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-2 text-center text-xs text-bolt-elements-textTertiary">{MODE_HINT[thinkingMode]}</div>
      </>
    );

    return (
      <div
        ref={ref}
        className={classNames(
          styles.BaseChat,
          'relative flex h-full w-full overflow-hidden bg-bolt-elements-background-depth-1',
        )}
        data-chat-visible={showChat}
      >
        <ClientOnly>{() => <Menu />}</ClientOnly>

        {/* the studio canvas — full-bleed behind everything once a chat is running */}
        <ClientOnly>{() => <Workbench chatStarted={chatStarted} isStreaming={isStreaming} />}</ClientOnly>

        {/* in-chat: the conversation floats as a dock over the studio canvas */}
        {!chatStarted ? (
          <div ref={scrollRef} className="flex overflow-y-auto w-full h-full">
            <div className="flex flex-col flex-grow min-h-full w-full">
              <div id="intro" className="mt-[22vh] max-w-chat mx-auto px-6">
                <h1 className="text-6xl text-center font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-accent-300 via-accent-500 to-accent-700 pb-2 mb-3">
                  Where ideas begin
                </h1>
                <p className="mb-10 text-center text-lg text-bolt-elements-textSecondary">
                  Bring ideas to life in seconds or get help on existing projects.
                </p>
              </div>
              <div className="px-6">
                <div className="relative w-full max-w-chat mx-auto z-prompt">
                  {/* ambient glow behind the prompt card */}
                  <div className="absolute -inset-8 rounded-[2.5rem] bg-gradient-to-br from-accent-500/15 via-transparent to-accent-700/10 blur-2xl pointer-events-none" />
                  <div className="relative">{promptBox}</div>
                </div>
              </div>
              <div
                id="examples"
                className="relative w-full max-w-2xl mx-auto mt-10 mb-8 flex flex-col items-center px-6"
              >
                <div className="flex flex-wrap justify-center gap-2">
                  {EXAMPLE_PROMPTS.map((examplePrompt, index) => {
                    return (
                      <button
                        key={index}
                        onClick={(event) => {
                          sendMessage?.(event, examplePrompt.text);
                        }}
                        className="px-4 py-1.5 rounded-full border border-bolt-elements-borderColor bg-bolt-elements-bg-depth-2/60 backdrop-blur-sm text-sm text-bolt-elements-textTertiary hover:text-bolt-elements-item-contentAccent hover:border-bolt-elements-borderColorActive hover:bg-bolt-elements-item-backgroundAccent transition-theme"
                      >
                        {examplePrompt.text}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-6 text-xs text-bolt-elements-textTertiary/60 text-center italic">
                  Jayc is experimental — things might break from time to time, but I am trying my best!
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 z-[4] pointer-events-none">
            <div
              className={classNames(
                styles.Chat,
                'pointer-events-auto absolute left-4 top-4 bottom-4 flex w-[var(--chat-dock-width)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1/85 shadow-[0_24px_64px_rgba(0,0,0,0.4)] backdrop-blur-md',
              )}
            >
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 pt-3">
                <ClientOnly>
                  {() => (
                    <Messages
                      ref={messageRef}
                      className="flex flex-col w-full pb-4"
                      messages={messages}
                      isStreaming={isStreaming}
                    />
                  )}
                </ClientOnly>
              </div>
              <div className="p-3 pt-1">{promptBox}</div>
            </div>
          </div>
        )}
        <ByokDialog
          open={byokDialogOpen}
          initialKey={byokConfig?.apiKey ?? ''}
          initialModel={byokConfig?.model ?? ''}
          onOpenChange={setByokDialogOpen}
          onSave={(config) => onByokChange?.(config)}
          onClear={() => onByokChange?.(null)}
        />
      </div>
    );
  },
);
