// Procedural Rift instance lifecycle. A parallel sibling to instances/dungeons.ts
// (which is left untouched): the rift pool lives in its own coordinate band, each
// slot holds one GENERATED floor at a time, and descending regenerates the room
// in place. Everything a rift needs is derived from its descriptor (seed +
// baseLevel + floorIndex) via the pure generator in rift_gen.ts, so the client
// regenerates identical geometry and only the descriptor travels over the wire.
//
// Behaviour lives here; state (ctx.riftInstances, ctx.riftPortalIds) stays on Sim
// as live SimContext views. Sim keeps thin enterRift/leaveRift delegates for the
// dev command + interaction click path; the per-tick drivers (updateRiftTriggers,
// updateRiftInstances) are called from tick().

import { clearRiftRegion, resolveMovement, setRiftRegion } from '../colliders';
import { delveChestItemsForTier } from '../content/delves/lockpick_tiers';
import {
  DUNGEON_FLOOR_Y,
  isRiftPos,
  MOBS,
  RIFT_REGION_HALF_X,
  RIFT_REGION_HALF_Z,
  riftInstanceOrigin,
} from '../data';
import { layoutColliders } from '../dungeon_layout';
import { createGroundObject, createMob } from '../entity';
import type { LootTier } from '../lockpick';
import type { SimContext } from '../sim_context';
import { DT, dist2d, type Entity, type Vec3 } from '../types';
import { isInWaterBody } from '../world';
import { closeNaturalRiftPortal, RIFT_MIN_LEVEL, RIFT_TIER_INFO } from './portals';
import { addRiftClearGearLoot, addRiftProgressionLoot } from './progression';
import { claimRiftFirstClear, markRiftEventActive } from './race';
import {
  RIFT_RANK_MECHANIC_BUDGET,
  type RiftSpawnRole,
  riftHeroicTuningFor,
  riftRankForBaseLevel,
  riftRankTemplate,
  riftRankTuningFor,
  riftRoleDamageMultiplier,
  riftRoleHealthMultiplier,
} from './ranks';
import { generateRiftFloor, isSetPieceRift, riftLiftAt } from './rift_gen';
import { riftLockpickAbort, tickRiftLockpick } from './rift_lockpick';
import type { RiftInstance, RiftRoller } from './types';

const PORTAL_TRIGGER_RADIUS = 2.2; // walk this close to a rift portal to use it
const PYLON_TRIGGER_RADIUS = 3.0; // walk this close to light a rune pylon
const SWITCH_TRIGGER_RADIUS = 2.6; // step this close to a gate switch to throw it
const BEACON_TRIGGER_RADIUS = 2.0; // walk this close to the way-out beacon to leave
const SEQ_TRIGGER_RADIUS = 2.6; // walk this close to step a sequence rune
// Reach the Blood Orb from outside its altar's collider (altar r 1.8 + body 0.6).
const ORB_TRIGGER_RADIUS = 3.2;
const ORB_NOTICE_COOLDOWN = 6; // seconds between "the orb is sealed" nudges
const SEQ_RESET_NOTICE_COOLDOWN = 4; // seconds between "the runes go dark" reset notices
const POOL_FULL_NOTICE_COOLDOWN = 4; // seconds between "all rifts are unstable" / "already cleared" denials on walk-in
// Concurrent instances one shared event may hold. The global pool (RIFT_SLOT_COUNT)
// backs every event together; this cap keeps a single hyped portal from draining it.
export const RIFT_EVENT_INSTANCE_CAP = 32;
const BOULDER_PUSH_RADIUS = 2.0; // shove a boulder when this close and moving into it
const PAD_RADIUS = 2.2; // a boulder counts as socketed within this of its pad
const ICE_SLIDE_SPEED = 13; // yd/s glide across the ice (~1.85x run: frictionless momentum)
const ICE_SLIDE_START = 0.04; // min input displacement in a tick to push off into a slide
const PLAYER_BODY_R = 0.6;
const ROLLER_HIT_COOLDOWN = 0.6; // seconds between rolling-boulder hits on one player
const ROLLER_KB_SIDE = 3.2; // sideways shove (to the aisle) when a boulder bowls you over
const ROLLER_KB_FWD = 1.4; // forward nudge along the boulder's travel

/** Play a themed impact VFX at a WORLD spot for every interactive rift moment (the
 * ice-slide launch, a boulder shove, a rune flare, a lava burn, a roller wallop). It
 * reuses the already-wired `spellfxAt` world event, so it interest-scopes to everyone
 * in the instance and renders on all three hosts with no new event/wire surface. It
 * is render-only (draws no rng, touches no sim state), so it is determinism-safe. */
function riftFx(
  ctx: SimContext,
  x: number,
  z: number,
  school: string,
  fx: 'burst' | 'nova' = 'burst',
): void {
  ctx.emit({ type: 'spellfxAt', x, z, school, fx });
}

/** Whether an instance-local point sits on this floor's ice sheet. */
function inIceZone(
  ice: { x: number; z: number; hw: number; hd: number } | null,
  lx: number,
  lz: number,
): boolean {
  return ice !== null && Math.abs(lx - ice.x) <= ice.hw && Math.abs(lz - ice.z) <= ice.hd;
}
// Seconds with nobody inside before the slot frees. Long enough for a wiped
// party to graveyard-run back for their corpses (dead members may re-enter an
// out-of-combat run, enterRift's death rules): portals sit anywhere in the
// world, so a 60s window regularly stranded corpses behind a freed slot.
const RIFT_EMPTY_TIMEOUT = 180;

// Deterministic per-channel colour jitter (server-side; the result rides the
// entity snapshot to the client, so it need not be client-reproducible).
function jitterColor(ctx: SimContext, hex: number, amt: number): number {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const f = () => 1 + ctx.rng.range(-amt, amt);
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return (clamp(r * f()) << 16) | (clamp(g * f()) << 8) | clamp(b * f());
}

function riftKeyFor(ctx: SimContext, pid: number): string {
  const party = ctx.partyOf(pid);
  return party ? `party:${party.id}` : `solo:${pid}`;
}

/** The nearest dry point to (x, z): the point itself when it is not inside a
 * declared water body, else a deterministic outward march (8 headings, growing
 * radius). The rift return position must never anchor in water: the exit
 * teleport would land the player swimming (the render pose keys on the water
 * body), which reads as broken. Portals spawn on dry land, so the march almost
 * always keeps the original spot. */
function dryPointNear(x: number, z: number): { x: number; z: number } {
  if (!isInWaterBody(x, z)) return { x, z };
  for (let radius = 4; radius <= 48; radius += 4) {
    for (let step = 0; step < 8; step++) {
      const ang = (step / 8) * Math.PI * 2;
      const cx = x + Math.sin(ang) * radius;
      const cz = z + Math.cos(ang) * radius;
      if (!isInWaterBody(cx, cz)) return { x: cx, z: cz };
    }
  }
  return { x, z };
}

function floorForInstance(inst: RiftInstance, floorIndex = inst.floorIndex) {
  return generateRiftFloor(inst.seed, inst.baseLevel, floorIndex, inst.upgrade);
}

/** The rift instance whose region contains `pos`, or null. */
export function riftInstanceAtPos(ctx: SimContext, pos: Vec3): RiftInstance | null {
  for (const inst of ctx.riftInstances) {
    if (inst.partyKey === null) continue;
    const o = riftInstanceOrigin(inst.slot, inst.floorIndex);
    if (
      Math.abs(pos.x - o.x) <= RIFT_REGION_HALF_X &&
      Math.abs(pos.z - o.z) <= RIFT_REGION_HALF_Z
    ) {
      return inst;
    }
  }
  return null;
}

function riftHazardTierAt(
  hazards: import('../types').DelveHazardZone[],
  localX: number,
  localZ: number,
): 'shallow' | 'deep' | null {
  let tier: 'shallow' | 'deep' | null = null;
  for (const hazard of hazards) {
    const rx = hazard.rx ?? hazard.r;
    const rz = hazard.rz ?? hazard.r;
    const nx = (localX - hazard.x) / rx;
    const nz = (localZ - hazard.z) / rz;
    if (nx * nx + nz * nz > 1) continue;
    if (hazard.tier === 'deep') return 'deep';
    tier = tier ?? 'shallow';
  }
  return tier;
}

/** Whether a route sample avoids the live floor's closed runtime gate. */
export function riftRecoveryRoutePointClear(ctx: SimContext, p: Entity, pos: Vec3): boolean {
  if (!isRiftPos(pos.x)) return true;
  const inst = riftInstanceAtPos(ctx, pos);
  if (!inst?.memberIds.has(p.id)) return false;
  const floor = floorForInstance(inst);
  if (!floor.gate || inst.gateOpen) return true;
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const localX = pos.x - origin.x;
  const localZ = pos.z - origin.z;
  return !(
    Math.abs(localX - floor.gate.x) <= floor.gate.hw + PLAYER_BODY_R &&
    Math.abs(localZ - floor.gate.z) <= floor.gate.hd + PLAYER_BODY_R
  );
}

