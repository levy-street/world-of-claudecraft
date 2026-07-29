// Pure-core tests for the Apply Enchant picker (Professions 2.0):
// the enchants a reagent unlocks with their EFFECT facts and per-reagent
// affordability, the reagent-derived tier classification and the tiered,
// slot-sorted sections built on it, the eligible-target list (slot match,
// already-enchanted exclusion, the masterwork-still-enchantable case, grouping
// by item id) across BOTH target families (bagged and worn), the enchant
// name-key contract, and (#2421) what a replace does NOT destroy plus the
// mixed-holding flag that keeps two rows sharing one item name apart.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ITEMS } from '../src/sim/data';
import type { InvSlot, ItemDef, ItemSlot } from '../src/sim/types';
import {
  ENCHANT_PRESERVED_TRAITS,
  ENCHANT_TIER_ORDER,
  enchantNameKey,
  enchantSectionsForReagent,
  enchantsForReagent,
  enchantTargets,
  enchantTier,
  preservedReplaceTraits,
  preservedTraitKey,
  wornEnchantTargets,
} from '../src/ui/enchant_apply_view';
import { itemDisplayName } from '../src/ui/entity_i18n';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';
import { translations } from '../src/ui/i18n.resolved.generated';
import { wornTooltipInstance } from '../src/ui/item_instance_tooltip';

/** The one slice of a resolved locale table the completeness sweep below reads:
 *  the item name rows itemDisplayName resolves through. Narrowed locally rather
 *  than typed against the full generated table, which is one dense literal per
 *  locale and carries every key in the game. */
type LocaleTable = { entities?: { items?: Record<string, { name?: string }> } };

// A real item id for a slot, taken from live content so the def.slot match is
// exercised against ITEMS exactly as the runtime picker reads it.
function itemForSlot(slot: ItemSlot, skip = new Set<string>()): string {
  const id = Object.keys(ITEMS).find(
    (candidate) => ITEMS[candidate].slot === slot && !skip.has(candidate),
  );
  if (!id) throw new Error(`no item found for slot ${slot}`);
  return id;
}

describe('enchant_apply_view: enchantNameKey', () => {
  it('names the hudChrome.enchantName.<id> render sink for every enchant', () => {
    expect(enchantNameKey('enchant_weapon_might')).toBe(
      'hudChrome.enchantName.enchant_weapon_might',
    );
    for (const id of Object.keys(ENCHANTS)) {
      expect(enchantNameKey(id)).toBe(`hudChrome.enchantName.${id}`);
    }
    // Review should-fix: the key CONSTRUCTION alone would pass over an empty
    // catalog. The render sink is only real if every id resolves to a non-empty
    // English row, and every row still names a live enchant (no orphans).
    const table = hudChromeStrings.enchantName as Record<string, string>;
    for (const id of Object.keys(ENCHANTS)) {
      expect(typeof table[id], `catalog row for ${id}`).toBe('string');
      expect(table[id].length, `non-empty name for ${id}`).toBeGreaterThan(0);
    }
    for (const key of Object.keys(table)) {
      expect(ENCHANTS[key], `orphaned enchantName row ${key}`).toBeDefined();
    }
    // The catalog English and the table's own name field are two copies of one
    // string (the UI renders the catalog; the table name feeds the wiki
    // generator), so a rename touching only one side must fail loudly here.
    for (const id of Object.keys(ENCHANTS)) {
      expect(table[id], `catalog/table name drift for ${id}`).toBe(ENCHANTS[id].name);
    }
  });
});

describe('enchant_apply_view: enchantsForReagent', () => {
  it('lists only the enchants that consume the reagent, with affordability', () => {
    // arcane_shard is consumed only by the Greater tier; enchant_weapon_greater_might
    // needs 1 shard + 2 essence.
    const inventory: InvSlot[] = [
      { itemId: 'arcane_shard', count: 1 },
      { itemId: 'arcane_essence', count: 5 },
    ];
    const rows = enchantsForReagent(inventory, 'arcane_shard');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(ENCHANTS[row.enchantId].reagents.some((r) => r.itemId === 'arcane_shard')).toBe(true);
    }
    const might = rows.find((r) => r.enchantId === 'enchant_weapon_greater_might');
    expect(might).toBeDefined();
    expect(might?.affordable).toBe(true);
    expect(might?.itemSlot).toBe('mainhand');
    const shardReagent = might?.reagents.find((r) => r.itemId === 'arcane_shard');
    expect(shardReagent).toEqual({ itemId: 'arcane_shard', required: 1, have: 1 });
  });

  it('marks an enchant unaffordable when a reagent is short', () => {
    const inventory: InvSlot[] = [{ itemId: 'arcane_shard', count: 1 }]; // no essence held
    const might = enchantsForReagent(inventory, 'arcane_shard').find(
      (r) => r.enchantId === 'enchant_weapon_greater_might',
    );
    expect(might?.affordable).toBe(false);
    expect(might?.reagents.find((r) => r.itemId === 'arcane_essence')?.have).toBe(0);
  });

  it('returns nothing for an id no enchant consumes', () => {
    expect(enchantsForReagent([{ itemId: 'arcane_dust', count: 9 }], 'bone_fragments')).toEqual([]);
  });
});

describe('enchant_apply_view: effect facts on the pick row', () => {
  it('carries the enchant stat bonus straight off the content table', () => {
    const rows = enchantsForReagent([{ itemId: 'arcane_dust', count: 99 }], 'arcane_dust');
    const fortitude = rows.find((r) => r.enchantId === 'enchant_helmet_fortitude');
    expect(fortitude?.effects).toEqual([
      { stat: 'sta', value: ENCHANTS.enchant_helmet_fortitude.statBonus.sta },
    ]);
    // Not a hardcoded 3: the row must track the live table.
    expect(fortitude?.effects[0].value).toBe(3);
  });

  it('every listed enchant carries at least one effect, matching its statBonus', () => {
    for (const reagentId of ['arcane_dust', 'arcane_essence', 'arcane_shard', 'resonant_steel']) {
      for (const row of enchantsForReagent([], reagentId)) {
        const bonus = ENCHANTS[row.enchantId].statBonus;
        expect(row.effects.length, `${row.enchantId} effects`).toBeGreaterThan(0);
        expect(Object.fromEntries(row.effects.map((e) => [e.stat, e.value]))).toEqual(bonus);
      }
    }
  });

  it('an armor-axis enchant reports its armor points, not a primary stat', () => {
    const armor = enchantsForReagent([], 'arcane_dust').find(
      (r) => r.enchantId === 'enchant_chest_armor',
    );
    expect(armor?.effects).toEqual([
      { stat: 'armor', value: ENCHANTS.enchant_chest_armor.statBonus.armor },
    ]);
  });
});

