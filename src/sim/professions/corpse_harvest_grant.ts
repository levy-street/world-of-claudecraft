// Corpse harvest completion: the claim/roll/grant/ledger body behind
// src/sim/interaction.ts's `harvestCorpse`, extracted so a future timed-cast
// completion boundary can share it (PR3 prep). NOT a behavior-neutral move:
// every admission-time fact that must not drift once a harvest is in flight
// (the player's town focus, their best wieldable any-profession gathering
// tool tier, and the per-component wield-requirement denial hint) is frozen
// into `CorpseHarvestGrantInputs` by the caller, via `snapshotCorpseHarvestGrantInputs`,
// and read ONLY from there: never a live `meta.townFocus` or a fresh bag scan
// mid-grant. That is what makes a focus re-spec or a gear swap between
// admission and completion unable to retarget an already-admitted harvest,
// whenever admission itself becomes a timed cast.
//
// Two behavior changes from the pre-extraction body:
//  1. `mob.harvestClaimedBy` is now set AFTER the ordinary (plain plus
//     signed-component) grants land, not immediately after the capacity
//     pre-gate. Gate order and rng draw order are unchanged; only the point
//     during a successful command where the claim write happens moved later,
//     which a mid-grant observer (a test spy on ctx.addItem, or a future
//     cast-completion boundary) can now see.
//  2. The premium-arm denial's `wieldProficiency` hint now reads the frozen
//     `wieldRequirementByComponent` map instead of scanning `meta.inventory`
//     live: a live scan can name a proficiency the player has ALREADY
//     reached by the time the roll resolves (a tool picked up mid-flight),
//     which reads as a lie about the denial (the denial itself is driven by
//     the frozen `bestAnyToolTier`, never by what is in the bags right now).
//     A hand-built `CorpseHarvestGrantInputs` that omits the map (a direct
//     fixture, a headless caller) gets NO `wieldProficiency` annotation:
//     never a live-scan fallback.

import { bagPools, canAddItem, fitsAll } from '../bags';
import { HARVEST_COMPONENT_SPECIMENS, monsterMaterialTierFor } from '../content/professions';
import { ITEMS } from '../data';
import { CORPSE_INTERACT_GRACE_SECONDS, hasPendingLootRollForMob } from '../loot/loot_roll';
import { gatheredMaterialSources } from '../material_gatherer';
import { noteReliquaryMark } from '../reliquary';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity, InvSlot } from '../types';
import { applyFocusBonus, applyFocusTierBonus, type FocusAllocation } from './focus';
import {
  forfeitsEveryMappedYield,
  type HarvestTier,
  harvestItemForFamily,
  harvestTierQuantity,
  isHarvestableCorpse,
  isSignableMaterialRarity,
  type MaterialRarity,
  resolveCorpseFocusHarvest,
  resolveCorpseHarvest,
  rollCorpseMaterialRarity,
  yieldingFocusComponents,
} from './gathering';
import { type HarvestYield, recordHarvestYield } from './harvest_yields';
import { canHarvestMonsterMaterial } from './tools';
import { bestWieldableAnyGatherToolTier, minWieldRequirementToWorkAny } from './wield_gate';

/**
 * Every decision a corpse harvest grant needs, frozen at admission time.
 * `componentTags` and `chosenComponents` are the same two arrays
 * `resolveCorpseFocusHarvest`/`yieldingFocusComponents` already take (a real
 * corpse's tagged families and the player's #1142 focus pick, `components ??`
 * the persistent town-focus default, both resolved by the caller); this module
 * makes no claim about where they came from and is exercised directly with
 * synthetic families in tests/corpse_harvest_grant.test.ts. `townFocus`,
 * `bestAnyToolTier` and `wieldRequirementByComponent` are the live reads this
 * module would otherwise make against `PlayerMeta`/`meta.inventory` mid-grant;
 * freezing them here is the whole point of the seam. Build one with
 * `snapshotCorpseHarvestGrantInputs` (below), which clones every field so the
 * caller's own arrays/records can keep changing after the snapshot without
 * reaching it.
 */
