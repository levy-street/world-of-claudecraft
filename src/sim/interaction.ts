// Interaction: looting, quest NPCs, ground objects. The three IWorldInteraction
// command bodies (lootCorpse / pickUpObject / interact) extracted from sim.ts
// (session W3) as a pure MOVE behind SimContext, exactly as PR #943 did for
// market.ts / loot/loot_roll.ts, and aligned to the IWorldInteraction facet
// (src/world_api/interaction.ts). Each command is a free function `fn(ctx, ...args)`;
// Sim keeps thin same-named delegates so the IWorld surface, server/game.ts, and
// the tests resolve unchanged (the widened `pid?` overload stays on the delegates).
//
// The quest-NPC dispatch these bodies fan into (talkToNpc) plus the shared
// quest-interaction predicate (isQuestInteractionEntity) STAY on Sim (W4's
// quest-NPC surface) and are reached through two append-only SimContext callbacks.
// The corpse-loot helpers (distributeLootCopper / awardSharedLootItem /
// lootSlotVisibleTo / pruneCorpseLoot) are imported from loot/loot_roll.ts (L1/W6)
// and the Nythraxis interaction hooks (tryStartNythraxisWardChannel /
// activateNythraxisRelic / interactObjectForQuests) from encounters/nythraxis.ts
// (N1); they are imported, never edited.
//
// Move-not-rewrite: statements, branches, short-circuit and iteration order are
// verbatim. The immutability waiver applies: the in-place loot-slot (s.count /
// s.personalFor), corpse targetId, and ground-object (lootable / respawnTimer)
// mutations move as-is. This region draws NO rng.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts).

import { bagCapacity, canGrantItemInstance, fitsAll } from './bags';
import { type NoticeboardDef, noticeboardDefByEntityId } from './content/noticeboards';
import { HARVEST_COMPONENT_SPECIMENS, monsterMaterialTierFor } from './content/professions';
import { corpseInteractionAvailability } from './corpse_interaction';
import { ITEMS, MOBS, QUESTS, SPIRIT_HEALER_NPC_ID } from './data';
import * as deedsMod from './deeds';
import {
  activateNythraxisRelic,
  interactObjectForQuests,
  tryStartNythraxisWardChannel,
} from './encounters/nythraxis';
import { tryStartEscort } from './escort';
import { isInRaidInstance } from './instances/dungeons';
import { HUT_OBJECT_ID, tryBurnHut } from './interactions/firebottle_hut';
import { hasSharedLootRights as computeSharedLootRights, lootHasGoneFfa } from './loot/loot_ffa';
import {
  awardSharedLootItem,
  CORPSE_INTERACT_GRACE_SECONDS,
  distributeLootCopper,
  hasPendingLootRollForMob,
  lootSlotVisibleTo,
  pruneCorpseLoot,
} from './loot/loot_roll';
import { applyFocusBonus, applyFocusTierBonus, type FocusAllocation } from './professions/focus';
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
} from './professions/gathering';
import { type HarvestYield, recordHarvestYield } from './professions/harvest_yields';
import { canHarvestMonsterMaterial } from './professions/tools';
import {
  bestWieldableAnyGatherToolTier,
  minWieldRequirementToWorkAny,
} from './professions/wield_gate';
import type { SimContext } from './sim_context';
import { interactSoulwell } from './soulwell';
import {
  cloneItemInstancePayload,
  dist2d,
  type Entity,
  INTERACT_RANGE,
  type InvSlot,
  OBJECT_RESPAWN,
} from './types';
import { markWorldBossLooted } from './world_boss';

const LOCKPICK_OFFER_COOLDOWN = 4; // seconds between repeated rift_locked_chest offer emits per player

// Shared corpse loot-rights snapshot for both the manual `lootCorpse` and the passive
// walk-by `autoLootForParty`. The caller passes `ffaUnlocked` so the two paths can
// diverge on the free-for-all rule: manual looting honors the FFA timer (a deliberate
// click may take a stranger's corpse once its owner-lock lapses), but walk-by passes
// false so a passive pass never auto-grabs a stranger's corpse just because it aged out.
function corpseLootRights(
  ctx: SimContext,
  mob: Entity,
  entityId: number,
  ffaUnlocked: boolean,
): { shared: boolean; personal: boolean; open: boolean } {
  const tapperParty = mob.tappedById !== null ? ctx.partyOf(mob.tappedById) : null;
  const shared = computeSharedLootRights(
    entityId,
    mob.tappedById,
    tapperParty?.members ?? null,
    ffaUnlocked,
  );
  const personal = mob.loot?.items.some((s) => s.personalFor?.includes(entityId)) ?? false;
  const open = mob.loot?.items.some((s) => s.openToAll && s.count > 0) ?? false;
  return { shared, personal, open };
}

