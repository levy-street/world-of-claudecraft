// Rebuild the sampled SFX runtime manifest without generating or editing audio.

import { relative } from 'node:path';
import { writeSfxManifest } from './sfx/manifest.mjs';

const repoRoot = process.cwd();
const { path, runtimePath, entries } = writeSfxManifest(repoRoot);
console.log(`SFX manifest: ${Object.keys(entries).length} clips -> ${relative(repoRoot, path)}`);
console.log(`SFX runtime pack: ${relative(repoRoot, runtimePath)}`);
