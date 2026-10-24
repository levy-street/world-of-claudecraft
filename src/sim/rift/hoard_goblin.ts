// The Coinsack Scurrier: a goblin that sometimes slips into a Buried Hoard with a
// sack of stolen gold on its back. It never fights. It runs from whoever comes
// near, and the first blow starts a bar it cannot be talked out of: when the bar
// runs out it opens a hole and is gone with the gold. Kill it first and everyone
// in the room is paid what the room's own chest pays. Left alone, it leaves on
// its own after a while.
//
// The goblin is NOT one of the room's mobs (inst.mobIds): it never gates the
// clear, never holds the room in combat, and the late-joiner rescale never
// touches it. Its state is inst.hoardGoblin; floor teardown drops it.
//
// Determinism: the spawn roll is drawn from ctx.rng for every hoard room (never
// for an ordinary rift), and a spawned goblin then draws its spot, so a forced
// dev spawn draws one more than a failed roll. The payout draws one pair per
// player in the room, in room order, paid or not. Movement reads no rng.

import { CASKET_MATERIAL_POOL, treasureCasketCopper } from '../clue_casket';
import {
  VAULT_GUEST_PAYOUTS_PER_CYCLE,
  VAULT_PAYOUTS,
  vaultHealthFactor,
} from '../content/treasure_maps';
import { MOBS, RIFT_REGION_HALF_X, RIFT_REGION_HALF_Z, riftInstanceOrigin } from '../data';
import { createMob } from '../entity';
import { formatMoney } from '../format_money';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { DT, type Entity, RUN_SPEED } from '../types';
import { riftFx } from './fx';
import { HOARD_GOBLIN_ESCAPE_CAST } from './hoard_control_cast_ids';
import type { RiftInstance } from './types';

export const HOARD_GOBLIN_TEMPLATE_ID = 'hoard_coinsack_scurrier';
/** Odds a hoard room holds one. */
export const HOARD_GOBLIN_CHANCE = 0.15;
/** Seconds from the first blow until it escapes with the gold. */
export const HOARD_GOBLIN_ESCAPE_SEC = 20;
/** Seconds it lingers untouched before it leaves on its own. */
export const HOARD_GOBLIN_IDLE_SEC = 120;
/** Health per level before the head-count factor: at level 20 a lone reader
 *  faces 1200 (about 15 seconds of steady damage), a full party 3000. */
export const HOARD_GOBLIN_HEALTH_PER_LEVEL = 150;
/** Share of the player's run speed it runs at: a chaser always closes on it. */
export const HOARD_GOBLIN_SPEED_SHARE = 0.8;
/** It bolts from anyone closer than this, and always once it is hurt. */
export const HOARD_GOBLIN_ALARM_YARDS = 18;
/** Odds each paid player also finds one of the casket's gathered materials. */
export const HOARD_GOBLIN_MATERIAL_CHANCE = 0.25;
/** A bolt target is re-chosen at most this often, and on arrival. */
const REPICK_SEC = 1;

/** The copper one player takes off the goblin: the room's own chest share. */
export function hoardGoblinCopper(
  level: number,
  rarity: NonNullable<RiftInstance['vault']>['rarity'],
): number {
  return Math.round(treasureCasketCopper(level) * VAULT_PAYOUTS[rarity].copperMult);
}

/** Its maximum health for a level and the head count the hoard was scaled for. */
export function hoardGoblinHealth(level: number, headCount: number): number {
  return Math.round(HOARD_GOBLIN_HEALTH_PER_LEVEL * level * vaultHealthFactor(headCount));
}

/** Roll for a goblin in a freshly spawned hoard room (spawnRiftFloor). The roll
 *  is drawn for every hoard, forced or not; an ordinary rift draws nothing.
 *  `spots` are floor-local clear points (the room's trash spots). */
export function maybeSpawnHoardGoblin(
  ctx: SimContext,
  inst: RiftInstance,
  spots: ReadonlyArray<{ x: number; z: number; level: number }>,
): void {
  delete inst.hoardGoblin;
  const vault = inst.vault;
  if (!vault) return;
  const rolled = ctx.rng.chance(HOARD_GOBLIN_CHANCE);
  if (!rolled && !vault.forceGoblin) return;
  if (spots.length === 0) return;
  const template = MOBS[HOARD_GOBLIN_TEMPLATE_ID];
  if (!template) return;
  const spot = spots[ctx.rng.int(0, spots.length - 1)];
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const level = Math.min(spot.level, vault.level);
  // A step off the pack's own spot, so it is not born inside one of them.
  const mob = createMob(
    ctx.nextId++,
    template,
    level,
    ctx.groundPos(origin.x + spot.x + 2, origin.z + spot.z),
  );
  mob.maxHp = hoardGoblinHealth(level, vault.headCount);
  mob.hp = mob.maxHp;
  mob.facing = Math.PI;
  mob.prevFacing = mob.facing;
  ctx.addEntity(mob);
  inst.hoardGoblin = {
    id: mob.id,
    spawnedAt: ctx.time,
    escapeAt: null,
    points: spots.map((s) => ({ x: s.x, z: s.z })),
    goal: -1,
    repickIn: 0,
    settled: false,
  };
}

