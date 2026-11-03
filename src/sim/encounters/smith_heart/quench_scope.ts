// The Guardian of the Quench's per-tick scope (encounters/smith_heart/
// quench.ts): the claim, the shared state, the guardian, the players in the
// Quench Basin, the difficulty's rules, and the plumbing every part of the
// fight shares (the bar, the damage rolls, the fight's objects, the hit
// that never kills). The fight calls NO raid warning banner (the owner's rule
// of 2026-11-04: its mechanics read in the world; the yells and each
// player's own alert stay). A leaf the fight's modules
// (quench_cold.ts, quench_ice.ts, quench_blades.ts, quench_rim.ts) and the
// coordinator share, so none of them reaches into another. Zero rng but the
// damage rolls.

import { QUENCH } from '../../content/smith_heart_layout';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { startBar } from '../sunken_bastion/claim';
import { local } from './fight_kit';
import { inQuenchBasin, type QPoint } from './quench_geometry';
import type { QuenchDifficultyRules } from './quench_ids';
import type { QuenchFightState } from './quench_state';

export {
  auraOf,
  dropAura,
  dropFightObject,
  living,
  local,
  moveFightObject,
  putMarker,
  spawnFightObject,
} from './fight_kit';

export interface QuenchScope {
  ctx: SimContext;
  inst: InstanceSlot;
  st: QuenchFightState;
  boss: Entity;
  /** Living players in the Quench Basin, entity-id order. */
  players: readonly Entity[];
  rules: QuenchDifficultyRules;
  /** Players a shatter's splash struck this tick (quench_cold.ts: one
   *  splash a tick each, however many shatter at once). */
  splashed?: Set<number>;
}

/** How far over or under the lake's floor a body still counts (yards). */
const FLOOR_BAND = 8;

/** Living, present players of a claim in the Quench Basin (the lake and its
 *  shelf), entity-id order. */
export function lakePlayers(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const o = ctx.instanceOriginOf(inst);
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead || e.ghost) continue;
    if (Math.abs(e.pos.y - QUENCH.lake.h) > FLOOR_BAND) continue;
    if (inQuenchBasin(e.pos.x - o.x, e.pos.z - o.z)) out.push(e);
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Every player of the claim near the lake (alive or not): who hears the
 *  fight's warnings and lines. */
export function lakeListeners(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const o = ctx.instanceOriginOf(inst);
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e) continue;
    const d = Math.hypot(e.pos.x - o.x - QUENCH.lake.x, e.pos.z - o.z - QUENCH.lake.z);
    if (d <= 100) out.push(e);
  }
  return out.sort((a, b) => a.id - b.id);
}

/** The scope's players still alive now (one killed earlier this tick takes
 *  no further roll: the draws stay those of living targets). */
export function livePlayers(s: Pick<QuenchScope, 'players'>): Entity[] {
  return s.players.filter((p) => !p.dead);
}

/** Instance-local place of `e` as a geometry point. */
export function at(s: Pick<QuenchScope, 'ctx' | 'inst'>, e: Entity): QPoint {
  return local(s.ctx, s.inst, e);
}

/** Is the guardian free to begin a bar now? */
export function guardianFree(s: QuenchScope): boolean {
  if (s.st.bar || s.boss.castingAbility !== null) return false;
  if (s.st.gap > 0) return false;
  return !s.ctx.isStunned(s.boss);
}

/** Begin a bar on the guardian: a real cast bar every client mirrors, its
 *  feet planted where it began and its facing locked. */
export function beginBar(s: QuenchScope, castId: string, seconds: number, facing: number): void {
  const b = s.boss;
  s.st.casts++;
  b.facing = facing;
  s.st.bar = { castId, at: { ...b.pos }, facing };
  startBar(b, castId, seconds, null);
}

/** Hold the guardian where its bar began, its facing locked (the mob AI may
 *  have walked or turned it). */
export function holdPlanted(s: QuenchScope): void {
  const bar = s.st.bar;
  const b = s.boss;
  if (!bar) return;
  b.facing = bar.facing;
  if (b.pos.x === bar.at.x && b.pos.z === bar.at.z) return;
  b.pos.x = bar.at.x;
  b.pos.y = bar.at.y;
  b.pos.z = bar.at.z;
  s.ctx.rebucket(b);
}

/** Every mechanic's damage factor: the difficulty's and the body's own. */
export function damageMult(s: Pick<QuenchScope, 'rules' | 'boss'>): number {
  return s.rules.damageMult * (s.boss.mechanicDamageMult ?? 1);
}

/** A mechanic's damage roll (the only rng the fight draws). */
export function roll(s: QuenchScope, min: number, max: number, mult = 1): number {
  return Math.max(1, Math.round(s.ctx.rng.range(min, max) * damageMult(s) * mult));
}

/** Frost damage from the guardian. */
export function frostHit(s: QuenchScope, p: Entity, amount: number, name: string): void {
  s.ctx.dealDamage(s.boss, p, amount, false, 'frost', name, 'hit', true);
}

/** The most a hit may deal `p` and leave them standing: what is left of
 *  their health above one, less every damage-taken amplifier they wear (the
 *  sim's own sums: damage.ts), so the water never kills on its own. */
export function survivableHit(p: Entity, amount: number): number {
  let amp = 1;
  let vuln = 1;
  for (const a of p.auras) {
    if (a.kind === 'spellvuln') amp += a.value;
    else if (a.kind === 'vulnerability') vuln += a.value;
  }
  const room = Math.floor((p.hp - 1) / (amp * vuln)) - 1;
  return Math.max(0, Math.min(amount, room));
}
