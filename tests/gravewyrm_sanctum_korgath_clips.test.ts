// Korgath the Bound's grip and his maul blows (the owner's 2026-10-20 notes:
// the blows looked wrong, even how he held the maul in his palm; then: one hand
// only, the hand that holds the maul).
// - The body is modeled with the right fist closed on the haft, but every one
//   of its clips bent that fist's single finger bone 88 degrees (176 in the
//   gaits), folding the fingers off the haft: the look drops that rotation
//   from every body clip he holds the maul in (VisualDef.clipTrackDrops), and
//   the donor's clips keep the modeled fist.
// - HammerSlam and HammerSweep are one-handed swings re-authored on a control
//   rig (a clip donor beside the body): the right fist in its modeled grip
//   (sliding along the haft, never turned in it), the left arm a free
//   counterbalance that never touches the haft; both start and end on Idle's
//   first frame and land on frame 18 as before.
// - MaulArc, ThresholdCharge and its run loop brought the left hand to the haft:
//   the donor carries them with only the left arm re-solved off it.
// - The body file and its rig are the shipped ones (no bones added).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Animation, Document } from '@gltf-transform/core';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { keptTrackNames } from '../src/render/characters/clip_track_drops';
import { SANCTUM_BOSS_LOOKS } from '../src/render/characters/sanctum_boss_looks';
import {
  KORGATH_BODY,
  KORGATH_CLIP,
  KORGATH_CLIP_FIXES_URL,
  KORGATH_DONOR_CLIPS,
  KORGATH_FIST_BONE,
  KORGATH_FIST_DROPS,
} from '../src/render/gravewyrm_sanctum_bosses/boss_model_core';
import { type PosedNode, posedNodes } from './helpers/posed_glb';

const AUTHORED = ['HammerSlam', 'HammerSweep'];
const LEFT_ONLY = ['MaulArc', 'ThresholdCharge', 'ThresholdChargeLoop'];
const LEFT_ARM = new Set([
  'upperarm.l',
  'lowerarm.l',
  'hand.l',
  'fingers.l',
  'handslot.l',
  'Anchor_Tongs',
  'chain_t.1',
  'chain_t.2',
]);
const BODY = `public/${KORGATH_BODY.url}`;
const DONOR = `public/${KORGATH_CLIP_FIXES_URL}`;
/** The maul head's centre on the haft and the haft's span (hammer bone units). */
const HEAD_Y = 1.28;
const HAFT = [-0.2, 1.1];

let body: Document;
let donor: Document;
let unit = 1;

async function read(path: string): Promise<Document> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io.readBinary(new Uint8Array(readFileSync(path)));
}

beforeAll(async () => {
  body = await read(BODY);
  donor = await read(DONOR);
  const rig = body
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === 'Korgath_Rig');
  unit = rig?.getScale()[0] ?? 1;
}, 60_000);

function clip(doc: Document, name: string): Animation {
  const a = doc
    .getRoot()
    .listAnimations()
    .find((x) => x.getName() === name);
  if (!a) throw new Error(`no ${name}`);
  return a;
}

function length(a: Animation): number {
  return Math.max(...a.listSamplers().map((s) => s.getInput()?.getMax([])[0] ?? 0));
}

function rotationAt(a: Animation, joint: string, t: number): number[] | null {
  const ch = a
    .listChannels()
    .find((c) => c.getTargetNode()?.getName() === joint && c.getTargetPath() === 'rotation');
  const inp = ch?.getSampler()?.getInput();
  const out = ch?.getSampler()?.getOutput();
  if (!inp || !out) return null;
  let k = 0;
  while (k < inp.getCount() - 1 && inp.getScalar(k + 1) <= t + 1e-6) k++;
  return out.getElement(k, []);
}

function angle(a: number[], b: number[]): number {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, d));
}

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: number[]) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Distance (yd) from a point to the maul's haft line. */
function offHaft(p: number[], hammer: PosedNode): number {
  const d = sub(p, hammer.pos);
  const along = dot(d, hammer.up);
  const q = sub(
    d,
    hammer.up.map((v) => v * along),
  );
  return Math.hypot(q[0], q[1], q[2]);
}

