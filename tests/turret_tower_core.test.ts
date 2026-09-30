// The Fire and Fly cannon tower's pure half: the head's eased turn, the
// barrel's elevation from the shell's arc, the gunner's stand behind the
// breech, and the model constants checked against hex_tower_cannon.glb itself.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { CANNON_SHELL, cannonLaunchPitch } from '../src/render/cannon_shell_core';
import {
  stepTurretHeadYaw,
  TURRET_BARREL,
  TURRET_GUNNER,
  TURRET_HEAD,
  TURRET_HEAD_HOP,
  TURRET_TOWER_MODEL,
  turretBarrelPitch,
  turretGunnerInto,
  turretHeadHop,
  turretRestPitch,
} from '../src/render/turret_tower_core';
import { FIRE_AND_FLY_TOWER } from '../src/sim/fire_and_fly_field';

const FRAME = 1 / 60;

/** Where the barrel tip sits, forward of the tower axis and above the roof, at elevation `pitch`. */
function tipAt(pitch: number): { forward: number; up: number } {
  const s = FIRE_AND_FLY_TOWER.scale;
  const half = TURRET_TOWER_MODEL.barrelHalfLength * s;
  return {
    forward: TURRET_TOWER_MODEL.barrelPivot.z * s + half * Math.cos(pitch),
    up: TURRET_TOWER_MODEL.barrelPivot.y * s + half * Math.sin(pitch),
  };
}

describe('the cannon head turn', () => {
  it('eases toward the aim: a small gap closes part of the way each frame, never past it', () => {
    let yaw = 0;
    const target = 0.2;
    const seen: number[] = [];
    for (let i = 0; i < 30; i++) {
      yaw = stepTurretHeadYaw(yaw, target, FRAME);
      seen.push(yaw);
    }
    expect(seen[0]).toBeGreaterThan(0);
    expect(seen[0]).toBeLessThan(target);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
      expect(seen[i]).toBeLessThanOrEqual(target);
    }
    // Each frame closes a smaller step than the last: an ease out, not a constant rate.
    expect(seen[1] - seen[0]).toBeLessThan(seen[0]);
    expect(target - seen[seen.length - 1]).toBeLessThan(1e-3);
  });

  it('never turns faster than 540 degrees a second, however far the aim jumps', () => {
    expect(TURRET_HEAD.maxTurnRate).toBeCloseTo((540 * Math.PI) / 180, 12);
    let yaw = 0;
    const target = 3;
    const step = stepTurretHeadYaw(yaw, target, FRAME);
    expect(step).toBeCloseTo(TURRET_HEAD.maxTurnRate * FRAME, 9);
    let frames = 0;
    while (Math.abs(target - yaw) > 1e-3 && frames < 600) {
      const next = stepTurretHeadYaw(yaw, target, FRAME);
      expect(next - yaw).toBeLessThanOrEqual(TURRET_HEAD.maxTurnRate * FRAME + 1e-12);
      yaw = next;
      frames++;
    }
    // A half turn takes a third of a second at the cap, plus the ease's tail.
    expect(frames).toBeGreaterThan(Math.floor(3 / (TURRET_HEAD.maxTurnRate * FRAME)));
    expect(frames).toBeLessThan(60);
  });

  it('turns the short way across the back, holds on a non-finite aim, and caps a hitch', () => {
    const across = stepTurretHeadYaw(3, -3, FRAME);
    expect(across).toBeGreaterThan(3);
    expect(stepTurretHeadYaw(1.2, Number.NaN, FRAME)).toBe(1.2);
    expect(stepTurretHeadYaw(1.2, Number.POSITIVE_INFINITY, FRAME)).toBe(1.2);
    const hitch = stepTurretHeadYaw(0, 3, 5);
    expect(hitch).toBeCloseTo(TURRET_HEAD.maxTurnRate * 0.1, 9);
    expect(stepTurretHeadYaw(0.5, 1, -1)).toBe(0.5);
  });
});

describe('the barrel elevation', () => {
  it('is the launch tangent of the shell arc from the muzzle it lifts the tip to', () => {
    const rise = -FIRE_AND_FLY_TOWER.roofY;
    for (const range of [12, 20, 30, 45, 60]) {
      const pitch = turretBarrelPitch(range, rise);
      expect(pitch).toBeGreaterThan(0);
      expect(pitch).toBeLessThan(TURRET_BARREL.maxPitch);
      const tip = tipAt(pitch);
      expect(cannonLaunchPitch(range - tip.forward, rise - tip.up)).toBeCloseTo(pitch, 3);
    }
  });

  it('lifts no higher than the barrel travels on a point-blank shot, where the arc flattens to match', () => {
    const rise = -FIRE_AND_FLY_TOWER.roofY;
    const pitch = turretBarrelPitch(3, rise);
    expect(pitch).toBeCloseTo(TURRET_BARREL.maxPitch, 9);
    expect(CANNON_SHELL.maxLaunchPitch).toBeCloseTo(TURRET_BARREL.maxPitch, 12);
    // The shell leaves along the barrel: its arc is flattened to that same elevation.
    const tip = tipAt(pitch);
    expect(cannonLaunchPitch(3 - tip.forward, rise - tip.up)).toBeCloseTo(pitch, 6);
    // Right under the muzzle, the shot still lobs out along the barrel.
    expect(turretBarrelPitch(0, rise)).toBeCloseTo(TURRET_BARREL.maxPitch, 9);
  });

  it('rests at the elevation of a shot at the rest range, and reads a non-finite shot as it', () => {
    const rest = turretRestPitch();
    expect(rest).toBeCloseTo(
      turretBarrelPitch(TURRET_BARREL.restRange, -FIRE_AND_FLY_TOWER.roofY),
      12,
    );
    expect(turretBarrelPitch(Number.NaN, -FIRE_AND_FLY_TOWER.roofY)).toBeCloseTo(rest, 12);
    expect(Number.isFinite(turretBarrelPitch(20, Number.NaN))).toBe(true);
  });
});

