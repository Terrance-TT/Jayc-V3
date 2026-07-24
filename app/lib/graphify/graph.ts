import type { GraphEdge, GraphNode, ProjectGraph } from './types';

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

export function createGraph(): ProjectGraph {
  return { nodes: new Map<string, GraphNode>(), edges: [] };
}

export function upsertNode(graph: ProjectGraph, node: GraphNode): void {
  graph.nodes.set(node.path, node);
}

export function removeNode(graph: ProjectGraph, path: string): void {
  graph.nodes.delete(path);
  graph.edges = graph.edges.filter((edge) => edge.from !== path && edge.to !== path);
}

/**
 * Recomputes every edge from scratch: resolves each relative import
 * specifier against the importer's path and writes the result back into
 * `ImportRecord.resolved`. Bare package specifiers stay unresolved.
 */
export function resolveEdges(graph: ProjectGraph): void {
  const edges: GraphEdge[] = [];

  for (const node of graph.nodes.values()) {
    for (const record of node.imports) {
      const resolved = resolveSpecifier(graph, node.path, record.specifier);

      record.resolved = resolved;

      if (resolved !== undefined) {
        edges.push({ from: node.path, to: resolved, names: record.names });
      }
    }
  }

  graph.edges = edges;
}

function resolveSpecifier(graph: ProjectGraph, fromPath: string, specifier: string): string | undefined {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return undefined;
  }

  const fromDir = fromPath.slice(0, fromPath.lastIndexOf('/') + 1);
  const base = normalizePath(fromDir + specifier);

  const candidates = [
    base,
    ...RESOLVE_EXTENSIONS.map((ext) => base + ext),
    ...RESOLVE_EXTENSIONS.map((ext) => `${base}/index${ext}`),
  ];

  for (const candidate of candidates) {
    if (graph.nodes.has(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function normalizePath(path: string): string {
  const out: string[] = [];

  for (const part of path.split('/')) {
    if (part === '.' || (part === '' && out.length > 0)) {
      continue;
    }

    if (part === '..') {
      // never pop the leading empty segment (filesystem root)
      if (out.length > 1) {
        out.pop();
      }

      continue;
    }

    out.push(part);
  }

  return out.join('/');
}

export function getExports(graph: ProjectGraph, path: string): string[] {
  return graph.nodes.get(path)?.exports ?? [];
}

/** Paths of workspace files that `path` imports from (resolved edges only). */
export function getDependencies(graph: ProjectGraph, path: string): string[] {
  const dependencies = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.from === path) {
      dependencies.add(edge.to);
    }
  }

  return [...dependencies];
}

/** Paths of workspace files that import `path` (resolved edges only). */
export function getImporters(graph: ProjectGraph, path: string): string[] {
  const importers = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.to === path) {
      importers.add(edge.from);
    }
  }

  return [...importers];
}
