// The Masterless Strength's clips, read off the shipped GLB. final_body_core.ts states the
// beats the bars, the transformation and the arrival time against (FINAL_BODY_CLIP) and where
// the heart and the eyes sit on its knee (FINAL_BODY_KNEEL_ANCHORS); this suite poses the real
// rig and checks each one, so a re-export that moved a strike, shortened a clip or changed
// the kneel fails here, before a bar, a burst or the heart's glow drifts off the body.

import type { Node as GltfNode, Root } from '@gltf-transform/core';
import { MeshoptDecoder } from 'meshoptimizer';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { createGlbIO, indexClip, sampleChannel } from '../scripts/anim/pose_blend.mjs';
import { MASTERLESS_STRENGTH_URL } from '../src/render/characters/smith_heart_boss_looks';
import { ARRIVAL } from '../src/render/smith_heart_fx/final_arrival_core';
import {
  FINAL_BODY_ANCHORS,
  FINAL_BODY_CLIP,
  FINAL_BODY_KNEEL_ANCHORS,
  FINAL_BODY_SOCKETS,
  type FinalBodyKneelAnchor,
  finalBodyKneelPoint,
  finalBodyPoint,
} from '../src/render/smith_heart_fx/final_body_core';
import { deathKneel } from '../src/render/smith_heart_fx/final_death_core';

const FRAME = 1 / 30;

type ClipIndex = Map<string, Parameters<typeof sampleChannel>[0]>;

let root: Root;
let nodes: Map<string, GltfNode>;
const clips = new Map<string, ClipIndex>();

function clip(name: string): ClipIndex {
  let idx = clips.get(name);
  if (!idx) {
    idx = indexClip(root, name) as ClipIndex;
    clips.set(name, idx);
  }
  return idx;
}

/** A bone's world matrix with `name` posed at `t` seconds (the model's own units). */
function world(bone: string, name: string, t: number): Matrix4 {
  const idx = clip(name);
  const chain: GltfNode[] = [];
  for (let p = nodes.get(bone) ?? null; p; p = p.getParentNode()) chain.unshift(p);
  expect(chain.length, `bone ${bone}`).toBeGreaterThan(0);
  const m = new Matrix4();
  for (const b of chain) {
    const at = (path: string, rest: number[]): number[] => {
      const ch = idx.get(`${b.getName()}|${path}`);
      return ch ? sampleChannel(ch, t) : rest;
    };
    m.multiply(
      new Matrix4().compose(
        new Vector3().fromArray(at('translation', b.getTranslation())),
        new Quaternion().fromArray(at('rotation', b.getRotation())),
        new Vector3().fromArray(at('scale', b.getScale())),
      ),
    );
  }
  return m;
}

const at = (bone: string, name: string, t: number) =>
  new Vector3().setFromMatrixPosition(world(bone, name, t));

function clipLength(name: string): number {
  let last = 0;
  for (const ch of clip(name).values()) last = Math.max(last, ch.times[ch.times.length - 1]);
  return last;
}

/** The lowest (or highest) a bone gets on an axis over a whole clip, frame by frame. */
function extreme(bone: string, name: string, axis: 'y' | 'z', pick: 'min' | 'max'): number {
  let best = pick === 'min' ? Infinity : -Infinity;
  const frames = Math.round(clipLength(name) / FRAME);
  for (let f = 0; f <= frames; f++) {
    const v = at(bone, name, f * FRAME)[axis];
    best = pick === 'min' ? Math.min(best, v) : Math.max(best, v);
  }
  return best;
}

/** The bound mesh's height on the Idle's first pose: what the renderer draws
 *  FINAL_BODY_HEIGHT tall, so what the anchors' fractions are fractions of. */
function idleHeight(): number {
  const body = nodes.get('Body_Four');
  const skin = body?.getSkin();
  const mesh = body?.getMesh();
  const ibm = skin?.getInverseBindMatrices();
  if (!skin || !mesh || !ibm) throw new Error('Body_Four has no skinned mesh');
  const mats = skin
    .listJoints()
    .map((j, i) =>
      world(j.getName(), 'Idle', 0).multiply(new Matrix4().fromArray(ibm.getElement(i, []))),
    );
  let lo = Infinity;
  let hi = -Infinity;
  const p: number[] = [];
  const j: number[] = [];
  const w: number[] = [];
  const v = new Vector3();
  for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute('POSITION');
    const J = prim.getAttribute('JOINTS_0');
    const W = prim.getAttribute('WEIGHTS_0');
    if (!P || !J || !W) throw new Error('Body_Four is not skinned');
    for (let i = 0; i < P.getCount(); i++) {
      P.getElement(i, p);
      J.getElement(i, j);
      W.getElement(i, w);
      let y = 0;
      for (let k = 0; k < 4; k++)
        if (w[k] > 0) y += v.set(p[0], p[1], p[2]).applyMatrix4(mats[j[k]]).y * w[k];
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
  }
  return hi - lo;
}