/** Whether a recovery destination avoids every live traversal hazard on its floor. */
export function riftRecoveryPointSafe(ctx: SimContext, p: Entity, pos: Vec3): boolean {
  if (!isRiftPos(pos.x)) return true;
  const inst = riftInstanceAtPos(ctx, pos);
  if (!inst?.memberIds.has(p.id)) return false;
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const floor = floorForInstance(inst);
  const localX = pos.x - origin.x;
  const localZ = pos.z - origin.z;
  if (riftHazardTierAt(floor.hazards, localX, localZ) !== null) return false;
  if (inIceZone(floor.iceZone, localX, localZ)) return false;
  for (let i = 0; i < floor.rollers.length; i++) {
    if (!inst.rollerIds[i] || !ctx.entities.has(inst.rollerIds[i])) continue;
    const roller = floor.rollers[i];
    if (
      Math.abs(localX - roller.x) <= roller.r + PLAYER_BODY_R &&
      localZ >= roller.z0 - PLAYER_BODY_R &&
      localZ <= roller.z1 + PLAYER_BODY_R
    ) {
      return false;
    }
  }
  return true;
}

function emitRiftState(ctx: SimContext, pid: number, inst: RiftInstance, active: boolean): void {
  const floor = floorForInstance(inst);
  const event =
    inst.eventId === null
      ? null
      : (ctx.riftEvents.find((candidate) => candidate.eventId === inst.eventId) ?? null);
  const contentId = event?.contentId ?? `procedural-v1:${inst.seed}:${inst.baseLevel}`;
  ctx.emit({
    type: 'riftState',
    pid,
    active,
    eventId: inst.eventId,
    instanceId: inst.instanceId,
    seed: inst.seed >>> 0,
    baseLevel: inst.baseLevel,
    floorIndex: inst.floorIndex,
    floorCount: inst.floorCount,
    origin: riftInstanceOrigin(inst.slot, inst.floorIndex),
    contentId,
    contentHash: event?.contentHash ?? contentId,
    upgrade: inst.upgrade,
    name: floor.name,
    themeName: floor.themeName,
    tier: inst.tier,
  });
}

// ---- Floor spawn / teardown -------------------------------------------------

function spawnRiftFloor(ctx: SimContext, inst: RiftInstance): void {
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const floor = floorForInstance(inst);

  // Publish the generated collision so movement/pathing/LoS/camera respect it.
  setRiftRegion(ctx.riftCollisionToken, origin.x, origin.z, layoutColliders(floor.layout));

  inst.mobIds = [];
  inst.objectIds = [];
  inst.pylonIds = [];
  inst.litPylons = new Set();
  inst.bossId = null;
  inst.bossDiedAtTick = null;
  inst.exitId = null;
  inst.descentId = null;
  inst.descentOpen = false;
  inst.descentAt = null;
  inst.pylonTotal = floor.puzzle.kind === 'rune_pylons' ? floor.puzzle.pylonCount : 0;
  inst.puzzleSolved = floor.puzzle.kind === 'none';
  inst.boulderIds = [];
  inst.boulderPads = [];
  inst.seqRuneIds = [];
  inst.seqStep = 0;
  inst.seqResetAt = -Infinity;
  inst.beaconId = null;
  inst.rollerIds = [];
  inst.cacheId = null;
  inst.lockpick = null;
  inst.gateId = null;
  inst.switchId = null;
  inst.gateOpen = floor.gate === null;
  inst.minibossId = null;
  inst.orbId = null;
  inst.orbActive = false;

  // Every rank is stat-scaled: a spawn-time stat transform plus the per-entity
  // mechanic multipliers, mirroring instances/difficulty.ts. C takes the
  // normal-dungeon table and B/A/S the heroic one; the rank derives from the
  // descriptor's baseLevel, so every host regenerates it. Boss and trash take
  // DIFFERENT multipliers (rift/ranks.ts), so each spawn resolves its role first.
  const rank = riftRankForBaseLevel(inst.baseLevel);
  const tuning = riftRankTuningFor(inst.baseLevel);
  for (const spawn of floor.spawns) {
    const template = MOBS[spawn.templateId];
    if (!template) continue;
    const role: RiftSpawnRole = spawn.boss || spawn.miniboss ? 'boss' : 'trash';
    const mob = createMob(
      ctx.nextId++,
      riftRankTemplate(template, tuning, role),
      spawn.level,
      ctx.groundPos(origin.x + spawn.x, origin.z + spawn.z),
    );
    if (spawn.name) mob.name = spawn.name;
    // Mechanic damage/heal numbers are read from the base MOBS table at fire
    // time, so the template transform cannot reach them; the per-entity
    // multipliers apply AFTER each rng draw (draw order identical across ranks).
    // Non-dodgeable mechanics still pass capRiftNonLethalMechanicDamage at the
    // fire site, so scaling them can never produce a one-shot from full health.
    mob.mechanicDamageMult = riftRoleDamageMultiplier(tuning, role);
    mob.mechanicHealMult = riftRoleHealthMultiplier(tuning, role);
    // Rank-gated boss kits: how many entries of the template's rankMechanics
    // list are live on this spawn (C=1 .. S=4). Trash carries no budget.
    // Authored set-piece floors (the Infernal Citadel) are C-only hand-tuned
    // content; their bosses run their full kit at every rank and must not be
    // capped by the procedural rank budget.
    if ((spawn.boss || spawn.miniboss) && !isSetPieceRift(inst.seed, inst.baseLevel)) {
      mob.riftMechanicLimit = RIFT_RANK_MECHANIC_BUDGET[rank];
    }
    // Per-run re-grade: a fresh tint (and a little scale variance) so the same
    // template reads as a different creature across rifts. Model + mechanics are
    // unchanged (both read from the static template by id).
    mob.color = jitterColor(ctx, spawn.color ?? mob.color, 0.14);
    mob.scale = (spawn.scale ?? mob.scale) * ctx.rng.range(0.92, 1.12);
    mob.facing = Math.PI;
    mob.prevFacing = mob.facing;
    ctx.addEntity(mob);
    inst.mobIds.push(mob.id);
    if (spawn.boss) inst.bossId = mob.id;
    if (spawn.miniboss) inst.minibossId = mob.id;
  }

  const spawnObj = (templateId: string, name: string, x: number, z: number): number => {
    const o = createGroundObject(ctx.nextId++, '', name, ctx.groundPos(origin.x + x, origin.z + z));
    o.templateId = templateId;
    o.objectItemId = null;
    o.lootable = false;
    ctx.addEntity(o);
    inst.objectIds.push(o.id);
    return o.id;
  };

  for (const obj of floor.objects) {
    switch (obj.kind) {
      case 'descent':
        // Spawned only once the floor is cleared (see updateRiftInstances).
        inst.descentAt = { x: obj.x, z: obj.z };
        break;
      case 'rune_pylon':
        inst.pylonIds.push(spawnObj('rift_pylon', obj.name, obj.x, obj.z));
        break;
      case 'ice_goal':
        spawnObj('rift_ice_goal', obj.name, obj.x, obj.z);
        break;
      case 'seq_rune':
        inst.seqRuneIds.push(spawnObj('rift_seq_rune', obj.name, obj.x, obj.z));
        break;
      case 'boulder':
        inst.boulderIds.push(spawnObj('rift_boulder', obj.name, obj.x, obj.z));
        break;
      case 'boulder_pad':
        inst.boulderPads.push({ x: obj.x, z: obj.z });
        spawnObj('rift_boulder_pad', obj.name, obj.x, obj.z);
        break;
      case 'treasure': {
        // Off-path reward chest tucked against a wall. Lootable so the interact
        // F-scan finds it; opening it (interaction.ts) rolls loot, not a lockpick.
        const tid = spawnObj('rift_treasure', obj.name, obj.x, obj.z);
        const t = ctx.entities.get(tid);
        if (t) t.lootable = true;
        break;
      }
      case 'gate':
        inst.gateId = spawnObj('rift_gate', obj.name, obj.x, obj.z);
        break;
      case 'switch':
        inst.switchId = spawnObj('rift_switch', obj.name, obj.x, obj.z);
        break;
      case 'infernal_orb':
        // Dormant until this floor's miniboss dies (updateRiftInstances arms it).
        inst.orbId = spawnObj('rift_infernal_orb', obj.name, obj.x, obj.z);
        break;
      // 'chest'/'exit' are placed on boss death (openExit).
    }
  }
  // Sequence runes must be stepped south-to-north; keep the id list in that order.
  if (inst.seqRuneIds.length > 1) {
    inst.seqRuneIds.sort(
      (a, b) => (ctx.entities.get(a)?.pos.z ?? 0) - (ctx.entities.get(b)?.pos.z ?? 0),
    );
  }

  // The always-available "way out": a beacon at the floor entry. Walking onto it
  // (or clicking it) returns you to the overworld, so a run is never a trap.
  inst.beaconId = spawnObj('rift_beacon', 'Rift Beacon', floor.entry.x, floor.entry.z - 3);

  // Rolling-boulder hazards: one entity per lane, staggered along it by `phase`.
  for (const roller of floor.rollers) {
    const z = roller.z0 + (roller.z1 - roller.z0) * roller.phase;
    inst.rollerIds.push(spawnObj('rift_roller', 'Rolling Boulder', roller.x, z));
  }

  inst.emptyFor = 0;
}

