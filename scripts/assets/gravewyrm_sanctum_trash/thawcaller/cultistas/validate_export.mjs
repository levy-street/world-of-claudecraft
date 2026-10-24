import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import validator from 'gltf-validator';
import { MeshoptDecoder } from 'meshoptimizer';
import { AnimationMixer, Box3, LoopOnce, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const key = process.argv[2],
  out = `E:/woc/entregas/santuario/trash/${key}`;
const hash = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const original = await io.read(`${out}/${key}.glb`),
  root = original.getRoot();
const native = JSON.parse(fs.readFileSync(`${out}/native_validation.json`));
assert.equal(native.status, 'PASS');
assert.equal(native.model_sha256, hash(`${out}/${key}.blend`));
const source = JSON.parse(fs.readFileSync(`${out}/source_metrics.json`));
const expectedClips = [
  'Idle',
  'Walk',
  'Run',
  'Attack',
  'Cast',
  'Hit',
  'Death',
  ...{
    thawcaller: ['Attack2', 'WarmingRite'],
    goadsmith: ['Goad', 'ReRivet'],
    pyre_tender: ['PlantBrazier'],
  }[key],
];
assert.deepEqual(Object.keys(source.clips).sort(), expectedClips.sort());
assert(root.listSkins()[0].listJoints().length <= 64);
assert.equal(native.geometry_sha256, hash(`${out}/native_geometry.json.gz`));
const geometry = JSON.parse(gunzipSync(fs.readFileSync(`${out}/native_geometry.json.gz`)));
for (const [name, frame] of Object.entries({
  Attack: 25,
  Attack2: 27,
  WarmingRite: 76,
  Goad: 61,
  ReRivet: 181,
  PlantBrazier: 46,
}))
  if (name in source.clips) assert.equal(source.contacts[name], frame, `Contact contract ${name}`);
const triangles = root
  .listMeshes()
  .reduce(
    (s, m) => s + m.listPrimitives().reduce((n, p) => n + p.getIndices().getCount() / 3, 0),
    0,
  );
assert(triangles <= 24000);
assert(root.listMaterials().length <= 12);
assert(fs.statSync(`${out}/${key}.glb`).size < 4194304);
assert(root.listTextures().length >= 4);
assert(root.listTextures().every((t) => t.getMimeType() === 'image/ktx2'));
const khronos = await validator.validateBytes(
  new Uint8Array(fs.readFileSync(`${out}/${key}.glb`)),
  { maxIssues: 100 },
);
fs.writeFileSync(`${out}/khronos_validation.json`, JSON.stringify(khronos, null, 2));
assert.equal(khronos.issues.numErrors, 0);
async function load(file) {
  const d = await io.read(file);
  // Geometry-only evaluation strips texture references in memory. Browser QA loads actual KTX2 bytes.
  for (const t of [...d.getRoot().listTextures()]) t.dispose();
  for (const e of [...d.getRoot().listExtensionsUsed()])
    if (['KHR_texture_basisu', 'EXT_meshopt_compression'].includes(e.extensionName)) e.dispose();
  const b = await io.writeBinary(d);
  return new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
}
const raw = await load(`${out}/${key}.raw.glb`),
  opt = await load(`${out}/${key}.glb`);
assert.deepEqual(opt.animations.map((a) => a.name).sort(), Object.keys(source.clips).sort());
function sample(g, clip, t) {
  const mix = new AnimationMixer(g.scene),
    act = mix.clipAction(g.animations.find((a) => a.name === clip));
  act.setLoop(LoopOnce, 1);
  act.clampWhenFinished = true;
  act.play();
  mix.setTime(t);
  g.scene.updateMatrixWorld(true);
  const box = new Box3(),
    points = new Map();
  g.scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.skeleton.update();
    const a = [];
    for (let i = 0; i < o.geometry.attributes.position.count; i++) {
      const p = new Vector3();
      o.getVertexPosition(i, p);
      p.applyMatrix4(o.matrixWorld);
      assert(p.toArray().every(Number.isFinite));
      a.push(p);
      box.expandByPoint(p);
    }
    points.set(o.material.name, [...(points.get(o.material.name) || []), ...a]);
  });
  mix.stopAllAction();
  return { box, points };
}
function distance(a, b) {
  let worst = 0;
  const cell = 0.006;
  const id = (x, y, z) => `${x},${y},${z}`;
  for (const [name, pts] of a.points) {
    const grid = new Map();
    for (const p of b.points.get(name)) {
      const k = id(...p.toArray().map((v) => Math.floor(v / cell)));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(p);
    }
    for (const p of pts) {
      const [x, y, z] = p.toArray().map((v) => Math.floor(v / cell));
      let best = Infinity;
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (let k = -1; k <= 1; k++)
            for (const q of grid.get(id(x + i, y + j, z + k)) || [])
              best = Math.min(best, p.distanceTo(q));
      worst = Math.max(worst, best);
    }
  }
  return worst;
}
let maxError = 0,
  maxNative = 0,
  maxBone = 0,
  minGround = 1e9;
