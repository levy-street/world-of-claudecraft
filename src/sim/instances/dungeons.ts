// Dungeons: party-instanced elite content (the Hollow Crypt and friends).
//
// Session I1 MOVES this slice verbatim out of the `Sim` monolith behind the
// `SimContext` seam: door-trigger teleports, dungeon entry/exit, the per-dungeon
// instance-slot pool, instance reset-when-empty, and Nythraxis raid lockouts. It is
// a pure move (statements + branch order + the per-spawn rng.int draw order are
// unchanged); `this.X` became `ctx.X`, and the sibling dungeon methods became local
// calls. The instance pool (`ctx.instances`) and door-id cache (`ctx.dungeonDoorIds`)
// stay Sim-owned fields, reached here as live views. Delves are a DIFFERENT slice
// (I2*) and are untouched.
//
// Sim keeps same-named thin delegates (enterDungeon/leaveDungeon/instanceKeyFor/
// instanceOriginOf/enterCrypt/leaveCrypt/updateDoorTriggers/updateInstances/
// instanceSlotAt/instanceInfoAt) so every foreign `this.X` call site resolves unchanged,
// and the seam exposes instanceKeyFor/instanceOriginOf/enterDungeon/leaveDungeon for
// the N1/quest/delve code that reaches them through `ctx`.

