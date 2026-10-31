import { z } from 'zod';
import { EVIDENCE_TYPES, NODE_KINDS, SLUG_RE } from './registry';

export const NODE_ID_RE = new RegExp(`^(${NODE_KINDS.join('|')}):${SLUG_RE.source.slice(1)}`);

export const EvidenceSchema = z
  .object({
    type: z.enum(EVIDENCE_TYPES),
    /** playwright-step */
    page: z.string().min(1).optional(),
    step: z.string().min(1).optional(),
    /** file */
    path: z.string().min(1).optional(),
    symbol: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    /** Free-form version or commit the author last checked this against. Not machine-verified. */
    verifiedAt: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.type === 'playwright-step' && (!e.page || !e.step)) {
      ctx.addIssue({ code: 'custom', message: 'playwright-step evidence needs "page" and "step"' });
    }
    if (e.type === 'file' && !e.path) {
      ctx.addIssue({ code: 'custom', message: 'file evidence needs "path"' });
    }
    if (e.type === 'authored' && !e.description) {
      ctx.addIssue({ code: 'custom', message: 'authored evidence needs "description"' });
    }
  });

export const RelationshipSchema = z
  .object({
    // Validated against the registry later so the error can name file + node, not a zod path.
    type: z.string().min(1),
    target: z.string().min(1),
    evidence: z.array(EvidenceSchema).default([]),
  })
  .strict();

export const FrontmatterSchema = z
  .object({
    id: z
      .string()
      .regex(NODE_ID_RE, 'id must look like "<kind>:<slug>", e.g. "concept:invoice-approval"'),
    kind: z.string().min(1),
    /** Default-locale text. Other locales override via the `knowledge` section of locale files. */
    title: z.string().min(1),
    summary: z.string().min(1),
    aliases: z.array(z.string().min(1)).default([]),
    relationships: z.array(RelationshipSchema).default([]),
    evidence: z.array(EvidenceSchema).default([]),
  })
  .strict();

export type Evidence = z.infer<typeof EvidenceSchema>;
export type RelationshipDecl = z.infer<typeof RelationshipSchema>;
export type Frontmatter = z.infer<typeof FrontmatterSchema>;
