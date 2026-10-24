// The Drakemaw Raptor mount, rigged, skinned and animated in Blender from scratch
// (scripts/assets/drakemaw_raptor/): the shipped GLB is read and played the way
// the renderer plays it, and every promise its clips make is checked against the
// game's own numbers rather than the build's word for them. The feet lock to the
// ground at the manifest's refs, which ARE the ridden speeds; the Idle's sizing
// frame is the manifest height with the soles on the ground; the sprint flies;
// the Jump is on its held touchdown pose by the time the sim lands it, with its
// feet at ground level; every loop closes; the rider rests in the saddle's dish,
// a centimetre or two over the leather, and the spec's fixed seat restates where
// the bone puts them; the two legacy pipelines that once wrote this file stay
// retired; and the file is never stale against its builder.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Animation, type Node, NodeIO, type Primitive, type Root } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { FINGERPRINT_INPUTS, fingerprint, ROOT } from '../scripts/assets/drakemaw_raptor/ship.mjs';
import { VISUALS } from '../src/render/characters/manifest';
import { GAIT_RUN_ENTER } from '../src/render/locomotion';
import { MOUNT_VISUAL_SPECS } from '../src/render/mount_visuals';
import { MOUNTS } from '../src/sim/content/mounts';
import { BUILTIN_WORLD } from '../src/sim/data';
import { BACKPEDAL_MULT } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import { DT, RUN_SPEED, type WorldContent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { stripComments } from './helpers/strip_comments';

const URL_PATH = 'models/mounts/drakemaw_raptor.glb';
const FILE = fileURLToPath(new URL(`../public/${URL_PATH}`, import.meta.url));
const BUILD_DIR = 'scripts/assets/drakemaw_raptor';
const SOURCE = `${BUILD_DIR}/source/drakemaw_raptor_source.glb`;
const CLIPS = ['Idle', 'Jump', 'Land', 'Run', 'Walk', 'WalkBack'];
const LOOPS = ['Idle', 'Walk', 'Run', 'WalkBack'];
const GAITS = ['Run', 'Walk', 'WalkBack'];
const SIDES = ['L_', 'R_'] as const;
type Side = (typeof SIDES)[number];
const def = VISUALS.mount_drakemaw_raptor;

interface Stamp {
  fingerprint: string;
  blender: string;
  idleHeight: number;
  saddleRest: [number, number, number];
  speeds: { walk: number; run: number; walkBack: number };
  gaits: Record<string, { speed: number; seconds: number; duty: number }>;
}

let io: NodeIO;
let root: Root;
let stamp: Stamp;

// The rig and its clips, decoded once in beforeAll so the sweeps below cost
// arithmetic, not accessor reads.
/** Every node, parents before children, with its parent's index (-1 for none). */
let nodes: Node[];
let parents: Int32Array;
/** Each node's rest translation, rotation and scale, packed ten to a node. */
let rest: Float64Array;
const SLOT = { translation: 0, rotation: 3, scale: 7 } as const;
/** One channel: its key times, and its values read through getElement
 *  (meshopt's normalized signed-short quaternions included). */
interface Track {
  /** Where the channel writes in a packed rest array. */
  at: number;
  rotation: boolean;
  size: number;
  times: Float64Array;
  values: Float64Array;
}
let tracks: Map<Animation, Track[]>;
/** The skin: its joints and their inverse bind matrices, then per vertex the
 *  stored POSITION (meshopt quantized it, and the inverse bind matrices carry
 *  the dequantization) and the four joints and weights that move it. */
let joints: Node[];
let inverseBind: Matrix4[];
let vertexCount: number;
let positions: Float64Array;
let skinJoints: Uint16Array;
let skinWeights: Float64Array;
/** Each leg: every vertex its Thigh, Shin, Foot and Toes carry more than half of. */
let legs: Record<Side, Uint32Array>;
/** Scratch: the loaded pose's skinning matrices, sixteen to a joint. */
let skinning: Float64Array;

const clip = (name: string) => {
  const a = root.listAnimations().find((x) => x.getName() === name);
  if (!a) throw new Error(`no clip ${name}`);
  return a;
};
const joint = (name: string) => {
  const n = joints.find((j) => j.getName() === name);
  if (!n) throw new Error(`no joint ${name}`);
  return n;
};
const duration = (a: Animation) =>
  Math.max(
    ...a.listSamplers().map((s) => {
      const input = s.getInput()!;
      return input.getScalar(input.getCount() - 1);
    }),
  );
/** Every key time any of a clip's channels holds, in order. */
const keyTimes = (a: Animation) =>
  [...new Set(tracks.get(a)!.flatMap((t) => [...t.times]))].sort((x, y) => x - y);
/** The largest element-wise difference between two matrices. */
const gap = (a: Matrix4, b: Matrix4) =>
  Math.max(...a.elements.map((v, k) => Math.abs(v - b.elements[k])));

const qa = new Quaternion();
const qb = new Quaternion();
const tv = new Vector3();
const sv = new Vector3();

/** World matrices of every node at `time`, sampled the way the mixer plays a
 *  clip: translation lerped, rotation slerped. A null clip is the rest pose,
 *  which is the bind pose (every joint's rest times its inverse bind matrix is
 *  one and the same dequantization). */
function matricesAt(a: Animation | null, time = 0): Map<Node, Matrix4> {
  const trs = rest.slice();
  for (const { at, rotation, size, times, values } of a ? tracks.get(a)! : []) {
    // the first key at or after `time` (the last key once past the end)
    let right = 0;
    let hi = times.length - 1;
    while (right < hi) {
      const mid = (right + hi) >> 1;
      if (times[mid] < time) right = mid + 1;
      else hi = mid;
    }
    const left = Math.max(0, right - 1);
    const t0 = times[left];
    const t1 = times[right];
    const u = t0 === t1 ? 0 : Math.max(0, Math.min(1, (time - t0) / (t1 - t0)));
    if (rotation)
      qa.fromArray(values, left * 4)
        .slerp(qb.fromArray(values, right * 4), u)
        .toArray(trs, at);
    else
      for (let k = 0; k < size; k++) {
        const v = values[left * size + k];
        trs[at + k] = v + (values[right * size + k] - v) * u;
      }
  }
  const world: Matrix4[] = [];
  const result = new Map<Node, Matrix4>();
  nodes.forEach((n, i) => {
    const m = new Matrix4().compose(
      tv.fromArray(trs, i * 10),
      qa.fromArray(trs, i * 10 + 3),
      sv.fromArray(trs, i * 10 + 7),
    );
    if (parents[i] >= 0) m.premultiply(world[parents[i]]);
    world[i] = m;
    result.set(n, m);
  });
  return result;
}

const scratch = new Matrix4();
/** Load a pose's skinning matrices (each joint's world matrix times its inverse
 *  bind matrix) for skinVertex. */
function loadPose(poses: Map<Node, Matrix4>): void {
  joints.forEach((j, i) => {
    scratch.multiplyMatrices(poses.get(j)!, inverseBind[i]).toArray(skinning, i * 16);
  });
}

/** Skin vertex `i` under the loaded pose into out[at..at+2] without allocating:
 *  the vertex through each influence's matrix (Vector3.applyMatrix4, divide and
 *  all), scaled by its weight and summed. A zero weight adds nothing. */
function skinVertex(i: number, out: Float64Array, at: number): void {
  const x = positions[i * 3];
  const y = positions[i * 3 + 1];
  const z = positions[i * 3 + 2];
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let k = i * 4; k < i * 4 + 4; k++) {
    const w = skinWeights[k];
    if (w === 0) continue;
    const e = skinJoints[k] * 16;
    const m = skinning;
    const d = 1 / (m[e + 3] * x + m[e + 7] * y + m[e + 11] * z + m[e + 15]);
    sx += (m[e] * x + m[e + 4] * y + m[e + 8] * z + m[e + 12]) * d * w;
    sy += (m[e + 1] * x + m[e + 5] * y + m[e + 9] * z + m[e + 13]) * d * w;
    sz += (m[e + 2] * x + m[e + 6] * y + m[e + 10] * z + m[e + 14]) * d * w;
  }
  out[at] = sx;
  out[at + 1] = sy;
  out[at + 2] = sz;
}

