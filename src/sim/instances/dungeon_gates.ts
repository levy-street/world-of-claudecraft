// In-dungeon gates and encounter seals (G7, docs/design/dungeon-rework/
// README.md). A dungeon lists its gates in DungeonDef.gates; each is one
// collider box across a passage plus a ground-object entity whose template id
// carries the state, so the online client mirrors it with the entity and the
// renderer draws the matching look.
//
// The state is DERIVED every tick from the claim's own roster:
//   closed  until every listed pack (DungeonSpawn.packId) and boss is dead;
//   sealed  once the listed boss has fought for BOSS_ROOM_SEAL_DELAY_SECONDS
//           (anti-kite, anti-reset), and for as long as it stays engaged;
//   open    otherwise.
// Dead instance mobs stay dead until the claim is freed, so an opened gate
// stays open for the instance's life (a corpse run always has a clear path),
// and a fresh claim respawns everything, so every gate closes again on reset.
//
// The seal's delay (the owner's playtest of 2026-10-12: a boss room shuts ten
// seconds into the fight, not at the pull, so a group caught on the threshold
// gets in) is the one thing that needs memory: the tick the seal lands is
// stamped on the gate's own entity (Entity.gateSealTick), which the claim
// drops with everything else. While the seal is pending the gate reads OPEN,
// to every reader and on the wire, because it is. The rule, one for every
// sealing gate of every dungeon:
//   - the clock starts on the first tick the boss is fighting and lands
//     BOSS_ROOM_SEAL_DELAY_SECONDS later, counted in sim ticks;
//   - a PENDING seal is cancelled the moment the boss stops fighting (it
//     dies, or drops the pull and turns for home: a wipe inside the window),
//     so a door never shuts on an empty room, and a pull whose seal was still
//     pending gets the whole delay again, one taken up before the boss stands
//     idle included. (A seal that has LANDED is another matter: it holds while
//     the boss walks home, so a pull taken up again in that walk is behind a
//     shut door from its first tick, as it always was.);
//   - a boss that reaches its own doorway inside the window seals at once:
//     the open door is for the group to come in, never for the boss to be
//     walked out (an instance mob never leashes home, so without this a tank
//     could drag the fight out of its arena for the length of the window);
//   - a seal LANDS only with the boss on ITS side of the gate's line. One
//     thrown past it inside the window (a charge, a leap, a knockback, a
//     scripted plant) is not sealed out of its own room on the landing tick:
//     the seal waits, due, and lands on the first tick the boss is back
//     inside. That is a rule about the landing tick only. Once landed the seal
//     holds wherever the boss goes: one carried out of its room AFTER the door
//     shut (the instance hold's phase through geometry) is fought outside a
//     sealed room, exactly as before the delay existed;
//   - the wait for the boss has NO upper bound, by decision. A due seal stays
//     open for as long as a body of the boss is past the line, a minute or an
//     hour. It is not a way to keep a room open for good: a boss walking back
//     to its target crosses the doorway band (BOSS_ROOM_DOORWAY_REACH) and
//     shuts the door the tick it is inside, and holding a boss outside its
//     room was always possible once the hold's phase had carried it there. A
//     timeout would only add a second way to seal a boss OUT, which is the one
//     thing this rule exists to prevent;
//   - a seal that has landed holds exactly as before: while the boss is in
//     combat or walking home, open again once it stands idle.
// "Its side" is the half of the floor its spawn lies on, cut by the gate's
// line. Every sealed arena of every dungeon lies wholly on that half
// (tests/dungeon_gate_seal_delay.test.ts floods each one to prove it), so the
// half plane is exact for the content that ships.
// Whoever is outside when it lands is locked out until the boss dies or
// resets, as they were when the seal landed at the pull.
//
// One tick of slack for an early reader: the stamp is a tick number, and a
// caller of dungeonGateState on the due tick BEFORE this module's pass has run
// that tick reads "sealed" from the stamp alone, although the pass may still
// hold the seal for a boss past the line or cancel it for one that just
// stopped fighting. The collision view and the gate's wire template are
// written by the pass itself, so those two are never early; a caller that
// must not be early either should read after tickDungeonGates has run.
//
// The collision half lives in dungeon_gate_state.ts: after deriving, this
// module writes each claimed slot's open set there, and the interior collider
// seam drops the open gates' colliders for that slot only.
//
// Draws NO rng; reads entities by the claim's spawn-ordered roster
// (claimInstance pushes one mob per DungeonSpawn, in order).

