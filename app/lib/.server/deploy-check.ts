/**
 * Deterministic deploy-readiness checks for generated apps — no LLM judgment
 * involved. Scans the file actions in a build's output and verifies the
 * structural Railway rules (see addons/deployment.ts) that prompt guidance
 * alone cannot guarantee: engines/build/start scripts, runtime packages out
 * of devDependencies, PORT + 0.0.0.0 binding, railway.json.
 *
 * Static apps (no Node server entry detected) get no findings — there is
 * nothing to deploy-shape. Findings are fed to the post-build review pass
 * (pipeline.ts) so the model fixes them with full file contents.
 */

export interface DeployFinding {
  /** stable rule id, for tests and logging */
  rule: string;

  /** human-readable description shown to the reviewer */
  detail: string;
}

const FILE_ACTION_PATTERN = /<boltAction\s+type="file"\s+filePath="([^"]+)"[^>]*>([\s\S]*?)<\/boltAction>/g;

// packages that must run in production — hosts prune devDependencies
const RUNTIME_PACKAGES = [
  'tsx',
  'express',
  'fastify',
  'koa',
  'hono',
  'dotenv',
  'libsql',
  '@libsql/client',
  'better-sqlite3',
];

export function checkDeployReadiness(buildText: string): DeployFinding[] {
  const files = new Map<string, string>();

  for (const match of buildText.matchAll(FILE_ACTION_PATTERN)) {
    files.set(match[1], match[2]);
  }

  // a Node server entry exists iff some TypeScript file starts a listener
  const serverEntry = [...files.entries()].find(
    ([path, content]) => path.endsWith('.ts') && content.includes('.listen('),
  );

  if (!serverEntry) {
    return [];
  }

  const findings: DeployFinding[] = [];
  const pkgText = files.get('package.json');

  if (!pkgText) {
    findings.push({ rule: 'pkg-missing', detail: 'the app has a Node server but no root package.json' });
  } else {
    try {
      const pkg = JSON.parse(pkgText) as {
        engines?: Record<string, string>;
        scripts?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      if (!pkg.engines?.node) {
        findings.push({
          rule: 'engines',
          detail: 'package.json is missing "engines": { "node": ">=18.18.0" } — hosts need it to pick a Node version',
        });
      }

      if (!pkg.scripts?.build) {
        findings.push({ rule: 'build-script', detail: 'package.json has no "build" script (e.g. "vite build")' });
      }

      if (!pkg.scripts?.start) {
        findings.push({
          rule: 'start-script',
          detail: 'package.json has no "start" script that ONLY starts the server',
        });
      } else if (/\bbuild\b/.test(pkg.scripts.start)) {
        findings.push({
          rule: 'start-chains-build',
          detail: 'the "start" script chains the build — hosts run build separately; start must ONLY start the server',
        });
      }

      for (const name of RUNTIME_PACKAGES) {
        if (pkg.devDependencies?.[name]) {
          findings.push({
            rule: 'runtime-in-devdeps',
            detail: `"${name}" is in devDependencies — hosts prune those in production; move it to dependencies`,
          });
        }
      }
    } catch {
      findings.push({ rule: 'pkg-unparseable', detail: 'the root package.json is not valid JSON' });
    }
  }

  const [, serverContent] = serverEntry;

  if (!serverContent.includes('process.env.PORT')) {
    findings.push({
      rule: 'port',
      detail: `the server (${serverEntry[0]}) does not read process.env.PORT — hosts assign the port`,
    });
  }

  if (!serverContent.includes('0.0.0.0')) {
    findings.push({
      rule: 'host',
      detail: `the server (${serverEntry[0]}) does not listen on '0.0.0.0' — binding localhost makes it unreachable`,
    });
  }

  if (!files.has('railway.json')) {
    findings.push({ rule: 'railway-json', detail: 'no railway.json at the project root (build/start commands)' });
  }

  return findings;
}
