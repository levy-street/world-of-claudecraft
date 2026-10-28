// The Masterless Strength's per-tick scope (encounters/smith_heart/final.ts):
// the claim, the shared state, the boss, the players on the Anvil of the
// World, the difficulty's rules, and the plumbing every part of the fight
// shares (the bar, the damage rolls, the hits, the cues, the raid warnings,
// the hashed picks). A leaf the fight's modules and the coordinator share, so
// none of them reaches into another. Zero rng but the damage rolls.

import { HEART_ROOM, SMITH_HEART_HEIGHTS } from '../../content/smith_heart_layout';
import { HEART_QUARTERS } from '../../content/smith_heart_quarters';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { pickMarkTargets, startBar } from '../sunken_bastion/claim';
import { local } from './fight_kit';
import type { FinalDifficultyRules } from './final_ids';
import type { FinalFightState } from './final_state';

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

export interface FinalScope {
  ctx: SimContext;
  inst: InstanceSlot;
  st: FinalFightState;
  boss: Entity;
  /** Living players on the Anvil, entity-id order. */
  players: readonly Entity[];
  rules: FinalDifficultyRules;
}

/** An instance-local point. */
export interface FPoint {
  x: number;
  z: number;
}

/** How far over or under the Anvil's floor a body still counts (yards). */
const FLOOR_BAND = 8;
/** A body this far past the rim (on the balustrade's foot) still counts. */
const RIM_SLACK = 2;

/** Is instance-local (x, z) on the Anvil's walk? */
export function onAnvil(x: number, z: number): boolean {
  return Math.hypot(x - HEART_ROOM.x, z - HEART_ROOM.z) <= HEART_QUARTERS.rimR + RIM_SLACK;
}

/** Living, present players of a claim on the Anvil, entity-id order. */
export function anvilPlayers(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const o = ctx.instanceOriginOf(inst);
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead || e.ghost) continue;
    if (Math.abs(e.pos.y - SMITH_HEART_HEIGHTS.heartRoom) > FLOOR_BAND) continue;
    if (onAnvil(e.pos.x - o.x, e.pos.z - o.z)) out.push(e);
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Every player of the claim in the Heart (alive or not): who hears the
 *  fight's warnings. */
export function heartListeners(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const o = ctx.instanceOriginOf(inst);
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e) continue;
    const d = Math.hypot(e.pos.x - o.x - HEART_ROOM.x, e.pos.z - o.z - HEART_ROOM.z);
    if (d <= 130) out.push(e);
  }
  return out.sort((a, b) => a.id - b.id);
}

/** The scope's players still alive now (one killed earlier this tick takes
 *  no further roll: the draws stay those of living targets). */
export function livePlayers(s: Pick<FinalScope, 'players'>): Entity[] {
  return s.players.filter((p) => !p.dead);
}

/** Instance-local place of `e`. */
export function at(s: Pick<FinalScope, 'ctx' | 'inst'>, e: Entity): FPoint {
  return local(s.ctx, s.inst, e);
}

/** Distance from the room's centre of an instance-local point. */
export function fromCentre(p: FPoint): number {
  return Math.hypot(p.x - HEART_ROOM.x, p.z - HEART_ROOM.z);
}

/** Keep a point on the Anvil (`rimPad` yards inside its rim). */
export function onFloor(p: FPoint, rimPad = 2): FPoint {
  const d = fromCentre(p);
  const max = HEART_ROOM.r - rimPad;
  if (d <= max) return p;
  const k = max / d;
  const c = HEART_ROOM;
  return { x: c.x + (p.x - c.x) * k, z: c.z + (p.z - c.z) * k };
}

/** Sim facing (0 = +z) from `a` toward `b`. */
export function facingTo(a: FPoint, b: FPoint): number {
  return Math.atan2(b.x - a.x, b.z - a.z);
}

