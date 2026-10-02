// Wake of the Fallen Star: Balgath wakes the star that woke him.
//
// It replaces the Barrowglass Scry, which was a cast bar and a 30-yard nova with nothing on
// the ground to read. This one is a whole sequence, and every hazard in it is shown before
// it hurts:
//
//   WARN     He drives both fists into the fen (the cast bar, `warn` seconds) and yells;
//            the fallen star in his crater lights up and pulses, which the whole fight can
//            see even from a far picket, over a ground rumble.
//   CRAWL    When the bar ends the FISSURES are laid: glowing strips crawl from their
//            origin to their tips over `crawl` seconds (the telegraph fills as it goes),
//            with a geyser circle part-way down each and under up to `targets` players.
//   HOLD     The full telegraph sits on the ground for `hold` seconds.
//   ERUPT    Lava bursts up every fissure strip and every geyser circle at once. Anyone
//            inside takes the hit; muster soldiers and wildlife inside, in the fight round
//            him (STARWAKE_COLLATERAL_REACH), die or burn as under his other blows
//            (boss_collateral.ts).
//   POOLS    Every geyser leaves a molten pool of its own radius for `pool.seconds`,
//            burning whoever stands in it once a `pool.interval`, so the raid has to find
//            new ground for a while.
//   METEORS  The eruption also opens the sky: a shower of Star Debris, waves of
//            Ignivar's Falling Cinders meteors (his pattern, red circles and fall) for
//            `meteors.seconds` round the players, the star and the cracks
//            (mob/boss_starwake_meteors.ts). Like the pools it is aftermath: it runs on
//            after the spacing lock, wherever he walks.
//
// Where the fissures run (boss_starwake_geometry.ts `starwakeMode`): FROM THE STAR in a fan
// toward him when he fights within reach of his crater, and from UNDER HIS FEET in an even
// ring when he has marched to a far picket, where a fan from the crater would be a hundred
// yards of strip that mostly crosses empty fen. Either way there are guaranteed SAFE LANES
// between the fissures (the geometry module proves the gap and the tests pin it), and the
// pools never cover more than a fraction of the ground round him.
//
// Spacing: the cast claims the shared mechanic spacing lock for its whole run plus
// `spacing` (mob/mechanic_spacing.ts), so no other telegraph starts while its marks are on
// the ground. Like his aimed slams it sits OUTSIDE the oldest-due comparison: it holds at
// due while the focus phase of his warpath cannot fit the whole sequence (it never starts
// a cast he would march away from mid-telegraph), and a held-due entry in that drain would
// starve his circle smashes for the rest of the phase. It runs before the ranged kit and
// the smashes each tick, so the moment the lock clears it goes first and cannot starve.
//
// Rng: one draw for the pattern's rotation, one per fissure for its wobble, one per
// targeted geyser pick, then one per player struck (in `ctx.players` order) and per pool
// tick per player burned; the meteors place without rng (hash2 on the shower's key) and
// draw one per player each landing strikes. Inert (no draws, no fields) for every mob without `starwake`.

import {
  fissureGeyserCenters,
  insideCircle,
  insideFissure,
  type StarwakeCircle,
  type StarwakeFissure,
  type StarwakeLayoutDef,
  starwakeFissureCount,
  starwakeLayout,
  starwakeMode,
} from '../boss_starwake_geometry';
import { MOBS } from '../data';
import type { SimContext } from '../sim_context';
import type { Aura, Entity, MobTemplate } from '../types';
import { CAST_COMPLETE_EPS, DT, dist2d } from '../types';
import { splashNearbyMobs } from './boss_collateral';
import { rangedMechanicBlocked } from './boss_ranged_mechanics';
import {
  resetStarwakeShower,
  startStarwakeShower,
  starwakeShowerActive,
  tickStarwakeShower,
} from './boss_starwake_meteors';
import { levelScaledMechanicDamage } from './mechanic_level_scale';
import { claimMechanicSpacing } from './mechanic_spacing';
import { emitMobYell } from './yells';

