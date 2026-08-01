import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';

interface ByokConfig {
  apiKey: string;
  model: string;
}

interface ByokDialogProps {
  open: boolean;
  initialKey: string;
  initialModel: string;
  onOpenChange: (open: boolean) => void;
  onSave: (config: ByokConfig) => void;
  onClear: () => void;
}

/**
 * A few well-known free OpenRouter models, offered as datalist suggestions
 * only — any model id is accepted. Free-model lineups change often, hence
 * the pointer to the live list.
 */
const FREE_MODEL_SUGGESTIONS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-chat-v3-0324:free',
  'google/gemma-3-27b-it:free',
];

/**
 * Bring-your-own-key settings: the user's OpenRouter key + model. The key
 * lives in the browser's localStorage only and is sent with each request;
 * the server pins the OpenRouter base URL and never persists it.
 */
export function ByokDialog({ open, initialKey, initialModel, onOpenChange, onSave, onClear }: ByokDialogProps) {
  const [apiKey, setApiKey] = useState(initialKey);
  const [model, setModel] = useState(initialModel);

  // refresh the fields every time the dialog opens
  useEffect(() => {
    if (open) {
      setApiKey(initialKey);
      setModel(initialModel);
    }
  }, [open, initialKey, initialModel]);

  const save = () => {
    const trimmedKey = apiKey.trim();
    const trimmedModel = model.trim();

    if (trimmedKey.length < 8 || trimmedModel.length === 0) {
      toast.error('Enter both your OpenRouter API key and a model name.');

      return;
    }

    onSave({ apiKey: trimmedKey, model: trimmedModel });
    onOpenChange(false);
    toast.success(`BYOK active — requests now use ${trimmedModel} with your key.`);
  };

  const clear = () => {
    onClear();
    onOpenChange(false);
    toast.info('BYOK cleared — back to the built-in model.');
  };

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <Dialog>
        <DialogTitle>Use your own API key (BYOK)</DialogTitle>
        <DialogDescription asChild>
          <div className="space-y-4">
            <p className="text-sm text-bolt-elements-textSecondary">
              Jayc runs on your own{' '}
              <a
                href="https://openrouter.ai/models?q=free"
                target="_blank"
                rel="noreferrer"
                className="text-bolt-elements-messages-linkColor underline"
              >
                OpenRouter
              </a>{' '}
              key. Free models are available, so it costs you nothing — and it costs us nothing either: the key lives in
              your browser only and is sent with each request, never stored on our servers.
            </p>
            <div>
              <label className="block text-xs font-medium mb-1 text-bolt-elements-textSecondary">
                OpenRouter API key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-or-..."
                className="w-full px-3 py-2 rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary text-sm focus:outline-none focus:border-bolt-elements-borderColorActive"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-bolt-elements-textSecondary">Model</label>
              <input
                type="text"
                list="byok-free-models"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={FREE_MODEL_SUGGESTIONS[0]}
                className="w-full px-3 py-2 rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary text-sm focus:outline-none focus:border-bolt-elements-borderColorActive"
              />
              <datalist id="byok-free-models">
                {FREE_MODEL_SUGGESTIONS.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
              <p className="mt-1 text-xs text-bolt-elements-textTertiary">
                Any OpenRouter model id works — free ones end in <code>:free</code>.
              </p>
            </div>
            <div className="flex justify-between pt-2">
              <DialogButton type="secondary" onClick={clear}>
                Clear
              </DialogButton>
              <DialogButton type="primary" onClick={save}>
                Save
              </DialogButton>
            </div>
          </div>
        </DialogDescription>
      </Dialog>
    </DialogRoot>
  );
}