const BONE: Record<FinalBodyKneelAnchor, string> = { heart: 'Chest', head: 'Head' };

/** A standing anchor carried by its bone into `name` at `t`: [forward, left, up] as
 *  fractions of the drawn height (the model faces +z, its left is +x). */
function carried(anchor: FinalBodyKneelAnchor, height: number, name: string, t: number): number[] {
  const [f, l, u] = FINAL_BODY_ANCHORS[anchor];
  const p = new Vector3(l * height, u * height, f * height)
    .applyMatrix4(world(BONE[anchor], 'Idle', 0).invert())
    .applyMatrix4(world(BONE[anchor], name, t));
  return [p.z / height, p.x / height, p.y / height];
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
  root = (await createGlbIO().read(`public/${MASTERLESS_STRENGTH_URL}`)).getRoot();
  nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
});

describe("the Masterless Strength's clips land on the beats the game times", () => {
  it('ships the Shift and the Rise at the lengths the scenes run on', () => {
    expect(clipLength('Shift')).toBeCloseTo(FINAL_BODY_CLIP.shiftLength, 2);
    expect(clipLength('Rise')).toBeCloseTo(FINAL_BODY_CLIP.riseLength, 2);
    expect(ARRIVAL.riseSeconds).toBe(FINAL_BODY_CLIP.riseLength);
    for (const beat of ['attack', 'slam', 'wrath', 'pour', 'shiftBurst'] as const)
      expect(FINAL_BODY_CLIP[beat]).toBeGreaterThan(0);
    expect(FINAL_BODY_CLIP.attack).toBeLessThan(clipLength('Attack'));
    expect(FINAL_BODY_CLIP.slam).toBeLessThan(clipLength('Slam'));
    expect(FINAL_BODY_CLIP.wrath).toBeLessThan(clipLength('Wrath'));
    expect(FINAL_BODY_CLIP.pour).toBeLessThan(clipLength('Pour'));
  });

  it('brings the fist to the floor on the Attack, the Slam and the Wrath beats', () => {
    const strikes = [
      { name: 'Attack', beat: FINAL_BODY_CLIP.attack, hands: ['Hand.R'] },
      { name: 'Slam', beat: FINAL_BODY_CLIP.slam, hands: ['Hand.L', 'Hand.R'] },
      { name: 'Wrath', beat: FINAL_BODY_CLIP.wrath, hands: ['Hand.L', 'Hand.R'] },
    ];
    for (const s of strikes)
      for (const hand of s.hands) {
        const label = `${s.name} ${hand}`;
        const low = extreme(hand, s.name, 'y', 'min');
        // On the beat the hand is at the lowest it ever gets in the clip;
        // three frames earlier it is still high over the floor.
        expect(at(hand, s.name, s.beat).y, label).toBeLessThan(low + 0.02);
        expect(at(hand, s.name, s.beat - 3 * FRAME).y, label).toBeGreaterThan(low + 1);
      }
  });

  it('sweeps the second blow across the floor on the same beat, with the other fist', () => {
    const beat = FINAL_BODY_CLIP.attack;
    expect(clipLength('Attack2')).toBeCloseTo(clipLength('Attack'), 2);
    // The left fist is down on the beat, and was wound up high three frames before.
    const low = extreme('Hand.L', 'Attack2', 'y', 'min');
    expect(at('Hand.L', 'Attack2', beat).y).toBeLessThan(low + 0.03);
    expect(at('Hand.L', 'Attack2', beat - 3 * FRAME).y).toBeGreaterThan(low + 0.6);
    // A sweep, not a second hammer: it crosses the front from its right to its left, low.
    const before = at('Hand.L', 'Attack2', beat - FRAME);
    const after = at('Hand.L', 'Attack2', beat + 3 * FRAME);
    expect(after.x - before.x).toBeGreaterThan(0.25);
    expect(after.y).toBeLessThan(at('Hand.L', 'Idle', 0).y * 0.5);
    // And it is the other arm's blow: on the beat each clip's striking fist is the one out ahead.
    const lead = (clip: string) => at('Hand.L', clip, beat).z - at('Hand.R', clip, beat).z;
    expect(lead('Attack2')).toBeGreaterThan(0.4);
    expect(lead('Attack')).toBeLessThan(-0.4);
  });

  it('hurls the Pour on its beat: the hands cocked back, then thrown out ahead', () => {
    for (const hand of ['Hand.L', 'Hand.R']) {
      const far = extreme(hand, 'Pour', 'z', 'max');
      expect(at(hand, 'Pour', FINAL_BODY_CLIP.pour).z, hand).toBeGreaterThan(far - 0.05);
      expect(at(hand, 'Pour', FINAL_BODY_CLIP.pour - 5 * FRAME).z, hand).toBeLessThan(far - 0.7);
    }
  });

  it('bursts the Shift open on its beat: arms folded tight, then flung wide', () => {
    const spread = (t: number) => at('Hand.L', 'Shift', t).x - at('Hand.R', 'Shift', t).x;
    const burst = FINAL_BODY_CLIP.shiftBurst;
    const idle = at('Hand.L', 'Idle', 0).x - at('Hand.R', 'Idle', 0).x;
    expect(spread(burst - 2 * FRAME)).toBeLessThan(idle * 0.4);
    expect(spread(burst + FRAME)).toBeGreaterThan(idle * 1.2);
  });
});

