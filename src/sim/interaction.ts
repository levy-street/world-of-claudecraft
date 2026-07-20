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

import { bagCapacity, fitsAll } from './bags';
import { HARVEST_COMPONENT_SPECIMENS } from './content/professions';
import { ITEMS, MOBS, QUESTS, SPIRIT_HEALER_NPC_ID } from './data';
import * as deedsMod from './deeds';
import {
  activateNythraxisRelic,
  interactObjectForQuests,
  tryStartNythraxisWardChannel,
} from './encounters/nythraxis';
import { isInRaidInstance } from './instances/dungeons';
import { hasSharedLootRights as computeSharedLootRights, lootHasGoneFfa } from './loot/loot_ffa';
import {
  awardSharedLootItem,
  distributeLootCopper,
  lootSlotVisibleTo,
  pruneCorpseLoot,
} from './loot/loot_roll';
import { applyFocusBonus, applyFocusTierBonus, type FocusAllocation } from './professions/focus';
import {
  effectiveFocusComponents,
  HARVEST_COMPONENT_ITEMS,
  type HarvestTier,
  harvestTierQuantity,
  isHarvestableCorpse,
  isSignableMaterialRarity,
  resolveCorpseFocusHarvest,
  resolveCorpseHarvest,
  rollCorpseMaterialRarity,
} from './professions/gathering';
import type { SimContext } from './sim_context';
import { dist2d, type Entity, INTERACT_RANGE, type InvSlot, OBJECT_RESPAWN } from './types';
import { markWorldBossLooted } from './world_boss';

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
        ctx.addItem(s.itemId, 1, meta.entityId);
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
      ctx.addItem(s.itemId, 1, meta.entityId);
      s.personalFor = s.personalFor.filter((id) => id !== meta.entityId);
      tookPersonal = true;
      didLoot = true;
      continue;
    }
    if (!rights.shared) continue;
    while (s.count > 0 && awardSharedLootItem(ctx, s.itemId, mob, meta)) {
      s.count--;
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
 * component(s) to extract. Omitted, empty, or covering every tagged component
 * all spread the harvest across every tag (the #1141 behavior); picking fewer
 * concentrates the effort for a higher tier per component, per
 * resolveCorpseFocusHarvest in professions/gathering.ts.
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
  if (!mob || mob.kind !== 'mob' || !mob.dead) return;
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
  const wanted: InvSlot[] = [];
  for (const component of effectiveFocusComponents(componentTags ?? [], components ?? [])) {
    const wantedItemId = HARVEST_COMPONENT_ITEMS[component];
    if (!wantedItemId) continue;
    const maxQty = focusedHarvestQuantity('legendary', component, meta.townFocus);
    const existing = wanted.find((w) => w.itemId === wantedItemId);
    if (existing) existing.count += maxQty;
    else wanted.push({ itemId: wantedItemId, count: maxQty });
  }
  if (wanted.length > 0 && !fitsAll(meta.inventory, bagCapacity(meta.bags), wanted)) {
    ctx.error(meta.entityId, 'Your bags are full.');
    return;
  }
  mob.harvestClaimedBy = claim.claimedBy;
  // #1145: a rare-or-better monster material is stamped with the harvester's
  // name (a non-fungible instance slot); anything below that rarity stays a
  // plain fungible grant, same as before this issue. One rarity roll per
  // yielded component, same one-draw-per-yield convention as
  // resolveCorpseFocusHarvest's own tier roll.
  const yields = resolveCorpseFocusHarvest(componentTags ?? [], components ?? [], ctx.rng);
  // #1145 + Phase 10: one rarity roll per yielded component, independent of
  // the component's tier roll/bonus. For a family with a Pristine specimen
  // (HARVEST_COMPONENT_SPECIMENS), a rare-or-better roll grants the specimen
  // as the SIGNED jackpot IN ADDITION to the plain component; the regular
  // component always grants plain. A family without a specimen keeps the
  // pre-Phase-10 behavior: the component itself grants signed at rare+.
  //
  // Grant ORDER is load-bearing: the pre-gate above reserves room for the
  // plain component stacks ONLY, so every plain yield must land before any
  // signed instance takes a slot (a jackpot granted mid-loop could consume
  // the slot reserved for a LATER family's plain stack and push the uncapped
  // plain grant past capacity). The rarity rolls stay in this first loop, in
  // yield order, so the draw sequence is byte-identical to the single-pass
  // shape (pinned by the parity goldens); only the grants are reordered.
  const signedGrants: { itemId: string; specimen: boolean; plainQty: number }[] = [];
  for (const y of yields) {
    const itemId = HARVEST_COMPONENT_ITEMS[y.component];
    if (!itemId) continue;
    // #1143: the player's persistent town focus adds a bonus on top of the
    // #1142 roll for a focused component; an unfocused component's tier is
    // exactly the roll above, untouched. The same per-point yield bonus is
    // applied to the tier's base quantity, so focus below the 5-point
    // tier-shift threshold still does something.
    const tier = applyFocusTierBonus(y.tier, y.component, meta.townFocus);
    const qty = focusedHarvestQuantity(tier, y.component, meta.townFocus);
    const rarity = rollCorpseMaterialRarity(ctx.rng);
    const specimenId = isSignableMaterialRarity(rarity)
      ? HARVEST_COMPONENT_SPECIMENS[y.component]
      : undefined;
    if (specimenId !== undefined) {
      ctx.addItem(itemId, qty, meta.entityId);
      signedGrants.push({ itemId: specimenId, specimen: true, plainQty: 0 });
    } else if (isSignableMaterialRarity(rarity)) {
      signedGrants.push({ itemId, specimen: false, plainQty: qty });
    } else {
      ctx.addItem(itemId, qty, meta.entityId);
    }
  }
  // Signed-family components first: their plain FALLBACK still owns
  // pre-gate-reserved stack room, so they outrank the specimens, which are
  // pure extras. Signed instances never merge into stacks (bags.ts
  // addStacked, #1165): each needs a genuinely free slot, and with none the
  // signed-family grant falls back to the plain fungible top-up (the
  // signature truncates, the yield does not) while a specimen truncates
  // outright, the same truncation contract harvestNode's signed grants
  // follow.
  for (const grant of signedGrants) {
    if (grant.specimen) continue;
    if (meta.inventory.length < bagCapacity(meta.bags)) {
      ctx.addItemInstance(grant.itemId, { signer: meta.name }, meta.entityId);
    } else {
      ctx.addItem(grant.itemId, grant.plainQty, meta.entityId);
    }
  }
  for (const grant of signedGrants) {
    if (!grant.specimen) continue;
    if (meta.inventory.length < bagCapacity(meta.bags)) {
      ctx.addItemInstance(grant.itemId, { signer: meta.name }, meta.entityId);
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

export function pickUpObject(ctx: SimContext, objId: number, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const { meta, e: p } = r;
  // Dead players (released ghosts included) cannot pick up world objects.
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return false;
  }
  const obj = ctx.entities.get(objId);
  if (obj?.kind !== 'object' || !obj.lootable || !obj.objectItemId) return false;
  if (dist2d(p.pos, obj.pos) > INTERACT_RANGE) {
    ctx.error(meta.entityId, 'Too far away.');
    return false;
  }
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
  const beforeQuestProgress = meta.counters.questProgress;
  const beforeQuestNextId = ctx.nextId;
  if (interactObjectForQuests(ctx, obj, meta)) {
    return meta.counters.questProgress !== beforeQuestProgress || ctx.nextId !== beforeQuestNextId;
  }
  const def = ITEMS[obj.objectItemId];
  if (def?.questId) {
    const qp = meta.questLog.get(def.questId);
    if (!qp || (qp.state !== 'active' && qp.state !== 'ready')) {
      ctx.error(meta.entityId, def.pickupDeny ?? `You cannot take the ${def.name} yet.`);
      return false;
    }
    const quest = QUESTS[def.questId];
    const objIdx = quest.objectives.findIndex(
      (o) => o.type === 'collect' && o.itemId === obj.objectItemId,
    );
    if (objIdx < 0) {
      ctx.error(meta.entityId, def.pickupEnough ?? `${def.name} offers nothing more.`);
      return false;
    }
    if (
      objIdx >= 0 &&
      ctx.countItem(obj.objectItemId, meta.entityId) >= quest.objectives[objIdx].count
    ) {
      ctx.error(meta.entityId, def.pickupEnough ?? 'You have enough of those.');
      return false;
    }
  }
  if (!ctx.canAddItem(obj.objectItemId, 1, meta.entityId)) {
    ctx.error(meta.entityId, 'Your bags are full.');
    return false;
  }
  ctx.addItem(obj.objectItemId, 1, meta.entityId);
  obj.lootable = false;
  obj.respawnTimer = OBJECT_RESPAWN;
  // Success only: a capacity-refused attempt returned above and never counts.
  ctx.bumpDeedStat(meta, 'groundObjectsLooted', 1);
  return true;
}

export function interact(ctx: SimContext, pid?: number): void {
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
        lootCorpse(ctx, target.id, p.id);
        return;
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
        if (target.templateId === 'mailbox') {
          ctx.emit({ type: 'mailbox', pid: p.id });
          return;
        }
        if (tryStartNythraxisWardChannel(ctx, target, p)) return;
        pickUpObject(ctx, target.id, p.id);
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
  let bestCorpse: Entity | null = null;
  let bestCorpseD2 = INTERACT_RANGE * INTERACT_RANGE;
  let bestObj: Entity | null = null;
  let bestObjD2 = INTERACT_RANGE * INTERACT_RANGE;
  let bestQuestEntity: Entity | null = null;
  let bestQuestD2 = INTERACT_RANGE * INTERACT_RANGE;
  ctx.grid.forEachInRadius(p.pos.x, p.pos.z, INTERACT_RANGE, (e, d2) => {
    if (e.kind === 'mob' && e.lootable && d2 < bestCorpseD2) {
      bestCorpse = e;
      bestCorpseD2 = d2;
    }
    if (e.kind === 'object' && e.lootable && d2 < bestObjD2) {
      bestObj = e;
      bestObjD2 = d2;
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
    if (obj.templateId === 'mailbox') {
      ctx.emit({ type: 'mailbox', pid: p.id });
      return;
    }
    if (tryStartNythraxisWardChannel(ctx, obj, p)) return;
    pickUpObject(ctx, obj.id, p.id);
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
