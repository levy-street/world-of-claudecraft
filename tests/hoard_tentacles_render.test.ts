// The Abyssal Maw's tentacles on screen: the pure pose, the pooled instanced
// adapter, and the shipped Blender parts. The pin that matters most: the lane and
// the arm drawn are the lane and the arm that hit, and the tentacle reaches them.
import { existsSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ASSETS } from '../scripts/assets/tentacles/build.mjs';
import { VISUALS } from '../src/render/characters/manifest';
import { HoardBossFx } from '../src/render/hoard_boss_fx';
import { HoardTentaclesFx, TENTACLE_ASSET_URL } from '../src/render/hoard_tentacles';
import {
  LINK_STRIDE,
  linkBasis,
  makeTentaclePose,
  reachStretch,
  sweepSpeed,
  sweepTelegraph,
  TENTACLE_LOOK,
  type TentacleInput,
  tentaclePose,
  whipTelegraph,
  writeTentacleChain,
} from '../src/render/hoard_tentacles_core';
import {
  pointInWhip,
  SWEEP_TOTAL_SEC,
  sweepArmBearing,
  sweepPasses,
  sweepProgress,
  TENTACLE_TOTAL_SEC,
  TENTACLES,
  WHIP_TOTAL_SEC,
} from '../src/sim/rift/hoard_tentacles_core';
import type { HoardBossCueView } from '../src/world_api/dungeons';

const LINKS = TENTACLE_LOOK.links;
const STANDING = TENTACLES.spawnWarningSec + 3;

function input(more: Partial<TentacleInput> = {}): TentacleInput {
  return {
    index: 0,
    time: 0,
    elapsed: STANDING,
    facing: 0,
    attack: 0,
    attackElapsed: 0,
    attackFacing: 0,
    direction: 1,
    reachDistance: 0,
    holding: false,
    fall: -1,
    killed: false,
    still: true,
    ...more,
  };
}

function chainOf(from: TentacleInput) {
  const pose = tentaclePose(from, makeTentaclePose());
  const chain = new Float32Array(LINKS * LINK_STRIDE);
  const tip = new Float32Array(5);
  writeTentacleChain(from, pose, chain, tip);
  return { pose, chain, tip };
}