function dropObjects(ctx: SimContext, ids: number[]): void {
  for (const id of ids) {
    if (ctx.entities.has(id)) ctx.dropEntity(id);
  }
}

function freeRiftFloorEntities(ctx: SimContext, inst: RiftInstance): void {
  for (const id of inst.mobIds) {
    if (!ctx.entities.has(id)) continue;
    for (const meta of ctx.players.values()) {
      const e = ctx.entities.get(meta.entityId);
      if (e?.targetId === id) e.targetId = null;
    }
    ctx.dropEntity(id);
  }
  dropObjects(ctx, inst.objectIds);
  if (inst.descentId !== null) dropObjects(ctx, [inst.descentId]);
  if (inst.exitId !== null) dropObjects(ctx, [inst.exitId]);
  if (inst.cacheId !== null) dropObjects(ctx, [inst.cacheId]);
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  clearRiftRegion(ctx.riftCollisionToken, origin.x, origin.z);
  inst.mobIds = [];
  inst.objectIds = [];
  inst.pylonIds = [];
  inst.litPylons = new Set();
  inst.descentId = null;
  inst.exitId = null;
  inst.bossId = null;
  inst.bossDiedAtTick = null;
  inst.boulderIds = [];
  inst.boulderPads = [];
  inst.seqRuneIds = [];
  inst.seqStep = 0;
  inst.seqResetAt = -Infinity;
  inst.beaconId = null;
  inst.rollerIds = [];
  inst.cacheId = null;
  inst.lockpick = null;
  inst.gateId = null;
  inst.switchId = null;
  inst.gateOpen = true;
  inst.puzzleSolved = false;
  inst.minibossId = null;
  inst.orbId = null;
  inst.orbActive = false;
  inst.bossDeathZones = [];
}

function freeRiftInstance(ctx: SimContext, inst: RiftInstance): void {
  const eventId = inst.eventId;
  freeRiftFloorEntities(ctx, inst);
  inst.instanceId = 0;
  inst.eventId = null;
  inst.partyKey = null;
  inst.memberIds = new Set();
  inst.startedAt = 0;
  inst.finishedAt = null;
  inst.outcome = 'abandoned';
  inst.upgrade = null;
  inst.floorIndex = 0;
  inst.descentOpen = false;
  inst.descentAt = null;
  inst.emptyFor = 0;
  inst.tier = null;
  inst.portalId = null;
  inst.rewarded = false;
  inst.progressed = false;
  inst.bossDeathZones = [];
  if (eventId !== null) {
    const event = ctx.riftEvents.find((candidate) => candidate.eventId === eventId);
    const anotherRun = ctx.riftInstances.some(
      (candidate) => candidate.partyKey !== null && candidate.eventId === eventId,
    );
    if (event?.status === 'active' && event.portalId === null && !anotherRun) {
      event.status = 'collapsed';
    }
  }
}

// ---- Enter / descend / leave ------------------------------------------------

export function enterRift(
  ctx: SimContext,
  seed: number,
  baseLevel: number,
  pid?: number,
  returnPos?: { x: number; z: number },
  portal?: Entity,
): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  if (r.e.dead && !r.e.ghost) return;
  // Every rift is endgame content: level 20+ in every zone (the Eastbrook
  // portal exists for low levels to see, but turns them away with this line).
  // Gated on the PORTAL path (walk-in + interaction click, which always pass
  // the portal entity); the direct programmatic call stays open for tests.
  // Throttled so standing inside the trigger radius does not spam per tick.
  if (portal && r.e.level < RIFT_MIN_LEVEL) {
    if (ctx.time >= (r.e.riftDeniedAt ?? -Infinity) + 4) {
      r.e.riftDeniedAt = ctx.time;
      ctx.error(
        r.meta.entityId,
        `Only adventurers of level ${RIFT_MIN_LEVEL} or higher may enter this rift.`,
      );
    }
    return;
  }
  const key = riftKeyFor(ctx, r.meta.entityId);
  const eventId = portal?.riftEventId ?? null;
  // Death rules (2026-07-21 S-raid playtest): a dead player (ghost) may enter
  // ONLY a run they are already a member of, and only while that run has no
  // mob in combat. That kills the die-and-run-back zerg (a ghost can never
  // rejoin a live fight) while keeping the two legitimate corpse runs open:
  // wipe recovery (everyone died, mobs reset out of combat) and corpse
  // retrieval after the run is decided (a member who died before the boss fell
  // must never be forced into resurrection sickness). The decided-run
  // exception is why the member match below accepts a non-active outcome for
  // dead entrants, and why the cleared-event denial is skipped for them.
  const deadEntry = r.e.dead;
  if (deadEntry) {
    const own = ctx.riftInstances.find(
      (candidate) =>
        candidate.partyKey !== null &&
        candidate.memberIds.has(r.meta.entityId) &&
        (eventId !== null
          ? candidate.eventId === eventId
          : candidate.eventId === null && candidate.seed === seed >>> 0),
    );
    if (!own || riftInstanceInCombat(ctx, own)) {
      if (ctx.time >= (r.e.riftDeniedAt ?? -Infinity) + 4) {
        r.e.riftDeniedAt = ctx.time;
        ctx.error(
          r.meta.entityId,
          own
            ? 'Your party is still in combat. The dead may re-enter once the fighting stops.'
            : 'You cannot enter a rift while dead.',
        );
      }
      return;
    }
  }
  const matchesEvent = (candidate: RiftInstance): boolean =>
    eventId !== null
      ? candidate.eventId === eventId
      : candidate.eventId === null && candidate.seed === seed >>> 0;
  const liveMatch = (candidate: RiftInstance): boolean =>
    candidate.partyKey !== null && candidate.outcome === 'active' && matchesEvent(candidate);

  if (eventId !== null && !deadEntry) {
    // A resolved event denies every LIVING entrant outright. No re-entry
    // exemption is needed: sealing or collapsing always deletes the portal
    // entity in the same call chain, so this eventId path cannot even be
    // reached once the event is cleared or collapsed, and mid-run groups
    // simply keep playing inside their instance.
    const event = ctx.riftEvents.find((candidate) => candidate.eventId === eventId);
    if (!event || event.status === 'cleared' || event.status === 'collapsed') {
      if (ctx.time >= (r.e.riftPoolFullAt ?? -Infinity) + POOL_FULL_NOTICE_COOLDOWN) {
        r.e.riftPoolFullAt = ctx.time;
        const winner = event?.firstClear?.memberNames.join(', ') || 'another party';
        ctx.error(r.meta.entityId, `This rift has already been cleared by ${winner}.`);
      }
      return;
    }
    if (event.upgradeStatus === 'pending') event.upgradeStatus = 'fallback';
    event.contentLocked = true;
  }

  // ---- Instance resolution (WoW-raid-style binding) --------------------------
  // The first mob kill (or plundered cache) marks a run PROGRESSED. A progressed
  // run binds its members: they always re-enter that run and can never land in a
  // different instance of the same event, whatever their party does. An
  // UNPROGRESSED run is disposable: once its members regroup and enter another
  // run, the stale empty copy recycles so a freshly formed party shares one
  // clean instance instead of being split across leftovers.
  // A dead entrant still matches by MEMBERSHIP ONLY (never the partyKey arm), so
  // the instance entered is guaranteed to be the same one the combat gate above
  // checked, and may be a decided (won) run for corpse retrieval.
  let inst: RiftInstance | null = null;
  if (deadEntry) {
    inst =
      ctx.riftInstances.find(
        (candidate) =>
          candidate.partyKey !== null &&
          candidate.memberIds.has(r.meta.entityId) &&
          matchesEvent(candidate),
      ) ?? null;
    if (!inst) return; // a ghost never allocates a fresh run
  } else {
    // 1. Binding wins over everything, including the entrant's current party.
    inst =
      ctx.riftInstances.find(
        (candidate) =>
          liveMatch(candidate) && candidate.progressed && candidate.memberIds.has(r.meta.entityId),
      ) ?? null;
    // 2. The current group's run: exact key match first, then any live run a
    //    CURRENT party member is inside of or bound to (covers party-id churn
    //    and mid-run replacement invites). Entering a progressed run binds the
    //    entrant to it via the membership added below.
    if (inst === null) {
      const partyPids = ctx.partyOf(r.meta.entityId)?.members ?? [];
      const mateRun = (candidate: RiftInstance): boolean =>
        liveMatch(candidate) &&
        partyPids.some((pid) => pid !== r.meta.entityId && candidate.memberIds.has(pid));
      inst =
        ctx.riftInstances.find((candidate) => liveMatch(candidate) && candidate.partyKey === key) ??
        ctx.riftInstances.find((candidate) => mateRun(candidate) && candidate.progressed) ??
        ctx.riftInstances.find(mateRun) ??
        null;
      if (inst !== null) inst.partyKey = key; // the current group owns the run now
    }
    // 3. Recycle the entrant's stale, unprogressed, player-empty leftovers of
    //    this event (they regrouped; the clean copies must not pin or leak).
    for (const candidate of ctx.riftInstances) {
      if (candidate === inst || !liveMatch(candidate) || candidate.progressed) continue;
      if (!candidate.memberIds.has(r.meta.entityId)) continue;
      if (instancePlayerIds(ctx, candidate).length > 0) continue;
      // A zero-kill wipe leaves ghosts entitled to a corpse run (the death
      // rules above): never recycle a run out from under a dead member.
      let deadMember = false;
      for (const memberId of candidate.memberIds) {
        if (ctx.entities.get(memberId)?.dead) {
          deadMember = true;
          break;
        }
      }
      if (deadMember) continue;
      freeRiftInstance(ctx, candidate);
    }
  }
  if (!inst) {
    // The cap counts SLOT OCCUPANCY for the event, not just active races:
    // decided (won/lost) runs still hold their slot until reclaim, and one
    // hyped portal must never drain the whole global pool through them.
    const eventRuns = ctx.riftInstances.filter(
      (candidate) => candidate.partyKey !== null && matchesEvent(candidate),
    ).length;
    const free = ctx.riftInstances.find((i) => i.partyKey === null);
    if (!free || eventRuns >= RIFT_EVENT_INSTANCE_CAP) {
      if (ctx.time >= (r.e.riftPoolFullAt ?? -Infinity) + POOL_FULL_NOTICE_COOLDOWN) {
        r.e.riftPoolFullAt = ctx.time;
        ctx.error(r.meta.entityId, 'All rifts are unstable right now. Try again soon.');
      }
      return;
    }
    inst = free;
    inst.instanceId = ctx.nextRiftInstanceId++;
    inst.eventId = eventId;
    inst.partyKey = key;
    inst.memberIds = new Set();
    inst.startedAt = ctx.time;
    inst.finishedAt = null;
    inst.outcome = 'active';
    inst.upgrade =
      eventId === null
        ? null
        : (ctx.riftEvents.find((candidate) => candidate.eventId === eventId)?.upgrade ?? null);
    inst.seed = seed >>> 0;
    inst.baseLevel = Math.max(1, Math.min(60, Math.round(baseLevel)));
    inst.floorIndex = 0;
    inst.floorCount = floorForInstance(inst, 0).floorCount;
    // Return spot: never inside the portal's walk-in radius, or leaving the
    // rift would drop the player onto the portal and bounce them straight back
    // in. Push the entry position away from the portal to a safe distance.
    let ret = returnPos ?? { x: r.e.pos.x, z: r.e.pos.z };
    if (portal) {
      const dx = ret.x - portal.pos.x;
      const dz = ret.z - portal.pos.z;
      const d = Math.hypot(dx, dz);
      const SAFE = PORTAL_TRIGGER_RADIUS + 2.5;
      if (d < SAFE) {
        const ux = d > 1e-3 ? dx / d : 0;
        const uz = d > 1e-3 ? dz / d : 1;
        ret = { x: portal.pos.x + ux * SAFE, z: portal.pos.z + uz * SAFE };
      }
    }
    inst.returnPos = dryPointNear(ret.x, ret.z);
    // Dev portals keep a cosmetic rank on the gate, but only a persisted natural
    // event is reward-ranked. This keeps the reward guard authoritative for the
    // real /dev portal path instead of paying Marks for a visual-only badge.
    inst.tier = eventId === null ? null : (portal?.riftTier ?? null);
    inst.portalId = portal?.id ?? null;
    inst.rewarded = false;
    inst.progressed = false;
    markRiftEventActive(ctx, eventId);
    spawnRiftFloor(ctx, inst);
  }

  inst.memberIds.add(r.meta.entityId);

  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const floor = floorForInstance(inst);
  const p = r.e;
  p.pos = ctx.groundPos(origin.x + floor.entry.x, origin.z + floor.entry.z);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.facing = 0;
  p.targetId = null;
  p.autoAttack = false;
  inst.emptyFor = 0;
  emitRiftState(ctx, r.meta.entityId, inst, true);
  ctx.emit({
    type: 'log',
    text: `You step through the rift into ${floor.name}.`,
    color: '#b9f',
    pid: r.meta.entityId,
  });
  if (inst.upgrade) {
    const detail = floor.isBoss
      ? inst.upgrade.boss.concept
      : inst.upgrade.floors[inst.floorIndex]?.environmentalDetails[0];
    ctx.emit({
      type: 'log',
      text: [inst.upgrade.synopsis, detail].filter(Boolean).join(' '),
      color: '#d9c7ff',
      pid: r.meta.entityId,
    });
  }
}