import { rotY } from '../collider_shapes';
import { DUNGEONS, instanceOrigin, MOBS } from '../data';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import { type DungeonDef, type DungeonGateDef, type Entity, TICK_RATE } from '../types';
import { setOpenDungeonGates } from './dungeon_gate_state';

export type DungeonGateState = 'closed' | 'open' | 'sealed';

/** Seconds a boss fights before its arena seals behind the group. One rule for
 *  every gate that declares `sealWhileEngaged`, in every dungeon. */
export const BOSS_ROOM_SEAL_DELAY_SECONDS = 10;
/** The same delay in sim ticks: the clock counts ticks, never wall time. */
export const BOSS_ROOM_SEAL_DELAY_TICKS = Math.round(BOSS_ROOM_SEAL_DELAY_SECONDS * TICK_RATE);
/** How near its own doorway (yards short of the gate's line, on the boss's
 *  side) a fighting boss seals the room at once. Wider than one tick of the
 *  fastest mob dash plus the gate box, so the seal always lands with the boss
 *  still inside. */
export const BOSS_ROOM_DOORWAY_REACH = 3;
/** How far beside the passage the doorway still counts. */
const DOORWAY_BESIDE = 1;
/** The stamp of a seal that is due but held open because a body of the boss
 *  is past the gate's line: no tick ever reaches it, so every reader sees the
 *  gate open until the boss is back on its side. */
const SEAL_AWAITS_BOSS = Number.POSITIVE_INFINITY;

export const DUNGEON_GATE_TEMPLATES: Readonly<Record<DungeonGateState, string>> = {
  closed: 'dungeon_gate_closed',
  open: 'dungeon_gate_open',
  sealed: 'dungeon_gate_sealed',
};

/** The gate state a mirrored gate entity's template id encodes, or null. */
export function dungeonGateStateOf(templateId: string): DungeonGateState | null {
  if (templateId === 'dungeon_gate_open') return 'open';
  if (templateId === 'dungeon_gate_closed') return 'closed';
  if (templateId === 'dungeon_gate_sealed') return 'sealed';
  return null;
}

/** The gate authored at an instance-local point (the entity spawn spot). */
export function dungeonGateAt(dungeonId: string, lx: number, lz: number): DungeonGateDef | null {
  for (const g of DUNGEONS[dungeonId]?.gates ?? []) {
    if (Math.abs(g.x - lx) < 0.75 && Math.abs(g.z - lz) < 0.75) return g;
  }
  return null;
}

interface RosterIndex {
  byPack: Map<string, number[]>;
  byTemplate: Map<string, number[]>;
}

// Derived once per dungeon from immutable content (spawn index lists).
const rosterIndex = new Map<string, RosterIndex>();

function indexFor(dungeon: DungeonDef): RosterIndex {
  let index = rosterIndex.get(dungeon.id);
  if (!index) {
    index = { byPack: new Map(), byTemplate: new Map() };
    dungeon.spawns.forEach((spawn, i) => {
      if (spawn.packId) {
        const list = index?.byPack.get(spawn.packId) ?? [];
        list.push(i);
        index?.byPack.set(spawn.packId, list);
      }
      const list = index?.byTemplate.get(spawn.mobId) ?? [];
      list.push(i);
      index?.byTemplate.set(spawn.mobId, list);
    });
    rosterIndex.set(dungeon.id, index);
  }
  return index;
}

function rosterMob(ctx: SimContext, inst: InstanceSlot, spawnIndex: number): Entity | null {
  const id = inst.mobIds[spawnIndex];
  return id === undefined ? null : (ctx.entities.get(id) ?? null);
}

function allDead(ctx: SimContext, inst: InstanceSlot, indices: readonly number[]): boolean {
  for (const i of indices) {
    const mob = rosterMob(ctx, inst, i);
    if (mob && !mob.dead) return false;
  }
  return true;
}

/** Is every listed pack of `packIds` dead in this claim? */
export function dungeonPacksDead(
  ctx: SimContext,
  inst: InstanceSlot,
  packIds: readonly string[],
): boolean {
  const index = indexFor(DUNGEONS[inst.dungeonId]);
  return packIds.every((pack) => allDead(ctx, inst, index.byPack.get(pack) ?? []));
}

