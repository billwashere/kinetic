import fs from 'fs-extra';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { EvidenceSchema, RelationshipSchema } from './schema';
import { SLUG_RE } from './registry';
import type { Diagnostic, ParsedNode } from './model';
import { mermaidProblem } from './mermaid';

/**
 * Authored user guides. A guide is a Markdown file with YAML frontmatter that the
 * knowledge graph imports as a `guide` node. The body stays the canonical prose;
 * the frontmatter carries the typed, checkable facts (document type, audience,
 * prerequisites, verification status) so quality gates do not have to guess.
 */

export const DOC_TYPES = ['tutorial', 'how-to', 'explanation', 'reference'] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Publishing/navigation categories. They never replace the Diátaxis type. */
export const GUIDE_CATEGORIES = [
  'business-process',
  'configuration',
  'troubleshooting',
  'role-tasks',
  'release',
] as const;

export const VERIFICATION_STATUSES = ['verified', 'partial', 'unverified'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

const GuideFrontmatterSchema = z
  .object({
    /** Defaults to `guide:<file name>`. Set it only to keep an id stable across a rename. */
    id: z.string().optional(),
    type: z.enum(DOC_TYPES),
    categories: z.array(z.enum(GUIDE_CATEGORIES)).default([]),
    /** Defaults to the first `#` heading. */
    title: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    aliases: z.array(z.string().min(1)).default([]),
    audience: z.array(z.string().min(1)).default([]),
    prerequisites: z.array(z.string().min(1)).default([]),
    /** Where in the application the reader begins. */
    startingPoint: z.string().min(1).optional(),
    outcome: z.string().min(1).optional(),
    /** What is true after completion. */
    result: z.string().min(1).optional(),
    /** Product version or revision the guide applies to. */
    appliesTo: z.string().min(1).optional(),
    /** Guides this one comes after in a business process (ids). */
    follows: z.array(z.string().min(1)).default([]),
    /** Related guides, concepts, features (ids). Edges are `related_to`. */
    related: z.array(z.string().min(1)).default([]),
    verification: z
      .object({
        status: z.enum(VERIFICATION_STATUSES).default('unverified'),
        reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').optional(),
        reviewedBy: z.string().min(1).optional(),
      })
      .strict()
      .default({ status: 'unverified' }),
    /** Internal review notes and sources. Never rendered or indexed. */
    provenance: z
      .object({ sources: z.array(z.string().min(1)).default([]), note: z.string().optional() })
      .strict()
      .optional(),
    relationships: z.array(RelationshipSchema).default([]),
    evidence: z.array(EvidenceSchema).default([]),
  })
  .strict();

export type GuideMeta = {
  docType: DocType;
  categories: string[];
  audience: string[];
  prerequisites: string[];
  startingPoint?: string;
  outcome?: string;
  result?: string;
  appliesTo?: string;
  verification: { status: VerificationStatus; reviewedAt?: string; reviewedBy?: string };
};

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

export const slugOf = (file: string) =>
  path
    .basename(file, '.md')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** GitHub-style heading anchor, so guides keep working when browsed on GitHub too. */
export function headingSlug(heading: string): string {
  return heading
    .replace(/[`*_]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}

/** Body with fenced code blocks removed, keeping line structure so line numbers stay true. */
function stripFences(body: string): { prose: string; fences: { lang: string; text: string; endLine: number }[] } {
  const fences: { lang: string; text: string; endLine: number }[] = [];
  const lines = body.split('\n');
  const out: string[] = [];
  let open: { lang: string; buf: string[] } | null = null;
  lines.forEach((line, i) => {
    const m = /^\s*(```+|~~~+)\s*([\w-]*)/.exec(line);
    if (m && !open) open = { lang: m[2], buf: [] };
    else if (m && open) {
      fences.push({ lang: open.lang, text: open.buf.join('\n'), endLine: i });
      open = null;
    } else if (open) open.buf.push(line);
    out.push(open || m ? '' : line);
  });
  return { prose: out.join('\n'), fences };
}

export interface GuideContext {
  /** Heading anchors of every guide, keyed by repo-relative path. */
  anchors: Map<string, Set<string>>;
  /** Does a repo-relative path exist (used for non-guide link targets)? */
  exists: (relPath: string) => boolean;
}

const STATE_VERBS = /\b(activate|approve|reject|submit|post|release|complete|publish|finali[sz]e)\b/i;
const VERIFY_RE = /\b(verify|check that|confirm|you should see|you will see|the result|appears? (in|on)|status (changes|shows|is))\b/i;
const RECOVERY_RE = /\b(if (you|it|the)|cannot|can't|does not|doesn't|fails?|error|problem|troubleshoot|stuck|missing)\b/i;
const START_RE = /\b(open|go to|start (at|from|on|in)|choose|select|from the)\b[^.\n]{0,80}(→|>|\*\*|menu|page|screen|list|tab)/i;
const VAGUE_LINK_RE = /^(here|this|this link|link|click here|read more|more|see here)$/i;

