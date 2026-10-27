// The Guardian of the Breath's per-tick scope (encounters/smith_heart/
// breath.ts): the claim, the shared state, the guardian, the players on the
// Storm Cornice, the difficulty's rules, and the plumbing every part of the
// fight shares (the bar, the hashed marks, the damage rolls, the raid
// warnings, the fight's objects, the void-safe throw). A leaf the fight's
// modules (breath_gale.ts, breath_thessaly.ts, breath_storm.ts) and the
// coordinator share, so none of them reaches into another. Zero rng but the
// damage rolls.

import { BREATH, SMITH_HEART_FIELD } from '../../content/smith_heart_layout';
import { authoredFieldHeight } from '../../instances/authored_field';
import { displaceAlong } from '../../knockback';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { pickMarkTargets, startBar } from '../sunken_bastion/claim';
import { inBreathArena } from './breath_geometry';
import { BREATH_AURAS, type BreathDifficultyRules } from './breath_ids';
import type { BreathFightState } from './breath_state';
import { local } from './fight_kit';

// The shared plumbing (fight_kit.ts), under the names the Breath's modules use.
export {
  auraOf,
  dropAura,
  dropFightObject as dropBreathObject,
  living,
  local,
  moveFightObject as moveBreathObject,
  putMarker,
  spawnFightObject as spawnBreathObject,
} from './fight_kit';

export interface BreathScope {
  ctx: SimContext;
  inst: InstanceSlot;
  st: BreathFightState;
  boss: Entity;
  /** Living players on the Cornice's floor, entity-id order. */
  players: readonly Entity[];
  rules: BreathDifficultyRules;
}

/** Living, present players of a claim standing on the Cornice's fighting
 *  floor (breath_geometry.ts inBreathArena), entity-id order. */
export function cornicePlayers(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const o = ctx.instanceOriginOf(inst);
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead || e.ghost) continue;
    if (Math.abs(e.pos.y - BREATH.cornice.h) > 8) continue;
    if (inBreathArena(e.pos.x - o.x, e.pos.z - o.z)) out.push(e);
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Every player of the claim near the Cornice (alive or not): who hears the
 *  fight's warnings and lines. */
export function corniceListeners(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const o = ctx.instanceOriginOf(inst);
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e) continue;
    const d = Math.hypot(e.pos.x - o.x - BREATH.cornice.x, e.pos.z - o.z - BREATH.cornice.z);
    if (d <= 120) out.push(e);
  }
  return out.sort((a, b) => a.id - b.id);
}

/** The scope's players still alive now (one killed earlier this tick takes
 *  no further roll: the draws stay those of living targets). */
export function livePlayers(s: Pick<BreathScope, 'players'>): Entity[] {
  return s.players.filter((p) => !p.dead);
}

/** Is the guardian free to begin a bar now? */
export function guardianFree(s: BreathScope): boolean {
  if (s.st.bar || s.boss.castingAbility !== null) return false;
  if (s.st.gap > 0) return false;
  return !s.ctx.isStunned(s.boss);
}

/** Begin a bar on the guardian: a real cast bar every client mirrors, its
 *  feet planted where it began. */
export function beginBar(
  s: BreathScope,
  castId: string,
  seconds: number,
  targetId: number | null,
): void {
  const b = s.boss;
  s.st.casts++;
  s.st.bar = { castId, at: { ...b.pos }, targetId };
  startBar(b, castId, seconds, targetId);
  if (targetId !== null) {
    const t = s.ctx.entities.get(targetId);
    if (t) b.facing = Math.atan2(t.pos.x - b.pos.x, t.pos.z - b.pos.z);
  }
}

/** The players a mark takes: hashed among the living non-tanks on the
 *  Cornice (the tank only when nobody else is free). Zero rng. */
export function pickMarks(
  s: BreathScope,
  count: number,
  busy: ReadonlySet<number> = new Set(),
): Entity[] {
  const salt = s.st.casts * 13 + 5;
  return pickMarkTargets(s.boss, s.players, count, salt, busy);
}

/** Every mechanic's damage factor: the difficulty's and the body's own. */
export function damageMult(s: BreathScope): number {
  return s.rules.damageMult * (s.boss.mechanicDamageMult ?? 1);
}

/** A mechanic's damage roll (the only rng the fight draws). */
export function roll(s: BreathScope, min: number, max: number, mult = 1): number {
  return Math.max(1, Math.round(s.ctx.rng.range(min, max) * damageMult(s) * mult));
}

/** A raid warning from `from` to every player near the Cornice (the big
 *  orange line, re-localized client-side by `textKey`). */
export function raidWarn(
  s: Pick<BreathScope, 'ctx' | 'inst'>,
  from: Entity,
  key: string,
  text: string,
  values?: Record<string, string>,
): void {
  for (const p of corniceListeners(s.ctx, s.inst)) {
    s.ctx.emit({
      type: 'chat',
      fromPid: from.id,
      from: from.name,
      entityId: from.id,
      text,
      textKey: `hudChrome.breathGuardian.warn.${key}`,
      ...(values ? { textValues: values } : {}),
      channel: 'raidWarning',
      pid: p.id,
    });
  }
}

/** Hold the guardian where its bar began (the mob AI may have walked it). */
export function holdPlanted(s: BreathScope): void {
  const at = s.st.bar?.at;
  const b = s.boss;
  if (!at || (b.pos.x === at.x && b.pos.z === at.z)) return;
  b.pos.x = at.x;
  b.pos.y = at.y;
  b.pos.z = at.z;
  s.ctx.rebucket(b);
}

// ---- auras --------------------------------------------------------------------------------

/** Held in Thessaly's calm: no wind, pull, blast or throw moves this body. */
export function anchored(e: Entity): boolean {
  return e.auras.some((a) => a.id === BREATH_AURAS.anchor);
}

// ---- the void-safe throw ------------------------------------------------------------------

/**
 * Throw `p` up to `distance` yards along the unit (ux, uz): the knockback's
 * walker (a wall stops it), unless Thessaly's anchor holds them. A throw
 * that carries the body past an open lip (a gap) leaves it in the air over
 * the void, where it falls: the walker alone would seat it on the void's
 * floor. Returns the yards moved.
 */
export function throwPlayer(
  s: Pick<BreathScope, 'ctx' | 'inst'>,
  p: Entity,
  ux: number,
  uz: number,
  distance: number,
): number {
  if (anchored(p) || p.carriedBy !== undefined) return 0;
  const startY = p.pos.y;
  const moved = displaceAlong(s.ctx, p, ux, uz, distance);
  if (moved <= 0) return 0;
  const o = s.ctx.instanceOriginOf(s.inst);
  const floor = authoredFieldHeight(SMITH_HEART_FIELD, p.pos.x - o.x, p.pos.z - o.z);
  if (floor <= SMITH_HEART_FIELD.voidHeight + 1) {
    // Over the void: in the air at the lip's height, carried on outward.
    p.pos.y = startY;
    p.prevPos = { ...p.pos };
    p.onGround = false;
    p.jumping = false;
    p.vy = 0;
    p.vx = ux * 6;
    p.vz = uz * 6;
    p.fallStartY = startY;
  }
  return moved;
}
