// GLB post-processing: turns raw Tripo output into a game-convention asset.
//
// Conventions enforced here (measured from shipped assets, see lib/families.mjs
// and scripts/assets/build_assets.mjs):
// - Weapons: origin AT the grip, blade/head along +Y, family height, centered XZ.
// - Props: base at y=0, centered XZ, explicit world-unit height.
// - Creatures: geometry untouched (the game normalizes via VisualDef.height);
//   animation clips merged from the retarget outputs and renamed to the game
//   clip vocabulary; in-place check (the sim owns movement, root motion slides).
// - All: prune+dedup, textures re-encoded WebP (max 512), meshopt on statics
//   (matching build_assets.mjs 'static'); rigged models keep plain encoding
//   like CombatMech.glb (resample+prune+dedup only, never simplify/join).
import { statSync } from 'node:fs';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress, transformMesh } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

let ioPromise = null;
async function io() {
  if (!ioPromise) {
    ioPromise = (async () => {
      await MeshoptDecoder.ready;
      await MeshoptEncoder.ready;
      return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
        'meshopt.decoder': MeshoptDecoder,
        'meshopt.encoder': MeshoptEncoder,
      });
    })();
  }
  return ioPromise;
}

export async function openGlb(path) {
  return (await io()).read(path);
}

export async function saveGlb(doc, path) {
  await (await io()).write(path, doc);
  return path;
}

// ---------------------------------------------------------------------------
// mat4 helpers (column-major, glTF convention)
// ---------------------------------------------------------------------------

export function mat4Multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export const mat4RotZ = (t) => [
  Math.cos(t),
  Math.sin(t),
  0,
  0,
  -Math.sin(t),
  Math.cos(t),
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
];
export const mat4RotX = (t) => [
  1,
  0,
  0,
  0,
  0,
  Math.cos(t),
  Math.sin(t),
  0,
  0,
  -Math.sin(t),
  Math.cos(t),
  0,
  0,
  0,
  0,
  1,
];
export const mat4RotY = (t) => [
  Math.cos(t),
  0,
  -Math.sin(t),
  0,
  0,
  1,
  0,
  0,
  Math.sin(t),
  0,
  Math.cos(t),
  0,
  0,
  0,
  0,
  1,
];
export const mat4Scale = (s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
export const mat4Translate = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

/** Structural report: sizes, tris, clips, joints, textures, bounds. */
export async function inspectGlb(path) {
  const doc = await openGlb(path);
  const root = doc.getRoot();
  let tris = 0;
  let verts = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      tris += Math.round((idx ? idx.getCount() : (pos?.getCount() ?? 0)) / 3);
      verts += pos?.getCount() ?? 0;
    }
  }
  const textures = root.listTextures().map((t) => {
    const size = t.getSize();
    return {
      name: t.getName() || null,
      mime: t.getMimeType(),
      width: size?.[0] ?? 0,
      height: size?.[1] ?? 0,
      bytes: t.getImage()?.byteLength ?? 0,
    };
  });
  const clips = root.listAnimations().map((a) => {
    let duration = 0;
    for (const sampler of a.listSamplers()) {
      const input = sampler.getInput();
      if (input) duration = Math.max(duration, input.getMax([0])[0] ?? 0);
    }
    return { name: a.getName(), duration: +duration.toFixed(3) };
  });
  const skins = root.listSkins();
  const joints = skins.length ? skins[0].listJoints().map((j) => j.getName()) : [];
  const scene = root.listScenes()[0];
  const bounds = scene ? getBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] };
  return {
    path,
    bytes: statSync(path).size,
    tris,
    verts,
    meshes: root.listMeshes().length,
    materials: root.listMaterials().map((m) => m.getName() || null),
    textures,
    clips,
    skins: skins.length,
    joints,
    bounds,
  };
}

// ---------------------------------------------------------------------------
// Static-mesh normalization (weapons, props)
// ---------------------------------------------------------------------------

/** Bake every node's world transform into its mesh vertices and reset ALL node
 *  TRS, so later whole-model transforms can be applied uniformly. Static
 *  (non-skinned) scenes only (the weapon/prop lanes).
 *
 *  Order matters: world matrices are captured for EVERY node BEFORE any TRS is
 *  reset (a mesh-bearing node with children must not lose its transform before
 *  the children read theirs), transform-bearing ancestor nodes without meshes
 *  are reset too (a residual wrapper rotation would double-apply at render
 *  time), and a mesh shared by two nodes is baked from a pristine clone per
 *  extra node (in-place baking the first would compound both transforms). */
