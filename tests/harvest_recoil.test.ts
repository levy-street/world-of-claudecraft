import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import { HarvestRecoil } from '../src/render/characters/harvest_recoil';

describe('Red Harvest receiving impulse', () => {
  it('holds final compression then releases it at 30, 60 and 120 Hz without drift', () => {
    for (const hz of [30, 60, 120]) {
      const recoil = new HarvestRecoil(),
        pose = new Group();
      recoil.trigger(2, 2);
      let peak = 0,
        early = 0;
      for (let frame = 1; frame <= hz / 2; frame++) {
        pose.rotation.set(0, 0, 0);
        pose.position.set(0, 0, 0);
        recoil.apply(pose, 1 / hz, false);
        peak = Math.max(peak, -pose.position.y);
        if (frame / hz <= 0.048) early = Math.max(early, -pose.position.y);
      }
      expect(early).toBeCloseTo(0.046, 6);
      expect(peak).toBeLessThanOrEqual(0.0461);
      expect(pose.position.y).toBe(0);
      expect(pose.rotation.x).toBe(0);
    }
  });
  it('alternates impact twist, keeps the world root still and gives the final hit more weight', () => {
    const root = new Group(),
      pose = new Group();
    root.add(pose);
    root.position.set(3, 4, 5);
    const recoil = new HarvestRecoil();
    const results = [0, 1, 2].map((beat) => {
      pose.rotation.set(0, 0, 0);
      pose.position.set(0, 0, 0);
      recoil.trigger(beat, 2);
      recoil.apply(pose, 0.03, false);
      return { pitch: pose.rotation.x, twist: pose.rotation.z };
    });
    expect(results[0].twist * results[1].twist).toBeLessThan(0);
    expect(Math.abs(results[2].pitch)).toBeGreaterThan(Math.abs(results[0].pitch));
    expect(root.position.toArray()).toEqual([3, 4, 5]);
  });
  it('suppresses movement immediately and expires without residual pose offsets', () => {
    const pose = new Group(),
      recoil = new HarvestRecoil();
    recoil.trigger(2, 2);
    recoil.apply(pose, 0.03, true);
    expect(pose.rotation.x).toBe(0);
    recoil.trigger(2, 2);
    recoil.apply(pose, 0.3, false);
    expect(pose.position.y).toBe(0);
    expect(pose.rotation.z).toBe(0);
  });
  it('bounds the impulse on a large enemy and preserves existing pose contributions', () => {
    const pose = new Group(),
      recoil = new HarvestRecoil();
    pose.rotation.x = 0.4;
    recoil.trigger(2, 12);
    recoil.apply(pose, 0.03, false);
    expect(pose.rotation.x).toBeGreaterThan(0.37);
    expect(pose.rotation.x).toBeLessThan(0.4);
  });
  it('leans away from opposite attackers even when the target turns', () => {
    const root = new Group(),
      pose = new Group(),
      recoil = new HarvestRecoil();
    root.position.set(4, 0, 5);
    for (const yaw of [0, Math.PI / 2, Math.PI]) {
      root.rotation.y = yaw;
      for (const side of [-1, 1]) {
        pose.rotation.set(0, 0, 0);
        pose.position.set(0, 0, 0);
        recoil.trigger(2, 2, root, { x: 4, z: 5 + side * 3 });
        recoil.apply(pose, 0.03, false);
        const leanZ = pose.rotation.x * Math.cos(yaw) + pose.rotation.z * Math.sin(yaw);
        expect(leanZ * side).toBeLessThan(0);
      }
    }
  });
  it('damps an enlarged enemy using its displayed height through the parent scale', () => {
    const parent = new Group(),
      root = new Group(),
      pose = new Group(),
      recoil = new HarvestRecoil();
    parent.add(root);
    const pitches = [1, 6].map((scale) => {
      parent.scale.setScalar(scale);
      pose.rotation.set(0, 0, 0);
      recoil.trigger(2, 2, root);
      recoil.apply(pose, 0.03, false);
      return Math.abs(pose.rotation.x);
    });
    expect(pitches[1]).toBeCloseTo(pitches[0] / 4, 8);
    expect(root.position.toArray()).toEqual([0, 0, 0]);
  });
  it('recovers after visible recoil using the character pose composition order', () => {
    const pose = new Group(),
      recoil = new HarvestRecoil();
    recoil.trigger(2, 2);
    let visible = false;
    for (let i = 0; i < 30; i++) {
      pose.rotation.set(0.2, 0, 0);
      pose.position.set(0, 0.1, 0);
      recoil.apply(pose, 1 / 60, false);
      visible ||= pose.rotation.x !== 0.2;
    }
    expect(visible).toBe(true);
    expect(pose.rotation.x).toBe(0.2);
    expect(pose.rotation.z).toBe(0);
    expect(pose.position.y).toBe(0.1);
  });
});
