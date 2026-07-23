// Coverage for the Enchanting profession: disenchant (layered on top of the
// existing everyone-can-salvage system, ./professions/salvage.ts, issue
// #1300) and applyEnchant (a permanent stat bonus on a SPECIFIC held copy of
// an item, carried through equip/unequip via PlayerMeta.equipmentInstance).

import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ITEMS } from '../src/sim/data';
import { characterDerivedStats } from '../src/sim/entity';
import { removePreferFungible } from '../src/sim/items';
import {
  disenchantItem,
  disenchantYield,
  ENCHANTING_GAIN_TIER_BY_QUALITY,
  ENCHANTING_SKILL_GAIN,
  enchantGainTier,
  isDisenchantable,
  isEnchantedInstance,
  resolveApplyEnchant,
  resolveDisenchant,
} from '../src/sim/professions/enchanting';
import { Sim } from '../src/sim/sim';
import { xpForLevel } from '../src/sim/types';

function makeSim(seed = 7) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

describe('disenchant', () => {
  it('an ineligible item (consumable/junk) cannot be disenchanted', () => {
    expect(isDisenchantable(undefined)).toBe(false);
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem('tough_jerky', 1, pid);
    const result = resolveDisenchant(sim.ctx, pid, 'tough_jerky');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_disenchantable');
  });

  it('denies disenchanting an item the player does not hold', () => {
    const sim = makeSim();
    const result = resolveDisenchant(sim.ctx, sim.playerId, 'eastbrook_arming_sword');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_held');
  });

  it('disenchanting consumes the item and yields the dedicated arcane material, not plain salvage junk', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem('eastbrook_arming_sword', 1, pid);
    const result = resolveDisenchant(sim.ctx, pid, 'eastbrook_arming_sword');
    expect(result.ok).toBe(true);
    // Pinned literal: a common-quality piece disenchants into arcane_dust per
    // DISENCHANT_MATERIAL_BY_QUALITY, so a remap cannot pass silently. This is
    // a DIFFERENT item than plain salvage's bone_fragments yield for the same
    // piece, confirming disenchant is strictly its own (better) yield table.
    expect(result.materialItemId).toBe('arcane_dust');
    expect(result.count).toBeGreaterThan(0);
    expect(sim.countItem('eastbrook_arming_sword', pid)).toBe(0);
    if (result.materialItemId) {
      expect(sim.countItem(result.materialItemId, pid)).toBe(result.count);
    }
  });

  it('yield scales with rarity: the qualityIdx AND derived-tier terms make an epic strictly outyield a common with the same rng draw', () => {
    // Scope note: this pins the disenchantYield HELPER, which since
    // the typed-reagent amendment is the SUB-RARE arm only (resolveDisenchant
    // grants fixed counts at rare+; the resolve-level per-quality counts are
    // pinned in professions_typed_reagents.test.ts). The helper keeps both
    // terms protected exactly as before.
    // Same seed for both, so the rng draws (the +0/+1 bonus term) line up
    // identically; only quality differs. Both fake items have no explicit
    // requiredLevel and no derivable itemSourceLevel, so requiredLevelFor
    // falls back per-quality: common -> 1 (tierBonus 0), epic -> 18
    // (tierBonus 1). Gap = qualityIdx delta (common=1, epic=4 -> 3) + tier
    // delta (1) = 4. Pinning the exact delta (rather than
    // toBeGreaterThanOrEqual) means both terms are protected: deleting
    // either one changes this number (#1712 round-3 review point 11: the
    // tier axis previously read raw `def.requiredLevel`, which only the 41
    // level-20 epics set, so it was inert for every other item; it now reads
    // the derived requiredLevelFor, same as item_level_req.ts's equip gate).
    const low = disenchantYield(
      { id: 'a', name: 'a', sellValue: 0, quality: 'common', kind: 'weapon' } as never,
      makeSim(11).ctx.rng,
    );
    const high = disenchantYield(
      { id: 'b', name: 'b', sellValue: 0, quality: 'epic', kind: 'weapon' } as never,
      makeSim(11).ctx.rng,
    );
    expect(high - low).toBe(4);
  });

  it('the disenchantItem command entry point resolves the caller and stashes nothing extra beyond the result', () => {
    const sim = makeSim();
    sim.addItem('eastbrook_arming_sword', 1, sim.playerId);
    sim.disenchantItem('eastbrook_arming_sword');
    expect(sim.lastDisenchantResult?.ok).toBe(true);
    const denied = disenchantItem(sim.ctx, 'nonexistent_item_id');
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('unknown_item');
  });

  // Regression for review #1712 point 2: crafting.ts grants every rare-or-better
  // single-copy craft as an instanced copy (signer + rolled.quality, no
  // rolled.stats) for Battlefield Experience attribution. The fungible-only gate
  // this replaced (countFungibleItem) excluded ALL instanced slots, so a crafted
  // rare could never be disenchanted even though it carries no enchant yet.
  it('a crafted rare instanced copy (signer + rolled.quality, no rolled.stats) can still be disenchanted', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // Simulate crafting.ts's single-copy rare+ grant directly, matching its
    // exact instance shape (no rolled.stats: that only appears once an enchant
    // is applied).
    sim.ctx.addItemInstance(
      'moggers_copper_cudgel',
      { signer: 'Tester', rolled: { quality: 'rare' } },
      pid,
    );
    expect(sim.ctx.countFungibleItem('moggers_copper_cudgel', pid)).toBe(0);
    expect(sim.ctx.countEnchantableItem('moggers_copper_cudgel', pid)).toBe(1);
    const result = resolveDisenchant(sim.ctx, pid, 'moggers_copper_cudgel');
    expect(result.ok).toBe(true);
    expect(sim.countItem('moggers_copper_cudgel', pid)).toBe(0);
  });
});

