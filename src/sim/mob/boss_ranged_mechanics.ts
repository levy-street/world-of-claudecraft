// The ranged-punish kit: three telegraphed mechanics for the players who stand far away.
//
// Every other thing Balgath throws is centred on his own feet or aimed inside his reach,
// so a caster parked thirty-five yards out used to watch the fight rather than play it.
// These three reach them, and each is dodged a different way:
//
//   BOULDER  He rips a boulder out of the ground and hurls it at the FARTHEST players
//            (two of them, at least `minRange` out). A ground circle marks where each will
//            land; it lands after the wind-up. Dodged by MOVING, which is the whole point:
//            a caster who keeps casting in it wears it.
//   GLARE    His eye locks on one far player and paints a line on the ground from his feet
//            through them. After the wind-up a beam rakes down it. Dodged by stepping out
//            of the line, or by putting something SOLID between you and him: a muster
//            barricade, a palisade, a tent (any sim collider tall enough to cross the sight
//            line). A soldier is not cover: bodies are not colliders. Nor is a soldier
//            hurt by it: the eye burns only the player it locked on and whoever shares
//            the line, never the muster or the wildlife (see fireGlare).
//   BURDEN   A shared soak (the Varkhul Shared Pyre mechanism, shared_soak.ts): one player
//            is marked, and when the wind-up ends the damage is split between everyone
//            standing inside the circle around them. Lethal alone, trivial shared: dodged
//            by STACKING, the one reaction nothing else in this fight asks for.
//
// All three share the boss's mechanic spacing lock with his slams and circle smashes
// (mob/mechanic_spacing.ts): each claims it for its wind-up and none starts while it runs,
// so at most one telegraph is ever on the ground. Among themselves they hold at due and
// the MOST OVERDUE goes first, ties to boulder, glare, burden, so none starves.
//
// Declared per template (`MobTemplate.rangedMechanics`) and inert for every mob without
// it, so nothing else in the world changes shape and the golden parity trace is untouched.

import {
  BURDEN_AURA_ID,
  farCandidates,
  farthestCandidates,
  type GlareLine,
  glareLineLength,
  insideGlare,
} from '../boss_ranged_geometry';
import { lineOfSightClear } from '../colliders';
import { MOBS } from '../data';
import { playersInsideSoak, sharedSoakFraction } from '../shared_soak';
import type { SimContext } from '../sim_context';
import type { Aura, Entity, MobTemplate, Vec3 } from '../types';
import { DT, dist2d } from '../types';
import { splashNearbyMobs } from './boss_collateral';
import { launchFromSlam } from './boss_slams';
import { levelScaledMechanicDamage } from './mechanic_level_scale';
import { claimMechanicSpacing, governedOverdue, mechanicSpacingBlocked } from './mechanic_spacing';
import { emitMobYell } from './yells';

type RangedDef = NonNullable<MobTemplate['rangedMechanics']>;
export type RangedKind = 'boulder' | 'glare' | 'burden';

/** Animation and render cue ids (the `ability` on every event this module emits). */
export const BOULDER_ABILITY = 'mob_balgath_boulder';
export const GLARE_ABILITY = 'mob_balgath_glare';
export const BURDEN_ABILITY = 'mob_balgath_burden';

/** The soak mark on the chosen player. Its presence IS the telegraph the renderer draws. */
export { BURDEN_AURA_ID };

/** Fixed SFX recordings (already in the manifest) for the three landings. */
export const BOULDER_SFX = 'rift_boulder_impact';
export const GLARE_SFX = 'impact_arcane';
export const BURDEN_SFX = 'impact_warrior_quake';

/** Seconds the burden mark outlives its wind-up (it is stripped when it lands). */
export const BURDEN_AURA_GRACE = 0.25;

/** Step of the glare's cover march, yards. Under every collider's depth. */
const GLARE_MARCH_STEP = 0.5;

/** Tie order for equally overdue mechanics. */
const ORDER: readonly RangedKind[] = ['boulder', 'glare', 'burden'];

const TIMER_FIELD = {
  boulder: 'boulderTimer',
  glare: 'glareTimer',
  burden: 'burdenTimer',
} as const;

function livingPlayers(ctx: SimContext): Entity[] {
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (p && !p.dead) out.push(p);
  }
  return out;
}

