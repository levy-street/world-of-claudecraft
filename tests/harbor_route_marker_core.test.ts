import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type GfxTier, gfxInternalsForTest } from '../src/render/gfx';
import {
  HARBOR_ROUTE_MARKER_CRITICAL_PARTS,
  HARBOR_ROUTE_MARKER_OPTIONAL_PARTS,
  HARBOR_ROUTE_MARKER_PLATE_CANVAS,
  HARBOR_ROUTE_MARKER_PLATE_CANVAS_IOS,
  HARBOR_ROUTE_MARKER_TEXT_ON_EVERY_TIER,
  HARBOR_ROUTE_MARKER_TRIM_PARTS,
  type HarborRouteMarkerPlate,
  harborRouteMarkerParts,
  harborRouteMarkerPlateCanvasSize,
  harborRouteMarkerPlateFan,
  harborRouteMarkerPlateFontPx,
  harborRouteMarkerPlatePaint,
  harborRouteMarkerTextFaces,
} from '../src/render/harbor_route_marker_core';

// The harbor route marker's pure decisions (render/harbor_route_marker_core.ts):
// the graphics-fairness contract (the post, the arrow board, the anchor roundel
// and the destination name survive every preset; only trim and dressing shed),
// the destination plate's shape and its two never-mirrored faces, and the plate
// canvas per memory profile (half size on the iOS memory profile, every paint
// metric scaled with it, today's canvas and metrics everywhere else).

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

/** The fit loop the painter ran before the plate size became per profile,
 *  verbatim with its literals: the full-size arm must choose exactly this. */
function fitBeforeTheProfile(start: number, fits: (px: number) => boolean): number {
  let size = start;
  let set = size;
  do {
    set = size;
    if (fits(size)) break;
    size -= 4;
  } while (size > 28);
  return set;
}

/** A proportional stand-in for measureText: a name `advance` px wide per font px. */
const fitsWithin =
  (advance: number, maxW: number) =>
  (px: number): boolean =>
    px * advance <= maxW;

// every hint arm the profile resolver tells apart, split by the flag this reads
const IOS_HINTS = [{ platform: 'ios' as const }, { platform: 'ios' as const, tightMemory: true }];
const OTHER_HINTS = [
  undefined,
  { platform: 'android' as const },
  { platform: 'other' as const },
  // a constrained Android phone: constrainedMemory, but not the iOS memory profile
  {
    platform: 'android' as const,
    maxTouchPoints: 5,
    coarsePointer: true,
    narrowViewport: true,
    deviceMemory: 2,
  },
];
const FULL_PAINT = {
  keylineWidth: 6,
  keylineInset: 22,
  liftX: 2,
  liftY: 3,
  minFontPx: 28,
  fontStepPx: 4,
};

describe('harbor route marker plate canvas per memory profile', () => {
  it('keeps the 1024x340 canvas and the same paint metrics off the iOS memory profile', () => {
    expect(HARBOR_ROUTE_MARKER_PLATE_CANVAS).toEqual({ width: 1024, height: 340 });
    for (const tier of TIERS) {
      for (const hints of OTHER_HINTS) {
        const settings = gfxInternalsForTest.settingsFor(tier, hints);
        const at = `${tier} ${JSON.stringify(hints ?? null)}`;
        expect(settings.iosMemoryProfile, at).toBe(false);
        const size = harborRouteMarkerPlateCanvasSize(settings);
        expect(size, at).toEqual({ width: 1024, height: 340 });
        expect(harborRouteMarkerPlatePaint(size.height), at).toEqual(FULL_PAINT);
      }
    }
  });

  it('paints at 512x170 with every metric halved on the iOS memory profile, tight rung included', () => {
    expect(HARBOR_ROUTE_MARKER_PLATE_CANVAS_IOS).toEqual({ width: 512, height: 170 });
    for (const tier of TIERS) {
      const [ios, tight] = IOS_HINTS.map((hints) => gfxInternalsForTest.settingsFor(tier, hints));
      expect(ios.iosMemoryProfile, tier).toBe(true);
      expect(tight.iosMemoryProfile, tier).toBe(true);
      expect(tight.tightMemory, tier).toBe(true);
      const size = harborRouteMarkerPlateCanvasSize(ios);
      expect(size, tier).toEqual({ width: 512, height: 170 });
      expect(harborRouteMarkerPlateCanvasSize(tight), tier).toEqual(size);
      expect(harborRouteMarkerPlatePaint(size.height), tier).toEqual({
        keylineWidth: 3,
        keylineInset: 11,
        liftX: 1,
        liftY: 1.5,
        minFontPx: 14,
        fontStepPx: 2,
      });
    }
  });

  it('keeps the aspect, so the plate UVs frame the same paint, on a quarter of the texels', () => {
    const full = HARBOR_ROUTE_MARKER_PLATE_CANVAS;
    const ios = HARBOR_ROUTE_MARKER_PLATE_CANVAS_IOS;
    expect(ios.width / ios.height).toBe(full.width / full.height);
    expect(ios.width * ios.height * 4).toBe(full.width * full.height);
    // the lettering box is a share of the canvas: it scales with it too
    const paint = harborRouteMarkerPlatePaint(ios.height);
    const fullPaint = harborRouteMarkerPlatePaint(full.height);
    for (const key of Object.keys(fullPaint) as (keyof typeof fullPaint)[]) {
      expect(paint[key] / fullPaint[key], key).toBe(ios.height / full.height);
    }
  });
});