import { HEROIC_DUNGEON_TUNING, HEROIC_MARK_ITEM_ID } from '../content/dungeon_difficulty';
import { DUNGEON_X_THRESHOLD, DUNGEONS, dungeonAt, instanceOrigin, MOBS } from '../data';
import { createGroundObject, createMob } from '../entity';
import type { InstanceSlot, PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { arenaQueueLeave } from '../social/arena';
import { resurrectOnInstanceReentry } from '../spirit';
import {
  dist2d,
  type Entity,
  INSTANCE_EMPTY_TIMEOUT,
  NYTHRAXIS_BOSS_ID,
  NYTHRAXIS_ROOM_RADIUS,
  type Vec3,
} from '../types';
import {
  applyHeroicMobTuning,
  claimDifficultyForDungeon,
  mobLevelForDungeonDifficulty,
  mobTemplateForDungeonDifficulty,
} from './difficulty';

const DOOR_TRIGGER_RADIUS = 2.0; // walking this close to a dungeon door teleports you
const HEROIC_REWARD_WINDOW_MS = 24 * 60 * 60 * 1000;
const RAID_ALLOWED_DUNGEON_IDS = new Set(['nythraxis_crypt', 'nythraxis_boss_arena']);
const RAID_REQUIRED_DUNGEON_IDS = new Set(['nythraxis_boss_arena']);

export function instanceKeyFor(ctx: SimContext, pid: number): string {
  const party = ctx.partyOf(pid);
  if (party) return `party:${party.id}`;
  // Solo instances key on the DURABLE character id when the server supplies one,
  // so a logout, relog, or character-select "Take Over" (each of which mints a
  // new entity id) rejoins the SAME live instance instead of claiming a fresh one
  // with the boss respawned (issue #1600). This is the shared foundation that
  // also lets a disconnected solo runner resume their cleared instance (#1351).
  // Offline / sim-only callers have no characterId and fall back to the entity id,
  // preserving the exact pre-existing key (and the parity golden trace).
  const durable = ctx.players.get(pid)?.characterId;
  return durable !== undefined ? `solo:char:${durable}` : `solo:${pid}`;
}

function resetOwnerPids(ctx: SimContext, pid: number): number[] {
  return ctx.partyOf(pid)?.members ?? [pid];
}

function resetCooldownKey(ctx: SimContext, pid: number, dungeonId: string): string {
  const durable = ctx.players.get(pid)?.characterId;
  return `${durable !== undefined ? `char:${durable}` : `entity:${pid}`}:${dungeonId}`;
}

function activeResetLock(
  ctx: SimContext,
  pid: number,
  dungeonId: string,
): { availableAt: number; claimId: number } | null {
  const key = resetCooldownKey(ctx, pid, dungeonId);
  const lock = ctx.dungeonResetLocks.get(key);
  if (!lock || lock.availableAt <= ctx.time) {
    ctx.dungeonResetLocks.delete(key);
    return null;
  }
  return lock;
}

// Joining a party during a reset cooldown inherits that party's active dungeon
// locks. Otherwise fresh characters could take over the replacement claim, rotate
// the ephemeral party id, and open another run before the five-minute boundary.
export function inheritDungeonResetLocks(ctx: SimContext, pid: number): void {
  const party = ctx.partyOf(pid);
  if (!party) return;
  const partyKey = `party:${party.id}`;
  for (const inst of ctx.instances) {
    if (RAID_ALLOWED_DUNGEON_IDS.has(inst.dungeonId)) continue;
    const claimLock =
      inst.partyKey === partyKey && inst.resetAvailableAt > ctx.time && inst.exitId !== null
        ? { availableAt: inst.resetAvailableAt, claimId: inst.exitId }
        : null;
    const ownerLock = party.members
      .filter((ownerPid) => ownerPid !== pid)
      .map((ownerPid) => activeResetLock(ctx, ownerPid, inst.dungeonId))
      .find((lock) => lock !== null);
    const inherited = claimLock ?? ownerLock;
    // Inheritance may only ever EXTEND the joiner's lock. Replacing an existing
    // lock with a nearer-expiry one would let a mid-cooldown farmer launder the
    // remainder away through a brief join, and rebinding its claimId would lock
    // the joiner out of their own replacement claim.
    const existing = activeResetLock(ctx, pid, inst.dungeonId);
    if (inherited && (existing === null || inherited.availableAt > existing.availableAt)) {
      ctx.dungeonResetLocks.set(resetCooldownKey(ctx, pid, inst.dungeonId), inherited);
    }
  }
}

export function instanceOriginOf(inst: InstanceSlot): { x: number; z: number } {
  return instanceOrigin(DUNGEONS[inst.dungeonId].index, inst.slot);
}

// Unique live-claim identity at a position. The exit entity is recreated on
// every claim, unlike the reusable dungeon/slot coordinates, so released
// corpses can be bound without trusting a stale body in a recycled slot.
export function instanceClaimIdAt(ctx: SimContext, pos: Vec3): number | null {
  for (const inst of ctx.instances) {
    if (inst.partyKey === null || inst.exitId === null) continue;
    if (instanceClaimContains(ctx, inst, pos)) return inst.exitId;
  }
  return null;
}

// The one instance-footprint envelope (shared by occupancy, position lookup,
// and the kill-lockout sweep): is `pos` inside the slot anchored at `origin`?
function instanceContains(origin: { x: number; z: number }, pos: Vec3): boolean {
  return Math.abs(pos.x - origin.x) < 120 && Math.abs(pos.z - origin.z) < 250;
}

function instanceClaimContains(ctx: SimContext, inst: InstanceSlot, pos: Vec3): boolean {
  const origin = instanceOriginOf(inst);
  if (instanceContains(origin, pos)) return true;
  if (inst.dungeonId !== 'nythraxis_boss_arena') return false;
  const boss = inst.mobIds
    .map((id) => ctx.entities.get(id))
    .find((entity) => entity?.templateId === NYTHRAXIS_BOSS_ID);
  // The raid room is wider than the generic instance footprint, so its claim
  // includes the side wings. Keep that wider circle clipped to this slot's z
  // band or it reaches into the adjacent arena slot 500 yards away.
  return (
    !!boss &&
    Math.abs(pos.z - origin.z) < 250 &&
    dist2d(pos, boss.spawnPos) <= NYTHRAXIS_ROOM_RADIUS
  );
}

// Difficulty-scoped lockout key: heroic clears lock beside the normal key, so
// the two difficulties never consume each other's daily lockout.
export function heroicLockoutId(dungeonId: string): string {
  return `${dungeonId}:heroic`;
}

// Walking into a dungeon door teleports you through it (no click needed).
// Party members who walk in land in the same instance via instanceKeyFor.
export function updateDoorTriggers(ctx: SimContext, p: Entity): void {
  if (p.kind !== 'player') return;
  if (p.pos.x > DUNGEON_X_THRESHOLD) {
    // inside: walking into the exit portal climbs back out
    for (const inst of ctx.instances) {
      if (inst.exitId === null) continue;
      const exit = ctx.entities.get(inst.exitId);
      if (exit && dist2d(p.pos, exit.pos) < DOOR_TRIGGER_RADIUS) {
        leaveDungeon(ctx, p.id);
        return;
      }
    }
  }
  if (ctx.dungeonDoorIds === null) {
    ctx.dungeonDoorIds = [];
    for (const e of ctx.entities.values()) {
      if (e.templateId === 'dungeon_door') ctx.dungeonDoorIds.push(e.id);
    }
  }
  for (const doorId of ctx.dungeonDoorIds) {
    const door = ctx.entities.get(doorId);
    if (door?.dungeonId && dist2d(p.pos, door.pos) < DOOR_TRIGGER_RADIUS) {
      enterDungeon(ctx, door.dungeonId, p.id);
      return;
    }
  }
}

export function enterDungeon(
  ctx: SimContext,
  dungeonId: string,
  pid?: number,
  // [dev] /dev raid: skip the raid-group requirement and the Nythraxis attunement
  // so a lone tester can zone into the raid. Dev-gated (never in production). The
  // raid LOCKOUT is deliberately NOT bypassed (use /dev raid reset for that).
  devBypass = false,
): void {
  const r = ctx.resolve(pid);
  const dungeon = DUNGEONS[dungeonId];
  if (!r || !dungeon) return;
  const bypass = devBypass && ctx.devCommands;
  // A living player enters normally; a ghost that has run its spirit back re-enters to
  // resurrect at the entrance (below). A fresh corpse (dead, spirit not yet released)
  // cannot move, so it never reaches the door.
  if (r.e.dead && !r.e.ghost) return;
  const party = ctx.partyOf(r.meta.entityId);
  const raidAllowed = RAID_ALLOWED_DUNGEON_IDS.has(dungeonId);
  const raidRequired = RAID_REQUIRED_DUNGEON_IDS.has(dungeonId);
  if (party?.raid && !raidAllowed) {
    ctx.error(r.meta.entityId, 'Raid groups cannot enter standard dungeons.');
    return;
  }
  if (!party?.raid && raidRequired && !bypass) {
    ctx.error(r.meta.entityId, 'You must convert your party to a raid group first.');
    return;
  }
  if (dungeonId === 'nythraxis_boss_arena' && !canEnterNythraxisRaid(r.meta) && !bypass) {
    ctx.error(r.meta.entityId, 'The royal door is sealed to you.');
    return;
  }
  if (dungeonId === 'nythraxis_boss_arena') {
    const engaged = ctx.instances.find(
      (i) => i.dungeonId === dungeonId && i.partyKey === instanceKeyFor(ctx, r.meta.entityId),
    );
    if (engaged && nythraxisInstanceSealed(ctx, engaged)) {
      ctx.error(r.meta.entityId, 'Nythraxis is engaged — the royal door has sealed shut.');
      return;
    }
  }
  const key = instanceKeyFor(ctx, r.meta.entityId);
  const difficulty = claimDifficultyForDungeon(dungeonId, ctx.dungeonDifficulty(r.meta.entityId));
  // An existing claim for this group ALWAYS wins, whatever the current selection:
  // the claimed difficulty is fixed for the instance's life, so a mid-run
  // selection flip (or a ghost corpse-running back after one) rejoins the
  // group's live instance instead of stranding the player in a fresh parallel
  // claim. The selected difficulty applies only when claiming a new instance.
  let inst = ctx.instances.find((i) => i.dungeonId === dungeonId && i.partyKey === key);
  const corpseRunClaim = defeatedNythraxisCorpseRunClaim(ctx, key, r.e);
  const returningForLoot = inst !== undefined && corpseRunClaim === inst;
  // Nythraxis keeps its at-the-door lockout, scoped to the difficulty actually
  // being entered: the live claim's when one exists, else the current selection.
  // A loot-eligible ghost may return to its party's defeated live claim for the
  // normal corpse-run resurrection, but the lockout still bars every fresh claim.
  if (dungeonId === 'nythraxis_boss_arena') {
    const doorDifficulty = inst?.difficulty ?? difficulty;
    const lockId = doorDifficulty === 'heroic' ? heroicLockoutId(dungeonId) : dungeonId;
    if (isRaidLocked(ctx, r.meta, lockId) && !returningForLoot) {
      ctx.error(
        r.meta.entityId,
        doorDifficulty === 'heroic'
          ? `You are locked to Heroic ${dungeon.name}.`
          : 'You are locked to Nythraxis Raid Arena.',
      );
      return;
    }
  }
  // A locked player may walk back into a LIVE heroic claim only when its final
  // boss is already down AND that kill is the one their lock came from (the
  // claim's clearedBy set), or when the stricter Nythraxis corpse-run proof above
  // binds them to that exact defeated claim. Anything else bars the door. Without the
  // boss-alive arm, one unlocked member (a fresh recruit, or a camper the kill
  // never locked) could claim a fresh heroic instance and ferry the whole
  // locked party into another full run; without the clearedBy arm, a player
  // locked by an EARLIER run could walk into someone else's cleared claim and
  // loot its epics through the tapper's-party corpse rights.
  if (
    inst &&
    inst.difficulty === 'heroic' &&
    !returningForLoot &&
    isRaidLocked(ctx, r.meta, heroicLockoutId(dungeonId)) &&
    (heroicFinalBossAlive(ctx, inst) || !inst.clearedBy.has(r.meta.entityId))
  ) {
    ctx.error(r.meta.entityId, `You are locked to Heroic ${dungeon.name}.`);
    return;
  }
  // Party ids are intentionally ephemeral. During a reset cooldown, every durable
  // owner may re-enter only the exact replacement claim created by that reset.
  // Reforming the group or joining a friend's pre-created claim cannot rotate the
  // ownership key into an immediate fresh run.
  // A ghost whose corpse is bound to this exact live claim is recovering its
  // body, never minting a fresh run, so a partymate's unrelated reset lock must
  // not strand the spirit at the door.
  const corpseBoundToClaim =
    r.e.ghost && inst !== undefined && r.e.corpseInstanceId === inst.exitId;
  const conflictingResetLock =
    !raidAllowed && !corpseBoundToClaim
      ? resetOwnerPids(ctx, r.meta.entityId)
          .map((ownerPid) => activeResetLock(ctx, ownerPid, dungeonId))
          .find((lock) => lock !== null && lock.claimId !== inst?.exitId)
      : undefined;
  if (conflictingResetLock) {
    ctx.error(r.meta.entityId, 'Instances can only be reset once every 5 minutes.');
    return;
  }
  // The claim-wins rule above is silent, and silence is exactly the reported
  // confusion: a player who toggled the selection and walked back in landed in
  // the old-difficulty run with no explanation. A living player rejoining a
  // standard claim whose difficulty differs from their selection is told, and
  // pointed at the reset path. Ghosts are corpse-running back to the run they
  // already know; raid claims are excluded from Reset All, so no advice there.
  const mismatchedClaimDifficulty =
    !raidAllowed && !r.e.ghost && inst !== undefined && inst.difficulty !== difficulty
      ? inst.difficulty
      : null;
  if (!inst) {
    // Heroic five-mans lock on the KILL: a locked player can still corpse-run
    // back into a cleared live claim (gated on the boss being down, above), but
    // cannot claim a fresh heroic run until the daily reset. Normal claims are
    // never gated.
    if (difficulty === 'heroic' && isRaidLocked(ctx, r.meta, heroicLockoutId(dungeonId))) {
      ctx.error(r.meta.entityId, `You are locked to Heroic ${dungeon.name}.`);
      return;
    }
    inst = ctx.instances.find((i) => i.dungeonId === dungeonId && i.partyKey === null);
    if (!inst) {
      ctx.error(r.meta.entityId, `All instances of ${dungeon.name} are busy. Try again soon.`);
      return;
    }
    claimInstance(ctx, inst, key, difficulty);
  }
  if (mismatchedClaimDifficulty !== null) {
    ctx.emit({
      type: 'log',
      text:
        mismatchedClaimDifficulty === 'heroic'
          ? 'This instance is set to Heroic difficulty. Use Reset All Instances to start a fresh Normal run.'
          : 'This instance is set to Normal difficulty. Use Reset All Instances to start a fresh Heroic run.',
      color: '#f96',
      pid: r.meta.entityId,
    });
  }
  if (!party || party.members.length < dungeon.suggestedPlayers) {
    ctx.emit({
      type: 'log',
      text: `${dungeon.name} is meant for a full party of ${dungeon.suggestedPlayers}. Tread carefully.`,
      color: '#f96',
      pid: r.meta.entityId,
    });
  }
  const origin = instanceOriginOf(inst);
  const p = r.e;
  p.pos = ctx.groundPos(origin.x + dungeon.entry.x, origin.z + dungeon.entry.z);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.facing = 0;
  p.targetId = null;
  p.autoAttack = false;
  inst.emptyFor = 0;
  // Stepping inside removes you from any arena queue: a match must never form for
  // a player standing in an instance and teleport them back inside fully restored
  // (issue #1600). No-op if they were not queued; notifies any 2v2 teammate.
  arenaQueueLeave(ctx, r.meta.entityId);
  // A ghost that ran its spirit back and re-entered resurrects at the entrance,
  // penalty-free: the re-entry IS the corpse run under the instance death model (no
  // Spirit Healer inside an instance).
  // Nythraxis has a nested entrance: a returning ghost must cross the approach crypt
  // before reaching the royal door. Keep that spirit released through the outer
  // transition and resurrect only after it reaches its defeated arena claim.
  const passingThroughNythraxisCrypt =
    dungeonId === 'nythraxis_crypt' && corpseRunClaim !== undefined;
  if (p.ghost && !passingThroughNythraxisCrypt) resurrectOnInstanceReentry(ctx, r.meta, p, p.pos);
  ctx.emit({ type: 'log', text: dungeon.enterText, color: '#b9f', pid: r.meta.entityId });
  // Stepping through the moongate is a Chronicle task.
  if (dungeonId === 'drowned_temple') ctx.markVisited(r.meta, 'dungeon:drowned_temple');
}

function canEnterNythraxisRaid(meta: PlayerMeta): boolean {
  return meta.questsDone.has('q_nythraxis_bound_guardian');
}

function isRaidLocked(ctx: SimContext, meta: PlayerMeta, dungeonId: string): boolean {
  const until = meta.raidLockouts.get(dungeonId) ?? 0;
  if (until <= ctx.lockoutNowMs()) {
    meta.raidLockouts.delete(dungeonId);
    return false;
  }
  return true;
}

// Is the claimed heroic instance's final boss still up? Gates the locked-player
// door rule in enterDungeon: a cleared run (boss down, or its corpse already
// swept) stays re-enterable for loot and corpse-runs; a run with the boss alive
// is a fresh farm a locked player must not join.
function heroicFinalBossAlive(ctx: SimContext, inst: InstanceSlot): boolean {
  const tuning = HEROIC_DUNGEON_TUNING[inst.dungeonId];
  if (!tuning) return false;
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (e && e.templateId === tuning.finalBossId && !e.dead) return true;
  }
  return false;
}

