import path from 'path';
import fs from 'fs-extra';
import dotenv from 'dotenv';
import { validateLocale } from '../engine/locale-schema';
import { resolvePath } from '../engine/workspace-config';
import { lintProcedures } from '../lib/procedure-style';

dotenv.config();

// Usage: docs:lint [--strict]   Procedure style warnings (Microsoft Writing Style Guide) for DOCS_VERSION.
async function main(): Promise<void> {
  const version = process.env.DOCS_VERSION || 'v1.0';
  const localesDir = resolvePath('locales', path.join(process.cwd(), 'content/locales'));
  const generatedDir = resolvePath('generated', path.join(process.cwd(), 'generated'));
  const skeleton = await fs.readJson(path.join(generatedDir, version, 'extracted-skeleton.json'));
  const locales = [];
  for (const f of (await fs.readdir(localesDir)).filter((x) => x.endsWith('.json')).sort()) {
    const p = path.join(localesDir, f);
    locales.push(validateLocale(await fs.readJson(p), p));
  }
  const findings = lintProcedures(skeleton, locales);
  for (const f of findings) {
    console.log(
      `warning[${f.code}] ${f.locale} ${f.pageId}${f.stepId ? `/${f.stepId}` : ''}: ${f.message}`,
    );
  }
  console.log(
    `\n${findings.length ? '⚠️ ' : '✅'} ${findings.length} procedure style finding(s) in ${version}`,
  );
  if (process.argv.includes('--strict') && findings.length) process.exit(1);
}

main().catch((e) => {
  console.error('❌ docs-lint failed:', e);
  process.exit(1);
});