// `honorFfa` (default true) keeps manual looting honoring the owner-lock lapse; the
// passive walk-by path passes false so it never grants a stranger's FFA corpse.
// `quiet` (default false) suppresses the full-bags toast: the walk-by pass retries
// every couple of seconds while the player stands near a corpse, so a full-bags
// player would otherwise get the toast on loop; a deliberate click keeps it.
export function lootCorpse(
  ctx: SimContext,
  mobId: number,
  pid?: number,
  honorFfa = true,
  quiet = false,
): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const { meta, e: p } = r;
  // Dead players (released ghosts included) cannot loot; the same rejection the
  // item family uses (src/sim/items.ts). The walk-by autoLootForParty path never
  // reaches this: it silently drops a dead trigger before delegating here.
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return false;
  }
  const mob = ctx.entities.get(mobId);
  if (!mob?.lootable || !mob.loot) return false;
  // owner-lock lapses LOOT_FFA_DELAY after the corpse became lootable: then anyone may loot.
  const ffaUnlocked = honorFfa && lootHasGoneFfa(mob.lootFfaTimer);
  const rights = corpseLootRights(ctx, mob, meta.entityId, ffaUnlocked);
  if (!rights.shared && !rights.personal && !rights.open) {
    ctx.error(meta.entityId, "You don't have permission to loot that.");
    return false;
  }
  if (dist2d(p.pos, mob.pos) > INTERACT_RANGE) {
    ctx.error(meta.entityId, 'Too far away.');
    return false;
  }
  let didLoot = false;
  if (rights.shared && mob.loot.copper > 0) {
    distributeLootCopper(ctx, mob, meta);
    didLoot = true;
  }
  // Capacity gate: an item that doesn't fit the looter's bags STAYS on the
  // corpse (classic behavior), with one "bags are full" toast per loot action.
  let bagsFull = false;
  let tookPersonal = false;
  for (const s of [...mob.loot.items]) {
    if (!lootSlotVisibleTo(s, meta.entityId)) continue;
    if (s.openToAll) {
      while (s.count > 0 && ctx.canAddItem(s.itemId, 1, meta.entityId)) {
        if (s.instance) {
          ctx.addItemInstance(s.itemId, cloneItemInstancePayload(s.instance), meta.entityId);
        } else {
          ctx.addItem(s.itemId, 1, meta.entityId);
        }
        s.count--;
        didLoot = true;
      }
      if (s.count > 0) bagsFull = true;
      continue;
    }
    if (s.personalFor) {
      if (!ctx.canAddItem(s.itemId, 1, meta.entityId)) {
        bagsFull = true;
        continue;
      }
      if (s.instance) {
        ctx.addItemInstance(s.itemId, cloneItemInstancePayload(s.instance), meta.entityId);
      } else {
        ctx.addItem(s.itemId, 1, meta.entityId);
      }
      s.personalFor = s.personalFor.filter((id) => id !== meta.entityId);
      tookPersonal = true;
      didLoot = true;
      continue;
    }
    if (!rights.shared) continue;
    while (s.count > 0) {
      if (s.instance) {
        if (!ctx.canAddItem(s.itemId, 1, meta.entityId)) break;
        ctx.addItemInstance(s.itemId, cloneItemInstancePayload(s.instance), meta.entityId);
        s.count--;
      } else if (awardSharedLootItem(ctx, s.itemId, mob, meta)) {
        s.count--;
      } else {
        break;
      }
      didLoot = true;
    }
    if (s.count > 0) bagsFull = true;
  }
  if (bagsFull && !quiet) ctx.error(meta.entityId, 'Your bags are full.');
  // The world-boss loot lockout is consumed by LOOTING, not by the kill: taking any
  // personal slot from the boss's corpse starts the lockout (rollWorldBossLoot checks
  // eligibility when the next boss dies). A contributor who never reaches the corpse
  // holds no lockout and can loot again at the next spawn.
  if (tookPersonal && MOBS[mob.templateId]?.worldBoss) {
    // The world-boss loot lockout IS a raid lockout: this one write both gates re-loot
    // (isWorldBossLootEligible) and renders the countdown in the raid-lockout timer, and
    // it resets on the same boundary as the dungeon raids (ctx.raidResetMs).
    markWorldBossLooted(meta, mob.templateId, ctx.raidResetMs(ctx.lockoutNowMs()));
  }
  pruneCorpseLoot(ctx, mob);
  if (p.targetId === mobId) p.targetId = null;
  return didLoot;
}

// Walk-by autoloot: a silent eligibility pre-check, then a delegate to the existing
// per-slot `lootCorpse` distribution. Two differences from a manual loot: a failed
// check here must NOT emit a "no permission" / "too far" error (this fires passively
// every frame as the trigger walks near a corpse), and it never honors the FFA
// owner-lock lapse, so a passive pass never auto-grabs a stranger's aged-out corpse.
export function autoLootForParty(ctx: SimContext, mobId: number, triggerPid: number): void {
  const r = ctx.resolve(triggerPid);
  if (!r || r.e.dead) return;
  const { meta, e: trigger } = r;
  if (isInRaidInstance(ctx, trigger.pos)) return; // silent: no error toast on a passive walk-by
  const mob = ctx.entities.get(mobId);
  if (!mob?.lootable || !mob.loot) return;
  if (dist2d(trigger.pos, mob.pos) > INTERACT_RANGE) return;

  // ffaUnlocked=false: walk-by may auto-loot the trigger's own tap, their party's tap,
  // an untapped corpse, personal drops, or open-to-all, but NEVER a stranger's corpse
  // just because its owner-lock lapsed into FFA. Auto-grabbing another player's loot
  // reads as hostile, so an aged-out corpse is left for a deliberate manual loot click.
  const rights = corpseLootRights(ctx, mob, meta.entityId, false);
  if (!rights.shared && !rights.personal && !rights.open) return;
  // LOAD-BEARING alignment: this pre-check (rights via the same corpseLootRights
  // + range via the same INTERACT_RANGE above) is what makes the delegated
  // lootCorpse's "no permission" / "too far" toasts unreachable from this
  // passive pass; only the full-bags toast needs the explicit quiet flag. If
  // either threshold ever diverges from lootCorpse's, the walk-by retry loop
  // starts toasting players again.

  // honorFfa=false so the delegated distribution also refuses the FFA shared grant,
  // matching the pre-check (which only keeps this pass silent on ineligibility);
  // quiet=true so a full-bags player is not toasted on every 2s walk-by retry.
  lootCorpse(ctx, mobId, meta.entityId, false, true);
}