// The royal door seals once Nythraxis is engaged (pulled, alive, pre-death).
// It reopens on his death or a full raid wipe (handled in the encounter loop).
function nythraxisInstanceSealed(ctx: SimContext, inst: InstanceSlot): boolean {
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (
      e &&
      e.templateId === NYTHRAXIS_BOSS_ID &&
      !e.dead &&
      e.inCombat &&
      e.nythraxis &&
      e.nythraxis.phase !== 'dead'
    )
      return true;
  }
  return false;
}

function isDefeatedNythraxisParticipant(ctx: SimContext, inst: InstanceSlot, pid: number): boolean {
  for (const id of inst.mobIds) {
    const boss = ctx.entities.get(id);
    if (boss?.templateId === NYTHRAXIS_BOSS_ID && boss.dead && boss.lootRecipientIds?.includes(pid))
      return true;
  }
  return false;
}

function defeatedNythraxisCorpseRunClaim(
  ctx: SimContext,
  partyKey: string,
  p: Entity,
): InstanceSlot | undefined {
  const corpsePos = p.corpsePos;
  if (!p.ghost || !corpsePos || p.corpseInstanceId === null) return undefined;
  const inst = ctx.instances.find(
    (candidate) =>
      candidate.dungeonId === 'nythraxis_boss_arena' &&
      candidate.partyKey === partyKey &&
      candidate.exitId === p.corpseInstanceId &&
      instanceClaimContains(ctx, candidate, corpsePos),
  );
  if (!inst || !isDefeatedNythraxisParticipant(ctx, inst, p.id)) return undefined;
  return inst;
}