/**
 * Whether ANY telegraph of his is winding or spacing out right now. The spacing lock is
 * the primary gate (every telegraph claims it); the explicit wind-up fields are belt and
 * braces for a template whose telegraphs are declared without a spacing value.
 */
export function rangedMechanicBlocked(mob: Entity): boolean {
  return (
    mechanicSpacingBlocked(mob) ||
    (mob.slamWindup ?? 0) > 0 ||
    (mob.rangedWindup ?? 0) > 0 ||
    (mob.stompWindupRemaining ?? 0) > 0 ||
    (mob.pulseWindupRemaining ?? 0) > 0 ||
    // Wake of the Fallen Star in flight (mob/boss_starwake.ts): its bar ends before its
    // marks go down, so the cast alone does not cover the whole run.
    mob.starwakeElapsed !== undefined ||
    mob.castingAbility !== null
  );
}

/**
 * Advance the ranged kit for one engaged tick.
 *
 * Resolves a live wind-up FIRST and unconditionally (a mark on the ground always lands,
 * wherever he has walked since), then considers starting one. Starting is gated like his
 * aimed slams: planted and fighting (`aiState === 'attack'`), and on a warpath only in the
 * focus phase, never mid-run or mid-wreck.
 */
export function tickBossRangedMechanics(ctx: SimContext, mob: Entity): void {
  const def = MOBS[mob.templateId]?.rangedMechanics;
  if (!def) return;
  // Recomputed below on every tick that can start one; anything that returns early
  // leaves no ranged mechanic competing for the lock's next slot.
  mob.rangedReadyOverdue = undefined;
  resolveWindup(ctx, mob, def);
  if ((mob.rangedWindup ?? 0) > 0) return;
  if (mob.aiState !== 'attack') return;
  if (mob.warpathPhase !== undefined && mob.warpathPhase !== 'focus') return;
  const target = mob.aggroTargetId !== null ? ctx.entities.get(mob.aggroTargetId) : null;
  if (!target || target.dead) return;
  mob.boulderTimer = (mob.boulderTimer ?? def.boulder.every) - DT;
  mob.glareTimer = (mob.glareTimer ?? def.glare.every) - DT;
  mob.burdenTimer = (mob.burdenTimer ?? def.burden.every) - DT;
  // Due AND aimable, most overdue first (a stable sort keeps ORDER for ties). A due
  // mechanic with nobody to aim at (the whole raid is in melee, say) holds at due without
  // competing for the lock, so the rest of his kit runs exactly as it would without it;
  // the moment someone gives it a target it is the oldest thing waiting and goes next.
  const players = livingPlayers(ctx);
  const ready = ORDER.filter(
    (k) => (mob[TIMER_FIELD[k]] ?? 0) <= 0 && aimable(ctx, mob, def, k, players),
  ).sort((a, b) => (mob[TIMER_FIELD[a]] ?? 0) - (mob[TIMER_FIELD[b]] ?? 0));
  if (ready.length === 0) return;
  const oldest = -(mob[TIMER_FIELD[ready[0]]] ?? 0);
  // Published for the oldest-due drain of his circle smashes (mechanic_spacing.ts), which
  // runs later this same tick.
  mob.rangedReadyOverdue = oldest;
  if (rangedMechanicBlocked(mob)) return;
  // A governed mechanic that has waited strictly longer goes first, on its own driver.
  if (oldest < governedOverdue(mob)) return;
  const kind = ready[0];
  if (tryStart(ctx, mob, def, kind)) {
    mob[TIMER_FIELD[kind]] = def[kind].every;
    mob.rangedReadyOverdue = undefined;
  }
}

/**
 * The players the two AIMED ranged casts may pick: everyone alive except a player whose
 * Shardpike is braced or steadied (lance_trial.ts, a live `meta.lance` session is exactly
 * those two phases). The ranged kit exists to punish a caster parked far out, not the
 * pike bearer holding still at range because the fight asks them to; with nobody else
 * far enough, the cast has no one to aim at and does not fire. Draws no rng.
 */
function aimablePlayers(ctx: SimContext, players: Entity[]): Entity[] {
  return players.filter((p) => !ctx.players.get(p.id)?.lance);
}