describe('the tentacle pose (pure)', () => {
  it('waits under the warning, then rises out of the floor and stands tall', () => {
    const waiting = tentaclePose(input({ elapsed: 0.4 }), makeTentaclePose());
    expect(waiting.warning).toBe(1);
    expect(waiting.grow).toBe(0);
    expect(waiting.rubble).toBe(0);
    const rising = tentaclePose(
      input({ elapsed: TENTACLES.spawnWarningSec + TENTACLE_LOOK.riseSec / 2 }),
      makeTentaclePose(),
    );
    expect(rising.grow).toBeGreaterThan(0.2);
    expect(rising.grow).toBeLessThan(0.8);
    expect(rising.rubble).toBe(1);
    const up = chainOf(input());
    expect(up.pose.grow).toBe(1);
    expect(up.pose.warning).toBe(0);
    // Taller than three players, leaning the way it faces, thinning to its tip.
    expect(up.tip[1]).toBeGreaterThan(6);
    expect(up.tip[2]).toBeGreaterThan(1);
    expect(up.chain[5]).toBeCloseTo(TENTACLE_LOOK.baseRadius, 1);
    expect(up.chain[(LINKS - 1) * LINK_STRIDE + 5]).toBeLessThan(0.45);
    for (let link = 1; link < LINKS; link++) {
      expect(up.chain[link * LINK_STRIDE + 5]).toBeLessThan(up.chain[(link - 1) * LINK_STRIDE + 5]);
    }
  });

  it('sways when it may, and holds dead still under reduced motion', () => {
    const a = chainOf(input({ still: false, time: 1 }));
    const b = chainOf(input({ still: false, time: 2.3 }));
    expect(Math.hypot(a.tip[0] - b.tip[0], a.tip[2] - b.tip[2])).toBeGreaterThan(0.2);
    const c = chainOf(input({ still: true, time: 1 }));
    const d = chainOf(input({ still: true, time: 2.3 }));
    expect([...c.chain]).toEqual([...d.chain]);
  });

  it('rears AWAY from its target, then lands along the whole lane the sim hits', () => {
    const facing = 1.1;
    const rear = chainOf(
      input({ attack: 1, attackFacing: facing, attackElapsed: TENTACLES.whipTelegraphSec * 0.9 }),
    );
    expect(rear.pose.rear).toBeGreaterThan(0.9);
    // Behind the trunk, measured along the aim.
    const along = rear.tip[0] * Math.sin(facing) + rear.tip[2] * Math.cos(facing);
    expect(along).toBeLessThan(-1);
    expect(rear.tip[1]).toBeGreaterThan(5);
    const landed = chainOf(
      input({
        attack: 1,
        attackFacing: facing,
        attackElapsed: TENTACLES.whipTelegraphSec + TENTACLES.whipStrikeSec,
      }),
    );
    expect(landed.pose.slam).toBeCloseTo(1, 6);
    expect(landed.pose.impact).toBeCloseTo(1, 6);
    // Flat on the floor, its end at the end of the lane (the tip model adds the rest).
    const end = Math.hypot(landed.tip[0], landed.tip[2]);
    const tipModel = TENTACLE_LOOK.tipLength * TENTACLE_LOOK.tipRadius;
    expect(end + tipModel).toBeGreaterThan(TENTACLES.whipLength - 1);
    expect(end).toBeLessThan(TENTACLES.whipLength + 0.5);
    expect(landed.tip[1]).toBeLessThan(1);
    // Every link past the bend lies INSIDE the rectangle the sim strikes.
    for (let link = 5; link < LINKS; link++) {
      const o = link * LINK_STRIDE;
      expect(pointInWhip(0, 0, facing, landed.chain[o], landed.chain[o + 2])).toBe(true);
      expect(landed.chain[o + 1]).toBeGreaterThan(0);
    }
    // And it comes down faster and faster.
    const at = (k: number) =>
      tentaclePose(
        input({
          attack: 1,
          attackFacing: facing,
          attackElapsed: TENTACLES.whipTelegraphSec + TENTACLES.whipStrikeSec * k,
        }),
        makeTentaclePose(),
      ).slam;
    expect(at(0.5) - at(0)).toBeLessThan(at(1) - at(0.5));
    // Then it draws back to where it stood.
    const after = tentaclePose(
      input({ attack: 1, attackFacing: facing, attackElapsed: WHIP_TOTAL_SEC }),
      makeTentaclePose(),
    );
    expect(after.slam).toBeCloseTo(0, 6);
  });

  it('lowers over the ring, then turns with the arm the sim turns, inside its reach', () => {
    const facing = -0.6;
    for (const direction of [1, -1]) {
      for (const k of [0, 0.25, 0.5, 0.8, 1]) {
        const elapsed = TENTACLES.sweepTelegraphSec + TENTACLES.sweepSec * k;
        const made = chainOf(
          input({ attack: 2, attackFacing: facing, direction, attackElapsed: elapsed }),
        );
        const bearing = sweepArmBearing(facing, direction, sweepProgress(elapsed));
        if (k < 1) expect(made.pose.heading).toBeCloseTo(bearing, 9);
        expect(made.pose.low).toBeCloseTo(1, 6);
        const reach = Math.hypot(made.tip[0], made.tip[2]);
        const tipModel = TENTACLE_LOOK.tipLength * TENTACLE_LOOK.tipRadius;
        // The arm on screen ends where the hit ends: never visibly past it.
        expect(reach + tipModel).toBeLessThan(TENTACLES.sweepRadius + 0.6);
        expect(reach + tipModel).toBeGreaterThan(TENTACLES.sweepRadius - 1.2);
        expect(made.tip[1]).toBeLessThan(2.2);
        // The ROOT half of the arm points along the sim's bearing; only its end
        // trails, and never by more than the arm's own half width.
        const mid = 8 * LINK_STRIDE;
        const drawn = Math.atan2(made.chain[mid], made.chain[mid + 2]);
        const off = Math.abs(Math.atan2(Math.sin(drawn - bearing), Math.cos(drawn - bearing)));
        expect(off).toBeLessThan(TENTACLES.sweepArmHalfAngle);
      }
    }
    expect(sweepSpeed(TENTACLES.sweepTelegraphSec)).toBe(0);
    expect(sweepSpeed(TENTACLES.sweepTelegraphSec + TENTACLES.sweepSec / 2)).toBeCloseTo(1, 9);
    expect(sweepSpeed(SWEEP_TOTAL_SEC)).toBe(0);
  });

  it('thrashes and drops when killed, rotting from the tip; only withdraws when it leaves', () => {
    const early = chainOf(input({ elapsed: -1, fall: 0.2, killed: true, still: false, time: 3 }));
    expect(early.pose.dissolve).toBe(0);
    expect(early.pose.grow).toBe(1);
    const late = chainOf(input({ elapsed: -1, fall: TENTACLES.retractSec * 0.85, killed: true }));
    expect(late.pose.slam).toBeGreaterThan(0.8);
    expect(late.pose.dissolve).toBeGreaterThan(0.4);
    // The tip has gone before the root.
    expect(late.chain[(LINKS - 1) * LINK_STRIDE + 5]).toBeLessThan(late.chain[5] * 0.2);
    const gone = tentaclePose(
      input({ elapsed: -1, fall: TENTACLES.retractSec, killed: true }),
      makeTentaclePose(),
    );
    expect(gone.dissolve).toBe(1);
    expect(gone.rubble).toBe(0);
    const leaving = tentaclePose(
      input({ elapsed: -1, fall: TENTACLES.retractSec * 0.5, killed: false }),
      makeTentaclePose(),
    );
    expect(leaving.dissolve).toBe(0);
    expect(leaving.grow).toBeLessThan(0.6);
    expect(
      tentaclePose(
        input({ elapsed: -1, fall: TENTACLES.retractSec, killed: false }),
        makeTentaclePose(),
      ).grow,
    ).toBe(0);
  });

  it('reaches out over whoever it wants, wherever they stand, then closes down on them', () => {
    const tipModel = TENTACLE_LOOK.tipLength * TENTACLE_LOOK.tipRadius;
    for (const distance of [3, 6, 9, TENTACLES.grabRange]) {
      const facing = 0.9;
      const held = chainOf(
        input({
          attack: 3,
          attackFacing: facing,
          attackElapsed: 1,
          reachDistance: distance,
          holding: true,
        }),
      );
      expect(held.pose.reach).toBe(1);
      expect(held.pose.clench).toBeCloseTo(1, 6);
      // Its end is ON them: along the line to them, at their distance, down low.
      const along = held.tip[0] * Math.sin(facing) + held.tip[2] * Math.cos(facing);
      expect(along + tipModel).toBeGreaterThan(distance - 1.6);
      expect(along).toBeLessThan(distance + 1);
      expect(held.tip[1]).toBeLessThan(2.6);
    }
    // While it only reaches, it hangs over them higher than once it has closed.
    const reaching = chainOf(
      input({
        attack: 3,
        attackFacing: 0.9,
        attackElapsed: TENTACLES.grabTelegraphSec * 0.9,
        reachDistance: 8,
        holding: false,
      }),
    );
    const closed = chainOf(
      input({ attack: 3, attackFacing: 0.9, attackElapsed: 1, reachDistance: 8, holding: true }),
    );
    expect(reaching.pose.reach).toBeGreaterThan(0.6);
    expect(reaching.pose.clench).toBe(0);
    expect(reaching.tip[1]).toBeGreaterThan(closed.tip[1]);
    expect(reachStretch(20, 1)).toBeGreaterThan(reachStretch(4, 1));
  });

  it('keeps every link basis square and unit, belly inside the lean', () => {
    const axis = new Float32Array(3);
    const belly = new Float32Array(3);
    for (const pitch of [-0.8, 0, 0.6, Math.PI / 2]) {
      for (const heading of [0, 1.3, -2.4]) {
        linkBasis(pitch, heading, axis, belly);
        expect(Math.hypot(axis[0], axis[1], axis[2])).toBeCloseTo(1, 6);
        expect(Math.hypot(belly[0], belly[1], belly[2])).toBeCloseTo(1, 6);
        expect(axis[0] * belly[0] + axis[1] * belly[1] + axis[2] * belly[2]).toBeCloseTo(0, 6);
      }
    }
    // Standing: the belly faces the heading. Lying along the floor: it faces down.
    linkBasis(0, 0, axis, belly);
    expect(belly[2]).toBeCloseTo(1, 6);
    linkBasis(Math.PI / 2, 0, axis, belly);
    expect(belly[1]).toBeCloseTo(-1, 6);
  });

  it('fills the lane over the telegraph, flashes on the blow, then fades', () => {
    const out = { fill: 0, lane: 0, flash: 0 };
    whipTelegraph(TENTACLES.whipTelegraphSec / 2, out);
    expect(out.fill).toBeCloseTo(0.5, 9);
    expect(out.flash).toBe(0);
    expect(out.lane).toBeGreaterThan(0.9);
    whipTelegraph(TENTACLES.whipTelegraphSec + TENTACLES.whipStrikeSec, out);
    expect(out.fill).toBe(1);
    expect(out.flash).toBeCloseTo(1, 9);
    whipTelegraph(WHIP_TOTAL_SEC, out);
    expect(out.lane).toBeCloseTo(0, 6);
    const arc = { ring: 0, bearing: 0, arm: 0, wake: 0, fill: 0 };
    sweepTelegraph(TENTACLES.sweepTelegraphSec * 0.5, 0.4, -1, arc);
    expect(arc.bearing).toBeCloseTo(0.4, 9);
    expect(arc.wake).toBe(0);
    expect(arc.ring).toBeCloseTo(1, 6);
    sweepTelegraph(TENTACLES.sweepTelegraphSec + TENTACLES.sweepSec / 2, 0.4, -1, arc);
    expect(arc.bearing).toBeCloseTo(0.4 - Math.PI, 9);
    expect(arc.wake).toBeCloseTo(1, 6);
    sweepTelegraph(SWEEP_TOTAL_SEC, 0.4, -1, arc);
    expect(arc.ring).toBeCloseTo(0, 6);
  });
});

