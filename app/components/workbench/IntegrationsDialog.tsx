import { useStore } from '@nanostores/react';
import { memo, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { INTEGRATION_PROVIDERS, type IntegrationProvider } from '~/lib/integrations/catalog';
import { workbenchStore } from '~/lib/stores/workbench';
import { webcontainer } from '~/lib/webcontainer';

interface IntegrationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FileDirentLike {
  type: string;
  content?: string;
}

/** merges KEY=VALUE entries into existing .env text (replace in place, append new) */
function mergeEnv(existing: string, entries: Record<string, string>): string {
  const lines = existing.split('\n').filter((line) => line.trim().length > 0);

  for (const [key, value] of Object.entries(entries)) {
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));

    if (index >= 0) {
      lines[index] = `${key}=${value}`;
    } else {
      lines.push(`${key}=${value}`);
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Guided setup for common app integrations (Clerk, Stripe, Supabase). These
 * providers have no provisioning API, so the panel captures the keys with
 * exact click-paths and deep links, then writes them into the project's
 * .env inside the WebContainer — the user never touches a file.
 */
export const IntegrationsDialog = memo(({ open, onOpenChange }: IntegrationsDialogProps) => {
  const files = useStore(workbenchStore.files);

  const [provider, setProvider] = useState<IntegrationProvider | undefined>(undefined);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setProvider(undefined);
      setValues({});
    }

    onOpenChange(nextOpen);
  };

  const existingEnv = (): string => {
    for (const [path, dirent] of Object.entries(files)) {
      const file = dirent as FileDirentLike | undefined;

      if (file?.type === 'file' && /(^|\/)\.env$/.test(path) && typeof file.content === 'string') {
        return file.content;
      }
    }

    return '';
  };

  const handleSave = async () => {
    if (!provider) {
      return;
    }

    const entries = Object.fromEntries(
      provider.keys.map((key) => [key.name, (values[key.name] ?? '').trim()]).filter(([, value]) => value.length > 0),
    );

    if (Object.keys(entries).length === 0) {
      toast.error('Paste at least one key first');
      return;
    }

    setSaving(true);

    try {
      const container = await webcontainer;

      await container.fs.writeFile('.env', mergeEnv(existingEnv(), entries));

      // keep .env.example complete: add any missing keys with placeholders
      const examplePath = '.env.example';
      const exampleExisting = (() => {
        for (const [path, dirent] of Object.entries(files)) {
          const file = dirent as FileDirentLike | undefined;

          if (file?.type === 'file' && /(^|\/)\.env\.example$/.test(path)) {
            return typeof file.content === 'string' ? file.content : '';
          }
        }

        return '';
      })();

      const placeholders = Object.fromEntries(provider.keys.map((key) => [key.name, 'paste-your-key-here']));
      const mergedExample = mergeEnv(exampleExisting, {});

      const missingLines = Object.keys(placeholders)
        .filter((key) => !mergedExample.includes(`${key}=`))
        .map((key) => `${key}=${placeholders[key]}`);

      if (missingLines.length > 0) {
        await container.fs.writeFile(examplePath, mergedExample + missingLines.join('\n') + '\n');
      }

      toast.success(`${provider.name} keys written to .env — tell Jayc "I added my keys" to continue`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to write .env');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={handleOpenChange}>
      <Dialog className="max-w-[520px]" onBackdrop={() => onOpenChange(false)} onClose={() => onOpenChange(false)}>
        <DialogTitle>Connect an integration</DialogTitle>
        <DialogDescription>
          {!provider ? (
            <div className="flex flex-col gap-2">
              <div className="mb-1 text-sm text-bolt-elements-textSecondary">
                Pick a service — you'll get exact setup steps, and Jayc writes your keys into the project's .env for
                you.
              </div>
              {INTEGRATION_PROVIDERS.map((item) => (
                <button
                  key={item.id}
                  className="flex items-center gap-3 rounded-lg border border-bolt-elements-borderColor px-4 py-3 text-left hover:border-bolt-elements-borderColorActive hover:bg-bolt-elements-item-backgroundAccent"
                  onClick={() => setProvider(item)}
                >
                  <div className={`${item.icon} text-2xl text-bolt-elements-item-contentAccent`} />
                  <div>
                    <div className="text-sm font-medium text-bolt-elements-textPrimary">{item.name}</div>
                    <div className="text-xs text-bolt-elements-textTertiary">{item.blurb}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <div className={`${provider.icon} text-2xl text-bolt-elements-item-contentAccent`} />
                <span className="text-base font-medium text-bolt-elements-textPrimary">{provider.name}</span>
              </div>

              <ol className="list-decimal pl-5 text-sm text-bolt-elements-textSecondary">
                {provider.steps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>

              <a
                className="inline-flex items-center gap-2 self-start rounded-md bg-bolt-elements-item-backgroundAccent px-3 py-2 text-sm font-medium text-bolt-elements-item-contentAccent"
                href={provider.dashboardUrl}
                target="_blank"
                rel="noreferrer"
              >
                <div className="i-ph:arrow-square-out" />
                Open the {provider.name} keys page
              </a>

              {provider.keys.map((key) => (
                <label key={key.name} className="flex flex-col gap-1 text-sm">
                  <span className="text-bolt-elements-textSecondary">
                    {key.label} <span className="font-mono text-xs text-bolt-elements-textTertiary">{key.name}</span>
                  </span>
                  <input
                    type={key.secret ? 'password' : 'text'}
                    value={values[key.name] ?? ''}
                    onChange={(event) => setValues((current) => ({ ...current, [key.name]: event.target.value }))}
                    className="w-full rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-bolt-elements-textPrimary focus:outline-none"
                  />
                </label>
              ))}

              <div className="text-xs text-bolt-elements-textTertiary">
                Keys go straight into the project's .env (git-ignored) — never into source code or chat history.
              </div>

              <div className="flex justify-between">
                <DialogButton type="secondary" onClick={() => setProvider(undefined)}>
                  ← Back
                </DialogButton>
                <DialogButton type="primary" onClick={handleSave}>
                  {saving ? 'Writing…' : 'Save to .env'}
                </DialogButton>
              </div>
            </div>
          )}
        </DialogDescription>
      </Dialog>
    </DialogRoot>
  );
});
