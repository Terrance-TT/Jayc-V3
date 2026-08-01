import { modificationsRegex } from '~/utils/diff';
import { displayControlTags } from '~/utils/thinking';
import { Markdown } from './Markdown';

interface UserMessageProps {
  content: string;
}

export function UserMessage({ content }: UserMessageProps) {
  return (
    <div className="overflow-hidden pt-[4px]">
      <Markdown limitedMarkdown>{sanitizeUserMessage(content)}</Markdown>
    </div>
  );
}

function sanitizeUserMessage(content: string) {
  // file-modification markup is hidden; control tags show as friendly labels
  return displayControlTags(content.replace(modificationsRegex, '')).trim();
}