export function descendRift(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const inst = riftInstanceAtPos(ctx, r.e.pos);
  if (!inst?.descentOpen) return;
  if (inst.floorIndex >= inst.floorCount - 1) return;

  // Collect everyone currently standing in this floor's region before we tear it
  // down, so the whole party descends together.
  const descenders = instancePlayerIds(ctx, inst);

  freeRiftFloorEntities(ctx, inst);
  inst.floorIndex += 1;
  spawnRiftFloor(ctx, inst);

  // The next floor has its own z-stacked origin: teleport descenders THERE.
  const newOrigin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const floor = floorForInstance(inst);
  for (const id of descenders) {
    const e = ctx.entities.get(id);
    if (!e) continue;
    e.pos = ctx.groundPos(newOrigin.x + floor.entry.x, newOrigin.z + floor.entry.z);
    e.prevPos = { ...e.pos };
    ctx.rebucket(e);
    e.facing = 0;
    e.targetId = null;
    e.autoAttack = false;
    emitRiftState(ctx, id, inst, true);
    ctx.emit({
      type: 'log',
      text: `You descend deeper into ${floor.name}.`,
      color: '#b9f',
      pid: id,
    });
    if (inst.upgrade) {
      const directive = inst.upgrade.floors[inst.floorIndex];
      const narrative = floor.isBoss
        ? inst.upgrade.boss.concept
        : directive?.environmentalDetails[0];
      if (narrative) ctx.emit({ type: 'log', text: narrative, color: '#d9c7ff', pid: id });
    }
  }
}

export function leaveRift(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r || r.e.dead) return;
  // Only meaningful from inside a rift (reached via a rift_exit object); if the
  // player is not in one, do nothing rather than yanking them to the world origin.
  const inst = riftInstanceAtPos(ctx, r.e.pos);
  if (!inst) return;
  // Tear down any lock attempt in progress so a half-picked cache doesn't linger.
  if (inst.lockpick) riftLockpickAbort(ctx, inst, r.meta.entityId);
  forceExitRiftPlayer(ctx, inst, r.meta.entityId, false);
  ctx.emit({
    type: 'log',
    text: 'You step back through the rift.',
    color: '#b9f',
    pid: r.meta.entityId,
  });
}

/** Return one participant to the overworld. `forced` also handles dead/ghost
 * entities and is used when another group wins the shared event. */
function forceExitRiftPlayer(
  ctx: SimContext,
  inst: RiftInstance,
  pid: number,
  forced: boolean,
): void {
  const p = ctx.entities.get(pid);
  if (!p) return;
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const isInside =
    Math.abs(p.pos.x - origin.x) <= RIFT_REGION_HALF_X &&
    Math.abs(p.pos.z - origin.z) <= RIFT_REGION_HALF_Z;
  if (!isInside && forced) return;
  const dest = inst.returnPos;
  // Walk-in grace so the overworld portal cannot re-swallow the player the
  // tick they land next to it (clicking it deliberately still re-enters).
  p.riftReentryGraceUntil = ctx.time + 3;
  p.pos = ctx.groundPos(dest.x, dest.z);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.targetId = null;
  p.autoAttack = false;
  p.riftSliding = false; // never carry a stale slide pose out to the overworld
  p.riftSlideDirX = 0;
  p.riftSlideDirZ = 0;
  emitRiftState(ctx, pid, inst, false);
}

// ---- Per-tick drivers -------------------------------------------------------

