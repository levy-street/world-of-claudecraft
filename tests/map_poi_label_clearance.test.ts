// The POI-label-vs-navigation-badge clearance rule (map_poi_label_clearance_core)
// plus its wiring into the overworld map model: a delve door authored on a
// named place (Collapsed Reliquary on Reliquary Hill, Eastbrook Vale) must not
// paint its badge over the label text.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import { DELVES, PROPS, STATIONS, ZONES } from '../src/sim/data';
import { MAP_MARKER_SIZES } from '../src/ui/map_marker_icon_art';
import type { MapMarkerProfile } from '../src/ui/map_marker_profile_core';
import {
  clearPoiLabelsOffBadges,
  MAP_POI_LABEL_BADGE_GAP,
  MAP_POI_LABEL_HEIGHT_BY_PROFILE,
  poiLabelTouchesBadge,
} from '../src/ui/map_poi_label_clearance_core';
import { buildOverworldMapModel, type OverworldMapInput } from '../src/ui/map_window_view';
import type { IWorld } from '../src/world_api';

const SIZE = 22;
const HEIGHT = 13;

describe('the constants the rule is fed', () => {
  it("pins the label heights to the painter's per-profile label font px", () => {
    expect(MAP_POI_LABEL_HEIGHT_BY_PROFILE).toEqual({ standard: 13, compact: 20 });
    // Derived from the painter source with comments stripped, so a font bump
    // there fails here instead of drifting the clearance band silently.
    const painter = readFileSync('src/ui/map_window_painter.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const standard = painter.match(/const LABEL_FONT = 'bold (\d+)px/);
    const compact = painter.match(/labelFont: 'bold (\d+)px/);
    expect(Number(standard?.[1])).toBe(MAP_POI_LABEL_HEIGHT_BY_PROFILE.standard);
    expect(Number(compact?.[1])).toBe(MAP_POI_LABEL_HEIGHT_BY_PROFILE.compact);
  });

  it('pins the gap, and every navigation badge size id the painter may pick per profile', () => {
    expect(MAP_POI_LABEL_BADGE_GAP).toBe(8);
    const ids = Object.keys(MAP_MARKER_SIZES).filter((id) => id.startsWith('mapNavigation'));
    expect(ids.length).toBeGreaterThan(2);
    for (const id of ids) {
      const compact = id.endsWith('Compact');
      expect(MAP_MARKER_SIZES[id as keyof typeof MAP_MARKER_SIZES], id).toBe(
        MAP_MARKER_SIZES[compact ? 'mapNavigationCompact' : 'mapNavigation'],
      );
    }
  });
});

describe('poiLabelTouchesBadge', () => {
  it('a badge centered on the label anchor covers the label', () => {
    expect(poiLabelTouchesBadge({ mx: 100, my: 100 }, { mx: 100, my: 100 }, SIZE, HEIGHT)).toBe(
      true,
    );
  });

  it('a badge sitting wholly under the baseline, or wholly above the cap, does not', () => {
    // badge top at 100 + 11 - 11 = 100: touching the baseline edge is not overlap
    expect(poiLabelTouchesBadge({ mx: 100, my: 100 }, { mx: 100, my: 111 }, SIZE, HEIGHT)).toBe(
      false,
    );
    expect(poiLabelTouchesBadge({ mx: 100, my: 100 }, { mx: 100, my: 76 }, SIZE, HEIGHT)).toBe(
      false,
    );
    expect(poiLabelTouchesBadge({ mx: 100, my: 100 }, { mx: 100, my: 110 }, SIZE, HEIGHT)).toBe(
      true,
    );
  });

  it('a badge far to the side is a neighbour, not a cover (reach = half + label height)', () => {
    expect(poiLabelTouchesBadge({ mx: 100, my: 100 }, { mx: 125, my: 100 }, SIZE, HEIGHT)).toBe(
      false,
    );
    expect(poiLabelTouchesBadge({ mx: 100, my: 100 }, { mx: 124, my: 100 }, SIZE, HEIGHT)).toBe(
      true,
    );
    // The reach scales with the label height, not a fixed 13.
    expect(poiLabelTouchesBadge({ mx: 100, my: 100 }, { mx: 128, my: 100 }, SIZE, 20)).toBe(true);
    expect(poiLabelTouchesBadge({ mx: 100, my: 100 }, { mx: 128, my: 100 }, SIZE, HEIGHT)).toBe(
      false,
    );
    // Adjacent positive control for the "wholly above the cap" side.
    expect(poiLabelTouchesBadge({ mx: 100, my: 100 }, { mx: 100, my: 77 }, SIZE, HEIGHT)).toBe(
      true,
    );
  });
});

describe('clearPoiLabelsOffBadges', () => {
  const drawn = (o: { mx: number; labelMy: number }) => ({ mx: o.mx, my: o.labelMy });

  it('lifts a covered label so its whole band sits above the badge, and keeps the rest', () => {
    const labels = [
      { mx: 100, my: 100, id: 'covered' },
      { mx: 300, my: 300, id: 'free' },
    ];
    const out = clearPoiLabelsOffBadges(labels, [{ mx: 100, my: 100 }], SIZE, HEIGHT);
    expect(out[1]).toEqual({ mx: 300, my: 300, labelMy: 300, id: 'free' });
    expect(out[0]).toEqual({
      mx: 100,
      my: 100, // the authored projection survives for the a11y summary
      labelMy: 100 - SIZE / 2 - MAP_POI_LABEL_BADGE_GAP,
      id: 'covered',
    });
    expect(poiLabelTouchesBadge(drawn(out[0]), { mx: 100, my: 100 }, SIZE, HEIGHT)).toBe(false);
  });

  it('drops the label under the badge when lifting would leave the canvas', () => {
    const out = clearPoiLabelsOffBadges([{ mx: 50, my: 14 }], [{ mx: 50, my: 14 }], SIZE, HEIGHT);
    expect(out[0].labelMy).toBe(14 + SIZE / 2 + MAP_POI_LABEL_BADGE_GAP + HEIGHT);
    expect(out[0].my).toBe(14);
    expect(poiLabelTouchesBadge(drawn(out[0]), { mx: 50, my: 14 }, SIZE, HEIGHT)).toBe(false);
  });

  it('with no badges every label draws at its authored baseline', () => {
    const out = clearPoiLabelsOffBadges([{ mx: 1, my: 2 }], [], SIZE, HEIGHT);
    expect(out).toEqual([{ mx: 1, my: 2, labelMy: 2 }]);
  });

  it('is idempotent: a second pass over the drawn baselines moves nothing', () => {
    const badge = [{ mx: 100, my: 100 }];
    const once = clearPoiLabelsOffBadges([{ mx: 100, my: 100 }], badge, SIZE, HEIGHT).map(drawn);
    const twice = clearPoiLabelsOffBadges(once, badge, SIZE, HEIGHT);
    expect(twice[0].labelMy).toBe(once[0].my);
  });
});

describe('overworld map model: Reliquary Hill under the Collapsed Reliquary door', () => {
  const zone = ZONES.find((z) => z.id === 'eastbrook_vale') as (typeof ZONES)[number];
  const poiIndex = zone.pois.findIndex((p) => p.id === 'reliquary_hill');
  const CANVAS = 560;

  function world(): IWorld {
    const player = { id: 1, kind: 'player', name: 'Me', pos: { x: 0, z: 0 }, facing: 0 };
    return {
      player,
      entities: new Map([[1, player]]),
      socialInfo: null,
      delveRun: null,
      cfg: { seed: 42, playerClass: 'warrior' },
      playerId: 1,
      questState: () => 'unavailable',
      questLog: new Map(),
      questsDone: new Set<string>(),
      craftingIdentity: { version: 1, synced: false, cadenceBlockedQuests: [] },
      inventory: [],
      gatheringProficiency: {},
      nodeHarvestableByMe: () => true,
      stationPlacements: STATIONS,
      civicServicePlacements: [],
      farmPatches: FARM_PATCHES,
    } as unknown as IWorld;
  }

  function input(markerProfile?: MapMarkerProfile, inZone = zone): OverworldMapInput {
    return {
      world: world(),
      props: PROPS,
      zone: inZone,
      zoom: 1,
      center: null,
      canvasSize: CANVAS,
      decorations: [],
      markerProfile,
    };
  }

  it('the door is authored on the named place (the premise of the report)', () => {
    expect(poiIndex).toBeGreaterThanOrEqual(0);
    const poi = zone.pois[poiIndex];
    expect(DELVES.collapsed_reliquary.doorPos).toEqual({ x: poi.x, z: poi.z });
  });

  it.each(['standard', 'compact'] as const)('%s: the label band clears the badge', (profile) => {
    const model = buildOverworldMapModel(input(profile));
    const label = model.pois.find((p) => p.poiIndex === poiIndex);
    const badge = model.navigation.find(
      (n) => n.kind === 'delve-entrance' && n.delveId === 'collapsed_reliquary',
    );
    if (!label || !badge) throw new Error('label and badge must both project');
    const size = MAP_MARKER_SIZES[profile === 'compact' ? 'mapNavigationCompact' : 'mapNavigation'];
    const height = MAP_POI_LABEL_HEIGHT_BY_PROFILE[profile];
    expect(poiLabelTouchesBadge({ mx: label.mx, my: label.labelMy }, badge, size, height)).toBe(
      false,
    );
    // Lifted above, not thrown elsewhere: same column, baseline just over the badge top.
    expect(label.mx).toBe(badge.mx);
    expect(label.labelMy).toBe(badge.my - size / 2 - MAP_POI_LABEL_BADGE_GAP);
    // The a11y summary still announces the authored spot, which IS the badge's.
    expect(label.my).toBe(badge.my);
  });

  it('an omitted marker profile clears with the standard sizes', () => {
    const model = buildOverworldMapModel(input(undefined));
    const label = model.pois.find((p) => p.poiIndex === poiIndex);
    const badge = model.navigation.find((n) => n.kind === 'delve-entrance');
    expect(label?.labelMy).toBe(
      (badge?.my ?? Number.NaN) - MAP_MARKER_SIZES.mapNavigation / 2 - MAP_POI_LABEL_BADGE_GAP,
    );
  });

  it('every other Eastbrook Vale label keeps its authored projection', () => {
    const model = buildOverworldMapModel(input('standard'));
    const r = model.region;
    expect(model.pois.length).toBeGreaterThan(1);
    for (const poi of model.pois) {
      if (poi.poiIndex === poiIndex) continue;
      const authored = zone.pois[poi.poiIndex];
      expect(poi.mx).toBeCloseTo(((r.maxX - authored.x) / (r.maxX - r.minX)) * CANVAS, 6);
      expect(poi.my).toBeCloseTo(((r.maxZ - authored.z) / (r.maxZ - r.minZ)) * CANVAS, 6);
      expect(poi.labelMy).toBe(poi.my);
    }
  });

  it('across every shipped zone, no label touches a badge and exactly two labels move', () => {
    // The second mover is Duskfall Cave in Veiled Hollow, whose world-passage
    // badge sits beside (not on) the label: the horizontal reach catches it.
    const moved = new Set<string>();
    for (const z of ZONES) {
      for (const profile of ['standard', 'compact'] as const) {
        const model = buildOverworldMapModel(input(profile, z));
        const size =
          MAP_MARKER_SIZES[profile === 'compact' ? 'mapNavigationCompact' : 'mapNavigation'];
        const height = MAP_POI_LABEL_HEIGHT_BY_PROFILE[profile];
        const r = model.region;
        for (const poi of model.pois) {
          const at = { mx: poi.mx, my: poi.labelMy };
          for (const badge of model.navigation) {
            expect(poiLabelTouchesBadge(at, badge, size, height), `${z.id}/${poi.poiIndex}`).toBe(
              false,
            );
          }
          const authored = z.pois[poi.poiIndex];
          const rawMy = ((r.maxZ - authored.z) / (r.maxZ - r.minZ)) * CANVAS;
          expect(poi.my, `${z.id}/${authored.id} authored`).toBeCloseTo(rawMy, 6);
          if (Math.abs(poi.labelMy - rawMy) > 1e-6) moved.add(`${z.id}:${authored.id}`);
        }
      }
    }
    expect([...moved].sort()).toEqual([
      'eastbrook_vale:reliquary_hill',
      'veiled_hollow:duskfall_cave',
    ]);
  });
});