type StarwakeDef = NonNullable<MobTemplate['starwake']>;

/** Render cue ids (the `ability` on every event this module emits). */
export const STARWAKE_WAKE_ABILITY = 'mob_balgath_starwake_wake';
export const STARWAKE_FISSURE_ABILITY = 'mob_balgath_starwake_fissure';
export const STARWAKE_GEYSER_ABILITY = 'mob_balgath_starwake_geyser';

/** Fixed SFX recordings, all already in the manifest (no new audio asset). */
export const STARWAKE_WAKE_SFX = 'melee_warrior_quake_release';
export const STARWAKE_CRAWL_SFX = 'rift_boulder_roll';
export const STARWAKE_ERUPT_SFX = 'meteor';
export const STARWAKE_GEYSER_SFX = 'impact_fire';

/**
 * How far from him the eruptions and pools crush muster soldiers and burn wildlife, yards.
 *
 * The fight round him, not the whole fan: a fissure runs up to seventy yards from the
 * star, and one that razed whichever picket it happened to cross would make his circuit
 * skip that stop (mob/warpath.ts warpathStopRazed), costing the raid the wreck it came to
 * see (the glare's precedent; tests/muster_wreck_every_stop.test.ts pins every stop a wreck
 * with kills). Past the picket he stands on (its inner ring and sentries sit well inside
 * this), the next picket of the circuit is always farther out.
 */
export const STARWAKE_COLLATERAL_REACH = 25;

/** Seconds of margin a focus phase must still hold past the eruption for a cast to start. */
export const STARWAKE_FOCUS_MARGIN = 1;

/** Stride of one fissure in `starwakeFissures`, one geyser in `starwakeGeysers`, one pool. */
const FISSURE_STRIDE = 5;
const GEYSER_STRIDE = 3;
const POOL_STRIDE = 5;

/** The whole wind-up: from the fists hitting the ground to the eruption. */
export function starwakeTotal(def: StarwakeDef): number {
  return def.warn + def.crawl + def.hold;
}

/** The geometry module's view of the template. */
export function starwakeLayoutDef(def: StarwakeDef): StarwakeLayoutDef {
  const f = def.fissures;
  return {
    star: def.star,
    starMinReach: def.starMinReach,
    starMaxReach: def.starMaxReach,
    fanCount: f.fanCount,
    fanDeg: f.fanDeg,
    reachPast: f.reachPast,
    minLength: f.minLength,
    maxLength: f.maxLength,
    ringCount: f.ringCount,
    ringLength: f.ringLength,
    jitterDeg: f.jitterDeg,
  };
}

/** Whether a cast is in flight (from the fists to the eruption; the pools outlive it). */
export function starwakeActive(mob: Entity): boolean {
  return mob.starwakeElapsed !== undefined;
}

/** The laid fissures, decoded. Empty before the telegraph goes down. */
export function starwakeFissuresOf(mob: Entity): StarwakeFissure[] {
  const flat = mob.starwakeFissures ?? [];
  const out: StarwakeFissure[] = [];
  for (let i = 0; i + FISSURE_STRIDE - 1 < flat.length; i += FISSURE_STRIDE) {
    out.push({
      originX: flat[i],
      originZ: flat[i + 1],
      dirX: flat[i + 2],
      dirZ: flat[i + 3],
      length: flat[i + 4],
    });
  }
  return out;
}

/** The laid geyser circles, decoded (each fissure's own first, then the targeted ones). */
export function starwakeGeysersOf(mob: Entity): StarwakeCircle[] {
  const flat = mob.starwakeGeysers ?? [];
  const out: StarwakeCircle[] = [];
  for (let i = 0; i + GEYSER_STRIDE - 1 < flat.length; i += GEYSER_STRIDE) {
    out.push({ x: flat[i], z: flat[i + 1], radius: flat[i + 2] });
  }
  return out;
}

