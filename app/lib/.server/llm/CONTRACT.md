# Module: llm

## Purpose

Server-side LLM machinery: model access, the system prompt, generation
orchestration (single-pass and plan→expand→build pipeline), and stream
handling.

## Files

- `api-key.ts`, `model.ts`: Moonshot/OpenRouter model construction (BYOK-aware).
- `prompts.ts`: the golden-scope system prompt + pipeline phase prompts.
- `addons/`: conditional prompt sections (secrets, deployment, interactive, domain-rules) + parked content.
- `stream-text.ts`: the shared AI SDK wrapper (prompt assembly, message hygiene).
- `pipeline.ts`: generation orchestrator (thinking phases, build, verify, choices).
- `switchable-stream.ts`, `heartbeat.ts`, `reasoning-stream.ts`: stream plumbing.
- `prune-context.ts`: strips superseded file contents from history.
- `constants.ts`: generation modes, budgets, complexity gates.
- `index.ts`: this module's public API barrel.

## Public API (index.ts exports)

- `streamText`, `runGeneration`, `getMoonshotModel`, `getAPIKey`, `getSystemPrompt`
- `SwitchableStream`, `withHeartbeat`, `getTriggeredAddons`
- constants (`resolveGeneration`, `looksLikeBuildRequest`, `isComplexBuildRequest`, …)
- types (`Messages`, `StreamingOptions`, `StreamTextOptions`, `ByokConfig`)

## Inputs (what this module needs from others)

- `fact-check/search.ts`: Tavily fact search (enrichment + verify phase).
- `utils/thinking.ts`, `utils/constants.ts`, `utils/markdown.ts`: shared helpers.

## Boundaries

- CANNOT directly modify: routes, client stores, persistence.
- Callers (routes in `app/routes/`) import only through `index.ts`.
