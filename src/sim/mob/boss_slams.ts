// Slams: the two hand-aimed boss attacks, and the launch every heavy slam pays out.
//
// The shipped boss AoE vocabulary is circles centred on the boss (aoePulse, stomp). Both
// are dodged the same way, by walking out, so a fight built only from them teaches exactly
// one skill. These two are aimed somewhere OTHER than the boss's feet and are dodged in
// two different ways, which is what turns a damage check into a fight:
//
//   HAMMER  He picks a player, raises ONE fist, and brings it down where they were
//           standing. Small footprint, so it is dodged by MOVING, and it follows you
//           around the arena rather than punishing you for standing near him.
//   CLEAVE  He drags an arm across the ground in a wide arc in front of him. It is dodged
//           by JUMPING, and only by jumping: the arm passes at shin height, so walking
//           backwards out of a 20-yard reach is not an option and there is a real
//           half-second window you either hit or miss. Clear it and the passing arm
//           CARRIES you (you rode it); miss it and you are hit hard and thrown.
//
// Both are declared per template (`MobTemplate.slams`) and inert for every mob without
// it, so nothing else in the world changes shape and the golden parity trace is untouched.
//
// The third export is the one every heavy slam shares. `launchFromSlam` is what makes a
// giant's fists feel like they weigh something: the shipped knockback slides a victim
// along the ground, which reads as being pushed, and a body that is PUNTED reads as being
// hit. It runs the shove through ctx.applyKnockback first (so every cliff, wall, deep
// water and knockback-immunity rule is honoured by the one implementation that knows
// them) and only adds the vertical pop when that shove actually landed.
import { MOBS } from '../data';
import { shockLanceBraces } from '../lance_trial';
import type { SimContext } from '../sim_context';
import type { Aura, Entity, MobTemplate, Vec3 } from '../types';
import { angleTo, DT, dist2d, normAngle } from '../types';
import { groundHeight } from '../world';
import { splashNearbyMobs } from './boss_collateral';
import { claimMechanicSpacing, mechanicSpacingBlocked } from './mechanic_spacing';

type SlamsDef = NonNullable<MobTemplate['slams']>;

/**
 * The animation cues. Not castable abilities: the same `fx: 'windup'` channel the
 * telegraphed slams already ride, routed by the renderer through `triggerAttack` into the
 * visual's `attackByAbility` map, and also what the fist glow keys off.
 */
export const HAMMER_ABILITY = 'mob_balgath_hammer';
export const CLEAVE_ABILITY = 'mob_balgath_cleave';

/**
 * Feet-above-ground a player must reach to clear the cleave.
 *
 * 0.6 yards, and the number is the mechanic. A standing jump apexes at 1.125 yards
 * (JUMP_VELOCITY 6, GRAVITY 16) over about 0.75s, and solving 6t - 8t^2 > 0.6 puts the
 * clear window at t in [0.12, 0.63]: a bit over half a second inside a jump, against a
 * telegraph the player can see coming. High enough that it cannot be walked through and
 * low enough that one well-timed jump always beats it.
 */
export const CLEAVE_CLEAR_HEIGHT = 0.6;

/** Fraction of the arm's sweep speed a player who cleared it is carried at. */
export const CLEAVE_CARRY = 0.55;

/**
 * Punt every player inside a landed slam: shoved out, then thrown into the air.
 *
 * The shove goes through `ctx.applyKnockback` rather than being re-derived here, and that
 * is deliberate rather than lazy. That function is the only thing in the sim that knows
 * the whole rule set a forced displacement has to obey: knockback resistance, ice block,
 * the Veilbound march, cliff faces, thin walls, deep water, and the support-aware landing
 * seat. Re-implementing a shove would mean re-implementing all of it, and getting one
 * wrong is a player shoved through a wall.
 *
 * The vertical pop is added only when that shove reported real movement, so a fully
 * knockback-immune player is not launched either: one rule, one place, both halves.
 */
