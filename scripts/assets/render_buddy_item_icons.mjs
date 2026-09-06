// Renders the bag-icon WebP for every buddy whistle item straight from the
// buddy's own shipped GLB (public/models/buddies/*.glb, or the shared
// Quaternius fox.glb tinted per species for ember_fox/moss_hare) — no
// text-to-image generation, no internet reference art. Reuses the
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
  { itemId: 'whistle_ember_fox', glb: 'public/models/creatures/fox.glb', tint: [0xd9, 0x66, 0x2b] },
  { itemId: 'whistle_moss_hare', glb: 'public/models/creatures/fox.glb', tint: [0x6f, 0x8f, 0x5a] },
  { itemId: 'whistle_frog', glb: 'public/models/buddies/frog.glb' },
  { itemId: 'whistle_crimson_claw_crab', glb: 'public/models/buddies/crimson_claw_crab.glb' },
  { itemId: 'whistle_golden_sentinel', glb: 'public/models/buddies/golden_sentinel.glb' },
  { itemId: 'whistle_nightfang', glb: 'public/models/buddies/nightfang.glb' },
  { itemId: 'whistle_tuskhorn_boar', glb: 'public/models/buddies/tuskhorn_boar.glb' },
  { itemId: 'whistle_emerald_wolf', glb: 'public/models/buddies/emerald_wolf.glb' },
  { itemId: 'whistle_tiger', glb: 'public/models/buddies/tiger.glb' },
  { itemId: 'whistle_cate_coin', glb: 'public/models/buddies/cate_coin.glb' },
  { itemId: 'whistle_alon', glb: 'public/models/buddies/alon.glb' },
  { itemId: 'whistle_trollface', glb: 'public/models/buddies/trollface.glb' },
  { itemId: 'whistle_ansem', glb: 'public/models/buddies/ansem.glb' },
  { itemId: 'whistle_triple_t', glb: 'public/models/buddies/triple_t.glb' },
  { itemId: 'whistle_kekius', glb: 'public/models/buddies/kekius.glb' },
  { itemId: 'whistle_solbot', glb: 'public/models/buddies/solbot.glb' },
  { itemId: 'whistle_frostfire', glb: 'public/models/buddies/frostfire.glb' },
  { itemId: 'whistle_rocky', glb: 'public/models/buddies/rocky.glb' },
  // The three vendor companions (content/buddies.ts): same lane, humanoid rigs.
  { itemId: 'whistle_proud_grunt', glb: 'public/models/buddies/proud_grunt.glb' },
  { itemId: 'whistle_loot_goblin', glb: 'public/models/buddies/loot_goblin.glb' },
  { itemId: 'whistle_penny_goldspark', glb: 'public/models/buddies/penny_goldspark.glb' },
  // The beast tier and the undead, rendered from the shipped creature rigs
  // the buddy visuals reuse, tinted to each buddy dye (content/buddy_mobs.ts).
  { itemId: 'whistle_stag', glb: 'public/models/creatures/stag.glb', tint: [0xb9, 0x8a, 0x4e] },
  { itemId: 'whistle_alpaca', glb: 'public/models/creatures/alpaca.glb', tint: [0xe8, 0xdc, 0xc6] },
  { itemId: 'whistle_bull', glb: 'public/models/creatures/bull.glb', tint: [0x6b, 0x4a, 0x37] },
  { itemId: 'whistle_spider', glb: 'public/models/creatures/spider.glb', tint: [0x4a, 0x3d, 0x63] },
  {
    itemId: 'whistle_raptor',
    glb: 'public/models/creatures/velociraptor.glb',
    tint: [0x5f, 0x8a, 0x4a],
  },
  { itemId: 'whistle_skeleton', glb: 'public/models/chars/enemies/skeleton_minion.glb' },
  // The epic Nythraxis drop, from its own GLB.
  { itemId: 'whistle_crystal_lich', glb: 'public/models/buddies/crystal_lich.glb' },
  // The epic heroic-Crucible drop, from its own GLB.
  { itemId: 'whistle_forgemaw', glb: 'public/models/buddies/forgemaw.glb' },
  // The fishing catch and the green elemental, both from their own GLBs.
  { itemId: 'whistle_crystal_tide', glb: 'public/models/buddies/crystal_tide.glb' },
  { itemId: 'whistle_phantom', glb: 'public/models/buddies/phantom.glb' },
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