describe('applyEnchant', () => {
  it('denies an unknown item id or unknown enchant id', () => {
    const sim = makeSim();
    expect(resolveApplyEnchant(sim.ctx, sim.playerId, 'nope', 'enchant_weapon_might').reason).toBe(
      'unknown_item',
    );
    expect(
      resolveApplyEnchant(sim.ctx, sim.playerId, 'eastbrook_arming_sword', 'nope').reason,
    ).toBe('unknown_enchant');
  });

  it('denies an enchant applied to the wrong item slot', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem('eastbrook_arming_sword', 1, pid); // mainhand
    const result = resolveApplyEnchant(
      sim.ctx,
      pid,
      'eastbrook_arming_sword',
      'enchant_helmet_fortitude', // itemSlot: 'helmet'
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('wrong_slot');
  });

  it('denies applying without holding the item, or without every reagent', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    expect(
      resolveApplyEnchant(sim.ctx, pid, 'eastbrook_arming_sword', 'enchant_weapon_might').reason,
    ).toBe('not_held');

    sim.addItem('eastbrook_arming_sword', 1, pid);
    expect(
      resolveApplyEnchant(sim.ctx, pid, 'eastbrook_arming_sword', 'enchant_weapon_might').reason,
    ).toBe('insufficient_materials');
  });

  it('applying consumes the plain copy and every reagent, and grants a freshly-instanced enchanted copy', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem('eastbrook_arming_sword', 1, pid);
    sim.addItem('arcane_dust', 5, pid);
    const result = resolveApplyEnchant(
      sim.ctx,
      pid,
      'eastbrook_arming_sword',
      'enchant_weapon_might',
    );
    expect(result.ok).toBe(true);
    expect(sim.countItem('arcane_dust', pid)).toBe(0);
    // Still exactly 1 copy of the sword held (the plain one consumed, the
    // enchanted one granted) - total count unchanged, but it must now be a
    // distinct instanced slot, verified via countFungibleItem below.
    expect(sim.countItem('eastbrook_arming_sword', pid)).toBe(1);
    expect(sim.ctx.countFungibleItem('eastbrook_arming_sword', pid)).toBe(0);
  });

  it('equipping the enchanted copy boosts the matching stat; unequipping preserves it in bags', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const baseStr = sim.player.stats.str;
    sim.addItem('eastbrook_arming_sword', 1, pid);
    sim.addItem('arcane_dust', 5, pid);
    const applied = resolveApplyEnchant(
      sim.ctx,
      pid,
      'eastbrook_arming_sword',
      'enchant_weapon_might',
    );
    expect(applied.ok).toBe(true);

    // Pin the enchant's own magnitude to a literal ONCE here, so the
    // assertions below compare against baseStr + 2 directly rather than
    // reading the bonus back out of the same ENCHANTS constant the resolver
    // consumed (which would leave the magnitude itself unprotected).
    expect(ENCHANTS.enchant_weapon_might.statBonus.str).toBe(2);

    sim.equipItem('eastbrook_arming_sword');
    expect(sim.player.stats.str).toBe(baseStr + 2);

    expect(sim.unequipItem('mainhand')).toBe(true);
    // The enchant bonus is gone once unequipped...
    expect(sim.player.stats.str).toBe(baseStr);
    // ...but the item (and its enchant) is still in bags, not lost.
    expect(sim.countItem('eastbrook_arming_sword', pid)).toBe(1);

    // Re-equipping the same (still-enchanted) copy restores the bonus, proving
    // the enchant round-trips through bags rather than being a one-shot buff.
    sim.equipItem('eastbrook_arming_sword');
    expect(sim.player.stats.str).toBe(baseStr + 2);
  });

  it('swapping in a plain (unenchanted) replacement drops the enchant bonus, and the enchanted piece returns to bags intact', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const baseStr = sim.player.stats.str;
    sim.addItem('eastbrook_arming_sword', 1, pid);
    sim.addItem('arcane_dust', 5, pid);
    resolveApplyEnchant(sim.ctx, pid, 'eastbrook_arming_sword', 'enchant_weapon_might');
    sim.equipItem('eastbrook_arming_sword');
    expect(sim.player.stats.str).toBe(baseStr + (ENCHANTS.enchant_weapon_might.statBonus.str ?? 0));

    // A second, plain copy of the same item id: equipping it should swap out
    // the enchanted one (back to bags, enchant intact) and grant no bonus.
    sim.addItem('eastbrook_arming_sword', 1, pid);
    expect(sim.ctx.countFungibleItem('eastbrook_arming_sword', pid)).toBe(1);
    sim.equipItem('eastbrook_arming_sword');
    expect(sim.player.stats.str).toBe(baseStr);
    // Both copies are still held: the plain one now equipped (countItem only
    // scans bags, so it does not show up there), the enchanted one back in
    // bags, and still non-fungible (proving it kept its instance, not
    // silently flattened into a plain stack on the way back).
    expect(sim.countItem('eastbrook_arming_sword', pid)).toBe(1);
    expect(sim.ctx.countFungibleItem('eastbrook_arming_sword', pid)).toBe(0);
  });

  // Regression for review #1712 point 2, apply-enchant direction: a crafted
  // rare instanced copy (no rolled.stats) is eligible; an already-enchanted
  // instanced copy (rolled.stats present) is correctly excluded, so an
  // enchant can never silently overwrite an existing one.
  it('a crafted rare instanced copy can be enchanted; an already-enchanted copy cannot be enchanted again', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(
      'moggers_copper_cudgel',
      { signer: 'Tester', rolled: { quality: 'rare' } },
      pid,
    );
    sim.addItem('arcane_dust', 5, pid);
    expect(sim.ctx.countEnchantableItem('moggers_copper_cudgel', pid)).toBe(1);
    const result = resolveApplyEnchant(
      sim.ctx,
      pid,
      'moggers_copper_cudgel',
      'enchant_weapon_might',
    );
    expect(result.ok).toBe(true);
    // The crafted (unenchanted) instance was consumed and replaced by a
    // freshly-enchanted one; nothing fungible was ever involved.
    expect(sim.ctx.countFungibleItem('moggers_copper_cudgel', pid)).toBe(0);
    expect(sim.countItem('moggers_copper_cudgel', pid)).toBe(1);

    // The now-enchanted copy (rolled.stats present) is no longer eligible.
    expect(sim.ctx.countEnchantableItem('moggers_copper_cudgel', pid)).toBe(0);
    sim.addItem('arcane_dust', 5, pid);
    const second = resolveApplyEnchant(
      sim.ctx,
      pid,
      'moggers_copper_cudgel',
      'enchant_weapon_might',
    );
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('not_held');
  });

  // Regression for review #1712 round-3: enchanting a crafted rare+ instanced
  // copy used to consume it and grant a fresh instance carrying ONLY
  // rolled.stats, silently erasing the crafter's signer and rolled.quality
  // (killing battlefield_xp.ts attribution and crafting.ts's
  // hasSelfSignedInstance check). The signer and rolled.quality must survive
  // alongside the new stat bonus.
  it('enchanting a crafted instanced copy preserves its signer and rolled.quality', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(
      'moggers_copper_cudgel',
      { signer: 'Tester', rolled: { quality: 'rare' } },
      pid,
    );
    sim.addItem('arcane_dust', 5, pid);
    const result = resolveApplyEnchant(
      sim.ctx,
      pid,
      'moggers_copper_cudgel',
      'enchant_weapon_might',
    );
    expect(result.ok).toBe(true);
    const meta = sim.ctx.resolve(pid)?.meta;
    const slot = meta?.inventory.find((s) => s.itemId === 'moggers_copper_cudgel');
    expect(slot?.instance?.signer).toBe('Tester');
    expect(slot?.instance?.rolled?.quality).toBe('rare');
    expect(slot?.instance?.rolled?.stats).toEqual({ str: 2 });
  });

  it('the applyEnchant command entry point resolves the caller and stashes the result', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem('eastbrook_arming_sword', 1, pid);
    sim.addItem('arcane_dust', 5, pid);
    sim.applyEnchant('eastbrook_arming_sword', 'enchant_weapon_might');
    expect(sim.lastEnchantResult?.ok).toBe(true);
  });

  // Regression for review #1712 point 1: recalcPlayerStats gained equipmentInstance
  // as an optional 5th argument, and several call sites outside professions/
  // enchanting.ts and items.ts (level-up, buff expiry, talent spend, stance
  // toggle, self-buff cast, and the Arena/Vale Cup/Fiesta restore paths) never
  // passed it, so an equipped enchant silently dropped on the next stat recalc
  // through any of those untouched paths. Exercises the level-up path
  // specifically (src/sim/combat/damage.ts grantXp), the easiest to reproduce.
  it('an equipped enchant bonus survives a level-up, not just the equip/unequip cycle', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem('eastbrook_arming_sword', 1, pid);
    sim.addItem('arcane_dust', 5, pid);
    const applied = resolveApplyEnchant(
      sim.ctx,
      pid,
      'eastbrook_arming_sword',
      'enchant_weapon_might',
    );
    expect(applied.ok).toBe(true);
    sim.equipItem('eastbrook_arming_sword');

    const meta = sim.meta(pid)!;
    const levelBefore = sim.player.level;
    const baseStrBeforeLevel = characterDerivedStats(meta.cls, levelBefore, {}).stats.str;
    expect(sim.player.stats.str).toBe(baseStrBeforeLevel + 2);

    sim.grantXp(xpForLevel(levelBefore));
    expect(sim.player.level).toBe(levelBefore + 1);

    const baseStrAfterLevel = characterDerivedStats(meta.cls, sim.player.level, {}).stats.str;
    expect(sim.player.stats.str).toBe(baseStrAfterLevel + 2);
  });

  it('an equipped enchant bonus survives a save/reload round-trip (the "permanent" claim)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem('eastbrook_arming_sword', 1, pid);
    sim.addItem('arcane_dust', 5, pid);
    const applied = resolveApplyEnchant(
      sim.ctx,
      pid,
      'eastbrook_arming_sword',
      'enchant_weapon_might',
    );
    expect(applied.ok).toBe(true);
    sim.equipItem('eastbrook_arming_sword');
    // Compare the actual equipped state before/after reload rather than a
    // freshly-derived no-gear baseline, since the starter kit's other slots
    // also contribute stats this reload must reproduce exactly.
    const boostedStr = sim.player.stats.str;

    const state = sim.serializeCharacter(pid);
    expect(state).not.toBeNull();
    expect(state!.equipmentInstance?.mainhand?.rolled?.stats?.str).toBe(2);

    const reloadedSim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const reloadedPid = reloadedSim.addPlayer('warrior', 'Reload', { state: state! });
    const reloadedMeta = reloadedSim.meta(reloadedPid)!;
    const reloadedEntity = reloadedSim.entities.get(reloadedPid)!;
    expect(reloadedMeta.equipmentInstance.mainhand?.rolled?.stats?.str).toBe(2);
    expect(reloadedEntity.stats.str).toBe(boostedStr);
  });

  it('loading a pre-Enchanting save missing equipmentInstance does not crash and grants no bonus', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const state = sim.serializeCharacter(pid)!;
    // Simulate an old save recorded before this feature existed: the key is
    // absent entirely, not just empty.
    delete (state as { equipmentInstance?: unknown }).equipmentInstance;

    const reloadedSim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    expect(() => reloadedSim.addPlayer('warrior', 'Legacy', { state })).not.toThrow();
    const reloadedPid = reloadedSim.addPlayer('warrior', 'Legacy2', { state });
    const meta = reloadedSim.meta(reloadedPid)!;
    expect(meta.equipmentInstance).toEqual({});
  });

  // Regression for review #1712 round-3 point 7a: removePreferFungible's
  // prefer-plain branch (the entire reason the function exists over a plain
  // ctx.removeItem) was untested. With both a plain and an enchanted copy
  // held, removing one must consume the plain copy and leave the enchanted
  // instance untouched.
  it('removePreferFungible consumes the plain copy first, leaving an enchanted instance intact', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem('eastbrook_arming_sword', 1, pid);
    sim.addItem('arcane_dust', 5, pid);
    resolveApplyEnchant(sim.ctx, pid, 'eastbrook_arming_sword', 'enchant_weapon_might');
    // A second, plain copy of the same item id.
    sim.addItem('eastbrook_arming_sword', 1, pid);
    expect(sim.ctx.countFungibleItem('eastbrook_arming_sword', pid)).toBe(1);

    removePreferFungible(sim.ctx, 'eastbrook_arming_sword', 1, pid);

    expect(sim.countItem('eastbrook_arming_sword', pid)).toBe(1);
    // The remaining copy is still the enchanted instance, not fungible.
    expect(sim.ctx.countFungibleItem('eastbrook_arming_sword', pid)).toBe(0);
    expect(sim.ctx.countEnchantableItem('eastbrook_arming_sword', pid)).toBe(0);
  });

  // Regression for review #1712 round-3 point 7b: the only insufficient_materials
  // case tested was zero reagents on a single-reagent enchant. All-or-nothing
  // consumption on a MULTI-reagent enchant (missing just one of the two) was
  // untested, so a bug that consumed reagents in a loop before validating them
  // all would have passed silently.
  it('applying a multi-reagent enchant with one reagent short consumes nothing', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem('recruit_tunic', 1, pid);
    sim.addItem('arcane_dust', 3, pid);
    // enchant_chest_stamina needs 3 dust AND 2 essence; essence is entirely absent.
    const result = resolveApplyEnchant(sim.ctx, pid, 'recruit_tunic', 'enchant_chest_stamina');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
    expect(sim.countItem('arcane_dust', pid)).toBe(3);
    expect(sim.countItem('recruit_tunic', pid)).toBe(1);
  });
});