describe('enchant_apply_view: tier classification', () => {
  it('a shard-consuming enchant is Greater', () => {
    expect(enchantTier('enchant_weapon_greater_might')).toBe('greater');
    expect(enchantTier('enchant_gloves_greater_agility')).toBe('greater');
  });

  it('a typed resonant secondary marks the Runed tier', () => {
    expect(enchantTier('enchant_weapon_runed_edge')).toBe('runed');
    expect(enchantTier('enchant_helmet_runed_links')).toBe('runed');
  });

  it('dust/essence-only enchants are Base', () => {
    expect(enchantTier('enchant_weapon_might')).toBe('base');
    // essence-consuming but neither shard nor resonant: still Base.
    expect(enchantTier('enchant_chest_stamina')).toBe('base');
  });

  it('classifies every live enchant, and each tier matches its reagents', () => {
    for (const id of Object.keys(ENCHANTS)) {
      const tier = enchantTier(id);
      const reagentIds = ENCHANTS[id].reagents.map((r) => r.itemId);
      if (reagentIds.includes('arcane_shard')) expect(tier).toBe('greater');
      else if (reagentIds.some((r) => r.startsWith('resonant_'))) expect(tier).toBe('runed');
      else expect(tier).toBe('base');
    }
  });

  it('an unknown enchant id falls back to Base rather than throwing', () => {
    expect(enchantTier('not_a_real_enchant')).toBe('base');
  });

  // Review nit (#2404): the tier is inferred from reagent ids rather than an
  // explicit EnchantDef field, so a future reagent that follows neither
  // convention would silently read as Base. Pin the reagent UNIVERSE instead of
  // trusting the convention: adding a reagent that is neither the shard, a
  // resonant, nor a known base material fails HERE, loudly, at the point where
  // the classification would have gone quietly wrong. Extend the list only
  // together with the enchantTier arm that classifies the new material.
  it('every enchant reagent is a material the tier rules actually recognize', () => {
    const KNOWN_BASE_REAGENTS = new Set(['arcane_dust', 'arcane_essence']);
    const unclassifiable: string[] = [];
    for (const enchant of Object.values(ENCHANTS)) {
      for (const { itemId } of enchant.reagents) {
        if (itemId === 'arcane_shard') continue;
        if (itemId.startsWith('resonant_')) continue;
        if (KNOWN_BASE_REAGENTS.has(itemId)) continue;
        unclassifiable.push(`${enchant.id} -> ${itemId}`);
      }
    }
    expect(
      unclassifiable,
      'these reagents match no tier rule and would silently classify as Base:\n' +
        `${unclassifiable.join('\n')}\n` +
        'Add the material to enchantTier (src/ui/enchant_apply_view.ts) and to this list.',
    ).toEqual([]);
  });

  it('the two tier-marker reagents are still real, distinct items', () => {
    // The rules key on these ids, so a rename in content must not leave the
    // classification pointing at nothing.
    expect(ITEMS.arcane_shard).toBeDefined();
    const resonants = Object.keys(ITEMS).filter((id) => id.startsWith('resonant_'));
    expect(resonants.length).toBeGreaterThan(0);
    // And each tier is actually POPULATED, so a rename that silently emptied a
    // tier (every row falling through to Base) fails here too.
    const tiers = Object.keys(ENCHANTS).map(enchantTier);
    expect(tiers).toContain('greater');
    expect(tiers).toContain('runed');
    expect(tiers).toContain('base');
  });
});

describe('enchant_apply_view: enchantSectionsForReagent', () => {
  it('groups essence enchants into the ladder order, base then runed then greater', () => {
    // arcane_essence is the one reagent that reaches all three tiers, which is
    // exactly the wall this grouping exists for.
    const sections = enchantSectionsForReagent([], 'arcane_essence');
    expect(sections.map((s) => s.tier)).toEqual(['base', 'runed', 'greater']);
    for (const section of sections) {
      expect(section.titleKey).toBe(`hudChrome.enchanting.tier.${section.tier}`);
      expect(section.rows.length).toBeGreaterThan(0);
      for (const row of section.rows) expect(enchantTier(row.enchantId)).toBe(section.tier);
    }
    // Every row the flat list would have shown is still shown, none duplicated.
    const flat = enchantsForReagent([], 'arcane_essence').map((r) => r.enchantId);
    const grouped = sections.flatMap((s) => s.rows.map((r) => r.enchantId));
    expect(grouped.slice().sort()).toEqual(flat.slice().sort());
  });

  it('omits an empty section: a dust reagent paints only the Base header', () => {
    const sections = enchantSectionsForReagent([], 'arcane_dust');
    expect(sections.map((s) => s.tier)).toEqual(['base']);
  });

  it('a typed secondary paints only the Runed section', () => {
    expect(enchantSectionsForReagent([], 'resonant_steel').map((s) => s.tier)).toEqual(['runed']);
  });

  it('sorts each section by paperdoll slot, then by name key', () => {
    const PAPERDOLL: readonly string[] = [
      'mainhand',
      'helmet',
      'neck',
      'shoulder',
      'chest',
      'waist',
      'legs',
      'gloves',
      'feet',
      'ring',
    ];
    for (const section of enchantSectionsForReagent([], 'arcane_essence')) {
      const slots = section.rows.map((r) => PAPERDOLL.indexOf(r.itemSlot));
      expect(slots, `${section.tier} slots resolvable`).not.toContain(-1);
      expect(slots.slice().sort((a, b) => a - b)).toEqual(slots);
      // Ties on a slot break by name key, so two enchants on one slot keep a
      // stable, alphabetical order rather than table declaration order.
      for (let i = 1; i < section.rows.length; i++) {
        if (slots[i] !== slots[i - 1]) continue;
        expect(
          enchantNameKey(section.rows[i].enchantId) > enchantNameKey(section.rows[i - 1].enchantId),
        ).toBe(true);
      }
    }
  });

  it('the Base section really does re-order the raw table (the sort is load-bearing)', () => {
    const base = enchantSectionsForReagent([], 'arcane_dust')[0];
    const raw = enchantsForReagent([], 'arcane_dust').map((r) => r.enchantId);
    expect(base.rows.map((r) => r.enchantId)).not.toEqual(raw);
  });

  it('carries affordability through the grouping unchanged', () => {
    const inventory: InvSlot[] = [
      { itemId: 'arcane_shard', count: 1 },
      { itemId: 'arcane_essence', count: 2 },
    ];
    const greater = enchantSectionsForReagent(inventory, 'arcane_shard').find(
      (s) => s.tier === 'greater',
    );
    const might = greater?.rows.find((r) => r.enchantId === 'enchant_weapon_greater_might');
    expect(might?.affordable).toBe(true);
    const chest = greater?.rows.find((r) => r.enchantId === 'enchant_chest_greater_stamina');
    // Chest Greater needs 3 essence; only 2 are held.
    expect(chest?.affordable).toBe(false);
  });

  it('returns nothing for an id no enchant consumes', () => {
    expect(enchantSectionsForReagent([], 'bone_fragments')).toEqual([]);
  });

  it('pins the English header wording for every tier', () => {
    const headers = hudChromeStrings.enchanting.tier as Record<string, string>;
    // Literal English, not a length check: the headers ARE the ladder the
    // player reads, so a reword has to be a deliberate edit here.
    expect(headers).toEqual({
      base: 'Base Enchants',
      runed: 'Runed Enchants',
      greater: 'Greater Enchants',
    });
    // And every tier the core can return has a row, so a fourth tier cannot
    // ship header-less.
    for (const tier of ENCHANT_TIER_ORDER) expect(headers[tier]).toBeTruthy();
  });
});

