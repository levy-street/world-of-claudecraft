// Balgath's circle telegraphs (src/render/balgath_ring_fx.ts): the Barrow Smash drawn with
// its safe gap from the sim's own fractions, his other circles drawn solid, and the router
// handing his named rings to this layer instead of the generic rune circle (whose inner
// ring and open band read as a refuge that was never there).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BalgathFx, routeBalgathSpellfxAt } from '../src/render/balgath_fx';
import { BALGATH_RING_ABILITIES } from '../src/render/balgath_fx_core';
import { BalgathRingFx } from '../src/render/balgath_ring_fx';
import { BARROW_SMASH_GAP, ringGapBands } from '../src/sim/boss_ring_gap';
import { HAMMER_ABILITY } from '../src/sim/mob/boss_slams';
import { WARPATH_WRECK_ABILITY } from '../src/sim/mob/warpath';

/** Every drawn vertex's distance from the ring centre, over the given meshes. */
function radii(meshes: THREE.Mesh[], cx: number, cz: number): number[] {
  const out: number[] = [];
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) out.push(Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz));
  }
  return out;
}

describe('BalgathRingFx', () => {
  it('draws the smash as a disc and a rim band with the gap left open, at the sim radii', () => {
    const scene = new THREE.Scene();
    const rings = new BalgathRingFx(scene, () => 0);
    rings.telegraph(100, 50, 12, 1.2, BARROW_SMASH_GAP);
    const group = scene.children[0] as THREE.Group;
    const meshes = group.children as THREE.Mesh[];
    const { disc, bandIn, bandOut } = ringGapBands(12, BARROW_SMASH_GAP);
    const r = radii(meshes, 100, 50);
    // Nothing is drawn strictly inside the gap: it is open ground, exactly where the sim
    // spares a player (insideRingGap is strict at both edges).
    const eps = 1e-3;
    expect(r.filter((d) => d > disc + eps && d < bandIn - eps)).toEqual([]);
    // ...and both the disc's edge and the band's inner edge are drawn.
    expect(r.some((d) => Math.abs(d - disc) < eps)).toBe(true);
    expect(r.some((d) => Math.abs(d - bandIn) < eps)).toBe(true);
    expect(Math.max(...r)).toBeCloseTo(bandOut, 4);
    // Every piece rides the encounter band of the floor ladder.
    for (const m of meshes) expect(m.renderOrder).toBeGreaterThan(0);
    expect(group.renderOrder).toBe(0);
  });

  it('draws his other circles solid, edge to centre', () => {
    const scene = new THREE.Scene();
    const rings = new BalgathRingFx(scene, () => 0);
    rings.telegraph(0, 0, 7, 1.2, null);
    const r = radii((scene.children[0] as THREE.Group).children as THREE.Mesh[], 0, 0);
    const sorted = [...new Set(r.map((d) => Math.round(d * 10) / 10))].sort((a, b) => a - b);
    // Rings of vertices from the centre out to the rim with no open band between.
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeLessThan(2.5);
    expect(Math.max(...r)).toBeCloseTo(7, 4);
  });

  it('retires on the landing and on its own after the windup, disposing what it built', () => {
    const scene = new THREE.Scene();
    const rings = new BalgathRingFx(scene, () => 0);
    rings.telegraph(0, 0, 12, 1.2, BARROW_SMASH_GAP);
    rings.telegraph(40, 0, 7, 1.2, null);
    rings.landed(0, 0);
    expect(rings.count()).toBe(1);
    rings.update(1.2 + 0.4, false);
    expect(rings.count()).toBe(0);
    expect(scene.children).toHaveLength(0);
  });
});

describe('the router hands his circles to this layer', () => {
  it('names exactly the rings the sim names', () => {
    expect([...BALGATH_RING_ABILITIES].sort()).toEqual(
      ['mob_pulse_windup', 'mob_stomp_windup', HAMMER_ABILITY, WARPATH_WRECK_ABILITY].sort(),
    );
  });

  it('claims a named Balgath ring and draws the smash with its gap', () => {
    const scene = new THREE.Scene();
    const fx = new BalgathFx(scene, () => 0);
    const at = () => [{ id: 7, templateId: 'balgath_cyclops' }];
    expect(
      routeBalgathSpellfxAt(
        {
          x: 0,
          z: 0,
          fx: 'runeCircle',
          radius: 12,
          sourceId: 7,
          ability: 'mob_pulse_windup',
          duration: 1.2,
        },
        fx,
        at,
      ),
    ).toBe(true);
    expect(fx.slamRings.count()).toBe(1);
    // A rift boss's anonymous ring is left to the generic circle.
    expect(
      routeBalgathSpellfxAt({ x: 0, z: 0, fx: 'runeCircle', radius: 12, duration: 1.2 }, fx, at),
    ).toBe(false);
    fx.dispose();
  });
});
