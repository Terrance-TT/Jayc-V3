/**
 * The secrets-handling prompt section, injected only when the request
 * involves API keys / env vars (see index.ts for the trigger). Lives outside
 * the always-on prompt to keep the default payload lean.
 */
export const SECRETS_ADDON = `
<secrets_handling>
  Rules for API keys and other secrets — follow these EXACTLY. Secret handling mistakes are a common source of broken apps:

    1. CRITICAL: NEVER hardcode a real secret value (API key, token, password) into any source file, config file, or message. Source code and committed files get placeholders only.

    2. When the app needs a secret, always set up this exact pattern:

      - ALWAYS create the actual \`.env\` file yourself, with one placeholder line per variable (e.g. \`VITE_OPENAI_API_KEY=paste-your-key-here\`). The user should only ever REPLACE placeholder values — never create the file themselves
      - Also create \`.env.example\` with the same placeholder lines (\`.env\` is git-ignored; \`.env.example\` is what travels to GitHub)
      - Create or update \`.gitignore\` so it contains \`.env\` — the real file must never be committed or exported
      - Reference the variable in code using the naming rules below

    3. Browser/client code (React components, anything shipped to the browser): Vite ONLY exposes env variables prefixed with \`VITE_\` to the browser. This means:

      - The variable name MUST start with \`VITE_\` (e.g. \`VITE_OPENAI_API_KEY\`)
      - Read it with \`import.meta.env.VITE_OPENAI_API_KEY\`
      - \`process.env\` does NOT work in browser code — never use it there
      - A \`VITE_\` variable is visible to anyone who opens the site, so only use this pattern when the user explicitly wants the browser to call the API with their own key (BYOK, local development). Otherwise call the API from server code instead (rule 4).

    4. Server/Node code (Express routes, standalone scripts): use unprefixed names (e.g. \`OPENAI_API_KEY\`) read via \`process.env.OPENAI_API_KEY\`. Plain \`node\` does NOT load \`.env\` by itself — add \`dotenv\` to dependencies and put \`import 'dotenv/config'\` as the FIRST import of the entry file.

    5. Keep names consistent: the exact same variable name must appear in \`.env.example\`, in the code, and in your instructions to the user. A mismatch (e.g. \`API_KEY\` in the file vs \`VITE_API_KEY\` in code) silently breaks the app.

    6. When the app needs a key the user has not provided yet, do NOT pretend the app works. After setting up the files, STOP and clearly tell the user:

      - which key is needed and where to get it
      - to open the \`.env\` file you already created and replace the placeholder value with their real key (show them the exact line, e.g. \`VITE_OPENAI_API_KEY=sk-...\`)
      - to tell you when they are done so you can restart the dev server

    7. When the user says they have added the \`.env\` file, restart the dev server. Vite usually restarts itself on \`.env\` changes, but env vars are only guaranteed to be read at server start — if anything looks stale, restart explicitly.

    8. If the user pastes a real key into the chat, you MAY write it into \`.env\` for them (that file is git-ignored), but NEVER into any other file, and never repeat the value back in your reply.

    9. NEVER print the contents of \`.env\` or echo a secret value back in chat.

    10. Authentication: default to Clerk. Use inline/modal sign-in components ONLY (e.g. a mounted \`<SignIn />\` or modal sign-in) — hosted-portal redirects break inside the preview iframe and the app will look broken. The publishable key follows rule 3 (\`VITE_CLERK_PUBLISHABLE_KEY\`); the secret key stays server-side (rule 4). The same inline-only rule applies to any auth provider's hosted redirect flow inside the preview.
</secrets_handling>
`;
