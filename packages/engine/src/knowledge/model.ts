import type { Evidence } from './schema';
import type { GuideMeta } from './guides';
import type { NodeKind, Origin, RelationshipType, Verification } from './registry';

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  /** Repo-relative path of the authored source, when the problem has one. */
  file?: string;
  nodeId?: string;
}

export interface ParsedNode {
  file: string;
  id: string;
  kind: string;
  title: string;
  summary: string;
  aliases: string[];
  relationships: { type: string; target: string; evidence: Evidence[] }[];
  evidence: Evidence[];
  body: string;
  /** Present on guides imported from a guides directory. */
  guide?: GuideMeta;
}

/** Minimal views of existing pipeline artefacts — decoupled from doc-extractor / locale-schema. */
export interface SkeletonPage {
  pageId: string;
  videoless?: boolean;
  steps: { type: string; stepId: string; textKey?: string }[];
}

export interface LocaleView {
  pages: Record<string, { title: string; description: string }>;
  knowledge?: Record<string, { title?: string; summary?: string }>;
}

export interface KnowledgeInput {
  nodes: ParsedNode[];
  skeleton: SkeletonPage[];
  /** Keyed by locale code, e.g. "en-US". */
  locales: Record<string, LocaleView>;
  defaultLocale: string;
  /** Resolves `file` evidence. */
  checkFile: (path: string, symbol?: string) => 'ok' | 'missing-file' | 'missing-symbol';
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  origin: Origin;
  /** Authored source file, or the skeleton page for derived procedures. */
  source: string;
  aliases: string[];
  /** Present on derived procedures: the pageId used by the portal route. */
  pageId?: string;
  /** Present on guides: Diátaxis type and the declared verification state. */
  guide?: Pick<GuideMeta, 'docType' | 'categories' | 'appliesTo'> & { verification: string };
}

export interface GraphEdge {
  source: string;
  type: RelationshipType;
  target: string;
  /** Only `authored` exists today; the field reserves room for inferred edges without a schema change. */
  origin: 'authored';
  verification: Verification;
  evidence: Evidence[];
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface LocalizedText {
  title: string;
  summary: string;
  /** Locale the text actually came from — differs from the requested locale on fallback. */
  titleFrom: string;
  summaryFrom: string;
}

export interface ValidationResult {
  diagnostics: Diagnostic[];
  graph: Graph;
  /** locale -> node id -> resolved text, after applying the fallback policy. */
  text: Record<string, Record<string, LocalizedText>>;
}

export function formatDiagnostic(d: Diagnostic): string {
  const where = [d.file, d.nodeId && `(${d.nodeId})`].filter(Boolean).join(' ');
  return `${d.severity}[${d.code}] ${where ? where + ': ' : ''}${d.message}`;
}

export function hasErrors(ds: Diagnostic[]): boolean {
  return ds.some((d) => d.severity === 'error');
}