/** Whether `kind` has anyone to aim at right now. Draws no rng. */
function aimable(
  ctx: SimContext,
  mob: Entity,
  def: RangedDef,
  kind: RangedKind,
  players: Entity[],
): boolean {
  if (kind === 'boulder') {
    const b = def.boulder;
    return farCandidates(aimablePlayers(ctx, players), mob.pos, b.minRange, b.maxRange).length > 0;
  }
  if (kind === 'glare') {
    const g = def.glare;
    return farCandidates(aimablePlayers(ctx, players), mob.pos, g.minRange, g.maxRange).length > 0;
  }
  let near = 0;
  for (const p of players) if (dist2d(p.pos, mob.pos) <= def.burden.range) near++;
  return near >= 2;
}

function tryStart(ctx: SimContext, mob: Entity, def: RangedDef, kind: RangedKind): boolean {
  if (kind === 'boulder') return startBoulder(ctx, mob, def);
  if (kind === 'glare') return startGlare(ctx, mob, def);
  return startBurden(ctx, mob, def);
}

/** He tears up a boulder for each of the farthest players. Their ground marks go down now. */
function startBoulder(ctx: SimContext, mob: Entity, def: RangedDef): boolean {
  const b = def.boulder;
  const victims = farthestCandidates(
    aimablePlayers(ctx, livingPlayers(ctx)),
    mob.pos,
    b.minRange,
    b.maxRange,
    b.count,
  );
  if (victims.length === 0) return false;
  beginBoulder(ctx, mob, def, victims);
  return true;
}

/** The boulder wind-up itself, once the victims are chosen. Draws no rng. */
function beginBoulder(ctx: SimContext, mob: Entity, def: RangedDef, victims: Entity[]): void {
  const b = def.boulder;
  const school = (b.school ?? 'physical') as Aura['school'];
  mob.rangedKind = 'boulder';
  mob.rangedWindup = b.windup;
  mob.rangedAim = [];
  for (const v of victims) mob.rangedAim.push(v.pos.x, v.pos.z);
  claimRangedSpacing(mob, def, b.windup);
  for (const v of victims) {
    ctx.emit({
      type: 'spellfxAt',
      sourceId: mob.id,
      targetId: v.id,
      x: v.pos.x,
      z: v.pos.z,
      school,
      fx: 'runeCircle',
      radius: b.radius,
      duration: b.windup,
      ability: BOULDER_ABILITY,
    });
  }
  emitWindupCue(ctx, mob, school, BOULDER_ABILITY);
}

/** The eye locks on one far player and the line goes down, snapshot, through them. */
function startGlare(ctx: SimContext, mob: Entity, def: RangedDef): boolean {
  const g = def.glare;
  const far = farCandidates(
    aimablePlayers(ctx, livingPlayers(ctx)),
    mob.pos,
    g.minRange,
    g.maxRange,
  );
  if (far.length === 0) return false;
  // Uniform pick among the far players (not always the farthest: that one already has a
  // boulder coming). One rng draw, a pure function of how many stand far out.
  const victim = far[ctx.rng.int(0, far.length - 1)];
  beginGlare(ctx, mob, def, victim);
  return true;
}

/** The glare wind-up at a chosen victim: the line is snapshot through them. No rng. */
function beginGlare(ctx: SimContext, mob: Entity, def: RangedDef, victim: Entity): void {
  const g = def.glare;
  const d = Math.max(0.001, dist2d(victim.pos, mob.pos));
  const dirX = (victim.pos.x - mob.pos.x) / d;
  const dirZ = (victim.pos.z - mob.pos.z) / d;
  const length = glareLineLength(d, g.overshoot, g.minLength, g.maxLength);
  const school = (g.school ?? 'arcane') as Aura['school'];
  mob.rangedKind = 'glare';
  mob.rangedWindup = g.windup;
  mob.rangedAim = [mob.pos.x, mob.pos.z, dirX, dirZ, length];
  // He faces the line he is about to fire down: unlike the random hammer, the glare IS
  // his eye, and an eye beam leaving the side of his head reads as a bug.
  mob.facing = Math.atan2(dirX, dirZ);
  claimRangedSpacing(mob, def, g.windup);
  ctx.emit({
    type: 'spellfxAt',
    sourceId: mob.id,
    targetId: victim.id,
    x: mob.pos.x,
    z: mob.pos.z,
    school,
    fx: 'runeCircle',
    radius: length,
    duration: g.windup,
    ability: GLARE_ABILITY,
    dirX,
    dirZ,
  });
  emitWindupCue(ctx, mob, school, GLARE_ABILITY);
}

