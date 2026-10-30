import { z } from 'zod';

// #14: Single source-of-truth schema for locale JSON files.
// Validated at pipeline startup — a typo in a locale file fails immediately with
// a clear message rather than a cryptic undefined-access deep in the pipeline.

const PageSchema = z.object({
  title: z.string().min(1, 'Page title must not be empty'),
  description: z.string().min(1, 'Page description must not be empty'),
  breadcrumbs: z.array(z.string()).min(1, 'At least one breadcrumb is required'),
  // Optional procedure framing (Microsoft Writing Style Guide): who it is for, how long it takes,
  // what must be true first, what the reader ends up with, and a closing completion statement.
  audience: z.string().min(1).optional(),
  duration: z.string().min(1).optional(),
  prerequisites: z.array(z.string().min(1)).optional(),
  outcome: z.string().min(1).optional(),
  overview: z.string().min(1).optional(),
  done: z.string().min(1).optional(),
});

// Localised text for authored knowledge nodes, keyed by node id (e.g. "concept:project").
// Ids and relationships live in content/knowledge — only display text is localised here.
const KnowledgeTextSchema = z.object({
  title: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
});

export const LocaleSchema = z.object({
  locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/, 'locale must be in BCP-47 format, e.g. "en-US"'),
  dir: z.enum(['ltr', 'rtl']),
  pages: z.record(z.string(), PageSchema),
  strings: z.record(z.string(), z.string().min(1, 'String values must not be empty')),
  knowledge: z.record(z.string(), KnowledgeTextSchema).optional(),
  // Short step headings keyed by the step's textKey. Narration still uses `strings`; headings are display-only.
  stepTitles: z.record(z.string(), z.string().min(1)).optional(),
});

export type LocaleData = z.infer<typeof LocaleSchema>;

// Call this before using any locale file in the pipeline.
// Throws a ZodError with a human-readable message on the first invalid field.
export function validateLocale(raw: unknown, filePath: string): LocaleData {
  const result = LocaleSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid locale file "${filePath}":\n${issues}`);
  }
  return result.data;
}
