// Renders the bag-icon WebP for each of the 6 new mount reins items straight
// from the mount's own shipped GLB (public/models/mounts/*.glb) — no
// text-to-image generation. Reuses the asset-pipeline's generic headless
// preview renderer (hero turntable view: auto-framed bounding sphere).
//
// preview_entry.js's GLTFLoader has no KTX2Loader wired, so every
// KTX2-compressed mount GLB gets ktxdecompress'd to a throwaway temp copy
// first; the committed .glb files themselves are never touched.
//
// Usage: node scripts/assets/render_mount_item_icons.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { closePreview, renderThumb } from '../asset_pipeline/lib/preview.mjs';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'public/ui/items');
const TMP_DIR = path.join(ROOT, 'tmp/mount_icons');
mkdirSync(TMP_DIR, { recursive: true });

export const MOUNT_ICON_BATCH = [
  { itemId: 'reins_ancient_devourer', glb: 'public/models/mounts/ancient_devourer.glb' },
  { itemId: 'reins_cinderjaw_rex', glb: 'public/models/mounts/cinderjaw_rex.glb' },
  { itemId: 'reins_claudian_wraith', glb: 'public/models/mounts/claudian_wraith.glb' },
  { itemId: 'reins_dreadnought', glb: 'public/models/mounts/dreadnought.glb' },
  { itemId: 'reins_emerald_dragon', glb: 'public/models/mounts/emerald_dragon.glb' },
  { itemId: 'reins_shiba_inu', glb: 'public/models/mounts/shiba_inu.glb' },
];

async function renderOne({ itemId, glb }) {
  const sourceGlb = path.join(ROOT, glb);
  const renderSource = path.join(TMP_DIR, `${itemId}_decoded.glb`);
  execFileSync(
    'npx',
    ['--no-install', 'gltf-transform', 'ktxdecompress', sourceGlb, renderSource],
    { stdio: 'inherit', shell: true },
  );
  const tmpPng = path.join(TMP_DIR, `${itemId}.png`);
  await renderThumb(renderSource, tmpPng, { size: 320 });
  const dest = path.join(OUT_DIR, `${itemId}.webp`);
  await sharp(tmpPng).resize(128, 128, { fit: 'cover' }).webp({ quality: 90 }).toFile(dest);
  console.log(`✓ ${itemId}.webp`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  for (const entry of MOUNT_ICON_BATCH) await renderOne(entry);
  await closePreview();
  rmSync(TMP_DIR, { recursive: true, force: true });
  console.log(`\nrendered ${MOUNT_ICON_BATCH.length} mount icons -> ${OUT_DIR}`);
}
