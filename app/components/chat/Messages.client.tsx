import type { Message } from 'ai';
import React, { useEffect, useState } from 'react';
import { classNames } from '~/utils/classNames';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';

interface MessagesProps {
  id?: string;
  className?: string;
  isStreaming?: boolean;
  messages?: Message[];
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * Live elapsed-time readout while a response streams. Mounted only during
 * streaming, so its timer always starts with the request. Stays hidden for
 * the first few seconds — quick answers don't need a clock.
 */
function StreamingElapsed() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  if (seconds < 5) {
    return null;
  }

  return (
    <div className="text-xs text-bolt-elements-textTertiary">
      Working… {formatElapsed(seconds)} — thinking is capped at ~10 min, then the build runs to completion. You can stop
      anytime.
    </div>
  );
}

export const Messages = React.forwardRef<HTMLDivElement, MessagesProps>((props: MessagesProps, ref) => {
  const { id, isStreaming = false, messages = [] } = props;

  return (
    <div id={id} ref={ref} className={props.className}>
      {messages.length > 0
        ? messages.map((message, index) => {
            const { role, content } = message;
            const isUserMessage = role === 'user';
            const isFirst = index === 0;
            const isLast = index === messages.length - 1;

            // an aborted thinking phase can leave an assistant bubble with no visible content — hide it
            if (!isUserMessage && !isLast && content.trim().length === 0) {
              return null;
            }

            return (
              <div
                key={index}
                className={classNames('flex gap-4 p-6 w-full rounded-[calc(0.75rem-1px)]', {
                  'bg-bolt-elements-messages-background': isUserMessage || !isStreaming || (isStreaming && !isLast),
                  'bg-gradient-to-b from-bolt-elements-messages-background from-30% to-transparent':
                    isStreaming && isLast,
                  'mt-4': !isFirst,
                })}
              >
                {isUserMessage && (
                  <div className="flex items-center justify-center w-[34px] h-[34px] overflow-hidden bg-white text-gray-600 rounded-full shrink-0 self-start">
                    <div className="i-ph:user-fill text-xl"></div>
                  </div>
                )}
                <div className="grid grid-col-1 w-full">
                  {isUserMessage ? <UserMessage content={content} /> : <AssistantMessage content={content} />}
                </div>
              </div>
            );
          })
        : null}
      {isStreaming && (
        <div className="flex flex-col items-center gap-1 w-full mt-4">
          <div className="text-bolt-elements-textSecondary i-svg-spinners:3-dots-fade text-4xl"></div>
          <StreamingElapsed />
        </div>
      )}
      {!isStreaming && messages.length > 0 && (
        <div className="flex justify-center mt-4 mb-2">
          <a
            href="https://patreon.com/Jayc721?utm_medium=unknown&utm_source=join_link&utm_campaign=creatorshare_creator&utm_content=copyLink"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                       bg-[#ecd386] text-[#323232] hover:bg-[#e0c76e] transition-colors shadow-sm"
          >
            <div className="i-ph:heart-fill" />
            Support Jayc on Patreon
          </a>
        </div>
      )}
    </div>
  );
});
