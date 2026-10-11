import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GfxTier } from '../src/render/gfx';
import {
  HARBOR_ROUTE_MARKER_CRITICAL_PARTS,
  HARBOR_ROUTE_MARKER_OPTIONAL_PARTS,
  HARBOR_ROUTE_MARKER_TEXT_ON_EVERY_TIER,
  HARBOR_ROUTE_MARKER_TRIM_PARTS,
  type HarborRouteMarkerPlate,
  harborRouteMarkerParts,
  harborRouteMarkerPlateFan,
  harborRouteMarkerTextFaces,
} from '../src/render/harbor_route_marker_core';

// The harbor route marker's pure decisions (render/harbor_route_marker_core.ts):
// the graphics-fairness contract (the post, the arrow board, the anchor roundel
// and the destination name survive every preset; only trim and dressing shed),
// and the destination plate's shape and its two never-mirrored faces.

const TIERS: readonly GfxTier[] = ['low', 'medium', 'high', 'ultra', 'insane'];
const PLATE: HarborRouteMarkerPlate = {
  width: 2.66,
  height: 0.88,
  corner: 0.07,
  faceOffset: 0.126,
  textWidth: 0.9,
  textHeight: 0.62,
};

describe('harbor route marker tiers (fairness)', () => {
  it('keeps the post, the arrow board and the anchor roundel on every tier', () => {
    expect([...HARBOR_ROUTE_MARKER_CRITICAL_PARTS]).toEqual(['Post', 'SignBoard', 'MaritimeIcon']);
    for (const tier of TIERS) {
      const parts = harborRouteMarkerParts(tier);
      for (const part of HARBOR_ROUTE_MARKER_CRITICAL_PARTS) {
        expect(parts, `${tier} ${part}`).toContain(part);
      }
    }
    // and the destination name has no tier switch at all
    expect(HARBOR_ROUTE_MARKER_TEXT_ON_EVERY_TIER).toBe(true);
  });

  it('sheds only dressing: trim below medium, lantern, chain and rope below high', () => {
    expect(harborRouteMarkerParts('low')).toEqual([...HARBOR_ROUTE_MARKER_CRITICAL_PARTS]);
    expect(harborRouteMarkerParts('medium')).toEqual([
      ...HARBOR_ROUTE_MARKER_CRITICAL_PARTS,
      ...HARBOR_ROUTE_MARKER_TRIM_PARTS,
    ]);
    for (const tier of ['high', 'ultra', 'insane'] as const) {
      expect(harborRouteMarkerParts(tier)).toEqual([
        ...HARBOR_ROUTE_MARKER_CRITICAL_PARTS,
        ...HARBOR_ROUTE_MARKER_TRIM_PARTS,
        ...HARBOR_ROUTE_MARKER_OPTIONAL_PARTS,
      ]);
    }
    // every tier keeps at least what the tier below it keeps
    for (let i = 1; i < TIERS.length; i++) {
      const below = harborRouteMarkerParts(TIERS[i - 1]);
      const here = harborRouteMarkerParts(TIERS[i]);
      for (const part of below) expect(here, TIERS[i]).toContain(part);
    }
  });

  it('reads the static preset tier, never the frame-rate governor, and paints the name unconditionally', () => {
    const painter = readFileSync(
      path.join(__dirname, '../src/render/harbor_route_markers.ts'),
      'utf8',
    );
    expect(painter).toContain('harborRouteMarkerParts(GFX.effectsTier)');
    expect(painter).not.toMatch(/render_budget|governor\(|autoGovernor/);
    // the text planes come from the faces list with no tier test in between
    const build = painter.slice(painter.indexOf('export function buildHarborRouteMarker('));
    const textLoop = build.slice(0, build.indexOf('group.position.set'));
    expect(textLoop).toContain('harborRouteMarkerTextFaces(template.plate)');
    expect(textLoop).not.toMatch(/effectsTier|gfxTierAtLeast|GFX\.tier/);
  });
});

describe('harbor route marker destination plate', () => {
  it('draws two faces, front and back, the back turned (never mirrored)', () => {
    const faces = harborRouteMarkerTextFaces(PLATE);
    expect(faces).toEqual([
      { z: PLATE.faceOffset, yaw: 0 },
      { z: -PLATE.faceOffset, yaw: Math.PI },
    ]);
    // the back plane's reading direction (its local +x) runs along the sign's
    // -x, which is left to right for a player standing behind the board
    expect(Math.cos(faces[1].yaw)).toBeCloseTo(-1, 12);
    // and its face (local +z, turned by the yaw about y: z' = cos yaw) looks out
    // of the back, while the front's looks out of the front
    expect(Math.cos(faces[0].yaw)).toBeCloseTo(1, 12);
    expect(faces[1].z).toBeLessThan(0);
    expect(faces[0].z).toBeGreaterThan(0);
  });

  it('cuts the plate to the painted panel: clipped corners, UVs spanning the canvas', () => {
    const fan = harborRouteMarkerPlateFan(PLATE);
    expect(fan.positions.length / 3).toBe(9);
    expect(fan.uvs.length / 2).toBe(9);
    expect(fan.indices.length / 3).toBe(8);
    let area = 0;
    for (let t = 0; t < fan.indices.length; t += 3) {
      const [a, b, c] = [fan.indices[t], fan.indices[t + 1], fan.indices[t + 2]];
      const ax = fan.positions[a * 3];
      const ay = fan.positions[a * 3 + 1];
      const bx = fan.positions[b * 3];
      const by = fan.positions[b * 3 + 1];
      const cx = fan.positions[c * 3];
      const cy = fan.positions[c * 3 + 1];
      const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      expect(cross).toBeGreaterThan(0); // counter-clockwise: the plane faces +z
      area += cross / 2;
    }
    expect(area).toBeCloseTo(PLATE.width * PLATE.height - 2 * PLATE.corner ** 2, 9);
    for (let i = 0; i < fan.uvs.length; i++) {
      expect(fan.uvs[i]).toBeGreaterThanOrEqual(0);
      expect(fan.uvs[i]).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i < fan.positions.length; i += 3) {
      expect(Math.abs(fan.positions[i])).toBeLessThanOrEqual(PLATE.width / 2 + 1e-9);
      expect(Math.abs(fan.positions[i + 1])).toBeLessThanOrEqual(PLATE.height / 2 + 1e-9);
      expect(fan.positions[i + 2]).toBe(0);
    }
  });
});
