import path from 'path';
import fs from 'fs-extra';
import dotenv from 'dotenv';
import { buildKnowledge, defaultPaths } from '../knowledge/source';
import { formatDiagnostic, hasErrors } from '../knowledge/model';

dotenv.config();

/**
 * Writes the compiled knowledge files to dist/knowledge/ so consumers such as the Astro portal can read
 * them as plain files (no engine imports). The release builder produces the same bytes from the same code.
 * `compiled.json` records which docs version the evidence was checked against.
 */
async function main(): Promise<void> {
  const out = path.resolve(process.argv[2] ?? 'dist/knowledge');
  const paths = defaultPaths();
  const build = await buildKnowledge(paths);
  build.diagnostics.filter((d) => d.severity === 'error').forEach((d) => console.error(formatDiagnostic(d)));
  if (hasErrors(build.diagnostics)) process.exit(1);

  await fs.emptyDir(out);
  for (const [p, content] of build.artifacts) await fs.outputFile(path.join(out, p), content);
  await fs.outputJson(path.join(out, 'compiled.json'), { docsVersion: paths.docsVersion }, { spaces: 2 });
  console.log(`✅ ${build.artifacts.size} knowledge files → ${path.relative(process.cwd(), out)}`);
}

main().catch((e) => {
  console.error('❌ knowledge-compile failed:', e);
  process.exit(1);
});