describe('enchant_apply_view: enchantTargets', () => {
  const chestId = itemForSlot('chest');
  const otherChestId = itemForSlot('chest', new Set([chestId]));
  const helmetId = itemForSlot('helmet');

  it('lists held items whose slot matches the enchant', () => {
    const inventory: InvSlot[] = [
      { itemId: chestId, count: 2 },
      { itemId: helmetId, count: 1 }, // wrong slot for a chest enchant
    ];
    const targets = enchantTargets(inventory, 'enchant_chest_stamina');
    expect(targets).toEqual([{ itemId: chestId, count: 2 }]);
  });

  it('surfaces an already-enchanted copy as a flagged replace row, and keeps a masterwork copy plain', () => {
    const inventory: InvSlot[] = [
      { itemId: chestId, count: 1, instance: { enchant: 'enchant_chest_stamina' } },
      { itemId: otherChestId, count: 1, instance: { rolled: { masterwork: true } } },
    ];
    const targets = enchantTargets(inventory, 'enchant_chest_stamina');
    // #2415: the enchanted chest is no longer hidden: it paints as a replace
    // row AFTER the plain family, carrying the doomed enchant's id, and since
    // the picked enchant IS the one it carries, it is a sameEnchant deny row.
    expect(targets).toEqual([
      { itemId: otherChestId, count: 1 },
      {
        itemId: chestId,
        count: 1,
        replace: { enchantId: 'enchant_chest_stamina', sameEnchant: true },
      },
    ]);
  });

  // The mixed holding, the one case that emits TWO rows for a single item id.
  // Pinned as a whole array so both the pairing and the plain-before-replace
  // order are constrained, not just each row's presence.
  it('emits a plain row AND a replace row for one item id held both ways', () => {
    const inventory: InvSlot[] = [
      { itemId: chestId, count: 1, instance: { enchant: 'enchant_chest_spirit' } },
      { itemId: chestId, count: 2 }, // plain fungible copies of the SAME id
    ];
    const targets = enchantTargets(inventory, 'enchant_chest_stamina');
    expect(targets).toEqual([
      // The plain family first, counting only the enchantable copies...
      // ...both rows flagged mixedHolding, since this pair is the one case that
      // shares an item display name (#2421, pinned on its own below).
      { itemId: chestId, count: 2, mixedHolding: true },
      // ...then the flagged replace row, counting only the enchanted ones and
      // naming the enchant on the pinned victim.
      {
        itemId: chestId,
        count: 1,
        replace: { enchantId: 'enchant_chest_spirit', sameEnchant: false },
        mixedHolding: true,
      },
    ]);
  });

  it('a replace row for a DIFFERENT carried enchant is selectable (sameEnchant false)', () => {
    const inventory: InvSlot[] = [
      { itemId: chestId, count: 1, instance: { enchant: 'enchant_chest_stamina' } },
    ];
    expect(enchantTargets(inventory, 'enchant_chest_spirit')).toEqual([
      {
        itemId: chestId,
        count: 1,
        replace: { enchantId: 'enchant_chest_stamina', sameEnchant: false },
      },
    ]);
  });

  it('a LEGACY pre-marker copy carries its raw doomed stats instead of an enchant id', () => {
    const inventory: InvSlot[] = [
      { itemId: chestId, count: 1, instance: { rolled: { stats: { sta: 4 } } } },
    ];
    expect(enchantTargets(inventory, 'enchant_chest_spirit')).toEqual([
      { itemId: chestId, count: 1, replace: { stats: { sta: 4 }, sameEnchant: false } },
    ]);
  });

  it('the replace row describes the PINNED victim: the highest-index enchanted copy', () => {
    const inventory: InvSlot[] = [
      { itemId: chestId, count: 1, instance: { enchant: 'enchant_chest_stamina' } },
      { itemId: chestId, count: 1, instance: { enchant: 'enchant_chest_armor' } },
    ];
    // One row for the id, count = every enchanted copy, described by the
    // highest-index copy: exactly the one the sim's replaceVictimIndex
    // consumes, so what the dialog names is what a confirm destroys.
    expect(enchantTargets(inventory, 'enchant_chest_spirit')).toEqual([
      {
        itemId: chestId,
        count: 2,
        replace: { enchantId: 'enchant_chest_armor', sameEnchant: false },
      },
    ]);
  });

  it('groups multiple enchantable stacks of one item id by count, replace rows counted apart', () => {
    const inventory: InvSlot[] = [
      { itemId: chestId, count: 2 },
      { itemId: chestId, count: 1, instance: { rolled: { masterwork: true } } },
      { itemId: chestId, count: 1, instance: { enchant: 'x' } }, // unknown marker id
    ];
    const targets = enchantTargets(inventory, 'enchant_chest_stamina');
    // The unknown-marker copy ('x' resolves to no ENCHANTS row) is DROPPED,
    // never offered: the sim's replace arm refuses what it cannot subtract,
    // and the picker must not offer what the sim denies.
    expect(targets).toEqual([{ itemId: chestId, count: 3 }]);
  });

  it('returns nothing for an unknown enchant id', () => {
    expect(enchantTargets([{ itemId: chestId, count: 1 }], 'not_a_real_enchant')).toEqual([]);
  });
});