export interface CorpseHarvestGrantInputs {
  readonly componentTags: readonly string[];
  readonly chosenComponents: readonly string[];
  readonly townFocus: FocusAllocation;
  readonly bestAnyToolTier: number;
  /**
   * Per-component `minWieldRequirementToWorkAny` result, frozen at the SAME
   * admission moment as `bestAnyToolTier`, keyed by component id. Optional:
   * absent on a hand-built fixture, which is what tells `grantCorpseHarvest`
   * to omit the `wieldProficiency` annotation entirely rather than fall back
   * to a live scan (see the file banner).
   */
  readonly wieldRequirementByComponent?: Readonly<Record<string, number | null>>;
}

/**
 * Builds a frozen `CorpseHarvestGrantInputs` from the player's CURRENT state:
 * cloned `componentTags`/`chosenComponents` arrays, a cloned `townFocus`
 * record (shallow is enough; its values are plain numbers), the best
 * wieldable any-profession gathering tool tier, and the wield-requirement
 * denial hint for every family the pick will actually try to extract
 * (`yieldingFocusComponents`, so a family the pick cannot reach costs no
 * lookup). Every read here is a pure bag/state scan; this function draws NO
 * rng. The one admission-time entry point callers should use rather than
 * constructing `CorpseHarvestGrantInputs` by hand.
 */
export function snapshotCorpseHarvestGrantInputs(
  meta: PlayerMeta,
  componentTags: readonly string[],
  chosenComponents: readonly string[],
): CorpseHarvestGrantInputs {
  const tags = [...componentTags];
  const chosen = [...chosenComponents];
  const townFocus = { ...meta.townFocus };
  const bestAnyToolTier = bestWieldableAnyGatherToolTier(
    meta.inventory,
    meta.gatheringProficiency,
    ITEMS,
  );
  const wieldRequirementByComponent: Record<string, number | null> = {};
  for (const component of yieldingFocusComponents(tags, chosen)) {
    wieldRequirementByComponent[component] = minWieldRequirementToWorkAny(
      meta.inventory,
      monsterMaterialTierFor(component),
      ITEMS,
    );
  }
  return {
    componentTags: tags,
    chosenComponents: chosen,
    townFocus,
    bestAnyToolTier,
    wieldRequirementByComponent,
  };
}

/**
 * `harvestTierQuantity(tier)` with the player's persistent town focus (#1143)
 * yield bonus applied on top, rounded to the nearest whole item. Never
 * negative and never below the tier's unfocused quantity. Moved verbatim from
 * interaction.ts's private helper of the same name/body.
 */
function focusedHarvestQuantity(
  tier: HarvestTier,
  component: string,
  focus: FocusAllocation,
): number {
  return Math.round(applyFocusBonus(harvestTierQuantity(tier), component, focus));
}

/**
 * The reserved ordinary-grant ledger: for every family the pick actually
 * EXTRACTS (`yieldingFocusComponents`), the MAXIMUM plain quantity a
 * legendary-tier roll could add (`focusedHarvestQuantity('legendary', ...)`,
 * focus-boosted, same top-of-the-ladder reservation the pre-extraction
 * pre-gate used), coalesced by item id so two families mapping to the same
 * item reserve one summed slot. Pure and rng-free: this is what the capacity
 * gate in `grantCorpseHarvest` checks BEFORE the roll, and it is deliberately
 * a plain re-statement of the `wanted` loop `harvestCorpse` used to build
 * inline, not a new rule.
 */
export function corpseHarvestOrdinaryYields(inputs: CorpseHarvestGrantInputs): InvSlot[] {
  const wanted: InvSlot[] = [];
  for (const component of yieldingFocusComponents(inputs.componentTags, inputs.chosenComponents)) {
    const wantedItemId = harvestItemForFamily(component);
    // yieldingFocusComponents already dropped every family harvestItemForFamily
    // answers nothing for; kept as a type narrowing, unreachable by construction.
    if (!wantedItemId) continue;
    const maxQty = focusedHarvestQuantity('legendary', component, inputs.townFocus);
    const existing = wanted.find((w) => w.itemId === wantedItemId);
    if (existing) existing.count += maxQty;
    else wanted.push({ itemId: wantedItemId, count: maxQty });
  }
  return wanted;
}

/**
 * Resolve one corpse-harvest completion against a claimed-or-not `mob` and the
 * frozen `inputs` captured at admission. Returns whether the claim was spent.
 *
 * Gate order (all rng-free, all BEFORE the roll, matching the pre-extraction
 * body): corpse-level yieldability (#2513, belt-and-braces here since the
 * wired caller in interaction.ts already refuses first on real content, but
 * this module accepts synthetic component tags directly so it re-checks its
 * own inputs rather than trusting the caller), the atomic claim
 * check-and-set, the pick-level #2509 forfeit refusal, then the reserved
 * capacity gate (`corpseHarvestOrdinaryYields`). Only after all four pass does
 * the roll (`resolveCorpseFocusHarvest`) draw anything.
 */
