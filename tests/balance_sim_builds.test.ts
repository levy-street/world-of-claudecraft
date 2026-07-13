// Pins the balance simulator's spec catalog and generated builds against the
// live content tables, so class/talent/item drift breaks CI here instead of
// silently skewing balance runs.
import { describe, expect, it } from 'vitest';
import { bestGearFor, gearScore, knockoutBuilds, specBuild } from '../scripts/balance_sim/builds';
import { SPEC_CATALOG } from '../scripts/balance_sim/spec_catalog';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import {
  computeTalentModifiers,
  pointsSpent,
  TALENTS,
  talentPointsAtLevel,
  talentsFor,
  validateAllocation,
} from '../src/sim/content/talents';
import { ITEMS } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';
import { meetsLevelRequirement } from '../src/sim/item_level_req';
import { MAX_LEVEL } from '../src/sim/types';

const POINTS = talentPointsAtLevel(MAX_LEVEL);

describe('spec catalog', () => {
  it('covers every class spec in the talent registry exactly once', () => {
    const expected = new Set<string>();
    for (const [cls, ct] of Object.entries(TALENTS)) {
      for (const spec of ct.specs) expected.add(`${cls}:${spec.id}`);
    }
    const actual = SPEC_CATALOG.map((s) => `${s.cls}:${s.specId}`);
    expect(new Set(actual).size).toBe(actual.length);
    expect(new Set(actual)).toEqual(expected);
  });

  it('keys are unique and roles match the SpecDef role', () => {
    const keys = SPEC_CATALOG.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const spec of SPEC_CATALOG) {
      const def = talentsFor(spec.cls)?.specs.find((d) => d.id === spec.specId);
      expect(def, `${spec.key} spec def`).toBeDefined();
      expect(spec.role, `${spec.key} role`).toBe(def?.role);
    }
  });

  it('every catalog ability id is castable with the generated build at cap', () => {
    for (const spec of SPEC_CATALOG) {
      const build = specBuild(spec.cls, spec.specId, POINTS);
      const mods = computeTalentModifiers(spec.cls, build, MAX_LEVEL);
      const known = new Set(abilitiesKnownAt(spec.cls, MAX_LEVEL, mods).map((k) => k.def.id));
      const wanted = [
        ...spec.rotation,
        ...(spec.healRotation ?? []),
        ...(spec.prepull ?? []),
        ...(spec.defensives ?? []),
        ...(spec.opener ? [spec.opener] : []),
        ...(spec.interrupt ? [spec.interrupt] : []),
      ];
      for (const id of wanted) expect(known.has(id), `${spec.key} knows ${id}`).toBe(true);
    }
  });
});

describe('generated builds', () => {
  it('are valid and spend the full budget for all 27 specs', () => {
    for (const spec of SPEC_CATALOG) {
      const build = specBuild(spec.cls, spec.specId, POINTS);
      expect(build.spec).toBe(spec.specId);
      const check = validateAllocation(spec.cls, build, POINTS);
      expect(check.ok, `${spec.key}: ${check.reason ?? ''}`).toBe(true);
      expect(pointsSpent(build), `${spec.key} spends full budget`).toBe(POINTS);
    }
  });

  it('are deterministic', () => {
    const a = specBuild('warrior', 'arms', POINTS);
    const b = specBuild('warrior', 'arms', POINTS);
    expect(a).toEqual(b);
  });

  it('return an empty allocation for an unknown spec id', () => {
    const build = specBuild('warrior', 'nonsense', POINTS);
    expect(pointsSpent(build)).toBe(0);
  });

  it('knockout builds stay legal and remove the named node', () => {
    const full = specBuild('mage', 'frost', POINTS);
    const cuts = knockoutBuilds('mage', full, POINTS);
    expect(cuts.length).toBeGreaterThan(0);
    for (const cut of cuts) {
      expect(cut.alloc.ranks[cut.nodeId]).toBeUndefined();
      const check = validateAllocation('mage', cut.alloc, POINTS);
      expect(check.ok, `${cut.nodeId}: ${check.reason ?? ''}`).toBe(true);
      expect(pointsSpent(cut.alloc)).toBeLessThan(POINTS);
    }
  });
});

describe('generated gear', () => {
  it('is equippable and level-legal for every spec at cap and at level 10', () => {
    for (const spec of SPEC_CATALOG) {
      for (const level of [MAX_LEVEL, 10]) {
        const gear = bestGearFor(spec, level);
        expect(Object.keys(gear).length, `${spec.key} L${level} has gear`).toBeGreaterThan(3);
        for (const [slot, itemId] of Object.entries(gear)) {
          const item = ITEMS[itemId];
          expect(item, `${spec.key} ${slot} ${itemId}`).toBeDefined();
          expect(canEquipItem(spec.cls, item), `${spec.key} can equip ${itemId}`).toBe(true);
          expect(meetsLevelRequirement(level, item), `${itemId} legal at ${level}`).toBe(true);
        }
      }
    }
  });

  it('weights weapons for physical specs and intellect for casters', () => {
    const fury = SPEC_CATALOG.find((s) => s.key === 'fury_warrior')!;
    const mage = SPEC_CATALOG.find((s) => s.key === 'frost_mage')!;
    const furyWeapon = ITEMS[bestGearFor(fury, MAX_LEVEL).mainhand!];
    const mageChest = ITEMS[bestGearFor(mage, MAX_LEVEL).chest!];
    expect(furyWeapon.kind).toBe('weapon');
    expect((mageChest.stats?.int ?? 0) > 0).toBe(true);
  });

  it('weights stamina and armor for tanks and spirit for healers', () => {
    const prot = SPEC_CATALOG.find((s) => s.key === 'protection_warrior')!;
    const holy = SPEC_CATALOG.find((s) => s.key === 'holy_priest')!;
    const tanky = { id: 'x', kind: 'armor', slot: 'chest', stats: { sta: 10, armor: 100 } };
    const spry = { id: 'y', kind: 'armor', slot: 'chest', stats: { agi: 10 } };
    const spirity = { id: 'z', kind: 'armor', slot: 'chest', stats: { spi: 10 } };
    expect(gearScore(tanky as never, prot)).toBeGreaterThan(gearScore(spry as never, prot));
    expect(gearScore(spirity as never, holy)).toBeGreaterThan(gearScore(spry as never, holy));
  });
});
