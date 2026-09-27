import * as THREE from 'three';
import { expect, it } from 'vitest';
import type { OverlaySprites } from '../src/render/ability_vfx/overlay_sprites';
import type { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import { WarriorReadinessShapes } from '../src/render/ability_vfx/warrior_readiness_shapes';
import { WARRIOR_READINESS as R } from '../src/render/warrior_readiness_core';

const cases = [
  { name: 'Battlecraft mainhand', bits: R.battle, hand: 0, offset: 0 },
  { name: 'Berserker mainhand', bits: R.berserker, hand: 0, offset: 0 },
  { name: 'Berserker offhand', bits: R.berserker, hand: 1, offset: 0.37 },
] as const;

function fixture(bits: number, hand: 0 | 1) {
  const shapes = new WarriorReadinessShapes();
  const frame = new THREE.Matrix4().makeRotationY(0.4).setPosition(3, 2, 4);
  const tip = new THREE.Vector3(0, 1.3, 0).applyMatrix4(frame);
  const lines: { points: number[][]; width: number; color: number; light: number }[] = [];
  const glows: Parameters<OverlaySprites['push']>[] = [];
  const ribbons = {
    appendHeld: (
      points: THREE.Vector3[],
      count: number,
      width: number,
      color: number,
      light: number,
    ) => {
      lines.push({
        points: points.slice(0, count).map((point) => point.toArray()),
        width,
        color,
        light,
      });
    },
  } as unknown as AbilityVfxRibbons;
  const overlay = {
    push: (...args: Parameters<OverlaySprites['push']>) => {
      glows.push(args);
    },
  } as unknown as OverlaySprites;
  return (time: number, reduced = false) => {
    lines.length = 0;
    glows.length = 0;
    shapes.draw(ribbons, overlay, frame, tip, bits, hand, true, time, reduced);
    return { lines: [...lines], glows: [...glows] };
  };
}

it.each(cases)(
  '$name fades away before its reflection wraps to the opposite blade end',
  ({ bits, hand, offset }) => {
    const draw = fixture(bits, hand);
    const middle = draw(0.5 / 0.6 - offset);
    expect(middle.lines).toHaveLength(2);
    expect(middle.glows).toHaveLength(1);
    expect(middle.lines.every((line) => line.light > 0.5)).toBe(true);
    expect(middle.glows[0][6]).toBeGreaterThan(0.1);
    for (const cycle of [1, 3, 12]) {
      for (const side of [-1, 1]) {
        const edge = draw(cycle / 0.6 - offset + side * 0.0001);
        for (const line of edge.lines) {
          expect(line.light).toBeGreaterThanOrEqual(0);
          expect(line.light).toBeLessThanOrEqual(0.01);
        }
        for (const glow of edge.glows) {
          expect(glow[6]).toBeGreaterThanOrEqual(0);
          expect(glow[6]).toBeLessThanOrEqual(0.01);
        }
      }
    }
  },
);

it.each(cases)(
  '$name keeps reduced-motion reflection position and intensity stable',
  ({ bits, hand }) => {
    const draw = fixture(bits, hand);
    const initial = draw(0, true);
    expect(initial.lines).toHaveLength(2);
    expect(initial.glows).toHaveLength(1);
    expect(initial.lines.every((line) => line.light > 0.5)).toBe(true);
    for (const time of [0.1, 0.7, 1 / 0.6 - 0.0001, 1 / 0.6 + 0.0001, 10, 100])
      expect(draw(time, true)).toEqual(initial);
  },
);