describe('enchant_apply_view: wornEnchantTargets', () => {
  const SWORD = 'eastbrook_arming_sword'; // def slot 'mainhand'
  const WEAPON_ENCHANT = 'enchant_weapon_might';
  const RING = 'seal_of_the_nine_oaths'; // def slot 'ring', covers ring1 AND ring2
  const RING_ENCHANT = 'enchant_ring_spirit';

  it('lists the worn copy whose def slot matches, and skips every other slot', () => {
    const rows = wornEnchantTargets(
      { mainhand: SWORD, helmet: itemForSlot('helmet'), chest: itemForSlot('chest') },
      {},
      WEAPON_ENCHANT,
    );
    expect(rows).toEqual([{ itemId: SWORD, slot: 'mainhand' }]);
  });

  it('lists BOTH hands separately when each wears an eligible copy of one item id', () => {
    // The dual-wield case the slot discriminator exists for: the item id alone
    // cannot say which hand the player aimed at.
    const rows = wornEnchantTargets({ mainhand: SWORD, offhand: SWORD }, {}, WEAPON_ENCHANT);
    expect(rows).toEqual([
      { itemId: SWORD, slot: 'mainhand' },
      { itemId: SWORD, slot: 'offhand' },
    ]);
  });

  it('lists BOTH rings separately: an item declaring slot "ring" matches ring1 and ring2', () => {
    const rows = wornEnchantTargets({ ring1: RING, ring2: RING }, {}, RING_ENCHANT);
    // Each finger also carries its shared-label ordinal (#2466), since the one
    // "Finger" label cannot tell the two rows apart on its own.
    expect(rows).toEqual([
      { itemId: RING, slot: 'ring1', slotIndex: 1 },
      { itemId: RING, slot: 'ring2', slotIndex: 2 },
    ]);
  });

  it('surfaces an already-enchanted worn copy as a flagged replace row beside its plain twin', () => {
    const rows = wornEnchantTargets(
      { mainhand: SWORD, offhand: SWORD },
      { mainhand: { enchant: WEAPON_ENCHANT, rolled: { stats: { str: 2 } } } },
      WEAPON_ENCHANT,
    );
    // #2415: same slot-order pass, the enchanted hand flagged (and a
    // sameEnchant deny row here, since the picked enchant is the carried one).
    expect(rows).toEqual([
      {
        itemId: SWORD,
        slot: 'mainhand',
        replace: { enchantId: WEAPON_ENCHANT, sameEnchant: true },
      },
      { itemId: SWORD, slot: 'offhand' },
    ]);
  });

  it('a worn replace row for a DIFFERENT enchant is selectable, a legacy one carries stats, unknown drops', () => {
    const rows = wornEnchantTargets(
      { mainhand: SWORD, offhand: SWORD },
      { mainhand: { enchant: 'enchant_weapon_agility', rolled: { stats: { agi: 2 } } } },
      WEAPON_ENCHANT,
    );
    expect(rows).toEqual([
      {
        itemId: SWORD,
        slot: 'mainhand',
        replace: { enchantId: 'enchant_weapon_agility', sameEnchant: false },
      },
      { itemId: SWORD, slot: 'offhand' },
    ]);
    // Legacy pre-marker worn copy: raw doomed stats, no id to name.
    expect(
      wornEnchantTargets(
        { mainhand: SWORD },
        { mainhand: { rolled: { stats: { str: 5 } } } },
        WEAPON_ENCHANT,
      ),
    ).toEqual([
      { itemId: SWORD, slot: 'mainhand', replace: { stats: { str: 5 }, sameEnchant: false } },
    ]);
    // An unknown marker id is DROPPED, mirroring the sim's defensive refuse.
    expect(
      wornEnchantTargets({ mainhand: SWORD }, { mainhand: { enchant: 'x' } }, WEAPON_ENCHANT),
    ).toEqual([]);
  });

  it('keeps a signed or masterwork worn copy: neither reads as already enchanted', () => {
    const rows = wornEnchantTargets(
      { mainhand: SWORD, offhand: SWORD },
      {
        mainhand: { signer: 'Tester' },
        offhand: { rolled: { masterwork: true, stats: { str: 3 } } },
      },
      WEAPON_ENCHANT,
    );
    expect(rows).toEqual([
      { itemId: SWORD, slot: 'mainhand' },
      { itemId: SWORD, slot: 'offhand' },
    ]);
  });

  it('returns nothing for an empty paperdoll or an unknown enchant id', () => {
    expect(wornEnchantTargets({}, {}, WEAPON_ENCHANT)).toEqual([]);
    expect(wornEnchantTargets({ mainhand: SWORD }, {}, 'not_a_real_enchant')).toEqual([]);
  });
});

