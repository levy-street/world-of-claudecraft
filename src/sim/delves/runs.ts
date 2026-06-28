// Delve run/session subsystem (I2a), MOVED verbatim out of the 17.5k-line Sim
// class behind SimContext. This module owns the delve RUN LIFECYCLE: entering /
// leaving, module generation + progression (plates, exits, affixes, bad-air,
// restless graves), reward/lore/Marks payout on clear, and the Marks shop. The
// adjacent lockpick controller (I2b) and the companion AI (I2c) split out
// separately and are consumed via SimContext (ctx.abandonLockpick /
// ctx.tickLockpickTimeout, ctx.spawnDelveCompanion / ctx.despawnDelveCompanion /
// ctx.maybeCompanionBark), never moved here.
//
// Move-not-rewrite: every statement, branch, and iteration order is preserved from
// the original Sim methods; `this.X` became `ctx.X` (seam primitive/callback) or a
// direct sibling call. The five shared `new Rng(seed ^ ...)` sub-streams (module
// gen, spawn-set, affix, bountiful, lockpick board) stay distinct from the two
// shared-stream draws (copper `rng.int`, marks `rng.chance`); see the parity gate.
//
// Per the refactor's immutability waiver, the in-place mutation of DelveRun /
// Entity / PlayerMeta is intentional and preserved (the engine aliases these live
// objects); do NOT rewrite to immutable copies. This module is src/sim-pure (no
// DOM/Three, no Math.random/Date.now), so it runs unchanged in Node, the browser,
// and the headless RL env (enforced by tests/architecture.test.ts).

import type { DelveCompanionInfo } from '../../world_api';
import type { DelveShopGate, DelveShopOffer } from '../data';
import {
  COMPANION_UPGRADE_COSTS,
  DELVE_AFFIXES,
  DELVE_COMPANIONS,
  DELVE_MODULES,
  DELVE_SHOPS,
  DELVES,
  delveAt,
  delveModuleZOffset as delveModuleZOffsetLayout,
  delveOrigin,
  delveShopGateUnlocked,
  dungeonAt,
  ITEMS,
  isArenaPos,
  isDelvePos,
  MOBS,
  resolveDelveShopOffers,
} from '../data';
import {
  DELVE_MODULE_LAYOUTS,
  type DelveModuleId,
  delveModuleEntry as delveLayoutEntry,
} from '../delve_layout';
import { DUNGEON_WALL_HW, DUNGEON_WALL_X } from '../dungeon_layout';
import { createGroundObject, createMob, recalcPlayerStats } from '../entity';
import { restorePetFromDelveStash, stowPetForDelve } from '../pet/pet_commands';
import { Rng } from '../rng';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import {
  DELVE_COMPANION_MAX_RANK,
  DELVE_PLATE_RADIUS,
  type DelveDef,
  type DelveModuleDef,
  type DelveRun,
  DT,
  dist2d,
  type Entity,
  INSTANCE_EMPTY_TIMEOUT,
  type Vec3,
} from '../types';

// Push-out radii (yards) for solid delve props, kept under the chest/grave interact
// range (DELVE_PLATE_RADIUS + 2 = 4.5) so you can still loot from adjacent. Pressure
// plates and open passages stay walkable (no entry here = radius 0).
const DELVE_CHEST_SOLID_R = 2.4; // matches the enlarged reliquary chest footprint
const DELVE_GRAVE_SOLID_R = 1.0;
const DELVE_WALL_SOLID_R = 3.2; // an intact (undestroyed) destructible wall
const DELVE_INTERACT_RANGE = 6;
const DELVE_BAD_AIR_INTERVAL = 8;
const DELVE_RAISE_DEAD_CHANNEL = 5;
const DELVE_EXIT_PORTAL_RADIUS = 3.5;
export const DELVE_MODULE_NAMES: Record<string, string> = {
  reliquary_sunken_ossuary: 'The Sunken Ossuary',
  reliquary_bell_niche: 'The Bell Niche',
  reliquary_saintless_hall: 'The Saintless Hall',
  reliquary_finale: 'The Bell-Buried Chamber',
};
// Lore journal entries unlocked one-per-clear across repeat runs (PRD §6.4 / §7.6).
// Ids match the `delveUi.lore.*` i18n keys.
const DELVE_LORE_ORDER = [
  'eastbrook_ledger',
  'first_collapse',
  'gravecaller_mark',
  'bell_below',
  'tessa_note',
] as const;
// Affixes that actually have a sim hook today; rollDelveAffixes only draws from
// these so a Heroic run never rolls an inert affix (PRD §6.7 v1 subset). The
// other registered crypt affixes (grave_tax / unstable_roof / cult_remnants)
// keep their UI/i18n entries but are excluded from the roll until implemented.
export const DELVE_IMPLEMENTED_AFFIXES = new Set<string>([
  'restless_graves',
  'bad_air',
  'candleblind',
]);

// ----- geometry / lookup helpers ---------------------------------------------

export function delveOriginOf(run: DelveRun): { x: number; z: number } {
  return delveOrigin(DELVES[run.delveId].index, run.slot);
}

export function delveModuleZOffset(run: DelveRun, moduleIndex = run.moduleIndex): number {
  return delveModuleZOffsetLayout(run.modules, moduleIndex);
}

export function delveOccupancyRadius(run: DelveRun): number {
  const mi = Math.max(0, run.modules.length - 1);
  const modId = run.modules[mi] as DelveModuleId;
  const layout = DELVE_MODULE_LAYOUTS[modId];
  const span = layout ? layout.zMax - layout.zMin : 50;
  return delveModuleZOffsetLayout(run.modules, mi) + span + 40;
}

export function delveRunForEntity(ctx: SimContext, e: Entity): DelveRun | null {
  const byPlayer = delveRunForPlayer(ctx, e.id);
  if (byPlayer) return byPlayer;
  return delveRunForMob(ctx, e.id);
}

// Confine an entity to the active module's interior box. Module-to-module
// travel is teleport-only (advanceDelveModule), so the 16u inter-module gap is
// never meant to be walkable: without this clamp the gap is an unsealed dead
// zone (no side walls) the player can slip into and walk out of the map, and
// it lets a freshly-transitioned player backtrack south into the prior room.
// Bounds come straight from the active module's own layout so they always
// match the room the player is actually standing in.
export function clampDelveModuleBounds(
  run: DelveRun,
  x: number,
  z: number,
  r: number,
): { x: number; z: number } {
  const moduleId = run.modules[run.moduleIndex] as DelveModuleId;
  const layout = DELVE_MODULE_LAYOUTS[moduleId];
  if (!layout) return { x, z };
  const wallX = layout.wallX ?? DUNGEON_WALL_X;
  const halfX = wallX - DUNGEON_WALL_HW - r; // inner wall face minus body radius
  const zBase = delveModuleZOffset(run);
  const localX = x - run.origin.x;
  const localZ = z - (run.origin.z + zBase);
  const clampedX = Math.max(-halfX, Math.min(halfX, localX));
  // Front/back end walls are DUNGEON_WALL_HW thick at zMin/zMax; keep the body
  // inside their inner faces.
  const minZ = layout.zMin + DUNGEON_WALL_HW + r;
  const maxZ = layout.zMax - DUNGEON_WALL_HW - r;
  const clampedZ = Math.max(minZ, Math.min(maxZ, localZ));
  return { x: clampedX + run.origin.x, z: clampedZ + run.origin.z + zBase };
}