function cue(partial: Partial<HoardBossCueView> & { variant: HoardBossCueView['variant'] }) {
  return {
    instanceId: 1,
    cueId: 5,
    kind: 'sweep',
    phase: 'warning',
    x: 10,
    z: -20,
    facing: 0,
    radius: TENTACLES.eruptRadius,
    halfAngle: 0,
    remaining: TENTACLE_TOTAL_SEC,
    total: TENTACLE_TOTAL_SEC,
    ...partial,
  } as HoardBossCueView;
}
const CALM_OFF = () => false;
/** Its rise cue while it is rising; once risen, its standing heartbeat cue. */
const trunk = (elapsed: number, more: Partial<HoardBossCueView> = {}) =>
  elapsed < TENTACLE_TOTAL_SEC
    ? cue({ variant: 'tide-tentacle', remaining: TENTACLE_TOTAL_SEC - elapsed, ...more })
    : cue({
        variant: 'tide-tentacle-up',
        total: TENTACLES.upLifeSec,
        remaining: TENTACLES.upLifeSec,
        ...more,
      });
const whip = (elapsed: number, more: Partial<HoardBossCueView> = {}) =>
  cue({
    variant: 'tide-whip',
    cueId: 9,
    facing: Math.PI / 2,
    radius: TENTACLES.whipLength,
    halfAngle: TENTACLES.whipHalfWidth,
    total: WHIP_TOTAL_SEC,
    remaining: WHIP_TOTAL_SEC - elapsed,
    ...more,
  });
