import { useStore } from '@nanostores/react';
import { memo, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { PanelHeaderButton } from '~/components/ui/PanelHeaderButton';
import {
  exportProjectToGitHub,
  getSavedToken,
  sanitizeRepoName,
  saveToken,
  type GitHubExportResult,
} from '~/lib/github/export';
import { workbenchStore } from '~/lib/stores/workbench';
import type { FileMap } from '~/lib/stores/files';

interface GitHubExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: FileMap;
}

/**
 * The export dialog, shared by the workbench toolbar button and the Publish
 * menu. Owns its token/name state; the GitHub token persists in
 * localStorage only (see lib/github/export).
 */
export const GitHubExportDialog = memo(({ open, onOpenChange, files }: GitHubExportDialogProps) => {
  const [isExporting, setIsExporting] = useState(false);
  const [token, setToken] = useState('');
  const [repoName, setRepoName] = useState('jayc-project');
  const [isPrivate, setIsPrivate] = useState(true);
  const [result, setResult] = useState<GitHubExportResult | undefined>(undefined);

  const fileStats = useMemo(() => {
    let fileCount = 0;
    let hasEnvFile = false;

    for (const [path, dirent] of Object.entries(files)) {
      if (dirent?.type === 'file') {
        fileCount++;

        if (/(^|\/)\.env(\.|$)/.test(path)) {
          hasEnvFile = true;
        }
      }
    }

    return { fileCount, hasEnvFile };
  }, [files]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setToken(getSavedToken());
      setResult(undefined);
    }

    onOpenChange(nextOpen);
  };

  const handleExport = async () => {
    if (!token.trim()) {
      toast.error('Please paste your GitHub token first');
      return;
    }

    setIsExporting(true);
    setResult(undefined);

    try {
      saveToken(token.trim());

      const exportResult = await exportProjectToGitHub({
        token: token.trim(),
        repoName: sanitizeRepoName(repoName),
        isPrivate,
        files,
      });

      setResult(exportResult);

      const skippedNote =
        exportResult.skippedBinary.length > 0 ? ` (${exportResult.skippedBinary.length} binary file(s) skipped)` : '';
      const envNote =
        exportResult.skippedEnv.length > 0
          ? ` — ${exportResult.skippedEnv.length} .env file(s) kept out of the repo (secrets stay local)`
          : '';

      toast.success(
        exportResult.updatedExisting
          ? `Updated ${exportResult.repoUrl.split('/').slice(-2).join('/')} — ${exportResult.fileCount} files pushed${skippedNote}${envNote}`
          : `Project exported — ${exportResult.fileCount} files pushed${skippedNote}${envNote}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to export to GitHub');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={handleOpenChange}>
      <Dialog onBackdrop={() => onOpenChange(false)} onClose={() => onOpenChange(false)}>
        <DialogTitle>Export project to GitHub</DialogTitle>
        <DialogDescription>
          <div className="flex flex-col gap-4">
            <div className="text-sm text-bolt-elements-textSecondary">
              Pushes {fileStats.fileCount} file{fileStats.fileCount === 1 ? '' : 's'} from this project to a GitHub
              repository.
            </div>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-bolt-elements-textSecondary">
                GitHub token — create one{' '}
                <a
                  className="text-bolt-elements-item-contentAccent underline"
                  href="https://github.com/settings/tokens/new?scopes=repo&description=Jayc%20export"
                  target="_blank"
                  rel="noreferrer"
                >
                  here
                </a>{' '}
                (the "repo" scope is required). Saved in your browser only.
              </span>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="ghp_..."
                className="w-full rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-bolt-elements-textPrimary focus:outline-none"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-bolt-elements-textSecondary">Repository name</span>
              <input
                type="text"
                value={repoName}
                onChange={(event) => setRepoName(event.target.value)}
                placeholder="jayc-project"
                className="w-full rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-bolt-elements-textPrimary focus:outline-none"
              />
              <span className="text-xs text-bolt-elements-textTertiary">
                If the name already exists on your account, that repo gets updated instead.
              </span>
            </label>

            <label className="flex items-center gap-2 text-sm text-bolt-elements-textSecondary">
              <input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} />
              Private repository
            </label>

            {fileStats.hasEnvFile && (
              <div className="rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-4 py-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-bolt-elements-textPrimary">
                  <div className="i-ph:shield-check text-lg text-green-500" />
                  Your .env files stay local
                </div>
                <div className="text-sm text-bolt-elements-textSecondary">
                  This project contains .env files. They are <b>never uploaded</b> — only .env.example (placeholders)
                  makes it into the repo. After deploying, add the real values in your host's environment variable
                  settings (e.g. Railway's Variables tab).
                </div>
              </div>
            )}

            {result && (
              <div className="rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm">
                Done!{' '}
                <a
                  className="text-bolt-elements-item-contentAccent underline"
                  href={result.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open your repository
                </a>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <DialogButton type="secondary" onClick={() => onOpenChange(false)}>
                Close
              </DialogButton>
              <DialogButton type="primary" onClick={handleExport}>
                {isExporting ? 'Exporting…' : 'Export'}
              </DialogButton>
            </div>
          </div>
        </DialogDescription>
      </Dialog>
    </DialogRoot>
  );
});

/**
 * Toolbar trigger for the export dialog. The Publish menu is the primary
 * entry point; this stays for direct reuse.
 */
export const GitHubExportButton = memo(() => {
  const files = useStore(workbenchStore.files);
  const [isOpen, setIsOpen] = useState(false);

  const fileCount = useMemo(() => Object.values(files).filter((dirent) => dirent?.type === 'file').length, [files]);

  return (
    <>
      <PanelHeaderButton className="mr-1 text-sm" disabled={fileCount === 0} onClick={() => setIsOpen(true)}>
        <div className="i-ph:github-logo" />
        Export to GitHub
      </PanelHeaderButton>
      <GitHubExportDialog open={isOpen} onOpenChange={setIsOpen} files={files} />
    </>
  );
});
