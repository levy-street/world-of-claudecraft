// Rebuilds the four KayKit Skeletons 1.1 FREE characters (Minion, Warrior,
// Rogue, Mage: the pack has no Golem or Necromancer, those stay on the
// still-broken paid-pack files) into public/models/chars/enemies/,
// deliberately standalone rather than routed through build_assets.mjs's
// shared "character" pipeline.
//
// Why standalone: build_assets.mjs's meshopt() step (EXT_meshopt_compression
// + KHR_mesh_quantization) corrupts this exact multi-primitive-skinned-KayKit
// -character shape (several body-part SkinnedMeshes sharing one skeleton,
// each with its own local bind transform): every skinned part explodes to a
// multi-world-unit bounding box. Confirmed 2026-08-08 by building
// Skeleton_Minion.glb both with and without this one step: exploded with it,
// byte-for-byte sane without it. This is a standalone script rather than a
// build_assets.mjs flag because that script is a pinned source-fingerprint
// input for the whole eastbrook asset family, so editing it shifts their
// fingerprint hashes and breaks an unrelated asset's test.
//
// All four of these GLBs were ALREADY committed and ALREADY broken this same
// way before today (not something invented for the Bonebound Rickshaw, which
// only surfaced it): skeleton_warrior/mage/rogue/minion.glb back
// skel_warrior/skel_mage/skel_rogue/skel_minion and their delve_skel_*
// variants, real mob content across the game. This script produces a
// SEPARATE _free.glb per character rather than overwriting those files in
// place, so nothing existing changes; only skel_rickshaw_puller (the
// rickshaw's own puller key) consumes the rebuilt minion today.
//
// Only 2 of the KayKit Character Animations pack's 7 Rig_Medium source files
// ship in the FREE tier this is built from (General, MovementBasic), so
// the output carries a reduced clip set (RICKSHAW_PULLER_CLIPS in
// src/render/characters/manifest.ts): no combat swing, no Taunt/Spellcast_*
// emotes. Falls back gracefully, does not crash, and costs the cart puller
// nothing since it never swings at anything; the full paid pack would restore
// the complete set.
//
// Run: node scripts/assets/rebuild_kaykit_skeletons_free.mjs
//
// MANDATORY final step, every run (scripts/assets/CLAUDE.md, "the mandatory
// FINAL step after ANY exporter run"): this script does not KTX2-compress
// its own output, so skipping the next two commands ships an uncompressed
// GLB.
//   node scripts/assets/compress_glb_textures.mjs public/models/chars/enemies/skeleton_minion_free.glb
//   node scripts/build_media_manifest.mjs generate
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, prune, resample } from '@gltf-transform/functions';

const SRC_ROOT = 'tmp/asset_src/KayKit_Skeletons_1.1_FREE';
const CLIP_LIBS = [
  `${SRC_ROOT}/Animations/gltf/Rig_Medium/Rig_Medium_General.glb`,
  `${SRC_ROOT}/Animations/gltf/Rig_Medium/Rig_Medium_MovementBasic.glb`,
];
const RENAME_CLIPS = { Idle_A: 'Idle' };
const KEEP_CLIPS = ['Idle', 'Walking_A', 'Running_A', 'Hit_A', 'Death_A'];

// Writes to skeleton_minion_free.glb rather than overwriting the shipped
// skeleton_minion.glb, which is shared with delve_skel_wraith (a real Reliquary
// delve mob that currently has real attack clips). The FREE pack carries no
// combat-swing source, so overwriting in place would trade that mob's attack
// animation for a geometry fix it never asked for. The rickshaw's puller gets
// the clean rig under its own name and nothing else in the game moves.
//
// The same corruption affects skeleton_warrior/rogue/mage.glb, and this script
// generalizes to them (they additionally need their weapon baked onto a
// handslot bone, the way scripts/assets/specs/skeletons_v2.json does it). That
// is deliberately NOT part of this change: those are real combat mobs, and
// rebuilding them costs each one its attack swing until the paid pack's
// animation sources exist. That trade needs its own argument.
const ITEMS = [{ src: 'Skeleton_Minion.glb', out: 'skeleton_minion_free.glb' }];

function stripClipName(name) {
  const i = name.lastIndexOf('|');
  return i === -1 ? name : name.slice(i + 1);
}

async function build(io, item) {
  const srcPath = `${SRC_ROOT}/characters/gltf/${item.src}`;
  const outPath = `public/models/chars/enemies/${item.out}`;
  const doc = await io.read(srcPath);
  const root = doc.getRoot();

  // Same clip-merge shape as build_assets.mjs processModel(): repoint every
  // newly added animation channel onto the character's own bone of the same
  // name, then drop the library's own scenes/nodes so only its clips
  // survive.
  const origNodeByName = new Map();
  for (const n of root.listNodes()) origNodeByName.set(n.getName(), n);
  const origNodes = new Set(origNodeByName.values());
  const origScenes = new Set(root.listScenes());
  const origAnims = new Set(root.listAnimations());
  for (const lib of CLIP_LIBS) {
    mergeDocuments(doc, await io.read(lib));
  }
  let orphan = 0;
  for (const anim of root.listAnimations()) {
    if (origAnims.has(anim)) continue;
    for (const ch of anim.listChannels()) {
      const tgt = ch.getTargetNode();
      if (!tgt) continue;
      const orig = origNodeByName.get(tgt.getName());
      if (orig) ch.setTargetNode(orig);
      else orphan++;
    }
  }
  for (const scene of root.listScenes()) if (!origScenes.has(scene)) scene.dispose();
  for (const node of root.listNodes()) if (!origNodes.has(node)) node.dispose();
  if (orphan) console.warn(`  WARN ${item.out}: ${orphan} merged channel(s) had no matching bone`);

  // mergeDocuments (clips or props) imports each source's own buffer; a GLB
  // must have a single one.
  const mainBuffer = root.listBuffers()[0];
  for (const acc of root.listAccessors()) acc.setBuffer(mainBuffer);
  for (const buf of root.listBuffers()) if (buf !== mainBuffer) buf.dispose();

  const seen = new Set();
  for (const anim of root.listAnimations()) {
    let name = stripClipName(anim.getName());
    if (RENAME_CLIPS[name]) name = RENAME_CLIPS[name];
    const drop = !KEEP_CLIPS.includes(name) || seen.has(name);
    if (drop) {
      anim.dispose();
      continue;
    }
    seen.add(name);
    anim.setName(name);
  }
  const missing = KEEP_CLIPS.filter((c) => !seen.has(c));
  if (missing.length) console.warn(`  WARN ${item.out}: missing clips ${missing.join(', ')}`);

  // Deliberately NO meshopt() and no textureCompress(): the smallest change
  // that produces correct geometry, not a full re-run of the shared
  // pipeline's optimization stack. This script alone does not KTX2-compress
  // the output either, so it ships plain source textures, a real gap
  // against this repo's own GLB texture-compression invariant that
  // tests/glb_texture_compression.test.ts will flag. Run
  // compress_glb_textures.mjs (see the module header) after this script,
  // every time, the same as after any other exporter.
  await doc.transform(resample(), prune({ keepExtras: false }), dedup());

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await io.write(outPath, doc);
  const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
  const clips = root.listAnimations().length;
  console.log(`${outPath}  ${kb}KB (${clips} clips)`);
}

async function main() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const item of ITEMS) await build(io, item);
}

main();
