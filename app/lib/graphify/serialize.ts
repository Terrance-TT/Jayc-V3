import { WORK_DIR } from '~/utils/constants';
import type { ProjectGraph } from './types';

interface SerialLine {
  rel: string;
  text: string;
  depth: number;

  /** Leaf files: no importers and no exports — safe to drop first when over budget. */
  droppable: boolean;
}

/**
 * Serializes the graph into a compact, line-per-file text snapshot, e.g.:
 *
 *   src/App.tsx | exports: App(default) | imports: ./components/Chat, ../lib/api | used-by: src/main.tsx | "Chat root component"
 *
 * Sorted by path. Non-code files appear as path-only lines so the model sees
 * the full tree. When the output exceeds `budgetChars`, leaf files (no
 * importers and no exports, deepest paths first) are progressively dropped
 * and summarized as `(+N more files under src/...)` lines. The output never
 * exceeds the budget. Returns an empty string for an empty graph.
 *
 * The output is raw text — the `<project_graph>` wrapper is added by the
 * system prompt on the server side.
 */
export function serializeGraph(graph: ProjectGraph, budgetChars = 10_000): string {
  if (graph.nodes.size === 0) {
    return '';
  }

  const importers = new Map<string, string[]>();

  for (const edge of graph.edges) {
    const list = importers.get(edge.to) ?? [];

    if (!list.includes(edge.from)) {
      list.push(edge.from);
    }

    importers.set(edge.to, list);
  }

  const lines: SerialLine[] = [];

  for (const path of [...graph.nodes.keys()].sort()) {
    const node = graph.nodes.get(path);

    if (!node) {
      continue;
    }

    const rel = sanitizeForPrompt(toRelative(path));
    const parts: string[] = [rel];

    if (node.exports.length > 0) {
      parts.push(`exports: ${node.exports.map(sanitizeForPrompt).join(', ')}`);
    }

    if (node.imports.length > 0) {
      parts.push(`imports: ${[...new Set(node.imports.map((record) => sanitizeForPrompt(record.specifier)))].join(', ')}`);
    }

    const usedBy = (importers.get(path) ?? []).map((importer) => sanitizeForPrompt(toRelative(importer))).sort();

    if (usedBy.length > 0) {
      parts.push(`used-by: ${usedBy.join(', ')}`);
    }

    if (node.docComment) {
      parts.push(`"${sanitizeForPrompt(node.docComment)}"`);
    }

    lines.push({
      rel,
      text: parts.join(' | '),
      depth: rel.split('/').length,
      droppable: usedBy.length === 0 && node.exports.length === 0,
    });
  }

  const dropped: string[] = [];

  for (;;) {
    const output = joinOutput(lines, dropped);

    if (output.length <= budgetChars) {
      return output;
    }

    // pathological case: even the summary exceeds the budget
    if (lines.length === 0) {
      return output.slice(0, budgetChars);
    }

    const droppable = lines.filter((line) => line.droppable);
    const candidates = droppable.length > 0 ? droppable : lines;

    let target = candidates[0];

    for (const candidate of candidates) {
      if (candidate.depth >= target.depth) {
        target = candidate;
      }
    }

    lines.splice(lines.indexOf(target), 1);
    dropped.push(target.rel);
  }
}

function joinOutput(lines: SerialLine[], dropped: string[]): string {
  const summary = buildSummary(dropped);
  const parts = lines.map((line) => line.text);

  if (summary.length > 0) {
    parts.push(summary);
  }

  return parts.join('\n');
}

function buildSummary(dropped: string[]): string {
  if (dropped.length === 0) {
    return '';
  }

  const groups = new Map<string, number>();

  for (const rel of dropped) {
    const segments = rel.split('/');
    const dir = segments.length > 1 ? segments[0] : '.';

    groups.set(dir, (groups.get(dir) ?? 0) + 1);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, count]) => {
      const noun = count === 1 ? 'file' : 'files';

      return dir === '.' ? `(+${count} more ${noun} at the project root)` : `(+${count} more ${noun} under ${dir}/...)`;
    })
    .join('\n');
}

function toRelative(path: string): string {
  if (path.startsWith(`${WORK_DIR}/`)) {
    return path.slice(WORK_DIR.length + 1);
  }

  return path.replace(/^\/+/, '');
}

/**
 * Strips angle brackets so a rendered line can never break out of the
 * `<project_graph>` section of the system prompt (e.g. a file path or
 * symbol name containing `</project_graph>`).
 */
function sanitizeForPrompt(text: string): string {
  return text.replace(/[<>]/g, '');
}
