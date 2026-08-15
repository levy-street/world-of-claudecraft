import { describe, expect, it } from 'vitest';
import {
  GEARED_ARRIVAL_LOADOUTS,
  gearedArrivalBotFixture,
  gearedArrivalFixtureManifest,
  gearedArrivalFixtureSha256,
} from '../scripts/profiler/geared_arrival_fixture.mjs';
import { DEFAULT_APPEARANCE, normalizeAppearance } from '../src/render/characters/modular';
import { weaponTypeForItem } from '../src/sim/content/weapon_skin_rules';
import { WEAPON_SKINS } from '../src/sim/content/weapon_skins';
import { ITEMS } from '../src/sim/data';
import { sanitizeAppearance } from '../src/world_api/appearance';

describe('geared arrival fixture', () => {
  it('is deterministic and gives every bot a complete authored look', () => {
    const left = gearedArrivalFixtureManifest(20);
    const right = gearedArrivalFixtureManifest(20);
    expect(left).toEqual(right);
    expect(gearedArrivalFixtureSha256(20)).toBe(
      'efe08bfca55303cab4a69fef6d272ba659ea44b80959a9c52bb490c8c819851d',
    );
    for (const bot of left) {
      expect(sanitizeAppearance(bot.appearance)).toEqual(bot.appearance);
      expect(Object.keys(bot.appearance).sort()).toEqual(Object.keys(DEFAULT_APPEARANCE).sort());
    }
  });

  it('uses real renderer ids instead of values that silently clamp to defaults', () => {
    for (const bot of gearedArrivalFixtureManifest(20)) {
      expect(normalizeAppearance(bot.appearance)).toEqual(bot.appearance);
    }
  });

  it('varies geometry, morphs, materials, colours, weapons and helmet state', () => {
    const fixture = gearedArrivalFixtureManifest(20);
    const unique = (value) => new Set(fixture.map(value)).size;
    expect(unique((bot) => bot.appearance.gender)).toBe(2);
    expect(unique((bot) => bot.appearance.hair)).toBeGreaterThanOrEqual(15);
    expect(unique((bot) => bot.appearance.eyeShape)).toBeGreaterThanOrEqual(8);
    expect(unique((bot) => bot.appearance.outfit)).toBeGreaterThanOrEqual(15);
    expect(unique((bot) => JSON.stringify(bot.appearance.face))).toBe(20);
    expect(unique((bot) => JSON.stringify(bot.appearance.body))).toBe(20);
    expect(unique((bot) => bot.skin)).toBe(20);
    expect(unique((bot) => bot.weapon)).toBe(5);
    expect(unique((bot) => bot.helmHidden)).toBe(2);
  });

  it('gives every loadout a weapon its own skins can actually ride', () => {
    // The crowd exists to put VFX weapon skins on screen. A loadout whose
    // "weapon" has no mainhand slot equips nothing, so its skins never render
    // and that bot silently drops out of the measurement: GEARED_ARRIVAL_LOADOUTS
    // shipped a handaxe, which is a TOOL, and nothing said so while the /dev give
    // that would have handed it over was being dropped on the wire.
    for (const loadout of GEARED_ARRIVAL_LOADOUTS) {
      const item = ITEMS[loadout.weapon];
      expect(item, `${loadout.weapon} is not a real item`).toBeDefined();
      expect(item.kind, `${loadout.weapon} must be a weapon`).toBe('weapon');
      expect(item.slot, `${loadout.weapon} must equip to a hand`).toBe('mainhand');
      const type = weaponTypeForItem(loadout.weapon);
      expect(type, `${loadout.weapon} has no weapon type`).not.toBeNull();
      for (const skinId of loadout.skins) {
        const skin = WEAPON_SKINS[skinId];
        expect(skin, `${skinId} is not a catalog skin`).toBeDefined();
        expect(skin.weaponType, `${skinId} cannot ride ${loadout.weapon}`).toBe(type);
      }
    }
  });

  it('rejects invalid manifest cardinalities', () => {
    expect(() => gearedArrivalFixtureManifest(-1)).toThrow(/non-negative/);
    expect(() => gearedArrivalFixtureManifest(1.5)).toThrow(/non-negative/);
  });

  it('returns independent documents so one bot cannot mutate another fixture leg', () => {
    const first = gearedArrivalBotFixture(3);
    const second = gearedArrivalBotFixture(3);
    first.appearance.face.jaw = 99;
    first.skins.push('mutated');
    expect(second.appearance.face.jaw).not.toBe(99);
    expect(second.skins).not.toContain('mutated');
  });
});
