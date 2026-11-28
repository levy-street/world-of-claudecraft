// The Islands of the Wind's adds (the Guardian of the Breath's 50 percent
// phase, docs/design/raid/smith_heart.md 7.2): how each rises and what each
// does, a different fight on every isle of a side.
//
//   First isle    the Gale Sentinel (a melee warden) and the Gale Mender:
//                 every `mendEvery` it channels Mending Gale (`mendCast`, a
//                 bar a player interrupt cuts) and mends every living add of
//                 its isle by the tier's `mendShare` of its whole.
//   Second isle   the Gust Herald: every `shoveEvery` a Shoving Gale (a bar
//                 at its mark, the line locked as it begins): every player in
//                 the line when it lands slides `shoveYards` along it toward
//                 the rim (Normal: held a step short of the lip; Heroic: off
//                 it, into the void). Step out of the line. The Riven Squall:
//                 as it falls it splits into two Squall Fragments.
//   Third isle    the Squall Shieldbearer, its Squall Ward turning aside the
//                 tier's `wardCut` of every blow struck from inside its front
//                 arc (combat/front_ward.ts): the tank turns it, the raid
//                 strikes its back.
//
// Deterministic: marks are the add's own target or hashed, the adds in id
// order; no rng draws here (the mobs' own swings roll as any mob's).

import { isSilenced } from '../../combat/cc';
import { MOBS } from '../../data';
import { createMob } from '../../entity';
import { applyDungeonMobTuning, mobTemplateForDungeonDifficulty } from '../../instances/difficulty';
import { DT, type Entity } from '../../types';
import { clearCastIf, startBar } from '../sunken_bastion/claim';
import { breathHash } from './breath_geometry';
import { isleAt, isleSafeReach, isleSpots } from './breath_isle_geometry';
import {
  ISLE_AURAS,
  ISLE_CASTS,
  ISLE_CUES,
  ISLE_MOBS,
  ISLE_NAMES,
  ISLE_TIERS,
  ISLE_TUNING as T,
} from './breath_isle_ids';
import { type BreathScope, living, putMarker } from './breath_scope';
import { beginShove, stepShoves } from './breath_shove';
import type { BreathIsleAdd, BreathIsleRole } from './breath_state';
import { applyDevAddPool } from './tier_health';

/** The hold a Shoving Gale's slide wears (an unbreakable root). */
export const SHOVE_HOLD = 'heart_breath_shoving_gale_hold';

/** The tier's row of the phase. */
export function isleTier(s: Pick<BreathScope, 'st'>) {
  return ISLE_TIERS[s.st.difficulty];
}

/** The health an add of `role` rises with (the tier's row and its add
 *  multiplier). */
function addHealth(s: BreathScope, role: BreathIsleRole): number {
  const t = isleTier(s);
  const base = {
    sentinel: t.sentinelHealth,
    mender: t.menderHealth,
    herald: t.heraldHealth,
    squall: t.squallHealth,
    fragment: t.fragmentHealth,
    shieldbearer: t.shieldHealth,
  }[role];
  return Math.round(base * s.rules.addHealthMult);
}

/** Raise one add of `role` on isle `isle` at instance-local (x, z). */
export function raiseIsleAdd(
  s: BreathScope,
  isle: number,
  role: BreathIsleRole,
  x: number,
  z: number,
): Entity | null {
  const { ctx, inst } = s;
  const template = MOBS[ISLE_MOBS[role]];
  if (!template) return null;
  const o = ctx.instanceOriginOf(inst);
  const difficulty = inst.difficulty ?? 'normal';
  const tuned = mobTemplateForDungeonDifficulty(template, inst.dungeonId, difficulty);
  const e = createMob(ctx.nextId++, tuned, tuned.maxLevel, ctx.groundPos(o.x + x, o.z + z));
  applyDungeonMobTuning(e, inst.dungeonId, difficulty);
  const hp = addHealth(s, role);
  e.maxHp = hp;
  e.hp = hp;
  applyDevAddPool(inst, e);
  e.spawnPos = { ...e.pos };
  e.prevPos = { ...e.pos };
  const sp = isleSpots()[isle];
  e.facing = Math.atan2(sp.land.x - x, sp.land.z - z);
  e.prevFacing = e.facing;
  e.summonedAdd = true;
  e.tappedById = s.boss.tappedById;
  ctx.addEntity(e);
  inst.mobIds.push(e.id);
  s.boss.summonedIds.push(e.id);
  const first = role === 'mender' ? T.mendFirst : role === 'herald' ? T.shoveFirst : 0;
  s.st.isles.adds.push({
    id: e.id,
    isle,
    role,
    next: first,
    at: null,
    floor: { x: e.pos.x, y: e.pos.y, z: e.pos.z },
  });
  if (role === 'shieldbearer') wardOn(s, e);
  return e;
}

