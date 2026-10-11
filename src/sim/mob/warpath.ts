// Warpath: a boss who has somewhere to be, instead of standing in your melee range.
//
// The problem this solves is a shape, not a number. A boss that chases whoever holds
// threat and stops at swing range is, from the raid's side, a stationary damage sponge:
// it shuffles after the tank and nothing else ever happens. Adding health or damage does
// not fix that, it makes it longer. So this boss walks a circuit of authored landmarks
// and cycles three phases:
//
//   FOCUS   He plants and fights whoever has threat: ordinary combat, which is why this
//           phase deliberately does NOT own the tick (see the 'fallthrough' result). It
//           is the only phase he is stationary in, so it is the melee uptime window and
//           the window his telegraphed slams fire in.
//   TRAVEL  He picks the next landmark and RUNS there, ignoring threat entirely. The raid
//           has to follow. Two things make the chase a fight rather than a walk:
//             - he backhands somebody standing near him on a timer, so escorting him is
//               a positioning problem rather than an autorun, and
//             - he REGENERATES whenever nobody has hurt him for a few seconds, so a raid
//               that breaks off to run undoes the phase it just spent. Ranged and casters
//               carry this window, which is the point: they are the ones who can hurt him
//               while moving.
//   WRECK   He arrives, raises both fists over the landmark, and brings them down: a
//           telegraphed ring on the same `runeCircle` machinery his other slams use, so
//           the counterplay is the one the fight already taught. Then back to FOCUS.
//
// The net effect is an encounter that crosses the zone under its own steam and reads as
// something happening TO the world, rather than a health bar parked in a field.
//
// Declared per template (`MobTemplate.warpath`) and inert for every mob without one, so
// nothing else in the world changes shape and the golden parity trace is untouched. The
// phase machine is a pure function (`nextWarpathPhase`) so its transitions can be tested
// without a Sim; the tick below is the thin part that moves the body and spends damage.
import { DUNGEON_X_THRESHOLD, MOBS } from '../data';
import { musterPicketRazed } from '../muster_picket_razed';
import type { SimContext } from '../sim_context';
import type { Aura, Entity, MobTemplate, Vec3 } from '../types';
import { angleTo, DT, DUNGEON_LEASH_DISTANCE, dist2d, LEASH_DISTANCE } from '../types';
import { splashNearbyMobs } from './boss_collateral';
import { launchFromSlam } from './boss_slams';
import { startEvadeHome } from './combat_profile';
import { levelScaledMechanicDamage } from './mechanic_level_scale';
import { highestThreatTarget } from './targeting';
import { traceWarpath } from './warpath_dev_trace';
import { emitMobYell } from './yells';

type WarpathDef = NonNullable<MobTemplate['warpath']>;

/** What a warpath tick left for the caller that owns the rest of the engaged tick. */
export type WarpathTickResult =
  /** The warpath owned this tick: it moved the body and spent its own mechanics. */
  | 'handled'
  /** He gave the pull up this tick and is walking home (warpathGiveUp): nothing else runs. */
  | 'evaded'
  /** Not a warpather, no live target, or FOCUS: the ordinary combat runner takes it. */
  | 'fallthrough';

/** Why a warpather drops his pull and walks home to his bed. */
export type WarpathGiveUp =
  /** He is past the hard tether: however he got there, he goes home. */
  | 'tether'
  /** No living player is anywhere near him: the raid left, died, or released. */
  | 'alone'
  /** Nobody has hurt him for the whole window: a pull nobody is fighting. */
  | 'unharried';

/**
 * A FOCUS fight this close to the hard tether marches on to his next stop instead (see
 * focusDraggedToLeash), so a raid actively fighting him at his outermost picket moves the
 * fight along the circuit rather than resetting it on the tether.
 */
export const WARPATH_TETHER_MARCH_MARGIN = 5;

/**
 * Whether the pull is over, as a pure function of where he stands and who is on him.
 *
 * The rules are the owner's: he is never kitable out of his area, and never stays engaged
 * with nobody fighting him. The tether is absolute (every phase, every cause); the other two
 * are the "nobody is fighting" pair. The unharried clock is the one his Barrowmend regen
 * already reads (any lost health resets it), so a raid that keeps hitting him while it
 * chases never trips it, and the regen's own three-second rule is untouched.
 */
