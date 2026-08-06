import { useStore } from '@nanostores/react';
import { memo, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { INTEGRATION_PROVIDERS, type IntegrationProvider } from '~/lib/integrations/catalog';
import { maskSecret } from '~/lib/integrations/detect';
import { parsePaste, sanitizeValue, type PasteCandidate } from '~/lib/integrations/paste-parser';
import { probeKey } from '~/lib/integrations/probe';
import { integrationsAutoPrompt, integrationsPrefill } from '~/lib/stores/integrations';
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

type SaveBlocker = { kind: 'format' | 'auth'; message: string } | undefined;

/**
 * Guided setup for common app integrations (Clerk, Stripe, Supabase). These
 * providers have no provisioning API, so the panel captures the keys with
 * exact click-paths and deep links, then writes them into the project's
 * .env inside the WebContainer — the user never touches a file.
 *
 * The smart-paste box accepts anything copied from a provider dashboard or
 * docs page (bare key, .env block, JSON config, curl snippet) and maps it
 * onto the right env vars. Keys are validated live against hand-verified
 * catalog endpoints from INSIDE the WebContainer — they never transit
 * Jayc's backend.
 */
export const IntegrationsDialog = memo(({ open, onOpenChange }: IntegrationsDialogProps) => {
  const files = useStore(workbenchStore.files);

  const [provider, setProvider] = useState<IntegrationProvider | undefined>(undefined);
  const [values, setValues] = useState<Record<string, string>>({});
  const [derived, setDerived] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<'idle' | 'verifying' | 'writing'>('idle');
  const [pasteText, setPasteText] = useState('');
  const [pasteFeedback, setPasteFeedback] = useState<string | undefined>(undefined);
  const [candidates, setCandidates] = useState<PasteCandidate[]>([]);
  const [blocker, setBlocker] = useState<SaveBlocker>(undefined);

  const visibleProviders = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return INTEGRATION_PROVIDERS;
    }

    return INTEGRATION_PROVIDERS.filter((item) =>
      [item.name, item.blurb, ...(item.keywords ?? [])].join(' ').toLowerCase().includes(query),
    );
  }, [search]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setProvider(undefined);
      setValues({});
      setDerived([]);
      setSearch('');
      setPasteText('');
      setPasteFeedback(undefined);
      setCandidates([]);
      setBlocker(undefined);
    }

    onOpenChange(nextOpen);
  };

  const applyCandidate = (candidate: PasteCandidate) => {
    setProvider(candidate.provider);
    setValues(candidate.values);
    setDerived(candidate.derived);
    setCandidates([]);
    setBlocker(undefined);

    const detected = Object.entries(candidate.values)
      .map(([name, value]) => `${name} (${maskSecret(value)})`)
      .join(', ');

    setPasteFeedback(
      `Detected ${candidate.provider.name}: ${detected}` +
        (candidate.derived.length > 0 ? ` — ${candidate.derived.join(', ')} filled in automatically` : ''),
    );
  };

  const handlePasteChange = (text: string) => {
    setPasteText(text);

    if (!text.trim()) {
      setCandidates([]);
      setPasteFeedback(undefined);

      return;
    }

    const found = parsePaste(text);

    if (found.length === 1) {
      applyCandidate(found[0]);
    } else if (found.length > 1) {
      setCandidates(found);
      setPasteFeedback('That could be a few things — pick one:');
    } else {
      setCandidates([]);
      setPasteFeedback("Didn't recognize that — pick the service below and paste into its fields instead.");
    }
  };

  // keys intercepted from the chat input arrive here pre-loaded
  useEffect(() => {
    if (!open) {
      return;
    }

    const prefill = integrationsPrefill.get();

    if (prefill) {
      integrationsPrefill.set(undefined);
      handlePasteChange(prefill);
    }
  }, [open]);

  const existingEnv = (): string => {
    for (const [path, dirent] of Object.entries(files)) {
      const file = dirent as FileDirentLike | undefined;

      if (file?.type === 'file' && /(^|\/)\.env$/.test(path) && typeof file.content === 'string') {
        return file.content;
      }
    }

    return '';
  };

  const handleSave = async (force = false) => {
    if (!provider) {
      return;
    }

    const entries: Record<string, string> = {};

    for (const key of provider.keys) {
      const sanitized = sanitizeValue(values[key.name] ?? '');

      if (sanitized !== null) {
        entries[key.name] = sanitized;
      }
    }

    if (Object.keys(entries).length === 0) {
      toast.error('Paste at least one key first');
      return;
    }

    // 1. format check against the catalog patterns
    if (!force) {
      const mismatches = provider.keys.filter((key) => {
        const value = entries[key.name];

        return value && key.pattern && !new RegExp(`^(?:${key.pattern})$`).test(value);
      });

      if (mismatches.length > 0) {
        setBlocker({
          kind: 'format',
          message: `${mismatches.map((key) => key.label).join(', ')} doesn't look like a ${provider.name} value — check you copied the right thing.`,
        });

        return;
      }
    }

    // 2. live probe (inside the WebContainer — the key never leaves the browser)
    if (provider.probe && entries[provider.probe.keyEnv]) {
      setSaving('verifying');

      try {
        const result = await probeKey(provider.probe, entries);

        if (result.status === 'auth_failed' && !force) {
          setBlocker({
            kind: 'auth',
            message: `${provider.name} rejected that key (401) — check you copied the right one.`,
          });
          setSaving('idle');

          return;
        }

        if (result.status === 'ok' && provider.probe.baseUrlEnv && result.endpoint) {
          // regional win: record the endpoint that accepted the key
          if (result.endpoint !== provider.probe.endpoints[0]) {
            entries[provider.probe.baseUrlEnv] = result.endpoint;
          }
        }
      } finally {
        setSaving('idle');
      }
    }

    // 3. write .env + keep .env.example complete
    setSaving('writing');

    try {
      const container = await webcontainer;

      await container.fs.writeFile('.env', mergeEnv(existingEnv(), entries));

      const exampleExisting = (() => {
        for (const [path, dirent] of Object.entries(files)) {
          const file = dirent as FileDirentLike | undefined;

          if (file?.type === 'file' && /(^|\/)\.env\.example$/.test(path)) {
            return typeof file.content === 'string' ? file.content : '';
          }
        }

        return '';
      })();

      const placeholders: Record<string, string> = Object.fromEntries(
        provider.keys.map((key) => [key.name, 'paste-your-key-here']),
      );

      // a recorded regional endpoint is not secret — it belongs in .env.example too
      if (provider.probe?.baseUrlEnv && entries[provider.probe.baseUrlEnv]) {
        placeholders[provider.probe.baseUrlEnv] = entries[provider.probe.baseUrlEnv];
      }

      const mergedExample = mergeEnv(exampleExisting, {});
      const missingLines = Object.entries(placeholders)
        .filter(([name]) => !mergedExample.includes(`${name}=`))
        .map(([name, placeholder]) => `${name}=${placeholder}`);

      if (missingLines.length > 0) {
        await container.fs.writeFile('.env.example', mergedExample + missingLines.join('\n') + '\n');
      }

      // 4. auto-continue: the chat resumes without the user typing anything
      integrationsAutoPrompt.set(
        `I've added my ${provider.name} key(s) (${Object.keys(entries).join(', ')}) to .env — continue.`,
      );

      toast.success(`${provider.name} keys saved to .env — Jayc is continuing`);
      handleOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to write .env');
    } finally {
      setSaving('idle');
    }
  };

  const pasteBox = (
    <textarea
      value={pasteText}
      onChange={(event) => handlePasteChange(event.target.value)}
      placeholder="Smart paste: drop a key, .env block, JSON config, or curl snippet here — we'll sort it out"
      rows={3}
      className="w-full resize-none rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 font-mono text-xs text-bolt-elements-textPrimary focus:outline-none"
    />
  );

  const candidateChips = candidates.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {candidates.map((candidate) => (
        <button
          key={candidate.provider.id}
          className="flex items-center gap-2 rounded-md border border-bolt-elements-borderColor px-3 py-1.5 text-sm text-bolt-elements-textPrimary hover:border-bolt-elements-borderColorActive hover:bg-bolt-elements-item-backgroundAccent"
          onClick={() => applyCandidate(candidate)}
        >
          <div className={`${candidate.provider.icon} text-lg text-bolt-elements-item-contentAccent`} />
          {candidate.provider.name}
          <span className="text-xs text-bolt-elements-textTertiary">
            ({Object.keys(candidate.values).length} value{Object.keys(candidate.values).length > 1 ? 's' : ''})
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <DialogRoot open={open} onOpenChange={handleOpenChange}>
      <Dialog className="max-w-[520px]" onBackdrop={() => onOpenChange(false)} onClose={() => onOpenChange(false)}>
        <DialogTitle>Connect an integration</DialogTitle>
        <DialogDescription>
          {!provider ? (
            <div className="flex flex-col gap-2">
              <div className="mb-1 text-sm text-bolt-elements-textSecondary">
                Paste your key straight in, or pick a service for exact setup steps. Keys go into the project's .env —
                never into source code or chat history.
              </div>
              {pasteBox}
              {pasteFeedback && <div className="text-xs text-bolt-elements-textSecondary">{pasteFeedback}</div>}
              {candidateChips}
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search 40+ services…"
                className="mb-1 w-full rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-sm text-bolt-elements-textPrimary focus:outline-none"
              />
              {visibleProviders.length === 0 && (
                <div className="py-4 text-center text-sm text-bolt-elements-textTertiary">
                  No matches — tell Jayc which service you need in chat instead.
                </div>
              )}
              {visibleProviders.map((item) => (
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

              {pasteBox}
              {pasteFeedback && <div className="text-xs text-bolt-elements-textSecondary">{pasteFeedback}</div>}
              {candidateChips}

              {provider.keys.map((key) => (
                <label key={key.name} className="flex flex-col gap-1 text-sm">
                  <span className="text-bolt-elements-textSecondary">
                    {key.label} <span className="font-mono text-xs text-bolt-elements-textTertiary">{key.name}</span>
                    {derived.includes(key.name) && (
                      <span className="ml-1 text-xs text-bolt-elements-item-contentAccent">(auto-filled)</span>
                    )}
                  </span>
                  <input
                    type={key.secret ? 'password' : 'text'}
                    value={values[key.name] ?? ''}
                    onChange={(event) => setValues((current) => ({ ...current, [key.name]: event.target.value }))}
                    className="w-full rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-2 py-1.5 text-bolt-elements-textPrimary focus:outline-none"
                  />
                </label>
              ))}

              {blocker && (
                <div className="rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm text-bolt-elements-textSecondary">
                  ⚠ {blocker.message}
                  <button
                    className="ml-2 underline text-bolt-elements-textPrimary"
                    onClick={() => {
                      setBlocker(undefined);
                      void handleSave(true);
                    }}
                  >
                    Save anyway
                  </button>
                </div>
              )}

              <div className="text-xs text-bolt-elements-textTertiary">
                Keys go straight into the project's .env (git-ignored) — never into source code or chat history.
                {provider.probe && ' Verification happens inside your browser session, never on our servers.'}
              </div>

              <div className="flex justify-between">
                <DialogButton type="secondary" onClick={() => setProvider(undefined)}>
                  ← Back
                </DialogButton>
                <DialogButton type="primary" onClick={() => void handleSave()}>
                  {saving === 'verifying' ? 'Verifying…' : saving === 'writing' ? 'Writing…' : 'Save to .env'}
                </DialogButton>
              </div>
            </div>
          )}
        </DialogDescription>
      </Dialog>
    </DialogRoot>
  );
});
