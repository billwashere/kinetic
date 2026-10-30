import path from 'path';
import { promote, listReleases } from '../knowledge/cdn';

// Usage: release:promote <cdn-root> <release-id>   (also used to roll back to a retained release)
async function main(): Promise<void> {
  const [root, id] = process.argv.slice(2);
  if (!root) {
    console.error('usage: release:promote <cdn-root> <release-id>');
    process.exit(2);
  }
  const cdn = path.resolve(root);
  if (!id) {
    console.log('Retained releases:\n' + (await listReleases(cdn)).map((r) => `  ${r}`).join('\n'));
    return;
  }
  const p = await promote(cdn, id);
  console.log(`✅ current.json → ${p.releaseId}${p.previous ? ` (previous: ${p.previous})` : ''}`);
}
main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
