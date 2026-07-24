/**
 * graphify — internal project knowledge graph.
 *
 * The client maintains a live dependency graph of the workspace
 * (files = nodes, imports/exports = edges) and sends a compact serialized
 * snapshot with each chat request so the model has ground truth about
 * which files, exports and symbols actually exist in the project.
 */

export interface ImportRecord {
  /**
   * The raw import specifier as written in the source,
   * e.g. `./components/Chat` or `react`.
   */
  specifier: string;

  /**
   * The resolved absolute workspace path for relative specifiers.
   * Stays `undefined` for bare package specifiers (e.g. `react`).
   */
  resolved?: string;

  /**
   * Local names bound by this import (default import binding, namespace
   * binding, or named imports). Empty for side-effect imports.
   */
  names: string[];
}

export type GraphSymbolKind = 'function' | 'class' | 'const' | 'type' | 'interface' | 'other';

export interface GraphSymbol {
  name: string;
  kind: GraphSymbolKind;

  /** 1-based line number of the declaration. */
  line: number;
}

export interface GraphNode {
  path: string;

  /**
   * Exported names. A default export with a known local name is recorded
   * as `name(default)`; an anonymous default export is recorded as `default`.
   */
  exports: string[];

  imports: ImportRecord[];
  symbols: GraphSymbol[];

  /** First leading comment at the top of the file, trimmed to one line. */
  docComment?: string;

  contentHash: string;
  size: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  names: string[];
}

export interface ProjectGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}

/**
 * The compact serialized form of the graph that is sent to the server
 * and injected into the system prompt.
 */
export type GraphSnapshot = string;
