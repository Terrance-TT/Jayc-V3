import { useStore } from '@nanostores/react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { PanelHeaderButton } from '~/components/ui/PanelHeaderButton';
import { workbenchStore } from '~/lib/stores/workbench';
import { GitHubExportDialog } from '~/components/workbench/GitHubExportButton.client';
import { RailwayWizardDialog } from './RailwayWizardDialog';

/**
 * The single publish entry point in the workbench toolbar: a menu offering
 * "Publish to GitHub" (the classic export dialog) and the guided
 * "Deploy to Railway" wizard (GitHub step included). Replaces the bare
 * Export-to-GitHub button.
 */
export const PublishMenu = memo(() => {
  const files = useStore(workbenchStore.files);
  const [menuOpen, setMenuOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fileCount = useMemo(() => Object.values(files).filter((dirent) => dirent?.type === 'file').length, [files]);

  // close the menu on outside click or Escape
  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div ref={containerRef} className="relative">
      <PanelHeaderButton
        className="mr-1 text-sm text-bolt-elements-item-contentAccent!"
        disabled={fileCount === 0}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <div className="i-ph:rocket-launch" />
        Publish
      </PanelHeaderButton>

      {menuOpen && (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-max w-56 overflow-hidden rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 shadow-[0_16px_40px_rgba(0,0,0,0.35)]">
          <button
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive"
            onClick={() => {
              setMenuOpen(false);
              setGithubOpen(true);
            }}
          >
            <div className="i-ph:github-logo text-lg" />
            <div>
              <div>Publish to GitHub</div>
              <div className="text-xs text-bolt-elements-textTertiary">Push the project to a repo</div>
            </div>
          </button>
          <button
            className="flex w-full items-center gap-2 border-t border-bolt-elements-borderColor px-4 py-3 text-left text-sm text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive"
            onClick={() => {
              setMenuOpen(false);
              setWizardOpen(true);
            }}
          >
            <div className="i-ph:rocket-launch text-lg" />
            <div>
              <div>Deploy to Railway</div>
              <div className="text-xs text-bolt-elements-textTertiary">Guided wizard — GitHub step included</div>
            </div>
          </button>
        </div>
      )}

      <GitHubExportDialog open={githubOpen} onOpenChange={setGithubOpen} files={files} />
      <RailwayWizardDialog open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
});
