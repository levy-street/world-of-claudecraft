import { Group } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterVisual } from '../src/render/characters/visual';
import {
  hasWarriorContactRecoil,
  WarriorContactRecoil,
} from '../src/render/characters/warrior_contact_recoil';
import { impactContact } from '../src/render/impact_contact';

function sample(id: string, beat = 0, height = 2) {
  const recoil = new WarriorContactRecoil();
  const pose = new Group();
  recoil.trigger(id, beat, height);
  recoil.apply(pose, 0.015, false);
  return pose;
}

describe('Warrior receiving-body weight', () => {
  it('gives hammer, shield and execution a heavier catch than builders and channel pulses', () => {
    const heavy = ['storm_bolt', 'shield_slam', 'execute'].map((id) => {
      const pose = sample(id);
      expect(-pose.position.y).toBeGreaterThan(0.04);
      return Math.hypot(pose.rotation.x, pose.rotation.z);
    });
    for (const id of ['heroic_strike', 'whirlwind', 'bladestorm', 'hamstring']) {
      const pose = sample(id);
      expect(Math.hypot(pose.rotation.x, pose.rotation.z)).toBeLessThan(Math.min(...heavy));
    }
    expect(Math.max(...heavy)).toBeLessThanOrEqual(0.16);
  });

  it('reverses Twinstrike bank and weights its second confirmed blade more strongly', () => {
    const first = sample('raging_gale');
    const second = sample('raging_gale', 1);
    expect(first.rotation.z * second.rotation.z).toBeLessThan(0);
    expect(Math.hypot(second.rotation.x, second.rotation.z)).toBeGreaterThan(
      Math.hypot(first.rotation.x, first.rotation.z),
    );
    expect(-second.position.y).toBeGreaterThan(-first.position.y);
  });

  it.each([30, 60, 120])(
    'catches, returns through neutral and settles without drift at %s Hz',
    (hz) => {
      const recoil = new WarriorContactRecoil();
      const pose = new Group();
      recoil.trigger('shield_slam', 0, 2);
      let peak = 0;
      let returnedThroughNeutral = false;
      for (let frame = 0; frame < hz / 2; frame++) {
        pose.rotation.set(0.25, 0.4, 0.1);
        pose.position.set(2, 0.3, 4);
        recoil.apply(pose, 1 / hz, false);
        peak = Math.max(peak, Math.hypot(pose.rotation.x - 0.25, pose.rotation.z - 0.1));
        returnedThroughNeutral ||= pose.rotation.x > 0.25;
        expect(pose.rotation.y).toBe(0.4);
        expect(pose.position.x).toBe(2);
        expect(pose.position.z).toBe(4);
      }
      expect(peak).toBeCloseTo(0.154, 8);
      expect(returnedThroughNeutral).toBe(true);
      expect(pose.rotation.toArray()).toEqual([0.25, 0.4, 0.1, 'XYZ']);
      expect(pose.position.toArray()).toEqual([2, 0.3, 4]);
    },
  );

  it('receives pressure away from either attacker in the target local frame without moving its root', () => {
    const root = new Group();
    root.position.set(4, 2, 5);
    const pose = new Group();
    root.add(pose);
    for (const yaw of [0, Math.PI / 2, Math.PI]) {
      root.rotation.y = yaw;
      for (const side of [-1, 1]) {
        pose.rotation.set(0, 0, 0);
        pose.position.set(0, 0, 0);
        const recoil = new WarriorContactRecoil();
        recoil.trigger('shield_slam', 0, 2, root, { x: 4, z: 5 + side * 3 });
        recoil.apply(pose, 0.025, false);
        const awayZ = pose.rotation.x * Math.cos(yaw) + pose.rotation.z * Math.sin(yaw);
        expect(awayZ * side).toBeLessThan(0);
        expect(root.position.toArray()).toEqual([4, 2, 5]);
        expect(root.rotation.y).toBe(yaw);
      }
    }
  });

  it('attenuates by displayed creature height including parent scale', () => {
    const parent = new Group();
    const root = new Group();
    parent.add(root);
    const strengths = [1, 6].map((scale) => {
      parent.scale.setScalar(scale);
      const pose = new Group();
      const recoil = new WarriorContactRecoil();
      recoil.trigger('execute', 0, 2, root);
      recoil.apply(pose, 0.025, false);
      return Math.hypot(pose.rotation.x, pose.rotation.z);
    });
    expect(strengths[1]).toBeCloseTo(strengths[0] / 4, 8);
  });

  it('coalesces coincident pressure and never stacks or extends its initial catch under spam', () => {
    const recoil = new WarriorContactRecoil();
    const pose = new Group();
    expect(recoil.trigger('execute', 0, 2)).toBe(true);
    for (let frame = 0; frame < 60; frame++) {
      if (frame < 4) expect(recoil.trigger('execute', 0, 2)).toBe(false);
      else recoil.trigger('execute', 0, 2);
      pose.rotation.set(0, 0, 0);
      pose.position.set(0, 0, 0);
      recoil.apply(pose, 1 / 60, false);
      expect(Math.hypot(pose.rotation.x, pose.rotation.z)).toBeLessThanOrEqual(0.16);
      expect(-pose.position.y).toBeLessThanOrEqual(0.055);
    }
    pose.rotation.set(0, 0, 0);
    pose.position.set(0, 0, 0);
    recoil.apply(pose, 0.4, false);
    expect(pose.rotation.x).toBe(0);
    expect(pose.rotation.z).toBe(0);
    expect(pose.position.y).toBe(0);
  });

  it('suppresses immediately for reduced motion/death and clears before pooled reuse', () => {
    for (const clear of [false, true]) {
      const recoil = new WarriorContactRecoil();
      const pose = new Group();
      recoil.trigger('storm_bolt', 0, 2);
      if (clear) recoil.clear();
      recoil.apply(pose, 0.02, !clear);
      recoil.apply(pose, 0.02, false);
      expect(pose.rotation.x).toBe(0);
      expect(pose.rotation.z).toBe(0);
      expect(pose.position.y).toBe(0);
    }
  });

  it('handles invalid deltas, dimensions and source coordinates without a nonfinite pose', () => {
    const recoil = new WarriorContactRecoil();
    const pose = new Group();
    for (const height of [0, -2, Number.NaN, Infinity])
      expect(recoil.trigger('shield_slam', 0, height)).toBe(false);
    recoil.trigger('shield_slam', 0, 2, new Group(), { x: Number.NaN, z: Infinity });
    for (const dt of [Number.NaN, Infinity, -0.5, 0, 0.025]) {
      pose.rotation.set(0, 0, 0);
      pose.position.set(0, 0, 0);
      recoil.apply(pose, dt, false);
      expect(
        [...pose.position.toArray(), pose.rotation.x, pose.rotation.y, pose.rotation.z].every(
          Number.isFinite,
        ),
      ).toBe(true);
    }
    pose.rotation.set(0, 0, 0);
    pose.position.set(0, 0, 0);
    recoil.apply(pose, 5, false);
    expect(pose.position.y).toBe(0);
  });

  it('does not accept unrelated actions, Red Harvest, buffs, bleeds or inherited object names', () => {
    const recoil = new WarriorContactRecoil();
    for (const id of [
      'red_harvest',
      'deep_wounds',
      'bloodhook',
      'sinister_strike',
      'avatar',
      'toString',
    ]) {
      expect(hasWarriorContactRecoil(id)).toBe(false);
      expect(recoil.trigger(id, 0, 2)).toBe(false);
    }
  });

  it('routes only confirmed nonperiodic Warrior contacts and preserves the old hitstop contract', () => {
    const visual = {
      respondToElement: vi.fn(),
      holdFrame: vi.fn(),
      receiveWarriorImpact: vi.fn(),
      receiveHarvestImpact: vi.fn(),
    };
    const target = visual as unknown as CharacterVisual;
    const source = { x: 2, z: 5 };
    impactContact(target, 'physical', 1.7, false, false, 'shield_slam', false, 0, source);
    expect(visual.receiveWarriorImpact).toHaveBeenCalledExactlyOnceWith('shield_slam', 0, source);
    expect(visual.holdFrame).toHaveBeenCalledOnce();
    expect(visual.holdFrame.mock.calls[0][0]).toBe(0.18);
    expect(visual.holdFrame.mock.calls[0][1]).toBeCloseTo(0.035, 10);
    visual.receiveWarriorImpact.mockClear();
    for (const [id, periodic, reduced] of [
      ['shield_slam', true, false],
      ['shield_slam', false, true],
      ['deep_wounds', false, false],
      ['sinister_strike', false, false],
      ['red_harvest', false, false],
    ] as const)
      impactContact(target, 'physical', 2, false, reduced, id, periodic, 2, source);
    expect(visual.receiveWarriorImpact).not.toHaveBeenCalled();
    expect(visual.receiveHarvestImpact).toHaveBeenCalledExactlyOnceWith(2, source);
  });
});