// Professions 2.0 masterwork model: a masterwork proc copy carries
// rolled.masterwork + baked rolled.stats WITHOUT an enchant, so the old
// bare-stats-presence guard would have wrongly locked it out of enchanting.
// The authoritative predicate is now isEnchantedInstance (the explicit
// `enchant` marker, or the legacy bare-stats arm), the enchant merges stats
// ADDITIVELY, and double-enchant stays blocked for old and new copies alike.
describe('isEnchantedInstance (the masterwork guard predicate)', () => {
  it('distinguishes enchanted copies from masterwork and plain crafted copies', () => {
    // Marker-carrying (new) enchanted copy.
    expect(isEnchantedInstance({ enchant: 'enchant_weapon_might' })).toBe(true);
    // Legacy enchanted copy: bare rolled.stats, predating the marker.
    expect(isEnchantedInstance({ rolled: { stats: { str: 5 } } })).toBe(true);
    // Masterwork copy: rolled.stats WITH rolled.masterwork is the baked bonus,
    // not an enchant, so it must stay enchantable.
    expect(
      isEnchantedInstance({ signer: 'Tester', rolled: { masterwork: true, stats: { str: 2 } } }),
    ).toBe(false);
    // Crafted rare signed copy (legacy rolled.quality shape): never enchanted.
    expect(isEnchantedInstance({ signer: 'Tester', rolled: { quality: 'rare' } })).toBe(false);
    // Empty payload: not enchanted.
    expect(isEnchantedInstance({})).toBe(false);
  });
});