/** Distance (yd) from a point to the haft itself (pommel to the head's neck). */
function toHaft(p: number[], hammer: PosedNode): number {
  const d = sub(p, hammer.pos);
  const along = Math.min(HAFT[1] * unit, Math.max(HAFT[0] * unit, dot(d, hammer.up)));
  const q = sub(
    d,
    hammer.up.map((v) => v * along),
  );
  return Math.hypot(q[0], q[1], q[2]);
}

/** The maul's haft direction in the right hand's own frame (wrist to knuckles,
 *  wrist to the hand slot): which end of the haft the fist's thumb side holds. */
function haftInRightHand(n: Record<string, PosedNode>): number[] {
  const x = norm(sub(n['fingers.r'].pos, n['hand.r'].pos));
  const s = sub(n['handslot.r'].pos, n['hand.r'].pos);
  const y = norm(
    sub(
      s,
      x.map((v) => v * dot(s, x)),
    ),
  );
  const z = cross(x, y);
  return [dot(n.hammer.up, x), dot(n.hammer.up, y), dot(n.hammer.up, z)];
}

const NODES = ['hammer', 'hand.r', 'fingers.r', 'handslot.r', 'hand.l', 'hips', 'chest'];
const frames = (T: number, step = 2) =>
  Array.from({ length: Math.floor((T * 30) / step + 1e-6) + 1 }, (_, k) => (k * step) / 30);

describe("Korgath's grip", () => {
  it('ships the reviewed clip donor (re-pin with the ship script output)', () => {
    // The donor is authored in Blender outside the repo and shipped by
    // docs/design/dungeon-rework/korgath/ship_korgath_clip_fixes.mjs, so the
    // shipped file itself is pinned: a stray re-export fails here.
    const bytes = readFileSync(DONOR);
    expect(bytes.length).toBe(190404);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'dcf1a8c03f69d8d35a3fe92741f25a77f5947454c1442f0f01d28d3ebe2c8a24',
    );
  });

  it('keeps the shipped body and its rig (no bones added)', () => {
    const skin = body
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === 'Korgath')
      ?.getSkin();
    const names = (skin?.listJoints() ?? []).map((j) => j.getName());
    expect(names).toHaveLength(39);
    expect(names.some((n) => /^(index|middle|ring|pinky|thumb)\./.test(n))).toBe(false);
  });

  it('every body clip he holds the maul in drops the fist bone; the donor replaces the rest', () => {
    const look = SANCTUM_BOSS_LOOKS.sanctum_korgath;
    expect(look.clipTrackDrops).toBe(KORGATH_FIST_DROPS);
    expect(look.animUrls).toEqual([KORGATH_CLIP_FIXES_URL]);
    const bodyClips = body
      .getRoot()
      .listAnimations()
      .map((a) => a.getName())
      .sort();
    const covered = [...Object.keys(KORGATH_FIST_DROPS), ...KORGATH_DONOR_CLIPS].sort();
    expect(covered).toEqual(bodyClips);
    // on the track names three's loader gives the body's clips, the drop takes
    // the fist bone's rotation and nothing else
    const threeProp = {
      translation: 'position',
      rotation: 'quaternion',
      scale: 'scale',
      weights: 'morphTargetInfluences',
    } as const;
    for (const [name, bones] of Object.entries(KORGATH_FIST_DROPS)) {
      expect(bones).toEqual([KORGATH_FIST_BONE]);
      const tracks = clip(body, name)
        .listChannels()
        .map(
          (c) =>
            `${THREE.PropertyBinding.sanitizeNodeName(c.getTargetNode()?.getName() ?? '')}.${threeProp[c.getTargetPath() as keyof typeof threeProp]}`,
        );
      const kept = new Set(keptTrackNames(tracks, bones));
      expect(
        tracks.filter((t) => !kept.has(t)),
        name,
      ).toEqual(['fingersr.quaternion']);
    }
    // the body's clips really do bend it (what the drop removes)
    const rest = body
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === KORGATH_FIST_BONE)
      ?.getRotation() as number[];
    const idleCurl = rotationAt(clip(body, 'Idle'), KORGATH_FIST_BONE, 0) as number[];
    expect(angle(idleCurl, rest)).toBeGreaterThan(1.2);
    // and every donor clip but Death keeps the modeled fist the whole clip
    for (const name of KORGATH_DONOR_CLIPS.filter((c) => c !== 'Death')) {
      const a = clip(donor, name);
      for (const t of frames(length(a), 6))
        expect(
          angle(rotationAt(a, KORGATH_FIST_BONE, t) as number[], rest),
          `${name}@${t}`,
        ).toBeLessThan(0.01);
    }
  });

  it('the donor carries only clips, onto the body rig, at the body clips lengths', () => {
    const root = donor.getRoot();
    expect(root.listMeshes()).toHaveLength(0);
    expect(root.listTextures()).toHaveLength(0);
    expect(
      root
        .listAnimations()
        .map((a) => a.getName())
        .sort(),
    ).toEqual([...KORGATH_DONOR_CLIPS].sort());
    const names = new Set(
      body
        .getRoot()
        .listNodes()
        .map((n) => n.getName()),
    );
    for (const a of root.listAnimations()) {
      expect(length(a), a.getName()).toBeCloseTo(length(clip(body, a.getName())), 2);
      for (const ch of a.listChannels())
        expect(names.has(ch.getTargetNode()?.getName() ?? ''), a.getName()).toBe(true);
    }
  });

  it('Death keeps the right fist closed on the haft until the maul falls from it', () => {
    const rest = body
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === KORGATH_FIST_BONE)
      ?.getRotation() as number[];
    const d = clip(donor, 'Death');
    expect(angle(rotationAt(d, KORGATH_FIST_BONE, 0) as number[], rest)).toBeLessThan(0.01);
    expect(angle(rotationAt(d, KORGATH_FIST_BONE, length(d)) as number[], rest)).toBeGreaterThan(
      0.3,
    );
  });
});

