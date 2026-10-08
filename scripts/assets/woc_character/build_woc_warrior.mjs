// Build the shipped WOC warrior body from the artist's modular character handoff.
//
// The handoff (WOC Armor Studio, 2026-09-15) ships three rest-pose packs on ONE
// 27-bone rig (`WOC_Armored_Rig`): the skinned body with its 24 clips, the rigid
// face/head parts, and the armor pieces (skinned and rigid). Its README keeps the
// packs separate so a future character builder can swap heads; the game's character
// system loads ONE GLB per visual key (src/render/characters/manifest.ts), so this
// script assembles the packs by bone name into a single file whose part nodes keep
// their authored names. Runtime part selection stays a per-instance visibility
// toggle over those names (src/render/characters/woc_parts_core.ts), which is what
// keeps the head, face and every armor slot swappable without re-authoring the GLB.
//
// What it does, in order (each step is a named function below):
//  1. merges the appearance + armor packs onto the base rig, verifying every pack
//     bone matches the base rest pose and every skinned pack part binds to the same
//     joint list and inverse bind matrices (the handoff's own attach contract,
//     rig-packs.mjs, re-checked here so a re-export cannot silently drift);
//  2. drops the constant handslot scale tracks and scales the two handslot bones so a
//     weapon authored for the KayKit-height bodies renders the same size after the
//     game's height normalization (the same compensation the asset pipeline's
//     addHandslotBones applies to generated bodies, calibrated against knight.glb);
//  3. retimes the locomotion cycles to the cadence every shipped class runs at
//     (KayKit Running_A is a 0.8 s cycle at the 7 yd/s run speed; the handoff's
//     1.6 s Run and 2.133 s Walk read as slow motion at game speed even at the
//     locomotion clamp; stride is untouched, so foot speed scales exactly);
//  4. runs the sanctioned `character` optimization (resample, prune, dedup,
//     textures capped at 1024, meshopt high) with PNG instead of webp as the intermediate,
//     because the mandatory KTX2 step re-encodes from the embedded image and a
//     webp hop would add a second lossy pass;
//  5. re-reads the written file and compares every part's world-space vertices
//     against the handoff's assembled reference at rest and mid-clip, so the
//     shipped bytes are proven to animate exactly like the artist's own preview.
//
// The KTX2 texture step is deliberately separate (its ktx dependency is external):
//   node scripts/assets/woc_character/build_woc_warrior.mjs
//   KTX_BIN=tmp/ktx-software/bin DYLD_FALLBACK_LIBRARY_PATH=tmp/ktx-software/bin \
//     node scripts/assets/compress_glb_textures.mjs public/models/chars/players/woc_warrior.glb
//   node scripts/build_media_manifest.mjs generate
//
// Usage: node scripts/assets/woc_character/build_woc_warrior.mjs [--src dir] [--out file]
//        [--reference knight.glb] [--no-retime] [--self-verify]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  cloneDocument,
  dedup,
  mergeDocuments,
  meshopt,
  prune,
  resample,
  textureCompress,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { retargetOrphanChannels } from './orphan_channels.mjs';
import {
  bbox,
  clipDuration,
  nodeTable,
  rigidPositions,
  samplePose,
  skinnedPositions,
  worldMatrices,
} from './rig_math.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Locomotion cycles retimed to the shipped cadence: duration multipliers. */
export const LOCOMOTION_RETIME = Object.freeze({ Walk: 0.5 });
/** The game measures a body's height at this point of its idle clip (assets.ts prepareVisual). */
const IDLE_MEASURE_SECONDS = 0.5;
const REST_EPS = 1e-6;
const IBM_EPS = 1e-6;
/** Verification budgets, metres on the authored 1.18 m body (see main). */
const REST_VERIFY_BUDGET = 5e-4;
const POSED_VERIFY_BUDGET = 1.2e-2;

