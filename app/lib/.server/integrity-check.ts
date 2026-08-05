/**
 * Deterministic build-integrity checks — no LLM judgment involved. The
 * failure class that inspired this: a maximal prompt designs N modules but
 * the output budget runs out mid-build, leaving files that were contracted
 * but never written. Prompt rules cannot catch that; a static check can.
 *
 * Scans the file actions in a build's output and verifies:
 *  1. every relative import/export-from resolves to a generated file
 *  2. every named import / re-export names a member the target file
 *     actually exports (shallow: one level, no type analysis)
 *
 * Findings are fed to the post-build review pass (pipeline.ts) so the model
 * completes or rewires the build with full file contents.
 */

export interface IntegrityFinding {
  /** stable rule id, for tests and logging */
  rule: string;

  /** human-readable description shown to the reviewer */
  detail: string;
}

const FILE_ACTION_PATTERN = /<boltAction\s+type="file"\s+filePath="([^"]+)"[^>]*>([\s\S]*?)<\/boltAction>/g;

// import … from './x', export … from './x', and side-effect import './x'
const FROM_SPECIFIER_PATTERN = /(?:import|export)\s[\s\S]*?from\s+['"](\.[^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_PATTERN = /import\s+['"](\.[^'"]+)['"]/g;

// export { a, b as c } from './x' — captures the member list
const NAMED_FROM_PATTERN = /(?:import|export)\s*\{([^}]+)\}\s*from\s+['"](\.[^'"]+)['"]/g;

// export const/function/class/interface/type/enum NAME
const EXPORT_DECL_PATTERN = /export\s+(?:const|function|class|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;

// export { a, b as c } — local or re-export; the name AFTER `as` is the exported one
const EXPORT_LIST_PATTERN = /export\s*\{([^}]+)\}/g;

const CODE_EXTENSIONS = ['.ts', '.tsx', '.d.ts'];

function resolveSpecifier(fromFile: string, specifier: string, files: Map<string, string>): string | undefined {
  const fromDir = fromFile.split('/').slice(0, -1).join('/');
  const segments = [...fromDir.split('/'), ...specifier.split('/')];
  const resolved: string[] = [];

  for (const segment of segments) {
    if (segment === '.' || segment === '') {
      continue;
    }

    if (segment === '..') {
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }

  const base = resolved.join('/');

  // exact path (has its own extension — css, json, svg, …)
  if (files.has(base)) {
    return base;
  }

  for (const ext of CODE_EXTENSIONS) {
    if (files.has(`${base}${ext}`)) {
      return `${base}${ext}`;
    }

    if (files.has(`${base}/index${ext}`)) {
      return `${base}/index${ext}`;
    }
  }

  return undefined;
}

function exportedNames(content: string): Set<string> {
  const names = new Set<string>();

  for (const match of content.matchAll(EXPORT_DECL_PATTERN)) {
    names.add(match[1]);
  }

  if (/export\s+default/.test(content)) {
    names.add('default');
  }

  for (const match of content.matchAll(EXPORT_LIST_PATTERN)) {
    for (const member of match[1].split(',')) {
      const name = member
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .pop()
        ?.trim();

      if (name) {
        names.add(name);
      }
    }
  }

  return names;
}

export function checkBuildIntegrity(buildText: string): IntegrityFinding[] {
  const files = new Map<string, string>();

  for (const match of buildText.matchAll(FILE_ACTION_PATTERN)) {
    files.set(match[1], match[2]);
  }

  const findings: IntegrityFinding[] = [];
  const exportCache = new Map<string, Set<string>>();

  const exportsOf = (path: string): Set<string> => {
    let names = exportCache.get(path);

    if (!names) {
      names = exportedNames(files.get(path) ?? '');
      exportCache.set(path, names);
    }

    return names;
  };

  for (const [path, content] of files) {
    if (!path.endsWith('.ts') && !path.endsWith('.tsx')) {
      continue;
    }

    // 1. unresolved relative imports/export-from
    const specifiers = new Set<string>();

    for (const match of content.matchAll(FROM_SPECIFIER_PATTERN)) {
      specifiers.add(match[1]);
    }

    for (const match of content.matchAll(SIDE_EFFECT_IMPORT_PATTERN)) {
      specifiers.add(match[1]);
    }

    for (const specifier of specifiers) {
      if (!resolveSpecifier(path, specifier, files)) {
        findings.push({
          rule: 'unresolved-import',
          detail: `${path} imports '${specifier}', but no such file was generated — create it or remove the import`,
        });
      }
    }

    // 2. named imports/re-exports of members the target does not export
    for (const match of content.matchAll(NAMED_FROM_PATTERN)) {
      const target = resolveSpecifier(path, match[2], files);

      if (!target) {
        continue; // already reported as unresolved
      }

      const available = exportsOf(target);

      for (const member of match[1].split(',')) {
        // in { a as b } the required source member is `a`; `type` qualifiers don't matter
        const sourceName = member
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          ?.trim();

        if (sourceName && !available.has(sourceName)) {
          findings.push({
            rule: 'missing-export',
            detail: `${path} imports '${sourceName}' from '${match[2]}', but ${target} does not export it — add the export or fix the import`,
          });
        }
      }
    }
  }

  return findings;
}