export function launchFromSlam(
  ctx: SimContext,
  mob: Entity,
  center: Vec3,
  radius: number,
  /**
   * Only these entity ids, when the blast that called this was not a circle.
   *
   * The radial slams hit everyone inside their radius, so they pass nothing and the
   * distance test below IS the victim list. The cleave does not: it hits a 120-degree
   * wedge, and inside that wedge it MISSES anyone who jumped it. Launching on radius
   * alone punted players standing behind him and, worse, punted the ones who had just
   * dodged it correctly, which turns a skill check into a coin flip.
   */
  only?: ReadonlySet<number>,
): void {
  // Every telegraphed detonation walks through this door, which makes it the one hook the
  // Shardpike needs: a slam's shockwave kicks every braced balance beam in reach
  // (lance_trial.ts), so the boss's own attacks pressure the trial without a second
  // integration point per mechanic. Before the launch gate on purpose: the shockwave
  // reaches further than the punt, and a mob with no launch def still shakes the ground.
  shockLanceBraces(ctx, center.x, center.z, radius);
  const def = MOBS[mob.templateId]?.launch;
  if (!def) return;
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p || p.dead) continue;
    if (only && !only.has(p.id)) continue;
    const d = dist2d(p.pos, center);
    if (d > radius) continue;
    // Hardest at the epicentre, easing to `edgeScale` at the rim, so where you were
    // standing when it landed is visible in how far you fly.
    const bite = 1 - (1 - def.edgeScale) * Math.min(1, d / Math.max(0.001, radius));
    // A body exactly on the epicentre has no outward direction of its own; shove it along
    // the boss's facing so the direction is stable rather than random.
    const source =
      d < 0.05 ? mob : ({ ...mob, pos: center, facing: mob.facing } as unknown as Entity);
    if (ctx.applyKnockback(source, p, def.distance * bite) <= 0) continue;
    const ang = d < 0.05 ? mob.facing : angleTo(center, p.pos);
    p.vx = Math.sin(ang) * def.outSpeed * bite;
    p.vz = Math.cos(ang) * def.outSpeed * bite;
    p.vy = def.up * bite;
    p.onGround = false;
    p.jumping = true;
    // Reset the fall reference to the launch height, so the drop that follows is measured
    // from where he threw them. Without it the apex counts as a fall from wherever they
    // had last been standing, and a slam on a rise reads as the boss dealing extra damage
    // it never dealt.
    p.fallStartY = p.pos.y;
  }
}

/**
 * Advance the aimed slams for one engaged tick.
 *
 * Resolves a live windup FIRST and unconditionally, then considers starting a new one.
 * That order matters twice over: a detonation and the next wind can never share a tick,
 * and a telegraph already on the ground always resolves even on a tick where the boss is
 * no longer allowed to start one. A ring that is drawn and never detonates is the worst
 * outcome available here, because it teaches the raid that the telegraph means nothing.
 *
 * Starting is gated on `aiState === 'attack'`, the shipped melee-contact gate: he throws
 * these while planted and fighting, not while running a warpath leg across the fen.
 */
export function tickBossSlams(ctx: SimContext, mob: Entity): void {
  const def = MOBS[mob.templateId]?.slams;
  if (!def) return;
  resolveWindup(ctx, mob, def);
  if ((mob.slamWindup ?? 0) > 0) return;
  if (mob.aiState !== 'attack') return;
  const target = mob.aggroTargetId !== null ? ctx.entities.get(mob.aggroTargetId) : null;
  if (!target || target.dead) return;

  // Both share the boss's mechanic spacing lock, so an aimed slam can never land on top
  // of a circle telegraph the raid is already reading. They sit outside the oldest-due
  // comparison in mechanic_spacing.ts (like infernoChannel): they arm the lock and
  // respect it, but never compete for the slot, so no rift boss's drain order moves.
  const blocked = mechanicSpacingBlocked(mob);
  mob.hammerTimer = (mob.hammerTimer ?? def.hammer.every) - DT;
  mob.cleaveTimer = (mob.cleaveTimer ?? def.cleave.every) - DT;
  if (blocked) return;
  // Cleave wins a tie: it is the slower, louder one, and the one a raid is most likely to
  // be waiting on. Both hold at due while the lock runs rather than resetting, so neither
  // ever loses a cycle to the other.
  if ((mob.cleaveTimer ?? 0) <= 0 && dist2d(mob.pos, target.pos) <= def.cleave.range) {
    mob.cleaveTimer = def.cleave.every;
    startCleave(ctx, mob, def);
    return;
  }
  if ((mob.hammerTimer ?? 0) <= 0) {
    mob.hammerTimer = def.hammer.every;
    startHammer(ctx, mob, def, pickHammerVictim(ctx, mob) ?? target);
  }
}

