// Pins for the shared torch fire rig (src/render/dungeon_torch_rig.ts):
// the renderer contract (flame -> flames, light -> fireLights with
// baseIntensity only on the budgeted tier), and the placed-torch basket
// math the Ignivar dressing plan and placer preview both ride.
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addIgnivarPlacedTorchFires,
  addTorchFire,
  resetDungeonTorchRigCaches,
  type TorchFireSink,
} from '../src/render/dungeon_torch_rig';
import type { IgnivarPropPlacement } from '../src/render/ignivar_dressing_plan_core';

const COLORS = { flame: 0xffd06a, emissive: 0xe05a16, light: 0xff7a2e };
const HIGH = { flameEmissive: 3.2, lightDistance: 34, lightBaseIntensity: 46, glow: true };
const LOW = { flameEmissive: 1.6, lightDistance: 22, glow: false };

function makeSink(): TorchFireSink & { fireLights: THREE.PointLight[] } {
  return { group: new THREE.Group(), flames: [], fireLights: [] };
}

beforeEach(() => {
  resetDungeonTorchRigCaches();
});

describe('addTorchFire', () => {
  it('keeps the renderer contract: flame to flames, budgeted light to fireLights', () => {
    const sink = makeSink();
    addTorchFire(sink, {
      flame: [1, 6.6, 2],
      light: [1.5, 6.4, 2],
      colors: COLORS,
      tuning: HIGH,
    });
    expect(sink.flames).toHaveLength(1);
    expect(sink.flames[0].position.y).toBeCloseTo(6.6);
    expect(sink.fireLights).toHaveLength(1);
    const light = sink.fireLights[0];
    expect(light.userData.baseIntensity).toBe(46);
    expect(light.distance).toBe(34);
    expect(light.color.getHex()).toBe(COLORS.light);
    expect(sink.group.children).toContain(sink.flames[0]);
    expect(sink.group.children).toContain(light);
  });

  it('leaves the low tier light always-on (no baseIntensity)', () => {
    const sink = makeSink();
    addTorchFire(sink, { flame: [0, 1, 0], light: [0, 1.4, 0], colors: COLORS, tuning: LOW });
    expect(sink.fireLights[0].userData.baseIntensity).toBeUndefined();
    expect(sink.fireLights[0].distance).toBe(22);
  });

  it('shares one flame geometry across fires', () => {
    const sink = makeSink();
    addTorchFire(sink, { flame: [0, 1, 0], light: [0, 1, 0], colors: COLORS, tuning: LOW });
    addTorchFire(sink, { flame: [4, 1, 0], light: [4, 1, 0], colors: COLORS, tuning: LOW });
    expect(sink.flames[0].geometry).toBe(sink.flames[1].geometry);
  });
});

describe('addIgnivarPlacedTorchFires', () => {
  const torchAt = (x: number, z: number, scale: number, y = 0): IgnivarPropPlacement => ({
    key: 'torch',
    x,
    y,
    z,
    ry: 0,
    scale,
  });

  it('fires only torch placements and reports the count', () => {
    const sink = makeSink();
    const placements: IgnivarPropPlacement[] = [
      torchAt(4, -6, 1.6),
      { key: 'pillar_slim', x: 0, y: 0, z: 0, ry: 0, scale: 26 },
      torchAt(-4, 6, 3.2),
    ];
    expect(addIgnivarPlacedTorchFires(sink, placements, COLORS, LOW)).toBe(2);
    expect(sink.flames).toHaveLength(2);
    expect(sink.fireLights).toHaveLength(2);
  });

  it('anchors the fire at the basket and scales the flame to the kit torch', () => {
    const sink = makeSink();
    addIgnivarPlacedTorchFires(sink, [torchAt(10, 5, 3.2, 2)], COLORS, LOW);
    const rel = 3.2 / 1.6;
    const basketY = 2 + 0.99 * 3.2;
    expect(sink.flames[0].position.x).toBeCloseTo(10);
    expect(sink.flames[0].position.z).toBeCloseTo(5);
    expect(sink.flames[0].position.y).toBeCloseTo(basketY + 0.18 * rel);
    expect(sink.flames[0].scale.x).toBeCloseTo(rel);
    expect(sink.fireLights[0].position.y).toBeCloseTo(basketY + 0.4 * rel);
  });
});
