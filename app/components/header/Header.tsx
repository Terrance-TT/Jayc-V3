import { useStore } from '@nanostores/react';
import { useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { FeedbackDialog } from './FeedbackDialog';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { ClerkAuthButtons } from '~/components/auth/ClerkAuthButtons.client';

export function Header() {
  const chat = useStore(chatStore);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <header
      className={classNames(
        'flex items-center bg-bolt-elements-background-depth-1 p-5 border-b h-[var(--header-height)]',
        {
          'border-transparent': !chat.started,
          'border-bolt-elements-borderColor': chat.started,
        },
      )}
    >
      <div className="flex items-center gap-2 z-logo text-bolt-elements-textPrimary cursor-pointer">
        <div className="i-ph:sidebar-simple-duotone text-xl" />
        <a href="/" className="text-2xl font-semibold text-accent flex items-center">
          <span className="text-2xl font-semibold leading-none tracking-tight">Jayc</span>
        </a>
      </div>
      <span className="flex-1 px-4 truncate text-center text-bolt-elements-textPrimary">
        <ClientOnly>{() => <ChatDescription />}</ClientOnly>
      </span>
      {chat.started && (
        <ClientOnly>
          {() => (
            <div className="mr-1">
              <HeaderActionButtons />
            </div>
          )}
        </ClientOnly>
      )}
      <ClientOnly>
        {() => (
          <div className="ml-2 flex items-center gap-2">
            <button
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-bolt-elements-textTertiary hover:bg-bolt-elements-item-backgroundActive hover:text-bolt-elements-textPrimary"
              title="Send feedback — your project comes along so bugs can be reproduced"
              onClick={() => setFeedbackOpen(true)}
            >
              <div className="i-ph:chat-centered-text text-lg" />
              Feedback
            </button>
            <ClerkAuthButtons />
            <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
          </div>
        )}
      </ClientOnly>
    </header>
  );
}
