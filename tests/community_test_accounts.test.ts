import { describe, expect, it } from 'vitest';
import { validCharName } from '../server/auth';
import {
  buildCommunityTestCharacters,
  communityTestAccountsEnabled,
  configureCommunityTestAccounts,
  generatedTestCharacterName,
} from '../server/community_test_accounts';
import { BOOST_KIT_VERSION, bisKit, bisKitForRole, CLASS_ROLES } from '../server/pbe_boost';
import { bagCapacity } from '../src/sim/bags';
import { WARFARE_ITEMS } from '../src/sim/content/pvp_honor';
import { ITEMS } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';
import { meetsLevelRequirement } from '../src/sim/item_level_req';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, EQUIP_SLOTS, MAX_LEVEL, xpToReachLevel } from '../src/sim/types';

describe('community test account configuration', () => {
  it('is disabled until boot explicitly enables it', () => {
    configureCommunityTestAccounts(false);
    expect(communityTestAccountsEnabled()).toBe(false);
    configureCommunityTestAccounts(true);
    expect(communityTestAccountsEnabled()).toBe(true);
    configureCommunityTestAccounts(false);
  });
});

describe('generated community character names', () => {
  it('is deterministic, valid, distinct per class, and changes on collision retry', () => {
    const first = ALL_CLASSES.map((cls) => generatedTestCharacterName(42, cls, 0));
    const retried = ALL_CLASSES.map((cls) => generatedTestCharacterName(42, cls, 1));

    expect(new Set(first)).toHaveLength(ALL_CLASSES.length);
    expect(first.every(validCharName)).toBe(true);
    expect(retried.every(validCharName)).toBe(true);
    expect(first).toEqual(ALL_CLASSES.map((cls) => generatedTestCharacterName(42, cls, 0)));
    expect(retried).not.toEqual(first);
  });
});

describe('community test character templates', () => {
  it('builds one fully playable level-20 character for every class', () => {
    const characters = buildCommunityTestCharacters(42);
    expect(characters.map((character) => character.cls)).toEqual(ALL_CLASSES);
    expect(new Set(characters.map((character) => character.name))).toHaveLength(ALL_CLASSES.length);

    for (const character of characters) {
      const { cls, name, state } = character;
      expect(validCharName(name)).toBe(true);
      expect(state.level).toBe(MAX_LEVEL);
      expect(state.lifetimeXp).toBeGreaterThanOrEqual(xpToReachLevel(MAX_LEVEL));
      // The worn set is exactly the class's primary BiS kit (a 2H class may
      // legitimately leave the offhand empty).
      expect(Object.keys(state.equipment).sort()).toEqual(Object.keys(bisKit(cls)).sort());
      expect(state.bags).toEqual(Array(4).fill('mistcallers_duffel'));
      expect(bagCapacity(state.bags ?? [])).toBe(72);

      for (const itemId of Object.values(state.equipment)) {
        const item = ITEMS[itemId];
        expect(item, `${cls} equipment ${itemId} must exist`).toBeDefined();
        // The score argmax may pick a heroic RARE over an epic (e.g. the
        // shaman's heroic pearl greaves); quality is a sanity floor only.
        expect(['rare', 'epic', 'legendary'], `${cls} ${itemId} quality`).toContain(item?.quality);
        if (!item) throw new Error(`missing equipment ${itemId}`);
        expect(canEquipItem(cls, item)).toBe(true);
        expect(meetsLevelRequirement(MAX_LEVEL, item)).toBe(true);
      }

      const reloaded = new Sim({ seed: 20061, playerClass: cls, noPlayer: true });
      const pid = reloaded.addPlayer(cls, name, { state });
      const player = reloaded.entities.get(pid);
      if (!player) throw new Error(`failed to reload ${name}`);
      expect(player.hp).toBe(player.maxHp);
      if (player.resourceType !== 'rage') expect(player.resource).toBe(player.maxResource);
    }
  });

  it('wears the shared true-BiS boost kit, never WARFARE gear (2026-07-22 re-gear)', () => {
    // The hand-curated WARFARE loadouts were retired: templates now wear the
    // computed best-in-slot PvE kit from server/pbe_boost.ts, carry every
    // alternate role's kit in the bags, and are stamped so the world-join
    // top-up treats them as current.
    for (const character of buildCommunityTestCharacters(7)) {
      const kit = bisKit(character.cls);
      for (const [slot, itemId] of Object.entries(kit)) {
        expect(
          character.state.equipment[slot as keyof typeof character.state.equipment],
          `${character.cls} ${slot}`,
        ).toBe(itemId);
      }
      for (const itemId of Object.values(character.state.equipment)) {
        if (itemId) expect(itemId in WARFARE_ITEMS, `${character.cls} wears ${itemId}`).toBe(false);
      }
      expect(character.state.pbeBoostKit, `${character.cls} stamped`).toBe(BOOST_KIT_VERSION);
      expect(character.state.ridingTrained, `${character.cls} riding`).toBe(true);
      for (const role of CLASS_ROLES[character.cls].slice(1)) {
        const altMain = bisKitForRole(character.cls, role).mainhand;
        if (!altMain || Object.values(character.state.equipment).includes(altMain)) continue;
        expect(
          character.state.inventory.some((s) => s.itemId === altMain),
          `${character.cls} carries the ${role.id} weapon`,
        ).toBe(true);
      }
    }
  });

  it('returns independent state copies so accounts and classes cannot share mutable saves', () => {
    const first = buildCommunityTestCharacters(10);
    const second = buildCommunityTestCharacters(11);
    first[0].state.inventory.push({ itemId: 'linen_pouch', count: 1 });
    first[0].state.equipment.mainhand = 'worn_sword';

    expect(second[0].state.inventory).not.toContainEqual({ itemId: 'linen_pouch', count: 1 });
    expect(second[0].state.equipment.mainhand).toBe(bisKit(second[0].cls).mainhand);
  });
});