/** The live molten pools, decoded, with their seconds left. */
export function starwakePoolsOf(mob: Entity): (StarwakeCircle & { remaining: number })[] {
  const flat = mob.starwakePools ?? [];
  const out: (StarwakeCircle & { remaining: number })[] = [];
  for (let i = 0; i + POOL_STRIDE - 1 < flat.length; i += POOL_STRIDE) {
    out.push({ x: flat[i], z: flat[i + 1], radius: flat[i + 2], remaining: flat[i + 3] });
  }
  return out;
}

function livingPlayers(ctx: SimContext): Entity[] {
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (p && !p.dead) out.push(p);
  }
  return out;
}

/**
 * Advance the sequence for one engaged tick: burn the pools, move a cast in flight along,
 * then consider starting one. Runs from the engaged pulse (mob/locomotion.ts), so a cast
 * already on the ground resolves in every warpath phase, wherever he has walked since.
 */
export function tickBossStarwake(ctx: SimContext, mob: Entity): void {
  const def = MOBS[mob.templateId]?.starwake;
  // A felled Foreman lands nothing more: no eruption and no burning (the respawn reset
  // clears what he left).
  if (!def || mob.dead) return;
  tickPools(ctx, mob, def);
  // Before the cast advances, so the shower an eruption opens this tick waits a full tick
  // before its first meteors start counting down.
  tickStarwakeShower(ctx, mob, def, STARWAKE_COLLATERAL_REACH);
  if (starwakeActive(mob)) {
    advance(ctx, mob, def);
    return;
  }
  if (mob.aiState !== 'attack') return;
  if (mob.warpathPhase !== undefined && mob.warpathPhase !== 'focus') return;
  const target = mob.aggroTargetId !== null ? ctx.entities.get(mob.aggroTargetId) : null;
  if (!target || target.dead) return;
  mob.starwakeTimer = (mob.starwakeTimer ?? def.every) - DT;
  if ((mob.starwakeTimer ?? 0) > 0) return;
  // Held at due (the timer keeps drifting negative) until everything below clears.
  if (!focusCanHold(mob, def)) return;
  if (rangedMechanicBlocked(mob)) return;
  // Never a second star while the last one's shower is still coming down.
  if (starwakeShowerActive(mob)) return;
  beginStarwake(ctx, mob, def);
}

/**
 * Whether his warpath's focus phase still has room for the whole sequence. A cast begun
 * with less would see him set off for the next picket mid-telegraph and land his arrival
 * slam's ring on top of it.
 */
export function focusCanHold(mob: Entity, def: StarwakeDef): boolean {
  if (mob.warpathPhase !== 'focus') return true;
  return (mob.warpathTimer ?? 0) >= starwakeTotal(def) + STARWAKE_FOCUS_MARGIN;
}

/** The fists go in, the star wakes, the bar starts. Draws no rng. */
function beginStarwake(ctx: SimContext, mob: Entity, def: StarwakeDef): void {
  const total = starwakeTotal(def);
  mob.starwakeTimer = def.every;
  mob.starwakeElapsed = 0;
  mob.starwakeFissures = undefined;
  mob.starwakeGeysers = undefined;
  claimStarwakeSpacing(mob, def, total);
  // The cast bar IS the warning's timer. It carries the mechanic's own name (the Varkhul
  // Forgestorm precedent), which the client localizes through the sim mechanic matcher.
  mob.castingAbility = def.name;
  mob.castTotal = def.warn;
  mob.castRemaining = def.warn;
  mob.castTargetId = null;
  mob.channeling = false;
  // The star lights up for the whole wind-up. Anchored AT the star, with the boss as its
  // source, so the renderer can draw the fire running from one to the other in feet mode.
  ctx.emit({
    type: 'spellfxAt',
    sourceId: mob.id,
    x: def.star.x,
    z: def.star.z,
    school: def.school,
    fx: 'burst',
    radius: def.starMinReach,
    duration: total,
    ability: STARWAKE_WAKE_ABILITY,
    sfxKey: STARWAKE_WAKE_SFX,
  });
  if (def.yell) emitMobYell(ctx, mob, def.yell, MOBS[mob.templateId]?.warpath?.yellRange);
}