export function warpathGiveUp(
  distFromBed: number,
  aloneSeconds: number,
  unharriedSeconds: number,
  def: WarpathDef,
): WarpathGiveUp | null {
  if (distFromBed > def.giveUp.tetherRadius) return 'tether';
  if (aloneSeconds >= def.giveUp.aloneGraceSeconds) return 'alone';
  if (unharriedSeconds >= def.giveUp.unharriedSeconds) return 'unharried';
  return null;
}

/** A living, non-ghost player within `range` of him. */
function livingPlayerWithin(ctx: SimContext, mob: Entity, range: number): boolean {
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p || p.dead || p.ghost) continue;
    if (dist2d(p.pos, mob.pos) <= range) return true;
  }
  return false;
}

export type WarpathPhase = 'focus' | 'travel' | 'wreck';

/** How long the arrival ring is shown before the fists land. */
export const WARPATH_WRECK_FUSE_SEC = 1.4;

/**
 * The phase machine, as a pure function of the phase timer and the distance left to run.
 *
 * Split out from the tick deliberately: a phase machine tangled into a mutation loop
 * looks correct at a glance and is wrong only on a transition nobody happened to
 * reproduce, which is the failure this is cheap insurance against.
 */
export function nextWarpathPhase(
  phase: WarpathPhase,
  timer: number,
  distToDestination: number,
  def: WarpathDef,
  /** FOCUS has been dragged to the edge of his tether (focusDraggedToLeash below): he
   *  marches on to his next stop rather than evading out of the fight. */
  draggedToLeash = false,
): WarpathPhase {
  if (phase === 'focus') return timer <= 0 || draggedToLeash ? 'travel' : 'focus';
  if (phase === 'travel') {
    if (distToDestination <= def.arriveRadius) return 'wreck';
    // The patience cap. Without it a landmark he cannot quite reach (a body wedged on
    // geometry, a destination authored inside a rock) leaves him travelling forever,
    // healing every time the raid loses him: a soft-lock wearing a mechanic's clothes.
    return timer <= 0 ? 'wreck' : 'travel';
  }
  return timer <= 0 ? 'focus' : 'wreck';
}

/** Seconds a phase runs for once entered. For TRAVEL this is only the floor: beginPhase
 *  sizes each leg's patience from its length (warpathTravelPatience). */
export function warpathPhaseDuration(phase: WarpathPhase, def: WarpathDef): number {
  if (phase === 'focus') return def.focusSeconds;
  if (phase === 'travel') return def.travelTimeoutSeconds;
  return def.wreckSeconds;
}

/**
 * The next stop on the circuit: the following entry, wrapping.
 *
 * A circuit rather than a random or furthest-first pick, and the choice is load-bearing.
 * Random draws a neighbouring landmark as often as a distant one, and a three-second trip
 * is not a chase. Furthest-first looks better and is worse: with four landmarks it
 * ping-pongs between the two extremes forever and the ones in the middle, the town
 * included, are never visited at all. Walking the list in order visits every authored
 * stop, lets the pacing be designed rather than emerge, is learnable by a raid on the
 * second lap, and draws no rng, so it cannot move the shared stream.
 */
export function nextWarpathDestination(
  current: number,
  count: number,
  /** A stop to pass over (a razed picket: warpathStopRazed). Omitted, none is. */
  skip?: (index: number) => boolean,
): number | null {
  if (count <= 0) return 0;
  for (let step = 1; step <= count; step++) {
    const i = (((current + step) % count) + count) % count;
    if (!skip?.(i)) return i;
  }
  // Every stop is razed: there is nowhere left worth marching on.
  return null;
}

/**
 * Whether a stop is a RAZED muster picket: every soldier posted inside the reach of the
 * arrival slam that would land there is already down (muster_picket_razed.ts).
 *
 * His ordinary slams crush muster soldiers too (mob/boss_collateral.ts), so a fight that
 * opens beside a picket can flatten its squad long before the circuit reaches it. Marching
 * on it anyway was the owner's "he ran there and did nothing": the arrival wreck landed on
 * corpses. So the circuit passes a razed picket over and goes to the next one that still
 * has soldiers standing. A stop nobody is posted at is never razed, so a warpather with no
 * muster walks his list exactly as authored.
 */
