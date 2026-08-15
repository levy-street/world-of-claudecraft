import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type FeatureFootprint,
  featureEdgeDistance,
  hasUnseededInstanceMatrix,
  isZoneFeatureShadowCasting,
  isZoneFeatureVisible,
  ZONE_FEATURE_SHADOW_HYSTERESIS,
  ZONE_FEATURE_SHADOW_RANGE,
} from '../src/render/zone_feature_visibility_core';

// The Willowfen's feature group, roughly: a zone-spanning band of geometry in
// the x[-540,-180] z[180,700] rectangle. Measured live at 17,214,888 triangles,
// submitted every frame from anywhere in the world because zone features were
// frustum-culled and nothing more.
const FEN: FeatureFootprint = { centerX: -360, centerZ: 440, halfX: 180, halfZ: 260 };

describe('zone feature distance visibility', () => {
  it('measures to the footprint EDGE, not its centre', () => {
    // The distinction is load-bearing: these groups can be hundreds of yards
    // across, so a centre-distance test would hide a hedge maze the player is
    // standing at the corner of. Just inside the west edge:
    expect(featureEdgeDistance(FEN, -539, 440)).toBe(0);
    expect(isZoneFeatureVisible(FEN, -539, 440, 165)).toBe(true);
    // ...and 100 yd east of the east edge is 100, not ~280 from the centre.
    expect(featureEdgeDistance(FEN, -80, 440)).toBe(100);
  });

  it('hides a group the fog has already swallowed, at the measured positions', () => {
    // The Evergarden spot the 28.5M reading came from. 740 yd from the
    // Willowfen against a garden fog far of 630, so all 17.2M of its triangles
    // were being submitted to draw exactly zero pixels.
    expect(featureEdgeDistance(FEN, 442, 1102)).toBeCloseTo(740.6, 1);
    expect(isZoneFeatureVisible(FEN, 442, 1102, 630)).toBe(false);

    // The Drakelands, right across the map: 1500 yd, hidden under any preset.
    expect(featureEdgeDistance(FEN, 360, 2100)).toBeCloseTo(1500.5, 1);
    expect(isZoneFeatureVisible(FEN, 360, 2100, 850)).toBe(false);

    // But the cull stays conservative where it genuinely is close. The Mirefen
    // spot is 162 yd out against a marsh far of 165, so it still draws: this
    // hides only what the fog had already made invisible, never anything the
    // player could have seen.
    expect(featureEdgeDistance(FEN, -18, 256)).toBe(162);
    expect(isZoneFeatureVisible(FEN, -18, 256, 165)).toBe(true);
  });

  it('uses the same boundary as the terrain cull, so ground and props agree', () => {
    // terrain.ts hides a chunk at `distance < fogFar`; a feature standing on
    // ground that is no longer drawn must not outlive it.
    expect(isZoneFeatureVisible(FEN, -80, 440, 100)).toBe(false);
    expect(isZoneFeatureVisible(FEN, -80, 440, 100.5)).toBe(true);
  });

  it('is diagonal-aware rather than axis-aligned', () => {
    // Off the north-east corner: 3-4-5 from the corner, not the larger of the
    // two axis gaps.
    expect(featureEdgeDistance(FEN, -180 + 30, 700 + 40)).toBeCloseTo(50, 9);
  });

  it('keeps a group visible when its bounds could not be measured', () => {
    // An empty group yields no Box3, and blanking a feature because we failed
    // to measure it would be a far worse failure than drawing it.
    expect(isZoneFeatureVisible(null, 0, 0, 1)).toBe(true);
    expect(isZoneFeatureVisible(null, 99_400, 0, 45)).toBe(true);
  });

  it('never hides a group the player is standing inside', () => {
    for (const far of [45, 100, 165, 630]) {
      expect(isZoneFeatureVisible(FEN, FEN.centerX, FEN.centerZ, far)).toBe(true);
    }
  });
});