export function leaveDungeon(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  // A fresh corpse cannot move, but a released ghost crossing the nested Nythraxis
  // approach must be able to backtrack outside if its arena claim becomes unavailable.
  if (!r || (r.e.dead && !r.e.ghost)) return;
  const p = r.e;
  // not inside any instance: nothing to leave (no DUNGEON_LIST[0] fallback —
  // that silently teleported outdoor callers to the Hollow Crypt door)
  const dungeon = dungeonAt(p.pos.x);
  if (!dungeon) return;
  if (dungeon.id === 'nythraxis_boss_arena') {
    const inst = ctx.instances.find(
      (i) => i.dungeonId === dungeon.id && i.partyKey === instanceKeyFor(ctx, p.id),
    );
    if (inst && nythraxisInstanceSealed(ctx, inst)) {
      ctx.error(r.meta.entityId, 'The royal door is sealed — Nythraxis must fall first.');
      return;
    }
  }
  p.pos = ctx.groundPos(dungeon.doorPos.x, dungeon.doorPos.z - 4);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.targetId = null;
  p.autoAttack = false;
  ctx.emit({ type: 'log', text: dungeon.leaveText, color: '#b9f', pid: r.meta.entityId });
}

// Legacy single-dungeon entry points (tests + scripts use these).
export function enterCrypt(ctx: SimContext, pid?: number): void {
  enterDungeon(ctx, 'hollow_crypt', pid);
}

