// Renders the bag-icon WebP for each active buddy whistle from its shipped
// GLB. Retired batch rows are preserved in archived-features/buddies-and-cosmetics.
// No text-to-image generation, no internet reference art. Reuses the
// asset-pipeline's generic headless preview renderer (hero turntable view:
// auto-framed bounding sphere, no weapon-specific tilt).
//
// preview_entry.js's GLTFLoader has no KTX2Loader wired, so every
// KTX2-compressed buddy GLB (public/models/CLAUDE.md's compression truth)
// gets ktxdecompress'd to a throwaway temp copy first; the committed .glb
// files themselves are never touched.
//
// Usage: node scripts/assets/render_buddy_item_icons.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { closePreview, renderThumb } from '../asset_pipeline/lib/preview.mjs';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'public/ui/items');
const TMP_DIR = path.join(ROOT, 'tmp/buddy_icons');
mkdirSync(TMP_DIR, { recursive: true });

export const BUDDY_ICON_BATCH = [
  { itemId: 'whistle_horse', glb: 'public/models/buddies/horse.glb' },
  { itemId: 'whistle_crystal_lich', glb: 'public/models/buddies/crystal_lich.glb' },
  { itemId: 'whistle_forgemaw', glb: 'public/models/buddies/forgemaw.glb' },
];

/** True when a GLB declares the KTX2 texture extension, which the preview
 *  renderer's GLTFLoader has no loader wired for.
 */
function usesKtx2(file) {
  const buf = readFileSync(file);
  const jsonLength = buf.readUInt32LE(12);
  const json = buf.toString('utf8', 20, 20 + jsonLength);
  return json.includes('KHR_texture_basisu');
}

async function renderOne({ itemId, glb, tint }) {
  // Read the need for a decode off the FILE, not off its directory: the roster
  // now pulls rigs from creatures/ and chars/enemies/ too, and KTX2 is a
  // per-asset choice there (the old path heuristic silently skipped them and
  // the loader threw setKTX2Loader mid-render).
  const needsKtxDecode = usesKtx2(path.join(ROOT, glb));
  const sourceGlb = path.join(ROOT, glb);
  let renderSource = sourceGlb;
  if (needsKtxDecode) {
    renderSource = path.join(TMP_DIR, `${itemId}_decoded.glb`);
    execFileSync(
      'npx',
      ['--no-install', 'gltf-transform', 'ktxdecompress', sourceGlb, renderSource],
      { stdio: 'inherit', shell: true },
    );
  }
  const tmpPng = path.join(TMP_DIR, `${itemId}.png`);
  await renderThumb(renderSource, tmpPng, { size: 320 });
  let img = sharp(tmpPng).resize(128, 128, { fit: 'cover' });
  if (tint) img = img.tint({ r: tint[0], g: tint[1], b: tint[2] });
  const dest = path.join(OUT_DIR, `${itemId}.webp`);
  await img.webp({ quality: 90 }).toFile(dest);
  console.log(`✓ ${itemId}.webp`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // Optional item-id arguments render just those rows. The renderer is not
  // byte-deterministic, so re-running the whole batch to add a single icon
  // rewrites every shipped webp and drags the art ledger along with it; name
  // the new ids instead and the rest of the catalog stays untouched.
  const only = new Set(process.argv.slice(2));
  const batch = only.size ? BUDDY_ICON_BATCH.filter((e) => only.has(e.itemId)) : BUDDY_ICON_BATCH;
  const missing = [...only].filter((id) => !batch.some((e) => e.itemId === id));
  if (missing.length) throw new Error(`not in BUDDY_ICON_BATCH: ${missing.join(', ')}`);
  for (const entry of batch) await renderOne(entry);
  await closePreview();
  rmSync(TMP_DIR, { recursive: true, force: true });
  console.log(`\nrendered ${batch.length} buddy icons -> ${OUT_DIR}`);
}