// #2421: what a replace does NOT destroy. The sim's replace payload
// (professions/enchanting.ts replacedEnchantPayloadFor) clones the victim and
// rewrites only rolled.stats + the enchant marker, so the signature, the
// masterwork flag and its bake, and the bind state all survive; the confirm
// dialog previously named only what dies. This core decides WHICH of them the
// pinned victim actually carries, so a plain copy is never told its signature
// is safe.
describe('enchant_apply_view: preservedReplaceTraits (#2421)', () => {
  it('reports nothing for a victim carrying none of the surviving facts', () => {
    expect(preservedReplaceTraits({ enchant: 'enchant_chest_stamina' })).toEqual([]);
    expect(preservedReplaceTraits({ rolled: { stats: { sta: 4 } } })).toEqual([]);
  });

  it('reports each fact on its own, and only when the victim carries it', () => {
    expect(preservedReplaceTraits({ signer: 'Tester' })).toEqual(['signer']);
    expect(preservedReplaceTraits({ rolled: { masterwork: true } })).toEqual(['masterwork']);
    expect(preservedReplaceTraits({ boundTo: 7 })).toEqual(['bond']);
    expect(preservedReplaceTraits({ bindOnTrade: true })).toEqual(['bond']);
    // Per-dimension negatives: a falsy marker is not a carried fact.
    expect(preservedReplaceTraits({ rolled: { masterwork: false } })).toEqual([]);
    expect(preservedReplaceTraits({ bindOnTrade: false })).toEqual([]);
    // boundTo is an entity id, and id 0 is a real one: presence decides, never
    // truthiness, or the very first character in a world would lose its line.
    expect(preservedReplaceTraits({ boundTo: 0 })).toEqual(['bond']);
    // signer takes the OPPOSITE rule, on purpose, because it is a NAME: the
    // tooltip's own maker's-mark line gates on `!instance?.signer`, so an empty
    // string draws no mark and the confirm must not promise one either. The two
    // fields disagree because their render sinks disagree, not by accident.
    expect(preservedReplaceTraits({ signer: '' })).toEqual([]);
  });

  it('emits the signed masterwork case in one fixed order, signature first', () => {
    // The scene the issue names: the player who cannot tell from the dialog
    // whether their signature and masterwork bonus survive. Pinned as an ARRAY,
    // so the order the confirm line prints is constrained too.
    expect(
      preservedReplaceTraits({
        signer: 'Tester',
        rolled: { masterwork: true, stats: { str: 3 } },
        enchant: 'enchant_weapon_might',
        boundTo: 4,
      }),
    ).toEqual(['signer', 'masterwork', 'bond']);
  });

  it('collapses both bind fields onto ONE bond trait, never two list entries', () => {
    // bindOnTrade ARMS the lock, boundTo IS it applied, and the swap leaves both
    // alone: one label either way, so a copy carrying both can never print the
    // bond twice in "Kept: ...".
    expect(preservedReplaceTraits({ boundTo: 3, bindOnTrade: true })).toEqual(['bond']);
  });

  it('drops both bind facts on the wire-trimmed (WORN) arm, keeping signature and masterwork', () => {
    // The public eqi wire carries signer/enchant/rolled ONLY, so an online
    // client cannot see a worn copy's bond while the offline Sim can. Claiming
    // it on this arm would make one dialog say different things per host.
    const victim = {
      signer: 'Tester',
      rolled: { masterwork: true },
      boundTo: 9,
      bindOnTrade: true,
    };
    expect(preservedReplaceTraits(victim, true)).toEqual(['signer', 'masterwork']);
    // ...and the bagged arm, reading the full self inv mirror, still states it.
    expect(preservedReplaceTraits(victim, false)).toEqual(['signer', 'masterwork', 'bond']);
  });

  // The premise the wireTrimmed arm rests on, pinned against the SERVER so it
  // cannot rot silently: the moment the eqi allowlist grows a bind field, the
  // worn arm is free to state the bond and this test says so.
  it('pins the eqi allowlist the worn trim mirrors', () => {
    const wire = readFileSync(fileURLToPath(new URL('../server/game.ts', import.meta.url)), 'utf8');
    const block = wire.match(
      /for \(const \[slot, inst\] of Object\.entries\(e\.equippedInstances\)\)[\s\S]*?\n {4}\}/,
    );
    expect(block, 'the eqi projection loop moved').not.toBeNull();
    // Comments stripped first: a "boundTo is deliberately absent" note inside
    // the loop must not read as a widening, and a commented-out assignment must
    // not read as coverage either.
    const body = (block?.[0] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const projected = [...body.matchAll(/pub\.(\w+) = inst\.\w+/g)].map((m) => m[1]);
    // Exactly the cosmetic inspect fields, and NOTHING that carries bind state.
    expect(projected.sort()).toEqual(['enchant', 'rolled', 'signer']);
    // Syntax-independent backstop: the extractor above only sees dot-notation
    // assignment, so a widening written as pub['boundTo'] = inst.boundTo or an
    // Object.assign spread would slip past it. Pin the FIELD NAMES out of the
    // loop body entirely, which no assignment shape can dodge.
    for (const field of ['boundTo', 'bindOnTrade', 'charges']) {
      expect(body, `${field} must not ride the public eqi wire`).not.toContain(field);
    }
  });

  // The SAME trim has a SECOND consumer: wornTooltipInstance
  // (item_instance_tooltip.ts) strips the paperdoll tooltip to the eqi fields
  // for the identical reason. Both are pinned in their own files, but nothing
  // linked them, so widening the wire would fail only the pin above and leave
  // the tooltip copy to be found later. Cross-pinned here instead: the two
  // consumers of one policy must agree, mechanically.
  it('pins wornTooltipInstance to that same allowlist, so both consumers move together', () => {
    const worn = wornTooltipInstance({
      signer: 'Tester',
      enchant: 'enchant_chest_stamina',
      rolled: { masterwork: true, stats: { sta: 4 } },
      boundTo: 7,
      bindOnTrade: true,
      charges: { some_effect: 2 },
    });
    expect(
      Object.keys(worn ?? {}).sort(),
      'wornTooltipInstance and the eqi wire encode one policy: widen both or neither',
    ).toEqual(['enchant', 'rolled', 'signer']);
  });

  // The exported sweep list claims two things about itself: that it is the
  // WHOLE union, and that it is in emit order. It is derived from the
  // tsc-checked key table, so the first claim now holds by construction; this
  // pins the second against the emitter, which is the only thing derivation
  // cannot guarantee. A victim carrying everything must emit exactly the list.
  it('is the emit order, pinned against preservedReplaceTraits itself', () => {
    expect(
      preservedReplaceTraits({
        signer: 'Tester',
        rolled: { masterwork: true },
        boundTo: 1,
        bindOnTrade: true,
      }),
    ).toEqual([...ENCHANT_PRESERVED_TRAITS]);
  });

  it('names a live, non-empty catalog row for every trait, and no two share one', () => {
    // Swept from the EXPORTED union, not a hand-copied list: a fifth trait added
    // later without a catalog row has to fail here rather than slip through a
    // stale literal array.
    const traits = ENCHANT_PRESERVED_TRAITS;
    expect(traits.length, 'the union is non-empty').toBeGreaterThan(0);
    // Record<string, unknown>, not Record<string, string>: the enchanting block
    // also holds the nested `tier` object, so the stricter cast does not
    // overlap. The typeof assertion below is what pins each row to a string.
    const table = hudChromeStrings.enchanting as Record<string, unknown>;
    const keys = traits.map((trait) => preservedTraitKey(trait));
    for (const key of keys) {
      expect(key.startsWith('hudChrome.enchanting.'), `${key} names the enchanting block`).toBe(
        true,
      );
      const leaf = key.slice('hudChrome.enchanting.'.length);
      const value = table[leaf];
      expect(typeof value, `catalog row for ${key}`).toBe('string');
      expect(String(value).length, `non-empty label for ${key}`).toBeGreaterThan(0);
    }
    // A copy-paste that pointed two traits at one key would print the same
    // label twice in "Kept: ..." and read as a duplicate, not a bug.
    expect(new Set(keys).size).toBe(traits.length);
    // The bond label speaks the COMMISSION vocabulary the item tooltip and the
    // unbind window already use, never the raw payload field name: a player has
    // to recognize the mechanic being preserved.
    const bond = String(table[preservedTraitKey('bond').slice('hudChrome.enchanting.'.length)]);
    expect(bond.toLowerCase()).toContain('commission');
    expect(bond.toLowerCase()).not.toContain('bindontrade');
    expect(bond.toLowerCase()).not.toContain('boundto');
  });
});