/**
 * Hold the shared lock through the whole wind-up plus the kit's own gap. The lock ticks
 * only on his melee-contact ticks while this sequence runs on every engaged tick, so the
 * lock always outlasts it: nothing else can start while its marks are on the ground.
 */
function claimStarwakeSpacing(mob: Entity, def: StarwakeDef, total: number): void {
  if ((mob.riftMechanicSpacing ?? 0) <= 0) {
    claimMechanicSpacing(mob, total);
    return;
  }
  mob.mechanicLockTimer = Math.max(mob.mechanicLockTimer ?? 0, total + def.spacing);
}

function advance(ctx: SimContext, mob: Entity, def: StarwakeDef): void {
  const elapsed = (mob.starwakeElapsed ?? 0) + DT;
  mob.starwakeElapsed = elapsed;
  const bar = mob.castingAbility === def.name;
  // The bar runs on this module's clock, not the generic pushback path: a raid hitting
  // him cannot delay a star waking, so the timer they read is the one that lands.
  if (bar) mob.castRemaining = Math.max(0, def.warn - elapsed);
  if (mob.starwakeFissures === undefined && elapsed >= def.warn - CAST_COMPLETE_EPS) {
    if (bar) endBar(mob);
    layTelegraphs(ctx, mob, def);
  }
  if (elapsed >= starwakeTotal(def) - CAST_COMPLETE_EPS) erupt(ctx, mob, def);
}

function endBar(mob: Entity): void {
  mob.castingAbility = null;
  mob.castTotal = 0;
  mob.castRemaining = 0;
  mob.castTargetId = null;
}

/**
 * Lay the fissures and geyser circles on the ground, snapshot. The rotation, the wobbles
 * and the targeted players are drawn here, in that order.
 */
function layTelegraphs(ctx: SimContext, mob: Entity, def: StarwakeDef): void {
  const layoutDef = starwakeLayoutDef(def);
  const boss = { x: mob.pos.x, z: mob.pos.z };
  const mode = starwakeMode(layoutDef, boss);
  const turn = ctx.rng.next();
  const jitter: number[] = [];
  for (let i = 0; i < starwakeFissureCount(layoutDef, mode); i++) {
    jitter.push(ctx.rng.range(-1, 1));
  }
  const layout = starwakeLayout(layoutDef, boss, turn, jitter);
  const g = def.geysers;
  const circles: { c: StarwakeCircle; targetId?: number }[] = fissureGeyserCenters(
    layout.fissures,
    g.alongFraction,
  ).map((p) => ({ c: { x: p.x, z: p.z, radius: g.fissureRadius } }));
  for (const victim of pickGeyserTargets(ctx, mob, def)) {
    circles.push({
      c: { x: victim.pos.x, z: victim.pos.z, radius: g.radius },
      targetId: victim.id,
    });
  }
  mob.starwakeFissures = [];
  for (const f of layout.fissures) {
    mob.starwakeFissures.push(f.originX, f.originZ, f.dirX, f.dirZ, f.length);
  }
  mob.starwakeGeysers = [];
  for (const { c } of circles) mob.starwakeGeysers.push(c.x, c.z, c.radius);
  // The telegraph runs from now to the eruption: the crawl, then the hold.
  const seconds = def.crawl + def.hold;
  const school = def.school as Aura['school'];
  layout.fissures.forEach((f, i) => {
    ctx.emit({
      type: 'spellfxAt',
      sourceId: mob.id,
      x: f.originX,
      z: f.originZ,
      school,
      fx: 'runeCircle',
      radius: f.length,
      duration: seconds,
      ability: STARWAKE_FISSURE_ABILITY,
      dirX: f.dirX,
      dirZ: f.dirZ,
      // One rumble for the whole pattern, not one per strip.
      ...(i === 0 ? { sfxKey: STARWAKE_CRAWL_SFX } : {}),
    });
  });
  for (const { c, targetId } of circles) {
    ctx.emit({
      type: 'spellfxAt',
      sourceId: mob.id,
      ...(targetId !== undefined ? { targetId } : {}),
      x: c.x,
      z: c.z,
      school,
      fx: 'runeCircle',
      radius: c.radius,
      duration: seconds,
      ability: STARWAKE_GEYSER_ABILITY,
    });
  }
}

