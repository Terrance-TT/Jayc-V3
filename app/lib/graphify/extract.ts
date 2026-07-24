import type { GraphNode, GraphSymbol, GraphSymbolKind, ImportRecord } from './types';

const CODE_FILE_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

const IMPORT_FROM_RE = /\bimport\s+(?:type\s+)?([\w${},*\s]+?)\s+from\s+['"]([^'"]+)['"]/g;
const IMPORT_SIDE_EFFECT_RE = /\bimport\s+['"]([^'"]+)['"]/g;
const EXPORT_FROM_RE = /\bexport\s+(?:type\s+)?(\*|\{[\w${},*\s]*?\})\s+from\s+['"]([^'"]+)['"]/g;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

const EXPORT_DECL_RE =
  /\bexport\s+(default\s+)?(?:(?:abstract|declare|async)\s+)*(function\*?|class|const|let|var|type|interface|enum)\s+([\w$]+)/g;
const EXPORT_DEFAULT_RE =
  /\bexport\s+default\s+(?!(?:(?:abstract|declare|async)\s+)*(?:function|class)\b)([\w$]+)?/g;
const EXPORT_LIST_RE = /\bexport\s+(?:type\s+)?\{([\w${},*\s]*?)\}(?!\s*from)/g;

const SYMBOL_RES: Array<[RegExp, GraphSymbolKind]> = [
  [/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([\w$]+)/gm, 'function'],
  [/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([\w$]+)/gm, 'class'],
  [/^(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([\w$]+)/gm, 'const'],
  [/^(?:export\s+)?(?:declare\s+)?type\s+([\w$]+)/gm, 'type'],
  [/^(?:export\s+)?(?:declare\s+)?interface\s+([\w$]+)/gm, 'interface'],
  [/^(?:export\s+)?(?:declare\s+)?enum\s+([\w$]+)/gm, 'other'],
];

const DOC_COMMENT_MAX_LENGTH = 120;

/** Only `.ts .tsx .js .jsx .mjs .cjs` files get full extraction. */
export function isCodeFile(path: string): boolean {
  return CODE_FILE_RE.test(path);
}

/** FNV-1a 32-bit hash as a base-36 string. Fast and dependency-free. */
export function hashContent(content: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}

/**
 * Extracts imports, exports, top-level symbols, the leading doc comment and a
 * content hash from a code file using regex heuristics (no parser deps).
 */
export function extractNode(path: string, content: string): GraphNode {
  return {
    path,
    exports: extractExports(content),
    imports: extractImports(content),
    symbols: extractSymbols(content),
    docComment: extractDocComment(content),
    contentHash: hashContent(content),
    size: content.length,
  };
}

/**
 * A node for a non-code file: it appears in the tree (path, hash, size)
 * but carries no imports/exports/symbols.
 */
export function createBareNode(path: string, content: string): GraphNode {
  return {
    path,
    exports: [],
    imports: [],
    symbols: [],
    contentHash: hashContent(content),
    size: content.length,
  };
}

function extractImports(content: string): ImportRecord[] {
  const records: ImportRecord[] = [];
  const bySpecifier = new Map<string, ImportRecord>();

  const add = (specifier: string, names: string[]) => {
    const existing = bySpecifier.get(specifier);

    if (existing) {
      for (const name of names) {
        if (!existing.names.includes(name)) {
          existing.names.push(name);
        }
      }

      return;
    }

    const record: ImportRecord = { specifier, names: [...names] };

    bySpecifier.set(specifier, record);
    records.push(record);
  };

  for (const match of content.matchAll(IMPORT_FROM_RE)) {
    add(match[2], parseImportClause(match[1]));
  }

  for (const match of content.matchAll(IMPORT_SIDE_EFFECT_RE)) {
    add(match[1], []);
  }

  for (const match of content.matchAll(EXPORT_FROM_RE)) {
    add(match[2], []);
  }

  for (const match of content.matchAll(REQUIRE_RE)) {
    add(match[1], []);
  }

  return records;
}

function parseImportClause(clause: string): string[] {
  const names: string[] = [];
  const trimmed = clause.trim();

  if (trimmed.length === 0) {
    return names;
  }

  const namespaceMatch = /\*\s+as\s+([\w$]+)/.exec(trimmed);

  if (namespaceMatch) {
    names.push(namespaceMatch[1]);
  }

  const namedMatch = /\{([\s\S]*?)\}/.exec(trimmed);

  if (namedMatch) {
    for (const part of namedMatch[1].split(',')) {
      const name = parseNamePart(part);

      if (name) {
        names.push(name);
      }
    }
  }

  // default import binding: a leading identifier before any `{` or `*`
  const defaultMatch = /^([\w$]+)\s*(?:,|$)/.exec(trimmed);

  if (defaultMatch) {
    names.push(defaultMatch[1]);
  }

  return names;
}

/** For `a as b` the exported/local name is `b`, otherwise the (de-`type`d) name itself. */
function parseNamePart(part: string): string | undefined {
  const trimmed = part.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  const aliasMatch = /\bas\s+([\w$]+)$/.exec(trimmed);

  if (aliasMatch) {
    return aliasMatch[1];
  }

  return trimmed.replace(/^type\s+/, '');
}

function extractExports(content: string): string[] {
  const exports: string[] = [];
  const seen = new Set<string>();

  const push = (name: string) => {
    if (!seen.has(name)) {
      seen.add(name);
      exports.push(name);
    }
  };

  for (const match of content.matchAll(EXPORT_DECL_RE)) {
    const [, isDefault, , name] = match;

    push(isDefault ? `${name}(default)` : name);
  }

  for (const match of content.matchAll(EXPORT_DEFAULT_RE)) {
    push(match[1] ? `${match[1]}(default)` : 'default');
  }

  for (const match of content.matchAll(EXPORT_LIST_RE)) {
    for (const part of match[1].split(',')) {
      const name = parseNamePart(part);

      if (name) {
        push(name);
      }
    }
  }

  // re-exports (`export { a, b as c } from './x'`) are part of the public API too
  for (const match of content.matchAll(EXPORT_FROM_RE)) {
    if (!match[1].startsWith('{')) {
      continue;
    }

    for (const part of match[1].slice(1, -1).split(',')) {
      const name = parseNamePart(part);

      if (name) {
        push(name);
      }
    }
  }

  return exports;
}

function extractSymbols(content: string): GraphSymbol[] {
  const symbols: GraphSymbol[] = [];

  for (const [regex, kind] of SYMBOL_RES) {
    for (const match of content.matchAll(regex)) {
      symbols.push({ name: match[1], kind, line: lineNumberAt(content, match.index) });
    }
  }

  return symbols.sort((a, b) => a.line - b.line);
}

function lineNumberAt(content: string, index: number): number {
  let line = 1;

  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) {
      line++;
    }
  }

  return line;
}

function extractDocComment(content: string): string | undefined {
  const start = content.replace(/^#!.*\n/, '').trimStart();

  let raw: string | undefined;

  const blockMatch = /^\/\*+([\s\S]*?)\*\//.exec(start);

  if (blockMatch) {
    raw = blockMatch[1];
  } else {
    const lineMatch = /^\/\/(.*)/.exec(start);

    if (lineMatch) {
      raw = lineMatch[1];
    }
  }

  if (raw === undefined) {
    return undefined;
  }

  const firstLine = raw
    .split('\n')
    .map((line) => line.replace(/^\s*\*+\s?/, '').trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return undefined;
  }

  // strip angle brackets so the comment can never break out of the
  // `<project_graph>` section of the system prompt
  const sanitized = firstLine.replace(/[<>]/g, '');

  return sanitized.length > DOC_COMMENT_MAX_LENGTH
    ? `${sanitized.slice(0, DOC_COMMENT_MAX_LENGTH - 3)}...`
    : sanitized;
}