function bakeNodeTransforms(doc) {
  const records = []; // {node, mesh, world} captured pre-mutation
  const allNodes = [];
  const walk = (node) => {
    allNodes.push(node);
    const mesh = node.getMesh();
    if (mesh) records.push({ node, mesh, world: node.getWorldMatrix() });
    for (const child of node.listChildren()) walk(child);
  };
  for (const scene of doc.getRoot().listScenes()) {
    for (const node of scene.listChildren()) walk(node);
  }

  const byMesh = new Map();
  for (const r of records) {
    if (!byMesh.has(r.mesh)) byMesh.set(r.mesh, []);
    byMesh.get(r.mesh).push(r);
  }
  for (const [mesh, uses] of byMesh) {
    // Clone for every use beyond the first BEFORE the in-place bake mutates
    // the shared accessors.
    for (let i = 1; i < uses.length; i++) {
      const clone = mesh.clone();
      uses[i].node.setMesh(clone);
      uses[i].mesh = clone;
    }
    for (const use of uses) transformMesh(use.mesh, use.world);
  }
  for (const node of allNodes) {
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  }
}

function forEachPosition(doc, fn) {
  const done = new Set();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos || done.has(pos)) continue;
      done.add(pos);
      const el = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, el);
        fn(el);
      }
    }
  }
}

function measureBounds(doc) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  forEachPosition(doc, (p) => {
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  });
  return { min, max };
}

function applyToAllMeshes(doc, matrix) {
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, matrix);
}

/** Radial "mass" (vertex count weighted by distance from the Y axis) of the top
 *  and bottom `frac` slabs. Distinguishes an axe head from its handle end. */
function endMoments(doc, frac = 0.3) {
  const { min, max } = measureBounds(doc);
  const h = max[1] - min[1];
  const topCut = max[1] - h * frac;
  const botCut = min[1] + h * frac;
  let top = 0;
  let bottom = 0;
  forEachPosition(doc, ([x, y, z]) => {
    const r = Math.hypot(x - (min[0] + max[0]) / 2, z - (min[2] + max[2]) / 2);
    if (y >= topCut) top += r;
    if (y <= botCut) bottom += r;
  });
  return { top, bottom };
}

/** Normalize a generated weapon GLB to the family convention: long axis +Y,
 *  correct end up (per family), family height, origin at the grip, centered XZ.
 *  `flip` forcibly inverts the up-end decision (agent escape hatch after
 *  reviewing the preview). Returns the applied numbers for the report. */