const sweep = (elapsed: number, direction: number, more: Partial<HoardBossCueView> = {}) =>
  cue({
    variant: 'tide-sweep',
    cueId: 9,
    facing: 0.5,
    radius: direction * TENTACLES.sweepRadius,
    halfAngle: TENTACLES.sweepArmHalfAngle,
    total: SWEEP_TOTAL_SEC,
    remaining: SWEEP_TOTAL_SEC - elapsed,
    ...more,
  });
const named = (scene: THREE.Scene, name: string): THREE.Object3D[] => {
  const out: THREE.Object3D[] = [];
  scene.traverse((node) => {
    if (node.name === name) out.push(node);
  });
  return out;
};
const shown = (scene: THREE.Scene, name: string) =>
  named(scene, name).filter((node) => node.visible).length;
const instances = (scene: THREE.Scene, name: string) =>
  (named(scene, name)[0] as THREE.InstancedMesh).count;
const make = (scene: THREE.Scene, tier: 'high' | 'low' = 'high', shake?: (n: number) => void) =>
  new HoardTentaclesFx(scene, () => 0, undefined, CALM_OFF, shake, tier, new THREE.Group());

describe('the adapter', () => {
  it('hides its cues from the generic floor telegraph', async () => {
    const scene = new THREE.Scene();
    const generic = new HoardBossFx(scene, () => 0);
    await generic.readyForEntry;
    generic.sync([
      trunk(3),
      whip(0.3),
      sweep(0.3, -1, { cueId: 11 }),
      cue({ variant: 'tide-tentacle-fall', cueId: 12 }),
    ]);
    const root = scene.getObjectByName('hoard-boss-actionable-cues');
    expect(root?.children.every((slot) => !slot.visible)).toBe(true);
    generic.dispose();
  });

  it('warns, rises as one instanced chain, and breaks the floor', async () => {
    const scene = new THREE.Scene();
    const shakes: number[] = [];
    const fx = make(scene, 'high', (n) => shakes.push(n));
    await fx.readyForEntry;
    fx.update(0.016);
    expect(shown(scene, 'TentacleWarning')).toBe(0);
    expect(instances(scene, 'TentacleChain_AbyssSkin')).toBe(0);

    fx.sync([trunk(0.5)]);
    fx.update(0.016);
    expect(shown(scene, 'TentacleWarning')).toBe(1);
    const warning = named(scene, 'TentacleWarning').find((n) => n.visible) as THREE.Mesh;
    expect(warning.scale.x).toBeGreaterThan(TENTACLES.eruptRadius * 0.9);
    expect(warning.position.x).toBe(10);
    expect(instances(scene, 'TentacleChain_AbyssSkin')).toBe(0);
    expect(instances(scene, 'TentacleRubble')).toBe(0);

    fx.sync([trunk(STANDING)]);
    fx.update(0.016);
    expect(shown(scene, 'TentacleWarning')).toBe(0);
    for (const part of ['AbyssSkin', 'AbyssUnder', 'AbyssSucker']) {
      expect(instances(scene, `TentacleChain_${part}`)).toBe(LINKS);
      expect(instances(scene, `TentacleTip_${part}`)).toBe(1);
    }
    expect(instances(scene, 'TentacleRubble')).toBe(1);
    expect(instances(scene, 'TentaclePool')).toBe(1);
    expect(shakes.length).toBe(1);
    // The three chain draws share ONE matrix buffer.
    const [skin, under, glow] = ['AbyssSkin', 'AbyssUnder', 'AbyssSucker'].map(
      (part) => named(scene, `TentacleChain_${part}`)[0] as THREE.InstancedMesh,
    );
    expect(under.instanceMatrix).toBe(skin.instanceMatrix);
    expect(glow.instanceMatrix).toBe(skin.instanceMatrix);
    // Rooted where the cue is, on the floor.
    const m = new THREE.Matrix4();
    skin.getMatrixAt(0, m);
    expect(m.elements[12]).toBeCloseTo(10, 6);
    expect(m.elements[13]).toBeCloseTo(0, 6);
    expect(m.elements[14]).toBeCloseTo(-20, 6);
    expect(m.determinant()).toBeGreaterThan(0);

    fx.sync([]);
    fx.update(0.016);
    expect(instances(scene, 'TentacleChain_AbyssSkin')).toBe(0);
    expect(instances(scene, 'TentacleRubble')).toBe(0);
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('draws the lash lane exactly over the rectangle the sim strikes', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    fx.sync([trunk(STANDING), whip(0.6)]);
    fx.update(0.016);
    expect(shown(scene, 'TentacleLane')).toBe(1);
    expect(shown(scene, 'TentacleSweepRing')).toBe(0);
    const lane = named(scene, 'TentacleLane').find((n) => n.visible) as THREE.Mesh;
    const position = lane.geometry.getAttribute('position');
    const facing = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const px = position.getX(i);
      const pz = position.getZ(i);
      // Each corner is ON the hit rectangle's edge: just inside hits, just outside misses.
      const cx = 10 + (i < 2 ? 0.01 : TENTACLES.whipLength - 0.01);
      expect(pointInWhip(10, -20, facing, cx, pz + (pz > -20 ? -0.01 : 0.01))).toBe(true);
      expect(pointInWhip(10, -20, facing, cx, pz + (pz > -20 ? 0.01 : -0.01))).toBe(false);
      expect(Math.abs(px - 10) < 1e-4 || Math.abs(px - 10 - TENTACLES.whipLength) < 1e-4).toBe(
        true,
      );
    }
    // The fill has run as far as the telegraph has.
    const fill = named(scene, 'TentacleLaneFill').find((n) => n.visible) as THREE.Mesh;
    const far = fill.geometry.getAttribute('position').getX(2) - 10;
    expect(far).toBeCloseTo((0.6 / TENTACLES.whipTelegraphSec) * TENTACLES.whipLength, 3);
  });

  it('draws the sweep ring over the swept ground and the arm on the arm', async () => {
    for (const direction of [1, -1]) {
      const scene = new THREE.Scene();
      const fx = make(scene);
      await fx.readyForEntry;
      const elapsed = TENTACLES.sweepTelegraphSec + TENTACLES.sweepSec * 0.4;
      fx.sync([trunk(STANDING), sweep(elapsed, direction)]);
      fx.update(0.016);
      expect(shown(scene, 'TentacleSweepRing')).toBe(1);
      expect(shown(scene, 'TentacleSweepArm')).toBe(1);
      expect(shown(scene, 'TentacleLane')).toBe(0);
      const ring = named(scene, 'TentacleSweepRing').find((n) => n.visible) as THREE.Mesh;
      const rp = ring.geometry.getAttribute('position');
      for (let column = 0; column < rp.count / 2; column++) {
        const inner = Math.hypot(rp.getX(column * 2) - 10, rp.getZ(column * 2) + 20);
        const outer = Math.hypot(rp.getX(column * 2 + 1) - 10, rp.getZ(column * 2 + 1) + 20);
        expect(inner).toBeCloseTo(TENTACLES.sweepInnerRadius, 3);
        expect(outer).toBeCloseTo(TENTACLES.sweepRadius, 3);
      }
      // The arm wedge sits where the sim's arm is: a point on its middle is being
      // passed right now, a point a quarter turn ahead is not.
      const arm = named(scene, 'TentacleSweepArm').find((n) => n.visible) as THREE.Mesh;
      const ap = arm.geometry.getAttribute('position');
      const middle = (ap.count / 2 - 1) / 2;
      const mx = (ap.getX(middle * 2) + ap.getX(middle * 2 + 1)) / 2;
      const mz = (ap.getZ(middle * 2) + ap.getZ(middle * 2 + 1)) / 2;
      const now = sweepProgress(elapsed);
      expect(sweepPasses(10, -20, 0.5, direction, now - 0.01, now, mx, mz)).toBe(true);
      const bearing = sweepArmBearing(0.5, direction, now) + direction * (Math.PI / 2);
      expect(
        sweepPasses(
          10,
          -20,
          0.5,
          direction,
          now - 0.01,
          now,
          10 + Math.sin(bearing) * 5,
          -20 + Math.cos(bearing) * 5,
        ),
      ).toBe(false);
      fx.dispose();
    }
  });

  it('stands on its heartbeat cue without ever replaying the rise', async () => {
    const scene = new THREE.Scene();
    const shakes: number[] = [];
    const fx = make(scene, 'high', (n) => shakes.push(n));
    await fx.readyForEntry;
    // A client that joins late sees only the standing cue, its clock near zero.
    fx.sync([trunk(STANDING)]);
    fx.update(0.016);
    expect(shown(scene, 'TentacleWarning')).toBe(0);
    expect(instances(scene, 'TentacleChain_AbyssSkin')).toBe(LINKS);
    // Every heartbeat restarts the cue: it must change nothing on screen.
    const skin = named(scene, 'TentacleChain_AbyssSkin')[0] as THREE.InstancedMesh;
    const before = new THREE.Matrix4();
    skin.getMatrixAt(LINKS - 1, before);
    fx.sync([trunk(STANDING, { remaining: TENTACLES.upLifeSec - 0.6 })]);
    fx.update(0);
    const after = new THREE.Matrix4();
    skin.getMatrixAt(LINKS - 1, after);
    expect(after.elements[13]).toBeCloseTo(before.elements[13], 6);
    expect(instances(scene, 'TentacleChain_AbyssSkin')).toBe(LINKS);
    fx.dispose();
  });

  it('marks whoever a grasp wants, and bends THAT tentacle of the set toward them', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    const victim = { x: 10, z: -28 };
    const grab = (variant: 'tide-grab' | 'tide-grab-hold', elapsed: number, total: number) =>
      cue({
        variant,
        kind: 'mark',
        cueId: 40,
        ...victim,
        radius: TENTACLES.grabRange,
        innerRadius: 1,
        targetId: 77,
        total,
        remaining: total - elapsed,
      });
    fx.sync([
      trunk(STANDING, { cueId: 5, halfAngle: 0 }),
      trunk(STANDING, { cueId: 6, x: 40, halfAngle: 1 }),
      grab('tide-grab', 0.8, TENTACLES.grabTelegraphSec),
    ]);
    fx.update(0.016);
    // One mark, under the victim, in the danger colour.
    expect(shown(scene, 'TentacleWarning')).toBe(1);
    const mark = named(scene, 'TentacleWarning').find((n) => n.visible) as THREE.Mesh;
    expect(mark.position.x).toBe(victim.x);
    expect(mark.position.z).toBe(victim.z);
    // No lane and no sweep ring: a grasp is not a floor hazard.
    expect(shown(scene, 'TentacleLane') + shown(scene, 'TentacleSweepRing')).toBe(0);
    // Held: the mark stays on them, tighter.
    const wide = mark.scale.x;
    fx.sync([
      trunk(STANDING, { cueId: 5, halfAngle: 0 }),
      trunk(STANDING, { cueId: 6, x: 40, halfAngle: 1 }),
      grab('tide-grab-hold', 1, TENTACLES.grabHoldSec),
    ]);
    fx.update(0.016);
    expect(shown(scene, 'TentacleWarning')).toBe(1);
    expect(
      (named(scene, 'TentacleWarning').find((n) => n.visible) as THREE.Mesh).scale.x,
    ).toBeLessThan(wide);
    fx.sync([
      trunk(STANDING, { cueId: 5, halfAngle: 0 }),
      trunk(STANDING, { cueId: 6, x: 40, halfAngle: 1 }),
    ]);
    fx.update(0.016);
    expect(shown(scene, 'TentacleWarning')).toBe(0);
    fx.dispose();
  });

  it('plays the fall on the SAME rig when the cue becomes it, and clears after', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    fx.sync([trunk(STANDING), whip(0.4)]);
    fx.update(0.016);
    const fall = (elapsed: number) =>
      cue({
        variant: 'tide-tentacle-fall',
        halfAngle: 1,
        total: TENTACLES.retractSec,
        remaining: TENTACLES.retractSec - elapsed,
      });
    fx.sync([fall(0.1)]);
    fx.update(0.016);
    // Its threatened lash is gone with it; the chain is still there, dying.
    expect(shown(scene, 'TentacleLane')).toBe(0);
    expect(instances(scene, 'TentacleChain_AbyssSkin')).toBe(LINKS);
    fx.sync([fall(TENTACLES.retractSec - 0.01)]);
    fx.update(0.016);
    expect(instances(scene, 'TentacleChain_AbyssSkin')).toBeLessThan(LINKS);
    fx.sync([]);
    fx.update(0.016);
    expect(instances(scene, 'TentacleChain_AbyssSkin')).toBe(0);
    expect(instances(scene, 'TentacleRubble')).toBe(0);
    fx.dispose();
  });

  it('never carries the last tentacle onto a reused rig', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    fx.sync([trunk(STANDING), sweep(1, 1)]);
    fx.update(0.016);
    expect(shown(scene, 'TentacleSweepRing')).toBe(1);
    fx.sync([]);
    fx.update(0.016);
    // The same cue id in another hoard, somewhere else, still under its warning.
    fx.sync([trunk(0.3, { instanceId: 2, x: 310, z: -60 })]);
    fx.update(0.016);
    expect(shown(scene, 'TentacleSweepRing')).toBe(0);
    expect(shown(scene, 'TentacleWarning')).toBe(1);
    expect(instances(scene, 'TentacleChain_AbyssSkin')).toBe(0);
    expect(instances(scene, 'TentacleRubble')).toBe(0);
    const warning = named(scene, 'TentacleWarning').find((n) => n.visible) as THREE.Mesh;
    expect(warning.position.x).toBe(310);
    fx.dispose();
  });

  it('draws a whole set at once in the same few draws', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    const set = Array.from({ length: TENTACLES.maxTentacles }, (_, i) =>
      trunk(STANDING, { cueId: 20 + i, x: i * 12, halfAngle: i }),
    );
    fx.sync(set);
    fx.update(0.016);
    expect(instances(scene, 'TentacleChain_AbyssSkin')).toBe(LINKS * TENTACLES.maxTentacles);
    expect(instances(scene, 'TentacleTip_AbyssSkin')).toBe(TENTACLES.maxTentacles);
    let draws = 0;
    scene.traverse((node) => {
      if ((node as THREE.InstancedMesh).isInstancedMesh) draws++;
    });
    expect(draws).toBe(8);
    fx.dispose();
  });

  it('puts the late Blender asset in place BEFORE the compile gate sees the root', async () => {
    const asset = new THREE.Group();
    const holder = new THREE.Group();
    holder.name = 'Tentacle_ROOT';
    const seg = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ name: 'AbyssSkin' }),
    );
    seg.name = 'Tentacle_Seg';
    holder.add(seg);
    asset.add(holder);
    let deliver: (value: THREE.Group) => void = () => {};
    const late = new Promise<THREE.Group>((resolve) => {
      deliver = resolve;
    });
    const seen: number[] = [];
    const scene = new THREE.Scene();
    const gate = async (root: THREE.Object3D) => {
      const chain = root.getObjectByName('TentacleChain_AbyssSkin') as THREE.InstancedMesh;
      seen.push(chain.geometry.getAttribute('position').count);
    };
    const fx = new HoardTentaclesFx(scene, () => 0, gate, CALM_OFF, undefined, 'high', late);
    expect(scene.children).toHaveLength(0);
    deliver(asset);
    await fx.readyForEntry;
    expect(seen).toEqual([24]);
    expect(holder.children).toHaveLength(1); // the cached asset is never mutated
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('frees what it owns exactly once, and never the shared surface materials', async () => {
    const scene = new THREE.Scene();
    const fx = make(scene);
    await fx.readyForEntry;
    const owned = new Map<string, number>();
    const shared = new Map<string, number>();
    const listening = new Set<string>();
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.geometry || !mesh.material) return;
      if (!listening.has(mesh.geometry.uuid)) {
        listening.add(mesh.geometry.uuid);
        mesh.geometry.addEventListener('dispose', () =>
          owned.set(mesh.geometry.uuid, (owned.get(mesh.geometry.uuid) ?? 0) + 1),
        );
      }
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (listening.has(material.uuid)) continue;
        listening.add(material.uuid);
        const lit =
          (material as THREE.MeshStandardMaterial).isMeshStandardMaterial ||
          (material as THREE.MeshLambertMaterial).isMeshLambertMaterial;
        const bucket = lit ? shared : owned;
        material.addEventListener('dispose', () =>
          bucket.set(material.uuid, (bucket.get(material.uuid) ?? 0) + 1),
        );
      }
    });
    fx.dispose();
    fx.dispose();
    expect(owned.size).toBeGreaterThan(20);
    expect([...owned.values()].every((count) => count === 1)).toBe(true);
    expect(shared.size).toBe(0);
  });

  it('on the low tier sheds spray, pool and wake, and keeps everything a player acts on', async () => {
    const high = new THREE.Scene();
    const low = new THREE.Scene();
    const a = make(high, 'high');
    const b = make(low, 'low');
    await Promise.all([a.readyForEntry, b.readyForEntry]);
    const count = (scene: THREE.Scene, type: string) => {
      let n = 0;
      scene.traverse((node) => {
        if (node.type === type) n++;
      });
      return n;
    };
    expect(count(high, 'Points')).toBe(1);
    expect(count(low, 'Points')).toBe(0);
    expect(named(high, 'TentaclePool')).toHaveLength(1);
    expect(named(low, 'TentaclePool')).toHaveLength(0);
    expect(named(high, 'TentacleWake')).toHaveLength(TENTACLES.maxTentacles);
    expect(named(low, 'TentacleWake')).toHaveLength(0);
    for (const scene of [high, low]) {
      expect(named(scene, 'TentacleWarning')).toHaveLength(TENTACLES.maxTentacles);
      expect(named(scene, 'TentacleLane')).toHaveLength(TENTACLES.maxTentacles);
      expect(named(scene, 'TentacleSweepRing')).toHaveLength(TENTACLES.maxTentacles);
      expect(named(scene, 'TentacleSweepArm')).toHaveLength(TENTACLES.maxTentacles);
      expect(named(scene, 'TentacleChain_AbyssSkin')).toHaveLength(1);
    }
    // And the low tier still DRAWS the tentacle and its telegraphs.
    b.sync([trunk(STANDING), sweep(1, 1)]);
    b.update(0.016);
    expect(instances(low, 'TentacleChain_AbyssSkin')).toBe(LINKS);
    expect(shown(low, 'TentacleSweepRing')).toBe(1);
    expect(shown(low, 'TentacleSweepArm')).toBe(1);
    a.dispose();
    b.dispose();
  });
});

