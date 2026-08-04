import { useStore } from '@nanostores/react';
import { memo, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { exportProjectToGitHub, getSavedToken, sanitizeRepoName, saveToken } from '~/lib/github/export';
import { workbenchStore } from '~/lib/stores/workbench';

interface RailwayWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FileDirentLike {
  type: string;
  content?: string;
  isBinary?: boolean;
}

/**
 * Guided publish wizard: Step 1 pushes the project to GitHub (existing
 * export machinery), Step 2 teaches the Railway part with exact click-path
 * instructions (New Project from repo → Variables tab → Settings →
 * Networking → Generate Domain). The Railway API automation proved
 * unreliable against their live schema and was removed (see git history) —
 * guided steps are the dependable path. Server-only guidance (env vars,
 * Volume note) adapts to whether the project actually has a server.
 */
export const RailwayWizardDialog = memo(({ open, onOpenChange }: RailwayWizardDialogProps) => {
  const files = useStore(workbenchStore.files);

  const [step, setStep] = useState<1 | 2>(1);

  // step 1 — GitHub
  const [githubToken, setGithubToken] = useState('');
  const [repoName, setRepoName] = useState('jayc-project');
  const [isPrivate, setIsPrivate] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [repoFullName, setRepoFullName] = useState<string | undefined>(undefined);

  const hasServer = useMemo(
    () =>
      Object.entries(files).some(([path, dirent]) => {
        const file = dirent as FileDirentLike | undefined;

        return (
          file?.type === 'file' &&
          path.endsWith('.ts') &&
          typeof file.content === 'string' &&
          file.content.includes('.listen(')
        );
      }),
    [files],
  );

  const envKeys = useMemo(() => {
    for (const [path, dirent] of Object.entries(files)) {
      const file = dirent as FileDirentLike | undefined;

      if (file?.type === 'file' && /(^|\/)\.env\.example$/.test(path) && typeof file.content === 'string') {
        return file.content
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
          .map((line) => line.split('=')[0]);
      }
    }

    return [];
  }, [files]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setStep(repoFullName ? 2 : 1);
      setGithubToken(getSavedToken());
    }

    onOpenChange(nextOpen);
  };

  const handleExport = async () => {
    if (!githubToken.trim()) {
      toast.error('Paste your GitHub token first');
      return;
    }

    setExporting(true);

    try {
      saveToken(githubToken.trim());

      const result = await exportProjectToGitHub({
        token: githubToken.trim(),
        repoName: sanitizeRepoName(repoName),
        isPrivate,
        files,
      });

      // repoUrl looks like https://github.com/owner/repo
      setRepoFullName(result.repoUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, ''));
      toast.success('Project is on GitHub — now deploy it');
      setStep(2);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'GitHub export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={handleOpenChange}>
      <Dialog className="max-w-[520px]" onBackdrop={() => onOpenChange(false)} onClose={() => onOpenChange(false)}>
        <DialogTitle>Publish your app</DialogTitle>
        <DialogDescription>
          <div className="flex flex-col gap-4">
            {/* step tabs */}
            <div className="flex gap-2 text-sm">
              <div
                className={`flex-1 rounded-md px-3 py-2 text-center ${step === 1 ? 'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent font-medium' : 'bg-bolt-elements-bg-depth-3 text-bolt-elements-textTertiary'}`}
              >
                1 · GitHub
              </div>
              <div
                className={`flex-1 rounded-md px-3 py-2 text-center ${step === 2 ? 'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent font-medium' : 'bg-bolt-elements-bg-depth-3 text-bolt-elements-textTertiary'}`}
              >
                2 · Railway
              </div>
            </div>

            {step === 1 && (
              <>
                <div className="text-sm text-bolt-elements-textSecondary">
                  Your code travels to Railway through a GitHub repo. Paste a token once — it's saved in your browser
                  only. Create one{' '}
                  <a
                    className="text-bolt-elements-item-contentAccent underline"
                    href="https://github.com/settings/tokens/new?scopes=repo&description=Jayc%20publish"
                    target="_blank"
                    rel="noreferrer"
                  >
                    here
                  </a>{' '}
                  ("repo" scope).
                </div>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(event) => setGithubToken(event.target.value)}
                  placeholder="ghp_..."
                  className="w-full rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-bolt-elements-textPrimary focus:outline-none"
                />
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-bolt-elements-textSecondary">Repository name</span>
                  <input
                    type="text"
                    value={repoName}
                    onChange={(event) => setRepoName(event.target.value)}
                    className="w-full rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-bolt-elements-textPrimary focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-bolt-elements-textSecondary">
                  <input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} />
                  Private repository
                </label>
                <div className="flex justify-end gap-2">
                  {repoFullName && (
                    <DialogButton type="secondary" onClick={() => setStep(2)}>
                      Skip to Railway →
                    </DialogButton>
                  )}
                  <DialogButton type="primary" onClick={handleExport}>
                    {exporting ? 'Publishing…' : 'Publish to GitHub'}
                  </DialogButton>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="text-sm text-bolt-elements-textSecondary">
                  {repoFullName
                    ? `Your repo ${repoFullName} is ready. Finish the deploy on Railway:`
                    : 'Finish the deploy on Railway:'}
                </div>

                <a
                  className="inline-flex items-center gap-2 self-start rounded-md bg-bolt-elements-item-backgroundAccent px-3 py-2 text-sm font-medium text-bolt-elements-item-contentAccent"
                  href="https://railway.com/new"
                  target="_blank"
                  rel="noreferrer"
                >
                  <div className="i-ph:arrow-square-out" />
                  Open Railway — New Project
                </a>

                <ol className="list-decimal pl-5 text-sm text-bolt-elements-textSecondary">
                  <li>
                    Choose <b>Deploy from GitHub repo</b>
                    {repoFullName ? ` and pick ${repoFullName}` : ' and pick the repo you just published'} (connect
                    GitHub if Railway asks).
                  </li>
                  {envKeys.length > 0 && (
                    <li>
                      Open the new service → <b>Variables</b> tab → paste your keys:
                      <div className="mt-1 flex flex-col gap-0.5 rounded-md bg-bolt-elements-background-depth-1 px-3 py-2 font-mono text-xs text-bolt-elements-textTertiary">
                        {envKeys.map((key) => (
                          <span key={key}>{key}=…</span>
                        ))}
                      </div>
                    </li>
                  )}
                  <li>
                    Go to <b>Settings → Networking</b> → <b>Generate Domain</b>. If it asks for a port, leave it — your
                    server already reads the port Railway assigns.
                  </li>
                  <li>Wait a minute or two for the build — your app goes live at the generated domain.</li>
                </ol>

                {hasServer && (
                  <div className="text-xs text-bolt-elements-textTertiary">
                    If your app stores data (SQLite), attach a Volume at the data directory: service → Settings →
                    Volumes.
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <DialogButton type="secondary" onClick={() => setStep(1)}>
                    ← GitHub
                  </DialogButton>
                  <DialogButton type="secondary" onClick={() => onOpenChange(false)}>
                    Done
                  </DialogButton>
                </div>
              </>
            )}
          </div>
        </DialogDescription>
      </Dialog>
    </DialogRoot>
  );
});