export function warpathStopRazed(ctx: SimContext, def: WarpathDef, index: number): boolean {
  const stop = def.destinations[index];
  if (!stop) return false;
  return musterPicketRazed(ctx, ctx.musterArmy, stop.x, stop.z, def.wreck.radius);
}

/**
 * Seconds of patience for one leg: the authored cap, or twice the leg at his travel speed,
 * whichever is longer.
 *
 * The flat cap alone fired the "gave up, wreck where you stand" arm on a legitimate leg: a
 * focus fight dragged to the far side of the command camp starts a leg that has to walk
 * round the camp's keep-out circle (mob/keep_out.ts) and needs more than 25 seconds, so he
 * slammed an empty patch of fen short of the picket. Twice the straight line covers any
 * rim detour; a body truly wedged still gives up, only later.
 */
export function warpathTravelPatience(def: WarpathDef, legYards: number, speed: number): number {
  const walk = speed > 0 ? (2 * legYards) / speed : 0;
  return Math.max(def.travelTimeoutSeconds, walk);
}

function destinationPos(def: WarpathDef, index: number): Vec3 {
  const d = def.destinations[index] ?? def.destinations[0];
  return { x: d.x, y: 0, z: d.z };
}

/**
 * Leave FOCUS for the next stop that still has a squad standing, or stay in FOCUS when
 * every picket is razed. Returns the phase he is now in.
 *
 * The all-razed fallback is to keep fighting the raid where it stands (the focus clock
 * simply starts over): there is nothing left to march on, and a march onto corpses is the
 * exact thing this exists to stop. The one exception is a focus fight dragged to the edge
 * of his leash or tether (focusDraggedToLeash), where holding would hand the pull to an
 * evade: then he regroups onto the next stop of his circuit anyway, which is what keeps a
 * kiter from dragging him off his fen.
 */
function leaveFocus(ctx: SimContext, mob: Entity, def: WarpathDef, dragged: boolean): WarpathPhase {
  const from = mob.warpathDestination ?? -1;
  const count = def.destinations.length;
  const pick = nextWarpathDestination(from, count, (i) => warpathStopRazed(ctx, def, i));
  if (pick === null && !dragged) {
    mob.warpathTimer = def.focusSeconds;
    traceWarpath(ctx, mob, () => 'every picket is razed, holding focus on the raid.');
    return 'focus';
  }
  const dest = pick ?? (nextWarpathDestination(from, count) as number);
  // Name every picket he passed over, so a skipped stop is never a mystery.
  for (let step = 1; ctx.devCommands && step < count; step++) {
    const i = (((from + step) % count) + count) % count;
    if (i === dest) break;
    traceWarpath(ctx, mob, () => `skipping ${stopLabel(def, i)} (its squad is already down).`);
  }
  mob.warpathDestination = dest;
  traceWarpath(ctx, mob, () => {
    const why =
      pick === null
        ? ' (every picket is razed; regrouping, dragged to his leash)'
        : dragged
          ? ' (focus dragged to his leash)'
          : '';
    return `marching to ${stopLabel(def, dest)}${why}.`;
  });
  beginPhase(ctx, mob, def, 'travel');
  return 'travel';
}

function stopLabel(def: WarpathDef, index: number): string {
  return def.destinations[index]?.label ?? `stop ${index}`;
}

/** Enter a phase, stamping its clock and firing whatever announces it. For TRAVEL the
 *  destination is already chosen (leaveFocus). */
function beginPhase(ctx: SimContext, mob: Entity, def: WarpathDef, phase: WarpathPhase): void {
  mob.warpathPhase = phase;
  mob.warpathTimer = warpathPhaseDuration(phase, def);
  if (phase === 'travel') {
    const stop = def.destinations[mob.warpathDestination ?? 0];
    if (stop) {
      const leg = Math.hypot(stop.x - mob.pos.x, stop.z - mob.pos.z);
      mob.warpathTimer = warpathTravelPatience(def, leg, mob.moveSpeed * def.travelSpeedMult);
    }
    if (stop?.yell) emitMobYell(ctx, mob, stop.yell, def.yellRange);
    return;
  }
  if (phase === 'focus') {
    traceWarpath(ctx, mob, () => `fighting the raid (focus, ${def.focusSeconds}s).`);
    return;
  }
  if (phase === 'wreck') {
    // Show the ring, then land the blow: the same telegraph-then-detonate contract his
    // other two slams run on, so the counterplay the fight already taught still applies
    // at the one moment the raid is least likely to be standing still.
    mob.warpathBlastAt = ctx.time + WARPATH_WRECK_FUSE_SEC;
    ctx.emit({
      type: 'spellfxAt',
      // Named, so his own render layer draws it (render/balgath_ring_fx.ts).
      sourceId: mob.id,
      ability: WARPATH_WRECK_ABILITY,
      x: mob.pos.x,
      z: mob.pos.z,
      school: (def.wreck.school ?? 'physical') as Aura['school'],
      fx: 'runeCircle',
      radius: def.wreck.radius,
      duration: WARPATH_WRECK_FUSE_SEC,
    });
    ctx.emit({
      type: 'spellfx',
      sourceId: mob.id,
      targetId: mob.id,
      school: (def.wreck.school ?? 'physical') as Aura['school'],
      fx: 'windup',
      ability: WARPATH_WRECK_ABILITY,
    });
    if (def.wreckYell) emitMobYell(ctx, mob, def.wreckYell, def.yellRange);
  }
}

