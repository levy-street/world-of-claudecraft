// Rebuild the sampled SFX runtime manifest without generating or editing audio.

import { relative } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { writeSfxManifest } from './sfx/manifest.mjs';
import { writeSfxGainCeilings } from './sfx/sfx_gain_ceiling.mjs';

const repoRoot = process.cwd();
const { path, runtimePath, entries } = writeSfxManifest(repoRoot);
console.log(`SFX manifest: ${Object.keys(entries).length} clips -> ${relative(repoRoot, path)}`);
console.log(`SFX runtime pack: ${relative(repoRoot, runtimePath)}`);

// Regenerated in the SAME step so it can never silently go stale relative to
// the manifest: any change to a custom key's audio (or to which keys are
// marked custom) is reflected in the gain-map ceiling on the very next build.
const { path: ceilingPath, ceilings } = writeSfxGainCeilings(repoRoot, ffmpegPath);
console.log(
  `SFX gain ceilings: ${Object.keys(ceilings).length} custom keys -> ${relative(repoRoot, ceilingPath)}`,
);
