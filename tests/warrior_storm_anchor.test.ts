import { Vector3 } from 'three';
import { expect, it, vi } from 'vitest';
import { WARRIOR_STORM_TURN_RATE } from '../src/render/ability_vfx/held_warrior_storm';
import { WarriorStormAnchor } from '../src/render/ability_vfx/warrior_storm_anchor';
import type { WeaponAnchorSampler } from '../src/render/weapon_trail_anchor';

const at = { x: 7, y: 2, z: -4 };
const fallback = (elapsed: number, facing: number) =>
  facing + elapsed * WARRIOR_STORM_TURN_RATE - 2.3;

it('caches the mainhand sampler and reuses one owned destination across live weapon updates', () => {
  const anchor = new WarriorStormAnchor(17);
  const sample = vi.fn<WeaponAnchorSampler>((out) => {
    out.set(10, 4, 0);
    return true;
  });
  const resolve = vi.fn(() => sample);
  for (let frame = 0; frame < 120; frame++)
    expect(anchor.update(frame / 60, at, 1.7, frame / 60, resolve)).toBeCloseTo(
      Math.atan2(3, 4) - 2.3,
    );
  expect(resolve).toHaveBeenCalledExactlyOnceWith(17, 0);
  expect(sample).toHaveBeenCalledTimes(120);
  const destination = sample.mock.calls[0][0];
  expect(destination).toBeInstanceOf(Vector3);
  expect(sample.mock.calls.every(([out]) => out === destination)).toBe(true);
  expect(destination).not.toBe(at);
});

it('uses displayed weapon movement and rotation regardless of cast clock or facing', () => {
  const anchor = new WarriorStormAnchor(17);
  const tip = new Vector3(7, 10, 1);
  const sample: WeaponAnchorSampler = (out) => {
    out.copy(tip);
    return true;
  };
  const resolve = vi.fn(() => sample);
  expect(anchor.update(14, at, -2, 0, resolve)).toBeCloseTo(-2.3);
  tip.set(2, 10, -4);
  expect(anchor.update(99, at, 2.6, 1, resolve)).toBeCloseTo(-Math.PI / 2 - 2.3);
  const moved = { x: -20, y: 9, z: 30 };
  tip.set(moved.x + 4, moved.y + 2, moved.z - 3);
  expect(anchor.update(0, moved, 0, 2, resolve)).toBeCloseTo(Math.atan2(4, -3) - 2.3);
  expect(resolve).toHaveBeenCalledTimes(1);
});

it('retries missing equipment at bounded intervals and acquires it when available', () => {
  const anchor = new WarriorStormAnchor(17);
  const sample: WeaponAnchorSampler = (out) => {
    out.set(8, 3, -4);
    return true;
  };
  const resolve = vi.fn<() => WeaponAnchorSampler | null>(() => null);
  expect(anchor.update(0.2, at, 0.8, 0, resolve)).toBeCloseTo(fallback(0.2, 0.8));
  for (let tick = 1; tick <= 34; tick++) anchor.update(0.2, at, 0.8, tick / 100, resolve);
  expect(resolve).toHaveBeenCalledTimes(1);
  resolve.mockReturnValue(sample);
  expect(anchor.update(0.2, at, 0.8, 0.35, resolve)).toBeCloseTo(Math.PI / 2 - 2.3);
  expect(resolve).toHaveBeenCalledTimes(2);
});

it('drops an invalidated sampler and reacquires replacement equipment after the retry delay', () => {
  const anchor = new WarriorStormAnchor(17);
  let attached = true;
  const old = vi.fn<WeaponAnchorSampler>((out) => {
    out.set(7, 3, 0);
    return attached;
  });
  const replacement = vi.fn<WeaponAnchorSampler>((out) => {
    out.set(3, 3, -4);
    return true;
  });
  const resolve = vi.fn<() => WeaponAnchorSampler | null>(() => old);
  anchor.update(0, at, 0, 0, resolve);
  attached = false;
  expect(anchor.update(1, at, 0.4, 1, resolve)).toBeCloseTo(fallback(1, 0.4));
  resolve.mockReturnValue(replacement);
  for (let tick = 1; tick <= 34; tick++) anchor.update(1, at, 0.4, 1 + tick / 100, resolve);
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(old).toHaveBeenCalledTimes(2);
  expect(anchor.update(1, at, 0.4, 1.35, resolve)).toBeCloseTo(-Math.PI / 2 - 2.3);
  expect(resolve).toHaveBeenCalledTimes(2);
  expect(replacement).toHaveBeenCalledTimes(1);
});

it.each([
  [NaN, 3, 0],
  [8, Infinity, 0],
  [8, 3, -Infinity],
  [7, 30, -4],
  [7.05, 30, -3.95],
])('uses a bounded fallback for an invalid or vertically aligned tip %j', (x, y, z) => {
  const anchor = new WarriorStormAnchor(17);
  const sample = vi.fn<WeaponAnchorSampler>((out) => {
    out.set(x, y, z);
    return true;
  });
  const resolve = vi.fn(() => sample);
  expect(anchor.update(0.7, at, -0.2, 0, resolve)).toBeCloseTo(fallback(0.7, -0.2));
  anchor.update(0.7, at, -0.2, 0.2, resolve);
  expect(sample).toHaveBeenCalledTimes(1);
  expect(resolve).toHaveBeenCalledTimes(1);
});

it('supports missing resolvers and finite fallback output without retaining external positions', () => {
  const anchor = new WarriorStormAnchor(17);
  expect(anchor.update(2, at, 1, 0)).toBeCloseTo(fallback(2, 1));
  expect(anchor.update(NaN, at, Infinity, NaN)).toBe(-2.3);
  const other = new WarriorStormAnchor(18);
  const destinations = new Set<Vector3>();
  const resolve = () => (out: Vector3) => {
    destinations.add(out);
    out.set(8, 3, -4);
    return true;
  };
  anchor.update(0, at, 0, 1, resolve);
  other.update(0, at, 0, 1, resolve);
  expect(destinations.size).toBe(2);
});