/**
 * The animation cues, which are ability ids only in the sense the renderer needs.
 *
 * Neither is a castable ability: they are the same `fx: 'windup'` channel the telegraphed
 * slams already ride (mob/locomotion.ts), routed by the renderer through `triggerAttack`
 * into the visual's `attackByAbility` map. If the two sides ever disagree the mechanic
 * still resolves and the boss simply plays his ordinary swing, which is why a test pins
 * the pairing rather than leaving it to be noticed in a raid.
 */
export const WARPATH_SWIPE_ABILITY = 'mob_warpath_swipe';
export const WARPATH_WRECK_ABILITY = 'mob_warpath_wreck';

/**
 * Advance one warpath tick for an engaged mob.
 *
 * FOCUS returns 'fallthrough' on purpose: it is ordinary boss combat, and reimplementing
 * it here would duplicate the swing timer, the hit table, the threat read and every aura
 * interaction to gain nothing at all.
 */
export function tickWarpath(ctx: SimContext, mob: Entity): WarpathTickResult {
  const def = MOBS[mob.templateId]?.warpath;
  if (!def || def.destinations.length === 0) return 'fallthrough';

  // A lost target (the tank died, a pet fell, someone vanished or feigned) is NOT the end
  // of the pull while anyone is left on his hate table: he turns to the next of them and
  // carries on with whatever he was doing. This used to reset the circuit, which was the
  // owner's "he ran toward a picket, then came straight back to fight me": the leg (or the
  // wreck fuse) was thrown away mid-run and he re-opened on FOCUS, circuit back at the
  // first stop. Only an empty table ends it: then the ordinary runner takes the tick and
  // evades him home, and the circuit is forgotten so the next pull opens on FOCUS.
  let target = mob.aggroTargetId !== null ? ctx.entities.get(mob.aggroTargetId) : null;
  if (!target || target.dead) {
    const next = highestThreatTarget(ctx, mob);
    const mid = mob.warpathPhase === 'travel' || mob.warpathPhase === 'wreck';
    if (!next) {
      if (mid) traceWarpath(ctx, mob, () => `${mob.warpathPhase} aborted (nobody left to fight).`);
      resetWarpath(mob);
      return 'fallthrough';
    }
    if (mid) {
      traceWarpath(ctx, mob, () => `lost his target mid-${mob.warpathPhase}, now on ${next.name}.`);
    }
    mob.aggroTargetId = next.id;
    target = next;
  }

  if (mob.warpathPhase === undefined) {
    mob.warpathLastHp = mob.hp;
    mob.warpathUnharried = 0;
    mob.warpathAlone = 0;
    mob.warpathSwipeTimer = def.swipe.every;
    beginPhase(ctx, mob, def, 'focus');
  }

  trackHarassment(mob);
  // Nobody in range counts up in sim time; anyone back in range clears it, so a raid that
  // swings wide for a moment as he sets off for the next stop does not reset him.
  mob.warpathAlone = livingPlayerWithin(ctx, mob, def.giveUp.playerRange)
    ? 0
    : (mob.warpathAlone ?? 0) + DT;

  // The give-up check runs on every engaged tick, before any phase moves him, so no phase
  // (a chase, a leg, a wreck) can carry him past it. Measured from his spawn, which is his
  // bed for the live boss and where the evade walks him home to.
  const quit = warpathGiveUp(
    dist2d(mob.pos, mob.spawnPos),
    mob.warpathAlone ?? 0,
    mob.warpathUnharried ?? 0,
    def,
  );
  if (quit) {
    traceWarpath(ctx, mob, () => `gives up (${quit}) and walks home.`);
    startEvadeHome(mob);
    resetWarpath(mob);
    return 'evaded';
  }

  mob.warpathTimer = Math.max(0, (mob.warpathTimer ?? 0) - DT);

  const dest = destinationPos(def, mob.warpathDestination ?? 0);
  const phase = (mob.warpathPhase ?? 'focus') as WarpathPhase;
  const draggedToLeash = phase === 'focus' && focusDraggedToLeash(mob);
  const next = nextWarpathPhase(
    phase,
    mob.warpathTimer ?? 0,
    dist2d(mob.pos, dest),
    def,
    draggedToLeash,
  );
  if (next !== phase) {
    if (next === 'travel') {
      // Leaving FOCUS: he may find nothing left standing and hold the fight instead.
      const entered = leaveFocus(ctx, mob, def, draggedToLeash);
      return entered === 'focus' ? 'fallthrough' : 'handled';
    }
    if (next === 'wreck') {
      traceWarpath(ctx, mob, () => {
        const at = stopLabel(def, mob.warpathDestination ?? 0);
        const off = dist2d(mob.pos, dest);
        return off <= def.arriveRadius
          ? `wrecking ${at}.`
          : `wrecking short of ${at} (travel timed out, ${off.toFixed(0)} yd off).`;
      });
    }
    beginPhase(ctx, mob, def, next);
    return next === 'focus' ? 'fallthrough' : 'handled';
  }

  if (phase === 'wreck') return tickWreck(ctx, mob, def, target);
  if (phase === 'travel') return tickTravel(ctx, mob, def, dest);
  return 'fallthrough';
}

