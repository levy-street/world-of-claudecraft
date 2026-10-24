// The rebuilt wolf rig (scripts/assets/wolf_rig/): wolf_basic.glb (the pack wolves and
// the shaman Shadewolf form) and greyjaw.glb (Old Greyjaw) ship exactly the contract's
// joints and clips (scripts/assets/wolf_rig/contract.mjs), the hit reacts are real
// flinches, the loops close, the Idle stands still on its paws, every wolf keeps the
// on-screen size it has always had, and no clip either file ships puts any skinned
// point under the ground the game stands the wolf on. The skinning is the game's own
// glTF math (scripts/assets/wolf_rig/skin_pose.mjs) read off the shipped, compressed
// files, measured the way prepareVisual measures. ClipMap name resolution is
// tests/character_clipmaps.test.ts's; Greyjaw biting like the pack is
// tests/anim_pipeline_greyjaw.test.ts's.
import { join } from 'node:path';
import type { Animation, Root } from '@gltf-transform/core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  WOLF_CLIPS,
  WOLF_FLOOR_TOLERANCE,
  WOLF_HIT_REACT_MAX_S,
  WOLF_JOINT_NAMES,
  WOLF_LOOPS,
  WOLF_ON_SCREEN_SCALE,
  WOLF_ON_SCREEN_TOLERANCE,
  WOLF_RIG_FILES,
} from '../scripts/assets/wolf_rig/contract.mjs';
import {
  clipDuration,
  idleGround,
  idleHeight,
  localPose,
  lowestByRegion,
  readWolfGlb,
  rigOf,
  skinnedBoundsY,
  type WolfRig,
  worldUpFor,
} from '../scripts/assets/wolf_rig/skin_pose.mjs';
import { VISUALS } from '../src/render/characters/manifest';

const PUBLIC = join(__dirname, '..', 'public');
// Skinning every key of every clip of both files: seconds, not milliseconds.
const SKINNING_TIMEOUT_MS = 60_000;

function clip(root: Root, name: string): Animation {
  const anim = root.listAnimations().find((a) => a.getName() === name);
  if (!anim) throw new Error(`no clip ${name}`);
  return anim;
}

/** Every key time of a clip, all channels together, in order. */
function keyTimes(anim: Animation): number[] {
  const times = new Set<number>();
  for (const ch of anim.listChannels()) {
    for (const t of ch.getSampler()?.getInput()?.getArray() ?? []) times.add(t);
  }
  return [...times].sort((a, b) => a - b);
}

/** The deepest any skinned point goes under the ground over a clip, at every key
 *  (positive = under). */
function deepestDip(rig: WolfRig, anim: Animation, ground: number) {
  let dip = Number.NEGATIVE_INFINITY;
  let at = 0;
  const unbound = new Set<string>();
  for (const t of keyTimes(anim)) {
    const pose = localPose(rig, anim, t);
    for (const name of pose.unbound) unbound.add(name);
    const low = Math.min(...Object.values(lowestByRegion(rig, pose.local)));
    if (ground - low > dip) {
      dip = ground - low;
      at = t;
    }
  }
  return { dip, at, unbound: [...unbound] };
}

function turnDeg(a: number[], b: number[]): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

const loaded = new Map<string, Root>();
beforeAll(async () => {
  for (const file of WOLF_RIG_FILES) {
    loaded.set(file, await readWolfGlb(join(PUBLIC, file)));
  }
});

