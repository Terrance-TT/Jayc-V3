import { describe, expect, it } from 'vitest';
import { checkBuildIntegrity } from './integrity-check';

function buildWith(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([path, content]) => `<boltAction type="file" filePath="${path}">${content}</boltAction>`)
    .join('\n');
}

describe('checkBuildIntegrity', () => {
  it('passes a clean build', () => {
    const text = buildWith({
      'src/users.ts': 'export const getUser = () => ({ id: 1 });\nexport function setPro() {}',
      'src/index.ts': "export { getUser, setPro } from './users';",
      'src/app.ts': "import { getUser } from './users';\nimport './style.css';\nconsole.log(getUser());",
      'src/style.css': 'body {}',
    });

    expect(checkBuildIntegrity(text)).toEqual([]);
  });

  it('flags imports of files that were never generated', () => {
    const text = buildWith({
      'src/app.ts': "import { thing } from './openai';\nimport billing from './routes/billing';",
      'src/index.ts': "export { thing } from './openai';",
    });

    const rules = checkBuildIntegrity(text).map((finding) => finding.rule);

    expect(rules).toEqual(['unresolved-import', 'unresolved-import', 'unresolved-import']);
  });

  it('resolves index barrels and .tsx extensions', () => {
    const text = buildWith({
      'modules/api/src/routes/index.ts': "export const router = 'x';",
      'modules/api/src/app.ts': "import { router } from './routes';",
      'src/Widget.tsx': 'export const Widget = () => null;',
      'src/App.tsx': "import { Widget } from './Widget';",
    });

    expect(checkBuildIntegrity(text)).toEqual([]);
  });

  it('flags named imports of members the target does not export', () => {
    const text = buildWith({
      'src/users.ts': 'export const getUser = () => null;',
      'src/index.ts': "export { getUser, setPro, blockerDaysUsed } from './users';",
    });

    const findings = checkBuildIntegrity(text);

    expect(findings.map((finding) => finding.rule)).toEqual(['missing-export', 'missing-export']);
    expect(findings[0].detail).toContain('setPro');
    expect(findings[1].detail).toContain('blockerDaysUsed');
  });

  it('honours `as` aliases on both sides', () => {
    const text = buildWith({
      'src/users.ts': 'export const internal = 1;',
      'src/index.ts': "export { internal as exposed } from './users';",
      'src/app.ts': "import { exposed } from './index';",
    });

    expect(checkBuildIntegrity(text)).toEqual([]);
  });

  it('ignores bare-package imports and non-code files', () => {
    const text = buildWith({
      'src/app.ts': "import express from 'express';\nimport { z } from 'zod';",
      'README.md': "import { fake } from './nowhere';",
    });

    expect(checkBuildIntegrity(text)).toEqual([]);
  });
});
