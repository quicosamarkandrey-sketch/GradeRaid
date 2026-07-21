'use strict';
// Zero-dependency static file server, used only so Playwright can load the
// real index.html (with its real relative script/style paths) over http://
// instead of file:// — file:// breaks fetch()/module-style relative loads in
// some browsers and isn't representative of how this app is actually served.
// Not meant for anything beyond local smoke-test runs.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PORT = process.env.EDUQUEST_STATIC_PORT || 4173;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(ROOT, reqPath);

  // Basic path-traversal guard — this only ever serves this repo's own files.
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`[eduquest smoke] static server on http://localhost:${PORT}`);
});
