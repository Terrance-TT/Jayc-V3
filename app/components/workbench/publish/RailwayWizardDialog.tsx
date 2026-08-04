import { useStore } from '@nanostores/react';
import { memo, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { exportProjectToGitHub, getSavedToken, sanitizeRepoName, saveToken } from '~/lib/github/export';
import {
  createProject,
  createServiceDomain,
  createServiceFromRepo,
  getProductionEnvironmentId,
  getSavedRailwayToken,
  saveRailwayToken,
  triggerDeploy,
  upsertVariable,
  validateRailwayToken,
} from '~/lib/railway/client';
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

type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface DeployStep {
  label: string;
  status: StepStatus;
  detail?: string;
}

/**
 * Guided publish wizard: Step 1 pushes the project to GitHub (existing
 * export machinery), Step 2 deploys it to Railway via their GraphQL API
 * (project → service from repo → env vars → deploy → public domain), with a
 * live checklist so a vibe coder sees exactly where they are. Tokens live
 * in localStorage only. Steps that need a server (env vars, volume) adapt
 * to whether the project actually has one.
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

  // step 2 — Railway
  const [railwayToken, setRailwayToken] = useState('');
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [deploying, setDeploying] = useState(false);
  const [deploySteps, setDeploySteps] = useState<DeployStep[]>([]);
  const [deployedUrl, setDeployedUrl] = useState<string | undefined>(undefined);

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
      setRailwayToken(getSavedRailwayToken());
      setDeploySteps([]);
      setDeployedUrl(undefined);
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

  const setStepState = (index: number, status: StepStatus, detail?: string) => {
    setDeploySteps((steps) => steps.map((stepItem, i) => (i === index ? { ...stepItem, status, detail } : stepItem)));
  };

  const handleDeploy = async () => {
    const token = railwayToken.trim();

    if (!token) {
      toast.error('Paste your Railway token first');
      return;
    }

    if (!repoFullName) {
      toast.error('Publish to GitHub first (step 1)');
      return;
    }

    const steps: DeployStep[] = [
      { label: 'Validating token', status: 'pending' },
      { label: 'Creating project', status: 'pending' },
      { label: `Connecting ${repoFullName}`, status: 'pending' },
      ...(envKeys.length > 0 ? [{ label: 'Setting environment variables', status: 'pending' as StepStatus }] : []),
      { label: 'Deploying', status: 'pending' },
      { label: 'Getting your public URL', status: 'pending' },
    ];

    setDeploySteps(steps);
    setDeploying(true);
    setDeployedUrl(undefined);
    saveRailwayToken(token);

    try {
      setStepState(0, 'active');

      const accountName = await validateRailwayToken(token);

      setStepState(0, 'done', accountName);
      setStepState(1, 'active');

      const projectId = await createProject(token, sanitizeRepoName(repoName));

      setStepState(1, 'done');
      setStepState(2, 'active');

      const environmentId = await getProductionEnvironmentId(token, projectId);
      const serviceId = await createServiceFromRepo(token, projectId, repoFullName, 'web');

      setStepState(2, 'done');

      let nextIndex = 3;

      if (envKeys.length > 0) {
        setStepState(nextIndex, 'active');

        for (const key of envKeys) {
          const value = variableValues[key]?.trim();

          if (value) {
            await upsertVariable(token, { projectId, environmentId, serviceId }, key, value);
          }
        }

        setStepState(nextIndex, 'done');
        nextIndex += 1;
      }

      setStepState(nextIndex, 'active');
      await triggerDeploy(token, serviceId, environmentId);
      setStepState(nextIndex, 'done');
      setStepState(nextIndex + 1, 'active');

      const domain = await createServiceDomain(token, serviceId, environmentId);
      const url = `https://${domain}`;

      setStepState(nextIndex + 1, 'done', url);
      setDeployedUrl(url);
      toast.success('Deployed to Railway');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Deploy failed';

      setDeploySteps((current) => {
        const activeIndex = current.findIndex((stepItem) => stepItem.status === 'active');

        return current.map((stepItem, i) =>
          i === activeIndex ? { ...stepItem, status: 'error', detail: message } : stepItem,
        );
      });
      toast.error(message);
    } finally {
      setDeploying(false);
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
                    ? `Deploying ${repoFullName}. Paste a Railway token — saved in your browser only. Create one at `
                    : 'No GitHub repo yet in this session — go back to step 1, or deploy a repo you exported earlier.'}
                  <a
                    className="text-bolt-elements-item-contentAccent underline"
                    href="https://railway.app/account/tokens"
                    target="_blank"
                    rel="noreferrer"
                  >
                    railway.app/account/tokens
                  </a>
                  .
                </div>
                <input
                  type="password"
                  value={railwayToken}
                  onChange={(event) => setRailwayToken(event.target.value)}
                  placeholder="Railway API token"
                  className="w-full rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-bolt-elements-textPrimary focus:outline-none"
                />

                {hasServer && envKeys.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <div className="text-sm font-medium text-bolt-elements-textSecondary">
                      Environment variables (from your .env.example — leave blank to fill in later on Railway)
                    </div>
                    {envKeys.map((key) => (
                      <label key={key} className="flex items-center gap-2 text-sm">
                        <span className="w-48 truncate font-mono text-xs text-bolt-elements-textTertiary">{key}</span>
                        <input
                          type={/key|secret|token|password/i.test(key) ? 'password' : 'text'}
                          value={variableValues[key] ?? ''}
                          onChange={(event) =>
                            setVariableValues((values) => ({ ...values, [key]: event.target.value }))
                          }
                          className="flex-1 rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-bolt-elements-textPrimary focus:outline-none"
                        />
                      </label>
                    ))}
                  </div>
                )}

                {hasServer && (
                  <div className="text-xs text-bolt-elements-textTertiary">
                    If your app stores data (SQLite), attach a Volume at the data directory in the Railway dashboard
                    after the first deploy.
                  </div>
                )}

                {deploySteps.length > 0 && (
                  <div className="flex flex-col gap-1.5 rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2">
                    {deploySteps.map((deployStep, index) => (
                      <div key={index} className="flex items-center gap-2 text-sm">
                        {deployStep.status === 'done' && <div className="i-ph:check-circle-fill text-green-500" />}
                        {deployStep.status === 'active' && (
                          <div className="i-svg-spinners:90-ring-with-bg text-bolt-elements-loader-progress" />
                        )}
                        {deployStep.status === 'pending' && (
                          <div className="i-ph:circle text-bolt-elements-textTertiary" />
                        )}
                        {deployStep.status === 'error' && <div className="i-ph:x-circle-fill text-red-500" />}
                        <span className="text-bolt-elements-textPrimary">{deployStep.label}</span>
                        {deployStep.detail && (
                          <span className="truncate text-xs text-bolt-elements-textTertiary">{deployStep.detail}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {deployedUrl && (
                  <div className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm">
                    Your app is live:{' '}
                    <a
                      className="text-bolt-elements-item-contentAccent underline"
                      href={deployedUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {deployedUrl}
                    </a>{' '}
                    (first build takes a minute or two)
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <DialogButton type="secondary" onClick={() => setStep(1)}>
                    ← GitHub
                  </DialogButton>
                  <DialogButton type="primary" onClick={handleDeploy}>
                    {deploying ? 'Deploying…' : 'Deploy to Railway'}
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