export function updateRiftTriggers(ctx: SimContext, p: Entity): void {
  if (p.kind !== 'player') return;

  if (isRiftPos(p.pos.x)) {
    const inst = riftInstanceAtPos(ctx, p.pos);
    if (!inst) return;
    const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
    const floor = floorForInstance(inst);

    // Way out: the entry beacon returns you to the overworld any time, so a run
    // is never a dead end (too hard / stuck / lost).
    if (inst.beaconId !== null) {
      const beacon = ctx.entities.get(inst.beaconId);
      if (beacon && dist2d(p.pos, beacon.pos) < BEACON_TRIGGER_RADIUS) {
        leaveRift(ctx, p.id);
        return;
      }
    }
    // Exit portal -> leave.
    if (inst.exitId !== null) {
      const exit = ctx.entities.get(inst.exitId);
      if (exit && dist2d(p.pos, exit.pos) < PORTAL_TRIGGER_RADIUS) {
        leaveRift(ctx, p.id);
        return;
      }
    }
    // Open descent -> go deeper.
    if (inst.descentOpen && inst.descentId !== null) {
      const desc = ctx.entities.get(inst.descentId);
      if (desc && dist2d(p.pos, desc.pos) < PORTAL_TRIGGER_RADIUS) {
        descendRift(ctx, p.id);
        return;
      }
    }

    // Ice slide (FFX / Pokemon): step onto the frictionless sheet and you GLIDE in
    // your heading, input locked, one fixed step per tick (NOT a teleport, so it
    // interpolates smoothly and reads as sliding), until a wall stops you or you
    // reach solid ground at the sheet's edge. `runDespawnDecay` snapshotted prevPos
    // = this tick's pre-move pos, so `pos - prevPos` is the drive this tick, and the
    // glide advances from prevPos each tick (discarding further steering input).
    if (floor.iceZone) {
      const onIce = inIceZone(floor.iceZone, p.pos.x - origin.x, p.pos.z - origin.z);
      const sliding = (p.riftSlideDirX ?? 0) !== 0 || (p.riftSlideDirZ ?? 0) !== 0;
      if (sliding) {
        const dirx = p.riftSlideDirX ?? 0;
        const dirz = p.riftSlideDirZ ?? 0;
        const step = ICE_SLIDE_SPEED * DT;
        const dest = resolveMovement(
          ctx.cfg.seed,
          p.prevPos.x,
          p.prevPos.z,
          p.prevPos.x + dirx * step,
          p.prevPos.z + dirz * step,
          PLAYER_BODY_R,
          false,
          undefined,
          undefined,
          ctx.riftCollisionToken,
        );
        const advanced = Math.hypot(dest.x - p.prevPos.x, dest.z - p.prevPos.z);
        const nextOnIce = inIceZone(floor.iceZone, dest.x - origin.x, dest.z - origin.z);
        p.pos = ctx.groundPos(dest.x, dest.z);
        p.facing = Math.atan2(dirx, dirz); // face the glide
        ctx.rebucket(p);
        if (advanced < step * 0.5 || !nextOnIce) {
          // Slammed into a wall/rock, or skated off the ice onto solid ground: stop.
          p.riftSlideDirX = 0;
          p.riftSlideDirZ = 0;
          p.riftSliding = false;
          riftFx(ctx, p.pos.x, p.pos.z, 'frost'); // spray as you skid to a halt
        }
      } else if (onIce) {
        // Push off: capture the heading the moment the player drives on the ice.
        const dx = p.pos.x - p.prevPos.x;
        const dz = p.pos.z - p.prevPos.z;
        const moved = Math.hypot(dx, dz);
        if (moved > ICE_SLIDE_START) {
          p.riftSlideDirX = dx / moved;
          p.riftSlideDirZ = dz / moved;
          p.riftSliding = true;
          riftFx(ctx, p.pos.x, p.pos.z, 'frost'); // frost spray kicks up as you launch
        }
      }
    } else if ((p.riftSlideDirX ?? 0) !== 0 || (p.riftSlideDirZ ?? 0) !== 0 || p.riftSliding) {
      p.riftSliding = false;
      p.riftSlideDirX = 0; // no ice on this floor: never leave a stale slide latched
      p.riftSlideDirZ = 0;
    }
    // Ice-slide goal: sliding onto the Frost Sigil solves the floor.
    if (floor.puzzle.kind === 'ice_slide' && !inst.puzzleSolved) {
      const goal = floor.objects.find((o) => o.kind === 'ice_goal');
      // Radius 4 so a straight north slide that skids to a halt just past the far
      // edge still lands on the sigil (the glide can overshoot by up to one step).
      if (goal && dist2d(p.pos, ctx.groundPos(origin.x + goal.x, origin.z + goal.z)) < 4) {
        inst.puzzleSolved = true;
        riftFx(ctx, origin.x + goal.x, origin.z + goal.z, 'frost', 'nova'); // the sigil blazes
        for (const pid of instancePlayerIds(ctx, inst)) {
          ctx.emit({
            type: 'log',
            text: 'The frost sigil blazes. The way stirs.',
            color: '#adf',
            pid,
          });
        }
      }
    }

    // Strength boulders: shove an adjacent boulder one heading-step onto its socket.
    for (const id of inst.boulderIds) {
      const b = ctx.entities.get(id);
      if (!b || dist2d(p.pos, b.pos) >= BOULDER_PUSH_RADIUS) continue;
      const mvx = p.pos.x - p.prevPos.x;
      const mvz = p.pos.z - p.prevPos.z;
      const dirx = b.pos.x - p.pos.x;
      const dirz = b.pos.z - p.pos.z;
      // Only push when actually walking INTO the boulder.
      if (mvx * dirx + mvz * dirz <= 0.0001) continue;
      const dd = Math.hypot(dirx, dirz) || 1;
      const dest = resolveMovement(
        ctx.cfg.seed,
        b.pos.x,
        b.pos.z,
        b.pos.x + (dirx / dd) * 1.4,
        b.pos.z + (dirz / dd) * 1.4,
        1.0,
        false,
        undefined,
        undefined,
        ctx.riftCollisionToken,
      );
      if (Math.hypot(dest.x - b.pos.x, dest.z - b.pos.z) > 0.05) {
        b.pos = ctx.groundPos(dest.x, dest.z);
        b.prevPos = { ...b.pos };
        ctx.rebucket(b);
        // Grinding dust as the boulder scrapes forward (throttled: it can move every
        // tick while you lean on it, so cap the puffs to ~4/sec, deterministically).
        if (ctx.tickCount % 5 === 0) riftFx(ctx, b.pos.x, b.pos.z, 'physical');
      }
    }

    // Sequence: step the runes south-to-north; a wrong (skipped-ahead) step resets.
    if (floor.puzzle.kind === 'sequence' && !inst.puzzleSolved) {
      for (let i = 0; i < inst.seqRuneIds.length; i++) {
        const rune = ctx.entities.get(inst.seqRuneIds[i]);
        if (!rune || dist2d(p.pos, rune.pos) >= SEQ_TRIGGER_RADIUS) continue;
        if (i === inst.seqStep) {
          rune.templateId = 'rift_seq_rune_lit';
          inst.seqStep++;
          // A correct rune flares arcane; the last one blazes into a bright payoff.
          const solved = inst.seqStep >= inst.seqRuneIds.length;
          if (solved) inst.puzzleSolved = true;
          riftFx(ctx, rune.pos.x, rune.pos.z, solved ? 'holy' : 'arcane', 'nova');
          for (const pid of instancePlayerIds(ctx, inst)) {
            ctx.emit({
              type: 'log',
              text: `The runes answer in turn (${inst.seqStep}/${inst.seqRuneIds.length}).`,
              color: '#adf',
              pid,
            });
          }
        } else if (i > inst.seqStep) {
          // A wrong (skipped-ahead) step wipes the progress. Announce a real
          // wipe always, but rate limit the no-progress case: a player simply
          // STANDING on a later rune re-enters this branch every tick, and the
          // un-throttled version chanted "begin again" 20 times a second.
          const hadProgress = inst.seqStep > 0;
          if (hadProgress) {
            inst.seqStep = 0;
            for (const rid of inst.seqRuneIds) {
              const rr = ctx.entities.get(rid);
              if (rr) rr.templateId = 'rift_seq_rune';
            }
          }
          const throttled = ctx.time < inst.seqResetAt + SEQ_RESET_NOTICE_COOLDOWN;
          if (hadProgress || !throttled) {
            inst.seqResetAt = ctx.time;
            riftFx(ctx, rune.pos.x, rune.pos.z, 'shadow'); // the runes snuff out
            for (const pid of instancePlayerIds(ctx, inst)) {
              ctx.emit({
                type: 'log',
                text: 'The runes go dark. Begin again.',
                color: '#a9c',
                pid,
              });
            }
          }
        }
        break;
      }
    }

    // Walk-on rune pylons.
    for (const id of inst.pylonIds) {
      if (inst.litPylons.has(id)) continue;
      const pylon = ctx.entities.get(id);
      if (pylon && dist2d(p.pos, pylon.pos) < PYLON_TRIGGER_RADIUS) {
        inst.litPylons.add(id);
        pylon.templateId = 'rift_pylon_lit';
        // The pylon flares as it lights; the last one blazes the brighter payoff.
        const all = inst.litPylons.size >= inst.pylonTotal;
        riftFx(ctx, pylon.pos.x, pylon.pos.z, all ? 'holy' : 'arcane', 'nova');
        ctx.emit({
          type: 'log',
          text: `A rune pylon flares to life (${inst.litPylons.size}/${inst.pylonTotal}).`,
          color: '#adf',
          pid: p.id,
        });
      }
    }
    // Blood Orb (authored citadel): dormant while its miniboss lives; once armed,
    // touching it grinds the temple portcullis open for good. The orb IS the gate's
    // switch on an `openOnOrb` floor, so no pressure plate is ever placed.
    if (inst.orbId !== null) {
      const orb = ctx.entities.get(inst.orbId);
      if (orb && dist2d(p.pos, orb.pos) < ORB_TRIGGER_RADIUS) {
        if (!inst.orbActive) {
          if (ctx.time >= (p.riftOrbNoticeAt ?? -Infinity) + ORB_NOTICE_COOLDOWN) {
            p.riftOrbNoticeAt = ctx.time;
            ctx.emit({
              type: 'log',
              text: 'The orb is sealed by the ritual below.',
              color: '#a9c',
              pid: p.id,
            });
          }
        } else if (floor.gate && !inst.gateOpen) {
          inst.gateOpen = true;
          const gate = inst.gateId !== null ? ctx.entities.get(inst.gateId) : null;
          if (gate) gate.templateId = 'rift_gate_open';
          riftFx(ctx, orb.pos.x, orb.pos.z, 'fire', 'nova');
          if (gate) riftFx(ctx, gate.pos.x, gate.pos.z, 'holy', 'nova');
          for (const pid of instancePlayerIds(ctx, inst)) {
            ctx.emit({
              type: 'log',
              text: 'The Blood Orb flares. The gates of the temple grind open.',
              color: '#f97',
              pid,
            });
          }
        }
      }
    }
    // Switch-gate: stepping the plate raises the linked portcullis for good.
    if (floor.gate && !inst.gateOpen) {
      const sw = inst.switchId !== null ? ctx.entities.get(inst.switchId) : null;
      if (sw && dist2d(p.pos, sw.pos) < SWITCH_TRIGGER_RADIUS) {
        inst.gateOpen = true;
        sw.templateId = 'rift_switch_on';
        const gate = inst.gateId !== null ? ctx.entities.get(inst.gateId) : null;
        if (gate) gate.templateId = 'rift_gate_open';
        riftFx(ctx, sw.pos.x, sw.pos.z, 'arcane', 'nova');
        if (gate) riftFx(ctx, gate.pos.x, gate.pos.z, 'holy', 'nova');
        for (const pid of instancePlayerIds(ctx, inst)) {
          ctx.emit({ type: 'log', text: 'The gate grinds open.', color: '#adf', pid });
        }
      }
    }
    // A closed gate is a runtime clamp (never a static collider): shove the player
    // back to the SOUTH face of the portcullis so they cannot pass until it opens.
    if (floor.gate && !inst.gateOpen) {
      const g = floor.gate;
      const lx = p.pos.x - origin.x;
      const lz = p.pos.z - origin.z;
      if (Math.abs(lx - g.x) < g.hw && lz > g.z - g.hd - PLAYER_BODY_R) {
        p.pos = ctx.groundPos(p.pos.x, origin.z + g.z - g.hd - PLAYER_BODY_R - 0.05);
        p.prevPos = { ...p.pos };
        ctx.rebucket(p);
      }
    }
    // Verticality: stand the player on the raised tier (procedural platform or
    // authored per-room lift). This is a post-movement Y lift;
    // updatePlayerMovement stripped the prior tick's lift first, so the kernel
    // integrated jumps/gravity against the true flat floor. Zero on flat floors.
    p.pos.y += riftLiftAt(floor, p.pos.x - origin.x, p.pos.z - origin.z);
    return;
  }

  // Overworld: walk into a rift portal to enter (unless inside the short
  // post-exit grace, so leaving a rift never bounces the player back in).
  if (ctx.time < (p.riftReentryGraceUntil ?? -Infinity)) return;
  if (ctx.riftPortalIds === null) {
    ctx.riftPortalIds = [];
    for (const e of ctx.entities.values()) {
      if (e.templateId === 'rift_portal') ctx.riftPortalIds.push(e.id);
    }
  }
  for (const portalId of ctx.riftPortalIds) {
    const portal = ctx.entities.get(portalId);
    if (
      portal &&
      portal.riftSeed !== undefined &&
      dist2d(p.pos, portal.pos) < PORTAL_TRIGGER_RADIUS
    ) {
      enterRift(ctx, portal.riftSeed, portal.riftBaseLevel ?? p.level, p.id, undefined, portal);
      return;
    }
  }
}

