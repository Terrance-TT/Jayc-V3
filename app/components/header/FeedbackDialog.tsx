import { useStore } from '@nanostores/react';
import { memo, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { chatId } from '~/lib/persistence';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// server accepts up to 400KB of project JSON — leave headroom for the rest of the body
const PROJECT_BUDGET = 350_000;

/**
 * Serializes the workspace as { relativePath: contents } for the feedback
 * payload. Binary files are skipped (their paths are listed instead).
 * Returns undefined when the project exceeds the payload budget.
 */
function collectProject(files: ReturnType<typeof workbenchStore.files.get>): {
  json?: string;
  fileCount: number;
} {
  const project: Record<string, string> = {};
  let fileCount = 0;

  for (const [absolutePath, dirent] of Object.entries(files)) {
    if (dirent?.type !== 'file') {
      continue;
    }

    const path = absolutePath.startsWith(WORK_DIR) ? absolutePath.slice(WORK_DIR.length + 1) : absolutePath;

    fileCount++;

    if (!dirent.isBinary && typeof dirent.content === 'string') {
      project[path] = dirent.content;
    }
  }

  const json = JSON.stringify(project);

  return { json: json.length <= PROJECT_BUDGET ? json : undefined, fileCount };
}

/**
 * Feedback box: a message plus the user's project files, attached
 * automatically so bugs can be reproduced without asking for a repo link.
 * Stored server-side (api.feedback.ts); reviewed by the owner.
 */
export const FeedbackDialog = memo(({ open, onOpenChange }: FeedbackDialogProps) => {
  const files = useStore(workbenchStore.files);

  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setMessage('');
      setEmail('');
    }

    onOpenChange(nextOpen);
  };

  const handleSend = async () => {
    if (message.trim().length === 0) {
      toast.error('Write a message first');
      return;
    }

    setSending(true);

    try {
      const { json: project, fileCount } = collectProject(files);

      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          email: email.trim() || undefined,
          chatId: chatId.get(),
          project,
        }),
      });

      if (response.status === 401) {
        toast.error('Sign in to send feedback');
        return;
      }

      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }

      toast.success(
        project
          ? `Feedback sent — thanks! Your project (${fileCount} files) came along so the bug can be reproduced.`
          : 'Feedback sent — thanks! (Project was too large to attach.)',
      );
      onOpenChange(false);
    } catch {
      toast.error('Could not send feedback — please try again');
    } finally {
      setSending(false);
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={handleOpenChange}>
      <Dialog onBackdrop={() => onOpenChange(false)} onClose={() => onOpenChange(false)}>
        <DialogTitle>Send feedback</DialogTitle>
        <DialogDescription>
          <div className="flex flex-col gap-4">
            <div className="text-sm text-bolt-elements-textSecondary">
              Bug, confusing moment, feature idea — tell us. <b>Your project files are attached automatically</b> so the
              problem can be reproduced exactly. Nothing leaves except this report.
            </div>

            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="What happened? What did you expect?"
              rows={5}
              className="w-full resize-none rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary focus:outline-none"
            />

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-bolt-elements-textSecondary">Email (optional — only if you want a reply)</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-bolt-elements-textPrimary focus:outline-none"
              />
            </label>

            <div className="flex justify-end gap-2">
              <DialogButton type="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </DialogButton>
              <DialogButton type="primary" onClick={handleSend}>
                {sending ? 'Sending…' : 'Send feedback'}
              </DialogButton>
            </div>
          </div>
        </DialogDescription>
      </Dialog>
    </DialogRoot>
  );
});