/** Warn a player climbing into a room whose goblin is still there to catch
 *  (rift/runs.ts enterRift, after the arrival line). Nothing for a goblin
 *  already killed or gone, for one whose escape bar is already running (its
 *  cast bar says it all, and "your first hit starts it" would be wrong), or
 *  for a ghost on a corpse run. `idleSec` is the time it has LEFT untouched. */
export function announceHoardGoblin(ctx: SimContext, inst: RiftInstance, pid: number): void {
  const state = inst.hoardGoblin;
  if (!state || state.settled || state.escapeAt !== null) return;
  const mob = ctx.entities.get(state.id);
  if (!mob || mob.dead || ctx.entities.get(pid)?.dead) return;
  ctx.emit({
    type: 'hoardGoblinSighted',
    escapeSec: HOARD_GOBLIN_ESCAPE_SEC,
    idleSec: Math.max(0, state.spawnedAt + HOARD_GOBLIN_IDLE_SEC - ctx.time),
    pid,
  });
}

export function isHoardGoblin(mob: Entity): boolean {
  return mob.templateId === HOARD_GOBLIN_TEMPLATE_ID;
}

/** Mob AI arm (mob/locomotion.ts updateMob): the goblin never aggroes, chases or
 *  swings. It stands until someone comes near or hurts it, then runs to the
 *  room spot furthest from every living player, re-choosing as they close. */
export function updateHoardGoblinMotion(ctx: SimContext, mob: Entity): void {
  mob.aggroTargetId = null;
  mob.swingTimer = Math.max(mob.swingTimer, 1);
  const inst = ctx.riftInstances.find((i) => i.hoardGoblin?.id === mob.id);
  const state = inst?.hoardGoblin;
  if (!inst || !state || state.settled) return;
  if (ctx.isStunned(mob) || ctx.isRooted(mob)) {
    mob.aiState = 'idle';
    return;
  }
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const players = roomPlayers(ctx, inst).filter((p) => !p.dead);
  const nearest = nearestDistance(players, mob.pos.x, mob.pos.z);
  const alarmed = state.escapeAt !== null || nearest < HOARD_GOBLIN_ALARM_YARDS;
  if (!alarmed || state.points.length === 0) {
    mob.aiState = 'idle';
    state.goal = -1;
    return;
  }
  state.repickIn -= DT;
  const goal = state.goal >= 0 ? state.points[state.goal] : null;
  const arrived =
    goal !== null && Math.hypot(origin.x + goal.x - mob.pos.x, origin.z + goal.z - mob.pos.z) < 1.5;
  if (goal === null || arrived || state.repickIn <= 0) {
    state.goal = furthestPoint(state.points, origin, players, state.goal);
    state.repickIn = REPICK_SEC;
  }
  const target = state.points[state.goal];
  if (!target) return;
  mob.aiState = 'flee';
  // Slows bite; nothing makes it faster than its share of a player's run.
  const speed = Math.min(
    RUN_SPEED * HOARD_GOBLIN_SPEED_SHARE,
    mob.moveSpeed * ctx.moveSpeedMult(mob),
  );
  const dest = ctx.groundPos(origin.x + target.x, origin.z + target.z);
  mob.facing = Math.atan2(dest.x - mob.pos.x, dest.z - mob.pos.z);
  ctx.moveToward(mob, dest, speed);
}

/** Per tick (rift/runs.ts updateRiftInstances): the escape bar, the idle
 *  departure, and the payout on its death. */
export function tickHoardGoblins(ctx: SimContext): void {
  for (const inst of ctx.riftInstances) {
    const state = inst.hoardGoblin;
    if (!state || state.settled || !inst.vault) continue;
    const mob = ctx.entities.get(state.id);
    if (!mob) {
      state.settled = true;
      continue;
    }
    if (mob.dead) {
      payHoardGoblin(ctx, inst, mob);
      continue;
    }
    // The first blow, or anything that put it on someone's hate table (a
    // damageless control still holds the player in combat): the bar starts.
    if (
      state.escapeAt === null &&
      (mob.hp < mob.maxHp || mob.tappedById !== null || mob.threat.size > 0)
    ) {
      state.escapeAt = ctx.time + HOARD_GOBLIN_ESCAPE_SEC;
    }
    if (state.escapeAt !== null) {
      // The bar is the goblin's own clock, rewritten every tick, so a kick or a
      // stun can shorten nothing: only a kill beats it.
      mob.castingAbility = HOARD_GOBLIN_ESCAPE_CAST;
      mob.castTotal = HOARD_GOBLIN_ESCAPE_SEC;
      mob.castRemaining = Math.max(0, state.escapeAt - ctx.time);
      mob.castTargetId = null;
      mob.channeling = false;
      if (ctx.time >= state.escapeAt) escapeHoardGoblin(ctx, inst, mob);
      continue;
    }
    if (ctx.time >= state.spawnedAt + HOARD_GOBLIN_IDLE_SEC) escapeHoardGoblin(ctx, inst, mob);
  }
}