// #2421: the replace ROW facts the painter needs, on both target families.
describe('enchant_apply_view: preserved facts on the replace rows (#2421)', () => {
  const SWORD = 'eastbrook_arming_sword';
  const WEAPON_ENCHANT = 'enchant_weapon_might';
  const AGILITY = 'enchant_weapon_agility';

  it('carries the bagged victim traits, bind state included', () => {
    const targets = enchantTargets(
      [
        {
          itemId: SWORD,
          count: 1,
          instance: {
            enchant: AGILITY,
            signer: 'Tester',
            rolled: { masterwork: true, stats: { agi: 2 } },
            bindOnTrade: true,
          },
        },
      ],
      WEAPON_ENCHANT,
    );
    expect(targets).toEqual([
      {
        itemId: SWORD,
        count: 1,
        replace: {
          enchantId: AGILITY,
          sameEnchant: false,
          preserved: ['signer', 'masterwork', 'bond'],
        },
      },
    ]);
  });

  it('OMITS the key entirely when the victim carries nothing, never an empty array', () => {
    const targets = enchantTargets(
      [{ itemId: SWORD, count: 1, instance: { enchant: AGILITY } }],
      WEAPON_ENCHANT,
    );
    // toEqual ignores undefined-valued keys, so assert on the object itself:
    // an empty array here would make the painter print a bare "Kept: ".
    expect(Object.hasOwn(targets[0].replace ?? {}, 'preserved')).toBe(false);
  });

  it('carries them on a LEGACY victim too, whose signature and bond also survive', () => {
    const targets = enchantTargets(
      [
        {
          itemId: SWORD,
          count: 1,
          instance: { signer: 'Tester', rolled: { stats: { agi: 2 } }, boundTo: 2 },
        },
      ],
      WEAPON_ENCHANT,
    );
    expect(targets[0].replace).toEqual({
      stats: { agi: 2 },
      sameEnchant: false,
      preserved: ['signer', 'bond'],
    });
  });

  it("describes the PINNED victim's traits, not another enchanted copy's", () => {
    // Two enchanted copies of one id carrying DIFFERENT facts. replaceVictimIndex
    // pins the highest-index copy, so the kept line has to describe that one; a
    // first-match walk would promise the wrong copy's signature.
    const targets = enchantTargets(
      [
        { itemId: SWORD, count: 1, instance: { enchant: AGILITY, signer: 'Tester' } },
        {
          itemId: SWORD,
          count: 1,
          instance: { enchant: AGILITY, rolled: { masterwork: true }, bindOnTrade: true },
        },
      ],
      WEAPON_ENCHANT,
    );
    expect(targets[0].replace?.preserved).toEqual(['masterwork', 'bond']);
  });

  it('carries traits on a LEGACY victim read off the WORN mirror too', () => {
    // The uncovered cross of the two arms: no enchant marker AND wire-trimmed.
    // The signature still survives and is still visible on the eqi wire; the
    // bond is dropped like every other worn victim.
    const rows = wornEnchantTargets(
      { mainhand: SWORD },
      { mainhand: { signer: 'Tester', rolled: { stats: { agi: 2 } }, boundTo: 4 } },
      WEAPON_ENCHANT,
    );
    expect(rows).toEqual([
      {
        itemId: SWORD,
        slot: 'mainhand',
        replace: { stats: { agi: 2 }, sameEnchant: false, preserved: ['signer'] },
      },
    ]);
  });

  it('the WORN row states signature and masterwork but never a bind state', () => {
    const rows = wornEnchantTargets(
      { mainhand: SWORD },
      {
        mainhand: {
          enchant: AGILITY,
          signer: 'Tester',
          rolled: { masterwork: true, stats: { agi: 2 } },
          boundTo: 5,
        },
      },
      WEAPON_ENCHANT,
    );
    // The offline Sim holds boundTo here; the online eqi mirror never does.
    // Both hosts must produce this same row (see preservedReplaceTraits).
    expect(rows).toEqual([
      {
        itemId: SWORD,
        slot: 'mainhand',
        replace: {
          enchantId: AGILITY,
          sameEnchant: false,
          preserved: ['signer', 'masterwork'],
        },
      },
    ]);
  });
});