/**
 * Is every placed body of `templateId` dead in this claim? The gates' own
 * boss read (a gate's `bosses` list waits on exactly this), exposed so the
 * run's objectives (dungeon_run.ts) tick a boss the same instant the gate
 * behind it opens. False for a template the dungeon never places: a body an
 * encounter summons is not on the spawn-ordered roster, so it has no answer
 * here and the caller must look it up its own way.
 */
export function dungeonPlacedBossDead(
  ctx: SimContext,
  inst: InstanceSlot,
  templateId: string,
): boolean {
  const dungeon = DUNGEONS[inst.dungeonId];
  const indices = dungeon ? indexFor(dungeon).byTemplate.get(templateId) : undefined;
  return indices !== undefined && allDead(ctx, inst, indices);
}

/** Engaged in the old, broad sense a landed seal holds on: alive and either
 *  in combat or anywhere but idle (so a boss walking home keeps it shut). */
function isEngaged(mob: Entity): boolean {
  return !mob.dead && (mob.inCombat || mob.aiState !== 'idle');
}

/** Fighting: engaged and not walking home. Only a fight starts the seal
 *  clock or keeps a pending seal alive. */
function isFighting(mob: Entity): boolean {
  return isEngaged(mob) && mob.aiState !== 'evade';
}

function bossEngaged(ctx: SimContext, inst: InstanceSlot, templateId: string): boolean {
  const index = indexFor(DUNGEONS[inst.dungeonId]);
  for (const i of index.byTemplate.get(templateId) ?? []) {
    const mob = rosterMob(ctx, inst, i);
    if (mob && isEngaged(mob)) return true;
  }
  return false;
}

/**
 * How far a point stands on the `home` side of a gate's line, in yards along
 * the passage (instance-local): positive on the side `home` lies on, negative
 * past the line. Pure.
 */
export function gateInward(
  gate: DungeonGateDef,
  home: { x: number; z: number },
  at: { x: number; z: number },
): number {
  const homeSide = rotY(home.x - gate.x, home.z - gate.z, -gate.rot).z < 0 ? -1 : 1;
  return rotY(at.x - gate.x, at.z - gate.z, -gate.rot).z * homeSide;
}

/**
 * Is a point in a gate's doorway, seen from the side `home` lies on? In the
 * gate's own frame (instance-local): across the passage within its width, and
 * along it within BOSS_ROOM_DOORWAY_REACH short of the line, never past it (a
 * body past the line would be shut OUT by a seal). Pure.
 */
export function inGateDoorway(
  gate: DungeonGateDef,
  home: { x: number; z: number },
  at: { x: number; z: number },
): boolean {
  const across = rotY(at.x - gate.x, at.z - gate.z, -gate.rot).x;
  if (Math.abs(across) > gate.hw + DOORWAY_BESIDE) return false;
  const inward = gateInward(gate, home, at);
  return inward > 0 && inward <= BOSS_ROOM_DOORWAY_REACH;
}

/** Has the seal stamped on a gate entity landed by now? */
function sealLanded(ctx: SimContext, entity: Entity | null): boolean {
  // No gate object to carry the clock (content with a seal but no object):
  // fail closed, the seal at the pull as it was before the delay.
  if (!entity) return true;
  return entity.gateSealTick !== undefined && ctx.tickCount >= entity.gateSealTick;
}

/** The state of one gate; `entity` is its gate object when the caller already
 *  holds it (the tick), or undefined to look it up only if the seal needs it. */
function gateState(
  ctx: SimContext,
  inst: InstanceSlot,
  gate: DungeonGateDef,
  entity: Entity | null | undefined,
): DungeonGateState {
  if (inst.partyKey === null) return 'closed';
  if (inst.exitId !== null && devOpen.get(inst) === inst.exitId) return 'open';
  const dungeon = DUNGEONS[inst.dungeonId];
  if (!dungeon) return 'closed';
  const index = indexFor(dungeon);
  for (const pack of gate.packs ?? []) {
    if (!allDead(ctx, inst, index.byPack.get(pack) ?? [])) return 'closed';
  }
  for (const boss of gate.bosses ?? []) {
    if (!allDead(ctx, inst, index.byTemplate.get(boss) ?? [])) return 'closed';
  }
  if (
    gate.sealWhileEngaged &&
    bossEngaged(ctx, inst, gate.sealWhileEngaged) &&
    sealLanded(ctx, entity === undefined ? dungeonGateEntity(ctx, inst, gate) : entity)
  ) {
    return 'sealed';
  }
  return 'open';
}

