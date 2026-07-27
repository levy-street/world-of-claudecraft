// Static server for the Armory picker. UI files (index.html, picker.js) are
// served from this script's directory; everything generated (manifest.json,
// atlases/, work/, three.bundle.js, guide.html) from the untracked workspace
// at tmp/asset_pipeline/armor_picker. Run from the repo root:
//   node scripts/asset_pipeline/armor/serve.mjs [port]

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(SCRIPTS, '../../..', 'tmp/asset_pipeline/armor_picker');
const UI_FILES = new Set(['index.html', 'picker.js']);
const PORT = Number(process.argv[2] ?? 5181);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.css': 'text/css; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '');
    if (path === '' || path === '.') path = 'index.html';
    const root = UI_FILES.has(path) ? SCRIPTS : WORKSPACE;
    const file = join(root, path);
    if (!file.startsWith(root)) throw new Error('forbidden');
    const body = await readFile(file);
    // Forge artifacts are rewritten in place at stable URLs; never let the
    // browser cache a stale GLB or manifest.
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(PORT, () => console.log(`armory picker: http://localhost:${PORT}/`));
