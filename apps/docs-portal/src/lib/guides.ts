import { marked } from 'marked';
import type { GuideItem } from './knowledge';

export const CATEGORY_LABELS: Record<string, string> = {
  'business-process': 'Business processes',
  'role-tasks': 'Tasks by role',
  configuration: 'Configuration',
  troubleshooting: 'Troubleshooting',
  release: 'Release notes',
};
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

export const DOC_TYPE_LABELS: Record<string, string> = {
  tutorial: 'Tutorial',
  'how-to': 'How-to',
  explanation: 'Explanation',
  reference: 'Reference',
};

/** GitHub-style heading slug, so the `#anchor` links authored in the guides resolve. */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

/** First declared category; guides with none are grouped by their document type instead of a vague "Other". */
export function primaryCategory(g: GuideItem): string {
  return g.categories[0] ?? `type:${g.docType}`;
}

const TYPE_GROUP_LABELS: Record<string, string> = {
  tutorial: 'Tutorials',
  'how-to': 'More how-to guides',
  explanation: 'Explanations',
  reference: 'Reference',
};

export function categoryLabel(c: string): string {
  if (c.startsWith('type:')) return TYPE_GROUP_LABELS[c.slice(5)] ?? 'More guides';
  return CATEGORY_LABELS[c] ?? 'More guides';
}

/** Guides grouped by first category, in a fixed category order, titles sorted within. */
export function groupGuides(guides: GuideItem[]): { category: string; label: string; guides: GuideItem[] }[] {
  const map = new Map<string, GuideItem[]>();
  for (const g of guides) {
    const c = primaryCategory(g);
    map.set(c, [...(map.get(c) ?? []), g]);
  }
  const rank = (c: string) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : 99 + c.length);
  return [...map.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([category, gs]) => ({ category, label: categoryLabel(category), guides: gs }));
}

export interface Heading {
  depth: number;
  id: string;
  text: string;
}

/**
 * Renders a guide body to HTML. Headings get ids, the leading `#` title is dropped (the layout shows
 * it), links to sibling `.md` guides become links to their pages, and `[[kind:id]]` wikilinks to
 * other guides become links too; other wikilinks fall back to their id as text.
 */
export function renderGuide(body: string, knownSlugs: Set<string>): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const seen = new Map<string, number>();
  const renderer = new marked.Renderer();
  renderer.heading = (text: string, depth: number) => {
    let id = headingSlug(text);
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    if (n > 0) id = `${id}-${n}`;
    if (depth === 2 || depth === 3) headings.push({ depth, id, text: text.replace(/<[^>]+>/g, '') });
    return `<h${depth} id="${id}">${text}</h${depth}>\n`;
  };
  renderer.link = (href: string, title: string | null | undefined, text: string) => {
    const url = href ?? '';
    const external = /^https?:/.test(url);
    const md = /^(?:\.\/)?([\w.-]+)\.md(#.*)?$/.exec(url);
    let out = url;
    if (md) {
      // Sibling guides become page links; any other .md (ADRs, repo files) is not published, so keep the text only.
      if (!knownSlugs.has(md[1])) return text;
      out = `../${md[1]}/${md[2] ?? ''}`;
    } else if (!external && !url.startsWith('#') && !url.startsWith('mailto:')) {
      return text;
    }
    return `<a href="${out}"${title ? ` title="${title}"` : ''}${external ? ' rel="noopener"' : ''}>${text}</a>`;
  };
  const withoutTitle = body.replace(/^#\s+.+\n+/, '');
  const withLinks = withoutTitle.replace(/\[\[guide:([a-z0-9_-]+)\]\]/g, (_, slug) =>
    knownSlugs.has(slug) ? `[${slug}](${slug}.md)` : slug,
  );
  const html = marked.parse(withLinks, { renderer, gfm: true }) as string;
  return { html, headings };
}
