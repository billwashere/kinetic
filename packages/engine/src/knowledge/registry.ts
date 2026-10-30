/**
 * Central registries for the knowledge model. Adding a node kind or relationship
 * type is a deliberate change to this file — the validator rejects anything else.
 */

export const SCHEMA_VERSION = 1;
export const DEFAULT_LOCALE = 'en-US';

/** `<kind>:<slug>`. Slugs allow `_` because derived procedure ids reuse skeleton pageIds. */
export const SLUG_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export const NODE_KINDS = ['concept', 'feature', 'procedure', 'configuration'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export function isNodeKind(v: string): v is NodeKind {
  return (NODE_KINDS as readonly string[]).includes(v);
}

/** Authored = written in Git by a person. Derived = compiled from an existing pipeline artefact. */
export type Origin = 'authored' | 'derived';

export type EvidencePolicy = 'none' | 'recommended' | 'required';

export interface RelationshipDef {
  /** Reading direction: "<source> <label> <target>". */
  label: string;
  inverseLabel: string;
  from: readonly NodeKind[];
  to: readonly NodeKind[];
  /** Cycles are reported as errors when true. */
  acyclic: boolean;
  /** Symmetric edges are stored once; consumers must treat them as bidirectional. */
  symmetric: boolean;
  evidence: EvidencePolicy;
}

const SUBJECTS = ['concept', 'feature', 'configuration'] as const;

export const RELATIONSHIPS = {
  depends_on: {
    label: 'depends on',
    inverseLabel: 'is required by',
    from: ['concept', 'feature', 'configuration'],
    to: ['concept', 'feature', 'configuration'],
    acyclic: true,
    symmetric: false,
    evidence: 'recommended',
  },
  part_of: {
    label: 'is part of',
    inverseLabel: 'contains',
    from: ['concept', 'feature', 'configuration'],
    to: ['concept', 'feature'],
    acyclic: true,
    symmetric: false,
    evidence: 'none',
  },
  implements: {
    label: 'implements',
    inverseLabel: 'is implemented by',
    from: ['feature'],
    to: ['concept'],
    acyclic: false,
    symmetric: false,
    evidence: 'none',
  },
  uses: {
    label: 'uses',
    inverseLabel: 'is used by',
    from: ['feature', 'procedure'],
    to: ['concept', 'feature', 'configuration'],
    acyclic: false,
    symmetric: false,
    evidence: 'recommended',
  },
  configured_by: {
    label: 'is configured by',
    inverseLabel: 'configures',
    from: ['concept', 'feature'],
    to: ['configuration'],
    acyclic: false,
    symmetric: false,
    evidence: 'recommended',
  },
  documented_by: {
    label: 'is documented by',
    inverseLabel: 'documents',
    from: SUBJECTS,
    to: ['procedure'],
    acyclic: false,
    symmetric: false,
    // A "documented by" claim is only meaningful if a real procedure step demonstrates it.
    evidence: 'required',
  },
  related_to: {
    label: 'is related to',
    inverseLabel: 'is related to',
    from: [...SUBJECTS, 'procedure'],
    to: [...SUBJECTS, 'procedure'],
    acyclic: false,
    symmetric: true,
    evidence: 'none',
  },
  supersedes: {
    label: 'supersedes',
    inverseLabel: 'is superseded by',
    from: [...SUBJECTS, 'procedure'],
    to: [...SUBJECTS, 'procedure'],
    acyclic: true,
    symmetric: false,
    evidence: 'none',
  },
} as const satisfies Record<string, RelationshipDef>;

export type RelationshipType = keyof typeof RELATIONSHIPS;

export function isRelationshipType(v: string): v is RelationshipType {
  return Object.prototype.hasOwnProperty.call(RELATIONSHIPS, v);
}

export function relationshipDef(t: RelationshipType): RelationshipDef {
  return RELATIONSHIPS[t];
}

/**
 * Evidence kinds:
 *  - playwright-step: a stepId on a page in extracted-skeleton.json (docStep/docAssert/docNote).
 *    Resolved against the skeleton at build time.
 *  - file:            a repo path (and optional symbol that must occur in it). Resolved on disk.
 *  - authored:        prose domain knowledge nobody can machine-check. Never counts as verified.
 */
export const EVIDENCE_TYPES = ['playwright-step', 'file', 'authored'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** How far a relationship's evidence was checked at build time. */
export type Verification = 'verified' | 'asserted' | 'unevidenced';
