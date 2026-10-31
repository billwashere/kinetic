import { resolvePath } from '../engine/workspace-config';
/**
 * diff-check — Version-to-version documentation regression tool
 *
 * Usage:
 *   ts-node src/scripts/diff-check.ts --from v1.0 --to v2.0 [--visual] [--locale en-US]
 *
 * Flags:
 *   --from <version>    Required. Baseline version to compare against.
 *   --to <version>      Target version. Defaults to DOCS_VERSION env var.
 *   --visual            Optional. Generate ffmpeg pixel-diff MP4 artifacts for human review.
 *   --locale <locale>   Optional. Restrict visual diffs to a single locale.
 *
 * Exit codes:
 *   0  No breaking changes detected (warnings and info findings are still reported)
 *   1  One or more breaking changes detected — CI should block the pipeline
 *   2  Script error (missing version, file not found, etc.)
 *
 * The JSON report is always written to:
 *   generated/<toVersion>/diff-from-<fromVersion>.json
 */

import fs from 'fs-extra';
import path from 'path';
import dotenv from 'dotenv';
import { diffSkeletons } from '../lib/differ/skeleton-diff';
import { diffAnchors } from '../lib/differ/anchor-diff';
import { generateVisualDiffs } from '../lib/differ/visual-diff';
import { buildReport } from '../lib/differ/types';
import type { Finding } from '../lib/differ/types';
import type { DocPage } from '../lib/doc-extractor';

dotenv.config();

const LOCALES_DIR = resolvePath('locales', path.join(process.cwd(), 'content/locales'));
const PUBLIC_DIR = resolvePath('public', path.join(process.cwd(), 'public'));
const GENERATED_DIR = resolvePath('generated', path.join(process.cwd(), 'generated'));

// ─── CLI argument parsing ─────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  from: string | null;
  to: string;
  visual: boolean;
  locale: string | null;
} {
  const args = argv.slice(2);
  const get = (flag: string): string | null => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? (args[idx + 1] ?? null) : null;
  };

  return {
    from: get('--from'),
    to: get('--to') ?? process.env.DOCS_VERSION ?? 'v1.0',
    visual: args.includes('--visual'),
    locale: get('--locale'),
  };
}

// ─── Console reporter ─────────────────────────────────────────────────────────

const ICONS: Record<string, string> = {
  breaking: '❌',
  warning: '⚠️ ',
  info: '✅',
};

function printReport(findings: Finding[], from: string, to: string): void {
  const breaking = findings.filter((f) => f.severity === 'breaking');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const info = findings.filter((f) => f.severity === 'info');

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Kinetic Docs — Diff Report: ${from} → ${to}`);
  console.log(`${'─'.repeat(60)}`);

  if (findings.length === 0) {
    console.log('  No changes detected between versions.\n');
    return;
  }

  for (const group of [breaking, warnings, info]) {
    for (const f of group) {
      const icon = ICONS[f.severity];
      const location = f.stepId ? `${f.pageId} / ${f.stepId}` : f.pageId;
      console.log(`  ${icon} [${f.category}] ${location}`);
      console.log(`      ${f.message}`);
      if (f.detail) {
        console.log(`      ${JSON.stringify(f.detail)}`);
      }
    }
    if (group.length) console.log('');
  }

  console.log(
    `  Summary: ${breaking.length} breaking · ${warnings.length} warnings · ${info.length} info`,
  );
  console.log(`${'─'.repeat(60)}\n`);
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

async function loadSkeleton(version: string): Promise<DocPage[]> {
  const skeletonPath = path.join(GENERATED_DIR, version, 'extracted-skeleton.json');

  if (!(await fs.pathExists(skeletonPath))) {
    throw new Error(
      `Skeleton not found for version "${version}" at: ${skeletonPath}\n` +
        `Run "pnpm test:docs" with DOCS_VERSION=${version} first.`,
    );
  }

  return fs.readJson(skeletonPath);
}

// ─── Locale discovery ─────────────────────────────────────────────────────────

async function getAvailableLocales(): Promise<string[]> {
  const localesDir = LOCALES_DIR;
  const files = await fs.readdir(localesDir);
  return files.filter((f) => f.endsWith('.json')).map((f) => path.basename(f, '.json'));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { from, to, visual, locale } = parseArgs(process.argv);

  if (!from) {
    console.error('❌ --from <version> is required. Example: --from v1.0 --to v2.0');
    process.exit(2);
  }

  if (from === to) {
    console.error(`❌ --from and --to are both "${from}" — nothing to compare.`);
    process.exit(2);
  }

  console.log(`\n🔍 Comparing ${from} → ${to}...`);

  let fromSkeleton: DocPage[];
  let toSkeleton: DocPage[];

  try {
    [fromSkeleton, toSkeleton] = await Promise.all([loadSkeleton(from), loadSkeleton(to)]);
  } catch (err: unknown) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  console.log('  📋 Structural diff...');
  const structuralFindings = diffSkeletons(fromSkeleton, toSkeleton);

  console.log('  📐 Anchor drift diff...');
  const anchorFindings = diffAnchors(fromSkeleton, toSkeleton);

  const allFindings: Finding[] = [...structuralFindings, ...anchorFindings];

  const visualArtifacts: Record<string, string> = {};

  if (visual) {
    console.log('  🎞️  Generating visual diff artifacts...');

    const allLocales = await getAvailableLocales();
    const locales = locale ? [locale] : allLocales;

    const fromPageIds = new Set(fromSkeleton.map((p) => p.pageId));
    const sharedPageIds = toSkeleton.map((p) => p.pageId).filter((id) => fromPageIds.has(id));

    const results = await generateVisualDiffs({
      fromVersion: from,
      toVersion: to,
      locales,
      pageIds: sharedPageIds,
      videoCacheDir: path.join(PUBLIC_DIR, 'video-cache'),
      outputDir: path.join(GENERATED_DIR, to, 'visual-diff'),
    });

    for (const r of results) {
      visualArtifacts[r.key] = r.artifactPath;
    }
  }

  printReport(allFindings, from, to);

  const report = buildReport(from, to, allFindings, visualArtifacts);
  const reportPath = path.join(GENERATED_DIR, to, `diff-from-${from}.json`);
  await fs.ensureDir(path.dirname(reportPath));
  await fs.writeJson(reportPath, report, { spaces: 2 });
  console.log(`📄 Report written to: ${path.relative(process.cwd(), reportPath)}`);

  const hasBreaking = allFindings.some((f) => f.severity === 'breaking');
  process.exit(hasBreaking ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error('❌ diff-check failed unexpectedly:', err);
  process.exit(2);
});