function parseArgs(argv) {
  const opts = {
    src: path.join(ROOT, 'tmp', 'asset_src', 'woc_character'),
    out: path.join(ROOT, 'public', 'models', 'chars', 'players', 'woc_warrior.glb'),
    reference: path.join(ROOT, 'public', 'models', 'chars', 'players', 'knight.glb'),
    retime: true,
    selfVerify: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--src') opts.src = path.resolve(argv[++i]);
    else if (a === '--out') opts.out = path.resolve(argv[++i]);
    else if (a === '--reference') opts.reference = path.resolve(argv[++i]);
    else if (a === '--no-retime') opts.retime = false;
    // Verify against the merged source packs even when the manifest names an
    // assembled reference: for a body-only redelivery (the 2026-09-20 Run
    // update) the artist's reference file still carries the previous clips.
    else if (a === '--self-verify') opts.selfVerify = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

function sameMatrix(a, b, eps) {
  for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > eps) return false;
  return true;
}

/** Every bone of the base rig must exist in the pack with the same parent and rest matrix. */
export function assertPackRigMatches(baseTable, baseWorld, packDoc, label) {
  const packTable = nodeTable(packDoc);
  const packWorld = worldMatrices(packTable);
  const skin = baseTable.doc.getRoot().listSkins()[0];
  for (const joint of skin.listJoints()) {
    const name = joint.getName();
    const donor = packTable.byName.get(name);
    if (!donor) throw new Error(`${label}: pack lacks rest bone ${name}`);
    const donorParent = packTable.parent.get(donor)?.getName() ?? null;
    const baseParent = baseTable.parent.get(joint)?.getName() ?? null;
    if (donorParent !== baseParent) {
      throw new Error(`${label}: bone ${name} parents differ (${donorParent} vs ${baseParent})`);
    }
    if (!sameMatrix(packWorld.get(donor), baseWorld.get(joint), REST_EPS)) {
      throw new Error(`${label}: bone ${name} rest pose differs from the base rig`);
    }
  }
  return packTable;
}

/** A skinned pack part must bind to the base joint list in the same order with the same IBMs. */
export function assertSkinCompatible(baseSkin, packSkin, label) {
  const a = baseSkin.listJoints().map((j) => j.getName());
  const b = packSkin.listJoints().map((j) => j.getName());
  if (a.length !== b.length || a.some((n, i) => n !== b[i])) {
    throw new Error(`${label}: joint order differs from the base skin`);
  }
  const ia = baseSkin.getInverseBindMatrices().getArray();
  const ib = packSkin.getInverseBindMatrices().getArray();
  if (ia.length !== ib.length) throw new Error(`${label}: inverse bind matrix count differs`);
  for (let i = 0; i < ia.length; i++) {
    if (Math.abs(ia[i] - ib[i]) > IBM_EPS) {
      throw new Error(`${label}: inverse bind matrices differ from the base skin`);
    }
  }
}

/**
 * Merge one pack's named parts onto the base rig. Each part keeps its authored
 * local transform under the SAME-NAMED bone; a skinned part is re-pointed at the
 * base skin after the compatibility check. Everything else the pack imported (its
 * duplicate rig, scene and skin) is removed; prune() sweeps the orphaned data.
 */
export function mergePack(baseDoc, baseTable, baseWorld, packDoc, partNames, label) {
  const packTable = assertPackRigMatches(baseTable, baseWorld, packDoc, label);
  if (packDoc.getRoot().listAnimations().length > 0) {
    throw new Error(`${label}: a pack must carry no animations (the base owns the clips)`);
  }
  const baseSkin = baseDoc.getRoot().listSkins()[0];
  const scenesBefore = new Set(baseDoc.getRoot().listScenes());
  const nodesBefore = new Set(baseDoc.getRoot().listNodes());
  const resolved = mergeDocuments(baseDoc, packDoc);
  const keep = new Set();
  for (const name of partNames) {
    const packPart = packTable.byName.get(name);
    if (!packPart) throw new Error(`${label}: missing part ${name}`);
    const parentName = packTable.parent.get(packPart)?.getName();
    const targetBone = baseTable.byName.get(parentName);
    if (!targetBone) throw new Error(`${label}: ${name} sits under ${parentName}, not a base bone`);
    const part = resolved.get(packPart);
    if (!part) throw new Error(`${label}: merge did not resolve ${name}`);
    const packSkin = packPart.getSkin();
    if (packSkin) {
      assertSkinCompatible(baseSkin, packSkin, `${label}:${name}`);
      part.setSkin(baseSkin);
    }
    part.traverse((n) => keep.add(n));
    targetBone.addChild(part);
  }
  for (const scene of baseDoc.getRoot().listScenes()) if (!scenesBefore.has(scene)) scene.dispose();
  for (const node of baseDoc.getRoot().listNodes()) {
    if (!nodesBefore.has(node) && !keep.has(node)) node.dispose();
  }
  return partNames.length;
}

/** A mirrored duplicate exported with its source's index order winds inside
 *  out: the geometric normal of nearly every triangle opposes the vertex
 *  normals, and three's double-sided shading then lights the piece from the
 *  inside (the handoff's Boot_L and Gauntlet_L read chalk white in game).
 *  Flip the winding of every primitive whose triangles mostly disagree with
 *  their own normals, on a fresh index accessor so a shared one stays intact. */
export function fixInvertedWinding(doc) {
  const flipped = [];
  const a = [];
  const b = [];
  const c = [];
  const n = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== Primitive.Mode.TRIANGLES) continue;
      const pos = prim.getAttribute('POSITION');
      const nor = prim.getAttribute('NORMAL');
      const idx = prim.getIndices();
      if (!pos || !nor || !idx) continue;
      let agree = 0;
      let total = 0;
      for (let t = 0; t + 2 < idx.getCount(); t += 3) {
        pos.getElement(idx.getScalar(t), a);
        pos.getElement(idx.getScalar(t + 1), b);
        pos.getElement(idx.getScalar(t + 2), c);
        nor.getElement(idx.getScalar(t), n);
        const ux = b[0] - a[0];
        const uy = b[1] - a[1];
        const uz = b[2] - a[2];
        const vx = c[0] - a[0];
        const vy = c[1] - a[1];
        const vz = c[2] - a[2];
        const gx = uy * vz - uz * vy;
        const gy = uz * vx - ux * vz;
        const gz = ux * vy - uy * vx;
        if (gx * gx + gy * gy + gz * gz < 1e-18) continue;
        total++;
        if (gx * n[0] + gy * n[1] + gz * n[2] > 0) agree++;
      }
      if (total === 0 || agree * 2 >= total) continue;
      const arr = idx.getArray().slice();
      for (let t = 0; t + 2 < arr.length; t += 3) {
        const tmp = arr[t + 1];
        arr[t + 1] = arr[t + 2];
        arr[t + 2] = tmp;
      }
      prim.setIndices(
        doc.createAccessor().setType('SCALAR').setBuffer(idx.getBuffer()).setArray(arr),
      );
      flipped.push(`${mesh.getName()} (${total - agree}/${total} inside out)`);
    }
  }
  return flipped;
}