/**
 * Profession harvest: single-use, first-come salvage of a dead mob's corpse
 * (skinning/salvage components), independent of the loot table above. Whoever's
 * command reaches here first while the corpse is unclaimed wins; every later
 * attempt against the same corpse (same tick or later) is denied. See
 * professions/gathering.ts for the race-freedom argument.
 *
 * `components` (#1142) is the player's per-corpse focus pick: which tagged
 * component(s) to extract. OMITTED (undefined) resolves to the
 * player's persistent town focus: the corpse tags holding allocation points
 * (none focused falls through to the spread). An EXPLICIT array keeps the
 * #1142 semantics: empty or covering every tagged component spreads across
 * every tag (the #1141 behavior); extracting fewer concentrates the effort for
 * a higher tier per component, per resolveCorpseFocusHarvest in
 * professions/gathering.ts. Extracting, not picking: an unmapped family is
 * never extracted, so on a corpse carrying one mapped family there is no
 * choice to make (#2514, see below). That array is sanitized before any of it is read
 * (effectiveFocusComponents): repeats collapse (#2474) and tags this corpse
 * does not carry drop out (#2504), so `['hide','hide']` and `['hide','junk']`
 * are both exactly `['hide']` here and in the pre-claim capacity gate below,
 * and a pick of nothing but junk is exactly the empty pick (it spreads).
 * A pick that survives sanitization but names only families with no item
 * behind them is REFUSED pre-claim instead (#2509, see the gate below), so no
 * selection can spend a single-use corpse for nothing. A pick that names such
 * a family BESIDE one that pays is allowed, and the unmapped entry is simply
 * not extracted (#2514, yieldingFocusComponents): it costs no tier roll, no
 * rng draw, and no concentration tier, so `['hide','claw']` is byte-identical
 * to `['hide']`.
 *
 * The corpse-level half of that rule is isHarvestableCorpse (#2513): it answers
 * on the MAPPED families the template carries, so a corpse that could never pay
 * anything is refused up front (error.corpseNothingToHarvest) instead of
 * advertising a harvest, taking the command, spending the claim and reporting
 * nothing. Between the two gates, every command that reaches the roll below
 * yields at least one item, so no path through this function can spend a
 * single-use claim in silence.
 */