describe('applyEnchant on a masterwork copy', () => {
  // The exact crafting.ts masterwork grant shape: signer + rolled.masterwork +
  // baked bonus stats, no rolled.quality, no enchant marker.
  const MASTERWORK_PAYLOAD = {
    signer: 'Tester',
    rolled: { masterwork: true, stats: { str: 2, sta: 1 } },
  };

  it('a masterwork instance is enchantable: baked and enchant stats both survive, additively', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance('moggers_copper_cudgel', structuredClone(MASTERWORK_PAYLOAD), pid);
    expect(sim.ctx.countEnchantableItem('moggers_copper_cudgel', pid)).toBe(1);
    sim.addItem('arcane_dust', 5, pid);
    const result = resolveApplyEnchant(
      sim.ctx,
      pid,
      'moggers_copper_cudgel',
      'enchant_weapon_might',
    );
    expect(result.ok).toBe(true);
    const meta = sim.ctx.resolve(pid)?.meta;
    const slot = meta?.inventory.find((s) => s.itemId === 'moggers_copper_cudgel');
    // enchant_weapon_might is +2 str (pinned to a literal earlier in this
    // file): the baked str 2 and the enchant str 2 SUM, and the baked sta 1
    // (untouched by the enchant) rides along, not overwritten.
    expect(slot?.instance?.rolled?.stats).toEqual({ str: 4, sta: 1 });
    expect(slot?.instance?.rolled?.masterwork).toBe(true);
    expect(slot?.instance?.signer).toBe('Tester');
    expect(slot?.instance?.enchant).toBe('enchant_weapon_might');
    // The masterwork copy never carried rolled.quality and the enchant must
    // not invent one (the masterwork model retired rolled.quality for new writes).
    expect(slot?.instance?.rolled?.quality).toBeUndefined();
  });

  it('an enchanted masterwork copy cannot be enchanted again (double-enchant stays blocked)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance('moggers_copper_cudgel', structuredClone(MASTERWORK_PAYLOAD), pid);
    sim.addItem('arcane_dust', 5, pid);
    expect(
      resolveApplyEnchant(sim.ctx, pid, 'moggers_copper_cudgel', 'enchant_weapon_might').ok,
    ).toBe(true);
    // The enchanted masterwork copy is no longer an eligible target.
    expect(sim.ctx.countEnchantableItem('moggers_copper_cudgel', pid)).toBe(0);
    sim.addItem('arcane_dust', 5, pid);
    const second = resolveApplyEnchant(
      sim.ctx,
      pid,
      'moggers_copper_cudgel',
      'enchant_weapon_might',
    );
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('not_held');
    // The copy itself is untouched by the denial: still exactly one, still
    // carrying the merged record.
    expect(sim.countItem('moggers_copper_cudgel', pid)).toBe(1);
  });

  it('equipping the enchanted masterwork copy applies def, baked, and enchant stats together', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // moggers_copper_cudgel is a rare def, level-gated on equip
    // (item_level_req.ts): level to the cap first so the equip gate passes.
    while (sim.player.level < 20) sim.grantXp(xpForLevel(sim.player.level));
    const baseStr = sim.player.stats.str;
    const baseSta = sim.player.stats.sta;
    sim.ctx.addItemInstance('moggers_copper_cudgel', structuredClone(MASTERWORK_PAYLOAD), pid);
    sim.addItem('arcane_dust', 5, pid);
    expect(
      resolveApplyEnchant(sim.ctx, pid, 'moggers_copper_cudgel', 'enchant_weapon_might').ok,
    ).toBe(true);
    // Pin the def's own contribution so the +10/+3 breakdowns below stay
    // honest against a content re-tune.
    expect(ITEMS.moggers_copper_cudgel.stats).toEqual({ str: 3, sta: 2 });
    sim.equipItem('moggers_copper_cudgel');
    // str: def 3 + baked masterwork 2 + enchant 2; sta: def 2 + baked 1.
    expect(sim.player.stats.str).toBe(baseStr + 7);
    expect(sim.player.stats.sta).toBe(baseSta + 3);
  });

  it('a legacy enchanted copy (bare rolled.stats, no marker) is still excluded from re-enchanting', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // The pre-marker enchanted payload shape: bare rolled.stats, no `enchant`
    // field, no masterwork flag. The legacy predicate arm must keep it
    // excluded so old saves cannot be double-enchanted either.
    sim.ctx.addItemInstance('eastbrook_arming_sword', { rolled: { stats: { str: 5 } } }, pid);
    expect(sim.ctx.countEnchantableItem('eastbrook_arming_sword', pid)).toBe(0);
    sim.addItem('arcane_dust', 5, pid);
    const result = resolveApplyEnchant(
      sim.ctx,
      pid,
      'eastbrook_arming_sword',
      'enchant_weapon_might',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_held');
  });
});

