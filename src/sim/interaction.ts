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

import { ITEMS, MOBS, QUESTS, SPIRIT_HEALER_NPC_ID } from './data';
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
import { harvestItemFor, isHarvestableCorpse, resolveCorpseHarvest } from './professions/gathering';
import type { SimContext } from './sim_context';
import { dist2d, type Entity, INTERACT_RANGE, OBJECT_RESPAWN } from './types';
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
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  // Dead players (released ghosts included) cannot loot; the same rejection the
  // item family uses (src/sim/items.ts). The walk-by autoLootForParty path never
  // reaches this: it silently drops a dead trigger before delegating here.
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  const mob = ctx.entities.get(mobId);
  if (!mob?.lootable || !mob.loot) return;
  // owner-lock lapses LOOT_FFA_DELAY after the corpse became lootable: then anyone may loot.
  const ffaUnlocked = honorFfa && lootHasGoneFfa(mob.lootFfaTimer);
  const rights = corpseLootRights(ctx, mob, meta.entityId, ffaUnlocked);
  if (!rights.shared && !rights.personal && !rights.open) {
    ctx.error(meta.entityId, "You don't have permission to loot that.");
    return;
  }
  if (dist2d(p.pos, mob.pos) > INTERACT_RANGE) {
    ctx.error(meta.entityId, 'Too far away.');
    return;
  }
  if (rights.shared) distributeLootCopper(ctx, mob, meta);
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
      continue;
    }
    if (!rights.shared) continue;
    while (s.count > 0 && awardSharedLootItem(ctx, s.itemId, mob, meta)) {
      s.count--;
    }
    if (s.count > 0) bagsFull = true;
  }
  if (bagsFull && !quiet) ctx.error(meta.entityId, 'Your bags are full.');
  // World-boss daily lockout is consumed by LOOTING, not by the kill: taking any
  // personal slot from the boss's corpse burns today's roll (rollWorldBossLoot
  // checks eligibility when the next boss dies). A contributor who never reaches
  // the corpse keeps their daily and can try again at the next spawn.
  if (tookPersonal && MOBS[mob.templateId]?.worldBoss) {
    markWorldBossLooted(meta, mob.templateId, ctx.utcDay);
  }
  pruneCorpseLoot(ctx, mob);
  if (p.targetId === mobId) p.targetId = null;
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
 */
export function harvestCorpse(ctx: SimContext, mobId: number, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
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
  mob.harvestClaimedBy = claim.claimedBy;
  const itemId = harvestItemFor(componentTags);
  if (itemId) ctx.addItem(itemId, 1, meta.entityId);
}

export function pickUpObject(ctx: SimContext, objId: number, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  // Dead players (released ghosts included) cannot pick up world objects.
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  const obj = ctx.entities.get(objId);
  if (obj?.kind !== 'object' || !obj.lootable || !obj.objectItemId) return;
  if (dist2d(p.pos, obj.pos) > INTERACT_RANGE) {
    ctx.error(meta.entityId, 'Too far away.');
    return;
  }
  if (tryStartNythraxisWardChannel(ctx, obj, p)) return;
  if (activateNythraxisRelic(ctx, obj, meta)) return;
  if (interactObjectForQuests(ctx, obj, meta)) return;
  const def = ITEMS[obj.objectItemId];
  if (def?.questId) {
    const qp = meta.questLog.get(def.questId);
    if (!qp || (qp.state !== 'active' && qp.state !== 'ready')) {
      ctx.error(meta.entityId, def.pickupDeny ?? `You cannot take the ${def.name} yet.`);
      return;
    }
    const quest = QUESTS[def.questId];
    const objIdx = quest.objectives.findIndex(
      (o) => o.type === 'collect' && o.itemId === obj.objectItemId,
    );
    if (objIdx < 0) {
      ctx.error(meta.entityId, def.pickupEnough ?? `${def.name} offers nothing more.`);
      return;
    }
    if (
      objIdx >= 0 &&
      ctx.countItem(obj.objectItemId, meta.entityId) >= quest.objectives[objIdx].count
    ) {
      ctx.error(meta.entityId, def.pickupEnough ?? 'You have enough of those.');
      return;
    }
  }
  if (!ctx.canAddItem(obj.objectItemId, 1, meta.entityId)) {
    ctx.error(meta.entityId, 'Your bags are full.');
    return;
  }
  ctx.addItem(obj.objectItemId, 1, meta.entityId);
  obj.lootable = false;
  obj.respawnTimer = OBJECT_RESPAWN;
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
  if (questEntity) ctx.talkToNpc(questEntity.id, p.id);
}