const clips = {};
for (const [name, duration] of Object.entries(source.clips)) {
  assert(Math.abs(opt.animations.find((a) => a.name === name).duration - duration) < 0.001);
  for (const n of native.clips[name].native_bounds) {
    const a = sample(raw, name, n.time),
      b = sample(opt, name, n.time);
    maxError = Math.max(maxError, distance(a, b), distance(b, a));
    const [lo, hi] = n.bounds;
    const nlo = [lo[0], lo[2], -hi[1]],
      nhi = [hi[0], hi[2], -lo[1]];
    for (let i = 0; i < 3; i++)
      maxNative = Math.max(
        maxNative,
        Math.abs(a.box.min.getComponent(i) - nlo[i]),
        Math.abs(a.box.max.getComponent(i) - nhi[i]),
      );
    minGround = Math.min(minGround, b.box.min.y);
    const nativeCloud = geometry.clips[name].clouds.find((c) => Math.abs(c.time - n.time) < 1e-5);
    const points = new Map(
      Object.entries(nativeCloud.groups).map(([material, pts]) => [
        material,
        pts.map((p) => new Vector3(p[0], p[2], -p[1])),
      ]),
    );
    maxNative = Math.max(maxNative, distance({ points }, a));
  }
  const mixer = new AnimationMixer(opt.scene),
    action = mixer.clipAction(opt.animations.find((a) => a.name === name));
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  let previous;
  for (let f = 0; f < geometry.clips[name].bone_frames.length; f++) {
    mixer.setTime(f / 60);
    opt.scene.updateMatrixWorld(true);
    const expected = geometry.clips[name].bone_frames[f];
    const rotations = [];
    for (let j = 0; j < geometry.bones.length; j++) {
      const node = opt.scene.getObjectByName(geometry.bones[j]);
      assert(node, `Missing bone ${geometry.bones[j]}`);
      const p = node.getWorldPosition(new Vector3());
      maxBone = Math.max(
        maxBone,
        p.distanceTo(new Vector3(expected[j * 3], expected[j * 3 + 2], -expected[j * 3 + 1])),
      );
      rotations.push(node.getWorldQuaternion(node.quaternion.clone()));
    }
    if (previous)
      for (let j = 0; j < rotations.length; j++)
        assert(
          2 * Math.acos(Math.min(1, Math.abs(rotations[j].dot(previous[j])))) < 0.35,
          `Exported limb flip ${name} ${f}`,
        );
    previous = rotations;
  }
  mixer.stopAllAction();
  clips[name] = { duration, contact_frame: source.contacts[name] ?? null };
}
assert(maxError < 0.005, `Optimization changed geometry ${maxError}`);
assert(maxNative < 0.005, `Native export mismatch ${maxNative}`);
assert(maxBone < 0.005, `60Hz exported bone mismatch ${maxBone}`);
assert(minGround >= -0.016);
// Match prepareVisual: skinned bounds at Idle 0.5 s, then normalize to the
// drawn world height and subtract the measured floor once for every clip.
const placement = sample(opt, 'Idle', 0.5).box;
const drawnHeight = key === 'goadsmith' ? 4.6 : 4.4;
const rawHeight = placement.max.y - placement.min.y;
const gameMinGround = ((minGround - placement.min.y) * drawnHeight) / rawHeight;
assert(gameMinGround >= -0.016, `Game-normalized ground penetration ${gameMinGround}`);
const report = {
  status: 'PASS',
  triangles,
  bytes: fs.statSync(`${out}/${key}.glb`).size,
  materials: root.listMaterials().length,
  textures: root.listTextures().length,
  texture_mime: 'image/ktx2',
  bones: root
    .listSkins()[0]
    .listJoints()
    .map((n) => n.getName()),
  clips,
  max_optimization_error: maxError,
  max_native_bounds_error: maxNative,
  min_ground: minGround,
  normalization: {
    idle_sample_seconds: 0.5,
    raw_height: rawHeight,
    raw_floor: placement.min.y,
    drawn_height: drawnHeight,
    min_ground_world: gameMinGround,
  },
  khronos_errors: khronos.issues.numErrors,
  khronos_warnings: khronos.issues.numWarnings,
  glb_sha256: hash(`${out}/${key}.glb`),
  model_sha256: native.model_sha256,
  validator_sha256: hash('scripts/anim/cultistas/validate_export.mjs'),
};
report.max_bone_error_60hz = maxBone;
fs.writeFileSync(`${out}/export_validation.json`, JSON.stringify(report, null, 2));
console.log('EXPORT PASS', key, triangles, maxError, maxNative, maxBone);