describe('ENCHANTS table integrity', () => {
  // The valid enchant target slots: every EquipSlot plus 'ring' (rings declare
  // ItemDef.slot 'ring', covering both ring1 and ring2 via resolveEquipSlot),
  // and NOT the two positional ring slots themselves (an enchant never targets
  // ring1/ring2 directly). Kept as a literal set so a typo in a new enchant's
  // itemSlot fails here rather than silently making the enchant unusable.
  const VALID_ITEM_SLOTS = new Set([
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
  ]);
  const VALID_STAT_KEYS = new Set(['str', 'agi', 'sta', 'int', 'spi', 'armor']);

  it('every enchant is well-formed: id matches its key, a valid slot, real reagents, a real bonus', () => {
    for (const [key, e] of Object.entries(ENCHANTS)) {
      expect(e.id).toBe(key);
      expect(VALID_ITEM_SLOTS.has(e.itemSlot)).toBe(true);
      // A real, non-empty stat bonus using only categories recalcPlayerStats reads.
      const bonusKeys = Object.keys(e.statBonus);
      expect(bonusKeys.length).toBeGreaterThan(0);
      for (const k of bonusKeys) {
        expect(VALID_STAT_KEYS.has(k)).toBe(true);
        expect(e.statBonus[k as keyof typeof e.statBonus]).toBeGreaterThan(0);
      }
      // Every reagent is a defined item, in a positive quantity (a typo'd
      // reagent id would make the enchant impossible to ever afford).
      expect(e.reagents.length).toBeGreaterThan(0);
      for (const r of e.reagents) {
        expect(ITEMS[r.itemId], `enchant ${e.id} reagent ${r.itemId}`).toBeDefined();
        expect(r.count).toBeGreaterThan(0);
      }
    }
  });

  it('every enchantable slot has at least one enchant (full slot coverage)', () => {
    const slotsWithEnchant = new Set<string>(Object.values(ENCHANTS).map((e) => e.itemSlot));
    for (const slot of VALID_ITEM_SLOTS) {
      expect(slotsWithEnchant.has(slot), `slot ${slot} has no enchant`).toBe(true);
    }
  });

  it('arcane_shard is not a dead-end: at least one enchant consumes it (the epic disenchant sink)', () => {
    // An epic/legendary disenchant yields arcane_shard
    // (DISENCHANT_MATERIAL_BY_QUALITY in ../src/sim/professions/enchanting.ts).
    // If no enchant ever consumes it, the material is an unspendable dead-end.
    const shardConsumers = Object.values(ENCHANTS).filter((e) =>
      e.reagents.some((r) => r.itemId === 'arcane_shard'),
    );
    expect(shardConsumers.length).toBeGreaterThan(0);
  });

  it('applies a Greater (arcane_shard-consuming) enchant end to end and grants its bonus', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const baseStr = sim.player.stats.str;
    sim.addItem('eastbrook_arming_sword', 1, pid);
    // Exactly the reagents enchant_weapon_greater_might needs: 1 shard + 2 essence.
    sim.addItem('arcane_shard', 1, pid);
    sim.addItem('arcane_essence', 2, pid);
    const applied = resolveApplyEnchant(
      sim.ctx,
      pid,
      'eastbrook_arming_sword',
      'enchant_weapon_greater_might',
    );
    expect(applied.ok).toBe(true);
    // Both reagents fully consumed (the shard now has a real sink).
    expect(sim.countItem('arcane_shard', pid)).toBe(0);
    expect(sim.countItem('arcane_essence', pid)).toBe(0);
    // Pin the Greater magnitude to a literal once, then verify equipping applies it.
    expect(ENCHANTS.enchant_weapon_greater_might.statBonus.str).toBe(5);
    sim.equipItem('eastbrook_arming_sword');
    expect(sim.player.stats.str).toBe(baseStr + 5);
  });
});