describe('harbor route marker plate lettering fit', () => {
  it('chooses exactly what the fit loop chose before, at full size', () => {
    const full = HARBOR_ROUTE_MARKER_PLATE_CANVAS;
    const paint = harborRouteMarkerPlatePaint(full.height);
    const start = Math.round(full.height * PLATE.textHeight);
    const maxW = full.width * PLATE.textWidth;
    // from a short name that fits at once to one that never fits, past the floor
    for (let advance = 0.5; advance <= 60; advance += 0.25) {
      const fits = fitsWithin(advance, maxW);
      expect(harborRouteMarkerPlateFontPx(start, paint, fits), `${advance}`).toBe(
        fitBeforeTheProfile(start, fits),
      );
    }
  });

  it('shrinks a long name in step with the canvas at half size, never below the floor', () => {
    const full = HARBOR_ROUTE_MARKER_PLATE_CANVAS;
    const ios = HARBOR_ROUTE_MARKER_PLATE_CANVAS_IOS;
    const fullPaint = harborRouteMarkerPlatePaint(full.height);
    const iosPaint = harborRouteMarkerPlatePaint(ios.height);
    const fullStart = Math.round(full.height * PLATE.textHeight);
    const iosStart = Math.round(ios.height * PLATE.textHeight);
    expect(iosStart).toBe(105);
    // "Las Tierras del Dragón" (es, the longest destination in any locale)
    // measures about 12.9 px per font px in Cinzel bold: the loop runs at both sizes
    for (const advance of [5, 9, 12.9, 20]) {
      const onFull = harborRouteMarkerPlateFontPx(
        fullStart,
        fullPaint,
        fitsWithin(advance, full.width * PLATE.textWidth),
      );
      const onIos = harborRouteMarkerPlateFontPx(
        iosStart,
        iosPaint,
        fitsWithin(advance, ios.width * PLATE.textWidth),
      );
      expect(onFull, `${advance}`).toBeLessThan(fullStart);
      // the same share of the plate: half the font, within one half-size step
      expect(Math.abs(onIos - onFull / 2), `${advance}`).toBeLessThanOrEqual(iosPaint.fontStepPx);
      expect(onIos * advance, `${advance}`).toBeLessThanOrEqual(ios.width * PLATE.textWidth);
    }
    // a name too long for any size stops at the last size above the floor on
    // both arms (the painter's fillText maxWidth then squeezes it)
    const never = () => false;
    expect(harborRouteMarkerPlateFontPx(fullStart, fullPaint, never)).toBe(31);
    expect(harborRouteMarkerPlateFontPx(iosStart, iosPaint, never)).toBe(15);
    expect(harborRouteMarkerPlateFontPx(iosStart, iosPaint, never)).toBeGreaterThan(
      iosPaint.minFontPx,
    );
  });

  it('keeps a name that fits at the start size unchanged', () => {
    const paint = harborRouteMarkerPlatePaint(HARBOR_ROUTE_MARKER_PLATE_CANVAS_IOS.height);
    const tried: number[] = [];
    const size = harborRouteMarkerPlateFontPx(105, paint, (px) => {
      tried.push(px);
      return true;
    });
    expect(size).toBe(105);
    expect(tried).toEqual([105]);
  });
});