/**
 * Pure: quality gates for one guide. Errors are structural facts that are objectively
 * wrong (broken link, verified claim with no evidence). Procedure checks are heuristics
 * that find suspicious gaps — warnings, because they cannot prove a procedure works.
 */
export function lintGuide(
  file: string,
  id: string,
  meta: GuideMeta,
  body: string,
  ctx: GuideContext,
  machineEvidence: boolean,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const add = (severity: 'error' | 'warning', code: string, message: string) =>
    out.push({ severity, code, message, file, nodeId: id });
  const { prose, fences } = stripFences(body);
  const lines = prose.split('\n');
  const procedural = meta.docType === 'how-to' || meta.docType === 'tutorial';

  // ── Structure ──
  if (meta.verification.status === 'verified' && !machineEvidence)
    add(
      'error',
      'verified-without-evidence',
      'verification.status is "verified" but no machine-checkable evidence (playwright-step or file) is declared',
    );
  if (meta.verification.status === 'verified' && !meta.verification.reviewedAt)
    add('warning', 'review-not-recorded', 'status "verified" needs verification.reviewedAt (who checked it, and when)');
  if (meta.verification.reviewedAt) {
    const ageDays = (Date.now() - Date.parse(meta.verification.reviewedAt)) / 86_400_000;
    if (ageDays > 365) add('warning', 'stale-review', `last reviewed ${meta.verification.reviewedAt}; review is over a year old`);
  }
  if (!meta.appliesTo) add('warning', 'no-version', 'appliesTo (product version or revision) is not declared');

  // ── Links ──
  const dir = path.posix.dirname(file);
  const ownAnchors = ctx.anchors.get(file) ?? new Set<string>();
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(?<!!)\[([^\]]*)\]\(([^)\s]+)\)/g)) {
      const [, text, href] = m;
      if (VAGUE_LINK_RE.test(text.trim()))
        add('warning', 'vague-link-text', `line ${i + 1}: link text "${text}" does not describe its target`);
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue; // external
      const [target, anchor] = href.split('#');
      const resolved = target ? path.posix.normalize(path.posix.join(dir, target)) : file;
      const anchors = target ? ctx.anchors.get(resolved) : ownAnchors;
      if (target && !anchors && !ctx.exists(resolved)) {
        add('error', 'broken-link', `line ${i + 1}: "${href}" does not resolve to a file`);
      } else if (anchor && anchors && !anchors.has(anchor)) {
        add('error', 'broken-anchor', `line ${i + 1}: "${href}" — no heading with anchor "#${anchor}"`);
      }
    }
  });

  // ── Diagrams ──
  for (const f of fences) {
    if (f.lang === 'mermaid' && !f.text.trim())
      add('error', 'empty-diagram', `line ${f.endLine + 1}: mermaid block is empty`);
    const looksLikeDiagram = f.lang === 'mermaid' || /[─│┌└├►→]|──►|-->/.test(f.text);
    if (looksLikeDiagram) {
      const after = lines.slice(f.endLine + 1).find((l) => l.trim() !== '') ?? '';
      if (!after || /^#{1,6}\s|^---$/.test(after.trim()))
        add('warning', 'diagram-no-text', `line ${f.endLine + 1}: diagram is not followed by a text explanation`);
    }
  }

  // ── Procedure gates ──
  if (procedural) {
    const hasSteps = lines.some((l) => /^\s*\d+[.)]\s+\S/.test(l));
    if (!hasSteps) add('warning', 'no-procedure', 'a how-to or tutorial should contain numbered steps');
    if (!meta.startingPoint && !START_RE.test(prose))
      add('warning', 'no-starting-point', 'no startingPoint declared and none found in the text');
    if (!meta.outcome && !meta.result)
      add('warning', 'no-outcome', 'declare outcome or result so the reader knows what success looks like');
    if (!VERIFY_RE.test(prose)) add('warning', 'no-verification', 'no way to verify completion found');
    if (!RECOVERY_RE.test(prose)) add('warning', 'no-recovery', 'no exceptions or recovery guidance found');
    if (/\bdraft\b/i.test(prose) && !STATE_VERBS.test(prose))
      add('warning', 'draft-without-activation', 'mentions a draft but no activate, approve, submit or post action');
    if (meta.verification.status === 'unverified' && /\*\*[^*]+\*\*/.test(prose))
      add('warning', 'unverified-ui-labels', 'names UI labels but the guide has no verification evidence');
  }
  if (meta.docType === 'explanation' && lines.filter((l) => /^\s*\d+[.)]\s+\S/.test(l)).length >= 5)
    add('warning', 'explanation-with-procedure', 'an explanation containing a long numbered list may be a how-to; link to the procedure instead');
  return out;
}

