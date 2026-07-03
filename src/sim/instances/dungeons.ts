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

import { DUNGEON_X_THRESHOLD, DUNGEONS, dungeonAt, instanceOrigin, MOBS } from '../data';
import { createGroundObject, createMob } from '../entity';
import type { InstanceSlot, PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import {
  dist2d,
  type Entity,
  INSTANCE_EMPTY_TIMEOUT,
  NYTHRAXIS_BOSS_ID,
  type Vec3,
} from '../types';

const DOOR_TRIGGER_RADIUS = 2.0; // walking this close to a dungeon door teleports you
const RAID_ALLOWED_DUNGEON_IDS = new Set(['nythraxis_crypt', 'nythraxis_boss_arena']);
const RAID_REQUIRED_DUNGEON_IDS = new Set(['nythraxis_boss_arena']);

export function instanceKeyFor(ctx: SimContext, pid: number): string {
  const party = ctx.partyOf(pid);
  return party ? `party:${party.id}` : `solo:${pid}`;
}

export function instanceOriginOf(inst: InstanceSlot): { x: number; z: number } {
  return instanceOrigin(DUNGEONS[inst.dungeonId].index, inst.slot);
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

export function enterDungeon(ctx: SimContext, dungeonId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  const dungeon = DUNGEONS[dungeonId];
  if (!r || !dungeon || r.e.dead) return;
  const party = ctx.partyOf(r.meta.entityId);
  const raidAllowed = RAID_ALLOWED_DUNGEON_IDS.has(dungeonId);
  const raidRequired = RAID_REQUIRED_DUNGEON_IDS.has(dungeonId);
  if (party?.raid && !raidAllowed) {
    ctx.error(r.meta.entityId, 'Raid groups cannot enter standard dungeons.');
    return;
  }
  if (!party?.raid && raidRequired) {
    ctx.error(r.meta.entityId, 'You must convert your party to a raid group first.');
    return;
  }
  if (dungeonId === 'nythraxis_boss_arena' && !canEnterNythraxisRaid(r.meta)) {
    ctx.error(r.meta.entityId, 'The royal door is sealed to you.');
    return;
  }
  if (dungeonId === 'nythraxis_boss_arena' && isRaidLocked(ctx, r.meta, dungeonId)) {
    ctx.error(r.meta.entityId, 'You are locked to Nythraxis Raid Arena.');
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
  let inst = ctx.instances.find((i) => i.dungeonId === dungeonId && i.partyKey === key);
  if (!inst) {
    inst = ctx.instances.find((i) => i.dungeonId === dungeonId && i.partyKey === null);
    if (!inst) {
      ctx.error(r.meta.entityId, `All instances of ${dungeon.name} are busy. Try again soon.`);
      return;
    }
    claimInstance(ctx, inst, key);
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
  ctx.emit({ type: 'log', text: dungeon.enterText, color: '#b9f', pid: r.meta.entityId });
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

export function leaveDungeon(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r || r.e.dead) return;
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

function claimInstance(ctx: SimContext, inst: InstanceSlot, key: string): void {
  const dungeon = DUNGEONS[inst.dungeonId];
  inst.partyKey = key;
  inst.emptyFor = 0;
  const origin = instanceOriginOf(inst);
  for (const spawn of dungeon.spawns) {
    const template = MOBS[spawn.mobId];
    const level = ctx.rng.int(template.minLevel, template.maxLevel);
    const mob = createMob(
      ctx.nextId++,
      template,
      level,
      ctx.groundPos(origin.x + spawn.x, origin.z + spawn.z),
    );
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
  inst.mobIds = [];
  inst.objectIds = [];
  inst.exitId = null;
  inst.emptyFor = 0;
}

export function updateInstances(ctx: SimContext): void {
  if (ctx.tickCount % 20 !== 0) return; // once a second
  for (const inst of ctx.instances) {
    if (inst.partyKey === null) continue;
    const origin = instanceOriginOf(inst);
    let occupied = false;
    for (const meta of ctx.players.values()) {
      const e = ctx.entities.get(meta.entityId);
      if (e && Math.abs(e.pos.x - origin.x) < 120 && Math.abs(e.pos.z - origin.z) < 250) {
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
    const origin = instanceOriginOf(inst);
    if (Math.abs(pos.x - origin.x) < 120 && Math.abs(pos.z - origin.z) < 250) {
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