/**
 * [dev] Land the arrival wreck where he stands right now, for the /dev balgath playtest
 * command (dev/balgath_dev_mechanics.ts): the same WRECK phase a finished leg enters (the
 * ring, the wind-up cue, the yell, the blast after the fuse), after which he returns to
 * FOCUS and his circuit carries on (a leg the wreck cut short counts as walked). A pull
 * that has not yet ticked its warpath is opened on it first, exactly as tickWarpath would.
 * Refuses (false) mid-wreck, or for a mob without a warpath. Draws no rng.
 */
export function forceWarpathWreck(ctx: SimContext, mob: Entity): boolean {
  const def = MOBS[mob.templateId]?.warpath;
  if (!def || def.destinations.length === 0 || mob.warpathPhase === 'wreck') return false;
  if (mob.warpathPhase === undefined) {
    mob.warpathLastHp = mob.hp;
    mob.warpathUnharried = 0;
    mob.warpathAlone = 0;
    mob.warpathSwipeTimer = def.swipe.every;
  }
  beginPhase(ctx, mob, def, 'wreck');
  return true;
}

/**
 * Whether FOCUS has been dragged to the edge of his tether: the fight he is planted in has
 * walked him (almost) as far from his landmark as the soft leash allows.
 *
 * At that point he marches on to his next stop instead of evading. An evade here was the
 * owner's "he ran to a spot and did nothing": his own slams punt the player he is fighting
 * a few yards at a time, he follows, and half a minute of that crosses the 45-yard leash,
 * so he dropped the pull, walked home immune to wherever he was raised (for a /dev spawn
 * copy, some random spot beside a camp) and stood there, and the next pull restarted the
 * circuit on a picket he had already flattened. Marching on keeps the tether's real job,
 * since a kiter still cannot drag him off across the zone: the circuit takes him back to
 * the pickets. Checked one yard inside the leash, so the combat runner's own leash test
 * (mob/combat_profile.ts, the same distance) never sees him past it in this phase.
 *
 * The same holds for the HARD tether round his bed (warpathGiveUp): a focus fight within
 * WARPATH_TETHER_MARCH_MARGIN of it marches on too, so a raid fighting him at his outermost
 * picket moves the fight along the circuit, and only a body displaced past the tether some
 * other way ever evades on it. Every stop and leg sits inside the tether, so the march
 * always carries him back in.
 */
