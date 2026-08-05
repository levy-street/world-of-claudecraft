// Source Cave dungeon controller: the runtime dungeon's enter / claim / leave
// behavior, kept out of the static dungeon engine (instances/dungeons.ts) because
// the cave neither rolls levels (the spec pre-rolled them off the salted rng) nor
// resolves mobs through MOBS[id]. It talks ONLY to the SimContext seam, so the
// engine delegates in (enterDungeon/leaveDungeon) without a circular import.
//
// The cave reuses the shared InstanceSlot pool (ctx.instances) tagged with
// SOURCE_CAVE_DUNGEON_ID: the generic updateInstances / freeInstance / door-trigger
// exit path all work unchanged once instanceOriginOf resolves the cave origin.

import { createGroundObject } from '../entity';
import type { InstanceSlot, PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { resurrectOnInstanceReentry } from '../spirit';
import type { Entity } from '../types';
import { spawnSourceCaveChest } from './clear';
import { createSourceCaveEncounterState, sourceCaveExitSealed } from './encounter';
import { posInSourceCaveInstance, sourceCaveInstanceForPlayer } from './occupancy';
import { spawnSourceCaveMobs } from './population';
import { spawnSourceCaveReboot } from './reboot';
import { moduleWorldPoint, SOURCE_CAVE_DUNGEON_ID } from './runtime';
import { sourceCaveEntryZ, sourceCaveExitZ } from './spec';

// Daily lockout key, scoped flat (the cave has only one difficulty, so unlike
// heroicLockoutId it needs no suffix). Kept local rather than importing
// instances/dungeons.ts's isRaidLocked: that engine imports the cave's enter/leave
// through this module's barrel, so importing back would be a circular import
// (see the file header). The check mirrors isRaidLocked's logic exactly.
function isSourceCaveLocked(ctx: SimContext, meta: PlayerMeta): boolean {
  const until = meta.raidLockouts.get(SOURCE_CAVE_DUNGEON_ID) ?? 0;
  if (until <= ctx.lockoutNowMs()) {
    meta.raidLockouts.delete(SOURCE_CAVE_DUNGEON_ID);
    return false;
  }
  return true;
}

/** Walk-through-the-door entry: claim a slot if needed, then teleport the player in. */
export function enterSourceCave(ctx: SimContext, pid?: number): boolean {
  const r = ctx.resolve(pid);
  const cave = ctx.sourceCave;
  if (!r || !cave) return false;
  // A living player enters; a ghost that ran its spirit back re-enters to reach its
  // corpse inside (the cave uses the dungeon death model, see spirit.ts). A fresh
  // corpse (dead, not yet a ghost) cannot move, so it never reaches the door.
  if (r.e.dead && !r.e.ghost) return false;
  if (r.e.level < cave.def.minLevel) {
    const minLevel = cave.def.minLevel;
    ctx.error(r.meta.entityId, `You must reach level ${minLevel} to enter ${cave.def.name}.`);
    return false;
  }
  // The lockout is granted on clear (Phase 4); this is the entry-side check only, so
  // entry is allowed for everyone until the first clear grants anyone a lockout.
  if (isSourceCaveLocked(ctx, r.meta)) {
    ctx.error(r.meta.entityId, `You are locked out of ${cave.def.name}.`);
    return false;
  }

  const key = ctx.instanceKeyFor(r.meta.entityId);
  let inst = ctx.instances.find(
    (i) => i.dungeonId === SOURCE_CAVE_DUNGEON_ID && i.partyKey === key,
  );
  if (!inst) {
    inst = ctx.instances.find((i) => i.dungeonId === SOURCE_CAVE_DUNGEON_ID && i.partyKey === null);
    if (!inst) {
      // Same wording as the static dungeon engine (localized at the hud layer).
      ctx.error(r.meta.entityId, `All instances of ${cave.def.name} are busy. Try again soon.`);
      return false;
    }
    claimSourceCaveInstance(ctx, inst, key);
  }

  const origin = ctx.instanceOriginOf(inst);
  const p = r.e;
  p.pos = moduleWorldPoint(ctx, cave, origin, 0, 0, sourceCaveEntryZ(cave.spec));
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.facing = 0;
  p.targetId = null;
  p.autoAttack = false;
  // A ghost keeps its interior corpse run only while its corpse lies in THIS copy.
  // A stale corpse (the copy was freed during a disconnect and someone else claimed
  // the slot) would strand a corpseless ghost, so revive at the entry the way every
  // static dungeon re-entry does (penalty-free, see resurrectOnInstanceReentry).
  if (p.ghost && !(p.corpsePos && posInSourceCaveInstance(ctx, inst, p.corpsePos))) {
    resurrectOnInstanceReentry(ctx, r.meta, p, p.pos);
  }
  inst.emptyFor = 0;
  ctx.emit({ type: 'log', text: cave.def.enterText, color: '#b9f', pid: r.meta.entityId });
  return true;
}

/** Populate a freshly claimed cave slot: every spec mob at its placement, plus the exit. */
function claimSourceCaveInstance(ctx: SimContext, inst: InstanceSlot, key: string): void {
  const cave = ctx.sourceCave;
  if (!cave) return;
  inst.partyKey = key;
  inst.difficulty = 'normal';
  inst.emptyFor = 0;
  // Draws NO ctx.rng: levels and placements were pre-rolled by the salted spec rng
  // (Phase 1), so claiming the cave never perturbs the shared tick draw order.
  const mobIdsByLogin = spawnSourceCaveMobs(ctx, inst);
  inst.sourceCaveEncounter = createSourceCaveEncounterState(cave.spec.mobs, mobIdsByLogin);

  const origin = ctx.instanceOriginOf(inst);

  spawnSourceCaveReboot(
    ctx,
    inst,
    moduleWorldPoint(ctx, cave, origin, 0, cave.spec.chestPos.x, cave.spec.chestPos.z),
  );
  // The reward chest is present from the start, sealed ("Access denied.") until
  // the clear pass arms it (clear.ts).
  spawnSourceCaveChest(ctx, cave, inst);

  const exit = createGroundObject(
    ctx.nextId++,
    '',
    `${cave.def.name} Exit`,
    moduleWorldPoint(ctx, cave, origin, 0, 0, sourceCaveExitZ(cave.spec)),
  );
  exit.templateId = 'dungeon_exit';
  exit.dungeonId = SOURCE_CAVE_DUNGEON_ID;
  exit.objectItemId = null;
  exit.lootable = true;
  ctx.addEntity(exit);
  inst.exitId = exit.id;
}

/** Walk-onto-the-exit-portal leave: teleport back to the overworld door. */
export function leaveSourceCave(ctx: SimContext, r: { meta: PlayerMeta; e: Entity }): boolean {
  const cave = ctx.sourceCave;
  if (!cave) return false;
  const inst = sourceCaveInstanceForPlayer(ctx, r.meta.entityId);
  if (inst && sourceCaveExitSealed(inst)) return false;
  const p = r.e;
  p.pos = ctx.groundPos(cave.def.doorPos.x, cave.def.doorPos.z - 4);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.targetId = null;
  p.autoAttack = false;
  ctx.emit({ type: 'log', text: cave.def.leaveText, color: '#b9f', pid: r.meta.entityId });
  return true;
}