export function parseGuideFile(
  raw: string,
  file: string,
  ctx: GuideContext,
): { node?: ParsedNode; diagnostics: Diagnostic[] } {
  const bad = (code: string, message: string, nodeId?: string) => ({
    diagnostics: [{ severity: 'error' as const, code, message, file, nodeId }],
  });
  const m = FM_RE.exec(raw.replace(/^﻿/, ''));
  if (!m) return bad('malformed-frontmatter', 'guide must start with a "---" delimited YAML block');
  let data: unknown;
  try {
    data = parseYaml(m[1]);
  } catch (e) {
    return bad('malformed-frontmatter', `YAML parse error: ${(e as Error).message.split('\n')[0]}`);
  }
  const parsed = GuideFrontmatterSchema.safeParse(data);
  if (!parsed.success)
    return {
      diagnostics: parsed.error.issues.map((i) => ({
        severity: 'error' as const,
        code: 'invalid-frontmatter',
        message: `${i.path.join('.') || '(root)'}: ${i.message}`,
        file,
      })),
    };
  const fm = parsed.data;
  const body = (m[2] ?? '').replace(/\r\n/g, '\n').trim();
  const slug = slugOf(file);
  const id = fm.id ?? `guide:${slug}`;
  if (!id.startsWith('guide:') || !SLUG_RE.test(id.slice('guide:'.length)))
    return bad('invalid-id', `guide id "${id}" must look like "guide:<slug>"`, id);
  const h1 = /^#\s+(.+)$/m.exec(stripFences(body).prose)?.[1].trim();
  const title = fm.title ?? h1;
  if (!title) return bad('missing-title', 'no title in frontmatter and no "#" heading', id);
  // The summary falls back to the first prose paragraph after the title.
  const firstPara = stripFences(body)
    .prose.split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !/^#{1,6}\s|^---$|^[-*|>\d]/.test(p));
  const summary = fm.summary ?? firstPara?.replace(/\s+/g, ' ').slice(0, 280);
  if (!summary) return bad('missing-summary', 'no summary in frontmatter and no opening paragraph', id);

  const meta: GuideMeta = {
    docType: fm.type,
    categories: [...fm.categories].sort(),
    audience: fm.audience,
    prerequisites: fm.prerequisites,
    startingPoint: fm.startingPoint,
    outcome: fm.outcome,
    result: fm.result,
    appliesTo: fm.appliesTo,
    verification: fm.verification,
  };
  const relationships = [
    ...fm.relationships,
    ...fm.follows.map((target) => ({ type: 'follows', target, evidence: [] })),
    ...fm.related.map((target) => ({ type: 'related_to', target, evidence: [] })),
  ];
  const machine = fm.evidence.some((e) => e.type !== 'authored');
  return {
    node: {
      file,
      id,
      kind: 'guide',
      title,
      summary,
      aliases: fm.aliases,
      relationships,
      evidence: fm.evidence,
      body,
      guide: meta,
    },
    diagnostics: lintGuide(file, id, meta, body, ctx, machine),
  };
}

async function listMarkdown(dir: string): Promise<string[]> {
  if (!(await fs.pathExists(dir))) return [];
  const out: string[] = [];
  for (const e of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listMarkdown(p)));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** Loads every `*.md` under `dir` as a guide. Paths in diagnostics are relative to `relativeTo`. */
export async function loadGuidesDir(
  dir: string,
  relativeTo: string,
): Promise<{ nodes: ParsedNode[]; diagnostics: Diagnostic[] }> {
  const rel = (abs: string) => path.relative(relativeTo, abs).split(path.sep).join('/');
  const files = await listMarkdown(dir);
  if (files.length === 0)
    return {
      nodes: [],
      diagnostics: [{ severity: 'warning', code: 'no-guides', message: `no Markdown guides under ${rel(dir) || dir}` }],
    };
  const raws = new Map(await Promise.all(files.map(async (f) => [rel(f), await fs.readFile(f, 'utf8')] as const)));
  const anchors = new Map<string, Set<string>>();
  for (const [file, raw] of raws) {
    const set = new Set<string>();
    for (const l of stripFences(raw).prose.split('\n')) {
      const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(l);
      if (h) set.add(headingSlug(h[1]));
    }
    anchors.set(file, set);
  }
  const ctx: GuideContext = { anchors, exists: (p) => fs.existsSync(path.resolve(relativeTo, p)) };
  const nodes: ParsedNode[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const [file, raw] of raws) {
    const r = parseGuideFile(raw, file, ctx);
    diagnostics.push(...r.diagnostics);
    if (r.node) nodes.push(r.node);
    for (const f of stripFences(raw).fences) {
      if (f.lang !== 'mermaid' || !f.text.trim()) continue; // an empty block is reported by the lint
      const problem = await mermaidProblem(f.text);
      if (problem)
        diagnostics.push({
          severity: 'error',
          code: 'invalid-diagram',
          message: `line ${f.endLine + 1}: mermaid diagram does not parse: ${problem}`,
          file,
          ...(r.node ? { nodeId: r.node.id } : {}),
        });
    }
  }
  return { nodes, diagnostics };
}
