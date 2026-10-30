import path from 'path';
import fs from 'fs-extra';
import { search, type SearchIndex } from '../knowledge/search';
import { neighborhood } from '../knowledge/query';

/**
 * Example of a consumer that never touches Astro or the portal: it reads a release directory directly.
 *   knowledge:query <release-dir> search <text> [--locale en-US]
 *   knowledge:query <release-dir> node <id> [--depth 2] [--types uses,depends_on] [--locale en-US]
 */
async function main(): Promise<void> {
  const [dirArg, cmd, arg, ...rest] = process.argv.slice(2);
  if (!dirArg || !cmd || !arg) {
    console.error(
      'usage: knowledge:query <release-dir> (search <text> | node <id>) [--locale L] [--depth N] [--types a,b]',
    );
    process.exit(2);
  }
  const flag = (n: string) =>
    rest.includes(`--${n}`) ? rest[rest.indexOf(`--${n}`) + 1] : undefined;
  const dir = path.resolve(dirArg);
  const manifest = await fs.readJson(path.join(dir, 'manifest.json'));
  const locale = flag('locale') ?? manifest.defaultLocale;

  if (cmd === 'search') {
    const index: SearchIndex = await fs.readJson(
      path.join(dir, `knowledge/search/search-index.${locale}.json`),
    );
    for (const h of search(index, arg)) console.log(`${h.doc.id}\t${h.doc.title}`);
    return;
  }
  const { edges } = await fs.readJson(path.join(dir, 'knowledge/graph/edges.json'));
  const { nodes: text } = await fs.readJson(path.join(dir, `knowledge/content/${locale}.json`));
  const registry = await fs.readJson(path.join(dir, 'knowledge/registry.json'));
  const symmetric = Object.entries(registry.relationships)
    .filter(([, d]) => (d as { symmetric: boolean }).symmetric)
    .map(([k]) => k);
  const hood = neighborhood(edges, arg, {
    depth: Number(flag('depth') ?? 1),
    types: flag('types')?.split(','),
    symmetric,
  });
  console.log(`${arg} — ${text[arg]?.title ?? '(unknown)'}`);
  for (const e of hood.edges)
    console.log(`  ${e.source} -[${e.type}/${e.verification}]-> ${e.target}`);
  if (hood.truncated)
    console.log('  … truncated; narrow with --types or raise --depth deliberately');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