const point = new Float64Array(3);
/** The posed skin's bounds, skinned on the CPU the way the renderer sizes it;
 *  with `subset`, the bounds of just those vertices. */
function skinnedBounds(a: Animation, time: number, subset?: ArrayLike<number>): Box3 {
  loadPose(matricesAt(a, time));
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  const n = subset ? subset.length : vertexCount;
  for (let s = 0; s < n; s++) {
    skinVertex(subset ? subset[s] : s, point, 0);
    x0 = Math.min(x0, point[0]);
    y0 = Math.min(y0, point[1]);
    z0 = Math.min(z0, point[2]);
    x1 = Math.max(x1, point[0]);
    y1 = Math.max(y1, point[1]);
    z1 = Math.max(z1, point[2]);
  }
  return new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1));
}

const ballAt = (a: Animation, t: number, side: Side) =>
  new Vector3().setFromMatrixPosition(matricesAt(a, t).get(joint(`${side}Toes`))!);

/** Where the renderer puts the rider's root for a pose (mount_lifecycle.ts
 *  seatRiderOnBone): the Saddle bone's world matrix times the seat offset, the
 *  scale dropped. normScale is 1 (the sizing test below) and this mount carries
 *  no bob or ground lift, so model space is the mount group's space. */
function riderRootAt(poses: Map<Node, Matrix4>): Matrix4 {
  const [x, y, z] = MOUNT_VISUAL_SPECS.drakemaw_raptor.seatBone!.offset;
  const seat = poses
    .get(joint('Saddle'))!
    .clone()
    .multiply(new Matrix4().makeTranslation(x, y, z));
  const position = new Vector3();
  const quaternion = new Quaternion();
  seat.decompose(position, quaternion, new Vector3());
  return new Matrix4().compose(position, quaternion, new Vector3(1, 1, 1));
}