/**
 * Who the fist comes down on: ANYONE, drawn at random from the players near him.
 *
 * Not the threat target, and the difference is the whole mechanic. Aimed at whoever holds
 * threat it lands on the tank every single time, and a tank cannot step out of it without
 * dropping the boss on the raid, so the "dodge" is a choice between two bad outcomes.
 * Drawn at random it is whack-a-mole: everybody has to watch the ground, and the person it
 * picks is free to move.
 *
 * Reservoir sampling, so the pick is uniform without building an array and the number of
 * rng draws is a pure function of who is standing in range.
 */
function pickHammerVictim(ctx: SimContext, mob: Entity): Entity | null {
  const def = MOBS[mob.templateId]?.slams;
  if (!def) return null;
  // Generous compared with the blast: he can reach across the whole engagement, which is
  // what stops the raid from parking outside a known safe ring.
  const reach = def.cleave.range * 1.5;
  let picked: Entity | null = null;
  let seen = 0;
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p || p.dead || dist2d(p.pos, mob.pos) > reach) continue;
    seen++;
    if (ctx.rng.next() < 1 / seen) picked = p;
  }
  return picked;
}

/** He picks up one fist and holds it over where that player is standing right now. */
function startHammer(ctx: SimContext, mob: Entity, def: SlamsDef, target: Entity): void {
  const school = (def.hammer.school ?? 'physical') as Aura['school'];
  // The aim point is SNAPSHOT at the wind, which is the whole mechanic: the ring stays
  // where it was drawn, so stepping out of it always works and never stops working.
  mob.slamKind = 'hammer';
  mob.slamWindup = def.hammer.windup;
  mob.slamX = target.pos.x;
  mob.slamZ = target.pos.z;
  // His body deliberately does NOT turn toward the victim.
  //
  // It is tempting, and it is the moonwalk again: the hammer picks a player at RANDOM,
  // he is usually walking at whoever holds threat, and snapping his facing to a third
  // party leaves him striding one way with his chest pointed another. The read is
  // carried by the ring on the ground and by the one raised fist, neither of which needs
  // him to turn. A probe over a full fight caught this as a facing-versus-velocity
  // mismatch the instant the random pick went in.
  claimMechanicSpacing(mob, def.hammer.windup);
  ctx.emit({
    type: 'spellfxAt',
    sourceId: mob.id,
    x: target.pos.x,
    z: target.pos.z,
    school,
    fx: 'runeCircle',
    radius: def.hammer.radius,
    duration: def.hammer.windup,
    ability: HAMMER_ABILITY,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school,
    fx: 'windup',
    ability: HAMMER_ABILITY,
  });
}

/** He drags an arm back. Where he is pointing when he winds is where it lands. */
function startCleave(ctx: SimContext, mob: Entity, def: SlamsDef): void {
  const school = (def.cleave.school ?? 'physical') as Aura['school'];
  mob.slamKind = 'cleave';
  mob.slamWindup = def.cleave.windup;
  // Snapshot the AIM, not a point: the arc is measured from here at detonation, so a boss
  // who turns during the wind still cleaves where the raid was shown.
  mob.slamX = Math.sin(mob.facing);
  mob.slamZ = Math.cos(mob.facing);
  claimMechanicSpacing(mob, def.cleave.windup);
  ctx.emit({
    type: 'spellfxAt',
    sourceId: mob.id,
    x: mob.pos.x,
    z: mob.pos.z,
    school,
    fx: 'runeCircle',
    radius: def.cleave.range,
    duration: def.cleave.windup,
    ability: CLEAVE_ABILITY,
    // The aim, so the renderer draws the ARC the damage will actually use rather than a
    // full circle: the two differ by a factor of four in area, and drawing the wrong one
    // teaches the raid to dodge something that was never coming.
    dirX: mob.slamX,
    dirZ: mob.slamZ,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school,
    fx: 'windup',
    ability: CLEAVE_ABILITY,
  });
}

function resolveWindup(ctx: SimContext, mob: Entity, def: SlamsDef): void {
  if ((mob.slamWindup ?? 0) <= 0) return;
  mob.slamWindup = Math.max(0, (mob.slamWindup ?? 0) - DT);
  if ((mob.slamWindup ?? 0) > 0) return;
  const kind = mob.slamKind;
  mob.slamKind = undefined;
  if (kind === 'hammer') fireHammer(ctx, mob, def);
  else if (kind === 'cleave') fireCleave(ctx, mob, def);
}

