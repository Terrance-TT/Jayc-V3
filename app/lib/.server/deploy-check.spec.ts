import { describe, expect, it } from 'vitest';
import { checkDeployReadiness } from './deploy-check';

function buildWith(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([path, content]) => `<boltAction type="file" filePath="${path}">${content}</boltAction>`)
    .join('\n');
}

const GOOD_SERVER = `
import express from 'express';
const app = express();
const port = Number(process.env.PORT ?? 3000);
app.listen(port, '0.0.0.0');
`;

const GOOD_PKG = JSON.stringify({
  name: 'app',
  engines: { node: '>=18.18.0' },
  scripts: { build: 'vite build', start: 'tsx modules/api/src/index.ts' },
  dependencies: { express: '^4.21.0', tsx: '^4.19.0' },
  devDependencies: { typescript: '^5.6.0' },
});

describe('checkDeployReadiness', () => {
  it('returns nothing for static apps (no server entry)', () => {
    expect(checkDeployReadiness(buildWith({ 'src/main.ts': 'console.log("hi")' }))).toEqual([]);
  });

  it('returns nothing for a well-shaped full-stack app', () => {
    const text = buildWith({
      'package.json': GOOD_PKG,
      'railway.json': '{}',
      'modules/api/src/index.ts': GOOD_SERVER,
    });

    expect(checkDeployReadiness(text)).toEqual([]);
  });

  it('flags a missing engines field', () => {
    const pkg = JSON.parse(GOOD_PKG) as Record<string, unknown>;

    delete pkg.engines;

    const findings = checkDeployReadiness(
      buildWith({ 'package.json': JSON.stringify(pkg), 'railway.json': '{}', 'server.ts': GOOD_SERVER }),
    );

    expect(findings.map((finding) => finding.rule)).toContain('engines');
  });

  it('flags a start script that chains the build', () => {
    const pkg = JSON.parse(GOOD_PKG) as { scripts: Record<string, string> };

    pkg.scripts.start = 'npm run build && tsx modules/api/src/index.ts';

    const findings = checkDeployReadiness(
      buildWith({ 'package.json': JSON.stringify(pkg), 'railway.json': '{}', 'server.ts': GOOD_SERVER }),
    );

    expect(findings.map((finding) => finding.rule)).toContain('start-chains-build');
  });

  it('flags runtime packages in devDependencies', () => {
    const pkg = JSON.parse(GOOD_PKG) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    pkg.devDependencies.tsx = pkg.dependencies.tsx;

    delete pkg.dependencies.tsx;

    const findings = checkDeployReadiness(
      buildWith({ 'package.json': JSON.stringify(pkg), 'railway.json': '{}', 'server.ts': GOOD_SERVER }),
    );

    expect(findings.map((finding) => finding.rule)).toContain('runtime-in-devdeps');
  });

  it('flags a server that ignores PORT and binds localhost', () => {
    const findings = checkDeployReadiness(
      buildWith({
        'package.json': GOOD_PKG,
        'railway.json': '{}',
        'server.ts': "app.listen(3000, 'localhost');",
      }),
    );

    expect(findings.map((finding) => finding.rule)).toEqual(expect.arrayContaining(['port', 'host']));
  });

  it('flags a missing railway.json', () => {
    const findings = checkDeployReadiness(buildWith({ 'package.json': GOOD_PKG, 'server.ts': GOOD_SERVER }));

    expect(findings.map((finding) => finding.rule)).toContain('railway-json');
  });

  it('flags a server app with no root package.json', () => {
    const findings = checkDeployReadiness(buildWith({ 'railway.json': '{}', 'server.ts': GOOD_SERVER }));

    expect(findings.map((finding) => finding.rule)).toContain('pkg-missing');
  });
});