describe("Korgath's one-handed blows", () => {
  it('keep their 1.5 s and start and end on Idle (the seams blend)', () => {
    const idle = clip(body, 'Idle');
    for (const name of AUTHORED) {
      const a = clip(donor, name);
      expect(length(a), name).toBeCloseTo(1.5, 2);
      for (const ch of a.listChannels()) {
        if (ch.getTargetPath() !== 'rotation') continue;
        const j = ch.getTargetNode()?.getName() ?? '';
        if (j === KORGATH_FIST_BONE) continue;
        const i0 = rotationAt(idle, j, 0);
        if (!i0) continue;
        for (const t of [0, length(a)])
          expect(angle(i0, rotationAt(a, j, t) as number[]), `${name} ${j}@${t}`).toBeLessThan(
            0.02,
          );
      }
    }
  });

  it('swing the maul in the right fist alone, in its modeled grip (never turned in the fist)', async () => {
    const idle = await posedNodes(BODY, 'Idle', 0, NODES);
    const grip = haftInRightHand(idle);
    const seat = offHaft(idle['hand.r'].pos, idle.hammer);
    for (const name of AUTHORED)
      for (const t of frames(1.5)) {
        const n = await posedNodes(DONOR, name, t, NODES);
        expect(dot(grip, haftInRightHand(n)), `${name} grip @${t}`).toBeGreaterThan(0.9);
        expect(
          Math.abs(offHaft(n['hand.r'].pos, n.hammer) - seat),
          `${name} seat @${t}`,
        ).toBeLessThan(0.1);
      }
  });

  it('never bring the left hand to the haft, and keep it on his left side', async () => {
    for (const name of [...AUTHORED, ...LEFT_ONLY]) {
      const T = length(clip(donor, name));
      for (const t of frames(T)) {
        const n = await posedNodes(DONOR, name, t, NODES);
        expect(
          toHaft(n['hand.l'].pos, n.hammer),
          `${name} left off the haft @${t}`,
        ).toBeGreaterThan(1.5);
        if (AUTHORED.includes(name)) {
          // glTF +X is his left, +Z ahead: the free hand stays out of his chest
          // (out to his left, or well ahead of it) and never goes behind his back
          const x = n['hand.l'].pos[0] - n.chest.pos[0];
          const z = n['hand.l'].pos[2] - n.chest.pos[2];
          expect(x > 1.0 || z > 1.5, `${name} left out of the chest @${t} (${x}, ${z})`).toBe(true);
          expect(z, `${name} left not behind the back @${t}`).toBeGreaterThan(-0.8);
        }
      }
    }
    // what the left-arm clips fix: the body's own clip brought the left hand to the haft
    for (const name of LEFT_ONLY) {
      let nearest = 99;
      for (const t of frames(length(clip(body, name)))) {
        const n = await posedNodes(BODY, name, t, NODES);
        nearest = Math.min(nearest, toHaft(n['hand.l'].pos, n.hammer));
      }
      expect(nearest, name).toBeLessThan(0.7);
    }
  });

  it('the left-arm clips change only the left arm, and the run loop still loops', () => {
    for (const name of LEFT_ONLY) {
      const a = clip(donor, name);
      const own = clip(body, name);
      for (const ch of a.listChannels()) {
        if (ch.getTargetPath() !== 'rotation') continue;
        const j = ch.getTargetNode()?.getName() ?? '';
        if (j === KORGATH_FIST_BONE || LEFT_ARM.has(j)) continue;
        for (const t of frames(length(a), 4))
          expect(
            angle(rotationAt(own, j, t) as number[], rotationAt(a, j, t) as number[]),
            `${name} ${j}@${t}`,
          ).toBeLessThan(0.05);
      }
    }
    // the run loop's left arm pumps in a closed cycle
    const loop = clip(donor, 'ThresholdChargeLoop');
    for (const j of ['upperarm.l', 'lowerarm.l', 'hand.l'])
      expect(
        angle(rotationAt(loop, j, 0) as number[], rotationAt(loop, j, length(loop)) as number[]),
        j,
      ).toBeLessThan(0.02);
  });

  it('land on frame 18: the slam on the terrace in front, the sweep across his front', async () => {
    expect(KORGATH_CLIP.slam).toBeCloseTo(17 / 30, 3);
    expect(KORGATH_CLIP.sweep).toBeCloseTo(17 / 30, 3);
    const at = async (name: string, t: number) => {
      const n = await posedNodes(DONOR, name, t, NODES);
      const head = n.hammer.pos.map((v, i) => v + n.hammer.up[i] * HEAD_Y * unit);
      return { head, hips: n.hips.pos };
    };
    // glTF axes: +Y up, he faces +Z, his left is +X
    const slam = await at('HammerSlam', KORGATH_CLIP.slam);
    expect(slam.head[1]).toBeLessThan(1.6);
    expect(slam.head[2] - slam.hips[2]).toBeGreaterThan(5);
    const before = await at('HammerSlam', KORGATH_CLIP.slam - 4 / 30);
    expect(before.head[1]).toBeGreaterThan(slam.head[1] + 3);
    const sweep = await at('HammerSweep', KORGATH_CLIP.sweep);
    expect(sweep.head[2] - sweep.hips[2]).toBeGreaterThan(4);
    expect(Math.abs(sweep.head[0] - sweep.hips[0])).toBeLessThan(2.5);
    const wound = await at('HammerSweep', KORGATH_CLIP.sweep - 3 / 30);
    const through = await at('HammerSweep', KORGATH_CLIP.sweep + 4 / 30);
    // right to left: from his right (-X) through his front to his left (+X)
    expect(wound.head[0]).toBeLessThan(sweep.head[0]);
    expect(through.head[0]).toBeGreaterThan(sweep.head[0] + 2);
  });
});