describe('the shipped Blender parts', () => {
  it('exist, keep their named parts, are small, and fit the numbers the sim uses', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    expect(ASSETS.map((a) => a.target)).toEqual([
      `public${TENTACLE_ASSET_URL}`,
      `public/${VISUALS.mob_abyssal_tentacle.url}`,
    ]);
    for (const asset of ASSETS) {
      expect(existsSync(asset.source)).toBe(true);
      expect(existsSync(asset.target)).toBe(true);
      const shipped = (await io.read(asset.target)).getRoot();
      expect(
        shipped
          .listNodes()
          .map((node) => node.getName())
          .sort(),
      ).toEqual(asset.nodes);
      expect((shipped.getExtras() as { authoring?: string }).authoring).toBe('Blender');
      expect(shipped.listTextures()).toHaveLength(0);
      let triangles = 0;
      for (const mesh of shipped.listMeshes())
        for (const primitive of mesh.listPrimitives())
          triangles += (primitive.getIndices()?.getCount() ?? 0) / 3;
      expect(triangles).toBeLessThan(900);
    }
    // The unoptimized export, in metres.
    const root = (
      await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(ASSETS[0].source)
    ).getRoot();
    const v = [0, 0, 0];
    for (const node of root.listNodes()) {
      for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
        const position = primitive.getAttribute('POSITION');
        if (!position) continue;
        let top = 0;
        let low = Number.POSITIVE_INFINITY;
        for (let i = 0; i < position.getCount(); i++) {
          position.getElement(i, v);
          top = Math.max(top, v[1]);
          low = Math.min(low, v[1]);
          // The broken floor never reaches past the warning the players were shown.
          if (node.getName() === 'Tentacle_Rubble' || node.getName() === 'Tentacle_Pool')
            expect(Math.hypot(v[0], v[2])).toBeLessThanOrEqual(TENTACLES.eruptRadius);
        }
        // ONE link: a unit long, its base ring on the origin, so the chain's
        // per-link length and radius are the instance's scale and nothing else.
        if (
          node.getName() === 'Tentacle_Seg' &&
          primitive.getMaterial()?.getName() === 'AbyssSkin'
        ) {
          expect(low).toBeCloseTo(0, 3);
          expect(top).toBeCloseTo(1, 3);
        }
        if (
          node.getName() === 'Tentacle_Tip' &&
          primitive.getMaterial()?.getName() === 'AbyssSkin'
        ) {
          expect(low).toBeCloseTo(0, 3);
          expect(top).toBeCloseTo(TENTACLE_LOOK.tipLength, 1);
        }
      }
    }
    // The mob's collar stays inside the ground the sweep never touches.
    const trunkRoot = (
      await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(ASSETS[1].source)
    ).getRoot();
    for (const node of trunkRoot.listNodes()) {
      for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
        const position = primitive.getAttribute('POSITION');
        if (!position) continue;
        for (let i = 0; i < position.getCount(); i++) {
          position.getElement(i, v);
          expect(Math.hypot(v[0], v[2])).toBeLessThan(TENTACLES.sweepInnerRadius);
        }
      }
    }
  });
});
