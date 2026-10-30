import fs from 'fs-extra';
import path from 'path';
import { sha256 } from './release';
import { verifyReleaseDir } from './verify';

export interface ReleasePointer {
  pointerVersion: 1;
  releaseId: string;
  /** Relative to the pointer file, so the CDN root can live under any path. */
  manifest: string;
  manifestSha256: string;
  /** The release this one replaced — rollback target. */
  previous: string | null;
}

/**
 * Atomically points `current.json` at a release.
 *
 * Order matters: the release directory is fully verified BEFORE the pointer moves, and the pointer
 * is written last (tmp + rename), so a client never sees a manifest whose artefacts are not yet there.
 * Rolling back is the same operation aimed at an older retained release — nothing is rebuilt.
 */
export async function promote(cdnRoot: string, releaseId: string): Promise<ReleasePointer> {
  const dir = path.join(cdnRoot, 'releases', releaseId);
  const problems = (await verifyReleaseDir(dir, 'cdn')).filter((d) => d.severity === 'error');
  if (problems.length) {
    throw new Error(
      `refusing to promote ${releaseId}: ${problems.length} integrity problem(s), first: ${problems[0].code} ${problems[0].file ?? ''}`,
    );
  }
  const pointerPath = path.join(cdnRoot, 'current.json');
  const previous = (await fs.pathExists(pointerPath))
    ? ((await fs.readJson(pointerPath)) as ReleasePointer).releaseId
    : null;

  const pointer: ReleasePointer = {
    pointerVersion: 1,
    releaseId,
    manifest: `releases/${releaseId}/manifest.json`,
    manifestSha256: sha256(await fs.readFile(path.join(dir, 'manifest.json'))),
    previous: previous === releaseId ? null : previous,
  };
  const tmp = `${pointerPath}.tmp`;
  await fs.outputFile(tmp, JSON.stringify(pointer, null, 2) + '\n');
  await fs.rename(tmp, pointerPath);
  return pointer;
}

export async function listReleases(cdnRoot: string): Promise<string[]> {
  const dir = path.join(cdnRoot, 'releases');
  return (await fs.pathExists(dir)) ? (await fs.readdir(dir)).sort() : [];
}