/** One player carries the barrow's weight; everyone who stands with them shares it. */
function startBurden(ctx: SimContext, mob: Entity, def: RangedDef): boolean {
  const s = def.burden;
  const inRange = livingPlayers(ctx).filter((p) => dist2d(p.pos, mob.pos) <= s.range);
  // A SHARED soak needs someone to share it with. On a lone player it is not a mechanic,
  // it is an execution with a six-second fuse, so he keeps it for a crowd.
  if (inRange.length < 2) return false;
  // Never the one holding him, unless nobody else is there: a tank who has to walk into
  // the raid to share it drags the boss onto them.
  const others = inRange.filter((p) => p.id !== mob.aggroTargetId);
  const pool = others.length > 0 ? others : inRange;
  const victim = pool[ctx.rng.int(0, pool.length - 1)];
  beginBurden(ctx, mob, def, victim);
  return true;
}

/** Mark the chosen carrier and start the soak's wind-up. Draws no rng. */
function beginBurden(ctx: SimContext, mob: Entity, def: RangedDef, victim: Entity): void {
  const s = def.burden;
  mob.rangedKind = 'burden';
  mob.rangedWindup = s.windup;
  mob.rangedTargetId = victim.id;
  claimRangedSpacing(mob, def, s.windup);
  ctx.applyAura(victim, {
    id: BURDEN_AURA_ID,
    name: s.name,
    kind: 'vulnerability',
    // A breath longer than the wind-up so the mark (and the marker drawn from it) is still
    // on the carrier on the tick it lands; the landing strips it.
    remaining: s.windup + BURDEN_AURA_GRACE,
    duration: s.windup + BURDEN_AURA_GRACE,
    value: 0,
    value2: s.totalFraction,
    stacks: s.recommended,
    sourceId: mob.id,
    school: 'physical',
    encounterOwned: true,
  });
  emitWindupCue(ctx, mob, 'physical', BURDEN_ABILITY);
  if (s.yell) emitMobYell(ctx, mob, s.yell, MOBS[mob.templateId]?.warpath?.yellRange);
}

/**
 * [dev] Start `kind` right now, aimed at `victim`, for the /dev balgath playtest command
 * (dev/balgath_dev_mechanics.ts). It plays the exact telegraph and landing a combat cast
 * does, through the same begin* functions, and skips only the AIM rules: the victim need
 * not stand past the 18-yard minimum, and a burden may mark a lone player (the soak then
 * lands on whoever stands in it, which alone is lethal by design). The spacing lock is
 * overridden once (the begin claims it afresh) and the mechanic's own cadence restarts,
 * so the natural rotation picks up from here unchanged. Refuses (false) while a ranged
 * wind-up is already in flight, which would strand its telegraph. Draws no rng.
 */
export function forceBossRangedMechanic(
  ctx: SimContext,
  mob: Entity,
  kind: RangedKind,
  victim: Entity,
): boolean {
  const def = MOBS[mob.templateId]?.rangedMechanics;
  if (!def || (mob.rangedWindup ?? 0) > 0) return false;
  if (kind === 'boulder') beginBoulder(ctx, mob, def, [victim]);
  else if (kind === 'glare') beginGlare(ctx, mob, def, victim);
  else beginBurden(ctx, mob, def, victim);
  mob[TIMER_FIELD[kind]] = def[kind].every;
  mob.rangedReadyOverdue = undefined;
  return true;
}

/**
 * Hold the shared lock through the wind-up plus the kit's own, shorter gap.
 *
 * Shorter than his slams' 4.5 s on purpose: these land on the far players, so the melee
 * group's breathing room after a slam is not what they eat into, and at the slams' full
 * gap the three of them only ever came up once in a long fight (the lock is his whole
 * capacity for telegraphs). The rule that matters, one wind-up on the ground at a time,
 * holds either way: nothing starts while the lock runs.
 */