/** Every file under `dir`, recursively, as forward-slash paths relative to it.
 *  Its own walk: no shared walker reads `.py`, and half of this build is Python. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) =>
      statSync(path.join(dir, name)).isDirectory()
        ? filesUnder(path.join(dir, name)).map((f) => `${name}/${f}`)
        : [name],
    );
}

/** The top-level keys of the object literal `const <name> = {...}` in a
 *  comment-stripped source. String literals are skipped whole, so a brace or a
 *  comma inside one never counts; an entry that is not a plain `key:` (a
 *  spread, a shorthand, a computed key) throws, since it could add a key unseen. */
function objectKeys(source: string, name: string): string[] {
  const open = source.indexOf(`const ${name} = {`);
  if (open < 0) throw new Error(`no \`const ${name} = {\``);
  const keys: string[] = [];
  let depth = 1;
  let entry = '';
  for (let i = source.indexOf('{', open) + 1; i < source.length; i++) {
    const c = source[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === '\\' ? 2 : 1;
      entry += source.slice(i, j + 1);
      i = j;
      continue;
    }
    if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c)) depth--;
    if (depth === 0 || (depth === 1 && c === ',')) {
      const text = entry.trim();
      if (text) {
        const key = /^(['"]?)([A-Za-z_$][\w$]*)\1\s*:/.exec(text);
        if (!key) throw new Error(`${name} holds an entry that is not a plain key: ${text}`);
        keys.push(key[2]);
      }
      if (depth === 0) return keys;
      entry = '';
    } else entry += c;
  }
  throw new Error(`${name} never closes`);
}

/** A flat mounted jump in the real sim, on this mount (the harness of
 *  tests/mount_jump.test.ts): the ticks from the one that takes the jump to the
 *  one that lands it, both counted. */
function mountedJumpTicks(): number {
  const seed = 42;
  const world: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true, world });
  sim.setPlayerLevel(60);
  const p = sim.player;
  p.pos.x = 0;
  p.pos.z = 0;
  p.pos.y = terrainHeight(0, 0, seed);
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.onGround = true;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  // Own the reins, so the ride survives the ownership re-validation stagger.
  sim.addItem('reins_drakemaw_raptor', 1, p.id);
  p.mountKey = 'drakemaw_raptor';
  const meta = sim.players.get(p.id);
  if (!meta) throw new Error('missing meta');
  sim.tick();
  meta.moveInput.jump = true;
  sim.tick();
  meta.moveInput.jump = false;
  expect(p.vy, 'the jump fired').toBeGreaterThan(0);
  let ticks = 1;
  while (!p.onGround) {
    sim.tick();
    if (++ticks > 100) throw new Error('the jump never landed');
  }
  expect(p.mountKey, 'still riding the raptor').toBe('drakemaw_raptor');
  return ticks;
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
  io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  root = (await io.read(FILE)).getRoot();
  stamp = (root.getAsset().extras as { drakemawRaptor: Stamp }).drakemawRaptor;

  nodes = [];
  const place = (n: Node) => {
    if (nodes.includes(n)) return;
    const parent = n.getParentNode();
    if (parent) place(parent);
    nodes.push(n);
  };
  for (const n of root.listNodes()) place(n);
  parents = Int32Array.from(nodes, (n) => {
    const parent = n.getParentNode();
    return parent ? nodes.indexOf(parent) : -1;
  });
  rest = new Float64Array(nodes.length * 10);
  nodes.forEach((n, i) => {
    rest.set(n.getTranslation(), i * 10 + SLOT.translation);
    rest.set(n.getRotation(), i * 10 + SLOT.rotation);
    rest.set(n.getScale(), i * 10 + SLOT.scale);
  });
  tracks = new Map(
    root.listAnimations().map((a) => [
      a,
      a.listChannels().map((channel) => {
        const p = channel.getTargetPath() as keyof typeof SLOT;
        const sampler = channel.getSampler()!;
        const input = sampler.getInput()!;
        const output = sampler.getOutput()!;
        const size = output.getElementSize();
        const values = new Float64Array(output.getCount() * size);
        for (let k = 0; k < output.getCount(); k++) values.set(output.getElement(k, []), k * size);
        return {
          at: nodes.indexOf(channel.getTargetNode()!) * 10 + SLOT[p],
          rotation: p === 'rotation',
          size,
          times: Float64Array.from({ length: input.getCount() }, (_, k) => input.getScalar(k)),
          values,
        };
      }),
    ]),
  );

  const skin = root.listSkins()[0];
  joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices()!;
  inverseBind = joints.map((_, i) => new Matrix4().fromArray(ibm.getElement(i, [])));
  skinning = new Float64Array(joints.length * 16);
  const prim = root.listMeshes()[0].listPrimitives()[0];
  const pos = prim.getAttribute('POSITION')!;
  const jts = prim.getAttribute('JOINTS_0')!;
  const wts = prim.getAttribute('WEIGHTS_0')!;
  vertexCount = pos.getCount();
  positions = new Float64Array(vertexCount * 3);
  skinJoints = new Uint16Array(vertexCount * 4);
  skinWeights = new Float64Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    positions.set(pos.getElement(i, []), i * 3);
    skinJoints.set(jts.getElement(i, []), i * 4);
    skinWeights.set(wts.getElement(i, []), i * 4);
  }
  const leg = (side: Side) => {
    const bones = ['Thigh', 'Shin', 'Foot', 'Toes'].map((b) => joints.indexOf(joint(side + b)));
    const out: number[] = [];
    for (let i = 0; i < vertexCount; i++) {
      let carried = 0;
      for (let k = i * 4; k < i * 4 + 4; k++)
        if (bones.includes(skinJoints[k])) carried += skinWeights[k];
      if (carried > 0.5) out.push(i);
    }
    return Uint32Array.from(out);
  };
  legs = { L_: leg('L_'), R_: leg('R_') };
});