export function leaveCrypt(ctx: SimContext, pid?: number): void {
  leaveDungeon(ctx, pid);
}

function claimInstance(
  ctx: SimContext,
  inst: InstanceSlot,
  key: string,
  difficulty: InstanceSlot['difficulty'],
): void {
  const dungeon = DUNGEONS[inst.dungeonId];
  inst.partyKey = key;
  inst.difficulty = difficulty;
  inst.emptyFor = 0;
  // The Sanctum speed deed measures from the claim.
  inst.claimedAt = ctx.time;
  inst.clearedBy = new Set();
  const origin = instanceOriginOf(inst);
  for (const spawn of dungeon.spawns) {
    const template = MOBS[spawn.mobId];
    const rolledLevel = ctx.rng.int(template.minLevel, template.maxLevel);
    const spawnTemplate = mobTemplateForDungeonDifficulty(template, inst.dungeonId, difficulty);
    const level = mobLevelForDungeonDifficulty(inst.dungeonId, difficulty, rolledLevel);
    const mob = createMob(
      ctx.nextId++,
      spawnTemplate,
      level,
      ctx.groundPos(origin.x + spawn.x, origin.z + spawn.z),
    );
    applyHeroicMobTuning(mob, inst.dungeonId, difficulty);
    mob.facing = Math.PI; // face the entrance
    mob.prevFacing = mob.facing;
    ctx.addEntity(mob);
    inst.mobIds.push(mob.id);
  }
  for (const objDef of dungeon.objects ?? []) {
    const obj = createGroundObject(
      ctx.nextId++,
      objDef.itemId,
      objDef.name,
      ctx.groundPos(origin.x + objDef.x, origin.z + objDef.z),
    );
    if (objDef.templateId) {
      obj.templateId = objDef.templateId;
      obj.dungeonId = objDef.dungeonId ?? null;
      obj.objectItemId = null;
      obj.lootable = true;
    }
    ctx.addEntity(obj);
    inst.objectIds.push(obj.id);
  }
  const exit = createGroundObject(
    ctx.nextId++,
    '',
    `${dungeon.name} Exit`,
    ctx.groundPos(origin.x + dungeon.exitOffset.x, origin.z + dungeon.exitOffset.z),
  );
  exit.templateId = 'dungeon_exit';
  exit.dungeonId = dungeon.id;
  exit.objectItemId = null;
  exit.lootable = true;
  ctx.addEntity(exit);
  inst.exitId = exit.id;
  // No Spirit Healer is spawned inside an instance: a ghost releases at the OUTDOOR
  // graveyard nearest the door and runs its spirit back to re-enter and resurrect at
  // the entrance (see enterDungeon / spirit.ts ghostGraveyard).
}

