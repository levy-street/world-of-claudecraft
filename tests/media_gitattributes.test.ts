// Git's text heuristic samples only the first block of a file, so a media asset
// with a pure-ASCII header (a Radiance .hdr) can pass as text. On a fresh
// Windows checkout with core.autocrlf=true that smudged two env HDRs from LF to
// CRLF, build_media_manifest.mjs hashed the smudged bytes, and the gate's
// manifest freshness step failed on src/render/assets/manifest.generated.ts.
//
// The fix is a `binary` .gitattributes pin per media extension. This suite
// welds that pin list to the manifest script's MEDIA_EXTENSIONS set, re-read
// from source each run so a new media extension cannot land without its pin.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.join(__dirname, '..');
const gitattributes = readFileSync(path.join(root, '.gitattributes'), 'utf8');
const manifestSource = readFileSync(path.join(root, 'scripts/build_media_manifest.mjs'), 'utf8');

function manifestMediaExtensions(): string[] {
  const block = manifestSource.match(/const MEDIA_EXTENSIONS = new Set\(\[([\s\S]*?)\]\)/);
  if (!block) throw new Error('MEDIA_EXTENSIONS set not found in scripts/build_media_manifest.mjs');
  const exts = [...block[1].matchAll(/'\.([a-z0-9]+)'/g)].map((m) => m[1]);
  if (exts.length === 0) throw new Error('MEDIA_EXTENSIONS set parsed empty');
  return exts;
}

function binaryPinnedExtensions(): Set<string> {
  const pinned = new Set<string>();
  for (const line of gitattributes.split('\n')) {
    const m = line.match(/^\*\.([a-z0-9]+)\s+binary\s*$/);
    if (m) pinned.add(m[1]);
  }
  return pinned;
}

describe('media .gitattributes binary pins', () => {
  it('pins every MEDIA_EXTENSIONS entry as binary', () => {
    const pinned = binaryPinnedExtensions();
    const missing = manifestMediaExtensions().filter((ext) => !pinned.has(ext));
    expect(missing, 'add `*.<ext> binary` to .gitattributes for each').toEqual([]);
  });
});
