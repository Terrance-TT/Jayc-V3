import { atom } from 'nanostores';

/**
 * Cross-component wiring for the Integrations panel: Chat, Workbench, and the
 * dialog itself stay decoupled — they communicate through these atoms.
 */

/** whether the Integrations dialog is open (Workbench renders it) */
export const integrationsDialogOpen = atom<boolean>(false);

/**
 * Raw text pre-loaded into the dialog's smart-paste box — set by the chat
 * interceptor when it catches a key in an outgoing message.
 */
export const integrationsPrefill = atom<string | undefined>(undefined);

/**
 * A key-free "I've added my keys" message the chat sends automatically after
 * a successful save (auto-continue) — Chat.client.tsx consumes and clears it.
 */
export const integrationsAutoPrompt = atom<string | undefined>(undefined);

export function openIntegrations(prefill?: string) {
  integrationsPrefill.set(prefill);
  integrationsDialogOpen.set(true);
}