function freeInstance(ctx: SimContext, inst: InstanceSlot): void {
  for (const id of inst.mobIds) {
    if (!ctx.entities.has(id)) continue;
    // drop any player targets on the despawning mob so the delete is clean
    for (const meta of ctx.players.values()) {
      const e = ctx.entities.get(meta.entityId);
      if (e?.targetId === id) e.targetId = null;
    }
    ctx.dropEntity(id);
  }
  for (const id of inst.objectIds) {
    if (ctx.entities.has(id)) ctx.dropEntity(id);
  }
  if (inst.exitId !== null) ctx.dropEntity(inst.exitId);
  inst.partyKey = null;
  inst.difficulty = 'normal';
  inst.mobIds = [];
  inst.objectIds = [];
  inst.exitId = null;
  inst.emptyFor = 0;
  inst.resetAvailableAt = 0;
  inst.claimedAt = undefined;
  inst.clearedBy = new Set();
}

// Explicit classic-style reset for the caller's standard dungeon claims. Durable
// character keys keep relogs attached to the same run; this is the deliberate,
// server-authoritative way to abandon that run before selecting another difficulty.
// Raid approach/arena claims are excluded because their lockout and corpse-return
// rules are stricter and are reset only by their existing lifecycle.
export function resetDungeonInstances(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const party = ctx.partyOf(r.meta.entityId);
  if (party && party.leader !== r.meta.entityId) {
    ctx.error(r.meta.entityId, 'You are not the party leader.');
    return;
  }

  const key = instanceKeyFor(ctx, r.meta.entityId);
  const owned = ctx.instances.filter(
    (inst) => inst.partyKey === key && !RAID_ALLOWED_DUNGEON_IDS.has(inst.dungeonId),
  );
  if (owned.length === 0) {
    ctx.error(r.meta.entityId, 'You have no instances to reset.');
    return;
  }
  // Reset is a difficulty-transition escape hatch, not a same-difficulty farming
  // loop. The v0.26 durable key intentionally stopped relog from respawning Normal
  // bosses; require the player to select the other difficulty before abandoning the
  // old claims so Reset All cannot recreate that exploit with one extra click.
  const selected = ctx.dungeonDifficulty(r.meta.entityId);
  // Compare against the per-dungeon CLAMPED difficulty (what the replacement
  // claim below would actually use), so a dungeon without a heroic mode can
  // never pass the transition guard and loop same-difficulty resets.
  const resettable = owned.filter(
    (inst) => inst.difficulty !== claimDifficultyForDungeon(inst.dungeonId, selected),
  );
  if (resettable.length === 0) {
    ctx.error(
      r.meta.entityId,
      'Change dungeon difficulty before resetting these instances. Empty instances reset on their own after 5 minutes.',
    );
    return;
  }
  const ownerPids = resetOwnerPids(ctx, r.meta.entityId);
  if (
    resettable.some(
      (inst) =>
        inst.resetAvailableAt > ctx.time ||
        ownerPids.some((ownerPid) => activeResetLock(ctx, ownerPid, inst.dungeonId) !== null),
    )
  ) {
    ctx.error(r.meta.entityId, 'Instances can only be reset once every 5 minutes.');
    return;
  }
  if (selected === 'heroic') {
    const locked = resettable.find((inst) =>
      isRaidLocked(ctx, r.meta, heroicLockoutId(inst.dungeonId)),
    );
    if (locked) {
      ctx.error(r.meta.entityId, `You are locked to Heroic ${DUNGEONS[locked.dungeonId].name}.`);
      return;
    }
  }

  // Validate every claim before freeing any so Reset All is atomic. A living player,
  // an unreleased corpse, or a released spirit still bound to a corpse in the claim
  // keeps it alive for recovery and loot instead of being stranded by the reset.
  for (const inst of resettable) {
    const origin = instanceOriginOf(inst);
    for (const meta of ctx.players.values()) {
      const player = ctx.entities.get(meta.entityId);
      if (!player) continue;
      const bodyInside = instanceContains(origin, player.pos);
      const corpseInside =
        player.ghost &&
        player.corpsePos !== null &&
        player.corpseInstanceId === inst.exitId &&
        instanceContains(origin, player.corpsePos);
      if (bodyInside || corpseInside) {
        ctx.error(r.meta.entityId, 'You cannot reset instances while someone is still inside.');
        return;
      }
    }
    if (inst.mobIds.some((id) => ctx.entities.get(id)?.lootable)) {
      ctx.error(r.meta.entityId, 'You cannot reset instances while loot remains inside.');
      return;
    }
  }

  // Reclaim each slot immediately at the selected difficulty. This commits the
  // transition atomically: toggling the preference back afterward still rejoins this
  // live claim, so Reset All cannot be turned into a Normal -> Heroic -> Normal
  // zero-downtime boss-respawn loop.
  for (const inst of resettable) {
    freeInstance(ctx, inst);
    claimInstance(ctx, inst, key, claimDifficultyForDungeon(inst.dungeonId, selected));
    if (inst.exitId === null) throw new Error('Dungeon reset replacement claim has no identity.');
    inst.resetAvailableAt = ctx.time + INSTANCE_EMPTY_TIMEOUT;
    for (const ownerPid of ownerPids) {
      ctx.dungeonResetLocks.set(resetCooldownKey(ctx, ownerPid, inst.dungeonId), {
        availableAt: inst.resetAvailableAt,
        claimId: inst.exitId,
      });
    }
  }
  ctx.error(r.meta.entityId, 'All instances have been reset.');
}