// Closed portcullis doors block the full walkable aisle until all plates fire;
// solid props (chests, cracked graves, an intact destructible wall) block as
// circles so you cannot walk through them. Pressure plates and open passages
// stay walkable. Mobs and the companion route through the same clamp.
export function clampDelveDoors(
  ctx: SimContext,
  run: DelveRun,
  x: number,
  z: number,
  r: number,
): { x: number; z: number } {
  for (const id of run.objectIds) {
    const state = run.objectState[id];
    if (!state) continue;
    const obj = ctx.entities.get(id);
    if (!obj) continue;
    if (state.kind === 'locked_door') {
      if (state.open) continue;
      // Span the full walkable aisle (delve side walls at |x|=25, hw=1) so the
      // portcullis cannot be bypassed by skirting the centre mesh.
      const hw = 24,
        hd = 1.2;
      const dx = x - obj.pos.x,
        dz = z - obj.pos.z;
      const ox = Math.abs(dx) - hw - r;
      const oz = Math.abs(dz) - hd - r;
      if (ox < 0 && oz < 0) {
        if (ox > oz) x = obj.pos.x + Math.sign(dx || 1) * (hw + r);
        else z = obj.pos.z + Math.sign(dz || 1) * (hd + r);
      }
      continue;
    }
    let solidR = 0;
    if (state.kind === 'reward_chest' || state.kind === 'locked_chest')
      solidR = DELVE_CHEST_SOLID_R;
    else if (state.kind === 'cracked_grave') solidR = DELVE_GRAVE_SOLID_R;
    else if (state.kind === 'destructible_wall') solidR = obj.hp > 0 ? DELVE_WALL_SOLID_R : 0;
    if (solidR <= 0) continue;
    const dx = x - obj.pos.x,
      dz = z - obj.pos.z;
    const dist = Math.hypot(dx, dz);
    const min = solidR + r;
    if (dist < min) {
      if (dist > 1e-6) {
        x = obj.pos.x + (dx / dist) * min;
        z = obj.pos.z + (dz / dist) * min;
      } else x = obj.pos.x + min;
    }
  }
  return { x, z };
}

export function delveModuleEntry(ctx: SimContext, run: DelveRun): Vec3 {
  const moduleId = run.modules[run.moduleIndex] as DelveModuleId;
  const layout = DELVE_MODULE_LAYOUTS[moduleId];
  const entry = layout ? delveLayoutEntry(layout) : { x: 0, z: 8 };
  const zBase = delveModuleZOffset(run);
  return ctx.groundPos(run.origin.x + entry.x, run.origin.z + zBase + entry.z);
}

export function delveRunForPlayer(ctx: SimContext, pid: number): DelveRun | null {
  const e = ctx.entities.get(pid);
  if (!e) return null;
  const key = ctx.instanceKeyFor(pid);
  for (const run of ctx.delveRuns) {
    if (run.partyKey !== key) continue;
    const dx = Math.abs(e.pos.x - run.origin.x);
    const dz = Math.abs(e.pos.z - run.origin.z);
    if (dx <= 120 && dz <= delveOccupancyRadius(run)) return run;
  }
  if (!isDelvePos(e.pos.x)) return null;
  const delve = delveAt(e.pos.x);
  if (!delve) return null;
  return ctx.delveRuns.find((r) => r.delveId === delve.id && r.partyKey === key) ?? null;
}

export function delveRunForMob(ctx: SimContext, mobId: number): DelveRun | null {
  return ctx.delveRuns.find((r) => r.partyKey !== null && r.mobIds.includes(mobId)) ?? null;
}

export function refreshDelveDaily(ctx: SimContext, meta: PlayerMeta): void {
  // `utcDay` is supplied by the host (never read from the wall clock here, so the
  // sim stays deterministic). When unknown (''), the daily window does not roll
  // over, same-seed replays stay reproducible.
  const today = ctx.utcDay;
  if (today && meta.delveDaily.date !== today) {
    meta.delveDaily = { date: today, firstClearXp: new Set(), markClears: 0 };
  }
}

export function pickDelveModules(delve: DelveDef, seed: number, tierId: string): string[] {
  const rng = new Rng(seed);
  const pool = delve.modules.filter((id) => id !== delve.finaleModuleId);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // moduleCount is [normal, heroic] in tier order; pick by the tier's position so
  // a higher tier can run more rooms. Defaults to the Normal count if unmatched.
  const tierIdx = delve.tiers.findIndex((t) => t.id === tierId);
  const count = delve.moduleCount[tierIdx >= 0 ? tierIdx : 0] ?? delve.moduleCount[0];
  const picked = shuffled.slice(0, count);
  picked.push(delve.finaleModuleId);
  return picked;
}

// ----- pet stash (links to pets, P1) -----------------------------------------
// stowPetForDelve / restorePetFromDelveStash live in pet/pet_commands.ts (P1b, the
// pet domain owner) and are imported above; the delve lifecycle just calls them.

// ----- enter / leave / claim / spawn / free ----------------------------------

export function canEnterDelve(ctx: SimContext, pid: number): string | null {
  const r = ctx.resolve(pid);
  if (!r || r.e.dead) return 'You cannot enter a delve right now.';
  if (dungeonAt(r.e.pos.x)) return 'Leave the dungeon first.';
  if (isArenaPos(r.e.pos.x)) return 'Leave the arena first.';
  if (isDelvePos(r.e.pos.x)) return 'You are already in a delve.';
  if (ctx.tradeFor(pid)) return 'You cannot enter a delve while trading.';
  if (ctx.duelFor(pid)) return 'You cannot enter a delve during a duel.';
  if (ctx.arenaMatches.has(pid)) return 'You cannot enter a delve during an arena match.';
  return null;
}

