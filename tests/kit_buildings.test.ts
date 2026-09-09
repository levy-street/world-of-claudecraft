// The placed-kit architecture as building footprints (src/sim/kit_buildings.ts):
// the fortress table's houses, halls, tavern, stables, and church derive the
// BuildingDef rects the zone map strokes and the rested-XP test reads, on the
// same OBB the kit's colliders use. The Wyrmwatch strip deleted the zone's
// only authored inn; the rebuilt tavern must carry the rest area instead.
import { describe, expect, it } from 'vitest';
import { getActiveWorldContent } from '../src/sim/data';
import { FORGEFATHER_FORTRESS_PLACEMENTS } from '../src/sim/forgefather_fortress';
import { IGNIVAR_PROP_NATIVE, type IgnivarPropPlacement } from '../src/sim/ignivar_props';
import {
  KIT_BUILDING_KINDS,
  KIT_BUILDINGS,
  kitBuildingFootprints,
  TAVERN_SIGN_REACH,
} from '../src/sim/kit_buildings';
import { isResting } from '../src/sim/progression/xp';
import type { Entity } from '../src/sim/types';

const at = (x: number, z: number, inCombat = false): Entity =>
  ({ pos: { x, y: 0, z }, inCombat }) as unknown as Entity;

describe('kit building footprints', () => {
  it('derives one footprint per architecture row, on the collider OBB', () => {
    const rows = FORGEFATHER_FORTRESS_PLACEMENTS.filter((p) => KIT_BUILDING_KINDS[p.key]);
    expect(KIT_BUILDINGS.length).toBe(rows.length);
    expect(rows.length).toBeGreaterThanOrEqual(10); // vacuity floor: the rebuild really is in
    rows.forEach((p, i) => {
      const b = KIT_BUILDINGS[i];
      const native = IGNIVAR_PROP_NATIVE[p.key];
      expect(b.x).toBe(p.x);
      expect(b.z).toBe(p.z);
      expect(b.rot).toBe(p.ry);
      expect(b.w).toBeCloseTo(native.len * p.scale, 9);
      expect(b.d).toBeCloseTo(native.dep * p.scale, 9);
      expect(b.height).toBeCloseTo(native.hei * p.scale, 9);
      expect(['house', 'inn', 'chapel']).toContain(b.kind);
    });
  });

  it('the tavern sign names the inn and the church is the chapel; nothing else is either', () => {
    const inns = KIT_BUILDINGS.filter((b) => b.kind === 'inn');
    expect(inns.length).toBe(1);
    // the table carries more than one tavern_sign (the keep hangs one on its
    // gate front with no house within reach: decoration, not an inn); the
    // inn is the house the NEAREST sign hangs on
    const signs = FORGEFATHER_FORTRESS_PLACEMENTS.filter((p) => p.key === 'tavern_sign');
    expect(signs.length).toBeGreaterThanOrEqual(1);
    const nearest = Math.min(...signs.map((s) => Math.hypot(inns[0].x - s.x, inns[0].z - s.z)));
    expect(nearest).toBeLessThanOrEqual(TAVERN_SIGN_REACH);
    expect(inns[0].id, 'the Wyrmwatch tavern hall').toContain('building_2');
    const churches = FORGEFATHER_FORTRESS_PLACEMENTS.filter((p) => p.key === 'church').length;
    expect(churches).toBeGreaterThanOrEqual(1);
    expect(KIT_BUILDINGS.filter((b) => b.kind === 'chapel').length).toBe(churches);
  });

  it('the inn follows the placed sign, never a coordinate', () => {
    const house: IgnivarPropPlacement = { key: 'building_2', x: 0, y: 0, z: 0, ry: 0, scale: 10 };
    const farSign: IgnivarPropPlacement = {
      key: 'tavern_sign',
      x: 0,
      y: 0,
      z: TAVERN_SIGN_REACH + 1,
      ry: 0,
      scale: 3,
    };
    expect(kitBuildingFootprints([house, farSign]).map((b) => b.kind)).toEqual(['house']);
    const nearSign = { ...farSign, z: TAVERN_SIGN_REACH - 1 };
    expect(kitBuildingFootprints([house, nearSign]).map((b) => b.kind)).toEqual(['inn']);
    // a sign beside a chapel or furniture makes no inn
    const church: IgnivarPropPlacement = { key: 'church', x: 0, y: 0, z: 0, ry: 0, scale: 12 };
    expect(kitBuildingFootprints([church, nearSign]).map((b) => b.kind)).toEqual(['chapel']);
    const fence: IgnivarPropPlacement = { key: 'fence', x: 0, y: 0, z: 0, ry: 0, scale: 5 };
    expect(kitBuildingFootprints([fence, nearSign])).toEqual([]);
  });
});

describe('rested XP at the rebuilt Wyrmwatch tavern', () => {
  it('rests a player inside the tavern and nowhere else on the stripped hub', () => {
    const inn = KIT_BUILDINGS.find((b) => b.kind === 'inn');
    expect(inn).toBeDefined();
    if (!inn) return;
    expect(isResting(at(inn.x, inn.z))).toBe(true);
    expect(isResting(at(inn.x, inn.z, true)), 'never in combat').toBe(false);
    // the old inn footprint at (390, 1904) is open ground now
    expect(isResting(at(390, 1904))).toBe(false);
    // ten yards down the street is not the tavern
    expect(isResting(at(inn.x + inn.w / 2 + 6, inn.z))).toBe(false);
  });

  it('the Drakelands keeps exactly one rest area after the strip', () => {
    const authored = getActiveWorldContent().props.buildings.filter(
      (b) => b.kind === 'inn' && b.x > 180 && b.z > 1820,
    );
    const kit = KIT_BUILDINGS.filter((b) => b.kind === 'inn');
    expect(authored.length + kit.length).toBe(1);
  });
});