/** Is the boss free to begin a bar now? */
export function bossFree(s: FinalScope): boolean {
  if (s.st.bar || s.boss.castingAbility !== null) return false;
  if (s.st.gap > 0) return false;
  return !s.ctx.isStunned(s.boss);
}

/** Begin a bar on the boss: a real cast bar every client mirrors, its feet
 *  planted where it began and its facing locked. */
export function beginBar(
  s: FinalScope,
  castId: string,
  seconds: number,
  facing: number,
  targetId: number | null = null,
): void {
  const b = s.boss;
  s.st.casts++;
  b.facing = facing;
  s.st.bar = { castId, at: { ...b.pos }, facing };
  startBar(b, castId, seconds, targetId);
}

/** Hold the boss where its bar began, its facing locked. */
export function holdPlanted(s: FinalScope): void {
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
export function damageMult(s: Pick<FinalScope, 'rules' | 'boss'>): number {
  return s.rules.damageMult * (s.boss.mechanicDamageMult ?? 1);
}

/** A mechanic's damage roll (the only rng the fight draws). */
export function roll(s: FinalScope, min: number, max: number, mult = damageMult(s)): number {
  return Math.max(1, Math.round(s.ctx.rng.range(min, max) * mult));
}

/** A hit from the boss in `school`. */
export function hit(
  s: FinalScope,
  p: Entity,
  amount: number,
  name: string,
  school: 'fire' | 'frost' | 'nature' | 'physical' | 'arcane',
): void {
  s.ctx.dealDamage(s.boss, p, amount, false, school, name, 'hit', true);
}

/** The players a mechanic takes: hashed among the living non-tanks, the tank
 *  only when nobody else is free. Zero rng. */
export function pickPlayers(
  s: FinalScope,
  count: number,
  salt: number,
  busy: ReadonlySet<number> = new Set(),
): Entity[] {
  return pickMarkTargets(s.boss, livePlayers(s), count, salt, busy);
}

/** A raid warning from the boss to every player in the Heart (the big orange
 *  line, re-localized client-side by `textKey`). */
export function raidWarn(
  s: Pick<FinalScope, 'ctx' | 'inst' | 'boss'>,
  key: string,
  text: string,
): void {
  for (const p of heartListeners(s.ctx, s.inst)) {
    s.ctx.emit({
      type: 'chat',
      fromPid: s.boss.id,
      from: s.boss.name,
      entityId: s.boss.id,
      text,
      textKey: `hudChrome.finalBoss.warn.${key}`,
      channel: 'raidWarning',
      pid: p.id,
    });
  }
}

/** A cue at instance-local (x, z). */
export function cueAt(
  s: Pick<FinalScope, 'ctx' | 'inst'>,
  ability: string,
  x: number,
  z: number,
  radius: number,
  school: 'fire' | 'frost' | 'nature' | 'physical' | 'arcane' = 'fire',
): void {
  const o = s.ctx.instanceOriginOf(s.inst);
  s.ctx.emit({ type: 'spellfxAt', x: o.x + x, z: o.z + z, school, fx: 'burst', radius, ability });
}

/** A cue on one body (`nova`), from the boss. */
export function cueOn(
  s: Pick<FinalScope, 'ctx' | 'boss'>,
  target: Entity,
  ability: string,
  school: 'fire' | 'frost' | 'nature' | 'physical' | 'arcane' = 'fire',
): void {
  s.ctx.emit({
    type: 'spellfx',
    sourceId: s.boss.id,
    targetId: target.id,
    school,
    fx: 'nova',
    ability,
  });
}

/** A beam cue from one entity to another. */
export function beamCue(
  s: Pick<FinalScope, 'ctx'>,
  sourceId: number,
  targetId: number,
  ability: string,
  school: 'fire' | 'frost' | 'nature' | 'physical' | 'arcane' = 'nature',
): void {
  s.ctx.emit({ type: 'spellfx', sourceId, targetId, school, fx: 'beam', ability });
}
