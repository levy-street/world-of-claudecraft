import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The blank setContent icon-render pages cannot serve /basis/ over the
// network, so scripts/lib/ktx2_entry.js pre-seeds THREE.Cache with the
// injected transcoder before KTX2Loader's FileLoaders ask for it. That only
// works while the pre-seed keys match FileLoader's cache-key shape, which
// three r185 changed from the raw url to 'file:' + the manager-resolved url.
// Both sides are pinned here so a future three bump that moves the key shape
// goes red naming the entry file instead of silently falling through to a
// network fetch that hangs the renderer.

const ROOT = path.resolve(__dirname, '..');
const entrySource = readFileSync(path.join(ROOT, 'scripts', 'lib', 'ktx2_entry.js'), 'utf8');
const fileLoaderSource = readFileSync(
  path.join(ROOT, 'node_modules', 'three', 'src', 'loaders', 'FileLoader.js'),
  'utf8',
);

describe('ktx2 transcoder cache pre-seed', () => {
  it('seeds both transcoder files under the file: namespace FileLoader consults', () => {
    expect(entrySource).toContain("THREE.Cache.add('file:/basis/basis_transcoder.js'");
    expect(entrySource).toContain("THREE.Cache.add('file:/basis/basis_transcoder.wasm'");
    // The raw-key spelling (the r165 shape) must not linger beside the fix.
    expect(entrySource).not.toContain("THREE.Cache.add('/basis/");
  });

  it('pins the installed FileLoader cache-key shape the pre-seed depends on', () => {
    expect(fileLoaderSource).toContain('Cache.get( `file:${url}` )');
    expect(fileLoaderSource).toContain('Cache.add( `file:${url}`');
  });
});