/** Floor teardown (rift/runs.ts freeRiftFloorEntities). A goblin killed on the
 *  very tick the floor goes still pays before it is dropped. */
export function dropHoardGoblin(ctx: SimContext, inst: RiftInstance): void {
  const state = inst.hoardGoblin;
  if (!state) return;
  const mob = ctx.entities.get(state.id);
  if (mob?.dead && !state.settled) payHoardGoblin(ctx, inst, mob);
  removeGoblin(ctx, state.id);
  delete inst.hoardGoblin;
}

function payHoardGoblin(ctx: SimContext, inst: RiftInstance, mob: Entity): void {
  const state = inst.hoardGoblin;
  const vault = inst.vault;
  if (!state || !vault) return;
  state.settled = true;
  mob.castingAbility = null;
  mob.castRemaining = 0;
  for (const player of roomPlayers(ctx, inst)) {
    const meta = ctx.players.get(player.id);
    // Both rolls are drawn for every paid player, so the sequence never depends
    // on the outcome of either.
    const found = ctx.rng.chance(HOARD_GOBLIN_MATERIAL_CHANCE);
    const material = CASKET_MATERIAL_POOL[ctx.rng.int(0, CASKET_MATERIAL_POOL.length - 1)];
    if (!meta || meta.leaving || guestCapped(meta, player.id, vault.ownerPid)) continue;
    const copper = hoardGoblinCopper(player.level, vault.rarity);
    meta.copper += copper;
    meta.counters.lootCopper += copper;
    ctx.bumpDeedStat(meta, 'lootCopper', copper);
    ctx.bumpDeedStat(meta, 'hoardGoblinKills', 1);
    ctx.emit({ type: 'loot', text: `You loot ${formatMoney(copper)}.`, pid: player.id });
    if (found) ctx.addItem(material, 1, player.id);
  }
  riftFx(ctx, mob.pos.x, mob.pos.z, 'holy', 'burst');
}

function escapeHoardGoblin(ctx: SimContext, inst: RiftInstance, mob: Entity): void {
  const state = inst.hoardGoblin;
  if (!state) return;
  state.settled = true;
  riftFx(ctx, mob.pos.x, mob.pos.z, 'arcane', 'burst', 'rift_portal_enter');
  for (const player of roomPlayers(ctx, inst)) {
    ctx.emit({
      type: 'log',
      text: `${mob.name} escapes with the gold!`,
      color: '#ffd24a',
      pid: player.id,
    });
  }
  removeGoblin(ctx, state.id);
}

/** A guest who has used up this cycle's hoard payouts (treasure_vault.ts
 *  payTreasureVault) takes nothing off the goblin either, so it is never a way
 *  round the cap. Reads the cap; spending it stays the chest's job. */
function guestCapped(meta: PlayerMeta, pid: number, ownerPid: number): boolean {
  if (pid === ownerPid) return false;
  if (meta.vaultGuestCycle !== meta.worldQuestCycle) return false;
  return (meta.vaultGuestPayouts ?? 0) >= VAULT_GUEST_PAYOUTS_PER_CYCLE;
}

function removeGoblin(ctx: SimContext, id: number): void {
  if (!ctx.entities.has(id)) return;
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (e?.targetId === id) e.targetId = null;
  }
  ctx.dropEntity(id);
}

function roomPlayers(ctx: SimContext, inst: RiftInstance): Entity[] {
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const out: Entity[] = [];
  const candidates =
    inst.memberIds.size > 0
      ? [...inst.memberIds]
      : [...ctx.players.values()].map((m) => m.entityId);
  for (const pid of candidates) {
    const e = ctx.entities.get(pid);
    if (e && ctx.players.has(pid) && inRoom(e, origin)) out.push(e);
  }
  return out;
}

function inRoom(e: Entity, origin: { x: number; z: number }): boolean {
  return (
    Math.abs(e.pos.x - origin.x) <= RIFT_REGION_HALF_X &&
    Math.abs(e.pos.z - origin.z) <= RIFT_REGION_HALF_Z
  );
}

function nearestDistance(players: readonly Entity[], x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const p of players) best = Math.min(best, Math.hypot(p.pos.x - x, p.pos.z - z));
  return best;
}

/** The run point whose closest living player is furthest away. The current
 *  goal is kept unless another point beats it by a clear margin, so the goblin
 *  does not dither between two near-equal corners. */
function furthestPoint(
  points: ReadonlyArray<{ x: number; z: number }>,
  origin: { x: number; z: number },
  players: readonly Entity[],
  current: number,
): number {
  const score = (i: number) =>
    nearestDistance(players, origin.x + points[i].x, origin.z + points[i].z);
  let best = 0;
  for (let i = 1; i < points.length; i++) if (score(i) > score(best)) best = i;
  if (current >= 0 && current < points.length && score(current) >= score(best) - 3) return current;
  return best;
}