/** The live state of one gate in one claim. A gate whose seal is still pending
 *  reads 'open': it is, until the delay runs out. */
export function dungeonGateState(
  ctx: SimContext,
  inst: InstanceSlot,
  gate: DungeonGateDef,
): DungeonGateState {
  return gateState(ctx, inst, gate, undefined);
}

/** The gate object entity of `gate` in this claim (found by its spawn spot). */
export function dungeonGateEntity(
  ctx: SimContext,
  inst: InstanceSlot,
  gate: DungeonGateDef,
): Entity | null {
  const dungeon = DUNGEONS[inst.dungeonId];
  const o = instanceOrigin(dungeon.index, inst.slot);
  for (const id of inst.objectIds) {
    const e = ctx.entities.get(id);
    if (!e || dungeonGateStateOf(e.templateId) === null) continue;
    if (Math.abs(e.pos.x - o.x - gate.x) < 0.75 && Math.abs(e.pos.z - o.z - gate.z) < 0.75) {
      return e;
    }
  }
  return null;
}

// Slots this world wrote an open set for, so a freed slot is cleared by the
// world that opened it and never by a short-lived world that never did.
const writtenBy = new WeakMap<InstanceSlot, true>();

// One claim's gate objects, aligned with its gates: refilled for each claim on
// each tick and read by both passes below, so the tick allocates no list for
// it. Scratch, never state: nothing is read from it that this tick did not
// write.
const gateObjects: (Entity | null)[] = [];

/** The first gate of `gates` that seals for `bossId`. */
function firstSealGate(gates: readonly DungeonGateDef[], bossId: string): number {
  for (let i = 0; i < gates.length; i++) if (gates[i].sealWhileEngaged === bossId) return i;
  return -1;
}

// Dev-only override (/dev crypt gates): every gate of the claim reads open.
// Keyed by the slot record of ONE world and bound to the claim's identity
// (its exit entity id), so a freed and re-claimed slot starts closed again.
const devOpen = new WeakMap<InstanceSlot, number>();

/** Open (or restore) every gate of a live claim for a dev playtest walk. */
export function setDungeonGatesDevOpen(inst: InstanceSlot, open: boolean): void {
  if (open && inst.partyKey !== null && inst.exitId !== null) devOpen.set(inst, inst.exitId);
  else devOpen.delete(inst);
}

function announce(ctx: SimContext, inst: InstanceSlot, text: string): void {
  const o = instanceOrigin(DUNGEONS[inst.dungeonId].index, inst.slot);
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || Math.abs(e.pos.x - o.x) >= 120 || Math.abs(e.pos.z - o.z) >= 250) continue;
    ctx.emit({ type: 'log', text, color: '#e8c070', pid: meta.entityId });
  }
}

/**
 * Advance one boss's seal clock in one claim and stamp it on every gate that
 * seals for that boss (Korgath has two), so they land together. Runs once per
 * boss per tick, before the states are derived. `entities` is the claim's gate
 * objects, aligned with `gates`. Draws no rng.
 */