export function enterDelve(ctx: SimContext, delveId: string, tierId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  const delve = DELVES[delveId];
  if (!r || !delve) return;
  const gate = canEnterDelve(ctx, r.meta.entityId);
  if (gate) {
    ctx.error(r.meta.entityId, gate);
    return;
  }
  if (!delve.tiers.some((t) => t.id === tierId)) {
    ctx.error(r.meta.entityId, 'Unknown delve tier.');
    return;
  }
  if (r.e.level < delve.minLevel) {
    ctx.error(r.meta.entityId, `You must be level ${delve.minLevel} to enter ${delve.name}.`);
    return;
  }
  const tierDef = delve.tiers.find((t) => t.id === tierId);
  if (tierDef?.minPlayerLevel && r.e.level < tierDef.minPlayerLevel) {
    ctx.error(
      r.meta.entityId,
      `You must be level ${tierDef.minPlayerLevel} to enter ${delve.name} on ${tierDef.label}.`,
    );
    return;
  }
  const key = ctx.instanceKeyFor(r.meta.entityId);
  let run = ctx.delveRuns.find((d) => d.delveId === delveId && d.partyKey === key);
  if (!run) {
    run = ctx.delveRuns.find((d) => d.delveId === delveId && d.partyKey === null);
    if (!run) {
      ctx.error(r.meta.entityId, `All instances of ${delve.name} are busy. Try again soon.`);
      return;
    }
    claimDelveRun(ctx, run, key, delveId, tierId);
  } else {
    run.emptyFor = 0;
  }
  stowPetForDelve(ctx, r.meta.entityId);
  const entry = delveModuleEntry(ctx, run);
  const p = r.e;
  p.pos = entry;
  p.prevPos = { ...entry };
  ctx.rebucket(p);
  p.facing = 0;
  p.targetId = null;
  p.autoAttack = false;
  run.emptyFor = 0;
  if (key.startsWith('solo:') && delve.autoCompanionId && !run.companion) {
    ctx.spawnDelveCompanion(run, r.meta.entityId, delve.autoCompanionId);
  }
  ctx.emit({ type: 'log', text: delve.enterText, color: '#b9f', pid: r.meta.entityId });
  ctx.emit({ type: 'delveEntered', delveId, tierId, pid: r.meta.entityId });
}

// Early-abandon path: drop the player back at the board door without completing
// (despawns the companion, restores the stowed pet, tears down any lockpick). The
// shipped in-delve exit instead runs through the 'surface_exit' interactable ->
// freeDelveRun, so this IWorld method (and its server 'leave_delve' command) is
// currently only reachable as scaffolding for a future explicit "Abandon Delve"
// control; kept wired in both worlds so that control needs no new plumbing.
export function leaveDelve(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r || r.e.dead) return;
  const run = delveRunForPlayer(ctx, r.meta.entityId);
  if (!run) return;
  const delve = DELVES[run.delveId];
  // Tear down the leaver's live lockpick session, if any (preserves the attempt).
  if (run.lockpick && run.lockpick.ownerId === r.meta.entityId) ctx.abandonLockpick(run);
  if (run?.companion) ctx.despawnDelveCompanion(run);
  restorePetFromDelveStash(ctx, r.meta.entityId);
  const p = r.e;
  p.pos = ctx.groundPos(delve.doorPos.x, delve.doorPos.z - 4);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.targetId = null;
  p.autoAttack = false;
  ctx.emit({ type: 'log', text: delve.leaveText, color: '#b9f', pid: r.meta.entityId });
}

export function claimDelveRun(
  ctx: SimContext,
  run: DelveRun,
  key: string,
  delveId: string,
  tierId: string,
): void {
  const delve = DELVES[delveId];
  run.partyKey = key;
  run.seed = ctx.rng.int(1, 0x7fffffff);
  run.tierId = tierId;
  // §7.6, roll Bountiful once at run start (Heroic 5% / Normal 2%). Derived from
  // run.seed in its own stream (like affixes/modules) so it is deterministic
  // without perturbing the global rng draw order that the chest loot depends on.
  run.bountiful = new Rng((run.seed ^ 0x600dc0ff) >>> 0).chance(tierId === 'heroic' ? 0.05 : 0.02);
  run.affixes = rollDelveAffixes(delve, tierId, run.seed);
  run.modules = pickDelveModules(delve, run.seed, tierId);
  run.moduleIndex = 0;
  run.completed = false;
  run.emptyFor = 0;
  run.deathsThisRun = {};
  run.objectState = {};
  run.raiseDeadChannel = null;
  run.restlessPending = [];
  run.badAirTimer = 0;
  run.companionBarks = [];
  run.companion = undefined;
  run.exitPortalOpen = false;
  run.rewardChestId = null;
  run.surfaceExitId = null;
  run.objective = { kind: delve.objective, counts: [0], complete: false };
  const origin = delveOriginOf(run);
  run.origin = { x: origin.x, z: origin.z };
  spawnDelveModule(ctx, run);
}

export function spawnDelveModule(ctx: SimContext, run: DelveRun): void {
  for (const id of run.mobIds) {
    if (!ctx.entities.has(id)) continue;
    for (const meta of ctx.players.values()) {
      const e = ctx.entities.get(meta.entityId);
      if (e?.targetId === id) e.targetId = null;
      if (e?.comboTargetId === id) {
        e.comboTargetId = null;
        e.comboPoints = 0;
      }
    }
    ctx.dropEntity(id);
  }
  run.mobIds = [];
  for (const id of run.objectIds) {
    if (ctx.entities.has(id)) ctx.dropEntity(id);
  }
  run.objectIds = [];
  run.objectState = {};
  run.raiseDeadChannel = null;
  run.exitPortalOpen = false;
  run.rewardChestId = null;
  run.surfaceExitId = null;

  const moduleId = run.modules[run.moduleIndex];
  const mod = DELVE_MODULES[moduleId];
  if (!mod) return;
  const delve = DELVES[run.delveId];
  const tier = delve.tiers.find((t) => t.id === run.tierId) ?? delve.tiers[0];
  const zBase = delveModuleZOffset(run);
  const spawnSet = pickDelveSpawnSet(mod, run.seed, run.moduleIndex);
  if (!spawnSet) return;
  for (const spawn of spawnSet.spawns) {
    const template = MOBS[spawn.mobId];
    if (!template) continue;
    const level = template.minLevel + tier.enemyLevelBonus;
    const mob = createMob(
      ctx.nextId++,
      template,
      level,
      ctx.groundPos(run.origin.x + spawn.x, run.origin.z + zBase + spawn.z),
    );
    mob.facing = Math.PI;
    mob.prevFacing = mob.facing;
    ctx.addEntity(mob);
    run.mobIds.push(mob.id);
  }
  spawnDelveInteractables(ctx, run, mod, zBase);
  const isFinale = mod.id === delve.finaleModuleId || run.moduleIndex >= run.modules.length - 1;
  if (!isFinale) spawnDelveModuleExit(ctx, run, mod, zBase);
  emitDelveModuleEnter(ctx, run, mod);
  if (run.companion) {
    const companion = ctx.entities.get(run.companion.entityId);
    if (companion) {
      const entry = delveModuleEntry(ctx, run);
      companion.pos = ctx.groundPos(entry.x + 1.5, entry.z);
      companion.prevPos = { ...companion.pos };
      ctx.rebucket(companion);
    }
  }
}

export function freeDelveRun(ctx: SimContext, run: DelveRun): void {
  ctx.abandonLockpick(run);
  if (run.companion) ctx.despawnDelveCompanion(run);
  for (const id of run.mobIds) {
    if (!ctx.entities.has(id)) continue;
    for (const meta of ctx.players.values()) {
      const e = ctx.entities.get(meta.entityId);
      if (e?.targetId === id) e.targetId = null;
      if (e?.comboTargetId === id) {
        e.comboTargetId = null;
        e.comboPoints = 0;
      }
    }
    ctx.dropEntity(id);
  }
  for (const id of run.objectIds) {
    if (ctx.entities.has(id)) ctx.dropEntity(id);
  }
  run.partyKey = null;
  run.seed = 0;
  run.tierId = 'normal';
  run.affixes = [];
  run.modules = [];
  run.moduleIndex = 0;
  run.mobIds = [];
  run.objectIds = [];
  run.objective = { kind: DELVES[run.delveId].objective, counts: [0], complete: false };
  run.completed = false;
  run.emptyFor = 0;
  run.deathsThisRun = {};
  run.objectState = {};
  run.raiseDeadChannel = null;
  run.restlessPending = [];
  run.badAirTimer = 0;
  run.companionBarks = [];
  run.companion = undefined;
  run.exitPortalOpen = false;
  run.bountiful = false;
  run.rewardChestId = null;
  run.surfaceExitId = null;
  run.lockpick = null;
}