describe('the Drakemaw Raptor mount', () => {
  it('is never stale against its builder, and the legacy pipelines stay retired', () => {
    // Editing anatomy/rig/pose/clips/keys/build/prep/ship/build.mjs or the
    // source mesh without re-running `node scripts/assets/drakemaw_raptor/build.mjs`
    // fails here.
    expect(stamp.fingerprint).toBe(fingerprint());
    // which Blender built the file (provenance; the fingerprint proves no input changed since)
    expect(stamp.blender).toMatch(/^\d+\.\d+/);
    // The fingerprint covers every builder: each Python and ES module file in the
    // build directory, plus the source mesh. extract_source.mjs is the one-shot
    // that lifted the source out of the old Tripo export, and no build runs it.
    const scanned = filesUnder(path.join(ROOT, BUILD_DIR)).map((f) => `${BUILD_DIR}/${f}`);
    expect(scanned).toContain(SOURCE);
    const builders = scanned.filter(
      (f) => /\.(py|mjs)$/.test(f) && f !== `${BUILD_DIR}/extract_source.mjs`,
    );
    expect([...FINGERPRINT_INPUTS].sort()).toEqual([...builders, SOURCE].sort());
    // ...and it hashes their bytes: a faithful copy of the inputs fingerprints
    // the same, and one flipped byte does not.
    const copy = mkdtempSync(path.join(tmpdir(), 'wocc-drakemaw-fingerprint-'));
    try {
      for (const rel of FINGERPRINT_INPUTS) {
        mkdirSync(path.dirname(path.join(copy, rel)), { recursive: true });
        copyFileSync(path.join(ROOT, rel), path.join(copy, rel));
      }
      expect(fingerprint(copy), 'a faithful copy').toBe(fingerprint());
      const edited = path.join(copy, FINGERPRINT_INPUTS[0]);
      const bytes = readFileSync(edited);
      bytes[bytes.length >> 1] ^= 0xff;
      writeFileSync(edited, bytes);
      expect(fingerprint(copy), 'one byte flipped').not.toBe(fingerprint());
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
    // The gait baker would delete and re-bake these clips. It bakes exactly the
    // mounts its RIGS table names, read here with the comments stripped, and the
    // three it does bake prove the parse reads the table.
    const baker = stripComments(
      readFileSync(path.join(ROOT, 'scripts/bake_mount_gaits.mjs'), 'utf8'),
    );
    const rigs = objectKeys(baker, 'RIGS');
    for (const key of ['grag_bear', 'shadowjump_toad', 'stormfeather_griffin'])
      expect(rigs, 'the RIGS parse').toContain(key);
    expect(rigs).not.toContain('drakemaw_raptor');
    // No asset spec may write this file (the dragonkin spec once overwrote it with
    // the old Tripo export); the mount outputs other specs do write prove the
    // scan reads them.
    const specs = path.join(ROOT, 'scripts/assets/specs');
    const outs = filesUnder(specs)
      .filter((f) => f.endsWith('.json'))
      .flatMap((f) => {
        const spec = JSON.parse(readFileSync(path.join(specs, f), 'utf8')) as {
          items?: { out?: string }[];
        };
        return (spec.items ?? []).flatMap((item) => (item.out ? [item.out] : []));
      });
    expect(outs, 'the spec scan').toContain('models/mounts/avian_strider.glb');
    expect(outs).not.toContain(URL_PATH);
  });

  it('ships exactly its clip set on its own rig, one material, compressed and lean', async () => {
    expect(def.url.endsWith(URL_PATH)).toBe(true);
    expect(root.listAnimations().map((a) => a.getName())).toEqual(CLIPS);
    // every clip the ClipMap names ships
    for (const name of Object.values(def.clips).flat())
      expect(CLIPS, `the ClipMap names ${name}`).toContain(name);
    // A ridden mount never dies: the map holds Idle, and no Death ships.
    expect(def.clips.death).toBe('Idle');
    expect(def.clips).toMatchObject({
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      walkBack: 'WalkBack',
      jump: 'Jump',
      land: 'Land',
      attack: [],
    });
    const names = joints.map((j) => j.getName());
    for (const name of [
      'Root',
      'Hips',
      'Saddle',
      'Head',
      'Tail6',
      'L_Toes',
      'R_Toes',
      'L_Hand',
      'R_Hand',
    ])
      expect(names, name).toContain(name);
    // The parentless Root is never animated.
    for (const a of root.listAnimations())
      expect(
        a.listChannels().some((c) => c.getTargetNode()?.getName() === 'Root'),
        a.getName(),
      ).toBe(false);
    // the Tripo mesh, every triangle kept
    const source = (await io.read(path.join(ROOT, SOURCE))).getRoot();
    const triangles = (p: Primitive) =>
      (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3;
    const prim = root.listMeshes()[0].listPrimitives()[0];
    expect(triangles(prim)).toBe(
      source
        .listMeshes()
        .flatMap((m) => m.listPrimitives())
        .reduce((sum, p) => sum + triangles(p), 0),
    );
    expect(prim.getAttribute('COLOR_0')).toBeNull();
    expect(prim.getAttribute('JOINTS_1')).toBeNull();
    let worst = 0;
    let worstAt = -1;
    for (let i = 0; i < vertexCount; i++) {
      const sum = skinWeights.slice(i * 4, i * 4 + 4).reduce((s, x) => s + x, 0);
      if (Math.abs(sum - 1) > worst) [worst, worstAt] = [Math.abs(sum - 1), i];
    }
    expect(worst, `vertex ${worstAt}'s weights sum to 1`).toBeLessThan(5e-4);
    // One material wearing one texture, its base colour: the source's KTX2 bytes,
    // untouched (ship.mjs restores them over the PNG the Blender round trip carried).
    expect(root.listMaterials()).toHaveLength(1);
    const textures = root.listTextures();
    expect(textures).toHaveLength(1);
    expect(root.listMaterials()[0].getBaseColorTexture() === textures[0], 'the base colour').toBe(
      true,
    );
    expect(textures[0].getMimeType()).toBe('image/ktx2');
    const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    const paint = source.listMaterials()[0].getBaseColorTexture()?.getImage();
    if (!paint) throw new Error('the source carries no base colour');
    expect(sha256(textures[0].getImage()!)).toBe(sha256(paint));
    expect(readFileSync(FILE).byteLength).toBeLessThan(600 * 1024);
  });

  it("stands one model yard per game yard: the Idle's sizing frame is the manifest height", () => {
    // The renderer poses Idle at min(0.5 s, half its length), skins it, and
    // scales its height to `height`: with the two equal, normScale is 1.
    const idle = clip('Idle');
    const box = skinnedBounds(idle, Math.min(0.5, duration(idle) / 2));
    // the soles on the ground, within 2 mm of it
    expect(Math.abs(box.min.y)).toBeLessThan(0.002);
    expect(box.max.y - box.min.y).toBeCloseTo(def.height, 3);
    expect(def.height).toBeCloseTo(stamp.idleHeight, 5);
    expect(def.hover ?? 0).toBe(0);
  });

  it('plants its feet at exactly the ridden speeds: the refs are foot-lock speeds', () => {
    // Both catalog mounts ride this visual, so its refs are each one's ridden speeds.
    for (const key of ['drakemaw_raptor', 'referral_raptor'] as const) {
      expect(MOUNT_VISUAL_SPECS[key].visualKey).toBe('mount_drakemaw_raptor');
      const ridden = RUN_SPEED * (1 + MOUNTS[key].moveSpeedPct);
      expect(def.runRef, `${key} runRef`).toBeCloseTo(ridden, 9);
      expect(def.walkBackRef, `${key} walkBackRef`).toBeCloseTo(ridden * BACKPEDAL_MULT, 9);
    }
    // the Walk holds its lock right up to the run gait's threshold
    expect((def.walkRef ?? 0) * (def.walkTimeScaleMax ?? 0)).toBeGreaterThanOrEqual(GAIT_RUN_ENTER);
    // The stamp's gait periods, which place every sample below, are the clips' own lengths.
    for (const name of GAITS)
      expect(duration(clip(name)), `${name} period`).toBeCloseTo(stamp.gaits[name].seconds, 6);
    // +Z is forward: a planted ball slides back (-Z) at the ref and holds its
    // height. The right foot runs half a period behind the left (clips.py, Gait).
    for (const [name, ref] of [
      ['Run', def.runRef],
      ['Walk', def.walkRef],
      ['WalkBack', -(def.walkBackRef ?? 0)],
    ] as const) {
      const g = stamp.gaits[name];
      const stance = g.duty * g.seconds;
      for (const side of SIDES) {
        const off = side === 'L_' ? 0 : g.seconds / 2;
        const t0 = off + stance * 0.2;
        const t1 = off + stance * 0.8;
        const a = ballAt(clip(name), t0, side);
        const b = ballAt(clip(name), t1, side);
        const v = b
          .clone()
          .sub(a)
          .divideScalar(t1 - t0);
        expect(-v.z, `${name} ${side} planted ball speed`).toBeCloseTo(ref ?? 0, 1);
        // Sampled BETWEEN keys, as the renderer plays it: slerping each joint
        // traces a few millimetres of curve between two exactly solved keys. The
        // bound is 8 mm because the Run's odd 27-frame loop puts the right foot's
        // stance half a frame off the keys, so its planted ball wobbles 6.4 mm in
        // height (the left 3.7).
        for (let i = 0; i <= 8; i++) {
          const p = ballAt(clip(name), t0 + ((t1 - t0) * i) / 8, side);
          expect(Math.abs(p.y - a.y), `${name} ${side} planted ball height at ${i}/8`).toBeLessThan(
            0.008,
          );
          expect(
            Math.abs(p.x - a.x),
            `${name} ${side} planted ball skates sideways at ${i}/8`,
          ).toBeLessThan(0.008);
        }
        // ...and the planted foot stands ON the ground, not over it: at its
        // mid-stance that leg's lowest vertex is within 8 mm of y = 0.
        const low = skinnedBounds(clip(name), off + stance / 2, legs[side]).min.y;
        expect(Math.abs(low), `${name} ${side} leg's lowest vertex at mid-stance`).toBeLessThan(
          0.008,
        );
      }
    }
  });

  it('never puts a foot through the ground, in any clip, at any moment', () => {
    // The whole skin, as it plays: a claw curled before the foot has lifted, a
    // heel tipped down onto a planted ball, or a boot riding the metatarsus as the
    // heel lifts all show up here as a vertex under y = 0 (each was a 4 to 17 cm
    // dip before the solver's ground clamp). Every clip is sampled on every key,
    // where the clamp holds the skin within 2 mm of the ground (pose.py
    // GROUND_EPS), and at the quarter, half and three-quarter phases between
    // keys, where the bound is 1.5 cm: slerping each joint between two exactly
    // solved keys bows a claw up to about 1.4 cm under for a fraction of a
    // frame, at the Idle's stamp and the sprint's strike.
    for (const a of root.listAnimations()) {
      const keys = keyTimes(a);
      keys.forEach((t, k) => {
        expect(skinnedBounds(a, t).min.y, `${a.getName()} on key ${k}`).toBeGreaterThan(-0.002);
        if (k === keys.length - 1) return;
        for (const q of [0.25, 0.5, 0.75]) {
          const low = skinnedBounds(a, t + (keys[k + 1] - t) * q).min.y;
          expect(low, `${a.getName()} at frame ${k + q}`).toBeGreaterThan(-0.015);
        }
      });
    }
  });

  it('sprints with real flight, and every loop closes', () => {
    const run = clip('Run');
    const g = stamp.gaits.Run;
    // Two flights a stride: midway between the left foot's push-off and the right
    // foot's strike, and half a period later between the right's push-off and
    // the left's strike, both feet are up.
    const flight = ((g.duty + 0.5) / 2) * g.seconds;
    for (const t of [flight, flight + g.seconds / 2])
      expect(skinnedBounds(run, t).min.y, `flight at ${t.toFixed(3)} s`).toBeGreaterThan(0.05);
    for (const name of LOOPS) {
      const a = clip(name);
      const first = matricesAt(a, 0);
      const last = matricesAt(a, duration(a));
      for (const j of joints)
        expect(gap(first.get(j)!, last.get(j)!), `${name} ${j.getName()} seam`).toBeLessThan(1e-3);
    }
  });

  it('is on its held touchdown pose when the sim lands a flat mounted jump, feet at ground level', () => {
    // The sim integrates the arc semi-implicitly at 20 Hz (player_motion.ts), so a
    // flat mounted jump does not land at the continuous 2v/g = 0.9375 s: measured
    // here in the real sim, it lands on its 18th tick today, and the renderer sees
    // the rider airborne for the 17 ticks before that, 0.85 s of Jump, then plays
    // Land. The Jump eases into its held 'ready' pose at 0.85 s (clips.py jump())
    // and holds it to its end (0.933 s), so at the touchdown every joint must
    // already be on its held frame.
    const jump = clip('Jump');
    const touchdown = (mountedJumpTicks() - 1) * DT;
    const at = matricesAt(jump, touchdown);
    const held = matricesAt(jump, duration(jump));
    for (const j of joints)
      expect(
        gap(at.get(j)!, held.get(j)!),
        `${j.getName()} at the ${touchdown.toFixed(3)} s touchdown`,
      ).toBeLessThan(2e-3);
    // the held frame: no rise (the game owns the arc), each leg's foot at the ground
    for (const side of SIDES) {
      const low = skinnedBounds(jump, duration(jump), legs[side]).min.y;
      expect(low, `${side} held foot`).toBeGreaterThan(-0.01);
      expect(low, `${side} held foot`).toBeLessThan(0.08);
    }
    // and the tuck really lifts them clear
    expect(skinnedBounds(jump, 0.45).min.y).toBeGreaterThan(0.2);
    // The Land settles back to the stance the Idle stands in: every joint on the
    // Idle's first frame but the tail, which the Idle is already swaying there.
    const land = clip('Land');
    const settled = matricesAt(land, duration(land));
    const idle = matricesAt(clip('Idle'), 0);
    for (const j of joints) {
      if (/^Tail\d$/.test(j.getName())) continue;
      expect(
        gap(settled.get(j)!, idle.get(j)!),
        `${j.getName()} settles into the Idle`,
      ).toBeLessThan(2e-3);
    }
    const box = skinnedBounds(land, duration(land));
    expect(box.min.y).toBeGreaterThan(-0.01);
    expect(box.min.y).toBeLessThan(0.01);
  });

  it("sits the rider in the saddle's dish, riding the Saddle bone", () => {
    const specs = [MOUNT_VISUAL_SPECS.drakemaw_raptor, MOUNT_VISUAL_SPECS.referral_raptor];
    for (const s of specs) {
      expect(s.visualKey).toBe('mount_drakemaw_raptor');
      expect(s.seatBone?.bone).toBe('Saddle');
      // the plain seated loop, as on every saddled mount: a straddle override
      // re-posed the rider's legs here and stretched them down the flanks
      expect(s.ride).toBeNull();
    }
    expect(MOUNT_VISUAL_SPECS.referral_raptor).toEqual(MOUNT_VISUAL_SPECS.drakemaw_raptor);
    // The bone at rest, (0, 2.3769, 0.2908), sits at the front of the saddle's
    // dish where the seat starts up toward the pommel, about 2.6 cm under the
    // leather above it. The build stamps the same rest head: a provenance check
    // that the stamp and the shipped bone agree, no more.
    const bone = new Vector3().setFromMatrixPosition(
      new Matrix4().fromArray(joint('Saddle').getWorldMatrix()),
    );
    for (const [i, c] of stamp.saddleRest.entries()) expect(bone.getComponent(i)).toBeCloseTo(c, 4);
    // The seat: every triangle with a corner the Saddle bone carries alone (a
    // weight over 0.99), skinned at bind. Along the midline its dish floor is flat
    // (y 2.3842 from z 0.05 to 0.2), the cantle crests behind it at z -0.10 (y
    // 2.49), and ahead of it the seat climbs to the pommel's crest near z 0.525
    // (y 2.65); across x it is crowned (about 2.347 at x = +-0.13).
    const bind = new Float64Array(vertexCount * 3);
    loadPose(matricesAt(null));
    for (let i = 0; i < vertexCount; i++) skinVertex(i, bind, i * 3);
    const saddle = joints.indexOf(joint('Saddle'));
    const rigid = (v: number) =>
      [0, 1, 2, 3].some((k) => skinJoints[v * 4 + k] === saddle && skinWeights[v * 4 + k] > 0.99);
    const indices = root.listMeshes()[0].listPrimitives()[0].getIndices()!;
    const seat: number[] = [];
    for (let t = 0; t < indices.getCount(); t += 3) {
      const tri = [indices.getScalar(t), indices.getScalar(t + 1), indices.getScalar(t + 2)];
      if (tri.some(rigid)) seat.push(...tri.map((v) => v * 3));
    }
    /** Every height where the vertical through (x, z) crosses the seat, highest first. */
    const crossings = (x: number, z: number): number[] => {
      const out: number[] = [];
      for (let t = 0; t < seat.length; t += 3) {
        const a = seat[t];
        const b = seat[t + 1];
        const c = seat[t + 2];
        const det =
          (bind[b + 2] - bind[c + 2]) * (bind[a] - bind[c]) +
          (bind[c] - bind[b]) * (bind[a + 2] - bind[c + 2]);
        if (det === 0) continue;
        const u =
          ((bind[b + 2] - bind[c + 2]) * (x - bind[c]) + (bind[c] - bind[b]) * (z - bind[c + 2])) /
          det;
        const v =
          ((bind[c + 2] - bind[a + 2]) * (x - bind[c]) + (bind[a] - bind[c]) * (z - bind[c + 2])) /
          det;
        if (u < 0 || v < 0 || u + v > 1) continue;
        out.push(u * bind[a + 1] + v * bind[b + 1] + (1 - u - v) * bind[c + 1]);
      }
      return out.sort((p, q) => q - p);
    };
    // The crests, from the midline profile (rear to front): the dish is the point
    // of the profile that would hold the most water, and the cantle and pommel
    // crests are the highest points behind and ahead of it.
    const zs = seat.map((v) => bind[v + 2]);
    const profile: { z: number; y: number }[] = [];
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.0025) {
      const [top] = crossings(0, z);
      if (top !== undefined) profile.push({ z, y: top });
    }
    let dish = -1;
    let deepest = 0;
    for (let k = 1; k < profile.length - 1; k++) {
      const behind = Math.max(...profile.slice(0, k).map((p) => p.y));
      const ahead = Math.max(...profile.slice(k + 1).map((p) => p.y));
      const depth = Math.min(behind, ahead) - profile[k].y;
      if (depth > deepest) [dish, deepest] = [k, depth];
    }
    expect(dish, 'the midline dips into a dish').toBeGreaterThan(0);
    const crest = (part: { z: number; y: number }[]) => part.reduce((p, q) => (q.y > p.y ? q : p));
    const cantle = crest(profile.slice(0, dish));
    const pommel = crest(profile.slice(dish + 1));
    // The rider's contact with the leather, in the rider root's frame (+Y up, +Z
    // forward): measured live 2026-10-23 on the warrior's male and female bodies,
    // mounted on this raptor, over 4 s of the seated loop sampled ten times; per
    // body, the point of the rider's buttocks that comes closest to the leather
    // beneath it, from a 1 cm heightfield of the seated underside. Mirrored in x
    // for the other side. Clearance: 1.17 cm male, 2.01 cm female (0.97 and 2.23
    // on the mirrored side).
    const contacts = {
      player_warrior: [0.043, 0.2525, -0.3058],
      player_warrior_female: [0.1224, 0.2385, -0.2536],
    } as const;
    // The saddle is rigid on the bone and the rider rides it, so the clearance at
    // bind is the clearance in every pose.
    const seated = riderRootAt(matricesAt(null));
    for (const [body, [x, y, z]] of Object.entries(contacts)) {
      expect(VISUALS[body], body).toBeDefined();
      for (const side of [1, -1]) {
        const contact = new Vector3(x * side, y, z).applyMatrix4(seated);
        const where = `${body} at x ${(x * side).toFixed(4)}`;
        const [leather] = crossings(contact.x, contact.z);
        if (leather === undefined) throw new Error(`${where} is not over the seat`);
        expect(contact.y - leather, `${where} rests on the leather`).toBeGreaterThan(0.005);
        expect(contact.y - leather, `${where} does not float over it`).toBeLessThan(0.03);
        expect(contact.z, `${where} sits in front of the cantle crest`).toBeGreaterThan(cantle.z);
        expect(contact.z, `${where} sits behind the pommel crest`).toBeLessThan(pommel.z);
      }
    }
  });

  it("restates the bone's seat in the spec's fixed `seat` and `seatFwd`", () => {
    // The spec's fixed `seat` (up) and `seatFwd` (forward) feed the nameplate,
    // chat bubble and pick heights and the seat a missing bone falls back to, so
    // both restate, to within 2 cm, where the bone puts the rider's root on the
    // frame the renderer sizes the model by (Idle at min(0.5 s, half its length)).
    // Measured there: (0.0279, 2.0581, 0.4818).
    const idle = clip('Idle');
    const seated = new Vector3().setFromMatrixPosition(
      riderRootAt(matricesAt(idle, Math.min(0.5, duration(idle) / 2))),
    );
    for (const key of ['drakemaw_raptor', 'referral_raptor'] as const) {
      const s = MOUNT_VISUAL_SPECS[key];
      expect(Math.abs(s.seat - seated.y), `${key} seat`).toBeLessThan(0.02);
      expect(Math.abs(s.seatFwd - seated.z), `${key} seatFwd`).toBeLessThan(0.02);
    }
  });
});