// #2421: the mixed holding, the only case that emits two rows sharing one item
// display name. The flag is what lets the painter tag the plain twin, so the
// pair differs by what each row SAYS rather than by one of them having a
// sub-line and the other having none.
describe('enchant_apply_view: mixedHolding (#2421)', () => {
  const chestId = itemForSlot('chest');
  const otherChestId = itemForSlot('chest', new Set([chestId]));

  it('flags BOTH rows of one item id held plain and enchanted', () => {
    const targets = enchantTargets(
      [
        { itemId: chestId, count: 2 },
        { itemId: chestId, count: 1, instance: { enchant: 'enchant_chest_spirit' } },
      ],
      'enchant_chest_stamina',
    );
    expect(targets).toEqual([
      { itemId: chestId, count: 2, mixedHolding: true },
      {
        itemId: chestId,
        count: 1,
        replace: { enchantId: 'enchant_chest_spirit', sameEnchant: false },
        mixedHolding: true,
      },
    ]);
  });

  it('leaves an unambiguous list unflagged, so an ordinary target list stays tag-free', () => {
    const targets = enchantTargets(
      [
        { itemId: chestId, count: 2 },
        { itemId: otherChestId, count: 1, instance: { enchant: 'enchant_chest_spirit' } },
      ],
      'enchant_chest_stamina',
    );
    // Two rows, two DIFFERENT item ids: neither shares a name with the other.
    for (const row of targets) expect(Object.hasOwn(row, 'mixedHolding')).toBe(false);
  });

  it('does not flag a plain row whose enchanted twin the picker DROPPED', () => {
    // An unresolvable marker id is never offered (the sim would refuse it), so
    // only one row survives for this id and there is nothing to disambiguate.
    const targets = enchantTargets(
      [
        { itemId: chestId, count: 2 },
        { itemId: chestId, count: 1, instance: { enchant: 'not_a_real_enchant' } },
      ],
      'enchant_chest_stamina',
    );
    expect(targets).toEqual([{ itemId: chestId, count: 2 }]);
  });

  // The CROSS-FAMILY holding: the enchanted copy is WORN and its plain twin is
  // in the bags. Both paint into one list, so the bare bagged row is exactly the
  // "one row has a sub-line, the other has none" pair the flag exists to remove,
  // and nothing about it being on the body changes that.
  it('flags a bagged plain row whose only enchanted twin is WORN', () => {
    const worn = wornEnchantTargets(
      { chest: chestId },
      { chest: { enchant: 'enchant_chest_spirit' } },
      'enchant_chest_stamina',
    );
    expect(worn[0]?.replace, 'the worn copy is the enchanted twin').toBeDefined();
    expect(enchantTargets([{ itemId: chestId, count: 2 }], 'enchant_chest_stamina', worn)).toEqual([
      { itemId: chestId, count: 2, mixedHolding: true },
    ]);
    // Without the worn rows the same bags read as unambiguous, which is what
    // makes the argument load-bearing rather than incidental.
    expect(
      enchantTargets([{ itemId: chestId, count: 2 }], 'enchant_chest_stamina')[0].mixedHolding,
    ).toBeUndefined();
  });

  it('flags a bagged plain row when the WORN twin is a same-enchant deny row too', () => {
    // Disabled, but still on screen and still stating a state the bare bagged
    // row does not: the pair is read before either is activated.
    const worn = wornEnchantTargets(
      { chest: chestId },
      { chest: { enchant: 'enchant_chest_stamina' } },
      'enchant_chest_stamina',
    );
    expect(worn[0]?.replace?.sameEnchant).toBe(true);
    expect(
      enchantTargets([{ itemId: chestId, count: 1 }], 'enchant_chest_stamina', worn)[0]
        .mixedHolding,
    ).toBe(true);
  });

  // The OTHER known limit, pinned the same way: a plain worn copy beside a plain
  // bagged one is a LOCATION ambiguity, not a state one. Both are unenchanted,
  // so "Not enchanted" would say nothing that told them apart; the worn row
  // already states where it is, and closing the rest needs a bag-side
  // counterpart to the Worn tag rather than this flag.
  it('does NOT flag a bagged plain row whose worn twin is also plain', () => {
    const worn = wornEnchantTargets({ chest: chestId }, {}, 'enchant_chest_stamina');
    expect(worn, 'the worn copy is a plain, unflagged target row').toEqual([
      { itemId: chestId, slot: 'chest' },
    ]);
    const targets = enchantTargets([{ itemId: chestId, count: 1 }], 'enchant_chest_stamina', worn);
    expect(Object.hasOwn(targets[0], 'mixedHolding')).toBe(false);
  });

  // The #2465 limit pin, INVERTED by #2466. mixedHolding still keys on the item
  // ID, which is right, because it reports a difference of STATE between two
  // copies of one item; a base/heroic pair is a difference of NAME between two
  // ids, and the `heroic` discriminator is what answers that. So the pair is
  // still unflagged here AND is no longer ambiguous, which the flag alone could
  // never have told apart from the old broken state.
  it('does not flag a base/heroic pair, and marks the heroic row instead', () => {
    const found = Object.keys(ITEMS).find((id) => {
      const def = ITEMS[id];
      return def.heroicOf !== undefined && ITEMS[def.heroicOf]?.slot === 'chest';
    });
    // Asserted, never an early return: content HAS heroic chest variants, and a
    // silent skip would let this pin rot into a test that proves nothing.
    expect(found, 'content carries a heroic chest variant to pin the case with').toBeDefined();
    const heroic = found as string;
    const base = ITEMS[heroic].heroicOf as string;
    // The premise: two ids, ONE rendered name. Without a discriminator the two
    // rows below are byte-identical to a reader and to a screen reader.
    expect(itemDisplayName(ITEMS[heroic])).toBe(itemDisplayName(ITEMS[base]));
    const targets = enchantTargets(
      [
        { itemId: base, count: 1 },
        { itemId: heroic, count: 1 },
      ],
      'enchant_chest_stamina',
    );
    expect(targets).toEqual([
      { itemId: base, count: 1 },
      { itemId: heroic, count: 1, heroic: true },
    ]);
    // Neither is a mixed holding: both copies are plain, so "Not enchanted"
    // would still say nothing that told them apart.
    for (const row of targets) expect(Object.hasOwn(row, 'mixedHolding')).toBe(false);
  });

  it('does not flag a lone replace row, nor the sameEnchant deny pair', () => {
    expect(
      enchantTargets(
        [{ itemId: chestId, count: 1, instance: { enchant: 'enchant_chest_spirit' } }],
        'enchant_chest_stamina',
      )[0].mixedHolding,
    ).toBeUndefined();
    // The disabled twin still SHARES the name, so it stays flagged: the pair is
    // read before either is activated.
    const denied = enchantTargets(
      [
        { itemId: chestId, count: 1 },
        { itemId: chestId, count: 1, instance: { enchant: 'enchant_chest_stamina' } },
      ],
      'enchant_chest_stamina',
    );
    expect(denied.map((row) => row.mixedHolding)).toEqual([true, true]);
  });
});