function trashCleared(ctx: SimContext, inst: RiftInstance): boolean {
  for (const id of inst.mobIds) {
    if (id === inst.bossId) continue;
    const m = ctx.entities.get(id);
    if (m && !m.dead) return false;
  }
  return true;
}

function openDescent(ctx: SimContext, inst: RiftInstance): void {
  if (inst.descentOpen || !inst.descentAt) return;
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const desc = createGroundObject(
    ctx.nextId++,
    '',
    'Rift Descent',
    ctx.groundPos(origin.x + inst.descentAt.x, origin.z + inst.descentAt.z),
  );
  desc.templateId = 'rift_descent';
  desc.objectItemId = null;
  desc.lootable = true;
  ctx.addEntity(desc);
  inst.descentId = desc.id;
  inst.descentOpen = true;
  for (const pid of instancePlayerIds(ctx, inst)) {
    ctx.emit({ type: 'log', text: 'The way down tears open.', color: '#b9f', pid });
  }
}

/** Open an off-path treasure chest on interact: roll real item loot (scaled
 * by the run's rank), grant it to the picker, and pop the shared loot overlay. No
 * lockpick minigame - just the reward for exploring off the main aisle. */
export function riftOpenTreasure(ctx: SimContext, objectId: number, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const chest = ctx.entities.get(objectId);
  if (chest?.templateId !== 'rift_treasure') return; // already opened / gone
  if (dist2d(r.e.pos, chest.pos) > 3.5) {
    ctx.error(r.meta.entityId, 'Move closer to the chest.');
    return;
  }
  const inst = riftInstanceAtPos(ctx, r.e.pos);
  // Plundering the cache spoils the run exactly like a kill: a recycled copy
  // would respawn the chest, so an unbound leave-regroup-reenter loop could
  // farm it. Progress pins the run instead.
  if (inst) inst.progressed = true;
  const tier: LootTier =
    inst?.tier === 'S' ? 'premium' : inst?.tier === 'A' || inst?.tier === 'B' ? 'medium' : 'low';
  const cls = ctx.players.get(r.meta.entityId)?.cls ?? 'warrior';
  const items = delveChestItemsForTier(tier, cls, ctx.rng, false);
  for (const it of items) ctx.addItem(it.itemId, it.count, r.meta.entityId);
  chest.templateId = 'rift_treasure_open';
  chest.name = 'Opened Cache';
  chest.lootable = false;
  ctx.emit({
    type: 'delveChestLoot',
    chestId: objectId,
    delveId: 'rift',
    tierId: inst?.tier ?? 'rift',
    lootTier: tier,
    bountiful: false,
    items,
    pid: r.meta.entityId,
  });
}

function openExit(ctx: SimContext, inst: RiftInstance): void {
  if (inst.exitId !== null) return;
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const floor = floorForInstance(inst);
  const chest = floor.objects.find((o) => o.kind === 'chest');
  const pos = chest ?? { x: 0, z: floor.layout.dais.z + 6 };
  const exit = createGroundObject(
    ctx.nextId++,
    '',
    'Rift Egress',
    ctx.groundPos(origin.x + pos.x, origin.z + pos.z),
  );
  exit.templateId = 'rift_exit';
  exit.objectItemId = null;
  exit.lootable = true;
  // The way home renders as the ranked-portal gate; carry the run's tier so its
  // colour matches the rift you cleared (dev-portal runs are tier-null, and the
  // gate builder defaults those to A-rank).
  exit.riftTier = inst.tier ?? undefined;
  ctx.addEntity(exit);
  inst.exitId = exit.id;
  // Beside the way home, the giga-boss leaves a SEALED reward cache: pick its lock
  // (the shared Tumbler's Path minigame) for bonus spoils. Lootable so the interact
  // scan targets it; the pick, not a grab, opens it (see interaction.ts + rift_lockpick).
  // COMPLETION loot, so race losers get the egress but no cache (maintainer
  // decision, 2026-07-30: a loser keeps only what dropped off the mobs).
  if (inst.outcome !== 'lost') {
    const cache = createGroundObject(
      ctx.nextId++,
      '',
      'Sealed Rift Cache',
      ctx.groundPos(origin.x + pos.x - 4, origin.z + pos.z),
    );
    cache.templateId = 'rift_locked_chest';
    cache.objectItemId = null;
    cache.lootable = true;
    ctx.addEntity(cache);
    inst.cacheId = cache.id;
  }
  for (const pid of instancePlayerIds(ctx, inst)) {
    ctx.emit({
      type: 'log',
      text: 'The rift shudders. A way home tears open behind the fallen.',
      color: '#fd7',
      pid,
    });
  }
}

// Rifts pay NO Heroic Marks at any rank (maintainer decision): marks stay a
// heroic dungeon/raid currency, and the rift prize is the clear-time gear
// ladder, the first-clear rings/essence/gems, the mount rolls, and coin.

/** Complete a run whose event was first-cleared by another group. No eject, no
 * teardown (maintainer decision, 2026-07-30): the group keeps its instance to
 * the end and gets an egress, but NO completion loot of any kind. Everything a
 * loser walks out with came off the mobs (or a mid-run treasure chest) the
 * normal way; the gear ladder, sealed cache, and first-clear extras all stay
 * exclusive to the race winner. */