// Kill-time lockout recipients for a claimed instance: every CURRENT member of
// the group that owns the claim, wherever they stand (at the entrance, dead, or
// released outside), plus any player physically inside the instance footprint
// (a member who left the party mid-run is still on the hook). Position alone
// was the old rule, and it let a door-camper or an early-released ghost escape
// the daily lockout and later claim a fresh run for the whole locked party.
export function instanceLockoutMetas(ctx: SimContext, inst: InstanceSlot): PlayerMeta[] {
  const out: PlayerMeta[] = [];
  for (const meta of ctx.players.values()) {
    if (meta.leaving) continue;
    if (instanceKeyFor(ctx, meta.entityId) === inst.partyKey) {
      out.push(meta);
      continue;
    }
    const e = ctx.entities.get(meta.entityId);
    const matchingInstanceCorpse =
      e?.ghost && e.corpsePos && e.corpseInstanceId === inst.exitId ? e.corpsePos : null;
    const lockoutPos = matchingInstanceCorpse ?? e?.pos;
    if (lockoutPos && instanceClaimContains(ctx, inst, lockoutPos)) out.push(meta);
  }
  return out;
}

// Stamp one player's heroic daily lockout for this claim. A player whose lock
// FIRST lands with this kill also joins the claim's `clearedBy` set: the
// heroic door's cleared-run exception (enterDungeon) admits only them, so a
// player locked by an EARLIER run can never treat someone else's cleared claim
// as their own loot run (corpse loot rights ride the tapper's current party,
// so an open door would hand them the epics too).
function lockToHeroicClaim(
  ctx: SimContext,
  inst: InstanceSlot,
  meta: PlayerMeta,
  lockedUntil: number,
): void {
  const lockId = heroicLockoutId(inst.dungeonId);
  if (!isRaidLocked(ctx, meta, lockId)) inst.clearedBy.add(meta.entityId);
  meta.raidLockouts.set(lockId, lockedUntil);
}

function heroicRewardWindowToken(lockedUntil: number): string {
  return `reset:${Math.floor(lockedUntil / HEROIC_REWARD_WINDOW_MS)}`;
}