export function harvestCorpse(
  ctx: SimContext,
  mobId: number,
  components?: string[],
  pid?: number,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  // Dead players (released ghosts included) cannot harvest; the same rejection
  // the loot/pickup commands above use.
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  const mob = ctx.entities.get(mobId);
  if (mob?.kind !== 'mob' || !mob.dead) return;
  const componentTags = MOBS[mob.templateId]?.componentTags;
  if (!isHarvestableCorpse(componentTags)) {
    ctx.error(meta.entityId, 'That corpse has nothing to harvest.');
    return;
  }
  if (dist2d(p.pos, mob.pos) > INTERACT_RANGE) {
    ctx.error(meta.entityId, 'Too far away.');
    return;
  }
  const claim = resolveCorpseHarvest(mob.harvestClaimedBy, meta.entityId);
  if (!claim.success) {
    ctx.error(meta.entityId, 'This corpse has already been harvested.');
    return;
  }
  // Capacity gate BEFORE consuming the single-use claim: addItem is never
  // capacity-capped (the command boundary owns the pre-check, like
  // lootCorpse/pickUpObject in this file), and a full-bags refusal must leave
  // the corpse unclaimed for the next harvester. The gate runs on the
  // deterministic pre-roll focus set so a refused command draws NO rng, and it
  // reserves the MAXIMUM the tier roll can add per component
  // (harvestTierQuantity of the top tier, focus-boosted by the player's
  // persistent town focus per component, fit cumulatively): a gate on less
  // could pass on a nearly-full stack and let the uncapped addItem spill past
  // capacity.
  // Omitted-components default: no explicit pick means the player's
  // persistent town focus IS the pick (the focused subset of this corpse's
  // tags; nothing focused spreads, exactly like an explicit empty pick). The
  // derivation is rng-free, so a refused command below still draws nothing.
  const chosen =
    components ?? (componentTags ?? []).filter((tag) => (meta.townFocus[tag] ?? 0) > 0);
  // #2509: refuse a pick that forfeits EVERYTHING this corpse had to give,
  // before the claim is spent. Measured pre-fix on old_greyjaw (hide, fang,
  // claw) with ['claw']: the claim was spent, one tier roll was drawn, nothing
  // was granted, and the harvestResult ledger was skipped (it is gated on
  // `granted.length > 0`), so the player burned a single-use corpse for no
  // items and NO chat line at all. Nine shipped templates mix mapped and
  // unmapped families, and on the three `gills, hide` murlocs a single
  // checkbox is enough to hit it.
  //
  // Placed with the capacity gate below, for the same three reasons that one
  // is here: pre-claim (a refusal must leave the corpse for the next
  // harvester), rng-free (a refused command must not shift the world's draw
  // order), and derived from the same sanitized pick the roll is. It fires
  // exactly when the `wanted` loop below would come out empty (both sides ask
  // harvestFamilyYieldsItem over effectiveFocusComponents, one as a `.some`
  // and one as the `.filter` inside yieldingFocusComponents), and
  // the bags-full gate needs `wanted` non-empty, so neither can mask the
  // other's message. The predicate itself lives beside effectiveFocusComponents
  // (professions/gathering.ts) because the picker's view-core mirrors it; one
  // rule, one place, or the two drift the first time the spread rule moves.
  //
  // Deliberately NOT narrowed inside effectiveFocusComponents the way an
  // uncarried tag is (#2504), and that ordering is still load-bearing after
  // #2514 moved the bonus: the refusal is a statement about the pick the player
  // MADE, so it has to be asked before the unmapped families are dropped. Fold
  // the drop into effectiveFocusComponents instead and ['claw'] sanitizes to
  // the empty pick, spreads, and burns the corpse in the silence this refusal
  // exists to end. The drop happens one step later, in
  // yieldingFocusComponents, which is what the capacity gate below and the tier
  // rolls read.
  //
  // Scope, the other half of the #2504 comment: that one covers a tag the
  // corpse does not CARRY, which sanitizes away and spreads. This covers a tag
  // it carries that HARVEST_COMPONENT_ITEMS does not map (gills, horn) on a
  // corpse that ALSO carries a mapped one. A corpse whose tags ALL map to
  // nothing never reaches this gate at all any more (#2513): the
  // isHarvestableCorpse check above answers on mapped families, so such a
  // corpse is refused there with error.corpseNothingToHarvest, exactly like
  // the 101 shipped templates that carry no component tags. (fen_troll (claw,
  // tusk) was the shipped example until #2905 mapped both; the all-unmapped
  // state now lives only in retagged test fixtures.) That closed
  // the last path to a claim spent in silence, and it is why this predicate's
  // second half (`taggedComponents.some(yields)`) is now belt and braces here
  // rather than the term that kept an all-unmapped corpse claimable.
  //
  // This also covers the DERIVED pick, not just an explicit one: an omitted
  // `components` resolves through meta.townFocus, so a persisted `{ claw: 5 }`
  // makes the plain interact press take this arm too. Refusing is the better
  // outcome there as well: the corpse survives for a pick that can pay out,
  // instead of being burned by a focus the player cannot see. #2511 has since
  // closed the route that could WRITE such a focus (set_town_focus rejects a
  // key outside HARVEST_COMPONENT_ITEMS, and the load arm drops one an older
  // save carries), so this arm is now defense in depth on the derived pick
  // rather than a reachable path; tests/corpse_harvest_sim.test.ts still
  // drives it by poking meta directly, which is what a pre-#2511 save was.
  if (forfeitsEveryMappedYield(componentTags ?? [], chosen)) {
    ctx.error(meta.entityId, 'Nothing you selected can be harvested from that corpse.');
    return;
  }
  const wanted: InvSlot[] = [];
  // The EXTRACTED set (#2514), which is exactly what resolveCorpseFocusHarvest
  // will roll. Reserves nothing new: this loop already open-coded the same
  // filter (`harvestItemForFamily` then `continue`) over the effective pick, so
  // `wanted` is byte-identical before and after. What changes is that the rule
  // is now NAMED, and the gate and the roll read the one function instead of
  // agreeing by coincidence, which is the same argument harvestItemForFamily's
  // own docstring makes about its readers.
  for (const component of yieldingFocusComponents(componentTags ?? [], chosen)) {
    const wantedItemId = harvestItemForFamily(component);
    // A type narrowing, not a filter: yieldingFocusComponents already dropped
    // every family this same accessor answers nothing for, so the arm is
    // unreachable by construction. No fixture can reach it, so what is pinned
    // is the property instead (tests/corpse_harvest_sim.test.ts, "every family
    // a harvest extracts has an item behind it", swept over every shipped
    // tagged template x every pick shape).
    if (!wantedItemId) continue;
    const maxQty = focusedHarvestQuantity('legendary', component, meta.townFocus);
    const existing = wanted.find((w) => w.itemId === wantedItemId);
    if (existing) existing.count += maxQty;
    else wanted.push({ itemId: wantedItemId, count: maxQty });
  }
  // The third dead-by-construction guard on this path, named beside its two
  // siblings above so the set is auditable rather than one-of-three documented:
  // both gates upstream guarantee yieldingFocusComponents is non-empty, so
  // `wanted` always holds at least one row and the short-circuit's false arm is
  // unreachable. Dead since #2513, kept for the same reason the others are.
  if (wanted.length > 0 && !fitsAll(meta.inventory, bagCapacity(meta.bags), wanted)) {
    ctx.error(meta.entityId, 'Your bags are full.');
    return;
  }
  mob.harvestClaimedBy = claim.claimedBy;
  // Tool gate for the PREMIUM arm only: the plain component grant is
  // never gated (the bare-hands floor), but a signable rarity roll's
  // signed/specimen upgrade needs the player's best WIELDABLE gathering tool
  // of ANY profession to cover the component family's material tier (R50,
  // the R22 corpse arm: each land profession's contribution filters by its
  // own counter, a rod contributes unfiltered per the rod exemption, and the
  // bare-hands floor stands). Resolved once, rng-free, before the per-yield
  // loop. Every wave-one family is tier 1 (content/professions.ts
  // MONSTER_MATERIAL_TIERS, the prime directive) and bare hands float the
  // scan at 1, so in shipped content this gate never fires: it is the seam
  // future higher-tier corpse families compose with.
  const bestAny = bestWieldableAnyGatherToolTier(meta.inventory, meta.gatheringProficiency, ITEMS);
  let toolDeniedEmitted = false;
  // #2457: the yield ledger the single harvestResult event below carries. Every
  // grant in this function passes { silent: true, callerLogs: true } from here
  // on, so the hub's own per-grant "You receive:" line and generic ding stand
  // down (the #2430 contract) and this ledger becomes the harvest's ONLY chat
  // feedback. Recorded beside each grant as it LANDS rather than from the roll
  // loop, so a full-bag downgrade reports the plain top-up it actually became
  // and a refused specimen contributes no entry at all.
  const granted: HarvestYield[] = [];
  // #1145: a rare-or-better monster material is stamped with the harvester's
  // name (a non-fungible instance slot); anything below that rarity stays a
  // plain fungible grant, same as before this issue. One rarity roll per
  // yielded component, same one-draw-per-yield convention as
  // resolveCorpseFocusHarvest's own tier roll.
  const yields = resolveCorpseFocusHarvest(componentTags ?? [], chosen, ctx.rng);
  // #1145: one rarity roll per yielded component, independent of
  // the component's tier roll/bonus. For a family with a Pristine specimen
  // (HARVEST_COMPONENT_SPECIMENS), a rare-or-better roll grants the specimen
  // as the SIGNED jackpot IN ADDITION to the plain component; the regular
  // component always grants plain. A family without a specimen keeps the
  // pre-specimen behavior: the component itself grants signed at rare+.
  //
  // Grant ORDER is load-bearing: the pre-gate above reserves room for the
  // plain component stacks ONLY, so every plain yield must land before any
  // signed instance takes a slot (a jackpot granted mid-loop could consume
  // the slot reserved for a LATER family's plain stack and push the uncapped
  // plain grant past capacity). The rarity rolls stay in this first loop, in
  // yield order, so the draw sequence is byte-identical to the single-pass
  // shape (pinned by the draw-count cases in tests/corpse_harvest_sim.test.ts
  // and tests/corpse_harvest_result_event.test.ts, NOT by the parity goldens:
  // no parity scenario drives harvestCorpse); only the grants are reordered.
  // `rarity` rides along purely so the deferred grants below can record their
  // ledger entry with the roll that produced them (#2457): the line color is
  // the ROLLED material rarity, and by the time a signed grant lands its own
  // loop iteration is long past.
  const signedGrants: {
    itemId: string;
    specimen: boolean;
    plainQty: number;
    rarity: MaterialRarity;
  }[] = [];
  for (const y of yields) {
    const itemId = harvestItemForFamily(y.component);
    // Unreachable by construction since #2514, for the same reason and under
    // the same property pin as the capacity gate's twin above:
    // resolveCorpseFocusHarvest only ever yields families
    // yieldingFocusComponents kept, and that filter and this lookup are the
    // SAME accessor. Kept as the type narrowing the `string | undefined`
    // return needs, and because this `continue` is the exact line that used to
    // swallow an unmapped family in silence, which is the harm the last three
    // issues in this trail closed one path at a time.
    if (!itemId) continue;
    // #1143: the player's persistent town focus adds a bonus on top of the
    // #1142 roll for a focused component; an unfocused component's tier is
    // exactly the roll above, untouched. The same per-point yield bonus is
    // applied to the tier's base quantity, so focus below the 5-point
    // tier-shift threshold still does something.
    const tier = applyFocusTierBonus(y.tier, y.component, meta.townFocus);
    const qty = focusedHarvestQuantity(tier, y.component, meta.townFocus);
    const rarity = rollCorpseMaterialRarity(ctx.rng);
    // The rarity roll above MUST stay exactly where it is (one roll per yield,
    // in yield order: the draw sequence is pinned by the corpse suites' own
    // draw-count cases, one per arm, since no parity scenario harvests a
    // corpse). The
    // premium-arm denial below happens strictly AFTER the roll and
    // draws no rng: a denied family downgrades to the plain fungible grant it
    // gets on a common roll today (a specimen family keeps its plain component
    // and only loses the jackpot push; a non-specimen family loses the
    // signature, never the yield). At most ONE gatherDenied is emitted per
    // harvest command, even when several yields are downgraded.
    if (
      isSignableMaterialRarity(rarity) &&
      !canHarvestMonsterMaterial(bestAny, monsterMaterialTierFor(y.component))
    ) {
      ctx.addItem(itemId, qty, meta.entityId, {
        silent: true,
        callerLogs: true,
      });
      recordHarvestYield(granted, { itemId, qty, rarity, kind: 'plain' });
      if (!toolDeniedEmitted) {
        toolDeniedEmitted = true;
        // The R22 wield split, corpse flavor: when a covering land tool is
        // in the bags and only its counter is short, name the smallest
        // proficiency that would put something already carried to work.
        const wieldReq = minWieldRequirementToWorkAny(
          meta.inventory,
          monsterMaterialTierFor(y.component),
          ITEMS,
        );
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
      });
      recordHarvestYield(granted, { itemId, qty, rarity, kind: 'plain' });
      signedGrants.push({
        itemId: specimenId,
        specimen: true,
        plainQty: 0,
        rarity,
      });
    } else if (isSignableMaterialRarity(rarity)) {
      signedGrants.push({ itemId, specimen: false, plainQty: qty, rarity });
    } else {
      ctx.addItem(itemId, qty, meta.entityId, {
        silent: true,
        callerLogs: true,
      });
      recordHarvestYield(granted, { itemId, qty, rarity, kind: 'plain' });
    }
  }
  // Signed-family components first: their plain FALLBACK still owns
  // pre-gate-reserved stack room, so they outrank the specimens, which are
  // pure extras. A signed instance merges into a byte-equal same-signer stack
  // (identical-payload stacking; never a plain stack, #1165), so
  // this gate accepts same-signer stack room plus genuinely free slots
  // (canGrantItemInstance, the countFit model harvestNode's signed grants
  // share, #2139), measured against the FULL grant: one unit for a specimen,
  // the whole rolled quantity for a signed component (#2473). Without room for
  // all of it the signed-family grant falls back to the
  // plain fungible top-up (the signature truncates, the yield does not) while
  // a specimen truncates outright, the same truncation contract harvestNode's
  // signed grants follow. Each downgrade tells the player via the text-free
  // personal gatherDowngrade event, at most ONCE per harvest command (the
  // toolDeniedEmitted idiom); the mark-lost arm runs first, so when both a
  // signature and a jackpot are lost the single event reports the mark.
  // All-or-nothing is a deliberate divergence from harvestNode, whose signed
  // batch lands a PARTIAL fit and lets the rest of the yield go: a corpse
  // downgrade is an UNCAPPED plain grant of the whole rolled quantity into
  // pre-gate-reserved room, so refusing the signature here costs the player no
  // units and keeps the harvest at one ledger entry (one chat line) per item.
  //
  // #2473, the one behavior this quantity fix trades away, deliberately: with
  // PARTIAL same-signer merge room the counted grant spills into a fresh slot
  // where the one-unit grant it replaces merged for free, so on a corpse that
  // also procs a specimen (forest_wolf tags hide AND fang) the last free slot
  // can go to the component instead of the jackpot, which then truncates with
  // its lost: 'find' notice. The component wins that slot for one reason only,
  // stated plainly because it is easy to get wrong: this loop runs FIRST. It is
  // NOT holding a claim on the slot. The pre-gate reserves room for a PLAIN add
  // (every `wanted` entry carries no instance) and a signed instance can never
  // spend plain-stack room (#1165), so the free slot taken here is unreserved
  // room, the same unreserved room the specimen wanted.
  // Refusing the signature whenever a jackpot is pending was measured across
  // corpse templates, bag shapes, seeds and focus picks: it saves the specimen
  // in every case that truncates and costs no yield, but it refuses tens of
  // signatures for each specimen saved, because most bags have plain-stack room
  // the fallback would have used anyway. Paying that much for a rare extra is
  // the worse trade, so the simple rule stands. BOTH states are pinned in
  // tests/corpse_harvest_sim.test.ts: the one where holding back would change
  // nothing, and the one where it would have saved the jackpot. The real cure
  // is a specimen reservation in the pre-gate, wider than this issue.
  let downgradeEmitted = false;
  for (const grant of signedGrants) {
    if (grant.specimen) continue;
    const payload = { signer: meta.name };
    if (
      canGrantItemInstance(
        meta.inventory,
        bagCapacity(meta.bags),
        grant.itemId,
        payload,
        grant.plainQty,
      )
    ) {
      // The whole rolled quantity, stamped (#2473): on a specimen-less family
      // the component ITSELF is the signed grant, so the signature and the
      // yield ride one call and a hardcoded count of 1 dropped the rest of the
      // roll on the floor, leaving the premium arm smaller than the plain
      // fallback right below it. The guard counts the WHOLE quantity for the
      // same reason (#2139): a same-signer stack with room for one of three
      // units must refuse rather than let the other two push a fresh slot past
      // capacity. Mergeable signer payloads stack, so the whole roll costs at
      // most ONE slot; that is one more than the single-unit grant it replaces
      // spent whenever partial merge room let that one unit land for free,
      // which is what the jackpot hold-back above accounts for.
      ctx.addItemInstance(grant.itemId, payload, meta.entityId, grant.plainQty, {
        silent: true,
        callerLogs: true,
      });
      recordHarvestYield(granted, {
        itemId: grant.itemId,
        qty: grant.plainQty,
        rarity: grant.rarity,
        kind: 'signed',
      });
    } else {
      ctx.addItem(grant.itemId, grant.plainQty, meta.entityId, {
        silent: true,
        callerLogs: true,
      });
      // Recorded 'plain', not 'signed': the ledger reports what LANDED, and
      // this arm landed an unsigned top-up. The gatherDowngrade toast below
      // still tells the player the mark was the thing that got away.
      recordHarvestYield(granted, {
        itemId: grant.itemId,
        qty: grant.plainQty,
        rarity: grant.rarity,
        kind: 'plain',
      });
      if (!downgradeEmitted) {
        downgradeEmitted = true;
        ctx.emit({
          type: 'gatherDowngrade',
          pid: meta.entityId,
          surface: 'corpse',
          lost: 'mark',
        });
      }
    }
  }
  for (const grant of signedGrants) {
    if (!grant.specimen) continue;
    const payload = { signer: meta.name };
    if (canGrantItemInstance(meta.inventory, bagCapacity(meta.bags), grant.itemId, payload)) {
      // Exactly one unit, deliberately: the specimen is a jackpot, not a
      // quantity, so it never carries the component's rolled count the way the
      // signed grant above does. The guard's count defaults to that same 1.
      ctx.addItemInstance(grant.itemId, payload, meta.entityId, 1, {
        silent: true,
        callerLogs: true,
      });
      recordHarvestYield(granted, {
        itemId: grant.itemId,
        qty: 1,
        rarity: grant.rarity,
        kind: 'specimen',
      });
      // The perfect-specimen find mark (col_perfect_specimen), on
      // the LANDED jackpot only (a truncated find got away, like a fish with
      // no bag room). Every rarity draw happened in the roll loop above, so
      // this mark write cannot perturb the pinned draw sequence.
      ctx.markVisited(meta, 'gather_event:perfect_specimen');
    } else if (!downgradeEmitted) {
      // A truncated specimen contributes NO ledger entry: nothing landed, so
      // no line claims it did. The 'find' toast is the whole feedback.
      downgradeEmitted = true;
      ctx.emit({
        type: 'gatherDowngrade',
        pid: meta.entityId,
        surface: 'corpse',
        lost: 'find',
      });
    }
  }
  // #2457: one result event for the whole command, after every grant has
  // landed, so the client prints one line per distinct granted item and plays
  // exactly one cue instead of the per-grant burst the hub used to produce.
  // The guard is the gatherResult "granted path only" rule, so the client is
  // never asked to render a cue for a no-op. Its FALSE arm is unreachable BY
  // CONSTRUCTION as of #2513, not merely absent from shipped content, and it is
  // deliberately kept as dead defensive code. The proof, because "unreachable"
  // is a claim worth being able to check: the corpse-level gate above
  // guarantees at least one tag maps to an item; the #2509 gate then guarantees
  // at least one member of the EFFECTIVE pick does, so yieldingFocusComponents
  // (that same set, filtered by that same accessor) is non-empty; the `wanted`
  // loop and the roll loop both iterate it, so at least one iteration
  // clears `if (!itemId) continue`; `harvestTierQuantity` is `indexOf + 1 >= 1`
  // and applyFocusBonus never lowers it, so that iteration's qty is >= 1; and
  // every arm of the loop plus both signedGrants loops call recordHarvestYield,
  // which pushes or merge-sums and never drops. So a spent claim always leaves
  // `granted` non-empty. That direction is what is pinned, as a property over
  // every subset of every tagged template (tests/corpse_harvest_sim.test.ts
  // "every command that spends the claim reports at least one yield"), which is
  // the live pin for the src/sim/types.ts harvestResult "yields is never empty"
  // contract now that fen_troll no longer exercises the other arm. The guard
  // stays so a future third way of landing nothing stays quiet instead of
  // cueing an empty ledger. Draws no rng and reads no world state, so it cannot
  // perturb the pinned draw sequence or the grant order.
  if (granted.length > 0) ctx.emit({ type: 'harvestResult', pid: meta.entityId, yields: granted });
  // Lifecycle decoupling, the harvested half: with the claim spent
  // the corpse owes nobody a harvest window anymore, so exhausted loot
  // collapses it on the prune's fast arm while remaining loot keeps only a
  // short owner window instead of the full decay. A pending need-greed roll
  // owns the timer outright (its window outlives both clamps), matching
  // pruneCorpseLoot's guard.
  if (!hasPendingLootRollForMob(ctx, mobId)) {
    if (!mob.loot || (mob.loot.copper <= 0 && mob.loot.items.length === 0)) {
      mob.lootable = false;
      mob.corpseTimer = Math.min(mob.corpseTimer, 4);
    } else {
      mob.corpseTimer = Math.min(mob.corpseTimer, CORPSE_INTERACT_GRACE_SECONDS);
    }
  }
}

