// The Guardian of the Heat's per-tick scope (encounters/smith_heart/heat.ts):
// the claim, the shared state, the guardian, the players on the Hearth's
// floor, the difficulty's rules, and the plumbing every part of the fight
// shares (the bar, the damage rolls, the fire hit, the cues, the raid
// warnings, the hashed picks, the adds it raises). A leaf the fight's modules
// and the coordinator share, so none of them reaches into another. Zero rng
// but the damage rolls.

import { HEAT, SMITH_HEART_HEIGHTS } from '../../content/smith_heart_layout';
import { MOBS } from '../../data';
import { createMob } from '../../entity';
import { applyDungeonMobTuning, mobTemplateForDungeonDifficulty } from '../../instances/difficulty';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { dropEncounterBody, pickMarkTargets, startBar } from '../sunken_bastion/claim';
import { local } from './fight_kit';
import { type HPoint, inHearthFloor } from './heat_geometry';
import type { HeatDifficultyRules } from './heat_ids';
import type { HeatFightState } from './heat_state';

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

export interface HeatScope {
  ctx: SimContext;
  inst: InstanceSlot;
  st: HeatFightState;
  boss: Entity;
  /** Living players on the Hearth's floor, entity-id order. */
  players: readonly Entity[];
  rules: HeatDifficultyRules;
}

/** How far over or under the Hearth's floor a body still counts (yards). */
const FLOOR_BAND = 8;

/** Living, present players of a claim on the Hearth's floor, entity-id order. */
export function hearthPlayers(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const o = ctx.instanceOriginOf(inst);
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead || e.ghost) continue;
    if (Math.abs(e.pos.y - SMITH_HEART_HEIGHTS.heat) > FLOOR_BAND) continue;
    if (inHearthFloor(e.pos.x - o.x, e.pos.z - o.z)) out.push(e);
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Every player of the claim near the Hearth (alive or not): who hears the
 *  fight's warnings and lines. */
export function hearthListeners(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const o = ctx.instanceOriginOf(inst);
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e) continue;
    const d = Math.hypot(e.pos.x - o.x - HEAT.forge.x, e.pos.z - o.z - HEAT.forge.z);
    if (d <= 100) out.push(e);
  }
  return out.sort((a, b) => a.id - b.id);
}

/** The scope's players still alive now (one killed earlier this tick takes
 *  no further roll: the draws stay those of living targets). */
export function livePlayers(s: Pick<HeatScope, 'players'>): Entity[] {
  return s.players.filter((p) => !p.dead);
}

/** Instance-local place of `e`. */
export function at(s: Pick<HeatScope, 'ctx' | 'inst'>, e: Entity): HPoint {
  return local(s.ctx, s.inst, e);
}

/** A living entity by id, or null. */
export function liveEntity(s: Pick<HeatScope, 'ctx'>, id: number | null): Entity | null {
  if (id === null) return null;
  const e = s.ctx.entities.get(id);
  return e && !e.dead && e.hp > 0 ? e : null;
}

/** Is the guardian free to begin a bar now? */
export function guardianFree(s: HeatScope): boolean {
  if (s.st.bar || s.boss.castingAbility !== null) return false;
  if (s.st.gap > 0) return false;
  return !s.ctx.isStunned(s.boss);
}

/** Begin a bar on the guardian: a real cast bar every client mirrors, its
 *  feet planted where it began and its facing locked. */
export function beginBar(s: HeatScope, castId: string, seconds: number, facing: number): void {
  const b = s.boss;
  s.st.casts++;
  b.facing = facing;
  s.st.bar = { castId, at: { ...b.pos }, facing };
  startBar(b, castId, seconds, null);
}