/** Drop every node no scene reaches. The female body export left its raw
 *  Mixamo skeleton in the file as a detached tree (67 orphan nodes, none a
 *  skin joint, none carrying a mesh); by-name lookups over listNodes() would
 *  otherwise find two of every KayKit-named bone. An orphan that is still
 *  animated here was not repaired by retargetOrphanChannels first: refuse. */
export function dropOrphanNodes(doc) {
  const root = doc.getRoot();
  const reachable = new Set();
  const walk = (node) => {
    reachable.add(node);
    for (const child of node.listChildren()) walk(child);
  };
  for (const scene of root.listScenes()) for (const child of scene.listChildren()) walk(child);
  let dropped = 0;
  for (const node of root.listNodes()) {
    if (reachable.has(node)) continue;
    if (
      node
        .listParents()
        .some((p) => p.propertyType === 'Skin' || p.propertyType === 'AnimationChannel')
    ) {
      throw new Error(
        `orphan node ${node.getName()} is a skin joint or animated: refusing to drop it`,
      );
    }
    node.dispose();
    dropped++;
  }
  return dropped;
}

/** The Blender export carries an empty first scene ("REFERENCE | ..."): keep only the rig scene. */
export function keepRigScene(doc) {
  const scenes = doc.getRoot().listScenes();
  const rig = scenes.find((s) => s.listChildren().length > 0);
  if (!rig) throw new Error('no scene carries the rig');
  for (const s of scenes) if (s !== rig) s.dispose();
  doc.getRoot().setDefaultScene(rig);
}

/** Drop the handslot SCALE channels (constant in the export) so the slot scale
 *  below survives the mixer, which would otherwise write scale 1 every frame.
 *  Translation and rotation stay: the artist keys the weapon slot in some clips
 *  (Ranged_Shoot aims it), and a constant one costs two keys after resample. */
export function stripHandslotScaleTracks(doc) {
  let dropped = 0;
  const animated = [];
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      const name = ch.getTargetNode()?.getName() ?? '';
      if (!/^handslot\./.test(name)) continue;
      const sampler = ch.getSampler();
      const out = sampler.getOutput().getArray();
      const el = sampler.getOutput().getElementSize();
      let constant = true;
      for (let i = el; i < out.length && constant; i++) {
        if (Math.abs(out[i] - out[i % el]) > 1e-6) constant = false;
      }
      if (ch.getTargetPath() !== 'scale') {
        if (!constant) animated.push(`${anim.getName()}:${name}.${ch.getTargetPath()}`);
        continue;
      }
      if (!constant || Math.abs(out[0] - 1) > 1e-6) {
        throw new Error(`${anim.getName()}: ${name} scale track is not a constant 1`);
      }
      anim.removeChannel(ch);
      ch.dispose();
      sampler.dispose();
      dropped++;
    }
  }
  return { dropped, animated };
}

