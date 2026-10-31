import fs from 'fs-extra';
import path from 'path';
import { dirs } from './workspace.mjs';
import { loadKnowledge, guidesFor, type GuideItem } from './knowledge';
import { groupGuides } from './guides';

export interface Walkthrough {
  id: string;
  title: string;
  description: string;
  group: string;
  hasVideo: boolean;
}

export interface HomeData {
  version: string;
  locales: string[];
  guideGroups: ReturnType<typeof groupGuides>;
  guideCount: number;
  walkthroughs: Walkthrough[];
  hasExplorer: boolean;
}

const plain = (md: string) => md.replace(/\*\*|__|[*_`]/g, '').trim();

export async function homeLocales(): Promise<string[]> {
  if (!(await fs.pathExists(dirs.locales))) return [];
  return (await fs.readdir(dirs.locales))
    .filter((f: string) => f.endsWith('.json'))
    .map((f: string) => path.basename(f, '.json'))
    .sort();
}

/** What the home page for one locale shows: guides by category, walkthroughs, and whether the explorer exists. */
export async function homeData(locale: string): Promise<HomeData> {
  const knowledge = loadKnowledge();
  const locales = await homeLocales();
  let version = knowledge?.docsVersion ?? 'v1.0';
  const walkthroughs: Walkthrough[] = [];
  try {
    if (!knowledge) version = (await fs.readdir(dirs.generated)).sort().at(-1) ?? version;
    const skeleton = await fs.readJson(path.join(dirs.generated, version, 'extracted-skeleton.json'));
    const pages = (await fs.readJson(path.join(dirs.locales, `${locale}.json`))).pages ?? {};
    for (const p of skeleton) {
      walkthroughs.push({
        id: p.pageId,
        title: pages[p.pageId]?.title ?? p.pageId,
        description: plain(pages[p.pageId]?.description ?? ''),
        group: (pages[p.pageId]?.breadcrumbs ?? [])[0] ?? '',
        hasVideo: !p.videoless && fs.existsSync(path.join(dirs.public, 'video-cache', version, `${locale}_${p.pageId}.mp4`)),
      });
    }
  } catch {
    /* no walkthroughs built */
  }
  const guides: GuideItem[] = knowledge ? guidesFor(knowledge, locale) : [];
  return {
    version,
    locales,
    guideGroups: groupGuides(guides),
    guideCount: guides.length,
    walkthroughs,
    hasExplorer: !!knowledge && (process.env.KINETIC_EXPLORER_PATH ?? '../explorer/') !== '',
  };
}