export function focusDraggedToLeash(mob: Entity): boolean {
  const leash = mob.spawnPos.x > DUNGEON_X_THRESHOLD ? DUNGEON_LEASH_DISTANCE : LEASH_DISTANCE;
  if (dist2d(mob.pos, mob.leashAnchor ?? mob.spawnPos) > leash - 1) return true;
  const tether = MOBS[mob.templateId]?.warpath?.giveUp.tetherRadius;
  return (
    tether !== undefined && dist2d(mob.pos, mob.spawnPos) > tether - WARPATH_TETHER_MARCH_MARGIN
  );
}

/**
 * Seconds since anything reduced his health, measured off HP rather than off a damage
 * hook.
 *
 * Every source counts that way, bleeds and pets and reflected damage included, with no
 * new plumbing threaded through the damage path that a future damage source could forget
 * to call. The 0.5 floor keeps a rounding wobble from reading as a hit.
 */
function trackHarassment(mob: Entity): void {
  const lastHp = mob.warpathLastHp ?? mob.hp;
  if (mob.hp < lastHp - 0.5) mob.warpathUnharried = 0;
  else mob.warpathUnharried = (mob.warpathUnharried ?? 0) + DT;
  mob.warpathLastHp = mob.hp;
}

/** TRAVEL: he goes where he is going. Threat does not steer him. */
function tickTravel(ctx: SimContext, mob: Entity, def: WarpathDef, dest: Vec3): WarpathTickResult {
  if (!ctx.isRooted(mob)) {
    ctx.moveToward(mob, ctx.groundPos(dest.x, dest.z), mob.moveSpeed * def.travelSpeedMult);
  } else {
    mob.facing = angleTo(mob.pos, dest);
  }
  mob.aiState = 'chase';
  // Drag the leash anchor along with him, which is what lets him keep the tether at all.
  //
  // The anchor is stamped once at the pull and never moves, so a warpather measured
  // against it breaks the 45-yard soft leash on his first long leg and evades home in the
  // middle of his own mechanic. The obvious fix is to turn leashing off for him; that
  // leaves an open-world boss one kiting player can drag across the map forever, with
  // nothing in the fight that ever brings him back. Refreshing the anchor here says the
  // real thing instead: while he is TRAVELLING he is exactly where he means to be, so
  // there is nothing to leash him back to. The moment he stops, the anchor stops with him
  // and the tether re-tightens around the landmark he arrived at, which is where a raid
  // dragging him off into the fen should still be pulled up short.
  mob.leashAnchor = { x: mob.pos.x, y: mob.pos.y, z: mob.pos.z };

  // The reason the chase is mandatory rather than advisory: stop hurting him and the
  // phase you just spent starts coming back.
  //
  // One chunky heal a second rather than a 20 Hz dribble, fired on the tick the unharried
  // clock crosses a whole second (which is the same event a second timer field would have
  // counted, without the field). The raid has to SEE the bar climb to learn the rule, and
  // twenty rounding-error green numbers a second is noise rather than feedback.
  const unharried = mob.warpathUnharried ?? 0;
  if (
    unharried >= def.regen.unharriedSeconds &&
    mob.hp < mob.maxHp &&
    Math.floor(unharried) > Math.floor(unharried - DT)
  ) {
    // canCrit false: a boss regenerating must not roll, so this draws no rng at all and
    // the shared stream orders identically whether or not the raid let him breathe.
    ctx.applyHeal(mob, mob, mob.maxHp * def.regen.pctPerSecond, def.regen.name, null, false);
    // Re-baseline off the HEALED value: the harassment check compares against the last
    // observed hp, and without this the heal reads as damage on the following tick and
    // resets the very timer that authorised it.
    mob.warpathLastHp = mob.hp;
  }

  mob.warpathSwipeTimer = Math.max(0, (mob.warpathSwipeTimer ?? def.swipe.every) - DT);
  if (mob.warpathSwipeTimer <= 0) {
    mob.warpathSwipeTimer = def.swipe.every;
    fireSwipe(ctx, mob, def);
  }
  return 'handled';
}

/** WRECK: planted over the landmark, ring burning down, then the fists land. */
function tickWreck(
  ctx: SimContext,
  mob: Entity,
  def: WarpathDef,
  target: Entity,
): WarpathTickResult {
  mob.aiState = 'attack';
  mob.facing = angleTo(mob.pos, target.pos);
  const fuse = mob.warpathBlastAt;
  if (fuse !== undefined && fuse !== null && ctx.time >= fuse) {
    mob.warpathBlastAt = null;
    fireWreck(ctx, mob, def);
  }
  return 'handled';
}

