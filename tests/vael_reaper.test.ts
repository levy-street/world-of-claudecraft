// Vael the Fogbinder as Death (scripts/assets/sunken_bastion_creatures/reaper.py):
// the great scythe is held, never spun. It is modelled IN the right fist and
// parented to Hand.R, so every swing is carried by the shoulder, the elbow, the
// spine and the floating body; the off hand closes round the snath for the heavy
// blows. These pins decode the shipped GLB the way the game loads it (meshopt).

import { readFileSync } from 'node:fs';
import { type Node as GltfNode, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import type { Entity } from '../src/sim/types';

const GLB = 'public/models/creatures/vael_reaper.glb';
const FPS = 24;

async function readGlb() {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io.read(GLB);
}

type Doc = Awaited<ReturnType<typeof readGlb>>;

/** The angle (degrees) between two unit quaternions [x, y, z, w]. */
function quatAngleDeg(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

function node(doc: Doc, name: string): GltfNode {
  const n = doc
    .getRoot()
    .listNodes()
    .find((x) => x.getName() === name);
  if (!n) throw new Error(`no node ${name}`);
  return n;
}

/** Samples one clip at `t` seconds and returns each node's world matrix. */
function worldAt(doc: Doc, clipName: string, t: number): Map<GltfNode, THREE.Matrix4> {
  const clip = doc
    .getRoot()
    .listAnimations()
    .find((a) => a.getName() === clipName);
  if (!clip) throw new Error(`no clip ${clipName}`);
  const trs = new Map<GltfNode, { t: number[]; r: number[]; s: number[] }>();
  for (const n of doc.getRoot().listNodes())
    trs.set(n, { t: n.getTranslation(), r: n.getRotation(), s: n.getScale() });
  for (const ch of clip.listChannels()) {
    const target = ch.getTargetNode();
    const sampler = ch.getSampler();
    const input = sampler?.getInput();
    const output = sampler?.getOutput();
    if (!target || !input || !output) continue;
    const path = ch.getTargetPath();
    if (path !== 'translation' && path !== 'rotation' && path !== 'scale') continue;
    const times: number[] = [];
    for (let i = 0; i < input.getCount(); i++) times.push(input.getScalar(i));
    let i = 0;
    while (i < times.length - 1 && times[i + 1] <= t) i++;
    const j = Math.min(times.length - 1, i + 1);
    const span = times[j] - times[i];
    const k = span > 0 ? Math.min(1, Math.max(0, (t - times[i]) / span)) : 0;
    const a = output.getElement(i, []);
    const b = output.getElement(j, []);
    const slot = trs.get(target);
    if (!slot) continue;
    if (path === 'rotation') {
      const qa = new THREE.Quaternion(a[0], a[1], a[2], a[3]).normalize();
      const qb = new THREE.Quaternion(b[0], b[1], b[2], b[3]).normalize();
      const q = qa.slerp(qb, k);
      slot.r = [q.x, q.y, q.z, q.w];
    } else {
      const v = a.map((x, n) => x + (b[n] - x) * k);
      if (path === 'translation') slot.t = v;
      else slot.s = v;
    }
  }
  const world = new Map<GltfNode, THREE.Matrix4>();
  const visit = (n: GltfNode, parent: THREE.Matrix4) => {
    const p = trs.get(n);
    if (!p) return;
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(p.t[0], p.t[1], p.t[2]),
      new THREE.Quaternion(p.r[0], p.r[1], p.r[2], p.r[3]),
      new THREE.Vector3(p.s[0], p.s[1], p.s[2]),
    );
    const m = parent.clone().multiply(local);
    world.set(n, m);
    for (const c of n.listChildren()) visit(c, m);
  };
  for (const scene of doc.getRoot().listScenes())
    for (const n of scene.listChildren()) visit(n, new THREE.Matrix4());
  return world;
}

/** Where the left wrist sits against the scythe's shaft at `t` into `clip`:
 *  its distance off the shaft line and how far along it (from the right grip,
 *  positive toward the blade). */
function offHandOnShaft(doc: Doc, clip: string, t: number): { off: number; along: number } {
  const w = worldAt(doc, clip, t);
  const scythe = w.get(node(doc, 'Scythe'));
  const hand = w.get(node(doc, 'Hand.L'));
  if (!scythe || !hand) throw new Error('missing bones');
  const grip = new THREE.Vector3().setFromMatrixPosition(scythe);
  // A bone's own +Y runs head to tail: the Scythe bone runs up the shaft.
  const axis = new THREE.Vector3(0, 1, 0).transformDirection(scythe);
  const wrist = new THREE.Vector3().setFromMatrixPosition(hand);
  const rel = wrist.sub(grip);
  const along = rel.dot(axis);
  const off = rel.sub(axis.multiplyScalar(along)).length();
  return { off, along };
}

const def = VISUALS[visualKeyFor({ kind: 'mob', templateId: 'vael_the_mistcaller' } as Entity)];

describe('Vael, Death itself: his body and clips', () => {
  it('draws the Blender reaper for Vael and for his shadow copies alike', () => {
    expect(def.url).toBe('models/creatures/vael_reaper.glb');
    expect(visualKeyFor({ kind: 'mob', templateId: 'vael_fog_shade' } as Entity)).toBe(
      visualKeyFor({ kind: 'mob', templateId: 'vael_the_mistcaller' } as Entity),
    );
  });

  it('stays a single skinned body inside the boss budget', async () => {
    expect(readFileSync(GLB).length).toBeLessThan(2_500_000);
    const doc = await readGlb();
    expect(doc.getRoot().listSkins().length).toBe(1);
  });

  it('ships every clip the look maps', async () => {
    const doc = await readGlb();
    const names = new Set(
      doc
        .getRoot()
        .listAnimations()
        .map((a) => a.getName()),
    );
    const c = def.clips;
    const mapped = [
      c.idle,
      c.walk,
      c.run,
      c.death,
      c.cast,
      c.flourish,
      ...(c.attack ?? []),
      ...(c.hit ?? []),
      ...Object.values(c.castByAbility ?? {}),
    ].filter((x): x is string => typeof x === 'string');
    expect(mapped.length).toBeGreaterThanOrEqual(12);
    for (const clip of mapped) expect(names.has(clip), clip).toBe(true);
    for (const clip of [
      'Idle',
      'Walk',
      'Run',
      'Attack',
      'Attack2',
      'Cast',
      'Hymn',
      'Vanish',
      'Emerge',
      'ScytheSweep',
      'Hit',
      'Death',
    ])
      expect(names.has(clip), clip).toBe(true);
  });
});

describe('Vael, Death itself: the scythe stays in his fist', () => {
  // A Scythe bone that turns against Hand.R is the weapon swinging on its own
  // against the hand and arm. Every key of every clip must hold the rest turn.
  it('never turns the scythe against the hand, in any clip', async () => {
    const doc = await readGlb();
    const scythe = node(doc, 'Scythe');
    expect(scythe.getParentNode()?.getName()).toBe('Hand.R');
    const rest = scythe.getRotation();
    const clips = doc.getRoot().listAnimations();
    expect(clips.length).toBeGreaterThanOrEqual(12);
    let checked = 0;
    for (const clip of clips) {
      for (const ch of clip.listChannels()) {
        if (ch.getTargetNode() !== scythe || ch.getTargetPath() !== 'rotation') continue;
        const out = ch.getSampler()?.getOutput();
        if (!out) continue;
        for (let i = 0; i < out.getCount(); i++) {
          const q = out.getElement(i, []);
          const len = Math.hypot(q[0], q[1], q[2], q[3]);
          const unit = q.map((v) => v / len);
          expect(quatAngleDeg(unit, rest), `${clip.getName()} key ${i}`).toBeLessThan(3);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('closes the off hand round the snath at every heavy blow', async () => {
    const doc = await readGlb();
    // the contact beats: the sweep's cut, the chop, the flourish off the pool,
    // and the wind-up he rises out of the pool with
    for (const [clip, frame] of [
      ['Attack', 13],
      ['Attack2', 15],
      ['ScytheSweep', 4],
      ['Emerge', 15],
    ] as const) {
      const { off, along } = offHandOnShaft(doc, clip, (frame - 1) / FPS);
      expect(off, `${clip} wrist off the shaft`).toBeLessThan(0.45);
      // the off hand rides the snath below the right fist, above the pommel
      expect(along, `${clip} grip along the shaft`).toBeLessThan(-0.6);
      expect(along, `${clip} grip along the shaft`).toBeGreaterThan(-1.7);
    }
  });

  it('leaves the off hand free while he holds the scythe at rest', async () => {
    const doc = await readGlb();
    const { off } = offHandOnShaft(doc, 'Idle', 0.5);
    expect(off).toBeGreaterThan(1.0);
  });
});