describe("the Masterless Strength's Channel (Call of the Quarters)", () => {
  const BONES = [
    'Hips',
    'Spine',
    'Chest',
    'Neck',
    'Head',
    'UpperArm.L',
    'UpperArm.R',
    'ForeArm.L',
    'ForeArm.R',
    'Hand.L',
    'Hand.R',
    'Thigh.L',
    'Thigh.R',
    'Foot.L',
    'Foot.R',
  ];

  it('is a seamless loop: it ends in the pose it starts in', () => {
    const length = clipLength('Channel');
    expect(length).toBeGreaterThan(2);
    for (const bone of BONES) {
      const first = world(bone, 'Channel', 0).elements;
      const last = world(bone, 'Channel', length).elements;
      for (let i = 0; i < 16; i++)
        expect(Math.abs(first[i] - last[i]), `${bone}[${i}]`).toBeLessThan(0.004);
    }
  });

  it('stands planted through the whole call: neither foot moves', () => {
    const length = clipLength('Channel');
    for (const foot of ['Foot.L', 'Foot.R']) {
      const home = at(foot, 'Channel', 0);
      for (let t = 0; t <= length; t += FRAME)
        expect(at(foot, 'Channel', t).distanceTo(home), `${foot} at ${t.toFixed(2)}`).toBeLessThan(
          0.01,
        );
    }
  });

  it('charges: both fists hauled up and wide off a low brace, then driven back down', () => {
    const length = clipLength('Channel');
    for (const hand of ['Hand.L', 'Hand.R']) {
      const low = at(hand, 'Channel', 0);
      let high = low;
      let highAt = 0;
      for (let t = 0; t <= length; t += FRAME) {
        const p = at(hand, 'Channel', t);
        if (p.y > high.y) {
          high = p;
          highAt = t;
        }
      }
      // A real haul (the body stands about 2.2 tall), wider at the top than braced.
      expect(high.y - low.y, hand).toBeGreaterThan(0.35);
      expect(Math.abs(high.x), hand).toBeGreaterThan(Math.abs(low.x));
      // A long gather and a fast drop: the top comes late in the loop, and the
      // fists are back down well before it ends.
      expect(highAt / length, hand).toBeGreaterThan(0.5);
      expect(at(hand, 'Channel', length - 12 * FRAME).y - low.y, hand).toBeLessThan(0.05);
    }
    // Braced it is lower than it stands; hauling, its chest comes up.
    const braced = at('Chest', 'Channel', 0).y;
    expect(braced).toBeLessThan(at('Chest', 'Idle', 0).y - 0.1);
    expect(extreme('Chest', 'Channel', 'y', 'max') - braced).toBeGreaterThan(0.08);
  });

  it('is nothing like the throw it replaced: its fists never fly out ahead', () => {
    const reach = extreme('Hand.R', 'Pour', 'z', 'max');
    expect(extreme('Hand.R', 'Channel', 'z', 'max')).toBeLessThan(reach - 0.3);
    expect(extreme('Hand.L', 'Channel', 'z', 'max')).toBeLessThan(reach - 0.3);
  });
});