// ----- tick driver + run progression -----------------------------------------

export function updateDelveRuns(ctx: SimContext): void {
  for (const run of ctx.delveRuns) {
    // The lockpick per-step clock is enforced for EVERY run (a solo offline run
    // has partyKey === null and is skipped by tickDelveRun below, but its lock
    // must still time out identically to an online/headless one).
    ctx.tickLockpickTimeout(run);
    if (run.partyKey !== null) tickDelveRun(ctx, run);
  }
  if (ctx.tickCount % 20 !== 0) return;
  for (const run of ctx.delveRuns) {
    if (run.partyKey === null) continue;
    const origin = run.origin;
    let occupied = false;
    for (const meta of ctx.players.values()) {
      const e = ctx.entities.get(meta.entityId);
      if (
        e &&
        Math.abs(e.pos.x - origin.x) < 120 &&
        Math.abs(e.pos.z - origin.z) < delveOccupancyRadius(run)
      ) {
        occupied = true;
        break;
      }
    }
    if (occupied) run.emptyFor = 0;
    else {
      run.emptyFor += 1;
      if (run.emptyFor >= INSTANCE_EMPTY_TIMEOUT) freeDelveRun(ctx, run);
    }
  }
}

export function ejectToDelveDoor(ctx: SimContext, pid: number, delve: DelveDef): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const p = r.e;
  p.dead = false;
  p.pos = ctx.groundPos(delve.doorPos.x, delve.doorPos.z - 4);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.facing = 0;
  p.auras = [];
  p.ccDr.clear();
  recalcPlayerStats(p, r.meta.cls, r.meta.equipment, r.meta.talentMods);
  p.hp = p.maxHp;
  p.resource = p.resourceType === 'mana' ? p.maxResource : p.resourceType === 'energy' ? 100 : 0;
  p.targetId = null;
  p.combatTimer = 99;
  p.inCombat = false;
  p.autoAttack = false;
}

export function failDelveRun(ctx: SimContext, run: DelveRun): void {
  const delve = DELVES[run.delveId];
  const members = run.partyKey ? ctx.partyMembersForKey(run.partyKey) : [];
  for (const pid of members) {
    restorePetFromDelveStash(ctx, pid);
    ejectToDelveDoor(ctx, pid, delve);
    ctx.emit({ type: 'delveFailed', delveId: run.delveId, tierId: run.tierId, pid });
    ctx.emit({ type: 'log', text: `${delve.name} run failed.`, color: '#f66', pid });
  }
  freeDelveRun(ctx, run);
}

export function onDelveBossDefeated(ctx: SimContext, run: DelveRun): void {
  // Guard against double-spawn (e.g. if called twice due to a race)
  if (run.rewardChestId !== null) return;
  const delve = DELVES[run.delveId];
  const moduleId = run.modules[run.moduleIndex] as DelveModuleId;
  if (moduleId !== delve.finaleModuleId) return;
  const layout = DELVE_MODULE_LAYOUTS[moduleId];
  const zBase = delveModuleZOffset(run);
  const dais = layout?.dais ?? { x: 0, z: 52 };
  // Centre aisle, toward the entrance (south) edge of the dais and facing the
  // approaching player, clear of the north surface-exit stairs at dais.z+6.
  const chestLocalZ = dais.z - 14;
  const chestPos = ctx.groundPos(run.origin.x, run.origin.z + zBase + chestLocalZ);
  // Drop any stale module_exit (same z as dais / north passage) before placing the chest.
  for (const id of [...run.objectIds]) {
    if (run.objectState[id]?.kind !== 'module_exit') continue;
    ctx.dropEntity(id);
    run.objectIds = run.objectIds.filter((oid) => oid !== id);
    delete run.objectState[id];
  }
  const chest = createDelveObject(ctx, run, 'locked_chest', chestPos);
  chest.facing = Math.PI; // face south, toward the player entering from the aisle
  chest.prevFacing = Math.PI;
  run.rewardChestId = chest.id;
  run.objectState[chest.id].attemptAvailable = true;
  if (!run.partyKey) return;
  for (const pid of ctx.partyMembersForKey(run.partyKey)) {
    ctx.emit({
      type: 'log',
      text: 'The boss falls. A warded reliquary chest rises on the dais. Pick its lock to claim your spoils.',
      color: '#8f8',
      pid,
    });
  }
}

// Base Marks payout for one clear. PRD §6.5 FR-5.3: full Marks for the first 3
// completions per UTC day, then a diminished payout (Heroic 1 guaranteed, Normal
// 50% chance of 1). §6.7 FR-7.1 Heroic "+30% Marks" rides the tier `rewardMult`.
// Reads `markClears` BEFORE the caller increments it. NOTE: at the base of 1 Mark
// the +30% rounds to no per-clear difference; the Heroic mark advantage comes from
// the post-3 guaranteed-vs-50% rule. Uses `ctx.rng` only (deterministic).
export function delveMarkPayout(ctx: SimContext, run: DelveRun, meta: PlayerMeta): number {
  const isHeroic = run.tierId === 'heroic';
  // First 3 clears/day pay full: 1 Normal / 2 Heroic (§7.4). After that, Heroic
  // still guarantees 1; Normal has a 50% shot. (The old `Math.round(rewardMult)`
  // rounded Heroic's 1.3 down to 1, silently erasing the Heroic advantage.)
  if (meta.delveDaily.markClears < 3) return isHeroic ? 2 : 1;
  if (isHeroic) return 1;
  return ctx.rng.chance(0.5) ? 1 : 0;
}

// Unlock the next un-owned lore journal entry (PRD §6.4 / §7.6, five entries
// across repeat clears). Emits a stable lore id (no English crosses the sim
// boundary); the client localises it via the `delveUi.lore.*` keys.
export function unlockNextDelveLore(ctx: SimContext, meta: PlayerMeta, pid: number): void {
  const idx = meta.delveLoreUnlocked.size;
  if (idx >= DELVE_LORE_ORDER.length) return;
  const loreId = DELVE_LORE_ORDER[idx];
  meta.delveLoreUnlocked.add(loreId);
  ctx.emit({ type: 'delveLoreUnlock', loreId, pid });
}

