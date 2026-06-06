import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';

// Uses the system `ffmpeg` on PATH.
// Install via: apt-get install ffmpeg  |  brew install ffmpeg  |  choco install ffmpeg
const ffmpegPath = 'ffmpeg';

// Smart Stitching Engine: Combines MP4 clips instantly without re-encoding.
export class VideoStitcher {
  static async concat(inputFiles: string[], outputFile: string) {
    const listContent = inputFiles.map((f) => `file '${path.resolve(f)}'`).join('\n');
    const listPath = path.join(path.dirname(path.resolve(outputFile)), `stitch_${Date.now()}.txt`);
    await fs.writeFile(listPath, listContent);
    try {
      await execa(ffmpegPath, [
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listPath,
        '-c',
        'copy',
        '-y',
        path.resolve(outputFile),
      ]);
    } finally {
      await fs.remove(listPath);
    }
  }
}
