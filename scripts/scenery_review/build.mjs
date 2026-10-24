// Local research build only. Never deploy this offline-enabled bundle.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';

const out = path.resolve('tmp/scenery-review/build');
if (fs.existsSync(out))
  throw Error('Build exists; preserve it and choose a fresh checkout for another candidate.');
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const provenance = {
  started: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  status: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }),
  purpose:
    'Local offline scenery review, production minification, native tier materials and lighting. Media is hardlinked to this checkout; do not edit assets during review. Not a deployable build.',
  media: 0,
};
let transforms = 0;
await build({
  plugins: [
    {
      name: 'scenery-review-offline',
      enforce: 'pre',
      transform(code, id) {
        if (!id.endsWith('/src/game/offline_mode_gate.ts')) return;
        if (!code.includes('return isDev;')) throw Error('Offline gate changed');
        transforms++;
        return { code: code.replace('return isDev;', 'return true;'), map: null };
      },
    },
  ],
  build: {
    outDir: out,
    emptyOutDir: false,
    copyPublicDir: false,
    rollupOptions: { input: { diagnostics: path.resolve('scripts/scenery_review/hooks.ts') } },
  },
});
if (transforms !== 1) throw Error('Expected exactly one offline-gate transform');
function linkTree(source, destination) {
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source))
      linkTree(path.join(source, entry), path.join(destination, entry));
  } else {
    fs.linkSync(source, destination);
  }
}
for (const entry of fs.readdirSync('public')) {
  if (entry === 'media' || fs.existsSync(path.join(out, entry))) continue;
  linkTree(path.join('public', entry), path.join(out, entry));
}
const manifestText = fs.readFileSync('src/render/assets/manifest.generated.ts', 'utf8');
const entries = JSON.parse(
  manifestText.slice(manifestText.indexOf('{'), manifestText.lastIndexOf('}') + 1),
);
for (const [logical, url] of Object.entries(entries)) {
  const source = path.join('public', logical);
  const hash = sha(fs.readFileSync(source));
  if (/\.([0-9a-f]{12})\.[^.]+$/.exec(url)?.[1] !== hash.slice(0, 12))
    throw Error(`Media hash mismatch: ${logical}`);
  const destination = path.join(out, url.replace(/^\//, ''));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.linkSync(source, destination);
  provenance.media++;
}
provenance.manifestSha256 = sha(fs.readFileSync(path.join(out, '.vite/manifest.json')));
provenance.completed = new Date().toISOString();
fs.writeFileSync('tmp/scenery-review/build-provenance.json', JSON.stringify(provenance, null, 2));
console.log(JSON.stringify(provenance));