// Settle a heroic final-boss kill in one synchronous mutation. The whole group
// owning the claim (plus anyone still inside) receives the realm-reset lockout,
// while the death-time participation snapshot receives the configured marks.
// A recipient already locked for this reset is not paid again. This makes the
// authoritative lockout boundary the only income gate and removes the former
// UTC-day mismatch. Marks go straight into inventory, so corpse cleanup, a UI
// failure, or logout cannot persist an entitlement without its reward.
export function awardHeroicMarks(ctx: SimContext, mob: Entity, recipients: PlayerMeta[]): void {
  const inst = ctx.instances.find((i) => i.partyKey !== null && i.mobIds.includes(mob.id));
  if (!inst || inst.difficulty !== 'heroic') return;
  const tuning = HEROIC_DUNGEON_TUNING[inst.dungeonId];
  if (!tuning || mob.templateId !== tuning.finalBossId) return;
  const lockedUntil = ctx.raidResetMs(ctx.lockoutNowMs());
  const rewardWindow = heroicRewardWindowToken(lockedUntil);
  const rewardIds = new Set(recipients.map((meta) => meta.entityId));
  const lockoutRecipients = new Map<number, PlayerMeta>();
  for (const meta of instanceLockoutMetas(ctx, inst)) lockoutRecipients.set(meta.entityId, meta);
  // A tap holder who left both party and instance before the kill remains in
  // the death snapshot and must receive the same lockout as their reward.
  for (const meta of recipients) lockoutRecipients.set(meta.entityId, meta);

  for (const meta of lockoutRecipients.values()) {
    const alreadyLocked = isRaidLocked(ctx, meta, heroicLockoutId(inst.dungeonId));
    if (!alreadyLocked && rewardIds.has(meta.entityId)) {
      ctx.addItem(HEROIC_MARK_ITEM_ID, tuning.marksPerParticipant, meta.entityId);
      // The Book of Deeds daily circuit observes successful rewards, but it is
      // telemetry only: the realm-reset lockout above remains the income gate.
      if (meta.heroicDaily.date !== rewardWindow) {
        meta.heroicDaily = { date: rewardWindow, marked: new Set() };
      }
      meta.heroicDaily.marked.add(inst.dungeonId);
      ctx.markDeedsDirty(meta.entityId);
    }
    lockToHeroicClaim(ctx, inst, meta, lockedUntil);
  }
}

export function updateInstances(ctx: SimContext): void {
  if (ctx.tickCount % 20 !== 0) return; // once a second
  for (const inst of ctx.instances) {
    if (inst.partyKey === null) continue;
    const origin = instanceOriginOf(inst);
    let occupied = false;
    for (const meta of ctx.players.values()) {
      const e = ctx.entities.get(meta.entityId);
      if (e && instanceContains(origin, e.pos)) {
        occupied = true;
        break;
      }
    }
    if (occupied) {
      inst.emptyFor = 0;
    } else {
      inst.emptyFor += 1;
      if (inst.emptyFor >= INSTANCE_EMPTY_TIMEOUT) freeInstance(ctx, inst);
    }
  }
}

export function instanceSlotAt(ctx: SimContext, pos: Vec3): number | null {
  return instanceInfoAt(ctx, pos)?.slot ?? null;
}

export function instanceInfoAt(
  ctx: SimContext,
  pos: Vec3,
): { slot: number; dungeonId: string } | null {
  for (const inst of ctx.instances) {
    if (instanceContains(instanceOriginOf(inst), pos)) {
      return { slot: inst.slot, dungeonId: inst.dungeonId };
    }
  }
  return null;
}

// Authoritative: is `pos` physically inside one of the two Nythraxis raid
// instances (the crypt approach or the boss arena), regardless of raid-GROUP
// membership. Used to silently gate walk-by autoloot (interaction.ts): a rogue
// looter leaving the raid, or a raid party staging pre-pull in the open world,
// must not trigger it.
export function isInRaidInstance(ctx: SimContext, pos: Vec3): boolean {
  const id = instanceInfoAt(ctx, pos)?.dungeonId;
  return id != null && RAID_ALLOWED_DUNGEON_IDS.has(id);
}

// Client-safe mirror of isInRaidInstance: no SimContext needed, so it is
// coarser (x-band only, via dungeonAt) by design. Best-effort only, used to
// avoid spamming the autoloot command from src/game/autoloot.ts; the sim's
// isInRaidInstance gate above stays the single source of truth.
export function isRaidInstancePos(pos: Vec3): boolean {
  const id = dungeonAt(pos.x)?.id;
  return id != null && RAID_ALLOWED_DUNGEON_IDS.has(id);
}
