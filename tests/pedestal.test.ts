// Procedural stone dais for the char-window preview (Phase 2b; re-tiered for
// the paperdoll rework, same doc directory). Plain THREE geometry/material, no
// WebGL, so it runs headless in Node (mirrors tests/door_portal.test.ts, the
// sibling procedural-geometry builder test).
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildPedestal, disposePedestal } from '../src/render/characters/pedestal';

const meshes = (group: THREE.Group): THREE.Mesh[] =>
  group.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);

const cylinders = (group: THREE.Group): THREE.Mesh[] =>
  meshes(group).filter((m) => m.geometry.type === 'CylinderGeometry');

describe('buildPedestal', () => {
  it('returns a Group of exactly four meshes: three tiered dais bodies and a rim', () => {
    const p = buildPedestal();
    expect(p).toBeInstanceOf(THREE.Group);
    const ms = meshes(p);
    expect(ms.length).toBe(4);
    // Three stacked, tapered stone tiers (the stepped/tiered top the mockup
    // shows) plus the rim torus tracing the topmost tier's edge.
    expect(cylinders(p).length).toBe(3);
    expect(ms.some((m) => m.geometry.type === 'TorusGeometry')).toBe(true);
  });

  it('stacks the three tiers widest-at-bottom to narrowest-at-top (a chunky stone dais, not a flat disc)', () => {
    const p = buildPedestal();
    const tiers = cylinders(p) as (THREE.Mesh & { geometry: THREE.CylinderGeometry })[];
    // Sort by the geometry's own bottomRadius parameter, descending, so the
    // assertion does not depend on child insertion order.
    const byBottomRadius = [...tiers].sort(
      (a, b) => b.geometry.parameters.radiusBottom - a.geometry.parameters.radiusBottom,
    );
    const [base, mid, top] = byBottomRadius;
    expect(base.geometry.parameters.radiusBottom).toBeGreaterThan(
      mid.geometry.parameters.radiusBottom,
    );
    expect(mid.geometry.parameters.radiusBottom).toBeGreaterThan(
      top.geometry.parameters.radiusBottom,
    );
    // Each tier's own bottom radius fits within the tier below's TOP radius,
    // so the tier below's top face is exposed as a visible stepped ring.
    expect(mid.geometry.parameters.radiusBottom).toBeLessThanOrEqual(
      base.geometry.parameters.radiusTop,
    );
    expect(top.geometry.parameters.radiusBottom).toBeLessThanOrEqual(
      mid.geometry.parameters.radiusTop,
    );
    // Wider AND taller than the original single-tier build (radiusBottom 1.25,
    // total height 0.22): the mockup's "wider radius... more height" ask.
    expect(base.geometry.parameters.radiusBottom).toBeGreaterThan(1.25);
    const totalHeight = tiers.reduce((sum, t) => sum + t.geometry.parameters.height, 0);
    expect(totalHeight).toBeGreaterThan(0.22);
  });

  it('places the top surface at local y = 0 (the documented drop-under-feet invariant)', () => {
    const p = buildPedestal();
    // The group's own origin is unshifted (the CharacterPreview caller positions
    // it); the invariant is that the TOPMOST tier's top surface is the local
    // origin, so every tier is pushed at/below y=0 and the rim rides the top
    // tier's edge at y=0.
    expect(p.position.y).toBe(0);
    const tiers = cylinders(p) as (THREE.Mesh & { geometry: THREE.CylinderGeometry })[];
    const topTier = tiers.reduce((a, b) =>
      a.geometry.parameters.radiusBottom < b.geometry.parameters.radiusBottom ? a : b,
    );
    const topFaceY = topTier.position.y + topTier.geometry.parameters.height / 2;
    expect(topFaceY).toBeCloseTo(0, 5);
    for (const t of tiers) expect(t.position.y).toBeLessThanOrEqual(0);
    const rim = meshes(p).find((m) => m.geometry.type === 'TorusGeometry') as THREE.Mesh;
    expect(rim.position.y).toBe(0);
  });

  it('builds a fresh, non-shared instance each call (safe to dispose per instance)', () => {
    const a = buildPedestal();
    const b = buildPedestal();
    // Distinct geometry objects, unlike the shared per-asset caches elsewhere in
    // src/render/characters; this is what makes disposePedestal safe.
    expect(meshes(a)[0].geometry).not.toBe(meshes(b)[0].geometry);
  });
});

describe('disposePedestal', () => {
  it('disposes every mesh geometry and material', () => {
    const p = buildPedestal();
    const geoSpies = meshes(p).map((m) => vi.spyOn(m.geometry, 'dispose'));
    // Each tier mesh reuses one side material twice in its [side, top, side]
    // array, so dedupe before spying: sideMat.dispose() being called twice is a
    // fine idempotent no-op, we only assert each UNIQUE material got disposed.
    const uniqueMats = new Set<THREE.Material>();
    for (const m of meshes(p)) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) uniqueMats.add(mat);
    }
    const matSpies = [...uniqueMats].map((mat) => vi.spyOn(mat, 'dispose'));

    disposePedestal(p);

    for (const s of geoSpies) expect(s).toHaveBeenCalled();
    for (const s of matSpies) expect(s).toHaveBeenCalled();
  });
});
