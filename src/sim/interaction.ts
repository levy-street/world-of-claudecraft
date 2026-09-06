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
// and the encounter interaction hooks from encounters/nythraxis.ts and
// ignivar_raid_lore.ts; they are imported, never edited.
//
// Move-not-rewrite: statements, branches, short-circuit and iteration order are
// verbatim. The immutability waiver applies: the in-place loot-slot (s.count /
// s.personalFor), corpse targetId, and ground-object (lootable / respawnTimer)
// mutations move as-is. This region draws NO rng.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts).

import { NOTICEBOARD_LISTINGS } from './content/noticeboard_listings';
import { type NoticeboardDef, noticeboardDefByEntityId } from './content/noticeboards';
import { corpseInteractionAvailability } from './corpse_interaction';
import { ITEMS, MOBS, QUESTS, SPIRIT_HEALER_NPC_ID } from './data';
import * as deedsMod from './deeds';
import {
  activateNythraxisRelic,
  interactObjectForQuests,
  tryStartNythraxisWardChannel,
} from './encounters/nythraxis';
import { tryStartEscort } from './escort';
import { interactIgnivarRaidLore } from './ignivar_raid_lore';
import { isInRaidInstance } from './instances/dungeons';
import { FERRY_BELL_OBJECT_ID, tryRingFerryBell } from './interactions/ferry_bell';
import { HUT_OBJECT_ID, tryBurnHut } from './interactions/firebottle_hut';
import { hasSharedLootRights as computeSharedLootRights, lootHasGoneFfa } from './loot/loot_ffa';
import {
  awardSharedLootItem,
  distributeLootCopper,
  grantAwardedLootItem,
  killSnapshotEligibility,
  lootSlotVisibleTo,
  pruneCorpseLoot,
} from './loot/loot_roll';
import { startCorpseHarvest } from './professions/corpse_harvest_session';
import { isQuestGatedGroundObjectHidden } from './quest_gated_entity';
import { corpseHasDecayed } from './respawn_policy';
import type { SimContext } from './sim_context';
import { interactSoulwell } from './soulwell';
import { creditSignpostRead } from './tutorial/signpost_read';
import {
  cloneItemInstancePayload,
  dist2d,
  type Entity,
  INTERACT_RANGE,
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
  if (!mob?.lootable || !mob.loot || corpseHasDecayed(mob.dead, mob.corpseTimer)) return false;
  // owner-lock lapses LOOT_FFA_DELAY after the corpse became lootable: then anyone may
  // loot. The flag is threaded into distribution too, so an outside looter keeps what
  // they take instead of it being split by the absent tapping party's strategies.
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
    distributeLootCopper(ctx, mob, meta, ffaUnlocked);
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
          // Through the shared award grant, NOT a bare addItem: an openToAll
          // slot is how an everyone-passed (or winner-offline) roll returns a
          // drop to the corpse, and a soulbound item picked up from it must
          // carry the same bind-on-pickup party trade window a roll win
          // would; a bare add minted a permanently untradeable copy from the
          // most common raid outcome (everyone passes to sort it out later).
          grantAwardedLootItem(ctx, s.itemId, meta.entityId, killSnapshotEligibility(ctx, mob));
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
      } else if (awardSharedLootItem(ctx, s.itemId, mob, meta, ffaUnlocked)) {
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
  if (!mob?.lootable || !mob.loot || corpseHasDecayed(mob.dead, mob.corpseTimer)) return;
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
 * (skinning/salvage components), independent of the loot table above.
 * Intentional Gathering PR3: this is now a thin public entry point over the
 * timed HARVEST_CAST_SECONDS cast (`professions/corpse_harvest_session.ts`
 * `startCorpseHarvest`), which owns admission, reservation, the per-tick
 * recheck, and completion. There is no instant grant and no per-call
 * `components` override here anymore: what gets extracted resolves entirely
 * from the caller's stored `harvestPreference` at admission time. Returns
 * whether the cast started.
 */
export function harvestCorpse(ctx: SimContext, mobId: number, pid?: number): boolean {
  return startCorpseHarvest(ctx, mobId, pid);
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
    // The tutorial island's signpost lesson rides the same click as the
    // notice feedback (tutorial/signpost_read.ts; a no-op off-quest and on
    // every other board).
    creditSignpostRead(ctx, meta, noticeboardDef.id);
    const listings = NOTICEBOARD_LISTINGS[noticeboardDef.id] ?? [];
    if (listings.length > 0) {
      ctx.emit({
        type: 'noticeboard',
        noticeboardId: noticeboardDef.templateId,
        state: 'listings',
        listings,
        pid: meta.entityId,
      });
    } else {
      ctx.emit({
        type: 'noticeboard',
        noticeboardId: noticeboardDef.templateId,
        state: 'empty',
        pid: meta.entityId,
      });
    }
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
  // The Proving Shore ferry bells travel, never loot: route the click to the
  // ferry handler before the pickup path so ringing always sails.
  if (objectItemId === FERRY_BELL_OBJECT_ID) {
    return tryRingFerryBell(ctx, obj, p, meta);
  }
  const ignivarLore = interactIgnivarRaidLore(ctx, obj, meta);
  if (!ignivarLore.allowQuestCredit) return ignivarLore.handled;
  const beforeQuestProgress = meta.counters.questProgress;
  const beforeQuestNextId = ctx.nextId;
  if (interactObjectForQuests(ctx, obj, meta)) {
    return (
      ignivarLore.handled ||
      meta.counters.questProgress !== beforeQuestProgress ||
      ctx.nextId !== beforeQuestNextId
    );
  }
  if (ignivarLore.handled) return true;
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
        if (availability.hasLoot) {
          // Ordinary interaction never spends the independent harvest claim.
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
      corpseInteractionAvailability(ctx, e, p.id, true).hasLoot &&
      d2 < bestCorpseD2
    ) {
      bestCorpse = e;
      bestCorpseD2 = d2;
    }
    if (
      e.kind === 'object' &&
      e.lootable &&
      d2 < bestObjD2 &&
      // A quest collectable this player is not on the quest for is not in their
      // world (the client withholds its view entirely), so the interact key must
      // not select it either: picking it would refuse below, and worse, a shiny
      // nobody can see would outrank a visible NPC or node standing further away.
      !isQuestGatedGroundObjectHidden(e, r.meta.questLog)
    ) {
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
    // Harvesting requires its own command, including after ordinary loot is gone.
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
