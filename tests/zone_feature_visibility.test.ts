import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createShadowVolumeBasis,
  SHADOW_CASTER_MARGIN,
  setShadowVolumeBasis,
  shadowVolumeIntersectsBox,
} from '../src/render/foliage_shadow_core';
import {
  type FeatureFootprint,
  featureEdgeDistance,
  hasUnseededInstanceMatrix,
  isZoneFeatureShadowCasting,
  isZoneFeatureVisible,
  zoneFeatureShadowRangeForHalfExtent,
  ZONE_FEATURE_SHADOW_BASE_HALF_EXTENT,
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

  it('stays inside the geometric reach of the shipped shadow volume', () => {
    // The derivation in the core's header, recomputed here from the SHIPPED
    // constants: the sun anchor and shadow camera in renderer.ts / gfx.ts, the
    // camera zoom cap in input.ts, and foliage_shadow_core's own caster margin
    // and volume test. Restating a number here would let the header rot.
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const gfx = readFileSync(new URL('../src/render/gfx.ts', import.meta.url), 'utf8');
    const input = readFileSync(new URL('../src/game/input.ts', import.meta.url), 'utf8');
    const half = Number(
      /this\.shadowBaseExtent = LOW_GFX \? [\d.]+ : ([\d.]+);/.exec(renderer)?.[1],
    );
    const near = Number(/sun\.shadow\.camera\.near = ([\d.]+)/.exec(renderer)?.[1]);
    const far = Number(/sun\.shadow\.camera\.far = ([\d.]+)/.exec(renderer)?.[1]);
    const anchor = /SUN_ANCHOR = new THREE\.Vector3\((-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\)/.exec(
      gfx,
    );
    const zoomCap = Number(
      /Math\.min\((\d+), Math\.max\(3, this\.camDist \+ delta\)\)/.exec(input)?.[1],
    );
    expect(half, 'shadow base half-extent not found in renderer.ts').toBeGreaterThan(0);
    expect(far, 'shadow camera far not found in renderer.ts').toBeGreaterThan(near);
    expect(anchor, 'SUN_ANCHOR not found in gfx.ts').not.toBe(null);
    expect(zoomCap, 'camera zoom cap not found in input.ts').toBeGreaterThan(0);

    const [ax, ay, az] = [Number(anchor?.[1]), Number(anchor?.[2]), Number(anchor?.[3])];
    const lightDistance = Math.hypot(ax, ay, az);
    const dir = { x: ax / lightDistance, y: ay / lightDistance, z: az / lightDistance };

    // Analytic strip: `half` across the light's right axis, half / sin(elevation)
    // along its azimuth, because the light-space up axis carries only
    // sin(elevation) of horizontal length. The corner of that strip is the
    // furthest a ground caster can sit from the shadow TARGET.
    const analytic = Math.hypot(half, half / dir.y);

    // The same reach found by the SHIPPED volume test, swept over azimuth, so
    // the analytic form above is checked against the code that actually culls.
    const basis = setShadowVolumeBasis(createShadowVolumeBasis(), {
      dirX: dir.x,
      dirY: dir.y,
      dirZ: dir.z,
      targetX: 0,
      targetY: 0,
      targetZ: 0,
      halfExtent: half,
      lightDistance,
      near,
      far,
    });
    // A POINT caster on the target's own ground plane, so the sweep measures
    // the volume itself; a real caster's own half-extents only add to it.
    const reaches = (d: number, ang: number): boolean =>
      shadowVolumeIntersectsBox(basis, d * Math.cos(ang), 0, d * Math.sin(ang), 0, 0, 0);
    let measured = 0;
    for (let i = 0; i < 720; i++) {
      const ang = (i / 720) * Math.PI * 2;
      let lo = 0;
      let hi = 2000;
      if (!reaches(lo, ang)) continue;
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        if (reaches(mid, ang)) lo = mid;
        else hi = mid;
      }
      measured = Math.max(measured, lo);
    }
    // The sweep sees the strip's corner only to its 0.5 degree resolution, so
    // it lands just short of the analytic corner and never past it.
    expect(measured).toBeLessThanOrEqual(analytic);
    expect(measured).toBeGreaterThan(analytic - 0.5);
    expect(analytic).toBeCloseTo(229.02, 2);

    // The decision measures from the camera, which trails the volume's centre
    // by up to the zoom cap, and the shed only commits past the hysteresis
    // band. So this is the range at which no legitimate caster could ever be
    // lost, and the shipped constant is deliberately INSIDE it.
    const neverLose = analytic + zoomCap + SHADOW_CASTER_MARGIN + ZONE_FEATURE_SHADOW_HYSTERESIS;
    expect(neverLose).toBeCloseTo(275.02, 2);
    expect(ZONE_FEATURE_SHADOW_RANGE).toBeLessThan(neverLose);
    // ...and never so far inside that a caster the player is standing beside
    // loses its shadow: the shed has to clear the volume's SHORT axis, which
    // is the plain half-extent.
    expect(ZONE_FEATURE_SHADOW_RANGE - ZONE_FEATURE_SHADOW_HYSTERESIS).toBeGreaterThan(half);
  });

  it('pins the shipped range and hysteresis to their literals', () => {
    // Every camera position below derives from these constants, so without
    // the literal pins the band tests hold under ANY values, including a
    // zero-width band that flaps castShadow across a whole town every frame.
    expect(ZONE_FEATURE_SHADOW_RANGE).toBe(220);
    expect(ZONE_FEATURE_SHADOW_BASE_HALF_EXTENT).toBe(105);
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

  it('scales the shadow-casting range with the live shadow extent shed', () => {
    const floorExtent = 67;
    const shedRange = zoneFeatureShadowRangeForHalfExtent(floorExtent);
    expect(shedRange).toBeCloseTo((ZONE_FEATURE_SHADOW_RANGE * floorExtent) / 105, 5);
    const camZ = farTown.centerZ + farTown.halfZ + shedRange + ZONE_FEATURE_SHADOW_HYSTERESIS + 1;
    expect(isZoneFeatureShadowCasting(farTown, 0, camZ, true, floorExtent)).toBe(false);
    expect(isZoneFeatureShadowCasting(farTown, 0, camZ, false, floorExtent)).toBe(false);
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
