import path from 'path';
import fs from 'fs-extra';
import { formatDiagnostic, hasErrors } from '../knowledge/model';
import { verifyReleaseDir, verifyZip } from '../knowledge/verify';

// Usage: release:verify <release-dir | extracted-zip-dir | file.zip> [--offline]
async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: release:verify <release-dir|file.zip> [--offline]');
    process.exit(2);
  }
  const abs = path.resolve(target);
  const ds = abs.endsWith('.zip')
    ? (await verifyZip(abs)).diagnostics
    : await verifyReleaseDir(abs, process.argv.includes('--offline') ? 'offline' : 'cdn');
  ds.forEach((d) => console.log(formatDiagnostic(d)));
  console.log(hasErrors(ds) ? `❌ ${ds.length} problem(s)` : '✅ release verified');
  if (hasErrors(ds)) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