export async function normalizeWeapon(
  inPath,
  outPath,
  family,
  { flip = false, roll = 0, maxTex } = {},
) {
  const doc = await openGlb(inPath);
  bakeNodeTransforms(doc);

  // 1. Long axis to +Y.
  let { min, max } = measureBounds(doc);
  const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const longest = ext.indexOf(Math.max(...ext));
  if (longest === 0) applyToAllMeshes(doc, mat4RotZ(Math.PI / 2));
  else if (longest === 2) applyToAllMeshes(doc, mat4RotX(-Math.PI / 2));

  // 2. Correct end up. Blades and points go tip-up (small end up); axes,
  //    hammers, and staff ornaments carry their mass at the top.
  const { top, bottom } = endMoments(doc);
  const bigEndUp = top >= bottom;
  let flipped = false;
  if (bigEndUp !== family.heavyEndUp) flipped = true;
  if (flip) flipped = !flipped;
  if (flipped) applyToAllMeshes(doc, mat4RotZ(Math.PI));

  // 2b. Roll about the shaft: every shipped anisotropic head/blade spans local
  //     X (measured: axes/swords/daggers wide axis 0deg, thin in Z), while
  //     generated meshes land at ~90deg (concepts show the blade face-on, so
  //     the wide face ends up in Z). Align the head region's principal wide
  //     axis to X; near-symmetric heads (maces, staff orbs, wands) are left
  //     alone. Single-sided heads then match the shipped sign convention
  //     (head toward -X, e.g. axe_c). `roll` adds a manual override on top.
  let autoRollDeg = 0;
  // Staves and wands are radially symmetric shafts with ornaments; their weak
  // head anisotropy makes the estimate noisy and the roll is aesthetically
  // irrelevant, so only --roll applies to them.
  if (family.grip !== 'VAR_STAFF' && family.grip !== 'VAR_WAND') {
    ({ min, max } = measureBounds(doc));
    const h = max[1] - min[1];
    const yCut = min[1] + 0.55 * h;
    let n = 0;
    let cx = 0;
    let cz = 0;
    forEachPosition(doc, (p) => {
      if (p[1] > yCut) {
        cx += p[0];
        cz += p[2];
        n++;
      }
    });
    if (n > 8) {
      cx /= n;
      cz /= n;
      let sxx = 0;
      let szz = 0;
      let sxz = 0;
      forEachPosition(doc, (p) => {
        if (p[1] > yCut) {
          const dx = p[0] - cx;
          const dz = p[2] - cz;
          sxx += dx * dx;
          szz += dz * dz;
          sxz += dx * dz;
        }
      });
      const half = Math.sqrt(((sxx - szz) / 2) ** 2 + sxz ** 2);
      const l1 = (sxx + szz) / 2 + half;
      const l2 = Math.max((sxx + szz) / 2 - half, 1e-9);
      const anisotropy = Math.sqrt(l1 / l2);
      if (anisotropy >= 1.3) {
        // Yaw the wide axis onto X (shortest rotation, in (-90, 90]).
        let theta = 0.5 * Math.atan2(2 * sxz, sxx - szz);
        if (theta > Math.PI / 2) theta -= Math.PI;
        if (theta <= -Math.PI / 2) theta += Math.PI;
        if (Math.abs(theta) > (3 * Math.PI) / 180) {
          applyToAllMeshes(doc, mat4RotY(-theta));
          autoRollDeg = +((-theta * 180) / Math.PI).toFixed(1);
        }
        // Sign: a clearly one-sided head points toward -X like the shipped set.
        let n2 = 0;
        let cx2 = 0;
        forEachPosition(doc, (p) => {
          if (p[1] > yCut) {
            cx2 += p[0];
            n2++;
          }
        });
        if (n2 && cx2 / n2 > 0.03 * h) {
          applyToAllMeshes(doc, mat4RotY(Math.PI));
          autoRollDeg += 180;
        }
      }
    }
  }
  if (roll) applyToAllMeshes(doc, mat4RotY((roll * Math.PI) / 180));

  // 3. Scale to family height, origin at the grip, centered XZ.
  ({ min, max } = measureBounds(doc));
  const h = max[1] - min[1];
  if (h <= 1e-6) throw new Error('degenerate weapon mesh (zero height)');
  const s = family.height / h;
  applyToAllMeshes(doc, mat4Scale(s));
  ({ min, max } = measureBounds(doc));
  const targetMinY = -family.gripFrac * family.height;
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  applyToAllMeshes(doc, mat4Translate(-cx, targetMinY - min[1], -cz));

  // Plain WebP encoding, no meshopt: these assets are tiny, and skipping meshopt
  // keeps them animation-friendly and readable everywhere without the meshopt
  // decoder, matching the rigged/animated lane (CombatMech.glb style).
  await doc.transform(prune(), dedup(), ...(await textureTransforms(maxTex ?? 512)));
  await saveGlb(doc, outPath);
  return {
    scale: +s.toFixed(4),
    flipped,
    autoRollDeg,
    manualRollDeg: roll,
    height: family.height,
    gripFrac: family.gripFrac,
  };
}

/** Normalize a generated prop GLB: base at y=0, centered XZ, world-unit height,
 *  optional yaw (radians) so the front/opening faces +Z. */