// Shared per-member clear economy used by BOTH completion paths so they cannot
// diverge: daily reset, first-vs-repeat XP, Marks (FR-5.3), clear tally, copper,
// next lore entry, pet restore, and the delveComplete event.
export function grantDelveClearTo(
  ctx: SimContext,
  run: DelveRun,
  delve: DelveDef,
  meta: PlayerMeta,
  pid: number,
): void {
  refreshDelveDaily(ctx, meta);
  const tier = delve.tiers.find((t) => t.id === run.tierId);
  const clearKey = `${run.delveId}:${run.tierId}`;
  const firstClear = !meta.delveDaily.firstClearXp.has(clearKey);
  // Per-tier reward overrides (Heroic 1050/650, copper 16-24) fall back to the
  // delve's Normal baseRewards when a tier omits them.
  const xp = firstClear
    ? (tier?.firstClearXp ?? delve.baseRewards.firstClearXp)
    : (tier?.repeatClearXp ?? delve.baseRewards.repeatClearXp);
  if (firstClear) meta.delveDaily.firstClearXp.add(clearKey);
  const marks = delveMarkPayout(ctx, run, meta);
  meta.delveDaily.markClears += 1;
  meta.delveMarks += marks;
  meta.delveClears[clearKey] = (meta.delveClears[clearKey] ?? 0) + 1;
  ctx.grantXp(xp, meta);
  const copper = ctx.rng.int(
    tier?.copperMin ?? delve.baseRewards.copperMin,
    tier?.copperMax ?? delve.baseRewards.copperMax,
  );
  meta.copper += copper;
  unlockNextDelveLore(ctx, meta, pid);
  ctx.maybeCompanionBark(run, pid, 'completion');
  restorePetFromDelveStash(ctx, pid);
  ctx.emit({ type: 'delveComplete', delveId: run.delveId, tierId: run.tierId, pid });
}

export function grantDelveRewards(ctx: SimContext, run: DelveRun): void {
  if (run.completed) return;
  run.completed = true;
  const delve = DELVES[run.delveId];
  const members = run.partyKey ? ctx.partyMembersForKey(run.partyKey) : [];
  for (const pid of members) {
    const meta = ctx.players.get(pid);
    if (!meta) continue;
    grantDelveClearTo(ctx, run, delve, meta, pid);
  }
}

export function openDelveSurfaceExit(ctx: SimContext, run: DelveRun): void {
  if (run.surfaceExitId !== null) return;
  const moduleId = run.modules[run.moduleIndex] as DelveModuleId;
  const layout = DELVE_MODULE_LAYOUTS[moduleId];
  const zBase = delveModuleZOffset(run);
  const dais = layout?.dais ?? { x: 0, z: 52 };
  const exitLocalZ = Math.min(layout.zMax - 2, dais.z + 6);
  const exitPos = ctx.groundPos(run.origin.x + dais.x, run.origin.z + zBase + exitLocalZ);
  const exitObj = createDelveObject(ctx, run, 'surface_exit', exitPos);
  run.objectState[exitObj.id].open = true;
  run.surfaceExitId = exitObj.id;
  if (!run.partyKey) return;
  for (const pid of ctx.partyMembersForKey(run.partyKey)) {
    ctx.emit({
      type: 'log',
      text: 'A stairway to the surface opens. Press F at the stairs to leave.',
      color: '#8cf',
      pid,
    });
  }
}

export function pickDelveSpawnSet(mod: DelveModuleDef, seed: number, moduleIndex: number) {
  if (!mod.spawnSets.length) return null;
  if (mod.spawnSets.length === 1) return mod.spawnSets[0];
  const rng = new Rng(seed ^ (moduleIndex * 7919));
  const total = mod.spawnSets.reduce((sum, set) => sum + set.weight, 0);
  let roll = rng.int(1, total);
  for (const set of mod.spawnSets) {
    roll -= set.weight;
    if (roll <= 0) return set;
  }
  return mod.spawnSets[0];
}

export function spawnDelveInteractables(
  ctx: SimContext,
  run: DelveRun,
  mod: DelveModuleDef,
  zBase: number,
): void {
  const spawned: { kind: string; id: number }[] = [];
  for (const slot of mod.interactableSlots) {
    for (const variant of slot.variants) {
      if (variant === 'darkness_zone') continue;
      const pos = ctx.groundPos(run.origin.x + slot.x, run.origin.z + zBase + slot.z);
      const obj = createDelveObject(ctx, run, variant, pos);
      spawned.push({ kind: variant, id: obj.id });
    }
  }
  // Link every pressure plate in this module to every locked door.
  // A door only opens once ALL plates that reference it are triggered.
  const plates = spawned.filter((s) => s.kind === 'pressure_plate');
  const doors = spawned.filter((s) => s.kind === 'locked_door');
  for (const door of doors) {
    run.objectState[door.id].open = false;
  }
  for (const plate of plates) {
    run.objectState[plate.id].linkIds = doors.map((d) => d.id);
  }
}

export function createDelveObject(ctx: SimContext, run: DelveRun, kind: string, pos: Vec3): Entity {
  const names: Record<string, string> = {
    pressure_plate: 'Pressure Plate',
    locked_door: 'Locked Door',
    cracked_grave: 'Cracked Grave',
    destructible_wall: 'Cracked Wall',
    module_exit: 'Sealed Passage',
    reward_chest: 'Reliquary Chest',
    locked_chest: 'Warded Reliquary Chest',
    surface_exit: 'Ascend to the Surface',
  };
  const maxHp = kind === 'destructible_wall' ? 80 : 1;
  const obj = createGroundObject(ctx.nextId++, '', names[kind] ?? kind, pos);
  obj.templateId = `delve_${kind}`;
  obj.maxHp = maxHp;
  obj.hp = maxHp;
  obj.lootable = kind === 'cracked_grave' || kind === 'destructible_wall' || kind === 'module_exit';
  const startOpen = kind !== 'locked_door' && kind !== 'locked_chest';
  run.objectState[obj.id] = {
    kind,
    triggered: false,
    hp: maxHp,
    maxHp,
    linkIds: [],
    open: startOpen,
  };
  run.objectIds.push(obj.id);
  ctx.addEntity(obj);
  return obj;
}

export function tickDelveRun(ctx: SimContext, run: DelveRun): void {
  tickDelvePressurePlates(ctx, run);
  tickDelveModuleExit(ctx, run);
  tickDelveRaiseDeadChannel(ctx, run);
  tickDelveBadAir(ctx, run);
  tickDelveRestlessGraves(ctx, run);
}

export function emitDelveModuleEnter(ctx: SimContext, run: DelveRun, mod: DelveModuleDef): void {
  if (!run.partyKey) return;
  const modName = DELVE_MODULE_NAMES[mod.id] ?? mod.id;
  const isFinale = run.moduleIndex >= run.modules.length - 1;
  for (const pid of ctx.partyMembersForKey(run.partyKey)) {
    // Keep the objective as a literal at each emit site (not a variable) so the
    // S3 guard sees the full "<module>: Clear the room." / ": Defeat the boss."
    // strings the sim_i18n rules are anchored on.
    ctx.emit({
      type: 'log',
      text: isFinale ? `${modName}: Defeat the boss.` : `${modName}: Clear the room.`,
      color: '#cc9',
      pid,
    });
    if (run.moduleIndex === 0 && !isFinale) {
      ctx.emit({
        type: 'log',
        text: 'A tombstone passage opens to the north when the room is cleared.',
        color: '#aaa',
        pid,
      });
    }
  }
}