// Enchanting gains are quality-tiered under the SOFT archetype
// ceiling (archetype.ts enchantingGainMultiplier). The flat-1-per-action rule
// is retired: ENCHANTING_SKILL_GAIN stays 1 but is now the BASE, multiplied
// by the four-state curve over min(input tier, archetype ceiling). The pure
// min()/curve arms live in archetype_ceiling.test.ts; these pin the resolver
// wiring and the content maps.
describe('quality-tiered enchanting gains', () => {
  it('pins the base gain and the quality-to-tier map to literals', () => {
    expect(ENCHANTING_SKILL_GAIN).toBe(1);
    expect(ENCHANTING_GAIN_TIER_BY_QUALITY).toEqual({
      poor: 0,
      common: 0,
      uncommon: 1,
      rare: 2,
      epic: 3,
      legendary: 4,
    });
  });

  it('derives an enchant gain tier from its reagent defs (dust 0, essence 1, shard 2)', () => {
    // EnchantDef carries no tier field: the existing tier notion is the
    // arcane reagent ladder, read off the reagent ITEM DEFS' quality (max
    // over the list). Pin the three material qualities so a def re-tune
    // cannot silently reshuffle every enchant's gain tier.
    expect(ITEMS.arcane_dust.quality).toBe('common');
    expect(ITEMS.arcane_essence.quality).toBe('uncommon');
    expect(ITEMS.arcane_shard.quality).toBe('rare');
    expect(enchantGainTier(ENCHANTS.enchant_weapon_might)).toBe(0);
    expect(enchantGainTier(ENCHANTS.enchant_chest_stamina)).toBe(1);
    expect(enchantGainTier(ENCHANTS.enchant_weapon_greater_might)).toBe(2);
  });

  it('a fresh disenchanter still gains the full point from a common piece (orange at capability 0)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    sim.addItem('eastbrook_arming_sword', 1, pid);
    expect(resolveDisenchant(sim.ctx, pid, 'eastbrook_arming_sword').ok).toBe(true);
    // Derivation: base 1 * curve(capability 0, min(common 0, pre-archetype
    // ceiling 2) = 0) = 1 (at/above capability -> full).
    expect(meta.craftSkills.enchanting).toBe(1);
  });

  it('commons gray out at capability 3 (skill 75): the disenchant still succeeds with zero gain', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.craftSkills.enchanting = 75; // capability 3
    sim.addItem('eastbrook_arming_sword', 1, pid);
    const result = resolveDisenchant(sim.ctx, pid, 'eastbrook_arming_sword');
    // Zero gain must never block the action itself: the item is consumed and
    // the material granted exactly as before.
    expect(result.ok).toBe(true);
    expect(sim.countItem('eastbrook_arming_sword', pid)).toBe(0);
    // Derivation: min(common 0, ceiling 2) = 0, three tiers below capability
    // 3 -> gray 0.
    expect(meta.craftSkills.enchanting).toBe(75);
  });

  it('an epic disenchant under the pre-archetype rare ceiling grants the rare-tier gain, never zero', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.craftSkills.enchanting = 75; // capability 3
    expect(ITEMS.morthens_cryptforged_hauberk.quality).toBe('epic');
    sim.addItem('morthens_cryptforged_hauberk', 1, pid);
    expect(resolveDisenchant(sim.ctx, pid, 'morthens_cryptforged_hauberk').ok).toBe(true);
    // Derivation: min(epic 3, pre-archetype ceiling 2) = 2, one tier below
    // capability 3 -> yellow 0.5 (the SOFT ceiling: crafting's hard rule
    // would have zeroed a tier-3 recipe here).
    expect(meta.craftSkills.enchanting).toBe(75.5);
  });

  it('the apply arm reads the enchant tier: a Greater enchant outgains a dust enchant at capability 1', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    meta.craftSkills.enchanting = 25; // capability 1
    sim.addItem('eastbrook_arming_sword', 1, pid);
    sim.addItem('arcane_dust', 5, pid);
    expect(
      resolveApplyEnchant(sim.ctx, pid, 'eastbrook_arming_sword', 'enchant_weapon_might').ok,
    ).toBe(true);
    // Derivation: dust enchant tier 0, one below capability 1 -> yellow 0.5.
    expect(meta.craftSkills.enchanting).toBe(25.5);
    sim.addItem('eastbrook_arming_sword', 1, pid);
    sim.addItem('arcane_shard', 1, pid);
    sim.addItem('arcane_essence', 2, pid);
    expect(
      resolveApplyEnchant(sim.ctx, pid, 'eastbrook_arming_sword', 'enchant_weapon_greater_might')
        .ok,
    ).toBe(true);
    // Derivation: shard-derived tier 2 (still capability 1 at skill 25.5),
    // at/above capability -> full 1. Total 25.5 + 1 = 26.5.
    expect(meta.craftSkills.enchanting).toBe(26.5);
  });
});
