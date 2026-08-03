// Coverage for the Enchanting profession: disenchant (layered on top of the
// existing everyone-can-salvage system, ./professions/salvage.ts, issue
// #1300) and applyEnchant (a permanent stat bonus on a SPECIFIC held copy of
// an item, carried through equip/unequip via PlayerMeta.equipmentInstance).

import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ITEMS } from '../src/sim/data';
import { characterDerivedStats } from '../src/sim/entity';
import { canStackInstancePayloads } from '../src/sim/item_instance_merge';
import { removePreferFungible } from '../src/sim/items';
import { CRAFT_THROTTLE_MAX_PER_WINDOW } from '../src/sim/professions/action_throttle';
import {
  consumeEnchantedVictim,
  disenchantItem,
  disenchantYield,
  ENCHANTING_GAIN_TIER_BY_QUALITY,
  ENCHANTING_SKILL_GAIN,
  enchantGainTier,
  isDisenchantable,
  isEnchantedInstance,
  replacedEnchantPayloadFor,
  replaceVictimIndex,
  resolveApplyEnchant,
  resolveDisenchant,
} from '../src/sim/professions/enchanting';
import { Sim } from '../src/sim/sim';
import { type InvSlot, xpForLevel } from '../src/sim/types';

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

// Regression for issue #2340: the bag menu offers Disenchant on the item DEF,
// but the resolver gated on countEnchantableItem, which excludes every
// already-enchanted copy. A player whose ONLY copy was enchanted was denied
// not_held ("You do not have that item") for an item sitting in their bags,
// and an enchanted piece could never be broken back into materials. The
// resolver now gates on countItem (any held copy), keeps the old preference
// order (plain fungible first, then an unenchanted instanced copy), and only
// when every held copy is enchanted consumes one of those, destroying the
// piece enchant and all. Apply-enchant keeps the enchanted-copy exclusion.
describe('disenchanting an enchanted copy (issue #2340)', () => {
  const SWORD = 'eastbrook_arming_sword';

  // Build the bug's exact setup via the real apply flow: after this, the only
  // copy of SWORD in bags is the freshly-enchanted instanced copy.
  function simWithEnchantedSwordOnly() {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem(SWORD, 1, pid);
    sim.addItem('arcane_dust', 5, pid);
    expect(resolveApplyEnchant(sim.ctx, pid, SWORD, 'enchant_weapon_might').ok).toBe(true);
    expect(sim.countItem('arcane_dust', pid)).toBe(0);
    expect(sim.ctx.countEnchantableItem(SWORD, pid)).toBe(0);
    return { sim, pid };
  }

  it('succeeds when the only held copy is enchanted: consumes it and grants the arcane yield', () => {
    const { sim, pid } = simWithEnchantedSwordOnly();
    const result = resolveDisenchant(sim.ctx, pid, SWORD);
    expect(result.ok).toBe(true);
    expect(result.materialItemId).toBe('arcane_dust');
    expect(result.count).toBeGreaterThan(0);
    expect(sim.countItem(SWORD, pid)).toBe(0);
    expect(sim.countItem('arcane_dust', pid)).toBe(result.count);
  });

  it('a legacy enchanted copy (bare rolled.stats, no marker) disenchants the same way', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(SWORD, { rolled: { stats: { str: 5 } } }, pid);
    expect(sim.ctx.countEnchantableItem(SWORD, pid)).toBe(0);
    const result = resolveDisenchant(sim.ctx, pid, SWORD);
    expect(result.ok).toBe(true);
    expect(sim.countItem(SWORD, pid)).toBe(0);
  });

  it('still prefers the plain copy when both a plain and an enchanted copy are held', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // Two plain copies + dust; the apply consumes one plain copy and appends
    // the enchanted instance at the HIGHEST inventory index, so a regression
    // to plain removeItem (highest-index-first, any kind) would consume the
    // enchanted copy and leave the fungible one, failing below.
    sim.addItem(SWORD, 2, pid);
    sim.addItem('arcane_dust', 5, pid);
    expect(resolveApplyEnchant(sim.ctx, pid, SWORD, 'enchant_weapon_might').ok).toBe(true);
    expect(sim.ctx.countFungibleItem(SWORD, pid)).toBe(1);

    const result = resolveDisenchant(sim.ctx, pid, SWORD);
    expect(result.ok).toBe(true);
    expect(sim.countItem(SWORD, pid)).toBe(1);
    // The plain copy died; the survivor is the enchanted instance.
    expect(sim.ctx.countFungibleItem(SWORD, pid)).toBe(0);
    const slot = sim.ctx.resolve(pid)?.meta.inventory.find((s) => s.itemId === SWORD);
    expect(slot?.instance?.enchant).toBe('enchant_weapon_might');
  });

  it('prefers an unenchanted instanced copy (crafted) over the enchanted one', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // Crafted-style unenchanted instance FIRST (lowest index), then the
    // enchanted instance lands at the highest index via the real apply flow,
    // so index order alone cannot pass this: the resolver must actively skip
    // the enchanted copy while an unenchanted one remains.
    sim.ctx.addItemInstance(SWORD, { signer: 'Tester', rolled: { quality: 'rare' } }, pid);
    sim.addItem(SWORD, 1, pid);
    sim.addItem('arcane_dust', 5, pid);
    expect(resolveApplyEnchant(sim.ctx, pid, SWORD, 'enchant_weapon_might').ok).toBe(true);

    const result = resolveDisenchant(sim.ctx, pid, SWORD);
    expect(result.ok).toBe(true);
    expect(sim.countItem(SWORD, pid)).toBe(1);
    const slot = sim.ctx.resolve(pid)?.meta.inventory.find((s) => s.itemId === SWORD);
    // The crafted copy was the victim; the enchanted copy survived.
    expect(slot?.instance?.enchant).toBe('enchant_weapon_might');
    expect(slot?.instance?.signer).toBeUndefined();
  });

  it('the not_held deny is reserved for genuinely not holding the item', () => {
    const { sim, pid } = simWithEnchantedSwordOnly();
    expect(resolveDisenchant(sim.ctx, pid, SWORD).ok).toBe(true);
    // Bags now hold zero copies of any kind: the deny is accurate again.
    const denied = resolveDisenchant(sim.ctx, pid, SWORD);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('not_held');
  });

  it('apply-enchant still refuses the enchanted-only copy by default (no silent overwrite)', () => {
    const { sim, pid } = simWithEnchantedSwordOnly();
    sim.addItem('arcane_dust', 5, pid);
    const second = resolveApplyEnchant(sim.ctx, pid, SWORD, 'enchant_weapon_might');
    expect(second.ok).toBe(false);
    // #2415: the default-refuse arm now names the real cause instead of the
    // misleading not_held; the no-silent-overwrite property itself is
    // unchanged (only an explicit confirmReplace reaches the replace arm).
    expect(second.reason).toBe('already_enchanted');
    expect(sim.countItem(SWORD, pid)).toBe(1);
    expect(sim.countItem('arcane_dust', pid)).toBe(5);
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

    // The now-enchanted copy (rolled.stats present) is no longer eligible for
    // a plain apply: the default-refuse arm denies with the dedicated
    // already_enchanted reason (#2415), never a silent overwrite.
    expect(sim.ctx.countEnchantableItem('moggers_copper_cudgel', pid)).toBe(0);
    sim.addItem('arcane_dust', 5, pid);
    const second = resolveApplyEnchant(
      sim.ctx,
      pid,
      'moggers_copper_cudgel',
      'enchant_weapon_might',
    );
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('already_enchanted');
    // The deny is side-effect-free: the copy and the reagents are untouched.
    expect(sim.countItem('moggers_copper_cudgel', pid)).toBe(1);
    expect(sim.countItem('arcane_dust', pid)).toBe(5);
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

  it('an enchanted masterwork copy cannot be silently enchanted again (double-enchant stays blocked)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance('moggers_copper_cudgel', structuredClone(MASTERWORK_PAYLOAD), pid);
    sim.addItem('arcane_dust', 5, pid);
    expect(
      resolveApplyEnchant(sim.ctx, pid, 'moggers_copper_cudgel', 'enchant_weapon_might').ok,
    ).toBe(true);
    // The enchanted masterwork copy is no longer an eligible plain target: the
    // default-refuse arm denies already_enchanted (#2415), never overwrites.
    expect(sim.ctx.countEnchantableItem('moggers_copper_cudgel', pid)).toBe(0);
    sim.addItem('arcane_dust', 5, pid);
    const second = resolveApplyEnchant(
      sim.ctx,
      pid,
      'moggers_copper_cudgel',
      'enchant_weapon_might',
    );
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('already_enchanted');
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

  it('a legacy enchanted copy (bare rolled.stats, no marker) is still excluded from a plain re-enchant', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // The pre-marker enchanted payload shape: bare rolled.stats, no `enchant`
    // field, no masterwork flag. The legacy predicate arm must keep it
    // excluded so old saves cannot be double-enchanted either; the deny names
    // the real cause (#2415), never a silent overwrite.
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
    expect(result.reason).toBe('already_enchanted');
    // Side-effect-free: the legacy copy and the reagents are untouched.
    expect(sim.countItem('eastbrook_arming_sword', pid)).toBe(1);
    expect(sim.countItem('arcane_dust', pid)).toBe(5);
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

  it('a crafted signed disenchant keeps material rewards and throttle but grants no enchanting skill', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    sim.ctx.addItemInstance('moggers_copper_cudgel', { signer: meta.name }, pid);

    const result = resolveDisenchant(sim.ctx, pid, 'moggers_copper_cudgel');

    expect(result.ok).toBe(true);
    expect(result.materialItemId).toBe('arcane_essence');
    expect(result.count).toBe(1);
    expect(sim.countItem('moggers_copper_cudgel', pid)).toBe(0);
    expect(sim.countItem('arcane_essence', pid)).toBe(1);
    expect(meta.craftThrottle.count).toBe(1);
    expect(meta.craftSkills.enchanting ?? 0).toBe(0);
  });

  it('a plain non-crafted eligible disenchant still grants enchanting skill', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = sim.players.get(pid)!;
    sim.addItem('moggers_copper_cudgel', 1, pid);

    const result = resolveDisenchant(sim.ctx, pid, 'moggers_copper_cudgel');

    expect(result.ok).toBe(true);
    expect(sim.countItem('moggers_copper_cudgel', pid)).toBe(0);
    expect(sim.countItem('arcane_essence', pid)).toBe(1);
    expect(meta.craftThrottle.count).toBe(1);
    expect(meta.craftSkills.enchanting).toBe(ENCHANTING_SKILL_GAIN);
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

// ---------------------------------------------------------------------------
// The WORN arm: enchant equipped gear in place, no unequip / re-equip dance.
// Every gate mirrors the bagged arm; the only structural differences are that
// the merged payload lands on PlayerMeta.equipmentInstance[slot] (so the stats
// must be re-baked on the spot) and that there is deliberately NO bag-capacity
// gate, since nothing enters the bags.
// ---------------------------------------------------------------------------
const WORN_SWORD = 'eastbrook_arming_sword';
const WORN_ENCHANT = 'enchant_weapon_might'; // itemSlot 'mainhand', 5x arcane_dust, str +2
const WORN_HELMET_ENCHANT = 'enchant_helmet_fortitude';

/** A sim whose player is wearing `itemId` in `slot`, with `dust` arcane_dust in
 *  the bags. Goes through the REAL equip path so equipmentInstance is populated
 *  exactly as it is in play. */
function wearing(
  slot: 'mainhand' | 'offhand' | 'ring1' | 'ring2',
  itemId: string,
  opts: { cls?: 'warrior' | 'rogue'; dust?: number; instance?: Record<string, unknown> } = {},
) {
  const sim = new Sim({ seed: 7, playerClass: opts.cls ?? 'rogue', autoEquip: false });
  const pid = sim.playerId;
  if (opts.instance) sim.ctx.addItemInstance(itemId, opts.instance as never, pid);
  else sim.addItem(itemId, 1, pid);
  sim.equipItemToSlot(itemId, slot, pid);
  if (opts.dust) sim.addItem('arcane_dust', opts.dust, pid);
  return { sim, pid, meta: sim.players.get(pid)! };
}

describe('apply enchant to WORN gear (in place)', () => {
  it('enchants the worn copy in place: payload on the slot, stats re-baked, reagents consumed', () => {
    const { sim, pid, meta } = wearing('mainhand', WORN_SWORD, { dust: 5 });
    expect(meta.equipment.mainhand).toBe(WORN_SWORD);
    expect(meta.equipmentInstance.mainhand).toBeUndefined(); // a plain worn copy
    const strBefore = sim.player.stats.str;

    const result = resolveApplyEnchant(sim.ctx, pid, WORN_SWORD, WORN_ENCHANT, 'mainhand');
    expect(result).toEqual({ ok: true, itemId: WORN_SWORD, enchantId: WORN_ENCHANT });

    // The payload landed on the WORN slot, marked with the enchant id.
    expect(meta.equipmentInstance.mainhand?.enchant).toBe(WORN_ENCHANT);
    expect(meta.equipmentInstance.mainhand?.rolled?.stats).toEqual({ str: 2 });
    // The piece never left the slot and no copy appeared in the bags.
    expect(meta.equipment.mainhand).toBe(WORN_SWORD);
    expect(sim.countItem(WORN_SWORD, pid)).toBe(0);
    // The stat pipeline saw it: recalcPlayerStats folded rolled.stats in.
    expect(sim.player.stats.str).toBe(strBefore + 2);
    // Reagents came out of the bags.
    expect(sim.countItem('arcane_dust', pid)).toBe(0);
  });

  it('merges onto a worn signed masterwork copy: signer and masterwork survive, stats sum', () => {
    const { sim, pid, meta } = wearing('mainhand', WORN_SWORD, {
      dust: 5,
      instance: { signer: 'Tester', rolled: { masterwork: true, stats: { str: 3 } } },
    });
    const strBefore = sim.player.stats.str;
    expect(strBefore).toBeGreaterThan(0);

    expect(resolveApplyEnchant(sim.ctx, pid, WORN_SWORD, WORN_ENCHANT, 'mainhand').ok).toBe(true);

    const worn = meta.equipmentInstance.mainhand;
    expect(worn?.signer).toBe('Tester');
    expect(worn?.rolled?.masterwork).toBe(true);
    // ADDITIVE: the masterwork bake (3) plus the enchant (2), never a replace.
    expect(worn?.rolled?.stats).toEqual({ str: 5 });
    expect(worn?.enchant).toBe(WORN_ENCHANT);
    // The masterwork bake was already live in the stats, so only the enchant's
    // +2 is new here.
    expect(sim.player.stats.str).toBe(strBefore + 2);
  });

  it('draws ZERO rng, so it cannot shift the shared stream (determinism)', () => {
    // The worn arm is rng-free by construction: no roll, no capacity model.
    // Pinned mechanically, because a future "enchant can fail" roll here would
    // silently move every downstream draw in the same tick, and nothing else in
    // the suite would go red. Two sims on the SAME seed: one applies the worn
    // enchant, one does not; the next draw off each rng must be identical.
    const a = wearing('mainhand', WORN_SWORD, { dust: 5 });
    const b = wearing('mainhand', WORN_SWORD, { dust: 5 });
    expect(resolveApplyEnchant(a.sim.ctx, a.pid, WORN_SWORD, WORN_ENCHANT, 'mainhand').ok).toBe(
      true,
    );
    expect(a.sim.ctx.rng.next()).toBe(b.sim.ctx.rng.next());
  });

  it('denies an already-enchanted worn copy by default with no side effect (double-enchant blocked)', () => {
    const { sim, pid, meta } = wearing('mainhand', WORN_SWORD, {
      dust: 10,
      instance: { enchant: 'enchant_weapon_agility', rolled: { stats: { agi: 2 } } },
    });
    const strBefore = sim.player.stats.str;
    const result = resolveApplyEnchant(sim.ctx, pid, WORN_SWORD, WORN_ENCHANT, 'mainhand');
    expect(result.ok).toBe(false);
    // #2415: the honest dedicated reason (was the misleading not_held); the
    // no-silent-overwrite property is unchanged, only confirmReplace replaces.
    expect(result.reason).toBe('already_enchanted');
    // Untouched: the original enchant, the reagents, and the stats.
    expect(meta.equipmentInstance.mainhand?.enchant).toBe('enchant_weapon_agility');
    expect(meta.equipmentInstance.mainhand?.rolled?.stats).toEqual({ agi: 2 });
    expect(sim.countItem('arcane_dust', pid)).toBe(10);
    expect(sim.player.stats.str).toBe(strBefore);
  });

  it('denies an EMPTY slot and a slot wearing a different item, reagents untouched', () => {
    const { sim, pid, meta } = wearing('mainhand', WORN_SWORD, { dust: 5 });
    // offhand is empty.
    const empty = resolveApplyEnchant(sim.ctx, pid, WORN_SWORD, WORN_ENCHANT, 'offhand');
    expect(empty.ok).toBe(false);
    expect(empty.reason).toBe('not_held');
    expect(meta.equipmentInstance.offhand).toBeUndefined();

    // mainhand is worn, but by a DIFFERENT item than the one named.
    const other = resolveApplyEnchant(sim.ctx, pid, 'keen_dirk', WORN_ENCHANT, 'mainhand');
    expect(other.ok).toBe(false);
    expect(other.reason).toBe('not_held');
    expect(meta.equipmentInstance.mainhand).toBeUndefined();
    expect(sim.countItem('arcane_dust', pid)).toBe(5);
  });

  it('denies a wrong-slot enchant on the worn arm exactly like the bagged arm', () => {
    const { sim, pid, meta } = wearing('mainhand', WORN_SWORD, { dust: 5 });
    const result = resolveApplyEnchant(sim.ctx, pid, WORN_SWORD, WORN_HELMET_ENCHANT, 'mainhand');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('wrong_slot');
    expect(meta.equipmentInstance.mainhand).toBeUndefined();
    expect(sim.countItem('arcane_dust', pid)).toBe(5);
  });

  it('reagents are all-or-nothing from the BAGS: one short denies and consumes nothing', () => {
    const { sim, pid, meta } = wearing('mainhand', WORN_SWORD, { dust: 4 }); // needs 5
    const result = resolveApplyEnchant(sim.ctx, pid, WORN_SWORD, WORN_ENCHANT, 'mainhand');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
    expect(sim.countItem('arcane_dust', pid)).toBe(4);
    expect(meta.equipmentInstance.mainhand).toBeUndefined();
  });

  it('draws from the SAME action throttle as the bagged arm', () => {
    const { sim, pid, meta } = wearing('mainhand', WORN_SWORD, { dust: 5 });
    // Spend the whole shared window on bagged salvages, then the worn enchant
    // must deny at the boundary with nothing consumed.
    sim.addItem(WORN_SWORD, CRAFT_THROTTLE_MAX_PER_WINDOW, pid);
    for (let i = 0; i < CRAFT_THROTTLE_MAX_PER_WINDOW; i++) sim.salvageItem(WORN_SWORD, pid);
    const result = resolveApplyEnchant(sim.ctx, pid, WORN_SWORD, WORN_ENCHANT, 'mainhand');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('throttled');
    expect(sim.countItem('arcane_dust', pid)).toBe(5);
    expect(meta.equipmentInstance.mainhand).toBeUndefined();
  });

  it('has NO bag-capacity gate: a completely full pack still enchants worn gear', () => {
    const { sim, pid, meta } = wearing('mainhand', WORN_SWORD, { dust: 5 });
    // Fill every remaining bag slot with DISTINCT item ids (each takes its own
    // slot, whatever its stack size) until nothing more fits.
    const filler = Object.keys(ITEMS).filter((id) => id !== 'arcane_dust' && id !== WORN_SWORD);
    let i = 0;
    while (i < filler.length && sim.ctx.canAddItem(filler[i], 1, pid)) {
      sim.addItem(filler[i], 1, pid);
      i++;
    }
    // The premise the #2350 capacity gate keys on is now false: a fresh copy of
    // this very item could not be minted into the bags at all.
    expect(sim.ctx.canAddItem(WORN_SWORD, 1, pid)).toBe(false);
    // The worn arm never mints into the bags (it rewrites the worn slot and only
    // SPENDS reagents), so a full pack is irrelevant to it.
    expect(resolveApplyEnchant(sim.ctx, pid, WORN_SWORD, WORN_ENCHANT, 'mainhand').ok).toBe(true);
    expect(meta.equipmentInstance.mainhand?.enchant).toBe(WORN_ENCHANT);
  });

  it('dual wield, identical copies: the mainhand slot enchants ONLY the mainhand copy', () => {
    // A rogue dual-wielding two copies of the SAME item id: the item id alone
    // cannot name a target, which is exactly why the discriminator is a slot.
    const { sim, pid, meta } = wearing('mainhand', WORN_SWORD, { dust: 5 });
    sim.addItem(WORN_SWORD, 1, pid);
    sim.equipItemToSlot(WORN_SWORD, 'offhand', pid);
    expect(meta.equipment.mainhand).toBe(WORN_SWORD);
    expect(meta.equipment.offhand).toBe(WORN_SWORD);

    expect(resolveApplyEnchant(sim.ctx, pid, WORN_SWORD, WORN_ENCHANT, 'mainhand').ok).toBe(true);
    expect(meta.equipmentInstance.mainhand?.enchant).toBe(WORN_ENCHANT);
    // The other hand is untouched: no payload leaked across slots.
    expect(meta.equipmentInstance.offhand).toBeUndefined();
  });

  it('two rings, identical copies: the ring2 slot enchants ONLY the ring2 copy', () => {
    const RING = 'seal_of_the_nine_oaths'; // slot 'ring', covers ring1 AND ring2
    const RING_ENCHANT = 'enchant_ring_spirit';
    const sim = new Sim({ seed: 7, playerClass: 'rogue', autoEquip: false });
    const pid = sim.playerId;
    while (sim.player.level < 20) sim.grantXp(xpForLevel(sim.player.level));
    sim.addItem(RING, 2, pid);
    sim.equipItemToSlot(RING, 'ring1', pid);
    sim.equipItemToSlot(RING, 'ring2', pid);
    const meta = sim.players.get(pid)!;
    expect(meta.equipment.ring1).toBe(RING);
    expect(meta.equipment.ring2).toBe(RING);
    for (const reagent of ENCHANTS[RING_ENCHANT].reagents) {
      sim.addItem(reagent.itemId, reagent.count, pid);
    }

    expect(resolveApplyEnchant(sim.ctx, pid, RING, RING_ENCHANT, 'ring2').ok).toBe(true);
    expect(meta.equipmentInstance.ring2?.enchant).toBe(RING_ENCHANT);
    expect(meta.equipmentInstance.ring1).toBeUndefined();
  });

  it('the applyEnchant command entry point forwards the slot and stashes the result', () => {
    const { sim, pid, meta } = wearing('mainhand', WORN_SWORD, { dust: 5 });
    sim.applyEnchant(WORN_SWORD, WORN_ENCHANT, 'mainhand', undefined, pid);
    expect(sim.lastEnchantResult?.ok).toBe(true);
    expect(meta.equipmentInstance.mainhand?.enchant).toBe(WORN_ENCHANT);
    // Same skill gain as the bagged arm (dust enchant tier 0, capability 0 ->
    // full base gain).
    expect(meta.craftSkills.enchanting).toBe(ENCHANTING_SKILL_GAIN);
  });

  it('an in-place enchant on worn gear survives a save/reload round-trip', () => {
    const { sim, pid } = wearing('mainhand', WORN_SWORD, { dust: 5 });
    expect(resolveApplyEnchant(sim.ctx, pid, WORN_SWORD, WORN_ENCHANT, 'mainhand').ok).toBe(true);
    const boostedStr = sim.player.stats.str;

    const state = sim.serializeCharacter(pid);
    expect(state).not.toBeNull();
    // The in-place write went through equipmentInstance, which is exactly the
    // optional CharacterState field the equip path persists, so the enchant is
    // durable without any new save shape.
    expect(state!.equipmentInstance?.mainhand?.enchant).toBe(WORN_ENCHANT);
    expect(state!.equipmentInstance?.mainhand?.rolled?.stats?.str).toBe(2);

    const reloadedSim = new Sim({ seed: 7, playerClass: 'rogue', noPlayer: true });
    const reloadedPid = reloadedSim.addPlayer('rogue', 'Reload', { state: state! });
    expect(reloadedSim.meta(reloadedPid)!.equipmentInstance.mainhand?.enchant).toBe(WORN_ENCHANT);
    expect(reloadedSim.entities.get(reloadedPid)!.stats.str).toBe(boostedStr);
  });
});

// ---------------------------------------------------------------------------
// Replacing an existing enchant behind explicit confirmation (#2415). The
// settled rulings under test: one-step replace gated on the confirmReplace
// flag; the old enchant destroyed outright with NO material refund; the swap
// surgical (signer, masterwork stats, boundTo, bindOnTrade byte-identical);
// the identical-enchant-id re-apply denied with its own reason on every arm;
// no new gates (same shared throttle, reagents only); and no code path that
// silently overwrites.
// ---------------------------------------------------------------------------
describe('replacing an enchant behind explicit confirmation (#2415)', () => {
  const SWORD = 'eastbrook_arming_sword';
  const MIGHT = 'enchant_weapon_might'; // 5x arcane_dust, str +2 (pinned above)
  const AGILITY = 'enchant_weapon_agility';
  const GREATER = 'enchant_weapon_greater_might'; // 1 shard + 2 essence, str +5

  it('replaces surgically on a marker copy: only the enchant layer changes, every other layer byte-identical', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // A signed masterwork copy that is ALSO bound and bind-on-trade locked:
    // every payload layer the ruling says must ride through untouched.
    sim.ctx.addItemInstance(
      SWORD,
      {
        signer: 'Tester',
        rolled: { masterwork: true, stats: { str: 3, sta: 1 } },
        boundTo: 42,
        bindOnTrade: true,
      },
      pid,
    );
    sim.addItem('arcane_dust', 5, pid);
    expect(resolveApplyEnchant(sim.ctx, pid, SWORD, MIGHT).ok).toBe(true);
    const meta = sim.ctx.resolve(pid)!.meta;
    const skillAfterApply = meta.craftSkills.enchanting;

    sim.addItem('arcane_shard', 1, pid);
    sim.addItem('arcane_essence', 2, pid);
    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, GREATER, undefined, true);
    expect(result).toEqual({ ok: true, itemId: SWORD, enchantId: GREATER });

    const slot = meta.inventory.find((s) => s.itemId === SWORD);
    // Pin the Greater magnitude once (the literal-pin idiom above), then the
    // exact swap: masterwork str 3 + greater 5, the might +2 subtracted out.
    expect(ENCHANTS[GREATER].statBonus).toEqual({ str: 5 });
    expect(slot?.instance?.rolled?.stats).toEqual({ str: 8, sta: 1 });
    expect(slot?.instance?.enchant).toBe(GREATER);
    // The untouched layers, byte-identical.
    expect(slot?.instance?.signer).toBe('Tester');
    expect(slot?.instance?.rolled?.masterwork).toBe(true);
    expect(slot?.instance?.boundTo).toBe(42);
    expect(slot?.instance?.bindOnTrade).toBe(true);
    // Exactly one copy throughout; the replace reagents were consumed; the OLD
    // enchant's materials were NOT refunded (no dust reappears).
    expect(sim.countItem(SWORD, pid)).toBe(1);
    expect(sim.countItem('arcane_shard', pid)).toBe(0);
    expect(sim.countItem('arcane_essence', pid)).toBe(0);
    expect(sim.countItem('arcane_dust', pid)).toBe(0);
    // Replacement is just an apply: the same quality-tiered skill gain landed
    // and exactly ONE shared-throttle stamp was spent on it (one apply + one
    // replace = two stamps total; a stamp-free replace would sidestep the
    // shared 10-per-60s pace entirely).
    expect(meta.craftSkills.enchanting).toBeGreaterThan(skillAfterApply);
    expect(meta.craftThrottle.count).toBe(2);
  });

  it('grants EXACTLY the plain apply gain for the same enchant tier (same curve, same input)', () => {
    // Two same-shape sims at skill 80: past the tier-0 gray boundary (75), so
    // a regression hardcoding the replace input to tier 0 reads gray and
    // fails the > 0 arm, while any tier drift fails the equality arm.
    const applySim = makeSim();
    const applyMeta = applySim.ctx.resolve(applySim.playerId)!.meta;
    applyMeta.craftSkills.enchanting = 80;
    applySim.addItem(SWORD, 1, applySim.playerId);
    applySim.addItem('arcane_shard', 1, applySim.playerId);
    applySim.addItem('arcane_essence', 2, applySim.playerId);
    expect(resolveApplyEnchant(applySim.ctx, applySim.playerId, SWORD, GREATER).ok).toBe(true);
    const plainGain = applyMeta.craftSkills.enchanting - 80;
    expect(plainGain).toBeGreaterThan(0);

    const replaceSim = makeSim();
    const replaceMeta = replaceSim.ctx.resolve(replaceSim.playerId)!.meta;
    replaceMeta.craftSkills.enchanting = 80;
    replaceSim.ctx.addItemInstance(
      SWORD,
      { enchant: MIGHT, rolled: { stats: { str: 2 } } },
      replaceSim.playerId,
    );
    replaceSim.addItem('arcane_shard', 1, replaceSim.playerId);
    replaceSim.addItem('arcane_essence', 2, replaceSim.playerId);
    expect(
      resolveApplyEnchant(replaceSim.ctx, replaceSim.playerId, SWORD, GREATER, undefined, true).ok,
    ).toBe(true);
    expect(replaceMeta.craftSkills.enchanting - 80).toBe(plainGain);
  });

  it('denies insufficient_materials on the replace arm all-or-nothing, victim untouched', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(SWORD, { enchant: MIGHT, rolled: { stats: { str: 2 } } }, pid);
    sim.addItem('arcane_dust', 4, pid); // Agility needs 5: one short
    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, AGILITY, undefined, true);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
    // Nothing was paid and nothing was destroyed: a confirmed replace is
    // never free and never partially paid.
    expect(sim.countItem('arcane_dust', pid)).toBe(4);
    const slot = sim.ctx.resolve(pid)?.meta.inventory.find((s) => s.itemId === SWORD);
    expect(slot?.instance?.enchant).toBe(MIGHT);
    expect(slot?.instance?.rolled?.stats).toEqual({ str: 2 });
  });

  it('a LEGACY victim whose raw stats happen to equal the picked bonus still replaces (no id, no same_enchant)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // Bare stats byte-equal to Might's own bonus: without a marker there is
    // no id to compare, so the documented rule is replace, never deny.
    sim.ctx.addItemInstance(SWORD, { rolled: { stats: { str: 2 } } }, pid);
    sim.addItem('arcane_dust', 5, pid);
    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, MIGHT, undefined, true);
    expect(result.ok).toBe(true);
    const slot = sim.ctx.resolve(pid)?.meta.inventory.find((s) => s.itemId === SWORD);
    expect(slot?.instance?.enchant).toBe(MIGHT);
    expect(slot?.instance?.rolled?.stats).toEqual({ str: 2 });
    expect(sim.countItem('arcane_dust', pid)).toBe(0);
  });

  it('a replaced payload is structurally identical to a fresh same-enchant peer (no zero residue)', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // Copy one: enchant with Might, then confirm-replace with Agility.
    sim.addItem(SWORD, 1, pid);
    sim.addItem('arcane_dust', 10, pid);
    expect(resolveApplyEnchant(sim.ctx, pid, SWORD, MIGHT).ok).toBe(true);
    expect(resolveApplyEnchant(sim.ctx, pid, SWORD, AGILITY, undefined, true).ok).toBe(true);
    // Copy two: a fresh plain copy enchanted with Agility directly.
    sim.addItem(SWORD, 1, pid);
    sim.addItem('arcane_dust', 5, pid);
    expect(resolveApplyEnchant(sim.ctx, pid, SWORD, AGILITY).ok).toBe(true);

    const meta = sim.ctx.resolve(pid)!.meta;
    const copies = meta.inventory.filter((s) => s.itemId === SWORD);
    expect(copies).toHaveLength(2);
    const [a, b] = copies;
    // The Might key was subtracted back to zero and PRUNED, not left as a
    // zero-valued residue key: structural equality treats a present 0 as
    // distinct from an absent key, so residue would break this compare.
    expect(a.instance?.rolled?.stats).not.toHaveProperty('str');
    expect(a.instance?.rolled?.stats).toEqual(b.instance?.rolled?.stats);
    expect(canStackInstancePayloads(a.instance, b.instance)).toBe(true);
  });

  it('denies already_enchanted without the flag even when reagents and confirm intent are otherwise valid', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(SWORD, { enchant: MIGHT, rolled: { stats: { str: 2 } } }, pid);
    sim.addItem('arcane_dust', 5, pid);
    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, AGILITY);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('already_enchanted');
    const slot = sim.ctx.resolve(pid)!.meta.inventory.find((s) => s.itemId === SWORD);
    expect(slot?.instance?.enchant).toBe(MIGHT);
    expect(sim.countItem('arcane_dust', pid)).toBe(5);
  });

  // The BAGGED half of the strict-boolean rule. The worn arm has its own case
  // below, and the dispatch normalizes with `msg.confirm === true` before the
  // resolver is reached, so neither of those can see this check loosen:
  // relaxing it to a plain truthy test leaves every other test green.
  it('the BAGGED confirm gate is a STRICT boolean check: a truthy non-boolean reads as unconfirmed', () => {
    for (const truthy of ['yes', 1, {}]) {
      const sim = makeSim();
      const pid = sim.playerId;
      sim.ctx.addItemInstance(SWORD, { enchant: MIGHT, rolled: { stats: { str: 2 } } }, pid);
      sim.addItem('arcane_dust', 5, pid);
      const result = resolveApplyEnchant(
        sim.ctx,
        pid,
        SWORD,
        AGILITY,
        undefined,
        truthy as unknown as boolean,
      );
      expect(result.ok, String(truthy)).toBe(false);
      expect(result.reason, String(truthy)).toBe('already_enchanted');
      // Nothing destroyed, nothing spent: it took the no-flag deny arm.
      const slot = sim.ctx.resolve(pid)!.meta.inventory.find((s) => s.itemId === SWORD);
      expect(slot?.instance?.enchant, String(truthy)).toBe(MIGHT);
      expect(sim.countItem('arcane_dust', pid), String(truthy)).toBe(5);
    }
  });

  it('denies same_enchant on the identical enchant id: no reagents spent, no throttle stamped', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(SWORD, { enchant: MIGHT, rolled: { stats: { str: 2 } } }, pid);
    sim.addItem('arcane_dust', 5, pid);
    const meta = sim.ctx.resolve(pid)!.meta;
    const stampsBefore = meta.craftThrottle.count;
    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, MIGHT, undefined, true);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('same_enchant');
    // Pure deny: nothing consumed, nothing stamped, payload untouched.
    expect(sim.countItem('arcane_dust', pid)).toBe(5);
    expect(meta.craftThrottle.count).toBe(stampsBefore);
    const slot = meta.inventory.find((s) => s.itemId === SWORD);
    expect(slot?.instance?.rolled?.stats).toEqual({ str: 2 });
  });

  it('replaces a LEGACY pre-marker copy wholesale: rolled.stats becomes exactly the new bonus', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    // The pre-marker enchanted shape, on a signed legacy crafted copy: bare
    // rolled.stats (the old enchant, whole) plus legacy rolled.quality.
    sim.ctx.addItemInstance(
      SWORD,
      { signer: 'Old', rolled: { quality: 'rare', stats: { str: 5, sta: 3 } } },
      pid,
    );
    sim.addItem('arcane_dust', 5, pid);
    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, MIGHT, undefined, true);
    expect(result.ok).toBe(true);
    const slot = sim.ctx.resolve(pid)!.meta.inventory.find((s) => s.itemId === SWORD);
    // Wholesale: on a pre-marker copy the whole stats map IS the old enchant
    // (applyEnchant was its only writer), so nothing of {str:5, sta:3} survives.
    expect(slot?.instance?.rolled?.stats).toEqual({ str: 2 });
    expect(slot?.instance?.enchant).toBe(MIGHT);
    expect(slot?.instance?.signer).toBe('Old');
    expect(slot?.instance?.rolled?.quality).toBe('rare');
    // The legacy arm pays like every other: the reagents were consumed.
    expect(sim.countItem('arcane_dust', pid)).toBe(0);
  });

  it('with two differently-enchanted copies of one item id, the HIGHEST-index copy is the pinned victim', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(SWORD, { enchant: MIGHT, rolled: { stats: { str: 2 } } }, pid);
    sim.ctx.addItemInstance(
      SWORD,
      { enchant: 'enchant_weapon_intellect', rolled: { stats: { int: 2 } } },
      pid,
    );
    const meta = sim.ctx.resolve(pid)!.meta;
    // The pin itself: the intellect copy sits at the higher index.
    const idx = replaceVictimIndex(meta.inventory, SWORD);
    expect(meta.inventory[idx].instance?.enchant).toBe('enchant_weapon_intellect');

    sim.addItem('arcane_dust', 5, pid);
    expect(resolveApplyEnchant(sim.ctx, pid, SWORD, AGILITY, undefined, true).ok).toBe(true);
    const enchants = meta.inventory
      .filter((s) => s.itemId === SWORD)
      .map((s) => s.instance?.enchant)
      .sort();
    // The intellect copy was replaced; the might copy survived untouched.
    expect(enchants).toEqual([AGILITY, MIGHT].sort());
  });

  it('with a plain AND an enchanted copy held, the flag targets the ENCHANTED copy and spares the plain one', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem(SWORD, 1, pid); // plain fungible copy
    sim.ctx.addItemInstance(SWORD, { enchant: MIGHT, rolled: { stats: { str: 2 } } }, pid);
    sim.addItem('arcane_dust', 5, pid);
    expect(resolveApplyEnchant(sim.ctx, pid, SWORD, AGILITY, undefined, true).ok).toBe(true);
    // The plain copy is still plain and fungible; the enchanted copy now
    // carries Agility (Might destroyed), so nothing was silently overwritten
    // on the copy the player did NOT aim at.
    expect(sim.ctx.countFungibleItem(SWORD, pid)).toBe(1);
    const meta = sim.ctx.resolve(pid)!.meta;
    const enchanted = meta.inventory.find((s) => s.itemId === SWORD && s.instance);
    expect(enchanted?.instance?.enchant).toBe(AGILITY);
    expect(enchanted?.instance?.rolled?.stats).toEqual({ agi: 2 });
  });

  // The same mixed holding WITHOUT the flag: the picker paints these as two
  // separate rows (a plain target and a replace target), and the unconfirmed
  // one must spend the free copy and leave the enchanted one alone. Without
  // this the pair is only ever tested on its confirmed arm.
  it('with a plain AND an enchanted copy held, NO flag consumes the plain copy and spares the enchanted one', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem(SWORD, 1, pid); // plain fungible copy
    sim.ctx.addItemInstance(SWORD, { enchant: MIGHT, rolled: { stats: { str: 2 } } }, pid);
    sim.addItem('arcane_dust', 5, pid);
    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, AGILITY);
    expect(result.ok).toBe(true);
    const meta = sim.ctx.resolve(pid)!.meta;
    // No fungible copy left (it was the one enchanted), and BOTH copies are
    // now instanced: the pre-existing Might one untouched, plus the new
    // Agility one minted from the plain copy.
    expect(sim.ctx.countFungibleItem(SWORD, pid)).toBe(0);
    const enchants = meta.inventory
      .filter((s) => s.itemId === SWORD)
      .map((s) => s.instance?.enchant)
      .sort();
    expect(enchants).toEqual([AGILITY, MIGHT].sort());
    // The Might copy's payload is byte-untouched: it was never the victim.
    const might = meta.inventory.find((s) => s.instance?.enchant === MIGHT);
    expect(might?.instance?.rolled?.stats).toEqual({ str: 2 });
  });

  it('the flag is INERT with no enchanted copy held: a plain apply proceeds and destroys nothing', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.addItem(SWORD, 1, pid);
    sim.addItem('arcane_dust', 5, pid);
    // Consent to destroy is meaningless when nothing would be destroyed (the
    // dialog-to-accept race): the plain arm runs exactly as without the flag.
    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, MIGHT, undefined, true);
    expect(result.ok).toBe(true);
    const slot = sim.ctx.resolve(pid)!.meta.inventory.find((s) => s.itemId === SWORD);
    expect(slot?.instance?.enchant).toBe(MIGHT);
    expect(slot?.instance?.rolled?.stats).toEqual({ str: 2 });
  });

  it('refuses a marker id that no longer resolves (corrupt save): already_enchanted, nothing consumed', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(
      SWORD,
      { enchant: 'enchant_deleted_id', rolled: { stats: { str: 9 } } },
      pid,
    );
    sim.addItem('arcane_dust', 5, pid);
    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, MIGHT, undefined, true);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('already_enchanted');
    const slot = sim.ctx.resolve(pid)!.meta.inventory.find((s) => s.itemId === SWORD);
    // The unsubtractable payload is untouched, never wholesale-replaced (that
    // would stack the unknown old bonus under the new one or erase layers).
    expect(slot?.instance?.rolled?.stats).toEqual({ str: 9 });
    expect(sim.countItem('arcane_dust', pid)).toBe(5);
  });

  it('draws ZERO rng, so a replace cannot shift the shared stream (determinism)', () => {
    const setup = () => {
      const sim = makeSim(11);
      const pid = sim.playerId;
      sim.ctx.addItemInstance(SWORD, { enchant: MIGHT, rolled: { stats: { str: 2 } } }, pid);
      sim.addItem('arcane_dust', 5, pid);
      return { sim, pid };
    };
    const a = setup();
    const b = setup();
    expect(resolveApplyEnchant(a.sim.ctx, a.pid, SWORD, AGILITY, undefined, true).ok).toBe(true);
    expect(a.sim.ctx.rng.next()).toBe(b.sim.ctx.rng.next());
  });

  it('draws from the SAME shared action throttle: a spent window denies the replace with nothing consumed', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(SWORD, { enchant: MIGHT, rolled: { stats: { str: 2 } } }, pid);
    sim.addItem('arcane_dust', 5, pid);
    sim.addItem(SWORD, CRAFT_THROTTLE_MAX_PER_WINDOW, pid);
    for (let i = 0; i < CRAFT_THROTTLE_MAX_PER_WINDOW; i++) sim.salvageItem(SWORD, pid);
    const result = resolveApplyEnchant(sim.ctx, pid, SWORD, AGILITY, undefined, true);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('throttled');
    expect(sim.countItem('arcane_dust', pid)).toBe(5);
    const enchanted = sim.ctx
      .resolve(pid)!
      .meta.inventory.find((s) => s.itemId === SWORD && s.instance);
    expect(enchanted?.instance?.enchant).toBe(MIGHT);
  });

  it('replaces a WORN enchanted copy in place: stats re-baked, signer intact, reagents spent', () => {
    const { sim, pid, meta } = wearing('mainhand', WORN_SWORD, {
      dust: 5,
      instance: { signer: 'Tester', enchant: AGILITY, rolled: { stats: { agi: 2 } } },
    });
    // Pin the doomed magnitude once so the re-bake below is anchored.
    expect(ENCHANTS[AGILITY].statBonus).toEqual({ agi: 2 });
    const strBefore = sim.player.stats.str;
    const agiBefore = sim.player.stats.agi;

    const result = resolveApplyEnchant(sim.ctx, pid, WORN_SWORD, WORN_ENCHANT, 'mainhand', true);
    expect(result).toEqual({ ok: true, itemId: WORN_SWORD, enchantId: WORN_ENCHANT });
    // Surgical in place: agility subtracted to zero and pruned, might added,
    // signer untouched, and the stat pipeline re-baked both directions.
    expect(meta.equipmentInstance.mainhand?.enchant).toBe(WORN_ENCHANT);
    expect(meta.equipmentInstance.mainhand?.rolled?.stats).toEqual({ str: 2 });
    expect(meta.equipmentInstance.mainhand?.signer).toBe('Tester');
    expect(sim.player.stats.str).toBe(strBefore + 2);
    expect(sim.player.stats.agi).toBe(agiBefore - 2);
    expect(sim.countItem('arcane_dust', pid)).toBe(0);
    expect(sim.countItem(WORN_SWORD, pid)).toBe(0);
  });

  it('denies same_enchant on the WORN arm too, with nothing consumed', () => {
    const { sim, pid, meta } = wearing('mainhand', WORN_SWORD, {
      dust: 5,
      instance: { enchant: WORN_ENCHANT, rolled: { stats: { str: 2 } } },
    });
    const result = resolveApplyEnchant(sim.ctx, pid, WORN_SWORD, WORN_ENCHANT, 'mainhand', true);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('same_enchant');
    expect(meta.equipmentInstance.mainhand?.enchant).toBe(WORN_ENCHANT);
    expect(sim.countItem('arcane_dust', pid)).toBe(5);
  });

  it('refuses a WORN marker id that no longer resolves (corrupt save): already_enchanted, untouched', () => {
    const { sim, pid, meta } = wearing('mainhand', WORN_SWORD, {
      dust: 5,
      instance: { enchant: 'enchant_deleted_id', rolled: { stats: { str: 9 } } },
    });
    const result = resolveApplyEnchant(sim.ctx, pid, WORN_SWORD, WORN_ENCHANT, 'mainhand', true);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('already_enchanted');
    // Never wholesale-replaced and never stacked-under: the unsubtractable
    // payload is byte-untouched and nothing was paid.
    expect(meta.equipmentInstance.mainhand?.enchant).toBe('enchant_deleted_id');
    expect(meta.equipmentInstance.mainhand?.rolled?.stats).toEqual({ str: 9 });
    expect(sim.countItem('arcane_dust', pid)).toBe(5);
  });

  it('the WORN confirm gate is a STRICT boolean check too: a truthy non-boolean reads as unconfirmed', () => {
    const { sim, pid, meta } = wearing('mainhand', WORN_SWORD, {
      dust: 5,
      instance: { enchant: AGILITY, rolled: { stats: { agi: 2 } } },
    });
    // The resolver is the authoritative re-validation layer: even a caller
    // that bypasses the dispatch's own === true normalization gets the
    // unconfirmed deny, never a destructive replace.
    const result = resolveApplyEnchant(
      sim.ctx,
      pid,
      WORN_SWORD,
      WORN_ENCHANT,
      'mainhand',
      'yes' as unknown as boolean,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('already_enchanted');
    expect(meta.equipmentInstance.mainhand?.enchant).toBe(AGILITY);
    expect(sim.countItem('arcane_dust', pid)).toBe(5);
  });

  it('replaces a WORN legacy pre-marker copy wholesale, exactly like the bagged legacy arm', () => {
    const { sim, pid, meta } = wearing('mainhand', WORN_SWORD, {
      dust: 5,
      instance: { rolled: { stats: { agi: 5 } } },
    });
    const agiBefore = sim.player.stats.agi;
    const result = resolveApplyEnchant(sim.ctx, pid, WORN_SWORD, WORN_ENCHANT, 'mainhand', true);
    expect(result.ok).toBe(true);
    expect(meta.equipmentInstance.mainhand?.rolled?.stats).toEqual({ str: 2 });
    expect(meta.equipmentInstance.mainhand?.enchant).toBe(WORN_ENCHANT);
    expect(sim.player.stats.agi).toBe(agiBefore - 5);
  });

  it('the flag is inert on an UNENCHANTED worn copy: the plain worn apply proceeds', () => {
    const { sim, pid, meta } = wearing('mainhand', WORN_SWORD, { dust: 5 });
    const result = resolveApplyEnchant(sim.ctx, pid, WORN_SWORD, WORN_ENCHANT, 'mainhand', true);
    expect(result.ok).toBe(true);
    expect(meta.equipmentInstance.mainhand?.enchant).toBe(WORN_ENCHANT);
    expect(meta.equipmentInstance.mainhand?.rolled?.stats).toEqual({ str: 2 });
  });

  it('a replaced bagged payload survives a save/reload round-trip intact', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.ctx.addItemInstance(
      SWORD,
      { signer: 'Tester', enchant: MIGHT, rolled: { stats: { str: 2 } }, bindOnTrade: true },
      pid,
    );
    sim.addItem('arcane_dust', 5, pid);
    expect(resolveApplyEnchant(sim.ctx, pid, SWORD, AGILITY, undefined, true).ok).toBe(true);

    const state = sim.serializeCharacter(pid);
    expect(state).not.toBeNull();
    const saved = state!.inventory.find((s) => s.itemId === SWORD);
    expect(saved?.instance?.enchant).toBe(AGILITY);
    expect(saved?.instance?.rolled?.stats).toEqual({ agi: 2 });
    expect(saved?.instance?.signer).toBe('Tester');
    expect(saved?.instance?.bindOnTrade).toBe(true);

    const reloadedSim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const reloadedPid = reloadedSim.addPlayer('warrior', 'Reload', { state: state! });
    const loaded = reloadedSim.meta(reloadedPid)!.inventory.find((s) => s.itemId === SWORD);
    expect(loaded?.instance?.enchant).toBe(AGILITY);
    expect(isEnchantedInstance(loaded!.instance!)).toBe(true);
  });
});