/** The fist lands where the ring was drawn. Anyone still standing there wears it. */
function fireHammer(ctx: SimContext, mob: Entity, def: SlamsDef): void {
  const school = (def.hammer.school ?? 'physical') as Aura['school'];
  const center: Vec3 = { x: mob.slamX ?? mob.pos.x, y: mob.pos.y, z: mob.slamZ ?? mob.pos.z };
  ctx.emit({
    type: 'spellfxAt',
    sourceId: mob.id,
    x: center.x,
    z: center.z,
    school,
    fx: 'nova',
    radius: def.hammer.radius,
    ability: HAMMER_ABILITY,
  });
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p || p.dead || dist2d(p.pos, center) > def.hammer.radius) continue;
    const dmg = Math.round(
      ctx.rng.range(def.hammer.min, def.hammer.max) * (mob.mechanicDamageMult ?? 1),
    );
    ctx.dealDamage(mob, p, dmg, false, school, def.hammer.name, 'hit', true);
  }
  splashNearbyMobs(
    ctx,
    mob,
    center,
    def.hammer.radius,
    def.hammer.min,
    def.hammer.max,
    school,
    def.hammer.name,
  );
  launchFromSlam(ctx, mob, center, def.hammer.radius);
}

/**
 * The arm comes across. Jump it or wear it.
 *
 * The clear test is the player's real height above the ground under their own feet, not
 * an `onGround` flag: a one-frame hop off a kerb is not a dodge, and a player standing on
 * a crate inside the arc has genuinely got their legs out of the way.
 */
function fireCleave(ctx: SimContext, mob: Entity, def: SlamsDef): void {
  const school = (def.cleave.school ?? 'physical') as Aura['school'];
  const aim = Math.atan2(mob.slamX ?? Math.sin(mob.facing), mob.slamZ ?? Math.cos(mob.facing));
  const half = (def.cleave.halfArcDeg * Math.PI) / 180;
  ctx.emit({
    type: 'spellfxAt',
    sourceId: mob.id,
    x: mob.pos.x,
    z: mob.pos.z,
    school,
    fx: 'nova',
    radius: def.cleave.range,
    ability: CLEAVE_ABILITY,
    dirX: Math.sin(aim),
    dirZ: Math.cos(aim),
  });
  const struck = new Set<number>();
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (!p || p.dead) continue;
    const d = dist2d(p.pos, mob.pos);
    if (d > def.cleave.range || d < 0.05) continue;
    if (Math.abs(normAngle(angleTo(mob.pos, p.pos) - aim)) > half) continue;
    const feet = p.pos.y - groundHeight(p.pos.x, p.pos.z, ctx.cfg.seed);
    if (feet >= CLEAVE_CLEAR_HEIGHT) {
      // Rode it. The arm is still moving, so it takes them with it: no damage, but they
      // are not where they were, and that is the trade for a dodge that costs nothing.
      const along = aim + Math.PI / 2;
      p.vx = Math.sin(along) * def.cleave.sweepSpeed * CLEAVE_CARRY;
      p.vz = Math.cos(along) * def.cleave.sweepSpeed * CLEAVE_CARRY;
      p.onGround = false;
      p.jumping = true;
      continue;
    }
    struck.add(p.id);
    const dmg = Math.round(
      ctx.rng.range(def.cleave.min, def.cleave.max) * (mob.mechanicDamageMult ?? 1),
    );
    ctx.dealDamage(mob, p, dmg, false, school, def.cleave.name, 'hit', true);
  }
  // Bystanders get the same arc test the players got, minus the jump: a boar cannot read a
  // telegraph, so anything inside the swept wedge wears it.
  splashNearbyMobs(
    ctx,
    mob,
    mob.pos,
    def.cleave.range,
    def.cleave.min,
    def.cleave.max,
    school,
    def.cleave.name,
    (e) => Math.abs(normAngle(angleTo(mob.pos, e.pos) - aim)) <= half,
  );
  // Only the ones it actually caught. Whoever cleared it is airborne and riding the arm,
  // and whoever was behind him was never in the arc at all.
  launchFromSlam(ctx, mob, mob.pos, def.cleave.range, struck);
}

/** Drop any half-wound slam with the pull, so a fresh engage never inherits one. */
export function resetBossSlams(mob: Entity): void {
  if (mob.slamWindup !== undefined) mob.slamWindup = 0;
  if (mob.slamKind !== undefined) mob.slamKind = undefined;
  const def = MOBS[mob.templateId]?.slams;
  if (!def) return;
  mob.hammerTimer = def.hammer.every;
  mob.cleaveTimer = def.cleave.every;
}