function claimRangedSpacing(mob: Entity, def: RangedDef, windup: number): void {
  if ((mob.riftMechanicSpacing ?? 0) <= 0) {
    claimMechanicSpacing(mob, windup);
    return;
  }
  mob.mechanicLockTimer = Math.max(mob.mechanicLockTimer ?? 0, windup + def.spacing);
}

function emitWindupCue(
  ctx: SimContext,
  mob: Entity,
  school: Aura['school'],
  ability: string,
): void {
  ctx.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'windup', ability });
}

function resolveWindup(ctx: SimContext, mob: Entity, def: RangedDef): void {
  if ((mob.rangedWindup ?? 0) <= 0) return;
  mob.rangedWindup = Math.max(0, (mob.rangedWindup ?? 0) - DT);
  if ((mob.rangedWindup ?? 0) > 0) return;
  const kind = mob.rangedKind;
  mob.rangedKind = undefined;
  if (kind === 'boulder') fireBoulders(ctx, mob, def);
  else if (kind === 'glare') fireGlare(ctx, mob, def);
  else if (kind === 'burden') fireBurden(ctx, mob, def);
  mob.rangedAim = undefined;
  mob.rangedTargetId = undefined;
}

/** Each boulder lands where its circle was drawn. Anyone still in it wears it. */
function fireBoulders(ctx: SimContext, mob: Entity, def: RangedDef): void {
  const b = def.boulder;
  const school = (b.school ?? 'physical') as Aura['school'];
  const aim = mob.rangedAim ?? [];
  for (let i = 0; i + 1 < aim.length; i += 2) {
    const center: Vec3 = { x: aim[i], y: mob.pos.y, z: aim[i + 1] };
    ctx.emit({
      type: 'spellfxAt',
      sourceId: mob.id,
      x: center.x,
      z: center.z,
      school,
      fx: 'nova',
      radius: b.radius,
      ability: BOULDER_ABILITY,
      sfxKey: BOULDER_SFX,
    });
    for (const p of livingPlayers(ctx)) {
      if (dist2d(p.pos, center) > b.radius) continue;
      const dmg = Math.round(ctx.rng.range(b.min, b.max) * (mob.mechanicDamageMult ?? 1));
      ctx.dealDamage(
        mob,
        p,
        levelScaledMechanicDamage(mob, p, dmg),
        false,
        school,
        b.name,
        'hit',
        true,
      );
    }
    // A muster soldier caught under it is crushed like under any of his blows.
    splashNearbyMobs(ctx, mob, center, b.radius, b.min, b.max, school, b.name);
    launchFromSlam(ctx, mob, center, b.radius);
  }
}

/**
 * How far down the line the beam travels before something solid stops it.
 *
 * Marched in short segments along the centre line with the sim's own sight test, so the
 * answer is exactly the one a spell's line of sight would give: a low prop the eye line
 * clears does not stop it, a barricade or a palisade does.
 */
export function glareReach(seed: number, line: GlareLine): number {
  let prev = { x: line.originX, z: line.originZ };
  for (let d = GLARE_MARCH_STEP; d <= line.length + 1e-6; d += GLARE_MARCH_STEP) {
    const next = { x: line.originX + line.dirX * d, z: line.originZ + line.dirZ * d };
    if (!lineOfSightClear(seed, prev, next)) return Math.max(0, d - GLARE_MARCH_STEP);
    prev = next;
  }
  return line.length;
}