export function grantCorpseHarvest(
  ctx: SimContext,
  mob: Entity,
  meta: PlayerMeta,
  inputs: CorpseHarvestGrantInputs,
): boolean {
  if (!isHarvestableCorpse(inputs.componentTags)) {
    ctx.error(meta.entityId, 'That corpse has nothing to harvest.');
    return false;
  }
  const claim = resolveCorpseHarvest(mob.harvestClaimedBy, meta.entityId);
  if (!claim.success) {
    ctx.error(meta.entityId, 'This corpse has already been harvested.');
    return false;
  }
  if (forfeitsEveryMappedYield(inputs.componentTags, inputs.chosenComponents)) {
    ctx.error(meta.entityId, 'Nothing you selected can be harvested from that corpse.');
    return false;
  }
  const wanted = corpseHarvestOrdinaryYields(inputs);
  if (wanted.length > 0 && !fitsAll(meta.inventory, bagPools(meta.bags), wanted)) {
    ctx.error(meta.entityId, 'Your bags are full.');
    return false;
  }
  // The claim is NOT written here: see the file banner. It is set below, once
  // every ordinary (plain plus signed-component) grant has landed.
  const bestAny = inputs.bestAnyToolTier;
  let toolDeniedEmitted = false;
  // #2457 ledger: every grant below records into `granted` as it LANDS. The
  // tool-denied arm below records its plain top-up; a refused specimen
  // contributes no entry at all (the gatherDowngrade toast owns that
  // feedback).
  const granted: HarvestYield[] = [];
  const yields = resolveCorpseFocusHarvest(inputs.componentTags, inputs.chosenComponents, ctx.rng);
  // Plain and signed-component grants first, the optional specimen last: the
  // pre-gate above reserves room for the plain-quantity stacks ONLY, so every
  // one of those must land before the specimen (a DISTINCT item id, the only
  // one of the three that can genuinely fail to fit) can take a slot. The
  // rarity rolls stay in THIS first loop, in yield order (draw-order pinned
  // by tests/corpse_harvest_sim.test.ts and tests/corpse_harvest_result_event.test.ts);
  // only the grants are reordered into the two loops below.
  const signedGrants: {
    itemId: string;
    specimen: boolean;
    plainQty: number;
    rarity: MaterialRarity;
  }[] = [];
  for (const y of yields) {
    const itemId = harvestItemForFamily(y.component);
    // Unreachable by construction: resolveCorpseFocusHarvest only ever yields
    // families yieldingFocusComponents kept, the same accessor.
    if (!itemId) continue;
    const tier = applyFocusTierBonus(y.tier, y.component, inputs.townFocus);
    const qty = focusedHarvestQuantity(tier, y.component, inputs.townFocus);
    const rarity = rollCorpseMaterialRarity(ctx.rng);
    // Premium-arm tool denial: happens strictly AFTER the rarity roll and
    // draws no rng of its own. A denied family downgrades to the plain
    // fungible grant it gets on a common roll; at most one gatherDenied per
    // command, even when several yields are downgraded.
    if (
      isSignableMaterialRarity(rarity) &&
      !canHarvestMonsterMaterial(bestAny, monsterMaterialTierFor(y.component))
    ) {
      ctx.addItem(itemId, qty, meta.entityId, {
        silent: true,
        callerLogs: true,
        materialSources: gatheredMaterialSources(meta, qty),
      });
      recordHarvestYield(granted, { itemId, qty, rarity, kind: 'plain' });
      if (!toolDeniedEmitted) {
        toolDeniedEmitted = true;
        // Frozen at admission (see the file banner): never a live
        // meta.inventory scan, which could name a proficiency the player
        // already holds by the time this roll resolves. Absent when the
        // caller never built the map (a hand-built fixture), never a
        // fallback live read.
        const wieldReq = inputs.wieldRequirementByComponent?.[y.component] ?? null;
        ctx.emit({
          type: 'gatherDenied',
          pid: meta.entityId,
          surface: 'corpse',
          requiredTier: monsterMaterialTierFor(y.component),
          ...(wieldReq !== null && wieldReq > 0 ? { wieldProficiency: wieldReq } : {}),
        });
      }
      continue;
    }
    const specimenId = isSignableMaterialRarity(rarity)
      ? HARVEST_COMPONENT_SPECIMENS[y.component]
      : undefined;
    if (specimenId !== undefined) {
      ctx.addItem(itemId, qty, meta.entityId, {
        silent: true,
        callerLogs: true,
        materialSources: gatheredMaterialSources(meta, qty),
      });
      recordHarvestYield(granted, { itemId, qty, rarity, kind: 'plain' });
      signedGrants.push({ itemId: specimenId, specimen: true, plainQty: 0, rarity });
    } else if (isSignableMaterialRarity(rarity)) {
      signedGrants.push({ itemId, specimen: false, plainQty: qty, rarity });
    } else {
      ctx.addItem(itemId, qty, meta.entityId, {
        silent: true,
        callerLogs: true,
        materialSources: gatheredMaterialSources(meta, qty),
      });
      recordHarvestYield(granted, { itemId, qty, rarity, kind: 'plain' });
    }
  }
  // The SIGNED-COMPONENT loop: the signature rides the granted units' own
  // SOURCE bucket, so it merges into the same stacks the plain arm above used
  // and can never be lost to capacity. Still runs before the specimen loop
  // below, so the pre-gate's reserved plain-stack room is spent on components
  // first, exactly as before.
  for (const grant of signedGrants) {
    if (grant.specimen) continue;
    ctx.addItem(grant.itemId, grant.plainQty, meta.entityId, {
      silent: true,
      callerLogs: true,
      materialSources: gatheredMaterialSources(meta, grant.plainQty, { signer: meta.name }),
    });
    recordHarvestYield(granted, {
      itemId: grant.itemId,
      qty: grant.plainQty,
      rarity: grant.rarity,
      kind: 'signed',
    });
  }
  // Ordinary grants (plain plus signed-component) have all landed: the claim
  // is spent now, even if the optional specimen below cannot fit.
  mob.harvestClaimedBy = claim.claimedBy;
  // The specimen loop keeps its own capacity guard and truncation feedback: a
  // specimen is its own item id, so it can genuinely fail to fit independent
  // of how its provenance is recorded.
  let downgradeEmitted = false;
  for (const grant of signedGrants) {
    if (!grant.specimen) continue;
    const specimenSources = gatheredMaterialSources(meta, 1, { signer: meta.name });
    if (canAddItem(meta.inventory, bagPools(meta.bags), grant.itemId, 1, specimenSources)) {
      ctx.addItem(grant.itemId, 1, meta.entityId, {
        silent: true,
        callerLogs: true,
        materialSources: specimenSources,
      });
      recordHarvestYield(granted, {
        itemId: grant.itemId,
        qty: 1,
        rarity: grant.rarity,
        kind: 'specimen',
      });
      ctx.markVisited(meta, 'gather_event:perfect_specimen');
      noteReliquaryMark(ctx, meta, 'gather_event:perfect_specimen');
    } else if (!downgradeEmitted) {
      downgradeEmitted = true;
      ctx.emit({ type: 'gatherDowngrade', pid: meta.entityId, surface: 'corpse', lost: 'find' });
    }
  }
  // #2457: one result event for the whole command, after every grant has
  // landed. The FALSE arm is unreachable by construction (the corpse-level
  // and pick-level gates above already guarantee at least one extracted
  // family, and every arm of the loops above calls recordHarvestYield), kept
  // as dead defensive code rather than an assumption.
  if (granted.length > 0) ctx.emit({ type: 'harvestResult', pid: meta.entityId, yields: granted });
  // Lifecycle decoupling: with the claim spent the corpse owes nobody a
  // harvest window anymore, so exhausted loot collapses fast while remaining
  // loot keeps only a short owner window. A pending need-greed roll owns the
  // timer outright, matching pruneCorpseLoot's guard.
  if (!hasPendingLootRollForMob(ctx, mob.id)) {
    if (!mob.loot || (mob.loot.copper <= 0 && mob.loot.items.length === 0)) {
      mob.lootable = false;
      mob.corpseTimer = Math.min(mob.corpseTimer, 4);
    } else {
      mob.corpseTimer = Math.min(mob.corpseTimer, CORPSE_INTERACT_GRACE_SECONDS);
    }
  }
  return true;
}