describe('the head hop on a slam', () => {
  it('hops up, slams down past its seat, springs back and rests, with no jump between frames', () => {
    const { rise, riseTime, dip, dropTime, settle } = TURRET_HEAD_HOP;
    expect(turretHeadHop(-0.01)).toBe(0);
    expect(turretHeadHop(0)).toBe(0);
    expect(turretHeadHop(riseTime)).toBeCloseTo(rise, 12);
    expect(turretHeadHop(riseTime + dropTime)).toBeCloseTo(-dip, 12);
    let top = 0;
    let bottom = 0;
    let last = 0;
    for (let t = 0; t <= riseTime + dropTime + settle + 0.2; t += 1 / 240) {
      const y = turretHeadHop(t);
      top = Math.max(top, y);
      bottom = Math.min(bottom, y);
      // Continuous: at 240 frames a second no step is more than the slam's fastest.
      expect(Math.abs(y - last)).toBeLessThan(0.035);
      last = y;
    }
    expect(top).toBeCloseTo(rise, 2);
    expect(bottom).toBeCloseTo(-dip, 2);
    expect(turretHeadHop(riseTime + dropTime + settle)).toBe(0);
    expect(turretHeadHop(Number.NaN)).toBe(0);
    // It comes down harder than it went up: the slam.
    expect((rise + dip) / dropTime).toBeGreaterThan(rise / riseTime);
  });
});

describe('the gunner on the roof', () => {
  it('stands behind the breech on the head yaw, on the parapet ring, inside the tower', () => {
    const out = { x: 0, y: 0, z: 0 };
    turretGunnerInto(out, 10, -4, 7, Math.PI / 2);
    // The head faces +x, so behind it is -x.
    expect(out.x).toBeCloseTo(10 - TURRET_GUNNER.behind, 12);
    expect(out.z).toBeCloseTo(-4, 12);
    expect(out.y).toBeCloseTo(7 + FIRE_AND_FLY_TOWER.topY - FIRE_AND_FLY_TOWER.roofY, 12);
    const s = FIRE_AND_FLY_TOWER.scale;
    // Past the breech end at rest (the barrel's back end in the head's space), inside the shaft.
    const breech = (TURRET_TOWER_MODEL.barrelHalfLength - TURRET_TOWER_MODEL.barrelPivot.z) * s;
    expect(TURRET_GUNNER.behind).toBeGreaterThan(breech);
    expect(TURRET_GUNNER.behind).toBeLessThan(FIRE_AND_FLY_TOWER.radius);
  });
});

describe('the tower model', () => {
  it('matches hex_tower_cannon.glb: the head on the roof, its barrel, pivot, length and bore', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const root = (await io.read(`public${TURRET_TOWER_MODEL.url}`)).getRoot();
    const head = root.listNodes().find((n) => n.getName() === TURRET_TOWER_MODEL.headNode);
    const barrel = head?.listChildren().find((n) => n.getName() === TURRET_TOWER_MODEL.barrelNode);
    if (!head || !barrel) throw new Error('the tower lost its head or its barrel');
    // The head sits on the roof platform, where the sim seats the player.
    expect(head.getWorldMatrix()[13] * FIRE_AND_FLY_TOWER.scale).toBeCloseTo(
      FIRE_AND_FLY_TOWER.roofY,
      6,
    );
    expect(head.getRotation()).toEqual([0, 0, 0, 1]);
    const [, py, pz] = barrel.getTranslation();
    expect(py).toBeCloseTo(TURRET_TOWER_MODEL.barrelPivot.y, 3);
    expect(pz).toBeCloseTo(TURRET_TOWER_MODEL.barrelPivot.z, 3);
    expect(barrel.getScale()[2]).toBeCloseTo(TURRET_TOWER_MODEL.barrelHalfLength, 3);
    expect(barrel.getRotation()).toEqual([0, 0, 0, 1]);
    // The long axis is local z, -1 to 1: the breech knob closes -z, the bore ring opens +z.
    const position = barrel.getMesh()?.listPrimitives()[0].getAttribute('POSITION');
    if (!position) throw new Error('the barrel has no positions');
    const v: number[] = [];
    let back = 0;
    let bore = 0;
    for (let i = 0; i < position.getCount(); i++) {
      position.getElement(i, v);
      if (v[2] < -0.99) back = Math.max(back, Math.hypot(v[0], v[1]));
      if (v[2] > 0.99) bore = Math.max(bore, Math.hypot(v[0], v[1]));
    }
    expect(back).toBeLessThan(0.01);
    expect(bore).toBeGreaterThan(0.1);
    expect(TURRET_TOWER_MODEL.muzzleTip).toEqual({ x: 0, y: 0, z: 1 });
  });
});
