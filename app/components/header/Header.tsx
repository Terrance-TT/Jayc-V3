import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { ClerkAuthButtons } from '~/components/auth/ClerkAuthButtons.client';

export function Header() {
  const chat = useStore(chatStore);

  return (
    <header
      className={classNames(
        'flex items-center px-4 h-[var(--header-height)] bg-bolt-elements-background-depth-1/70 backdrop-blur-md border-b',
        {
          'border-transparent': !chat.started,
          'border-bolt-elements-borderColor': chat.started,
        },
      )}
    >
      <div className="flex items-center gap-2 z-logo text-bolt-elements-textPrimary cursor-pointer">
        <div className="i-ph:sidebar-simple-duotone text-xl" />
        <a href="/" className="text-xl font-semibold flex items-center">
          <span className="text-xl font-semibold leading-none tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-accent-300 via-accent-400 to-accent-600">
            Jayc
          </span>
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
          <div className="ml-2 flex items-center">
            <ClerkAuthButtons />
          </div>
        )}
      </ClientOnly>
    </header>
  );
}