describe("the Masterless Strength's anchors follow it onto its knee", () => {
  it('keeps the kneeling heart and eyes where the rig puts them', () => {
    const height = idleHeight();
    expect(height).toBeGreaterThan(2);
    for (const anchor of ['heart', 'head'] as const) {
      const knelt = FINAL_BODY_KNEEL_ANCHORS[anchor];
      // Dormant is the still knee; KneelIdle breathes round it.
      const dormant = carried(anchor, height, 'Dormant', 0);
      for (let i = 0; i < 3; i++)
        expect(Math.abs(dormant[i] - knelt[i]), `${anchor}[${i}]`).toBeLessThan(0.015);
      const breath = carried(anchor, height, 'KneelIdle', 1);
      for (let i = 0; i < 3; i++) expect(Math.abs(breath[i] - knelt[i])).toBeLessThan(0.03);
      // The kneel is a real drop and a fold forward, not the standing anchor scaled.
      expect(knelt[2]).toBeLessThan(FINAL_BODY_ANCHORS[anchor][2] * 0.65);
      expect(knelt[0]).toBeGreaterThan(FINAL_BODY_ANCHORS[anchor][0]);
    }
    // The chest folds further down than the head: one height share cannot place both.
    const heartShare = FINAL_BODY_KNEEL_ANCHORS.heart[2] / FINAL_BODY_ANCHORS.heart[2];
    const headShare = FINAL_BODY_KNEEL_ANCHORS.head[2] / FINAL_BODY_ANCHORS.head[2];
    expect(headShare - heartShare).toBeGreaterThan(0.08);
  });

  it('hangs each socket on a real bone, at the offset its standing anchor has there', () => {
    const height = idleHeight();
    expect(FINAL_BODY_SOCKETS.map((s) => s.id).sort()).toEqual(['head', 'heart']);
    for (const s of FINAL_BODY_SOCKETS) {
      expect(nodes.has(s.bone), s.bone).toBe(true);
      expect(s.bone).toBe(BONE[s.id]);
      // The standing anchor in the bone's own frame on the Idle's first pose.
      const [f, l, u] = FINAL_BODY_ANCHORS[s.id];
      const local = new Vector3(l * height, u * height, f * height).applyMatrix4(
        world(s.bone, 'Idle', 0).invert(),
      );
      expect(Math.abs(local.x - s.local[0]), `${s.id} x`).toBeLessThan(0.01);
      expect(Math.abs(local.y - s.local[1]), `${s.id} y`).toBeLessThan(0.01);
      expect(Math.abs(local.z - s.local[2]), `${s.id} z`).toBeLessThan(0.01);
      // Riding its bone into the kneel, it lands on the kneeling anchor.
      const p = new Vector3(...s.local).applyMatrix4(world(s.bone, 'Dormant', 0));
      const knelt = FINAL_BODY_KNEEL_ANCHORS[s.id];
      expect(Math.abs(p.z / height - knelt[0]), `${s.id} forward`).toBeLessThan(0.015);
      expect(Math.abs(p.x / height - knelt[1]), `${s.id} left`).toBeLessThan(0.015);
      expect(Math.abs(p.y / height - knelt[2]), `${s.id} up`).toBeLessThan(0.015);
    }
  });

  it('folds the chest far off its standing place in the Shift (why the heart is a socket)', () => {
    const height = idleHeight();
    const heart = FINAL_BODY_SOCKETS.find((s) => s.id === 'heart');
    if (!heart) throw new Error('no heart socket');
    const upAt = (t: number) =>
      new Vector3(...heart.local).applyMatrix4(world(heart.bone, 'Shift', t)).y / height;
    // Folded tight in the charge the heart sits well under its standing anchor,
    // and the burst throws it open again: a fixed anchor would hang in the air.
    let low = Infinity;
    for (let t = 0; t < FINAL_BODY_CLIP.shiftBurst; t += FRAME) low = Math.min(low, upAt(t));
    expect(FINAL_BODY_ANCHORS.heart[2] - low).toBeGreaterThan(0.1);
    expect(upAt(FINAL_BODY_CLIP.shiftBurst + 3 * FRAME)).toBeGreaterThan(
      FINAL_BODY_ANCHORS.heart[2],
    );
  });

  it('drops on the Kneel and stands on the Rise at the beats the anchors ride', () => {
    const height = idleHeight();
    const up = FINAL_BODY_ANCHORS.heart[2];
    const down = FINAL_BODY_KNEEL_ANCHORS.heart[2];
    const heartUp = (name: string, t: number) => carried('heart', height, name, t)[2];
    // The Kneel: still on its feet as the drop starts, on its knee as it ends.
    expect(heartUp('Kneel', FINAL_BODY_CLIP.kneelDrop)).toBeGreaterThan(up - 0.03);
    expect(heartUp('Kneel', FINAL_BODY_CLIP.kneelDown)).toBeLessThan(down + 0.03);
    // Neither beat is early or late: falling just after the first, not yet down before the second.
    expect(heartUp('Kneel', FINAL_BODY_CLIP.kneelDrop + 4 * FRAME)).toBeLessThan(up - 0.03);
    expect(heartUp('Kneel', FINAL_BODY_CLIP.kneelDown - 3 * FRAME)).toBeGreaterThan(down + 0.03);
    expect(deathKneel(FINAL_BODY_CLIP.kneelDrop)).toBe(0);
    expect(deathKneel(FINAL_BODY_CLIP.kneelDown)).toBe(1);
    // Midway the anchor is with the falling chest, not ahead of it.
    const mid = (FINAL_BODY_CLIP.kneelDrop + FINAL_BODY_CLIP.kneelDown) / 2;
    const midUp = up + (down - up) * deathKneel(mid);
    expect(Math.abs(heartUp('Kneel', mid) - midUp)).toBeLessThan(0.08);
    // The Rise: still down as the push starts, standing as it ends.
    expect(heartUp('Rise', FINAL_BODY_CLIP.risePush)).toBeLessThan(down + 0.03);
    expect(heartUp('Rise', FINAL_BODY_CLIP.riseStood)).toBeGreaterThan(up - 0.03);
    expect(heartUp('Rise', FINAL_BODY_CLIP.risePush + 9 * FRAME)).toBeGreaterThan(down + 0.03);
    expect(heartUp('Rise', FINAL_BODY_CLIP.riseStood - 6 * FRAME)).toBeLessThan(up - 0.03);
    expect(FINAL_BODY_CLIP.riseStood).toBeLessThan(FINAL_BODY_CLIP.riseLength);
  });

  it('slides an anchor between its standing and kneeling places', () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    // Standing, it is the standing anchor exactly, at any facing.
    finalBodyKneelPoint('heart', 0, 3, 1, -2, 0.7, 20, a);
    finalBodyPoint('heart', 3, 1, -2, 0.7, 20, b);
    expect(a).toEqual(b);
    // Knelt and facing +z: forward is +z, the body's left is +x.
    finalBodyKneelPoint('heart', 1, 0, 0, 0, 0, 20, a);
    expect(a.z).toBeCloseTo(20 * FINAL_BODY_KNEEL_ANCHORS.heart[0], 6);
    expect(a.x).toBeCloseTo(20 * FINAL_BODY_KNEEL_ANCHORS.heart[1], 6);
    expect(a.y).toBeCloseTo(20 * FINAL_BODY_KNEEL_ANCHORS.heart[2], 6);
    // Halfway is the midpoint; past either end it holds the end.
    finalBodyKneelPoint('head', 0.5, 0, 0, 0, 0, 20, a);
    const mid = (FINAL_BODY_ANCHORS.head[2] + FINAL_BODY_KNEEL_ANCHORS.head[2]) / 2;
    expect(a.y).toBeCloseTo(20 * mid, 6);
    finalBodyKneelPoint('head', 4, 0, 0, 0, 0, 20, a);
    expect(a.y).toBeCloseTo(20 * FINAL_BODY_KNEEL_ANCHORS.head[2], 6);
    finalBodyKneelPoint('head', -1, 0, 0, 0, 0, 20, a);
    expect(a.y).toBeCloseTo(20 * FINAL_BODY_ANCHORS.head[2], 6);
  });
});