export async function normalizeProp(inPath, outPath, { height, rotateY = 0, maxTex } = {}) {
  if (!height || height <= 0) throw new Error('normalizeProp needs a world-unit --height');
  const doc = await openGlb(inPath);
  bakeNodeTransforms(doc);
  if (rotateY) applyToAllMeshes(doc, mat4RotY(rotateY));
  let { min, max } = measureBounds(doc);
  const h = max[1] - min[1];
  if (h <= 1e-6) throw new Error('degenerate prop mesh (zero height)');
  const s = height / h;
  applyToAllMeshes(doc, mat4Scale(s));
  ({ min, max } = measureBounds(doc));
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  applyToAllMeshes(doc, mat4Translate(-cx, -min[1], -cz));
  // Plain WebP encoding, no meshopt (matches the weapon + animated lanes).
  await doc.transform(prune(), dedup(), ...(await textureTransforms(maxTex ?? 512)));
  await saveGlb(doc, outPath);
  return { scale: +s.toFixed(4), height };
}

async function textureTransforms(maxTex) {
  let sharp = null;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    return []; // sharp unavailable: keep original textures
  }
  return [textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [maxTex, maxTex] })];
}

// ---------------------------------------------------------------------------
// Rigged-model clip merge (creatures / characters)
// ---------------------------------------------------------------------------

/** Merge retargeted animation GLBs into one rigged, game-named model.
 *  `base` is the first retarget output (geometry + skeleton + its clip);
 *  `clips` = [{path, preset, game}] covering every desired game clip name,
 *  where multiple entries may point at the same multi-clip file. Channels are
 *  re-pointed by NODE NAME (same rig task, identical skeletons), the exact
 *  bake_mech_anims.mjs technique. Optimizes like build_assets 'character'
 *  (resample+prune+dedup+webp, no meshopt: plain encoding like CombatMech.glb,
 *  and never simplify/join). */
export async function assembleRiggedModel(base, clips, outPath, { maxTex } = {}) {
  const target = await openGlb(base);
  const troot = target.getRoot();
  // Drop whatever clips the base shipped with; they get re-added by name below.
  for (const anim of troot.listAnimations()) anim.dispose();

  const nodesByName = new Map();
  for (const node of troot.listNodes()) nodesByName.set(node.getName(), node);
  const buffer = troot.listBuffers()[0] ?? target.createBuffer();

  const added = [];
  const skippedBones = new Set();
  for (const { path, preset, game } of clips) {
    const src = await openGlb(path);
    const anims = src.getRoot().listAnimations();
    const srcAnim = pickAnimation(anims, preset);
    if (!srcAnim) {
      added.push({ game, preset, ok: false, reason: `no matching clip in ${path}` });
      continue;
    }
    const anim = target.createAnimation(game);
    const cloneAccessor = (a) =>
      target
        .createAccessor(a.getName())
        .setType(a.getType())
        .setArray(a.getArray().slice())
        .setNormalized(a.getNormalized())
        .setBuffer(buffer);
    const samplerMap = new Map();
    for (const s of srcAnim.listSamplers()) {
      const sampler = target
        .createAnimationSampler()
        .setInterpolation(s.getInterpolation())
        .setInput(cloneAccessor(s.getInput()))
        .setOutput(cloneAccessor(s.getOutput()));
      samplerMap.set(s, sampler);
      anim.addSampler(sampler);
    }
    let channels = 0;
    for (const ch of srcAnim.listChannels()) {
      const name = ch.getTargetNode()?.getName();
      const dst = name ? nodesByName.get(name) : null;
      if (!dst) {
        if (name) skippedBones.add(name);
        continue;
      }
      const channel = target
        .createAnimationChannel()
        .setTargetNode(dst)
        .setTargetPath(ch.getTargetPath())
        .setSampler(samplerMap.get(ch.getSampler()));
      anim.addChannel(channel);
      channels++;
    }
    if (channels === 0) {
      // An empty clip must not keep its game name: the required-clips
      // validation checks names, and a present-but-empty Attack would pass the
      // gate yet freeze in game.
      anim.dispose();
    }
    added.push({ game, preset, ok: channels > 0, channels });
  }

  await target.transform(resample(), prune(), dedup(), ...(await textureTransforms(maxTex ?? 512)));
  await saveGlb(target, outPath);
  return { added, skippedBones: [...skippedBones] };
}

/** Pick the animation matching a preset from a (usually single-clip) file. */
function pickAnimation(anims, preset) {
  if (anims.length === 1) return anims[0];
  const tail = preset.split(':').pop().toLowerCase();
  return (
    anims.find((a) => a.getName().toLowerCase() === tail) ??
    anims.find((a) => a.getName().toLowerCase().includes(tail)) ??
    null
  );
}