/** Idle-posed height the game's prepareVisual measures for a fully skinned rig. */
export function idlePosedSkinnedHeight(doc) {
  const table = nodeTable(doc);
  const idle = doc
    .getRoot()
    .listAnimations()
    .find((a) => a.getName() === 'Idle');
  if (!idle) throw new Error('reference rig has no Idle clip');
  const t = Math.min(IDLE_MEASURE_SECONDS, clipDuration(idle) / 2);
  const world = worldMatrices(table, samplePose(idle, t));
  let pts = [];
  for (const n of table.nodes) {
    if (n.getMesh() && n.getSkin()) pts = pts.concat(skinnedPositions(n.getMesh(), n, world));
  }
  return bbox(pts).height;
}

/** Idle-posed height of the WOC canonical anatomy: the skinned body plus the rigid
 *  head parts riding the head bone, armor excluded (the rule woc_parts_core.ts
 *  hands prepareVisual). */
export function idlePosedAnatomyHeight(doc, anatomyNames) {
  return idlePosedAnatomyBounds(doc, anatomyNames).height;
}

/** The idle-posed bounds of the same anatomy ({ min, max, height }). */
export function idlePosedAnatomyBounds(doc, anatomyNames) {
  const table = nodeTable(doc);
  const idle = doc
    .getRoot()
    .listAnimations()
    .find((a) => a.getName() === 'Idle');
  const t = Math.min(IDLE_MEASURE_SECONDS, clipDuration(idle) / 2);
  return anatomyBounds(table, anatomyNames, worldMatrices(table, samplePose(idle, t)));
}

/** The REST-posed bounds of the same anatomy: the pose the game's height normalization
 *  reads a WOC body in (assets.ts prepareVisual re-reads the rig after releasing its idle
 *  sample, so the split WOC bodies are measured at rest). The split build records its top
 *  (build_woc_split.mjs, the pin's anatomyTop). */
export function restPosedAnatomyBounds(doc, anatomyNames) {
  const table = nodeTable(doc);
  return anatomyBounds(table, anatomyNames, worldMatrices(table));
}

function anatomyBounds(table, anatomyNames, world) {
  let pts = [];
  for (const name of anatomyNames) {
    const n = table.byName.get(name);
    if (!n?.getMesh()) throw new Error(`anatomy part ${name} missing`);
    pts = pts.concat(
      n.getSkin()
        ? skinnedPositions(n.getMesh(), n, world)
        : rigidPositions(n.getMesh(), world.get(n)),
    );
  }
  return bbox(pts);
}

export function scaleHandslots(doc, scale) {
  let count = 0;
  for (const node of doc.getRoot().listNodes()) {
    if (!/^handslot\./.test(node.getName())) continue;
    node.setScale([scale, scale, scale]);
    count++;
  }
  if (count !== 2) throw new Error(`expected two handslot bones, found ${count}`);
}

/** Multiply a clip's sampler times by `factor`, cloning a time accessor shared with another clip. */
export function retimeClip(doc, anim, factor) {
  const others = new Set();
  for (const a of doc.getRoot().listAnimations()) {
    if (a === anim) continue;
    for (const s of a.listSamplers()) others.add(s.getInput());
  }
  const done = new Set();
  for (const s of anim.listSamplers()) {
    let input = s.getInput();
    if (others.has(input)) {
      input = input.clone();
      s.setInput(input);
    }
    if (done.has(input)) continue;
    done.add(input);
    const arr = input.getArray();
    for (let i = 0; i < arr.length; i++) arr[i] *= factor;
    input.setArray(arr);
  }
}

/** Nearest reference vertex for every built vertex, over a uniform grid: the
 *  optimizer reorders vertices (meshopt's cache reorder), so a positional
 *  index-to-index comparison would only prove the permutation. */