export function spawnDelveModuleExit(
  ctx: SimContext,
  run: DelveRun,
  mod: DelveModuleDef,
  zBase: number,
): void {
  const layout = DELVE_MODULE_LAYOUTS[mod.layout as DelveModuleId];
  if (!layout) return;
  const pos = ctx.groundPos(run.origin.x, run.origin.z + zBase + layout.zMax - 6);
  const obj = createDelveObject(ctx, run, 'module_exit', pos);
  run.objectState[obj.id].open = false;
  obj.name = 'Sealed Passage';
}

export function findDelveExitPortal(ctx: SimContext, run: DelveRun): Entity | null {
  for (const id of run.objectIds) {
    if (run.objectState[id]?.kind === 'module_exit') return ctx.entities.get(id) ?? null;
  }
  return null;
}

export function tryOpenDelveExitPortal(ctx: SimContext, run: DelveRun): void {
  if (run.exitPortalOpen || run.moduleIndex >= run.modules.length - 1) return;
  const liveMobs = run.mobIds.some((id) => {
    const e = ctx.entities.get(id);
    return e && !e.dead;
  });
  if (liveMobs) return;
  const plates = run.objectIds.filter((id) => run.objectState[id]?.kind === 'pressure_plate');
  if (plates.length > 0 && !plates.some((id) => run.objectState[id].triggered)) return;
  openDelveExitPortal(ctx, run);
}

export function openDelveExitPortal(ctx: SimContext, run: DelveRun): void {
  if (run.exitPortalOpen) return;
  run.exitPortalOpen = true;
  const portal = findDelveExitPortal(ctx, run);
  if (portal) {
    run.objectState[portal.id].open = true;
    portal.name = 'Exit to next chamber';
  }
  if (!run.partyKey) return;
  for (const pid of ctx.partyMembersForKey(run.partyKey)) {
    ctx.emit({
      type: 'log',
      text: 'A sealed tombstone passage grinds open to the north. Walk into it to continue.',
      color: '#8cf',
      pid,
    });
  }
}

export function advanceDelveModule(ctx: SimContext, run: DelveRun): void {
  if (!run.exitPortalOpen || run.moduleIndex >= run.modules.length - 1) return;
  const members = run.partyKey ? ctx.partyMembersForKey(run.partyKey) : [];
  run.moduleIndex += 1;
  spawnDelveModule(ctx, run);
  const entry = delveModuleEntry(ctx, run);
  const modId = run.modules[run.moduleIndex];
  const modName = modId ? (DELVE_MODULE_NAMES[modId] ?? modId) : 'the next chamber';
  for (const pid of members) {
    const p = ctx.entities.get(pid);
    if (!p || p.dead) continue;
    p.pos = entry;
    p.prevPos = { ...entry };
    ctx.rebucket(p);
    p.facing = 0;
    ctx.emit({
      type: 'log',
      text: `You pass through the tombstone into ${modName}.`,
      color: '#b9f',
      pid,
    });
  }
}

export function tickDelveModuleExit(ctx: SimContext, run: DelveRun): void {
  if (!run.exitPortalOpen) {
    tryOpenDelveExitPortal(ctx, run);
    return;
  }
  const portal = findDelveExitPortal(ctx, run);
  if (!portal || !run.partyKey) return;
  for (const pid of ctx.partyMembersForKey(run.partyKey)) {
    const p = ctx.entities.get(pid);
    if (!p || p.dead) continue;
    if (dist2d(p.pos, portal.pos) <= DELVE_EXIT_PORTAL_RADIUS) {
      advanceDelveModule(ctx, run);
      return;
    }
  }
}

export function tickDelvePressurePlates(ctx: SimContext, run: DelveRun): void {
  for (const id of run.objectIds) {
    const state = run.objectState[id];
    if (state?.kind !== 'pressure_plate' || state.triggered) continue;
    const plate = ctx.entities.get(id);
    if (!plate || !run.partyKey) continue;
    for (const pid of ctx.partyMembersForKey(run.partyKey)) {
      const p = ctx.entities.get(pid);
      if (!p || p.dead) continue;
      const d = dist2d(p.pos, plate.pos);
      // Companion warns when a party member first nears an un-triggered plate.
      if (d <= DELVE_PLATE_RADIUS + 4) ctx.maybeCompanionBark(run, pid, 'trap_spotted');
      if (d > DELVE_PLATE_RADIUS) continue;
      state.triggered = true;
      // Switch the visual to the triggered (green) variant, renderer rebuilds the view.
      plate.templateId = 'delve_pressure_plate_triggered';
      // Open each linked door only when ALL plates referencing it are triggered.
      for (const linkId of state.linkIds) {
        const linked = run.objectState[linkId];
        if (linked?.kind !== 'locked_door' || linked.open) continue;
        const allTriggered = run.objectIds.every((oid) => {
          const s = run.objectState[oid];
          if (s?.kind !== 'pressure_plate') return true;
          if (!s.linkIds.includes(linkId)) return true;
          return s.triggered;
        });
        if (!allTriggered) continue;
        linked.open = true;
        const doorEnt = ctx.entities.get(linkId);
        if (doorEnt) ctx.dropEntity(linkId);
        for (const party of ctx.partyMembersForKey(run.partyKey)) {
          ctx.emit({
            type: 'log',
            text: 'A mechanism clicks open nearby. A passage opens to the north. Find the exit portal ahead.',
            color: '#cc9',
            pid: party,
          });
        }
      }
      break;
    }
  }
}

export function tickDelveRaiseDeadChannel(ctx: SimContext, run: DelveRun): void {
  const channel = run.raiseDeadChannel;
  if (!channel) return;
  channel.remaining -= DT;
  if (channel.remaining > 0) return;
  run.raiseDeadChannel = null;
  const boss = ctx.entities.get(channel.bossId);
  if (boss && !boss.dead) {
    ctx.spawnBossAdds(boss, channel.mobId, channel.count);
    // Raise Dead resolved uninterrupted (PRD §7.4 telegraph): mirror of the
    // interrupt-success line emitted from delveInteract on the cracked grave.
    ctx.emit({
      type: 'log',
      text: "The dead answer Deacon Varric's call!",
      color: '#f96',
      entityId: boss.id,
    });
  }
}

export function tickDelveBadAir(ctx: SimContext, run: DelveRun): void {
  if (!run.affixes.includes('bad_air')) return;
  run.badAirTimer += DT;
  if (run.badAirTimer < DELVE_BAD_AIR_INTERVAL) return;
  run.badAirTimer = 0;
  if (!run.partyKey) return;
  for (const pid of ctx.partyMembersForKey(run.partyKey)) {
    const p = ctx.entities.get(pid);
    if (!p || p.dead) continue;
    ctx.applyAura(p, {
      id: 'bad_air',
      name: 'Bad Air',
      kind: 'dot',
      school: 'nature',
      remaining: 4,
      duration: 4,
      value: 3,
      tickInterval: 2,
      tickTimer: 2,
      sourceId: p.id,
    });
  }
}

