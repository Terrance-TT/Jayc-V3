import { DEPLOYMENT_ADDON } from './deployment';
import { INTERACTIVE_ADDON } from './interactive';
import { SECRETS_ADDON } from './secrets';

interface AddonTriggerContext {
  /** the latest user message text */
  userMessage: string;

  /** serialized graphify snapshot, when present */
  projectGraph?: string;
}

// keys/secrets/env-vars concerns — biased to over-trigger: the guidance is harmless when irrelevant
const SECRETS_PATTERN =
  /\b(api[\s_-]?keys?|secrets?|tokens?|env vars?|environment variables?|\.env|clerk|stripe|supabase|firebase|openai|anthropic|moonshot|tavily|openrouter|oauth)\b/i;

// deploying/hosting concerns
const DEPLOYMENT_PATTERN =
  /\b(deploys?|deployment|deploying|railway|vercel|netlify|hosting|docker|production|fly\.io|render\.com)\b/i;

// interactive-visual concerns (canvas/SVG games, simulators, diagrams, trainers)
const INTERACTIVE_PATTERN =
  /\b(canvas|svg|games?|gaming|simulat\w*|animat\w*|diagrams?|visuali\w*|drag(ging)?|physics|charts?|maps?|trainer|arcade|paddle|ball)\b/i;

/**
 * Returns the prompt addon sections relevant to this request, or an empty
 * string when nothing triggers (the default — keeping the prompt lean).
 * Sections are appended after the base system prompt by stream-text.ts.
 */
export function getTriggeredAddons({ userMessage, projectGraph }: AddonTriggerContext): string {
  const addons: string[] = [];

  if (SECRETS_PATTERN.test(userMessage) || (projectGraph ?? '').includes('.env')) {
    addons.push(SECRETS_ADDON);
  }

  if (DEPLOYMENT_PATTERN.test(userMessage)) {
    addons.push(DEPLOYMENT_ADDON);
  }

  if (INTERACTIVE_PATTERN.test(userMessage)) {
    addons.push(INTERACTIVE_ADDON);
  }

  return addons.length > 0 ? `${addons.join('\n')}\n` : '';
}