/**
 * The travelling backhand: one player near him, picked at random, hit hard.
 *
 * One rather than everyone in the radius, and random rather than nearest, because both
 * make it read as a giant swatting at what is buzzing around him instead of a pulsing
 * aura. It also keeps the escort survivable for a raid that has to stay close, while
 * still making standing next to him a choice with a cost.
 */
function fireSwipe(ctx: SimContext, mob: Entity, def: WarpathDef): void {
  const school = (def.swipe.school ?? 'physical') as Aura['school'];
  let picked: Entity | null = null;
  let seen = 0;
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p || p.dead || dist2d(p.pos, mob.pos) > def.swipe.radius) continue;
    // Reservoir sample: one draw per candidate, so the pick is uniform without building
    // an array, and the draw count is a pure function of who is in range.
    seen++;
    if (ctx.rng.next() < 1 / seen) picked = p;
  }
  if (!picked) return;
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school,
    fx: 'windup',
    ability: WARPATH_SWIPE_ABILITY,
  });
  // He does NOT turn to face the victim, and that omission is the point. A running body
  // that snaps its yaw onto whatever it is swatting spends the next frame facing one way
  // and translating another, which is the exact "runs forward, moves sideways" artifact
  // this whole pass exists to kill: a probe caught it at 2.6s intervals, one per swipe,
  // with the facing error at a clean pi. A giant backhands what is buzzing at him without
  // breaking stride.
  const dmg = Math.round(
    ctx.rng.range(def.swipe.min, def.swipe.max) * (mob.mechanicDamageMult ?? 1),
  );
  ctx.dealDamage(
    mob,
    picked,
    levelScaledMechanicDamage(mob, picked, dmg),
    false,
    school,
    def.swipe.name,
    'hit',
    true,
  );
}

/** The arrival slam: everyone still inside the ring he showed them. */
function fireWreck(ctx: SimContext, mob: Entity, def: WarpathDef): void {
  const school = (def.wreck.school ?? 'physical') as Aura['school'];
  // Positioned and sized, so the renderer draws the blast at the ring rather than on the
  // body: this is the same cue the telegraphed slams emit, and it is what routes through
  // Balgath's ground-effect layer into a crater and a camera jolt.
  ctx.emit({
    type: 'spellfxAt',
    sourceId: mob.id,
    x: mob.pos.x,
    z: mob.pos.z,
    school,
    fx: 'nova',
    radius: def.wreck.radius,
  });
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p || p.dead || dist2d(p.pos, mob.pos) > def.wreck.radius) continue;
    const dmg = Math.round(
      ctx.rng.range(def.wreck.min, def.wreck.max) * (mob.mechanicDamageMult ?? 1),
    );
    ctx.dealDamage(
      mob,
      p,
      levelScaledMechanicDamage(mob, p, dmg),
      false,
      school,
      def.wreck.name,
      'hit',
      true,
    );
  }
  // The landmark he came to wreck is usually surrounded by whatever lives there. This is the
  // slam where that matters most: it is the one that craters the town.
  splashNearbyMobs(
    ctx,
    mob,
    mob.pos,
    def.wreck.radius,
    def.wreck.min,
    def.wreck.max,
    school,
    def.wreck.name,
  );
  // The arrival slam throws them, like his other two: same shared rule, same opt-in.
  launchFromSlam(ctx, mob, mob.pos, def.wreck.radius);
}

/**
 * Drop the circuit, so the next pull opens on FOCUS at wherever he now stands.
 *
 * Written as guarded assignments rather than unconditional ones: an entity that never
 * walked a warpath must come out of this with the fields still UNDEFINED, since the
 * parity golden samples entity shape and a mob that gained a row of nulls on every evade
 * would churn it for no behavior change at all.
 */
export function resetWarpath(mob: Entity): void {
  if (mob.warpathPhase === undefined) return;
  mob.warpathPhase = undefined;
  mob.warpathTimer = 0;
  mob.warpathDestination = undefined;
  mob.warpathUnharried = 0;
  mob.warpathAlone = 0;
  mob.warpathSwipeTimer = 0;
  mob.warpathBlastAt = null;
}