export function tickDelveRestlessGraves(ctx: SimContext, run: DelveRun): void {
  if (!run.restlessPending.length) return;
  const ready: typeof run.restlessPending = [];
  const pending: typeof run.restlessPending = [];
  for (const spawn of run.restlessPending) {
    if (spawn.at <= ctx.time) ready.push(spawn);
    else pending.push(spawn);
  }
  run.restlessPending = pending;
  for (const spawn of ready) {
    const template = MOBS[spawn.mobId];
    if (!template) continue;
    const mob = createMob(
      ctx.nextId++,
      template,
      template.minLevel,
      ctx.groundPos(spawn.x, spawn.z),
    );
    mob.facing = Math.PI;
    ctx.addEntity(mob);
    run.mobIds.push(mob.id);
  }
}

export function rollDelveAffixes(delve: DelveDef, tierId: string, seed: number): string[] {
  const tier = delve.tiers.find((t) => t.id === tierId) ?? delve.tiers[0];
  if (tier.affixCount <= 0) return [];
  const pool = Object.values(DELVE_AFFIXES).filter(
    (a) => !a.blessing && a.themes.includes(delve.theme) && DELVE_IMPLEMENTED_AFFIXES.has(a.id),
  );
  if (!pool.length) return [];
  const rng = new Rng(seed ^ 0x5a11c0de);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(tier.affixCount, shuffled.length)).map((a) => a.id);
}

export function delveDetectMult(ctx: SimContext, player: Entity): number {
  const run = delveRunForPlayer(ctx, player.id);
  if (!run?.affixes.includes('candleblind')) return 1;
  return 0.65;
}

export function findDelveObject(ctx: SimContext, run: DelveRun, kind: string): Entity | null {
  for (const id of run.objectIds) {
    if (run.objectState[id]?.kind === kind) return ctx.entities.get(id) ?? null;
  }
  return null;
}

export function startDelveRaiseDeadChannel(
  ctx: SimContext,
  run: DelveRun,
  boss: Entity,
  mobId: string,
  count: number,
): boolean {
  const grave = findDelveObject(ctx, run, 'cracked_grave');
  if (!grave) return false;
  run.raiseDeadChannel = {
    graveId: grave.id,
    bossId: boss.id,
    mobId,
    count,
    remaining: DELVE_RAISE_DEAD_CHANNEL,
  };
  ctx.emit({
    type: 'log',
    text: `${boss.name} begins Raise Dead.`,
    color: '#f96',
    entityId: boss.id,
  });
  return true;
}

// ----- interact + reward delivery --------------------------------------------

export function delveInteract(ctx: SimContext, objectId: number, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  let run = delveRunForPlayer(ctx, r.meta.entityId);
  if (!run) {
    run = ctx.delveRuns.find((d) => d.partyKey !== null && d.objectIds.includes(objectId)) ?? null;
  }
  if (!run) {
    ctx.error(r.meta.entityId, 'You are not in a delve.');
    return;
  }
  const state = run.objectState[objectId];
  const obj = ctx.entities.get(objectId);
  if (!state || !obj || !run.objectIds.includes(objectId)) {
    ctx.error(r.meta.entityId, 'You cannot interact with that.');
    return;
  }
  if (dist2d(r.e.pos, obj.pos) > DELVE_INTERACT_RANGE) {
    ctx.error(r.meta.entityId, 'You are too far away.');
    return;
  }
  if (state.kind === 'cracked_grave') {
    if (run.raiseDeadChannel) {
      run.raiseDeadChannel = null;
      ctx.emit({
        type: 'log',
        text: 'The grave rite falters.',
        color: '#8f8',
        pid: r.meta.entityId,
      });
    } else {
      ctx.error(r.meta.entityId, 'The grave is silent for now.');
    }
    return;
  }
  if (state.kind === 'locked_door') {
    if (state.open)
      ctx.emit({
        type: 'log',
        text: 'The door is already open.',
        color: '#aaa',
        pid: r.meta.entityId,
      });
    else ctx.error(r.meta.entityId, 'The door is locked.');
    return;
  }
  if (state.kind === 'destructible_wall') {
    ctx.error(r.meta.entityId, 'Strike the wall to break through.');
    return;
  }
  if (state.kind === 'module_exit') {
    if (!state.open) {
      ctx.error(r.meta.entityId, 'The passage is sealed.');
      return;
    }
    if (dist2d(r.e.pos, obj.pos) > DELVE_EXIT_PORTAL_RADIUS + 2) {
      ctx.error(r.meta.entityId, 'Move closer to the passage.');
      return;
    }
    advanceDelveModule(ctx, run);
    return;
  }
  if (state.kind === 'locked_chest') {
    if (dist2d(r.e.pos, obj.pos) > DELVE_PLATE_RADIUS + 2) {
      ctx.error(r.meta.entityId, 'Move closer to the chest.');
      return;
    }
    if (state.looted) {
      ctx.emit({
        type: 'log',
        text: 'The chest is empty.',
        color: '#aaa',
        pid: r.meta.entityId,
      });
      return;
    }
    if (!state.attemptAvailable) {
      ctx.error(
        r.meta.entityId,
        'The lock is jammed beyond picking. Clear the delve again for another attempt.',
      );
      return;
    }
    if (run.lockpick && run.lockpick.state === 'IN_PROGRESS') {
      // Someone is already picking it (single interactor, v1).
      if (run.lockpick.ownerId !== r.meta.entityId) {
        ctx.error(r.meta.entityId, 'Someone is already working the lock.');
      }
      return;
    }
    // Open the ante selector on the client; no session yet. A Bountiful Coffer
    // (purple) tells the client to force the Hard/Premium ante (§7.6).
    const isCoffer = run.bountiful && objectId === run.rewardChestId;
    // No per-move budget on the offer: the clock is an ante dial, so the client
    // shows each ante's own time from ANTE_TO_STEP_TIMEOUT_MS in the selector.
    ctx.emit({ type: 'lockpickOffer', objectId, bountiful: isCoffer, pid: r.meta.entityId });
    return;
  }
  if (state.kind === 'reward_chest') {
    if (dist2d(r.e.pos, obj.pos) > DELVE_PLATE_RADIUS + 2) {
      ctx.error(r.meta.entityId, 'Move closer to the chest.');
      return;
    }
    if (state.open && state.triggered) {
      ctx.emit({
        type: 'log',
        text: 'The chest is empty.',
        color: '#aaa',
        pid: r.meta.entityId,
      });
      return;
    }
    grantDelveRewards(ctx, run);
    state.triggered = true;
    state.open = true;
    obj.name = 'Opened Chest';
    openDelveSurfaceExit(ctx, run);
    return;
  }
  if (state.kind === 'surface_exit') {
    if (!state.open) {
      ctx.error(r.meta.entityId, 'The way out is not yet open.');
      return;
    }
    if (dist2d(r.e.pos, obj.pos) > DELVE_EXIT_PORTAL_RADIUS + 2) {
      ctx.error(r.meta.entityId, 'Move closer to the stairs.');
      return;
    }
    const delve = DELVES[run.delveId];
    const members = run.partyKey ? ctx.partyMembersForKey(run.partyKey) : [];
    for (const pid of members) {
      restorePetFromDelveStash(ctx, pid);
      ejectToDelveDoor(ctx, pid, delve);
    }
    freeDelveRun(ctx, run);
    return;
  }
  ctx.error(r.meta.entityId, 'Nothing happens.');
}