/** The roles that rise on an isle at its `step` of the chain. */
export function isleRoles(step: number): readonly BreathIsleRole[] {
  if (step === 0) return ['sentinel', 'mender'];
  if (step === 1) return ['herald', 'squall'];
  return ['shieldbearer'];
}

function wardOn(s: BreathScope, e: Entity): void {
  const t = isleTier(s);
  putMarker(e, ISLE_AURAS.ward, ISLE_NAMES.ward, 3600, e.id, {
    value: t.wardCut,
    value2: t.wardHalfDeg,
    permanent: true,
  });
}

/** The living adds of the phase on isle `isle` (every isle: undefined). */
export function livingIsleAdds(s: Pick<BreathScope, 'ctx' | 'st'>, isle?: number): Entity[] {
  const out: Entity[] = [];
  for (const a of s.st.isles.adds) {
    if (isle !== undefined && a.isle !== isle) continue;
    const e = s.ctx.entities.get(a.id);
    if (living(e)) out.push(e);
  }
  return out;
}

/** Living players standing on isle `isle` (entity-id order). */
export function playersOnIsle(s: BreathScope, isle: number): Entity[] {
  const o = s.ctx.instanceOriginOf(s.inst);
  const out: Entity[] = [];
  for (const meta of s.ctx.players.values()) {
    const e = s.ctx.entities.get(meta.entityId);
    if (!e || e.dead || e.ghost || e.carriedBy !== undefined) continue;
    if (isleAt(e.pos.x - o.x, e.pos.z - o.z) !== isle) continue;
    if (Math.abs(e.pos.y - isleSpots()[isle].h) > 4) continue;
    out.push(e);
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Planted where its bar began. */
function plant(s: BreathScope, e: Entity, at: { x: number; y: number; z: number }): void {
  if (e.pos.x === at.x && e.pos.z === at.z) return;
  e.pos.x = at.x;
  e.pos.y = at.y;
  e.pos.z = at.z;
  s.ctx.rebucket(e);
}

/** A bar of its own ended or was cut: clear it and start its clock over. */
function endBar(e: Entity, a: BreathIsleAdd, castId: string, every: number): void {
  clearCastIf(e, castId);
  e.channeling = false;
  a.at = null;
  a.dir = undefined;
  a.next = every;
}

// ---- the Mender ------------------------------------------------------------------------------

function stepMender(s: BreathScope, a: BreathIsleAdd, e: Entity): void {
  if (a.at) {
    if (e.castingAbility !== ISLE_CASTS.mending || s.ctx.isStunned(e) || isSilenced(e)) {
      // Cut (a player interrupt, a stun, a silence): it starts over.
      endBar(e, a, ISLE_CASTS.mending, T.mendEvery);
      return;
    }
    plant(s, e, a.at);
    e.swingTimer = Math.max(e.swingTimer, 0.6);
    e.castRemaining = Math.max(0, e.castRemaining - DT);
    if (e.castRemaining > 1e-9) return;
    endBar(e, a, ISLE_CASTS.mending, T.mendEvery);
    const share = isleTier(s).mendShare;
    for (const ally of livingIsleAdds(s, a.isle)) {
      ally.hp = Math.min(ally.maxHp, ally.hp + Math.round(ally.maxHp * share));
      s.ctx.emit({
        type: 'spellfx',
        sourceId: e.id,
        targetId: ally.id,
        school: 'nature',
        fx: 'beam',
        ability: ISLE_CUES.mended,
      });
    }
    return;
  }
  a.next -= DT;
  if (a.next > 1e-9 || e.castingAbility !== null || !e.inCombat) return;
  if (s.ctx.isStunned(e) || isSilenced(e)) return;
  startBar(e, ISLE_CASTS.mending, T.mendCast, e.id, true);
  a.at = { ...e.pos };
}

// ---- the Herald ------------------------------------------------------------------------------

/** Is a player at world (x, z) inside the Herald's gale (its line from
 *  `from` along the unit, its half width and reach)? */
export function inShoveLine(
  from: { x: number; z: number },
  dir: { ux: number; uz: number },
  x: number,
  z: number,
): boolean {
  const dx = x - from.x;
  const dz = z - from.z;
  const along = dx * dir.ux + dz * dir.uz;
  if (along < 0 || along > T.shoveReach) return false;
  return Math.abs(dx * -dir.uz + dz * dir.ux) <= T.shoveHalfWidth;
}

function heraldMark(s: BreathScope, a: BreathIsleAdd, e: Entity): Entity | null {
  const on = playersOnIsle(s, a.isle);
  if (on.length === 0) return null;
  const t = e.aggroTargetId !== null ? s.ctx.entities.get(e.aggroTargetId) : undefined;
  // Not its tank when it has a choice: the gale is for the raid.
  const others = on.filter((p) => p.id !== t?.id);
  const pool = others.length > 0 ? others : on;
  return pool[breathHash(e.id, Math.round(s.st.clock * 10)) % pool.length];
}

function stepHerald(s: BreathScope, a: BreathIsleAdd, e: Entity): void {
  if (a.at && a.dir) {
    if (e.castingAbility !== ISLE_CASTS.shove || s.ctx.isStunned(e)) {
      endBar(e, a, ISLE_CASTS.shove, T.shoveEvery);
      return;
    }
    plant(s, e, a.at);
    e.facing = Math.atan2(a.dir.ux, a.dir.uz);
    e.swingTimer = Math.max(e.swingTimer, 0.6);
    e.castRemaining = Math.max(0, e.castRemaining - DT);
    if (e.castRemaining > 1e-9) return;
    const from = { x: a.at.x, z: a.at.z };
    const dir = a.dir;
    endBar(e, a, ISLE_CASTS.shove, T.shoveEvery);
    landShove(s, a.isle, e, from, dir);
    return;
  }
  a.next -= DT;
  if (a.next > 1e-9 || e.castingAbility !== null || !e.inCombat) return;
  if (s.ctx.isStunned(e)) return;
  const mark = heraldMark(s, a, e);
  if (!mark) return;
  const dx = mark.pos.x - e.pos.x;
  const dz = mark.pos.z - e.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.5) return;
  a.dir = { ux: dx / d, uz: dz / d };
  a.at = { ...e.pos };
  e.facing = Math.atan2(a.dir.ux, a.dir.uz);
  startBar(e, ISLE_CASTS.shove, T.shoveCast, mark.id, false);
}

/** Shoving Gale lands: every player of the isle in the line slides along it. */
function landShove(
  s: BreathScope,
  isle: number,
  e: Entity,
  from: { x: number; z: number },
  dir: { ux: number; uz: number },
): void {
  const tier = isleTier(s);
  const o = s.ctx.instanceOriginOf(s.inst);
  s.ctx.emit({
    type: 'spellfx',
    sourceId: e.id,
    targetId: e.id,
    school: 'nature',
    fx: 'nova',
    ability: ISLE_CUES.shoved,
  });
  for (const p of playersOnIsle(s, isle)) {
    if (!inShoveLine(from, dir, p.pos.x, p.pos.z)) continue;
    let yards = tier.shoveYards;
    if (tier.shoveSafe)
      yards = isleSafeReach(
        isle,
        p.pos.x - o.x,
        p.pos.z - o.z,
        dir.ux,
        dir.uz,
        yards,
        T.shoveLipMargin,
      );
    const sl = beginShove(
      islePlayersScope(s),
      p,
      dir.ux,
      dir.uz,
      yards,
      T.shoveSlide,
      'out',
      SHOVE_HOLD,
      ISLE_NAMES.shove,
    );
    if (sl) s.st.isles.shoves.push(sl);
  }
}

/** The scope's players widened to every player standing on an isle (the
 *  shoves slide them there). */
function islePlayersScope(s: BreathScope): BreathScope {
  const all: Entity[] = [];
  for (let i = 0; i < isleSpots().length; i++) all.push(...playersOnIsle(s, i));
  return { ...s, players: all.sort((a, b) => a.id - b.id) };
}

// ---- the Squall ------------------------------------------------------------------------------

/** A Riven Squall fallen: two Squall Fragments rise where it fell, on its
 *  attacker. */
function splitSquall(s: BreathScope, a: BreathIsleAdd, e: Entity): void {
  a.split = true;
  const o = s.ctx.instanceOriginOf(s.inst);
  const x = e.pos.x - o.x;
  const z = e.pos.z - o.z;
  s.ctx.emit({
    type: 'spellfxAt',
    x: e.pos.x,
    z: e.pos.z,
    school: 'nature',
    fx: 'burst',
    radius: 4,
    ability: ISLE_CUES.split,
  });
  const on = playersOnIsle(s, a.isle);
  for (const k of [-1, 1]) {
    // Beside where it fell, never off the isle.
    const fx = isleAt(x + k * 2, z) === a.isle ? x + k * 2 : x;
    const f = raiseIsleAdd(s, a.isle, 'fragment', fx, z);
    if (!f || on.length === 0) continue;
    const t = on[breathHash(f.id, a.id) % on.length];
    s.ctx.aggroMob(f, t, false);
  }
}

// ---- the tick --------------------------------------------------------------------------------

/** One tick of every add's own part (in id order). */
export function stepIsleAdds(s: BreathScope): void {
  const list = [...s.st.isles.adds];
  for (const a of list) {
    const e = s.ctx.entities.get(a.id);
    if (!e) continue;
    if (!living(e)) {
      if (a.role === 'squall' && !a.split) splitSquall(s, a, e);
      continue;
    }
    if (a.role === 'mender') stepMender(s, a, e);
    else if (a.role === 'herald') stepHerald(s, a, e);
    else if (a.role === 'shieldbearer' && !e.auras.some((x) => x.id === ISLE_AURAS.ward))
      wardOn(s, e);
  }
  if (s.st.isles.shoves.length > 0) stepShoves(islePlayersScope(s), s.st.isles.shoves);
}