// --- quaternion / matrix helpers for the handslot calibration ---------------

function mat4RotToQuat(m) {
  // Orthonormalize the rotation columns (strips scale), then standard mat->quat.
  const n = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const c0 = n([m[0], m[1], m[2]]);
  let c1 = [m[4], m[5], m[6]];
  const d01 = c1[0] * c0[0] + c1[1] * c0[1] + c1[2] * c0[2];
  c1 = n([c1[0] - d01 * c0[0], c1[1] - d01 * c0[1], c1[2] - d01 * c0[2]]);
  const c2 = [
    c0[1] * c1[2] - c0[2] * c1[1],
    c0[2] * c1[0] - c0[0] * c1[2],
    c0[0] * c1[1] - c0[1] * c1[0],
  ];
  const t = c0[0] + c1[1] + c2[2];
  let q;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    q = [(c1[2] - c2[1]) / s, (c2[0] - c0[2]) / s, (c0[1] - c1[0]) / s, s / 4];
  } else if (c0[0] > c1[1] && c0[0] > c2[2]) {
    const s = Math.sqrt(1 + c0[0] - c1[1] - c2[2]) * 2;
    q = [s / 4, (c1[0] + c0[1]) / s, (c2[0] + c0[2]) / s, (c1[2] - c2[1]) / s];
  } else if (c1[1] > c2[2]) {
    const s = Math.sqrt(1 + c1[1] - c0[0] - c2[2]) * 2;
    q = [(c1[0] + c0[1]) / s, s / 4, (c2[1] + c1[2]) / s, (c2[0] - c0[2]) / s];
  } else {
    const s = Math.sqrt(1 + c2[2] - c0[0] - c1[1]) * 2;
    q = [(c2[0] + c0[2]) / s, (c2[1] + c1[2]) / s, s / 4, (c0[1] - c1[0]) / s];
  }
  const l = Math.hypot(...q) || 1;
  return q.map((x) => x / l);
}

function quatMul(a, b) {
  const [x1, y1, z1, w1] = a;
  const [x2, y2, z2, w2] = b;
  return [
    w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
    w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
    w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
    w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
  ];
}

const quatInv = (q) => [-q[0], -q[1], -q[2], q[3]];

function quatRotate(q, v) {
  const [x, y, z, w] = q;
  const uvx = y * v[2] - z * v[1];
  const uvy = z * v[0] - x * v[2];
  const uvz = x * v[1] - y * v[0];
  const uuvx = y * uvz - z * uvy;
  const uuvy = z * uvx - x * uvz;
  const uuvz = x * uvy - y * uvx;
  return [v[0] + 2 * (w * uvx + uuvx), v[1] + 2 * (w * uvy + uuvy), v[2] + 2 * (w * uvz + uuvz)];
}

function worldPos(m) {
  return [m[12], m[13], m[14]];
}

/** Bind-pose world pose (position + rotation quat) of the first node whose
 *  sanitized name matches. */
function nodeWorldPose(doc, matcher) {
  for (const node of doc.getRoot().listNodes()) {
    if (matcher(node.getName())) {
      const m = node.getWorldMatrix();
      return { pos: worldPos(m), quat: mat4RotToQuat(m), node };
    }
  }
  return null;
}

/** Inject `handslot.r` / `handslot.l` attachment nodes under a rigged model's
 *  hand joints, so the game's weapon-attach path (resolveBone on 'handslot.r',
 *  see src/render/characters/assets.ts) works on generated bodies exactly like
 *  on the KayKit rigs.
 *
 *  The slot pose is CALIBRATED against a reference KayKit rig (`referenceGlb`,
 *  normally knight.glb): the reference handslot's world-space rotation and its
 *  world offset from the hand bone (both rigs bind in an upright T-pose, so
 *  world space is comparable) are transplanted onto the generated hand, with
 *  the offset scaled by relative body height. The slot node also carries a
 *  height-compensating scale so weapons authored for the ~2-unit KayKit bodies
 *  come out proportional after the game's height normalization. Fallback
 *  without a reference: palm-centroid position, +Y along the palm.
 *  `offset`/`rotateY` remain reviewer tuning knobs. */