export function nearestDistances(built, ref, cell = 0.01) {
  const grid = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  for (const p of ref) {
    const k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell));
    const bucket = grid.get(k);
    if (bucket) bucket.push(p);
    else grid.set(k, [p]);
  }
  let worst = 0;
  for (const p of built) {
    const cx = Math.floor(p[0] / cell);
    const cy = Math.floor(p[1] / cell);
    const cz = Math.floor(p[2] / cell);
    let best = Infinity;
    for (let dx = -1; dx <= 1 && best > 0; dx++) {
      for (let dy = -1; dy <= 1 && best > 0; dy++) {
        for (let dz = -1; dz <= 1 && best > 0; dz++) {
          const bucket = grid.get(key(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const q of bucket) {
            const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
            if (d < best) best = d;
          }
        }
      }
    }
    if (best > worst) worst = best;
  }
  return worst;
}

/** Every part's world-space vertices at rest and mid-clip, matched to the
 *  assembled reference the artist previewed (nearest neighbour, so the
 *  optimizer's vertex reorder cannot mask or fake a drift). */
export function verifyAgainstReference(builtDoc, refDoc, partNames) {
  const built = nodeTable(builtDoc);
  const ref = nodeTable(refDoc);
  const anims = builtDoc.getRoot().listAnimations();
  let worst = 0;
  let worstAt = '';
  let restWorst = 0;
  let compared = 0;
  const nodePositions = (table, world, name) => {
    const n = table.byName.get(name);
    if (!n?.getMesh()) throw new Error(`verify: ${name} missing`);
    return n.getSkin()
      ? skinnedPositions(n.getMesh(), n, world)
      : rigidPositions(n.getMesh(), world.get(n));
  };
  // a part is one node on both sides, or ({ built, ref }) node groups compared as one (a
  // reference that merged several built parts into one mesh)
  const positionsAt = (table, world, part, side) =>
    typeof part === 'string'
      ? nodePositions(table, world, part)
      : part[side].flatMap((name) => nodePositions(table, world, name));
  const label = (part) => (typeof part === 'string' ? part : part.built.join('+'));
  const samples = [[null, 0]];
  for (const anim of anims) {
    const dur = clipDuration(anim);
    for (const f of [0.3, 0.75]) samples.push([anim, dur * f]);
  }
  for (const [anim, t] of samples) {
    const refAnim = anim
      ? refDoc
          .getRoot()
          .listAnimations()
          .find((a) => a.getName() === anim.getName())
      : null;
    if (anim && !refAnim) throw new Error(`verify: reference lacks clip ${anim.getName()}`);
    // The reference keeps the authored timing; a retimed clip samples at the same
    // FRACTION of its cycle, which is the same pose.
    const refT = anim ? (t / clipDuration(anim)) * clipDuration(refAnim) : 0;
    const wb = worldMatrices(built, anim ? samplePose(anim, t) : new Map());
    const wr = worldMatrices(ref, refAnim ? samplePose(refAnim, refT) : new Map());
    for (const part of partNames) {
      const a = positionsAt(built, wb, part, 'built');
      const b = positionsAt(ref, wr, part, 'ref');
      if (a.length !== b.length) throw new Error(`verify: ${label(part)} vertex count differs`);
      const d = nearestDistances(a, b);
      compared += a.length;
      if (!anim && d > restWorst) restWorst = d;
      if (d > worst) {
        worst = d;
        worstAt = `${label(part)} @ ${anim ? anim.getName() : 'rest'} t=${t.toFixed(2)}`;
      }
    }
  }
  return { worst, worstAt, restWorst, compared };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const manifest = JSON.parse(
    fs.readFileSync(path.join(opts.src, 'character.manifest.json'), 'utf8'),
  );
  if (manifest.schemaVersion !== 1) throw new Error('unsupported character manifest schema');

  const base = await io.read(path.join(opts.src, manifest.base));
  // Tracks a handoff bound to the detached rig copy go back onto the real rig
  // BEFORE the orphan sweep (orphan_channels.mjs), which would otherwise refuse
  // to drop an animated node.
  const orphanChannelsRetargeted = { base: retargetOrphanChannels(base).length };
  const orphansDropped = { base: dropOrphanNodes(base) };
  const baseTable = nodeTable(base);
  baseTable.doc = base;
  const baseWorld = worldMatrices(baseTable);
  let merged = 0;
  for (const [key, pack] of Object.entries(manifest.packs)) {
    const packDoc = await io.read(path.join(opts.src, pack.url));
    orphanChannelsRetargeted[key] = retargetOrphanChannels(packDoc).length;
    orphansDropped[key] = dropOrphanNodes(packDoc);
    merged += mergePack(base, baseTable, baseWorld, packDoc, pack.nodes, key);
  }
  keepRigScene(base);
  const windingFlipped = fixInvertedWinding(base);
  // An equipment-only handoff (the 2026-09-18 class sets) ships no assembled
  // reference: the written file is then verified against this clean copy of
  // the merged packs instead, which still proves the optimizer's resample,
  // quantization and meshopt pass reproduce the artist's geometry under every
  // clip. Cloned before the handslot scale and locomotion retime (neither
  // moves a part vertex; the verifier samples retimed clips by fraction).
  const useReference = !!manifest.assembledReference && !opts.selfVerify;
  const mergedSource = useReference ? null : cloneDocument(base);
  // mergeDocuments imports each pack's own buffer and a GLB must have one:
  // consolidate every accessor onto the base buffer (build_assets.mjs does the
  // same after its clip and prop merges).
  const buffers = base.getRoot().listBuffers();
  for (const accessor of base.getRoot().listAccessors()) accessor.setBuffer(buffers[0]);
  for (const buffer of buffers.slice(1)) buffer.dispose();
  const handslotTracks = stripHandslotScaleTracks(base);

  // Weapon-scale compensation: the renderer normalizes every body to the same
  // world height, so a weapon parented under this rig would be scaled by this
  // body's (larger) normalization factor. The slot bones cancel the ratio.
  const anatomy = [
    ...manifest.baseNodes,
    ...Object.values(manifest.appearance).flatMap((slot) =>
      Object.values(slot.variants).flatMap((v) => v.nodes),
    ),
  ];
  const wocHeight = idlePosedAnatomyHeight(base, anatomy);
  const refDoc = await io.read(opts.reference);
  const refHeight = idlePosedSkinnedHeight(refDoc);
  const slotScale = wocHeight / refHeight;
  scaleHandslots(base, slotScale);

  const retimed = [];
  if (opts.retime) {
    for (const anim of base.getRoot().listAnimations()) {
      const factor = LOCOMOTION_RETIME[anim.getName()];
      if (!factor) continue;
      retimeClip(base, anim, factor);
      retimed.push(`${anim.getName()} x${factor}`);
    }
  }

  await base.transform(
    resample(),
    prune(),
    dedup(),
    // The body atlas is authored at 1024 (the close-up subject of the sheet and
    // the portraits); every other part ships at 512 and is left alone.
    textureCompress({ encoder: sharp, targetFormat: 'png', resize: [1024, 1024] }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  await io.write(opts.out, base);

  const written = await io.read(opts.out);
  const root = written.getRoot();
  const clips = root.listAnimations().map((a) => `${a.getName()} ${clipDuration(a).toFixed(3)}s`);
  const partNames = [
    ...manifest.baseNodes,
    ...Object.values(manifest.packs).flatMap((p) => p.nodes),
  ];
  let reference = mergedSource;
  if (useReference) {
    reference = await io.read(path.join(opts.src, manifest.assembledReference));
    orphanChannelsRetargeted.reference = retargetOrphanChannels(reference).length;
    orphansDropped.reference = dropOrphanNodes(reference);
  }
  const check = verifyAgainstReference(written, reference, partNames);
  const report = {
    out: path.relative(ROOT, opts.out),
    bytes: fs.statSync(opts.out).size,
    windingFlipped,
    orphanChannelsRetargeted,
    orphansDropped,
    mergedParts: merged,
    droppedHandslotScaleTracks: handslotTracks.dropped,
    animatedHandslotTracks: handslotTracks.animated,
    wocIdleAnatomyHeight: +wocHeight.toFixed(4),
    referenceIdleHeight: +refHeight.toFixed(4),
    handslotScale: +slotScale.toFixed(4),
    retimed,
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    skins: root.listSkins().length,
    clips,
    verifiedAgainst: useReference ? 'assembled reference' : 'merged source packs',
    verify: {
      restWorldError: check.restWorst,
      posedWorldError: check.worst,
      posedWorstAt: check.worstAt,
      verticesCompared: check.compared,
    },
  };
  console.log(JSON.stringify(report, null, 2));
  // Rest is exact up to the 14-bit position quantization (well under a tenth
  // of a millimetre on this 1.18 m body); a deep pose amplifies the 8-bit
  // weight quantization the sanctioned character pipeline applies, so the
  // posed budget is a percent of the body (measured: 6.6 mm at Sit_Idle).
  if (check.restWorst > REST_VERIFY_BUDGET || check.worst > POSED_VERIFY_BUDGET) {
    console.error('built parts drift from the assembled reference beyond the quantization budget');
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