/**
 * `harvestTierQuantity(tier)` with the player's persistent town focus (#1143)
 * yield bonus applied on top, rounded to the nearest whole item. Never
 * negative and never below the tier's unfocused quantity.
 */
function focusedHarvestQuantity(
  tier: HarvestTier,
  component: string,
  focus: FocusAllocation,
): number {
  return Math.round(applyFocusBonus(harvestTierQuantity(tier), component, focus));
}

export function pickUpObject(
  ctx: SimContext,
  objId: number,
  pid?: number,
  noticeboardDefinitions: readonly NoticeboardDef[] = [],
): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const { meta, e: p } = r;
  // Dead players (released ghosts included) cannot pick up world objects.
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return false;
  }
  const obj = ctx.entities.get(objId);
  if (obj?.kind !== 'object' || !obj.lootable) return false;
  const noticeboardDef = noticeboardDefByEntityId(noticeboardDefinitions, obj.id);
  // Preserve the historical no-op for malformed/non-pickup objects. The board
  // is the one intentional lootable object without an item payload.
  if (!noticeboardDef && !obj.objectItemId) return false;
  const interactionRange = noticeboardDef?.interactionRadius ?? INTERACT_RANGE;
  if (dist2d(p.pos, obj.pos) > interactionRange) {
    ctx.error(meta.entityId, 'Too far away.');
    return false;
  }
  if (noticeboardDef) {
    ctx.emit({
      type: 'noticeboard',
      noticeboardId: noticeboardDef.templateId,
      state: 'empty',
      pid: meta.entityId,
    });
    return true;
  }
  const objectItemId = obj.objectItemId;
  if (!objectItemId) return false;
  if (interactSoulwell(ctx, obj, meta.entityId)) return true;
  const beforeCastingAbility = p.castingAbility;
  const beforeChanneling = p.channeling;
  if (tryStartNythraxisWardChannel(ctx, obj, p)) {
    return (
      p.castingAbility === 'nythraxis_ward_channel' &&
      (beforeCastingAbility !== p.castingAbility || beforeChanneling !== p.channeling)
    );
  }
  const beforeRelicLootable = obj.lootable;
  const beforeRelicNextId = ctx.nextId;
  if (activateNythraxisRelic(ctx, obj, meta)) {
    return obj.lootable !== beforeRelicLootable || ctx.nextId !== beforeRelicNextId;
  }
  // Murloc huts (q_deepfen_purge) are torched with a thrown firebottle, not a
  // plain click: route them to the firebottle handler (which does its own
  // gating, cooldown, and objective credit) so a bare click never burns one.
  if (objectItemId === HUT_OBJECT_ID) {
    return tryBurnHut(ctx, obj, p, meta);
  }
  const beforeQuestProgress = meta.counters.questProgress;
  const beforeQuestNextId = ctx.nextId;
  if (interactObjectForQuests(ctx, obj, meta)) {
    return meta.counters.questProgress !== beforeQuestProgress || ctx.nextId !== beforeQuestNextId;
  }
  const def = ITEMS[objectItemId];
  if (def?.questId) {
    const qp = meta.questLog.get(def.questId);
    if (!qp || (qp.state !== 'active' && qp.state !== 'ready')) {
      ctx.error(meta.entityId, def.pickupDeny ?? `You cannot take the ${def.name} yet.`);
      return false;
    }
    const quest = QUESTS[def.questId];
    const objIdx = quest.objectives.findIndex(
      (o) => o.type === 'collect' && o.itemId === objectItemId,
    );
    if (objIdx < 0) {
      ctx.error(meta.entityId, def.pickupEnough ?? `${def.name} offers nothing more.`);
      return false;
    }
    if (
      objIdx >= 0 &&
      ctx.countItem(objectItemId, meta.entityId) >= quest.objectives[objIdx].count
    ) {
      ctx.error(meta.entityId, def.pickupEnough ?? 'You have enough of those.');
      return false;
    }
  }
  if (!ctx.canAddItem(objectItemId, 1, meta.entityId)) {
    ctx.error(meta.entityId, 'Your bags are full.');
    return false;
  }
  ctx.addItem(objectItemId, 1, meta.entityId);
  obj.lootable = false;
  obj.respawnTimer = OBJECT_RESPAWN;
  // Success only: a capacity-refused attempt returned above and never counts.
  ctx.bumpDeedStat(meta, 'groundObjectsLooted', 1);
  return true;
}

