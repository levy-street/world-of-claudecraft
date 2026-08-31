import { describe, expect, it } from 'vitest';
import { DEV_KIT_ROLE_COUNT, DEV_KIT_ROLES } from '../src/sim/content/dev_kit_roles';
import { ITEMS } from '../src/sim/data';
import {
  PARSE_BIS_SOURCE,
  parseBisGearFor,
  parseBisLoadoutEntries,
} from '../src/sim/dev/parse_bis_loadouts';
import { canEquipItemInSlot, displacedSlotForEquip } from '../src/sim/equipment_rules';
import type { EquipSlot, PlayerClass } from '../src/sim/types';

describe('top parse BIS loadouts', () => {
  it('covers every class and spec with a complete legal observed loadout', () => {
    const entries = parseBisLoadoutEntries();
    expect(entries).toHaveLength(DEV_KIT_ROLE_COUNT);

    for (const [cls, roles] of Object.entries(DEV_KIT_ROLES) as [
      PlayerClass,
      (typeof DEV_KIT_ROLES)[PlayerClass],
    ][]) {
      for (const role of roles) {
        const gear = parseBisGearFor(cls, role.spec);
        expect(gear, `${cls} ${role.spec}`).not.toBeNull();
        const slots = Object.entries(gear ?? {}) as [EquipSlot, string][];
        expect(slots.length, `${cls} ${role.spec}`).toBeGreaterThanOrEqual(11);
        for (const [slot, itemId] of slots) {
          expect(ITEMS[itemId], `${cls} ${role.spec} ${slot}: ${itemId}`).toBeDefined();
          expect(
            canEquipItemInSlot(cls, ITEMS[itemId], slot, role.spec),
            `${cls} ${role.spec} ${slot}: ${itemId}`,
          ).toBe(true);
        }
        const mainhand = gear?.mainhand ? ITEMS[gear.mainhand] : undefined;
        const offhand = gear?.offhand ? ITEMS[gear.offhand] : undefined;
        if (mainhand) {
          expect(
            displacedSlotForEquip(
              mainhand,
              'mainhand',
              gear ?? {},
              (id) => ITEMS[id],
              cls,
              role.spec,
            ),
            `${cls} ${role.spec} mainhand conflicts with its parse offhand`,
          ).toBeNull();
        }
        if (offhand) {
          expect(
            displacedSlotForEquip(
              offhand,
              'offhand',
              gear ?? {},
              (id) => ITEMS[id],
              cls,
              role.spec,
            ),
            `${cls} ${role.spec} offhand conflicts with its parse mainhand`,
          ).toBeNull();
        }
      }
    }
  });

  it('pins the strongest current heroic raid examples instead of the old score heuristic', () => {
    expect(PARSE_BIS_SOURCE).toMatchObject({
      encounter: 'nythraxis_boss_arena',
      preferredBuild: '0.40.1',
      capturedOn: '2026-08-27',
    });
    expect(parseBisGearFor('mage', 'fire')).toMatchObject({
      helmet: 'heroic_soulflame_cowl',
      mainhand: 'scepter_of_the_deathless_court',
      offhand: 'heroic_wraithfire_orb',
      ring1: 'riftbound_band_of_insight',
      ring2: 'riftbound_band_of_insight',
    });
    expect(parseBisGearFor('warrior', 'prot')).toMatchObject({
      helmet: 'heroic_crownforged_dreadhelm',
      mainhand: 'heroic_kingsbane_last_oath',
      offhand: 'heroic_bonewrought_bulwark',
      ring1: 'riftbound_band_of_might',
      ring2: 'riftbound_band_of_might',
    });
  });

  it('returns null for an unknown or cross-class spec', () => {
    expect(parseBisGearFor('mage', 'prot')).toBeNull();
    expect(parseBisGearFor('warrior', 'fire')).toBeNull();
  });
});