// The two pure walks the replace arm and its #2350 scratch gate share
// (consumeEnchantedVictim wraps replaceVictimIndex): one function on both
// sides means the modeled victim can never drift from the consumed one, and
// these pin the walk itself.
describe('replaceVictimIndex / consumeEnchantedVictim (the shared victim walk)', () => {
  const GEAR = 'eastbrook_arming_sword';

  it('picks the highest-index ENCHANTED slot, skipping plain and unenchanted-instance slots above it', () => {
    const inventory: InvSlot[] = [
      { itemId: GEAR, count: 1, instance: { enchant: 'enchant_weapon_might' } },
      { itemId: 'arcane_dust', count: 5 },
      { itemId: GEAR, count: 1, instance: { rolled: { stats: { str: 5 } } } }, // legacy = enchanted
      { itemId: GEAR, count: 1 }, // plain: never the replace victim
      {
        itemId: GEAR,
        count: 1,
        instance: { signer: 'T', rolled: { masterwork: true, stats: { str: 2 } } },
      },
    ];
    // Index 2 (the legacy copy): the masterwork copy above it is NOT enchanted
    // and the plain copy is skipped outright.
    expect(replaceVictimIndex(inventory, GEAR)).toBe(2);
    expect(replaceVictimIndex(inventory, 'arcane_dust')).toBe(-1);
    expect(replaceVictimIndex([], GEAR)).toBe(-1);
  });

  it('consumes exactly one unit: removes a count-1 slot, decrements a surviving stack with a CLONED return', () => {
    const shared = { enchant: 'enchant_weapon_might', rolled: { stats: { str: 2 } } };
    const stacked: InvSlot[] = [{ itemId: GEAR, count: 2, instance: shared }];
    const consumed = consumeEnchantedVictim(stacked, GEAR);
    expect(stacked).toHaveLength(1);
    expect(stacked[0].count).toBe(1);
    // Clone-on-survival: mutating the returned payload never reaches the
    // surviving stack's shared payload (the removeEnchantableItem contract).
    consumed!.instance!.rolled!.stats!.str = 99;
    expect(stacked[0].instance?.rolled?.stats?.str).toBe(2);

    const single: InvSlot[] = [{ itemId: GEAR, count: 1, instance: { enchant: 'x' } }];
    expect(consumeEnchantedVictim(single, GEAR)?.instance?.enchant).toBe('x');
    expect(single).toHaveLength(0);
    expect(consumeEnchantedVictim([{ itemId: GEAR, count: 1 }], GEAR)).toBeUndefined();
  });
});