/**
 * Up to `targets` players within `range` of him, drawn uniformly without replacement
 * (a partial Fisher-Yates over the candidates in entity-id order, one draw per pick), so
 * the draw count is a pure function of how many stand in range.
 */
function pickGeyserTargets(ctx: SimContext, mob: Entity, def: StarwakeDef): Entity[] {
  const pool = livingPlayers(ctx)
    .filter((p) => dist2d(p.pos, mob.pos) <= def.geysers.range)
    .sort((a, b) => a.id - b.id);
  const picks = Math.min(def.geysers.targets, pool.length);
  for (let k = 0; k < picks; k++) {
    const j = ctx.rng.int(k, pool.length - 1);
    const tmp = pool[k];
    pool[k] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, picks);
}

/** Whether a bystander stands in the fight round him (STARWAKE_COLLATERAL_REACH). */
function nearFight(mob: Entity, e: Entity): boolean {
  return dist2d(mob.pos, e.pos) <= STARWAKE_COLLATERAL_REACH;
}

/** Every strip and circle bursts at once; the geysers leave their pools. */
function erupt(ctx: SimContext, mob: Entity, def: StarwakeDef): void {
  const fissures = starwakeFissuresOf(mob);
  const geysers = starwakeGeysersOf(mob);
  const school = def.school as Aura['school'];
  const f = def.fissures;
  const g = def.geysers;
  const mult = mob.mechanicDamageMult ?? 1;
  fissures.forEach((line, i) => {
    ctx.emit({
      type: 'spellfxAt',
      sourceId: mob.id,
      x: line.originX,
      z: line.originZ,
      school,
      fx: 'nova',
      radius: line.length,
      ability: STARWAKE_FISSURE_ABILITY,
      dirX: line.dirX,
      dirZ: line.dirZ,
      ...(i === 0 ? { sfxKey: STARWAKE_ERUPT_SFX } : {}),
    });
  });
  // One fissure hit per player however many strips they stand in (they cross only at the
  // origin, and a player there is standing in one eruption, not five).
  const players = livingPlayers(ctx);
  for (const p of players) {
    if (!fissures.some((line) => insideFissure(line, f.halfWidth, p.pos.x, p.pos.z))) continue;
    const dmg = Math.round(ctx.rng.range(f.min, f.max) * mult);
    ctx.dealDamage(
      mob,
      p,
      levelScaledMechanicDamage(mob, p, dmg),
      false,
      school,
      def.name,
      'hit',
      true,
    );
  }
  for (const line of fissures) {
    const half = line.length / 2;
    const mid = { x: line.originX + line.dirX * half, z: line.originZ + line.dirZ * half };
    splashNearbyMobs(
      ctx,
      mob,
      mid,
      half + f.halfWidth,
      f.min,
      f.max,
      school,
      def.name,
      (e) => insideFissure(line, f.halfWidth, e.pos.x, e.pos.z) && nearFight(mob, e),
    );
  }
  const pools: number[] = mob.starwakePools ?? [];
  geysers.forEach((c, i) => {
    ctx.emit({
      type: 'spellfxAt',
      sourceId: mob.id,
      x: c.x,
      z: c.z,
      school,
      fx: 'nova',
      radius: c.radius,
      // The pool this geyser leaves, so the renderer draws it for exactly as long.
      duration: def.pool.seconds,
      ability: STARWAKE_GEYSER_ABILITY,
      ...(i === 0 ? { sfxKey: STARWAKE_GEYSER_SFX } : {}),
    });
    for (const p of players) {
      // The list is taken once; skip anyone an earlier blast of this eruption just killed.
      if (p.dead || !insideCircle(c, p.pos.x, p.pos.z)) continue;
      const dmg = Math.round(ctx.rng.range(g.min, g.max) * mult);
      ctx.dealDamage(
        mob,
        p,
        levelScaledMechanicDamage(mob, p, dmg),
        false,
        school,
        def.name,
        'hit',
        true,
      );
    }
    splashNearbyMobs(ctx, mob, c, c.radius, g.min, g.max, school, def.name, (e) =>
      nearFight(mob, e),
    );
    pools.push(c.x, c.z, c.radius, def.pool.seconds, def.pool.interval);
  });
  mob.starwakePools = pools;
  startStarwakeShower(ctx, mob, def, fissures);
  if (mob.castingAbility === def.name) endBar(mob);
  mob.starwakeElapsed = undefined;
  mob.starwakeFissures = undefined;
  mob.starwakeGeysers = undefined;
}

