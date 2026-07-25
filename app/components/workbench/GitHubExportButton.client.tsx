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

export const GitHubExportButton = memo(() => {
  const files = useStore(workbenchStore.files);

  const [isOpen, setIsOpen] = useState(false);
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

  const openDialog = () => {
    setToken(getSavedToken());
    setResult(undefined);
    setIsOpen(true);
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

      toast.success(
        exportResult.updatedExisting
          ? `Updated ${exportResult.repoUrl.split('/').slice(-2).join('/')} — ${exportResult.fileCount} files pushed${skippedNote}`
          : `Project exported — ${exportResult.fileCount} files pushed${skippedNote}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to export to GitHub');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <PanelHeaderButton className="mr-1 text-sm" disabled={fileStats.fileCount === 0} onClick={openDialog}>
        <div className="i-ph:github-logo" />
        Export to GitHub
      </PanelHeaderButton>
      <DialogRoot open={isOpen} onOpenChange={setIsOpen}>
        <Dialog onBackdrop={() => setIsOpen(false)} onClose={() => setIsOpen(false)}>
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

              <div className="text-xs text-bolt-elements-textTertiary">
                Tip: keep secrets out of git — a .gitignore covering .env is added automatically to your export.
              </div>

              {fileStats.hasEnvFile && (
                <div className="rounded-md border-2 border-red-500 bg-bolt-elements-background-depth-2 px-4 py-3">
                  <div className="mb-2 flex items-center gap-2 text-base font-bold text-red-500">
                    <div className="i-ph:warning text-xl" />
                    IMPORTANT — READ BEFORE EXPORTING
                  </div>
                  <div className="text-sm text-bolt-elements-textSecondary">
                    This export uploads ALL project files to GitHub exactly as they are — including any .env files
                    containing your secret API keys.
                  </div>
                  <ul className="mt-2 list-disc pl-5 text-sm text-bolt-elements-textSecondary">
                    <li>For LOCAL development, it is safe to hardcode secrets in a .env file.</li>
                    <li>
                      If you want to PUBLISH your project on the web, do NOT rely on .env files — store your secrets in
                      your hosting platform's environment variable settings (e.g. your Cloudflare / Netlify / Vercel
                      dashboard).
                    </li>
                    <li>
                      If your repository is PUBLIC, anyone on the internet can see and steal your keys. You are
                      responsible for any charges or misuse that result.
                    </li>
                  </ul>
                  <div className="mt-2 text-sm font-bold text-bolt-elements-textPrimary">
                    By exporting, you acknowledge this and accept full responsibility for any secrets included in the
                    export.
                  </div>
                  <div className="mt-2 text-xs text-bolt-elements-textTertiary">
                    Questions? Email{' '}
                    <a className="text-bolt-elements-item-contentAccent underline" href="mailto:yungyungadam@gmail.com">
                      yungyungadam@gmail.com
                    </a>
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
                <DialogButton type="secondary" onClick={() => setIsOpen(false)}>
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
    </>
  );
});