// #2466: the two NAME discriminators. A target list may hold rows whose item
// display names collide (a heroic variant renders its base item's name) or whose
// worn-slot labels collide (both fingers read "Finger"), and a row is a
// role=button whose accessible name is computed from its contents, so two such
// rows are told apart by nothing a player or a screen reader can reach.
describe('enchant_apply_view: name discriminators (#2466)', () => {
  const CHEST_ENCHANT = 'enchant_chest_stamina';
  const OTHER_CHEST_ENCHANT = 'enchant_chest_spirit';
  const RING_ENCHANT = 'enchant_ring_spirit';

  /** A live base/heroic pair in an enchant-eligible slot, from real content. */
  function heroicPair(slot: ItemSlot): { base: string; heroic: string } {
    const heroic = Object.keys(ITEMS).find((id) => {
      const def = ITEMS[id];
      return def.heroicOf !== undefined && ITEMS[def.heroicOf]?.slot === slot;
    });
    expect(heroic, `content carries a heroic ${slot} variant`).toBeDefined();
    return { base: ITEMS[heroic as string].heroicOf as string, heroic: heroic as string };
  }

  it('marks a heroic BAGGED row and leaves an ordinary one unmarked', () => {
    const { base, heroic } = heroicPair('chest');
    expect(
      enchantTargets([{ itemId: heroic, count: 1 }], CHEST_ENCHANT)[0].heroic,
      'the heroic copy carries the mark',
    ).toBe(true);
    // Absent, never false: the flag reads as "this row says something extra",
    // the mixedHolding idiom, so an ordinary list carries no new fields at all.
    expect(
      Object.hasOwn(enchantTargets([{ itemId: base, count: 1 }], CHEST_ENCHANT)[0], 'heroic'),
    ).toBe(false);
  });

  it('marks the heroic REPLACE row, the pair the state tags could never separate', () => {
    // Two ids, one name, and the SAME doomed enchant: both rows would have read
    // "<name> / Replaces Chest Spirit", down to the byte, and both stayed
    // activatable. This is the worst case the issue names.
    const { base, heroic } = heroicPair('chest');
    const targets = enchantTargets(
      [
        { itemId: base, count: 1, instance: { enchant: OTHER_CHEST_ENCHANT } },
        { itemId: heroic, count: 1, instance: { enchant: OTHER_CHEST_ENCHANT } },
      ],
      CHEST_ENCHANT,
    );
    expect(targets).toEqual([
      {
        itemId: base,
        count: 1,
        replace: { enchantId: OTHER_CHEST_ENCHANT, sameEnchant: false },
      },
      {
        itemId: heroic,
        count: 1,
        replace: { enchantId: OTHER_CHEST_ENCHANT, sameEnchant: false },
        heroic: true,
      },
    ]);
  });

  it('marks a heroic WORN row too, on the replace arm as well as the plain one', () => {
    const { base, heroic } = heroicPair('mainhand');
    const [picked, worn] = Object.keys(ENCHANTS).filter(
      (id) => ENCHANTS[id].itemSlot === 'mainhand',
    );
    expect(worn, 'content carries two mainhand enchants').toBeDefined();
    expect(wornEnchantTargets({ mainhand: heroic }, {}, picked)).toEqual([
      { itemId: heroic, slot: 'mainhand', heroic: true },
    ]);
    // The replace arm pushes its row and CONTINUES inside the slot loop, so it
    // needs its own case: a discriminator applied on one arm only is the whole
    // bug again, one arm narrower.
    const replaced = wornEnchantTargets(
      { mainhand: heroic },
      { mainhand: { enchant: worn } },
      picked,
    );
    expect(replaced[0]?.replace, 'the worn copy is a replace row').toBeDefined();
    expect(replaced[0]?.heroic).toBe(true);
    expect(
      Object.hasOwn(wornEnchantTargets({ mainhand: base }, {}, picked)[0], 'heroic'),
      'the base copy carries no mark',
    ).toBe(false);
  });

  // The tooltip marks BOTH heroic shapes (hud.ts gates on `heroicOf || heroic`),
  // and no content def sets the bespoke `heroic` flag today, so the only way to
  // hold the picker to the same condition is to author one. Without this the
  // narrower predicate (heroicOf alone) would pass every other test in the file
  // while leaving a bespoke heroic piece marked on its tooltip and unmarked here.
  it('marks a BESPOKE heroic piece too, on the same condition the tooltip uses', () => {
    const base = itemForSlot('chest');
    const bespoke = 'zz_test_bespoke_heroic_chest';
    ITEMS[bespoke] = { ...ITEMS[base], id: bespoke, heroic: true };
    try {
      const rows = enchantTargets(
        [
          { itemId: base, count: 1 },
          { itemId: bespoke, count: 1 },
        ],
        CHEST_ENCHANT,
      );
      // It keeps its OWN name key (unlike a heroicOf variant), so this arm is
      // about agreeing with the tooltip rather than about a name collision.
      expect(rows.map((row) => row.heroic)).toEqual([undefined, true]);
      expect(wornEnchantTargets({ chest: bespoke }, {}, CHEST_ENCHANT)[0]?.heroic).toBe(true);
    } finally {
      delete ITEMS[bespoke];
    }
  });

  it('numbers the two FINGERS, so identical rings worn on both stand apart', () => {
    // One item id in both fingers is the reachable shape (content has no heroic
    // ring), and it emitted two rows whose only difference was an invisible
    // data-act: ring1 and ring2 share the one "Finger" label.
    const ring = itemForSlot('ring');
    const rows = wornEnchantTargets({ ring1: ring, ring2: ring }, {}, RING_ENCHANT);
    expect(rows).toEqual([
      { itemId: ring, slot: 'ring1', slotIndex: 1 },
      { itemId: ring, slot: 'ring2', slotIndex: 2 },
    ]);
    // Numbered on the replace arm too, including the disabled same-enchant pair:
    // a row is read before it is activated, so an inert row still has to say
    // which finger it describes.
    const enchanted = wornEnchantTargets(
      { ring1: ring, ring2: ring },
      { ring1: { enchant: RING_ENCHANT }, ring2: { enchant: RING_ENCHANT } },
      RING_ENCHANT,
    );
    expect(enchanted.map((row) => [row.slot, row.slotIndex, row.replace?.sameEnchant])).toEqual([
      ['ring1', 1, true],
      ['ring2', 2, true],
    ]);
  });

  it('numbers nothing when the slot label already names the slot alone', () => {
    // The selectivity half: a dual-wielded pair reads "Main Hand" / "Off Hand"
    // already, so numbering it would be noise. Both arms of the same list.
    const sword = itemForSlot('mainhand');
    const enchantId = Object.keys(ENCHANTS).find((id) => ENCHANTS[id].itemSlot === 'mainhand');
    const rows = wornEnchantTargets({ mainhand: sword, offhand: sword }, {}, enchantId as string);
    expect(rows.map((row) => row.slot)).toEqual(['mainhand', 'offhand']);
    for (const row of rows) expect(Object.hasOwn(row, 'slotIndex')).toBe(false);
  });

  // The COMPLETENESS premise, stated as the exact property one BOOLEAN
  // discriminator can carry: every eligible item is unique in (display name,
  // heroic) across the whole eligible catalog. Two ordinary items sharing a name
  // would collide with nothing to separate them; so would two heroic variants of
  // one base, or a heroicOf chain (itemDisplayName recurses, so B and C both
  // resolve to A's name and isHeroicItem is true for both). Asserting the pair
  // shape instead ("one plain id plus variants of it") would pass all three.
  //
  // Swept over EVERY LOCALE's resolved table, not only English: itemDisplayName
  // resolves through t(), so a translation that collapses two distinct items onto
  // one name re-opens #2466 in that locale alone, where no test running under
  // `en` can see it. Two chest robes really did collide in cs_CZ and tr_TR.
  it('has no (display name, heroic) collision in an eligible slot, in ANY locale', () => {
    const eligibleSlots = new Set(Object.values(ENCHANTS).map((enchant) => enchant.itemSlot));
    const eligible = Object.values(ITEMS).filter(
      (def) => def.slot !== undefined && eligibleSlots.has(def.slot),
    );
    expect(eligible.length, 'content carries enchant-eligible items').toBeGreaterThan(0);
    // The heroic condition the picker actually uses, restated here rather than
    // imported: this pin exists to hold the CONTENT premise, so it must not move
    // whenever the core's predicate does.
    const heroic = (def: ItemDef): boolean => def.heroicOf !== undefined || def.heroic === true;
    let sharedNames = 0;
    for (const [lang, table] of Object.entries(translations) as [string, LocaleTable][]) {
      const byKey = new Map<string, string[]>();
      const byName = new Map<string, string[]>();
      for (const def of eligible) {
        // itemDisplayName's own resolution: a heroicOf variant reads its BASE
        // item's name row, every other item reads its own.
        const nameId = def.heroicOf ?? def.id;
        const name = table.entities?.items?.[nameId]?.name;
        expect(name, `${lang} carries a name for ${nameId}`).toBeTruthy();
        const key = `${name} ${heroic(def) ? 'heroic' : 'plain'}`;
        byKey.set(key, [...(byKey.get(key) ?? []), def.id]);
        byName.set(name as string, [...(byName.get(name as string) ?? []), def.id]);
      }
      for (const [key, ids] of byKey) {
        expect(
          ids,
          `${lang}: ${ids.join(', ')} share (name, heroic) ${JSON.stringify(key)}`,
        ).toHaveLength(1);
      }
      sharedNames += [...byName.values()].filter((ids) => ids.length > 1).length;
    }
    // Non-vacuity, and the reason the mark is load-bearing rather than
    // decoration: names ARE shared in live content, and the assertion above
    // passes only because the mark separates the rows that share them.
    expect(sharedNames, 'live content shares display names across ids').toBeGreaterThan(0);
  });
});
