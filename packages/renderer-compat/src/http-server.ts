/**
 * http-server.ts
 *
 * Tiny static file server for serving the bundle to Playwright.
 * Resolves and verifies every requested path is inside the bundle directory
 * before reading — guards against path-traversal attacks via `..` segments.
 */

import http from 'http';
import path from 'path';
import fs from 'fs-extra';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

export interface ServerHandle {
  port: number;
  /** Absolute base URL — `http://127.0.0.1:<port>`. */
  url: string;
  /** Stop the server and release the port. */
  close: () => Promise<void>;
}

export interface StartServerOptions {
  /** Directory to serve files from. Resolved to absolute. */
  rootDir: string;
  /** Optional fixed port — defaults to OS-assigned (port 0). */
  port?: number;
}

export async function startServer({ rootDir, port = 0 }: StartServerOptions): Promise<ServerHandle> {
  const root = path.resolve(rootDir);

  if (!(await fs.pathExists(root))) {
    throw new Error(`http-server: rootDir does not exist: ${root}`);
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const requestUrl = new URL(req.url ?? '/', 'http://localhost');
        const urlPath = decodeURIComponent(requestUrl.pathname);

        // Resolve the candidate file path, then verify it stays inside root.
        const candidate = path.resolve(root, '.' + (urlPath === '/' ? '/index.html' : urlPath));
        const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;

        if (candidate !== root && !candidate.startsWith(rootWithSep)) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          return res.end('Forbidden');
        }

        const stat = await fs.stat(candidate).catch(() => null);
        if (!stat || !stat.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('Not found');
        }

        const data = await fs.readFile(candidate);
        const ext = path.extname(candidate).toLowerCase();
        res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.writeHead(200);
        res.end(data);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end((err as Error).message);
      }
    });

    server.on('error', reject);

    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        port: addr.port,
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}