/** Claim item loot from an opened delve chest (shown on the loot overlay). */
export function collectDelveChestLoot(ctx: SimContext, chestId: number, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const run = delveRunForPlayer(ctx, r.meta.entityId);
  if (!run) return;
  const state = run.objectState[chestId];
  const obj = ctx.entities.get(chestId);
  if (state?.kind !== 'locked_chest' || !state.pendingLoot?.length) {
    ctx.error(r.meta.entityId, 'There is nothing left to take.');
    return;
  }
  if (state.lootOwnerId != null && state.lootOwnerId !== r.meta.entityId) {
    ctx.error(r.meta.entityId, 'There is nothing left to take.');
    return;
  }
  if (!obj || dist2d(r.e.pos, obj.pos) > DELVE_PLATE_RADIUS + 2) {
    ctx.error(r.meta.entityId, 'Move closer to the chest.');
    return;
  }
  for (const slot of state.pendingLoot) {
    ctx.addItem(slot.itemId, slot.count, r.meta.entityId);
  }
  state.pendingLoot = [];
}

// ----- companion economy + shop + wire getters -------------------------------

export function companionUpgrade(ctx: SimContext, companionId: string, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const def = DELVE_COMPANIONS[companionId];
  if (!def) {
    ctx.error(r.meta.entityId, 'Unknown companion.');
    return;
  }
  const rank = r.meta.companionUpgrades[companionId] ?? 1;
  if (rank >= DELVE_COMPANION_MAX_RANK) {
    ctx.error(r.meta.entityId, 'This companion is already fully upgraded.');
    return;
  }
  const next = rank + 1;
  const cost = COMPANION_UPGRADE_COSTS[next];
  if (!cost) return;
  if (r.meta.delveMarks < cost.marks) {
    ctx.error(r.meta.entityId, `You need ${cost.marks} Delve Marks to upgrade ${def.name}.`);
    return;
  }
  if (r.meta.copper < cost.copper) {
    ctx.error(r.meta.entityId, 'You cannot afford this upgrade.');
    return;
  }
  r.meta.delveMarks -= cost.marks;
  r.meta.copper -= cost.copper;
  r.meta.companionUpgrades[companionId] = next;
  ctx.emit({
    type: 'log',
    text: `${def.name} reaches rank ${next}.`,
    color: '#8f8',
    pid: r.meta.entityId,
  });
}

// Has the player unlocked a Marks-vendor entry? `available` is always open;
// `clears:N` counts total clears of this delve at ANY difficulty; `heroicClear`
// requires at least one Heroic (difficulty ≥ 2) completion. Delegates to the pure
// content helper so the server-authoritative buy and the client lock badge
// (ClientWorld) agree, same answer offline, on the server, and headless.
export function delveShopGateMet(meta: PlayerMeta, delveId: string, gate: DelveShopGate): boolean {
  return delveShopGateUnlocked(meta.delveClears, delveId, gate);
}

// Brother Halven's stock for `delveId`, each entry resolved against this player's
// clears (unlock state). The client renders the lock badge from this; the buy is
// re-validated server-side in delveBuyShopItem regardless of what the UI shows.
export function delveShopOffersFor(
  ctx: SimContext,
  delveId: string,
  pid: number,
): DelveShopOffer[] {
  return resolveDelveShopOffers(delveId, ctx.players.get(pid)?.delveClears ?? {});
}

// Per-player clears map for the self-snapshot wire (so the online client can
// resolve shop lock state without the server shipping the whole offer list).
export function delveClearsFor(ctx: SimContext, pid: number): Record<string, number> {
  return { ...(ctx.players.get(pid)?.delveClears ?? {}) };
}

// Server-authoritative Marks-vendor purchase. Re-validates the gate + balance
// here regardless of what the client shows; the client only sends intent. The
// server geo-gates this to the board NPC (see the `delve_buy` command) so a
// player must be standing at Brother Halven, mirroring `enter_delve`.
export function delveBuyShopItem(
  ctx: SimContext,
  delveId: string,
  itemId: string,
  pid?: number,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta } = r;
  const entry = DELVE_SHOPS[delveId]?.find((s) => s.itemId === itemId);
  if (!entry) {
    ctx.error(meta.entityId, 'That item is not sold here.');
    return;
  }
  const def = ITEMS[itemId];
  if (!def) {
    ctx.error(meta.entityId, 'That item is not for sale.');
    return;
  }
  if (!delveShopGateMet(meta, delveId, entry.gate)) {
    ctx.error(meta.entityId, 'You have not unlocked that item yet.');
    return;
  }
  if (meta.delveMarks < entry.marks) {
    ctx.error(meta.entityId, `You need ${entry.marks} Delve Marks to buy ${def.name}.`);
    return;
  }
  meta.delveMarks -= entry.marks;
  ctx.addItem(itemId, 1, meta.entityId);
  // Feedback rides the 'vendor' event (the shop panel re-renders), matching the
  // regular buyItem path, no raw English log string emitted from the sim.
  ctx.emit({ type: 'vendor', action: 'buy', itemId, pid: meta.entityId });
}

export function delveCompanionWire(ctx: SimContext, pid: number): DelveCompanionInfo | null {
  const run = delveRunForPlayer(ctx, pid);
  if (!run?.companion) return null;
  const e = ctx.entities.get(run.companion.entityId);
  if (!e) return null;
  return {
    companionId: run.companion.companionId,
    entityId: e.id,
    rank: ctx.players.get(pid)?.companionUpgrades[run.companion.companionId] ?? 1,
    hp: e.hp,
    maxHp: e.maxHp,
  };
}

export function delveRunWire(ctx: SimContext, pid: number): object | null {
  const run = delveRunForPlayer(ctx, pid);
  if (!run?.partyKey) return null;
  return {
    delveId: run.delveId,
    tierId: run.tierId,
    slot: run.slot,
    origin: { x: run.origin.x, z: run.origin.z },
    moduleIndex: run.moduleIndex,
    moduleCount: run.modules.length,
    modules: run.modules,
    objective: run.objective,
    affixes: run.affixes,
    completed: run.completed,
    exitPortalOpen: run.exitPortalOpen,
    bountiful: run.bountiful,
  };
}

export function delveMarksFor(ctx: SimContext, pid: number): number {
  return ctx.players.get(pid)?.delveMarks ?? 0;
}

export function companionUpgradesFor(ctx: SimContext, pid: number): Record<string, number> {
  return { ...(ctx.players.get(pid)?.companionUpgrades ?? {}) };
}

export function delveDailyWire(
  ctx: SimContext,
  pid: number,
): { date: string; firstClearXp: string[]; markClears: number } {
  const meta = ctx.players.get(pid);
  if (!meta) return { date: '', firstClearXp: [], markClears: 0 };
  refreshDelveDaily(ctx, meta);
  return {
    date: meta.delveDaily.date,
    firstClearXp: [...meta.delveDaily.firstClearXp],
    markClears: meta.delveDaily.markClears,
  };
}
