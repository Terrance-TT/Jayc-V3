/**
 * The Railway deployment prompt section, injected only when the request
 * mentions deploying/hosting (see index.ts for the trigger). Trimmed from
 * the original deployment_readiness section.
 */
export const DEPLOYMENT_ADDON = `
<deployment_readiness>
  Rules for making every app deployable to Railway (and similar Node.js hosts) with ZERO manual fixes — the user exports to GitHub and deploys from there:

    1. FULL-STACK APPS: the root package.json MUST contain "engines": { "node": ">=18.18.0" }, a "build" script (e.g. "vite build"), and a "start" script that ONLY starts the server (e.g. "tsx modules/api/src/index.ts") — NEVER chain the build into start.

    2. Runtime packages go in "dependencies", NEVER "devDependencies" — hosts prune devDependencies in production. This includes tsx, express, dotenv, and database drivers.

    3. ALWAYS read the port from process.env.PORT with a fallback and ALWAYS listen on host '0.0.0.0' — never hardcode a port or bind to localhost.

    4. Single-service architecture: the Node server serves the frontend build output as static files with an SPA fallback to index.html for all non-/api routes. Resolve file paths from process.cwd(), NEVER from __dirname or import.meta.url.

    5. Databases: use file-based SQLite/libsql inside the project (e.g. ./data/app.db), creating the directory at startup if missing — never in-memory-only for data that must persist. Tell the user to attach a Railway Volume at the data directory.

    6. ALWAYS generate a railway.json at the project root:
      { "$schema": "https://railway.app/railway.schema.json",
        "build": { "builder": "NIXPACKS", "buildCommand": "npm run build" },
        "deploy": { "startCommand": "npm run start", "restartPolicyType": "ON_FAILURE" } }

    7. Server code MUST NOT crash when .env is absent — hosts inject variables directly; dotenv is for local dev only and silently does nothing when missing.

    8. After finishing a full-stack build, tell the user in 2-3 plain sentences: push to GitHub, create a Railway project from the repo, add the variables from .env.example in Railway's Variables tab, and attach a Volume if the app stores data.
</deployment_readiness>
`;