/**
 * Burn whoever stands in a pool, once per `pool.interval` (the first a full interval after
 * the eruption, the last on the tick the pool runs out), and drop the pools that have.
 */
function tickPools(ctx: SimContext, mob: Entity, def: StarwakeDef): void {
  const flat = mob.starwakePools;
  if (!flat || flat.length === 0) return;
  const school = def.school as Aura['school'];
  const mult = mob.mechanicDamageMult ?? 1;
  const kept: number[] = [];
  for (let i = 0; i + POOL_STRIDE - 1 < flat.length; i += POOL_STRIDE) {
    const pool: StarwakeCircle = { x: flat[i], z: flat[i + 1], radius: flat[i + 2] };
    const remaining = flat[i + 3] - DT;
    let tickTimer = flat[i + 4] - DT;
    if (tickTimer <= CAST_COMPLETE_EPS) {
      tickTimer += def.pool.interval;
      for (const p of livingPlayers(ctx)) {
        if (!insideCircle(pool, p.pos.x, p.pos.z)) continue;
        const dmg = Math.round(ctx.rng.range(def.pool.min, def.pool.max) * mult);
        ctx.dealDamage(
          mob,
          p,
          levelScaledMechanicDamage(mob, p, dmg),
          false,
          school,
          def.pool.name,
          'hit',
          true,
        );
      }
      splashNearbyMobs(
        ctx,
        mob,
        pool,
        pool.radius,
        def.pool.min,
        def.pool.max,
        school,
        def.pool.name,
        (e) => nearFight(mob, e),
      );
    }
    if (remaining > CAST_COMPLETE_EPS) kept.push(pool.x, pool.z, pool.radius, remaining, tickTimer);
  }
  mob.starwakePools = kept;
}

/**
 * [dev] Start the sequence right now, for the /dev balgath playtest command
 * (dev/balgath_dev_mechanics.ts): the same start a combat cast runs, skipping only the
 * cadence and the focus-phase fit, with the cadence restarted so the rotation resumes from
 * here. Refuses (false) while one is already in flight or its meteor shower is still
 * falling. Draws no rng.
 */
export function forceBossStarwake(ctx: SimContext, mob: Entity): boolean {
  const def = MOBS[mob.templateId]?.starwake;
  if (!def || starwakeActive(mob) || starwakeShowerActive(mob)) return false;
  beginStarwake(ctx, mob, def);
  return true;
}

/**
 * Drop a half-wound cast (and its bar) and every pool with the pull, so a fresh engage
 * never inherits a telegraph that will never land or a pool nobody is being burned by.
 * Touches only a mob whose template declares the mechanic.
 */
export function resetBossStarwake(mob: Entity): void {
  const def = MOBS[mob.templateId]?.starwake;
  if (!def) return;
  if (mob.castingAbility === def.name) endBar(mob);
  mob.starwakeElapsed = undefined;
  mob.starwakeFissures = undefined;
  mob.starwakeGeysers = undefined;
  mob.starwakePools = undefined;
  resetStarwakeShower(mob);
  mob.starwakeTimer = def.every;
}
