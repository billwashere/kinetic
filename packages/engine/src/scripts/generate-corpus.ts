import path from 'path';
import fs from 'fs-extra';
import dotenv from 'dotenv';
import { validateLocale } from '../engine/locale-schema';
import { generateCorpusLines } from '../lib/text-exporter';
import { resolvePath } from '../engine/workspace-config';

dotenv.config();

const VERSION = process.env.DOCS_VERSION || 'v1.0';
const LOCALES_DIR = resolvePath('locales', path.join(process.cwd(), 'content/locales'));
const PUBLIC_DIR = resolvePath('public', path.join(process.cwd(), 'public'));
const GENERATED_DIR = resolvePath('generated', path.join(process.cwd(), 'generated'));

async function main(): Promise<void> {
  const skeletonPath = path.join(GENERATED_DIR, VERSION, 'extracted-skeleton.json');

  if (!(await fs.pathExists(skeletonPath))) {
    console.error(`❌ No skeleton at ${skeletonPath} — run "pnpm test:docs" first.`);
    process.exit(1);
  }

  const skeleton = await fs.readJson(skeletonPath);
  const localeFiles = (await fs.readdir(LOCALES_DIR)).filter((f) => f.endsWith('.json'));

  const outPath = path.join(GENERATED_DIR, VERSION, 'corpus.jsonl');
  await fs.ensureDir(path.dirname(outPath));

  const jsonlLines: string[] = [];

  for (const localeFile of localeFiles) {
    const locale = path.basename(localeFile, '.json');
    const localePath = path.join(LOCALES_DIR, localeFile);
    const localeData = validateLocale(await fs.readJson(localePath), localePath);

    const manifestPath = path.join(PUBLIC_DIR, `audio-manifest-${VERSION}-${locale}.json`);
    const manifest = (await fs.pathExists(manifestPath)) ? await fs.readJson(manifestPath) : null;

    if (!manifest) {
      console.warn(
        `⚠️  No audio manifest for ${locale} — durationSeconds will be null for all steps.`,
      );
    }

    for (const page of skeleton) {
      const records = generateCorpusLines(page, localeData, manifest, locale, VERSION);
      for (const record of records) {
        jsonlLines.push(JSON.stringify(record));
      }
    }
  }

  await fs.writeFile(outPath, jsonlLines.join('\n') + '\n', 'utf8');
  console.log(
    `✅ Wrote ${jsonlLines.length} records → ${path.relative(process.cwd(), outPath)}`,
  );
}

main().catch((err) => {
  console.error('❌ generate-corpus failed:', err);
  process.exit(1);
});