describe('zone-feature shadow casting range', () => {
  // A neighbour town's footprint, well outside the 105 yd sun shadow volume.
  const farTown: FeatureFootprint = { centerX: 0, centerZ: 300, halfX: 40, halfZ: 40 };

  it('pins the shipped range and hysteresis to their literals', () => {
    // Every camera position below derives from these constants, so without
    // the literal pins the band tests hold under ANY values, including a
    // zero-width band that flaps castShadow across a whole town every frame.
    expect(ZONE_FEATURE_SHADOW_RANGE).toBe(220);
    expect(ZONE_FEATURE_SHADOW_HYSTERESIS).toBe(20);
  });

  it('casts inside the range and stops beyond it', () => {
    // Standing next to the town: edge distance ~0.
    expect(isZoneFeatureShadowCasting(farTown, 0, 320, true)).toBe(true);
    // Standing a valley away: nothing this group casts can land inside the
    // 105 yd shadow volume, so the shadow pass must not redraw it.
    expect(isZoneFeatureShadowCasting(farTown, 0, 900, true)).toBe(false);
    expect(isZoneFeatureShadowCasting(farTown, 0, 900, false)).toBe(false);
  });

  it('holds the prior state inside the hysteresis band', () => {
    // Edge distance exactly ZONE_FEATURE_SHADOW_RANGE: inside the band, so
    // both prior states persist rather than flapping per frame.
    const camZ = farTown.centerZ + farTown.halfZ + ZONE_FEATURE_SHADOW_RANGE;
    expect(isZoneFeatureShadowCasting(farTown, 0, camZ, true)).toBe(true);
    expect(isZoneFeatureShadowCasting(farTown, 0, camZ, false)).toBe(false);
    // Strictly inside the band on the far side: both prior states must still
    // persist (a zero-width band would already commit here).
    const midBand = camZ + ZONE_FEATURE_SHADOW_HYSTERESIS / 2;
    expect(isZoneFeatureShadowCasting(farTown, 0, midBand, true)).toBe(true);
    expect(isZoneFeatureShadowCasting(farTown, 0, midBand, false)).toBe(false);
    // Past the band edge the state commits regardless of history.
    const beyond = camZ + ZONE_FEATURE_SHADOW_HYSTERESIS + 1;
    expect(isZoneFeatureShadowCasting(farTown, 0, beyond, true)).toBe(false);
    const inside =
      farTown.centerZ +
      farTown.halfZ +
      ZONE_FEATURE_SHADOW_RANGE -
      ZONE_FEATURE_SHADOW_HYSTERESIS -
      1;
    expect(isZoneFeatureShadowCasting(farTown, 0, inside, false)).toBe(true);
  });

  it('always casts when the footprint could not be measured', () => {
    expect(isZoneFeatureShadowCasting(null, 0, 9999, false)).toBe(true);
  });

  it('is consumed by the per-frame feature sweep, toggling castShadow on state flips only', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const start = source.indexOf('private updateZoneFeatureVisibility(');
    expect(start).toBeGreaterThan(-1);
    const method = source.slice(start, source.indexOf('\n  private ensureZoneFeatures(', start));
    expect(method).toContain('isZoneFeatureShadowCasting(');
    // The per-mesh castShadow writes happen only on a state flip, never as a
    // steady per-frame traversal.
    expect(method).toContain('if (casting !== entry.shadowCasting)');
  });
});

describe('unseeded instance-matrix guard', () => {
  // Simulates an InstancedMesh instanceMatrix buffer: 16 floats per instance.
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const placedAt = (x: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 4, z, 1];

  it('flags a factory all-zero matrix anywhere in the buffer', () => {
    // The seabird-flock failure mode: instances placed only by a per-frame
    // update leave fresh zeros at attach, parking the measured footprint at
    // the world origin.
    const oneUnseeded = [...placedAt(-30, 1330), ...new Array(16).fill(0), ...identity];
    expect(hasUnseededInstanceMatrix(oneUnseeded, 3)).toBe(true);
  });

  it('accepts fully seeded buffers, identity placements included', () => {
    const seeded = [...placedAt(-70, 1155), ...identity, ...placedAt(125, 1085)];
    expect(hasUnseededInstanceMatrix(seeded, 3)).toBe(false);
  });

  it('ignores capacity beyond the live instance count', () => {
    // An InstancedMesh allocated with headroom keeps zeros past count; only
    // the live instances matter.
    const withHeadroom = [...placedAt(10, 20), ...new Array(16).fill(0)];
    expect(hasUnseededInstanceMatrix(withHeadroom, 1)).toBe(false);
    expect(hasUnseededInstanceMatrix(withHeadroom, 2)).toBe(true);
  });
});