export async function addHandslotBones(
  glbPath,
  outPath,
  { offset = [0, 0, 0], rotateY = 0, referenceGlb = null } = {},
) {
  const doc = await openGlb(glbPath);
  const root = doc.getRoot();
  const nodes = root.listNodes();

  // Weapon-scale compensation: variant weapons are authored for the KayKit
  // bodies (~2 world units tall natively). The game attaches a weapon INSIDE
  // the model group and then normalizes the whole group by height, so on a
  // model with a different native height the weapon would scale with the
  // normalization and come out wrong-sized. Scaling the slot node itself by
  // nativeHeight / 2.0 cancels that exactly.
  const KAYKIT_NATIVE_HEIGHT = 2.0;
  const scene = root.listScenes()[0];
  const bounds = scene ? getBounds(scene) : null;
  const nativeH = bounds ? bounds.max[1] - bounds.min[1] : KAYKIT_NATIVE_HEIGHT;
  const slotScale = nativeH / KAYKIT_NATIVE_HEIGHT;

  // Reference calibration: the KayKit handslot's world rotation + hand-relative
  // world offset, per side.
  const ref = {};
  if (referenceGlb) {
    const refDoc = await openGlb(referenceGlb);
    const refBounds = getBounds(refDoc.getRoot().listScenes()[0]);
    const refH = refBounds.max[1] - refBounds.min[1] || KAYKIT_NATIVE_HEIGHT;
    for (const side of ['r', 'l']) {
      const slotPose = nodeWorldPose(
        refDoc,
        (n) => n.replace(/[[\].:/]/g, '') === `handslot${side}`,
      );
      const handPose = nodeWorldPose(refDoc, (n) => n.replace(/[[\].:/]/g, '') === `hand${side}`);
      if (slotPose && handPose) {
        ref[side] = {
          quat: slotPose.quat,
          handOffset: [
            (slotPose.pos[0] - handPose.pos[0]) / refH,
            (slotPose.pos[1] - handPose.pos[1]) / refH,
            (slotPose.pos[2] - handPose.pos[2]) / refH,
          ],
        };
      }
    }
  }
  const findHand = (side) => {
    // Tripo native (R_Hand), mixamo (RightHand / mixamorig:RightHand), and
    // generic (hand_r, hand.r) conventions, case-insensitive.
    const long = side === 'r' ? 'right' : 'left';
    const pats = [
      new RegExp(`^${side}_hand$`, 'i'),
      new RegExp(`${long}hand$`, 'i'),
      new RegExp(`hand[._]?${side}$`, 'i'),
      new RegExp(`^hand\\.${side}$`, 'i'),
    ];
    for (const pat of pats) {
      const hit = nodes.find((n) => pat.test(n.getName()));
      if (hit) return hit;
    }
    return null;
  };

  const report = {};
  for (const side of ['r', 'l']) {
    const slotName = `handslot.${side}`;
    if (nodes.some((n) => n.getName() === slotName)) {
      report[side] = { hand: '(already present)', slot: slotName };
      continue;
    }
    const hand = findHand(side);
    if (!hand) {
      report[side] = { hand: null, slot: null };
      continue;
    }
    // Hand world pose on the TARGET rig (bind pose).
    const handM = hand.getWorldMatrix();
    const handQuat = mat4RotToQuat(handM);
    const handP = worldPos(handM);
    // Hand world scale (uniform-ish): length of the first matrix column. Local
    // offsets under the hand are expressed in this scale.
    const handS = Math.hypot(handM[0], handM[1], handM[2]) || 1;

    let localT;
    let quat;
    if (ref[side]) {
      // Transplant the reference slot pose: world rotation copied verbatim
      // (both rigs bind upright), world offset from the hand scaled by body
      // height, both converted into the target hand's local space.
      const offWorld = ref[side].handOffset.map((v) => v * nativeH);
      localT = quatRotate(quatInv(handQuat), offWorld).map((v) => v / handS);
      quat = quatMul(quatInv(handQuat), ref[side].quat);
    } else {
      // Fallback: palm centroid position, +Y along the palm direction.
      const kids = hand.listChildren();
      const palm = [0, 0, 0];
      if (kids.length) {
        for (const k of kids) {
          const t = k.getTranslation();
          palm[0] += t[0] / kids.length;
          palm[1] += t[1] / kids.length;
          palm[2] += t[2] / kids.length;
        }
      }
      localT = palm;
      quat = [0, 0, 0, 1];
      const len = Math.hypot(palm[0], palm[1], palm[2]);
      if (len > 1e-6) {
        const d = [palm[0] / len, palm[1] / len, palm[2] / len];
        const dot = d[1];
        if (dot < -0.999999) {
          quat = [1, 0, 0, 0];
        } else {
          const cx = 1 * d[2] - 0 * d[1];
          const cz = 0 * d[1] - 1 * d[0];
          const w = 1 + dot;
          const n = Math.hypot(cx, 0, cz, w);
          quat = [cx / n, 0, cz / n, w / n];
        }
      }
    }
    if (rotateY) {
      const half = (rotateY * Math.PI) / 360;
      quat = quatMul(quat, [0, Math.sin(half), 0, Math.cos(half)]);
    }
    const slot = doc
      .createNode(slotName)
      .setTranslation([localT[0] + offset[0], localT[1] + offset[1], localT[2] + offset[2]])
      .setRotation(quat)
      .setScale([slotScale / handS, slotScale / handS, slotScale / handS]);
    hand.addChild(slot);
    report[side] = {
      hand: hand.getName(),
      slot: slotName,
      scale: +(slotScale / handS).toFixed(3),
      calibrated: !!ref[side],
    };
  }
  await saveGlb(doc, outPath);
  return report;
}

