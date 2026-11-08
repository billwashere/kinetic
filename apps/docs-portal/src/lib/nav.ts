import fs from 'fs-extra';
import path from 'path';
import { dirs } from './workspace.mjs';
import { groupGuides } from './guides';
import type { GuideItem } from './knowledge';

/** An entry in the site-wide side menu. Every page gets the same entries, so the menu is one thing. */
export interface NavEntry {
  id: string;
  title: string;
  url: string;
  group: string;
  subgroup: string | null;
  section: string;
}

/** Guides as menu entries: one group per category. */
export function guideNavEntries(guides: GuideItem[], url: (slug: string) => string, section: string): NavEntry[] {
  return groupGuides(guides).flatMap((grp) =>
    grp.guides.map((g) => ({ id: g.id, title: g.title, url: url(g.slug), group: grp.label, subgroup: null, section })),
  );
}

/** Walkthroughs as menu entries, grouped by their breadcrumbs, read the same way the walkthrough pages read them. */
export async function walkthroughNavEntries(
  version: string,
  locale: string,
  url: (pageId: string) => string,
  section: string,
): Promise<NavEntry[]> {
  try {
    const skeleton = await fs.readJson(path.join(dirs.generated, version, 'extracted-skeleton.json'));
    const pages = (await fs.readJson(path.join(dirs.locales, `${locale}.json`))).pages ?? {};
    return skeleton.map((p: any) => {
      const crumbs: string[] = pages[p.pageId]?.breadcrumbs ?? [];
      return {
        id: p.pageId,
        title: pages[p.pageId]?.title ?? p.pageId,
        url: url(p.pageId),
        group: crumbs[0] ?? '',
        subgroup: crumbs[1] ?? null,
        section,
      };
    });
  } catch {
    return [];
  }
}