describe.each(WOLF_RIG_FILES)('wolf rig: %s', (file) => {
  const root = () => loaded.get(file) as Root;

  it('skins the body with exactly the contract joints, and no jaw', () => {
    const skins = root().listSkins();
    expect(skins).toHaveLength(1);
    const joints = skins[0].listJoints().map((j) => j.getName());
    expect([...joints].sort()).toEqual([...WOLF_JOINT_NAMES].sort());
    expect(joints.filter((name) => /jaw|chin/i.test(name))).toEqual([]);
  });

  it('ships exactly the contract clips, each keyed from the first frame', () => {
    const anims = root().listAnimations();
    expect(anims.map((a) => a.getName()).sort()).toEqual([...WOLF_CLIPS].sort());
    for (const anim of anims) expect(keyTimes(anim)[0], anim.getName()).toBe(0);
  });

  it('flinches on a hit instead of barking for seconds', () => {
    for (const name of ['Idle_HitReact_Left', 'Idle_HitReact_Right']) {
      const dur = clipDuration(clip(root(), name));
      expect(dur, name).toBeGreaterThan(0.2);
      expect(dur, name).toBeLessThanOrEqual(WOLF_HIT_REACT_MAX_S);
    }
  });

  it('closes every loop: the last pose is the first', () => {
    const rig = rigOf(root());
    for (const name of WOLF_LOOPS) {
      const anim = clip(root(), name);
      const first = localPose(rig, anim, 0).local;
      const last = localPose(rig, anim, clipDuration(anim)).local;
      for (const [node, pose] of first) {
        const end = last.get(node);
        if (!end) throw new Error(`${name}: no end pose for ${node.getName()}`);
        expect(turnDeg(pose.r, end.r), `${name} ${node.getName()} turn`).toBeLessThan(0.25);
        const shift = Math.hypot(...pose.t.map((v, k) => v - end.t[k]));
        expect(shift, `${name} ${node.getName()} shift`).toBeLessThan(0.001);
      }
    }
  });

  it('stands the Idle still on its paws, so the game grounds it the same at any moment', () => {
    // prepareVisual grounds the model by one Idle pose; a bobbing idle (the old rig's
    // lowest point wandered over 3 cm) would float or sink every other frame of it
    const rig = rigOf(root());
    const idle = clip(root(), 'Idle');
    const lows = keyTimes(idle).map((t) => skinnedBoundsY(rig, localPose(rig, idle, t).local).min);
    expect(Math.max(...lows) - Math.min(...lows)).toBeLessThan(0.002);
  });

  it(
    'never puts the skin under the ground the game stands the wolf on',
    () => {
      const rig = rigOf(root());
      const ground = idleGround(rig, root());
      for (const name of WOLF_CLIPS) {
        const { dip, at } = deepestDip(rig, clip(root(), name), ground);
        expect(
          dip,
          `${name} dips ${dip.toFixed(3)} under the ground at ${at.toFixed(2)} s`,
        ).toBeLessThan(WOLF_FLOOR_TOLERANCE);
      }
    },
    SKINNING_TIMEOUT_MS,
  );
});

describe('wolf rig: on-screen size', () => {
  it.each(Object.entries(WOLF_ON_SCREEN_SCALE))(
    '%s keeps the size it has always been drawn at',
    (key, pinned) => {
      const def = VISUALS[key];
      expect(def.url).toBe(pinned.file);
      const root = loaded.get(pinned.file) as Root;
      const scale = def.height / idleHeight(rigOf(root), root);
      expect(Math.abs(scale / pinned.scale - 1)).toBeLessThan(WOLF_ON_SCREEN_TOLERANCE);
    },
  );

  it('draws the Shadewolf as large as the pack wolf it shares a file with', () => {
    expect(VISUALS.form_ghost_wolf.url).toBe(VISUALS.mob_wolf.url);
    expect(VISUALS.form_ghost_wolf.height).toBe(VISUALS.mob_wolf.height);
  });
});

describe('wolf rig: the floor check itself', () => {
  it('catches a body sunk into the ground', () => {
    const root = loaded.get('models/creatures/wolf_basic.glb') as Root;
    const rig = rigOf(root);
    const ground = idleGround(rig, root);
    const idle = clip(root, 'Idle');
    const { local } = localPose(rig, idle, 0);
    const pelvis = rig.byName.get('Pelvis');
    if (!pelvis) throw new Error('no Pelvis');
    const pose = local.get(pelvis);
    if (!pose) throw new Error('no Pelvis pose');
    const before = Math.min(...Object.values(lowestByRegion(rig, local)));
    const up = worldUpFor(rig, 'Pelvis');
    const sink = 2 * WOLF_FLOOR_TOLERANCE;
    pose.t = pose.t.map((v, k) => v - up[k] * sink);
    const low = Math.min(...Object.values(lowestByRegion(rig, local)));
    expect(before - low).toBeCloseTo(sink, 4);
    expect(ground - low).toBeGreaterThan(WOLF_FLOOR_TOLERANCE);
  });
});
