import { useStore } from '@nanostores/react';
import { memo, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { chatId, dbPromise, getAll, fetchChatsFromServer, type ChatHistoryItem } from '~/lib/persistence';
import { loadWorkspaceSnapshot } from '~/lib/persistence/workspace-snapshot.client';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';
import type { FileSystemTree } from '@webcontainer/api';

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// server accepts up to 400KB of project JSON — leave headroom for the rest of the body
const PROJECT_BUDGET = 350_000;

/**
 * Serializes the live workspace as { relativePath: contents } for the
 * feedback payload. Binary files are skipped (their paths are listed
 * instead). Returns undefined when the project exceeds the payload budget.
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
 * Serializes a stored workspace snapshot the same way, for feedback sent
 * from the homepage about a project that isn't currently open. Skips
 * node_modules (snapshots include it for fast restores; useless in a bug
 * report) and files that don't decode as UTF-8.
 */
function collectProjectFromSnapshot(tree: FileSystemTree): { json?: string; fileCount: number } {
  const project: Record<string, string> = {};
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let fileCount = 0;

  const walk = (node: FileSystemTree, prefix: string) => {
    for (const [name, entry] of Object.entries(node)) {
      const path = prefix ? `${prefix}/${name}` : name;

      if (name === 'node_modules') {
        continue;
      }

      if ('directory' in entry && entry.directory) {
        walk(entry.directory as FileSystemTree, path);
      } else if ('file' in entry && entry.file) {
        fileCount++;

        try {
          const contents = entry.file.contents;
          project[path] = typeof contents === 'string' ? contents : decoder.decode(contents);
        } catch {
          // binary file — path is still counted, contents skipped
        }
      }
    }
  };

  walk(tree, '');

  const json = JSON.stringify(project);

  return { json: json.length <= PROJECT_BUDGET ? json : undefined, fileCount };
}

/** Local IndexedDB chats merged with the signed-in user's server-side list. */
async function listProjects(): Promise<ChatHistoryItem[]> {
  const db = await dbPromise;
  const [local, remote] = await Promise.all([db ? getAll(db) : [], fetchChatsFromServer()]);

  const merged = new Map<string, ChatHistoryItem>();

  for (const item of local) {
    merged.set(item.id, item);
  }

  for (const item of remote ?? []) {
    if (!merged.has(item.id) || item.timestamp > (merged.get(item.id)?.timestamp ?? '')) {
      merged.set(item.id, item);
    }
  }

  return [...merged.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function projectLabel(item: ChatHistoryItem): string {
  return item.description || item.urlId || item.id;
}

/**
 * Feedback box: a message plus project files, so bugs can be reproduced
 * without asking for a repo link. Inside a project the live workspace is
 * attached automatically; on the homepage the user picks one of their
 * projects (attached from its local snapshot) or sends none. The sender's
 * email is filled in server-side from their sign-in — no field here.
 * Stored server-side (api.feedback.ts); reviewed by the owner.
 */
export const FeedbackDialog = memo(({ open, onOpenChange }: FeedbackDialogProps) => {
  const files = useStore(workbenchStore.files);

  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [projects, setProjects] = useState<ChatHistoryItem[]>([]);
  const [selectedProject, setSelectedProject] = useState('');

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setMessage('');
      setSelectedProject('');

      // the picker only matters on the homepage, but loading is cheap
      listProjects()
        .then(setProjects)
        .catch(() => setProjects([]));
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
      const currentChatId = chatId.get();
      let attachedChatId: string | undefined;
      let project: string | undefined;
      let fileCount = 0;
      let snapshotMissing = false;

      if (currentChatId) {
        // inside a project: attach the live workspace
        ({ json: project, fileCount } = collectProject(files));
        attachedChatId = currentChatId;
      } else if (selectedProject) {
        // homepage: attach the chosen project's local snapshot, if this browser has one
        const snapshot = await loadWorkspaceSnapshot(selectedProject);

        if (snapshot) {
          ({ json: project, fileCount } = collectProjectFromSnapshot(snapshot));
        } else {
          snapshotMissing = true;
        }

        attachedChatId = selectedProject;
      }

      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          chatId: attachedChatId,
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

      if (snapshotMissing) {
        toast.success(
          'Feedback sent — thanks! (Project files were only noted by name — no local copy on this browser.)',
        );
      } else if (project) {
        toast.success(
          `Feedback sent — thanks! Your project (${fileCount} files) came along so the bug can be reproduced.`,
        );
      } else if (attachedChatId) {
        toast.success('Feedback sent — thanks! (Project was too large to attach.)');
      } else {
        toast.success('Feedback sent — thanks!');
      }

      onOpenChange(false);
    } catch {
      toast.error('Could not send feedback — please try again');
    } finally {
      setSending(false);
    }
  };

  const currentChatId = chatId.get();
  const showPicker = !currentChatId && projects.length > 0;

  return (
    <DialogRoot open={open} onOpenChange={handleOpenChange}>
      <Dialog onBackdrop={() => onOpenChange(false)} onClose={() => onOpenChange(false)}>
        <DialogTitle>Send feedback</DialogTitle>
        <DialogDescription>
          <div className="flex flex-col gap-4">
            <div className="text-sm text-bolt-elements-textSecondary">
              Bug, confusing moment, feature idea — tell us.{' '}
              {currentChatId ? (
                <>
                  <b>Your current project is attached automatically</b> so the problem can be reproduced exactly.
                </>
              ) : (
                <>Attach one of your projects so the problem can be reproduced exactly, or send it without one.</>
              )}{' '}
              Replies go to your sign-in email.
            </div>

            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="What happened? What did you expect?"
              rows={5}
              className="w-full resize-none rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textPrimary focus:outline-none"
            />

            {showPicker && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-bolt-elements-textSecondary">Attach a project (optional)</span>
                <select
                  value={selectedProject}
                  onChange={(event) => setSelectedProject(event.target.value)}
                  className="w-full rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-bolt-elements-textPrimary focus:outline-none"
                >
                  <option value="">No project</option>
                  {projects.map((item) => (
                    <option key={item.id} value={item.id}>
                      {projectLabel(item)}
                    </option>
                  ))}
                </select>
              </label>
            )}

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
