#!/usr/bin/env node
// Static file server for an extracted Kinetic Docs release. Zero dependencies, no application logic:
// it only maps URLs to files. Any static host (nginx, S3+CDN, IIS, `python -m http.server`) works equally well.
//
//   node serve.mjs [--port 8080] [--host 127.0.0.1] [--base /]
//
// --base serves the release under a sub-path, e.g. --base /docs/v1/ to rehearse a non-root deployment.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(opt('port', '8080'));
const host = opt('host', '127.0.0.1');
let base = opt('base', '/');
if (!base.startsWith('/')) base = '/' + base;
if (!base.endsWith('/')) base += '/';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.dot': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.parquet': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.vtt': 'text/vtt; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (rel + '/' === base) {
    res.writeHead(301, { Location: base }).end();
    return;
  }
  if (!rel.startsWith(base)) {
    res.writeHead(404).end('Not found');
    return;
  }

  let file = path.resolve(root, '.' + path.posix.sep + rel.slice(base.length));
  // Traversal guard: the resolved path must stay inside the release directory.
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!rel.endsWith('/')) {
      res.writeHead(301, { Location: url.pathname + '/' }).end();
      return;
    }
    file = path.join(file, 'index.html');
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }

  const size = fs.statSync(file).size;
  const headers = {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(size - Number(range[2]), 0);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
    });
    if (req.method === 'HEAD') return void res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') return void res.end();
  fs.createReadStream(file).pipe(res);
});

server.listen(port, host, () => {
  const a = server.address();
  console.log(`Kinetic Docs release served at http://${host}:${a.port}${base}  (Ctrl+C to stop)`);
});