/** Overwrite the local rotation of existing handslot nodes with the
 *  pose-matched calibration output (computeSlotCalibration). Translation and
 *  scale are left as injected. */
export async function setHandslotRotations(glbPath, outPath, sides) {
  const doc = await openGlb(glbPath);
  const applied = {};
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    const side = name === 'handslot.r' ? 'r' : name === 'handslot.l' ? 'l' : null;
    if (side && sides[side]?.quat) {
      node.setRotation(sides[side].quat);
      applied[side] = true;
    }
  }
  await saveGlb(doc, outPath);
  return applied;
}

/** In-place check: per clip, the XZ translation range of root-level joints.
 *  A range above `limit` world units means baked root motion, which slides
 *  against sim-owned movement. Returns [{clip, range}] offenders. */
export async function checkInPlace(path, { limit } = {}) {
  const doc = await openGlb(path);
  const root = doc.getRoot();
  const skins = root.listSkins();
  if (!skins.length) return [];
  // Scale the threshold to the model (creature GLBs keep Tripo's native units):
  // in-place hip sway is a few percent of body height; travel is far more.
  const scene = root.listScenes()[0];
  const b = scene ? getBounds(scene) : null;
  const height = b ? Math.max(1e-3, b.max[1] - b.min[1]) : 1;
  const effLimit = limit ?? Math.max(0.15, height * 0.12);
  const joints = skins.flatMap((s) => s.listJoints());
  const parents = new Set();
  for (const j of joints) for (const c of j.listChildren()) parents.add(c);
  const rootJoints = new Set(joints.filter((j) => !parents.has(j)));
  // Include the conventional root-motion carriers by substring (Bip01_Pelvis,
  // mixamorig:Hips, etc.), wherever they sit in the hierarchy.
  for (const j of joints) {
    if (/(root|hips|pelvis|armature)/i.test(j.getName())) rootJoints.add(j);
  }
  const offenders = [];
  for (const anim of root.listAnimations()) {
    let range = 0;
    for (const ch of anim.listChannels()) {
      if (ch.getTargetPath() !== 'translation') continue;
      const node = ch.getTargetNode();
      if (!node || !rootJoints.has(node)) continue;
      const out = ch.getSampler()?.getOutput();
      if (!out) continue;
      const el = [0, 0, 0];
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < out.getCount(); i++) {
        out.getElement(i, el);
        for (let k = 0; k < 3; k++) {
          if (el[k] < min[k]) min[k] = el[k];
          if (el[k] > max[k]) max[k] = el[k];
        }
      }
      range = Math.max(range, max[0] - min[0], max[2] - min[2]);
    }
    if (range > effLimit) offenders.push({ clip: anim.getName(), range: +range.toFixed(3) });
  }
  return offenders;
}