/** Hold the guardian where its bar began, its facing locked. */
export function holdPlanted(s: HeatScope): void {
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
export function damageMult(s: Pick<HeatScope, 'rules' | 'boss'>): number {
  return s.rules.damageMult * (s.boss.mechanicDamageMult ?? 1);
}

/** A mechanic's damage roll (the only rng the fight draws). */
export function roll(s: HeatScope, min: number, max: number, mult = damageMult(s)): number {
  return Math.max(1, Math.round(s.ctx.rng.range(min, max) * mult));
}

/** Fire from the guardian. */
export function fireHit(s: HeatScope, p: Entity, amount: number, name: string): void {
  s.ctx.dealDamage(s.boss, p, amount, false, 'fire', name, 'hit', true);
}

/** The players a mechanic takes: hashed among the living non-tanks, the tank
 *  only when nobody else is free. Zero rng. */
export function pickPlayers(
  s: HeatScope,
  count: number,
  salt: number,
  busy: ReadonlySet<number> = new Set(),
): Entity[] {
  return pickMarkTargets(s.boss, livePlayers(s), count, salt, busy);
}

/** A raid warning from `from` to every player near the Hearth (the big
 *  orange line, re-localized client-side by `textKey`). */
export function raidWarn(
  s: Pick<HeatScope, 'ctx' | 'inst'>,
  from: Entity,
  key: string,
  text: string,
  values?: Record<string, string>,
): void {
  for (const p of hearthListeners(s.ctx, s.inst)) {
    s.ctx.emit({
      type: 'chat',
      fromPid: from.id,
      from: from.name,
      entityId: from.id,
      text,
      textKey: `hudChrome.heatGuardian.warn.${key}`,
      ...(values ? { textValues: values } : {}),
      channel: 'raidWarning',
      pid: p.id,
    });
  }
}

/** A cue at instance-local (x, z). */
export function cueAt(
  s: Pick<HeatScope, 'ctx' | 'inst'>,
  ability: string,
  x: number,
  z: number,
  radius: number,
  school: 'fire' | 'frost' | 'nature' = 'fire',
): void {
  const o = s.ctx.instanceOriginOf(s.inst);
  s.ctx.emit({
    type: 'spellfxAt',
    x: o.x + x,
    z: o.z + z,
    school,
    fx: 'burst',
    radius,
    ability,
  });
}

/** A cue on the guardian. */
export function cueOnBoss(s: Pick<HeatScope, 'ctx' | 'boss'>, ability: string): void {
  s.ctx.emit({
    type: 'spellfx',
    sourceId: s.boss.id,
    targetId: s.boss.id,
    school: 'fire',
    fx: 'nova',
    ability,
  });
}

/** A cue on one body. */
export function cueOn(s: Pick<HeatScope, 'ctx'>, target: Entity, ability: string): void {
  s.ctx.emit({
    type: 'spellfx',
    sourceId: target.id,
    targetId: target.id,
    school: 'fire',
    fx: 'nova',
    ability,
  });
}

/** A beam cue from one entity to another. */
export function beamCue(
  s: Pick<HeatScope, 'ctx'>,
  sourceId: number,
  targetId: number,
  ability: string,
  school: 'fire' | 'frost' | 'nature' = 'fire',
): void {
  s.ctx.emit({ type: 'spellfx', sourceId, targetId, school, fx: 'beam', ability });
}

// ---- the adds -----------------------------------------------------------------------------

/** Raise one of the fight's adds at instance-local (x, z), facing `facing`:
 *  tuned to the claim's difficulty, on its roster and the guardian's
 *  summons, in the fight. Null when the template is missing. */
export function spawnHeatMob(
  s: HeatScope,
  templateId: string,
  lx: number,
  lz: number,
  facing: number,
): Entity | null {
  const template = MOBS[templateId];
  if (!template) return null;
  const { ctx, inst } = s;
  const o = ctx.instanceOriginOf(inst);
  const difficulty = inst.difficulty ?? 'normal';
  const tuned = mobTemplateForDungeonDifficulty(template, inst.dungeonId, difficulty);
  const e = createMob(ctx.nextId++, tuned, tuned.maxLevel, ctx.groundPos(o.x + lx, o.z + lz));
  applyDungeonMobTuning(e, inst.dungeonId, difficulty);
  e.spawnPos = { ...e.pos };
  e.prevPos = { ...e.pos };
  e.facing = facing;
  e.prevFacing = facing;
  e.summonedAdd = true;
  e.ignoreHardLeash = true;
  e.tappedById = s.boss.tappedById;
  ctx.addEntity(e);
  inst.mobIds.push(e.id);
  s.boss.summonedIds.push(e.id);
  return e;
}

/** Take one of the fight's adds out of the claim and the world. */
export function dropHeatMob(s: Pick<HeatScope, 'ctx' | 'inst' | 'boss'>, id: number): void {
  dropEncounterBody(s.ctx, s.inst, s.boss, id);
}