export function interact(
  ctx: SimContext,
  pid?: number,
  noticeboardDefinitions: readonly NoticeboardDef[] = [],
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const p = r.e;
  if (p.dead) {
    // A dead player or released spirit cannot interact with the world: no
    // looting, object pickup, mailbox, or quest talk. The one exception is the
    // Spirit Healer (talking to the angel is how a ghost reaches the healer
    // resurrection), so route a nearby angel through the normal quest-NPC talk
    // and refuse everything else. A ghost still re-enters its instance via the
    // proximity door trigger (updateDoorTriggers), which never comes through here.
    let bestHealer: Entity | null = null;
    let bestHealerD2 = INTERACT_RANGE * INTERACT_RANGE;
    ctx.grid.forEachInRadius(p.pos.x, p.pos.z, INTERACT_RANGE, (e, d2) => {
      if (e.kind === 'npc' && e.templateId === SPIRIT_HEALER_NPC_ID && d2 < bestHealerD2) {
        bestHealer = e;
        bestHealerD2 = d2;
      }
    });
    // re-read through a wider type: TS cannot see the closure assignment above
    const healer = bestHealer as Entity | null;
    if (healer) {
      ctx.talkToNpc(healer.id, p.id);
      return;
    }
    ctx.error(r.meta.entityId, "You can't do that while dead.");
    return;
  }
  if (p.targetId !== null) {
    const target = ctx.entities.get(p.targetId);
    if (target && dist2d(p.pos, target.pos) <= INTERACT_RANGE + 2) {
      if (target.kind === 'mob' && target.lootable) {
        const availability = corpseInteractionAvailability(ctx, target, p.id, true);
        if (availability.canInteract) {
          // Unified press, targeted arm: same composition as the
          // proximity-scan arm below (harvest while the corpse still owes its
          // unclaimed half, omitted components = the town focus default, then
          // loot; separate calls so neither refusal blocks the other).
          if (availability.harvestable) {
            harvestCorpse(ctx, target.id, undefined, p.id);
          }
          lootCorpse(ctx, target.id, p.id);
          return;
        }
      }
      if (target.kind === 'object' && target.lootable) {
        if (target.templateId === 'dungeon_door' && target.dungeonId) {
          ctx.enterDungeon(target.dungeonId, p.id);
          return;
        }
        if (target.templateId === 'dungeon_exit') {
          ctx.leaveDungeon(p.id);
          return;
        }
        if (target.templateId === 'rift_portal' && target.riftSeed !== undefined) {
          ctx.enterRift(target.riftSeed, target.riftBaseLevel ?? p.level, p.id, undefined, target);
          return;
        }
        if (target.templateId === 'rift_exit') {
          ctx.leaveRift(p.id);
          return;
        }
        if (target.templateId === 'rift_locked_chest') {
          // Offer the ante selector; the pick itself runs via lockpick_engage.
          // Rate-limited per player so repeated F-key spam does not re-open the UI.
          if (ctx.time >= (p.riftLockpickOfferAt ?? -Infinity) + LOCKPICK_OFFER_COOLDOWN) {
            p.riftLockpickOfferAt = ctx.time;
            ctx.emit({ type: 'lockpickOffer', objectId: target.id, bountiful: false, pid: p.id });
          }
          return;
        }
        if (target.templateId === 'rift_treasure') {
          ctx.riftOpenTreasure(target.id, p.id);
          return;
        }
        if (target.templateId === 'mailbox') {
          ctx.emit({ type: 'mailbox', pid: p.id });
          return;
        }
        if (tryStartNythraxisWardChannel(ctx, target, p)) return;
        pickUpObject(ctx, target.id, p.id, noticeboardDefinitions);
        return;
      }
      if (target.kind === 'npc' && ctx.bankerIds.includes(target.id)) {
        // Opening the bank window counts as banker business for the NPC ledger.
        deedsMod.onBankerBusinessForDeeds(ctx, r.meta, target.templateId);
        ctx.emit({ type: 'bank', pid: p.id });
        return;
      }
      if (ctx.isQuestInteractionEntity(target)) {
        ctx.talkToNpc(target.id, p.id);
        return;
      }
    }
  }
  // Escort start: standing near an idle escortee whose quest this player has
  // active begins the walk (escort.ts picks the nearest eligible one).
  if (tryStartEscort(ctx, p, r.meta)) return;
  let bestCorpse: Entity | null = null;
  let bestCorpseD2 = INTERACT_RANGE * INTERACT_RANGE;
  let bestObj: Entity | null = null;
  let bestObjD2 = INTERACT_RANGE * INTERACT_RANGE;
  let bestQuestEntity: Entity | null = null;
  let bestQuestD2 = INTERACT_RANGE * INTERACT_RANGE;
  ctx.grid.forEachInRadius(p.pos.x, p.pos.z, INTERACT_RANGE, (e, d2) => {
    if (
      e.kind === 'mob' &&
      e.lootable &&
      corpseInteractionAvailability(ctx, e, p.id, true).canInteract &&
      d2 < bestCorpseD2
    ) {
      bestCorpse = e;
      bestCorpseD2 = d2;
    }
    if (e.kind === 'object' && e.lootable && d2 < bestObjD2) {
      const noticeboardDef = noticeboardDefByEntityId(noticeboardDefinitions, e.id);
      if (!noticeboardDef || d2 <= noticeboardDef.interactionRadius ** 2) {
        bestObj = e;
        bestObjD2 = d2;
      }
    }
    if (ctx.isQuestInteractionEntity(e) && d2 < bestQuestD2) {
      bestQuestEntity = e;
      bestQuestD2 = d2;
    }
  });
  // re-read through wider types: TS cannot see the closure assignments above
  const corpse = bestCorpse as Entity | null;
  const obj = bestObj as Entity | null;
  const questEntity = bestQuestEntity as Entity | null;
  if (corpse) {
    // Unified press: one interact both harvests (while the corpse
    // still owes its unclaimed harvest half; omitted components = the town
    // focus default) and loots. Two separate calls on purpose: a harvest
    // refusal never blocks the loot half, and vice versa.
    if (corpseInteractionAvailability(ctx, corpse, p.id, true).harvestable) {
      harvestCorpse(ctx, corpse.id, undefined, p.id);
    }
    lootCorpse(ctx, corpse.id, p.id);
    return;
  }
  if (obj) {
    if (obj.templateId === 'dungeon_door' && obj.dungeonId) {
      ctx.enterDungeon(obj.dungeonId, p.id);
      return;
    }
    if (obj.templateId === 'dungeon_exit') {
      ctx.leaveDungeon(p.id);
      return;
    }
    if (obj.templateId === 'rift_portal' && obj.riftSeed !== undefined) {
      ctx.enterRift(obj.riftSeed, obj.riftBaseLevel ?? p.level, p.id, undefined, obj);
      return;
    }
    if (obj.templateId === 'rift_exit') {
      ctx.leaveRift(p.id);
      return;
    }
    if (obj.templateId === 'rift_locked_chest') {
      if (ctx.time >= (p.riftLockpickOfferAt ?? -Infinity) + LOCKPICK_OFFER_COOLDOWN) {
        p.riftLockpickOfferAt = ctx.time;
        ctx.emit({ type: 'lockpickOffer', objectId: obj.id, bountiful: false, pid: p.id });
      }
      return;
    }
    if (obj.templateId === 'rift_treasure') {
      ctx.riftOpenTreasure(obj.id, p.id);
      return;
    }
    if (obj.templateId === 'mailbox') {
      ctx.emit({ type: 'mailbox', pid: p.id });
      return;
    }
    if (tryStartNythraxisWardChannel(ctx, obj, p)) return;
    pickUpObject(ctx, obj.id, p.id, noticeboardDefinitions);
    return;
  }
  if (questEntity && ctx.bankerIds.includes(questEntity.id)) {
    // Opening the bank window counts as banker business for the NPC ledger.
    deedsMod.onBankerBusinessForDeeds(ctx, r.meta, questEntity.templateId);
    ctx.emit({ type: 'bank', pid: p.id });
    return;
  }
  if (questEntity) ctx.talkToNpc(questEntity.id, p.id);
}