function completeLosingRun(ctx: SimContext, inst: RiftInstance): void {
  const event =
    inst.eventId === null
      ? null
      : (ctx.riftEvents.find((candidate) => candidate.eventId === inst.eventId) ?? null);
  const winnerNames = event?.firstClear?.memberNames ?? [];
  const clearTime = event?.firstClear?.duration ?? 0;
  const tier = event?.tier ?? inst.tier;
  inst.rewarded = true;
  inst.outcome = 'lost';
  inst.finishedAt = ctx.time;
  if (event && tier) {
    for (const pid of instancePlayerIds(ctx, inst)) {
      ctx.emit({
        type: 'riftRaceResult',
        pid,
        eventId: event.eventId,
        outcome: 'lost',
        tier,
        winnerNames,
        clearTime,
      });
    }
  }
}

/** Resolve the authoritative first-clear claim. Every finishing instance stays
 * open for loot and egress; losing the race only forfeits the first-clear
 * extras, never the run. Returns true when this run is decided and should get
 * its exit spawned. */
function completeRiftClear(ctx: SimContext, inst: RiftInstance, boss: Entity | null): boolean {
  if (inst.rewarded) return inst.outcome !== 'active';
  const present = instancePlayerIds(ctx, inst);
  const participants = present.length > 0 ? present : [...inst.memberIds];
  const claim = claimRiftFirstClear(ctx, inst, participants);
  if (!claim.won) {
    completeLosingRun(ctx, inst);
    return true;
  }

  inst.rewarded = true;
  inst.outcome = 'won';
  inst.finishedAt = ctx.time;
  // Rank-gated payout on the corpse (every winning clear, ranked or dev): C a
  // guaranteed themed rare + coin, B/A/S the epic ladder. No Heroic Marks.
  if (boss) addRiftClearGearLoot(ctx, boss, inst.baseLevel);

  // A cleared rift seals its way in: the entry portal despawns, so a finished
  // run can never be walked into and re-farmed. Ranked natural portals seal
  // through the race claim below (closeNaturalRiftPortal); this arm covers
  // portals outside the race (dev portals), whose entity would otherwise stay
  // open forever.
  if (!claim.event && inst.portalId !== null) {
    if (ctx.entities.has(inst.portalId)) ctx.dropEntity(inst.portalId);
    inst.portalId = null;
  }

  if (claim.event) {
    if (boss) {
      addRiftProgressionLoot(
        ctx,
        boss,
        claim.event.eventId,
        claim.event.tier,
        participants,
        inst.upgrade?.rewards.lootMultiplier,
        inst.upgrade?.rewards.craftingMaterialBias,
      );
    }
    const portalId = claim.event.portalId ?? inst.portalId;
    if (portalId !== null) closeNaturalRiftPortal(ctx, portalId, 'sealed');
    const firstClear = claim.event.firstClear;
    const winnerNames = firstClear?.memberNames ?? [];
    const clearTime = firstClear?.duration ?? Math.max(0, ctx.time - inst.startedAt);
    for (const pid of participants) {
      ctx.emit({
        type: 'riftRaceResult',
        pid,
        eventId: claim.event.eventId,
        outcome: 'won',
        tier: claim.event.tier,
        winnerNames,
        clearTime,
      });
    }
    ctx.emit({
      type: 'riftRaceWorld',
      eventId: claim.event.eventId,
      tier: claim.event.tier,
      winnerNames,
      clearTime,
    });
    ctx.emit({
      type: 'log',
      text: `${winnerNames.join(', ') || 'A party'} won the ${claim.event.tier}-rank Rift race in ${clearTime.toFixed(1)}s!`,
      color: '#ffd76a',
    });
    // Competing instances are deliberately left running: they finish their own
    // race and complete as losers when their boss falls (completeLosingRun).
  }
  return true;
}

/** True while any living mob of the instance is engaged: the window in which
 * dead members may NOT walk back in (enterRift's anti-zerg death rule). */
export function riftInstanceInCombat(ctx: SimContext, inst: RiftInstance): boolean {
  for (const id of inst.mobIds) {
    const m = ctx.entities.get(id);
    if (m && !m.dead && m.inCombat) return true;
  }
  return false;
}

export function instancePlayerIds(ctx: SimContext, inst: RiftInstance): number[] {
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const out: number[] = [];
  const candidates =
    inst.memberIds.size > 0
      ? inst.memberIds
      : new Set([...ctx.players.values()].map((m) => m.entityId));
  for (const pid of candidates) {
    const e = ctx.entities.get(pid);
    if (
      e &&
      Math.abs(e.pos.x - origin.x) <= RIFT_REGION_HALF_X &&
      Math.abs(e.pos.z - origin.z) <= RIFT_REGION_HALF_Z
    ) {
      out.push(pid);
    }
  }
  return out;
}

// Unblockable environmental damage to players standing in a hazard zone (lava),
// skipped while airborne so a running jump clears the band. Modelled on the delve
// blackwater tick; scales with max HP so it bites at any level. 1 Hz.
function tickRiftHazards(
  ctx: SimContext,
  inst: RiftInstance,
  origin: { x: number; z: number },
  hazards: import('../types').DelveHazardZone[],
): void {
  for (const pid of instancePlayerIds(ctx, inst)) {
    const p = ctx.entities.get(pid);
    if (!p || p.dead || p.jumping) continue;
    const lx = p.pos.x - origin.x;
    const lz = p.pos.z - origin.z;
    const tier = riftHazardTierAt(hazards, lx, lz);
    if (!tier) continue;
    // heroic_s: at S rank every environmental hazard is a one-shot (playtest
    // verdict 2026-07-21), the boulder pattern: flat hp + maxHp, no modifier.
    // Below S lava stays the 6/12 percent-per-second burn.
    const dmg =
      riftRankForBaseLevel(inst.baseLevel) === 'S'
        ? p.hp + p.maxHp
        : Math.max(1, Math.round(p.maxHp * 0.06 * (tier === 'deep' ? 2 : 1)));
    ctx.dealDamage(null, p, dmg, false, 'fire', 'Molten Rift', 'hit', true);
    riftFx(ctx, p.pos.x, p.pos.z, 'fire'); // flames lick up as the lava sears you (1 Hz)
  }
}

// Roll one lane's boulder forward a tick and bowl over anyone it overtakes.
// C rank chips a chunk of max HP; on the heroic B/A/S ranks a boulder is a
// ONE-SHOT mechanic (an unblockable killing blow), so the lane must be dodged
// or jumped, never tanked. Lava deliberately stays damage-over-time at every
// rank (tickRiftHazards): a burn is a mistake tax, a boulder is an execution.
function tickRiftRollers(
  ctx: SimContext,
  inst: RiftInstance,
  origin: { x: number; z: number },
  rollers: RiftRoller[],
): void {
  const lethal = riftHeroicTuningFor(inst.baseLevel) !== null;
  for (let i = 0; i < inst.rollerIds.length && i < rollers.length; i++) {
    const e = ctx.entities.get(inst.rollerIds[i]);
    if (!e) continue;
    const lane = rollers[i];
    // Constant-speed roll down the lane; wrap back to the start (carry overshoot).
    let lz = e.pos.z - origin.z + lane.speed * DT;
    if (lz > lane.z1) lz = lane.z0 + (lz - lane.z1);
    e.prevPos = { ...e.pos };
    e.pos = ctx.groundPos(origin.x + lane.x, origin.z + lz);
    e.facing = 0;
    ctx.rebucket(e);
    // Anyone (not airborne) it overtakes is shoved aisle-ward + a nudge forward
    // and chipped; the cooldown makes one pass cost one hit, not one per tick.
    for (const pid of instancePlayerIds(ctx, inst)) {
      const p = ctx.entities.get(pid);
      if (!p || p.dead || p.jumping) continue;
      if (dist2d(p.pos, e.pos) >= lane.r + PLAYER_BODY_R) continue;
      if (ctx.time < (p.riftRollerUntil ?? 0)) continue;
      p.riftRollerUntil = ctx.time + ROLLER_HIT_COOLDOWN;
      const side = p.pos.x - e.pos.x >= 0 ? 1 : -1;
      const dest = resolveMovement(
        ctx.cfg.seed,
        p.pos.x,
        p.pos.z,
        p.pos.x + side * ROLLER_KB_SIDE,
        p.pos.z + ROLLER_KB_FWD,
        PLAYER_BODY_R,
        false,
        undefined,
        undefined,
        ctx.riftCollisionToken,
      );
      p.pos = ctx.groundPos(dest.x, dest.z);
      p.prevPos = { ...p.pos };
      ctx.rebucket(p);
      ctx.dealDamage(
        null,
        p,
        lethal ? p.hp + p.maxHp : Math.max(1, Math.round(p.maxHp * 0.07)),
        false,
        'physical',
        'Rolling Boulder',
        'hit',
        true,
      );
      riftFx(ctx, p.pos.x, p.pos.z, 'physical', 'nova'); // a heavy dusty wallop as it bowls you
    }
  }
}

/** Advance every active rift's rolling boulders each tick (20 Hz, unlike the 1 Hz
 * updateRiftInstances so the motion is smooth). Regenerating the floor is memoised,
 * so this stays cheap even with many live rifts. */
export function advanceRiftRollers(ctx: SimContext): void {
  for (const inst of ctx.riftInstances) {
    if (inst.partyKey === null || inst.rollerIds.length === 0) continue;
    const floor = floorForInstance(inst);
    if (floor.rollers.length === 0) continue;
    tickRiftRollers(ctx, inst, riftInstanceOrigin(inst.slot, inst.floorIndex), floor.rollers);
  }
}