function tickBossSeal(
  ctx: SimContext,
  inst: InstanceSlot,
  gates: readonly DungeonGateDef[],
  entities: readonly (Entity | null)[],
  bossId: string,
  ox: number,
  oz: number,
): void {
  const now = ctx.tickCount;
  // The earliest stamp any of its gates carries is the boss's clock.
  let at: number | undefined;
  for (let i = 0; i < gates.length; i++) {
    const stamp = gates[i].sealWhileEngaged === bossId ? entities[i]?.gateSealTick : undefined;
    if (stamp !== undefined && (at === undefined || stamp < at)) at = stamp;
  }
  // Landed on an earlier tick: from here it only holds or lifts.
  const landed = at !== undefined && now > at;
  const roster = indexFor(DUNGEONS[inst.dungeonId]).byTemplate.get(bossId) ?? [];
  // Is the boss engaged, and is it fighting? Asked first and alone: a boss
  // standing idle in its room (every boss of every claim, nearly every tick)
  // costs these two flags and nothing more.
  let engaged = false;
  let fighting = false;
  for (const r of roster) {
    const boss = rosterMob(ctx, inst, r);
    if (!boss || boss.dead) continue;
    if (isEngaged(boss)) engaged = true;
    if (isFighting(boss)) fighting = true;
  }
  if (!engaged) {
    // Dead, or home and idle: no seal, pending or landed.
    at = undefined;
  } else if (!landed) {
    if (!fighting) {
      // Walking home: a boss walking home starts no clock, and a pending seal
      // is cancelled the moment the pull is dropped, so the next pull,
      // however soon, gets the whole delay.
      at = undefined;
    } else {
      // Only here, a seal still to land with its boss fighting, does it
      // matter where the boss's bodies stand.
      let atDoor = false;
      let allHome = true;
      for (const r of roster) {
        const boss = rosterMob(ctx, inst, r);
        if (!boss || boss.dead) continue;
        const home = { x: boss.spawnPos.x - ox, z: boss.spawnPos.z - oz };
        const here = { x: boss.pos.x - ox, z: boss.pos.z - oz };
        for (const gate of gates) {
          if (gate.sealWhileEngaged !== bossId) continue;
          if (gateInward(gate, home, here) <= 0) allHome = false;
          else if (isFighting(boss) && inGateDoorway(gate, home, here)) atDoor = true;
        }
      }
      // The first fighting tick starts the clock; a boss at its own door
      // shuts it now, with the boss still inside.
      if (at === undefined) at = now + BOSS_ROOM_SEAL_DELAY_TICKS;
      if (atDoor) at = now;
      // Due, but a body of the boss is past the gate's line: the seal waits
      // for it rather than shut it out of its own room on this tick. It waits
      // as long as it takes (see the header: no upper bound, by decision).
      if (now >= at || at === SEAL_AWAITS_BOSS) at = allHome ? now : SEAL_AWAITS_BOSS;
    }
  }
  // Written as undefined, never deleted (the Entity shape stays stable).
  for (let i = 0; i < gates.length; i++) {
    const entity = entities[i];
    if (entity && gates[i].sealWhileEngaged === bossId) entity.gateSealTick = at;
  }
}

/**
 * Derive every claimed gated slot's gate states: advance each sealing boss's
 * clock, swap each gate entity's template to match its state, announce a
 * gate's first opening to the players inside, and publish the slot's open set
 * to the collision view. Runs every tick.
 */
export function tickDungeonGates(ctx: SimContext): void {
  for (const inst of ctx.instances) {
    const gates = DUNGEONS[inst.dungeonId]?.gates;
    if (!gates || gates.length === 0) continue;
    const o = instanceOrigin(DUNGEONS[inst.dungeonId].index, inst.slot);
    if (inst.partyKey === null) {
      devOpen.delete(inst);
      if (writtenBy.has(inst)) {
        setOpenDungeonGates(o.x, o.z, []);
        writtenBy.delete(inst);
      }
      continue;
    }
    // Each gate's object, found once a tick and shared by the two passes.
    const entities = gateObjects;
    entities.length = gates.length;
    for (let i = 0; i < gates.length; i++) entities[i] = dungeonGateEntity(ctx, inst, gates[i]);
    for (let i = 0; i < gates.length; i++) {
      const bossId = gates[i].sealWhileEngaged;
      if (!bossId) continue;
      // Once per boss: at the first gate that names it.
      if (firstSealGate(gates, bossId) !== i) continue;
      tickBossSeal(ctx, inst, gates, entities, bossId, o.x, o.z);
    }
    const open: string[] = [];
    for (let i = 0; i < gates.length; i++) {
      const gate = gates[i];
      const entity = entities[i];
      const state = gateState(ctx, inst, gate, entity);
      if (state === 'open') open.push(gate.id);
      if (!entity) continue;
      const template = DUNGEON_GATE_TEMPLATES[state];
      if (entity.templateId === template) continue;
      const wasClosed = entity.templateId === DUNGEON_GATE_TEMPLATES.closed;
      entity.templateId = template;
      if (wasClosed && gate.openText) announce(ctx, inst, gate.openText);
    }
    setOpenDungeonGates(o.x, o.z, open);
    writtenBy.set(inst, true);
  }
}

/** Every mob template a dungeon's gates wait on (content validation). */
export function dungeonGateBossIds(dungeon: DungeonDef): string[] {
  const out = new Set<string>();
  for (const g of dungeon.gates ?? []) {
    for (const b of g.bosses ?? []) out.add(b);
    if (g.sealWhileEngaged) out.add(g.sealWhileEngaged);
  }
  return [...out].filter((id) => MOBS[id] !== undefined);
}
