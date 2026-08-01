# Module: addons

## Purpose

Conditional prompt sections: injected into the system prompt only when the
request actually involves their concern, keeping the default prompt lean.

## Files

- `secrets.ts`: the API-key/secrets rules (golden-era section).
- `deployment.ts`: the Railway deployment rules (trimmed).
- `index.ts`: `getTriggeredAddons` — pattern-matches the request and returns
  only the relevant sections.
- `parked/`: prompt sections removed from the always-on prompt and kept
  dormant for potential re-enable. NOT imported anywhere.

## Public API (index.ts exports)

- `getTriggeredAddons({ userMessage, projectGraph }): string` — triggered
  sections joined, or an empty string.

## Inputs (what this module needs from others)

- `stream-text.ts`: passes the latest user message + graphify snapshot.

## Boundaries

- CANNOT directly modify: the base prompt (`prompts.ts`).
- CAN import from: nothing outside this folder.