// The prune arm of replacedEnchantPayloadFor, exercised directly. The
// resolver tests cover remain > 0 (a masterwork bake under the enchant) and
// remain === 0 (the clean zero-residue case); the NEGATIVE arm is only
// reachable from a corrupt under-baked payload, which no resolver path can
// stage, so it needs a unit case or the docstring's "never mints a negative
// stat" claim rides on nothing.
describe('replacedEnchantPayloadFor prune arm (corrupt under-baked marker)', () => {
  it('deletes rather than going negative when the baked value is SMALLER than the old bonus', () => {
    // Greater Might is str 5, but this copy only carries str 1: subtracting
    // exactly would leave -4.
    const victim = {
      enchant: 'enchant_weapon_greater_might',
      rolled: { stats: { str: 1, sta: 2 } },
    };
    const out = replacedEnchantPayloadFor(victim, ENCHANTS.enchant_weapon_agility);
    // str is GONE, not negative; the unrelated sta rides through; the new
    // bonus lands on top.
    expect(out.rolled?.stats).toEqual({ sta: 2, agi: 2 });
    expect(out.enchant).toBe('enchant_weapon_agility');
    // The victim itself is never mutated (clone-first contract).
    expect(victim.rolled.stats).toEqual({ str: 1, sta: 2 });
  });
});
