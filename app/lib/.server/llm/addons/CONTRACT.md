# Module: addons

## Purpose

Conditional prompt sections: injected into the system prompt only when the
request actually involves their concern, keeping the default prompt lean.

## Files

- `secrets.ts`: the API-key/secrets rules (golden-era section).
- `deployment.ts`: the Railway deployment rules (trimmed).
- `interactive.ts`: interactive-visual conventions (canvas/SVG apps).
- `domain-rules.ts`: real-world-rules conventions (physics, finance,
  measurements); un-parked after the verify phase proved insufficient alone.
- `index.ts`: `getTriggeredAddons` — pattern-matches the request and returns
  only the relevant sections.
- `parked/`: prompt sections removed from the always-on prompt and kept
  dormant for potential re-enable (design-defaults, feature-suggestions).
  NOT imported anywhere.

## Public API (index.ts exports)

- `getTriggeredAddons({ userMessage, projectGraph }): string` — triggered
  sections joined, or an empty string.

## Inputs (what this module needs from others)

- `stream-text.ts`: passes the first + latest user message (pipeline passes
  end in bridge prompts, so the original request must also trigger) and the
  graphify snapshot.

## Boundaries

- CANNOT directly modify: the base prompt (`prompts.ts`).
- CAN import from: nothing outside this folder.
