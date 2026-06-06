import { z } from 'zod';

// #14: Single source-of-truth schema for locale JSON files.
// Validated at pipeline startup — a typo in a locale file fails immediately with
// a clear message rather than a cryptic undefined-access deep in the pipeline.

const PageSchema = z.object({
  title: z.string().min(1, 'Page title must not be empty'),
  description: z.string().min(1, 'Page description must not be empty'),
  breadcrumbs: z.array(z.string()).min(1, 'At least one breadcrumb is required'),
});

export const LocaleSchema = z.object({
  locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/, 'locale must be in BCP-47 format, e.g. "en-US"'),
  dir: z.enum(['ltr', 'rtl']),
  pages: z.record(z.string(), PageSchema),
  strings: z.record(z.string(), z.string().min(1, 'String values must not be empty')),
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