/** The raised-tier Y lift for a player at their current position (0 outside a rift
 * or on a single-level floor). updatePlayerMovement strips this before the movement
 * kernel runs, so jumps/gravity integrate against the flat floor; updateRiftTriggers
 * re-applies it after. Both read the same pure height field, so they cancel. */
export function riftPlayerLift(ctx: SimContext, p: Entity): number {
  if (!isRiftPos(p.pos.x)) return 0;
  const inst = riftInstanceAtPos(ctx, p.pos);
  if (!inst) return 0;
  const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
  const floor = floorForInstance(inst);
  return riftLiftAt(floor, p.pos.x - origin.x, p.pos.z - origin.z);
}

/** Stand every rift MOB and OBJECT on the raised sanctum tier each tick (an absolute
 * Y set from the flat floor; mobs/objects never jump, so no arc to preserve). Only
 * floors with a platform do any work. Players are lifted in updateRiftTriggers. */
export function liftRiftEntities(ctx: SimContext): void {
  for (const inst of ctx.riftInstances) {
    if (inst.partyKey === null) continue;
    const floor = floorForInstance(inst);
    if (!floor.platform && !floor.layout.rooms?.some((r) => (r.lift ?? 0) !== 0)) continue;
    const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
    const lift = (id: number): void => {
      const e = ctx.entities.get(id);
      if (e) e.pos.y = DUNGEON_FLOOR_Y + riftLiftAt(floor, e.pos.x - origin.x, e.pos.z - origin.z);
    };
    for (const id of inst.mobIds) lift(id);
    for (const id of inst.objectIds) lift(id);
    if (inst.descentId !== null) lift(inst.descentId);
    if (inst.exitId !== null) lift(inst.exitId);
    if (inst.cacheId !== null) lift(inst.cacheId);
  }
}

/** Per-tick: advance every active rift boss lethal death zone fuse. When a zone
 * expires it detonates: every living player still inside the radius takes flat
 * p.hp + p.maxHp (guaranteed kill, no mechanicDamageMult modifier, by design).
 * Only instances with active zones do any real work. */
export function tickRiftBossDeathZones(ctx: SimContext): void {
  for (const inst of ctx.riftInstances) {
    if (inst.partyKey === null || inst.bossDeathZones.length === 0) continue;
    const live: Array<{ x: number; z: number; radius: number; remaining: number }> = [];
    for (const zone of inst.bossDeathZones) {
      zone.remaining -= DT;
      if (zone.remaining > 0) {
        live.push(zone);
        continue;
      }
      // Detonation: lethal to any player still inside the radius.
      const pids = instancePlayerIds(ctx, inst);
      for (const pid of pids) {
        const p = ctx.entities.get(pid);
        if (!p || p.dead || dist2d({ x: zone.x, z: zone.z, y: 0 }, p.pos) > zone.radius) continue;
        ctx.dealDamage(null, p, p.hp + p.maxHp, false, 'fire', 'Death Zone', 'hit', true);
        riftFx(ctx, p.pos.x, p.pos.z, 'fire', 'nova');
      }
    }
    inst.bossDeathZones = live;
  }
}

/** Per-tick step-clock for any active rift-cache lockpick attempt (mirrors the
 * delve controller's per-tick tickLockpickTimeout). Cheap: only instances with a
 * live session do any work. */
export function tickRiftLockpicks(ctx: SimContext): void {
  for (const inst of ctx.riftInstances) {
    if (inst.partyKey !== null && inst.lockpick) tickRiftLockpick(ctx, inst);
  }
}

export function updateRiftInstances(ctx: SimContext): void {
  // Pre-pass at TICK resolution: stamp the moment each floor boss is first seen
  // dead. The sweep below runs once a second, so without the stamp two groups
  // whose bosses fall inside the same window would be ranked by slot order and
  // the earlier kill could lose the shared race.
  for (const inst of ctx.riftInstances) {
    if (inst.partyKey === null) continue;
    // First-kill watch: the moment ANY mob of an unspoiled run dies, the run is
    // PROGRESSED (binds members, stops recycling). Self-disabling: once set, the
    // scan never runs again for this instance.
    if (!inst.progressed) {
      for (const id of inst.mobIds) {
        const mob = ctx.entities.get(id);
        if (mob?.dead) {
          inst.progressed = true;
          break;
        }
      }
    }
    if (inst.bossDiedAtTick !== null || inst.bossId === null) continue;
    if (ctx.entities.get(inst.bossId)?.dead) {
      inst.bossDiedAtTick = ctx.tickCount;
      // Clear any pending lethal death zones so a zone placed just before the
      // killing blow cannot execute the winning party. Symmetric with the evade
      // clear in locomotion.ts.
      inst.bossDeathZones = [];
    }
  }
  if (ctx.tickCount % 20 !== 0) return; // once a second
  for (const inst of ctx.riftInstances) {
    if (inst.partyKey === null) continue;
    const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);

    // Gate progression.
    const floor = floorForInstance(inst);

    // Environmental hazards (lava/blackwater): unblockable damage to any player
    // standing in a zone, skipped while airborne (jump across). 1 Hz, like delves.
    if (floor.hazards.length) tickRiftHazards(ctx, inst, origin, floor.hazards);

    // Strength boulders: a boulder counts once it rests on a socket pad; the floor
    // solves when every boulder is placed.
    if (floor.puzzle.kind === 'boulder_push' && !inst.puzzleSolved && inst.boulderPads.length) {
      let allOn = true;
      for (const id of inst.boulderIds) {
        const b = ctx.entities.get(id);
        const onPad =
          !!b &&
          inst.boulderPads.some(
            (pad) => dist2d(b.pos, ctx.groundPos(origin.x + pad.x, origin.z + pad.z)) < PAD_RADIUS,
          );
        if (b) b.templateId = onPad ? 'rift_boulder_placed' : 'rift_boulder';
        if (!onPad) allOn = false;
      }
      if (allOn) {
        inst.puzzleSolved = true;
        // Each seated socket flares as the mechanism locks home.
        for (const pad of inst.boulderPads) {
          riftFx(ctx, origin.x + pad.x, origin.z + pad.z, 'holy', 'nova');
        }
        for (const pid of instancePlayerIds(ctx, inst)) {
          ctx.emit({
            type: 'log',
            text: 'The sockets grind shut. The way stirs.',
            color: '#adf',
            pid,
          });
        }
      }
    }

    // Authored citadel: the miniboss's death arms the Blood Orb (which in turn is
    // the temple gate's only switch). Checked here, not on the kill path, so a
    // miniboss that despawns with its floor arms nothing.
    if (inst.minibossId !== null && !inst.orbActive) {
      const mini = ctx.entities.get(inst.minibossId);
      if (!mini || mini.dead) {
        inst.orbActive = true;
        const orb = inst.orbId !== null ? ctx.entities.get(inst.orbId) : null;
        if (orb) {
          orb.templateId = 'rift_infernal_orb_active';
          riftFx(ctx, orb.pos.x, orb.pos.z, 'fire', 'nova');
        }
        for (const pid of instancePlayerIds(ctx, inst)) {
          ctx.emit({
            type: 'log',
            text: "The pentagram's flame gutters out. Something wakes on the altar.",
            color: '#f97',
            pid,
          });
        }
      }
    }

    if (floor.isBoss) {
      // Clears are claimed AFTER this loop, in boss-death order (see below).
    } else if (!inst.descentOpen) {
      const puzzleDone =
        floor.puzzle.kind === 'rune_pylons'
          ? inst.litPylons.size >= inst.pylonTotal
          : inst.puzzleSolved;
      if (trashCleared(ctx, inst) && puzzleDone) openDescent(ctx, inst);
    }

    // Empty-slot cleanup.
    const occupied = instancePlayerIds(ctx, inst).length > 0;
    if (occupied) {
      inst.emptyFor = 0;
    } else {
      inst.emptyFor += 1;
      if (inst.emptyFor >= RIFT_EMPTY_TIMEOUT) freeRiftInstance(ctx, inst);
    }
  }

  // Boss clears claim in DEATH order, not slot order: every candidate whose
  // boss has a recorded kill tick ranks by that tick (slot only breaks exact
  // ties), so the group that actually finished first wins the shared race.
  // A boss floor whose boss never spawned has no recorded death and can never
  // claim (fails closed instead of handing out a free clear).
  const cleared = ctx.riftInstances
    .filter(
      (inst) =>
        inst.partyKey !== null &&
        inst.exitId === null &&
        inst.bossDiedAtTick !== null &&
        floorForInstance(inst).isBoss,
    )
    .sort((a, b) => (a.bossDiedAtTick as number) - (b.bossDiedAtTick as number) || a.slot - b.slot);
  for (const inst of cleared) {
    // Safety only: nothing tears down competitors mid-sweep anymore, but a
    // freed slot must never be completed.
    if (inst.partyKey === null) continue;
    const boss = inst.bossId !== null ? ctx.entities.get(inst.bossId) : null;
    if (!completeRiftClear(ctx, inst, boss ?? null)) continue;
    openExit(ctx, inst);
  }
}