/** The beam rakes the line. Out of it, or behind something solid, you are untouched. */
function fireGlare(ctx: SimContext, mob: Entity, def: RangedDef): void {
  const g = def.glare;
  const aim = mob.rangedAim;
  if (!aim || aim.length < 5) return;
  const school = (g.school ?? 'arcane') as Aura['school'];
  const line: GlareLine = {
    originX: aim[0],
    originZ: aim[1],
    dirX: aim[2],
    dirZ: aim[3],
    length: aim[4],
    halfWidth: g.halfWidth,
  };
  const seed = ctx.cfg.seed;
  const reach = glareReach(seed, line);
  const origin = { x: line.originX, z: line.originZ };
  ctx.emit({
    type: 'spellfxAt',
    sourceId: mob.id,
    x: line.originX,
    z: line.originZ,
    school,
    fx: 'nova',
    // The distance the beam actually travelled, so the renderer stops it on the cover.
    radius: reach,
    ability: GLARE_ABILITY,
    dirX: line.dirX,
    dirZ: line.dirZ,
    sfxKey: GLARE_SFX,
  });
  // Struck means inside the rectangle, no farther down it than the beam visibly travelled,
  // AND with a clear sight line from where the eye stood: past the cover the beam is drawn
  // stopping on, nobody is hit, and a barricade that shelters half the width shelters the
  // half behind it.
  const struck = (pos: { x: number; z: number }): boolean =>
    insideGlare(line, pos.x, pos.z, reach) && lineOfSightClear(seed, origin, pos);
  for (const p of livingPlayers(ctx)) {
    if (!struck(p.pos)) continue;
    const dmg = Math.round(ctx.rng.range(g.min, g.max) * (mob.mechanicDamageMult ?? 1));
    ctx.dealDamage(
      mob,
      p,
      levelScaledMechanicDamage(mob, p, dmg),
      false,
      school,
      g.name,
      'hit',
      true,
    );
  }
  // No collateral: the eye burns what it LOOKS at, and it only ever looks at a player.
  // A beam that razed whichever picket its line happened to cross would skip that stop
  // of his circuit (mob/warpath.ts warpathStopRazed) and cost the raid the wreck it came
  // to see; tests/muster_wreck_every_stop.test.ts pins every stop a wreck with kills.
}

/** The weight comes down on the marked player; everyone inside shares it equally. */
function fireBurden(ctx: SimContext, mob: Entity, def: RangedDef): void {
  const s = def.burden;
  const target =
    mob.rangedTargetId === undefined ? undefined : ctx.entities.get(mob.rangedTargetId);
  if (!target) return;
  // The mark IS the warning. If it is gone (it ran out while he was held off his engaged
  // tick, or anything ever strips it), the raid was shown nothing, so nothing lands.
  const marked = target.auras.some((a) => a.id === BURDEN_AURA_ID && a.sourceId === mob.id);
  target.auras = target.auras.filter((a) => a.id !== BURDEN_AURA_ID || a.sourceId !== mob.id);
  if (!marked) return;
  const center = { x: target.pos.x, z: target.pos.z };
  const soakers = playersInsideSoak(livingPlayers(ctx), center, s.radius);
  ctx.emit({
    type: 'spellfxAt',
    sourceId: mob.id,
    targetId: target.id,
    x: center.x,
    z: center.z,
    school: 'physical',
    fx: 'nova',
    radius: s.radius,
    ability: BURDEN_ABILITY,
    sfxKey: BURDEN_SFX,
  });
  if (soakers.length === 0) return;
  const fraction = sharedSoakFraction(s.totalFraction, soakers.length);
  for (const p of soakers) {
    ctx.dealDamage(
      mob,
      p,
      Math.ceil(p.maxHp * fraction),
      false,
      'physical',
      s.name,
      'hit',
      true,
      undefined,
      false,
      false,
      true,
    );
  }
}

/**
 * Drop any half-wound mechanic with the pull, and lift the burden mark off whoever was
 * carrying it, so a fresh engage never inherits a telegraph that will never land.
 */
export function resetBossRangedMechanics(ctx: SimContext, mob: Entity): void {
  const def = MOBS[mob.templateId]?.rangedMechanics;
  if (mob.rangedTargetId !== undefined) {
    const carrier = ctx.entities.get(mob.rangedTargetId);
    if (carrier) {
      carrier.auras = carrier.auras.filter((a) => a.id !== BURDEN_AURA_ID || a.sourceId !== mob.id);
    }
    mob.rangedTargetId = undefined;
  }
  if (mob.rangedWindup !== undefined) mob.rangedWindup = 0;
  if (mob.rangedKind !== undefined) mob.rangedKind = undefined;
  if (mob.rangedAim !== undefined) mob.rangedAim = undefined;
  if (mob.rangedReadyOverdue !== undefined) mob.rangedReadyOverdue = undefined;
  if (!def) return;
  mob.boulderTimer = def.boulder.every;
  mob.glareTimer = def.glare.every;
  mob.burdenTimer = def.burden.every;
}
