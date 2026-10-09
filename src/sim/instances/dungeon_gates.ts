// In-dungeon gates and encounter seals (G7, docs/design/dungeon-rework/
// README.md). A dungeon lists its gates in DungeonDef.gates; each is one
// collider box across a passage plus a ground-object entity whose template id
// carries the state, so the online client mirrors it with the entity and the
// renderer draws the matching look.
//
// The state is DERIVED every tick from the claim's own roster, never stored:
//   closed  until every listed pack (DungeonSpawn.packId) and boss is dead;
//   sealed  while the listed boss is alive and engaged (anti-kite, anti-reset);
//   open    otherwise.
// Dead instance mobs stay dead until the claim is freed, so an opened gate
// stays open for the instance's life (a corpse run always has a clear path),
// and a fresh claim respawns everything, so every gate closes again on reset.
//
// The collision half lives in dungeon_gate_state.ts: after deriving, this
// module writes each claimed slot's open set there, and the interior collider
// seam drops the open gates' colliders for that slot only.
//
// Draws NO rng; reads entities by the claim's spawn-ordered roster
// (claimInstance pushes one mob per DungeonSpawn, in order).

import { DUNGEONS, instanceOrigin, MOBS } from '../data';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import type { DungeonDef, DungeonGateDef, Entity } from '../types';
import { setOpenDungeonGates } from './dungeon_gate_state';

export type DungeonGateState = 'closed' | 'open' | 'sealed';

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

function bossEngaged(ctx: SimContext, inst: InstanceSlot, templateId: string): boolean {
  const index = indexFor(DUNGEONS[inst.dungeonId]);
  for (const i of index.byTemplate.get(templateId) ?? []) {
    const mob = rosterMob(ctx, inst, i);
    if (mob && !mob.dead && (mob.inCombat || mob.aiState !== 'idle')) return true;
  }
  return false;
}

/** The live state of one gate in one claim. */
export function dungeonGateState(
  ctx: SimContext,
  inst: InstanceSlot,
  gate: DungeonGateDef,
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
  if (gate.sealWhileEngaged && bossEngaged(ctx, inst, gate.sealWhileEngaged)) return 'sealed';
  return 'open';
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
 * Derive every claimed gated slot's gate states: swap each gate entity's
 * template to match, announce a gate's first opening to the players inside,
 * and publish the slot's open set to the collision view. Runs every tick.
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
    const open: string[] = [];
    for (const gate of gates) {
      const state = dungeonGateState(ctx, inst, gate);
      if (state === 'open') open.push(gate.id);
      const entity = dungeonGateEntity(ctx, inst, gate);
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
