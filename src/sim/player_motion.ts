// The player movement kernel, moved VERBATIM out of Sim.updatePlayerMovement
// (everything after the charge/follow/fear short-circuits): keyboard turn
// integration, the wish vector, steep-slope gates, swept static collision, and
// the vertical step (swim tread, jump, gravity, fall damage, ledge snap-down).
//
// Host-agnostic on purpose: the step is a pure function of the entity pose,
// the held MoveInput, the world seed, and the PlayerMotionDeps callbacks. The
// live Sim binds the deps to its own methods (fiesta-aware moveSpeedMult,
// delve-aware resolveMove, real cancelCast/standUp/dealDamage); the online
// client's display-only self extrapolator (src/render/self_motion.ts) binds
// pure/no-op equivalents, so the SAME math animates both hosts and stays in
// lockstep by construction (tests/player_motion.test.ts runs the client dep
// shape against a live Sim every CI run).
//
// `src/sim`-pure: imports only sibling sim modules and draws no rng itself.
// The one rng-reachable callee, dealDamage (fall damage), is invoked through
// deps at the identical call site, so the Sim's global draw order is unchanged
// by the extraction.

import { isInstancedRegion, MANTLE_REACH, slopeGlueHeight } from './colliders';
import { afflictionCanCastWhileMoving } from './combat/affliction';
import { isRooted, isStunned } from './combat/cc';
import { iceFloesAuraForAbility } from './combat/empower_next';
import { isVeilboundMarchActive } from './combat/paladin_veilbound_state';
import { mountMoveSpeedPct } from './content/mounts';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from './pathfind';
import {
  type CharacterMoveParams,
  type CharacterMoveResult,
  floorHeightAt,
  MAX_STEP_HEIGHT,
  moveCharacter,
} from './physics';
import { isSubmergedAt, rideSteepnessAt, shoreStepOut, stepWaterLevel } from './ride_height';
import { GHOST_RUN_MULT } from './spirit';
import {
  DT,
  ENRAGE_MOVE_MULT,
  type Entity,
  type MoveInput,
  normAngle,
  RUN_SPEED,
  TURN_SPEED,
} from './types';
import {
  groundHeight,
  terrainDownhill,
  terrainSteepnessAt,
  terrainWallStandoff,
  waterLevelAt,
} from './world';

export const BACKPEDAL_MULT = 0.65;
export const GRAVITY = 16;
export const JUMP_VELOCITY = 6; // apex = v^2/2g ≈ 1.125 yd
// A mounted rider springs higher so a paddock show-jump reads as clearable: the
// apex rises to (JUMP_VELOCITY * MOUNT_JUMP_MULT)^2 / 2g ≈ 1.76 yd. Applied in
// jumpMult, so it flows through the one shared movement kernel (offline, server,
// and the online self-extrapolator all agree, pinned by player_motion.test.ts).
export const MOUNT_JUMP_MULT = 1.25;
// Airborne steering: held movement keys accelerate the air velocity toward the
// wish direction at this rate (yd/s^2), capped at the wish speed. Enough to
// meaningfully adjust a jump arc (full authority in ~0.35 s of a ~0.75 s arc)
// without letting a knockback be cancelled outright.
export const AIR_CONTROL_ACCEL = 20;
// Kernel-owned scratch for the physics solver: the kernel is called once per
// player per tick on a single thread, so one reused pair keeps the hot path
// allocation-free (the same discipline the renderer's per-frame cores use).
const moveParams: CharacterMoveParams = {
  seed: 0,
  radius: 0,
  stepHeight: 0,
  maxSlope: 0,
  grounded: false,
  swimming: false,
  ignoreFences: false,
};
const moveOut: CharacterMoveResult = { x: 0, y: 0, z: 0, blocked: false, stepped: 0 };
// Coyote time: seconds after WALKING off a ledge (never after a jump) during
// which a jump still fires. Stateless on purpose: a walk-off starts at vy = 0,
// so "recently left the ledge" is exactly vy > -GRAVITY * COYOTE_TIME.
export const COYOTE_TIME = 0.15;
// Re-exported by sim.ts for social/chat_readouts.ts (the /falling readout shares
// the landing-damage threshold with the fall-damage model below).
export const FALL_SAFE_DISTANCE = 12; // yards of free fall before damage
export const STEEP_SLIDE_SPEED = RUN_SPEED; // yd/s a player skids downhill off unwalkable ground
export const SWIM_SPEED_MULT = 0.65;
// Buoyancy: a submerged body rises toward the swim surface at this rate
// (yd/s) instead of teleporting there. Walking past the swim-depth line used
// to snap y from the lake bed straight to the surface in one tick; a fixed
// deterministic rise keeps the same end state and reads as floating up.
export const SWIM_BUOYANCY_RISE = 5;
// Deepest a falling body plunges below the swim surface before buoyancy takes
// over (a dive reads as a dive, not as landing on glass), always kept clear
// of the bed itself.
export const SWIM_MAX_PLUNGE = 1.2;
// Underwater travel. A dive opens slow and deliberate and settles into a cruise
// once the first full stroke is behind you — the ramp is exactly one stroke of
// the authored breaststroke (Swim_Breaststroke, 1.7s), so the speed-up lands on
// the beat the animation finishes its first pull. The cruise still sits UNDER
// the surface pace: swimming underwater is never the fast way to travel.
export const SWIM_DIVE_SPEED_MULT = 0.32;
export const SWIM_DIVE_CRUISE_MULT = 0.58;
export const SWIM_STROKE_PERIOD = 1.7;
/** Descend / ascend rate while swimming (yd/s), at full steer. */
export const SWIM_DIVE_RATE = 3.2;
export const SWIM_ASCEND_RATE = 4.2;
/** Yards of plunge per yd/s of water-entry speed BEYOND a flat hop's landing
 *  speed, capped: a cliff dive drives the body under before it floats back. */
export const SWIM_PLUNGE_PER_SPEED = 0.12;
export const SWIM_PLUNGE_MAX = 2.5;
/** Rate floor for the gentlest steer, as a fraction of the rates above. Easing
 *  the camera just past the threshold has to MOVE you — a band that starts at
 *  zero reads as a dead control — but it must not lurch either, so the shallow
 *  end is a drift and the steep end is the full plunge. */
export const SWIM_STEER_MIN_RATE = 0.3;
/** Feet clearance kept above the lake bed, so a diver never sinks into terrain. */
export const SWIM_FLOOR_CLEARANCE = 0.35;
/** Below the waterline by this much = underwater (not just bobbing on a swell). */
export const SWIM_SUBMERGE_EPS = 0.12;

// Wading: water over the feet but ground still under them. The swim latch takes
// over once the bed drops PLAYER_SWIM_DEPTH under the line, so this band tops
// out below the waist by construction — which is exactly the range where a body
// should be shoving water aside rather than striding through it.
/** Ankle deep. Below this it is a puddle and costs nothing. */
export const WADE_MIN_DEPTH = 0.22;
/** ...and the depth by which the drag is at full strength. */
export const WADE_FULL_DEPTH = 0.75;
/** Speed multiplier at WADE_FULL_DEPTH. Slower, not crippling: crossing a ford
 *  should read as effort, and a shoreline should never feel like a snare. */
export const WADE_SPEED_MULT = 0.72;

/**
 * Horizontal drag from standing in water, 0.72..1 by depth.
 *
 * Ramped rather than stepped so a shoreline has no speed cliff in it: walking
 * down a beach slows continuously as the water climbs the legs. Off (1) on dry
 * ground, and while SWIMMING — there the stroke multiplier owns the speed.
 */
export function wadeSpeedMult(feetDepth: number): number {
  if (!Number.isFinite(feetDepth) || feetDepth <= WADE_MIN_DEPTH) return 1;
  const t = Math.min(1, (feetDepth - WADE_MIN_DEPTH) / (WADE_FULL_DEPTH - WADE_MIN_DEPTH));
  return 1 + (WADE_SPEED_MULT - 1) * t;
}

/**
 * The vertical rate multiplier a MoveInput asks for, 0.3..1.
 *
 * `swimSteer` is how far the camera is pitched into the dive (or the climb).
 * It is OPTIONAL on the wire: the dive KEY, a bot, an old client and every test
 * that builds a MoveInput by hand all omit it and get 1 — the original,
 * ungraded behaviour — so nothing has to know about it to keep working.
 */
export function swimSteerRate(steer: number | undefined): number {
  if (typeof steer !== 'number' || !Number.isFinite(steer)) return 1;
  const t = Math.min(1, Math.max(0, steer));
  return SWIM_STEER_MIN_RATE + (1 - SWIM_STEER_MIN_RATE) * t;
}

/** True when the body is swimming with its feet BELOW the surface line. */
export function isSubmerged(e: Entity, seed: number): boolean {
  const ground = groundHeight(e.pos.x, e.pos.z, seed);
  const level = waterLevelAt(e.pos.x, e.pos.z, seed);
  return swimsAt(e.pos.y, ground, level) && e.pos.y < level - 0.75 - SWIM_SUBMERGE_EPS;
}

/** The swim test itself, over an ALREADY-sampled ground height and water level.
 *  Everything that asks "am I swimming" routes through here so the expensive
 *  terrain sample is taken exactly once per caller — paying for it twice per
 *  gate per tick is enough to add minutes to a long simulation. */
function swimsAt(y: number, ground: number, level: number): boolean {
  return ground < level - SWIM_DEPTH && y <= level - 0.75 + 0.15;
}

/**
 * Horizontal swim multiplier. Surface swimming is unchanged; underwater starts
 * at the dive pace and eases to the cruise across one stroke of held travel.
 */
export function swimSpeedMult(strokeT: number, submerged: boolean): number {
  if (!submerged) return SWIM_SPEED_MULT;
  const t = Math.min(1, Math.max(0, strokeT / SWIM_STROKE_PERIOD));
  const eased = t * t * (3 - 2 * t);
  return SWIM_DIVE_SPEED_MULT + (SWIM_DIVE_CRUISE_MULT - SWIM_DIVE_SPEED_MULT) * eased;
}
// Body bobs just below the water line at this location (terrain/feature-aware:
// -Infinity outside every declared lake and the open sea, so this is never
// called off a waterline that doesn't exist there).
export function swimSurfaceY(x: number, z: number, seed: number): number {
  return waterLevelAt(x, z, seed) - 0.75;
}

/** Swimmable depth at a point, sampling the terrain ONCE (the mount water-walls
 *  ask about a destination they have no height for yet). */
function isDeepFor(x: number, z: number, seed: number): boolean {
  const ground = groundHeight(x, z, seed);
  return ground < waterLevelAt(x, z, seed) - SWIM_DEPTH;
}

const SWIM_DEPTH = PLAYER_SWIM_DEPTH; // ground this far under the water line = deep water
const MAX_CLIMB_SLOPE = PLAYER_MAX_CLIMB_SLOPE;
const BODY_RADIUS = PLAYER_BODY_RADIUS;

// Movement speed multiplier over the entity's own state (ghost flag + auras).
// The Fiesta move-speed augment lives on PlayerMeta, so the live Sim passes it
// via extraSpeedPct; hosts without PlayerMeta (the client extrapolator) pass 0.
export function moveSpeedMult(e: Entity, extraSpeedPct = 0): number {
  // A released spirit runs at a fixed boosted speed and is immune to snares (a ghost
  // cannot be slowed): short-circuit the aura scan with the ghost-run multiplier.
  if (e.ghost) return GHOST_RUN_MULT;
  let slow = 1,
    speed = 1;
  const slowImmune =
    isVeilboundMarchActive(e) || e.auras.some((aura) => aura.kind === 'slow_immunity');
  for (const a of e.auras) {
    if ((!slowImmune && a.kind === 'slow') || a.kind === 'stealth') slow = Math.min(slow, a.value);
    // Speed buffs and travel forms carry a 1+fraction multiplier (1.4 = +40%).
    if (a.kind === 'buff_speed' || a.kind === 'form_travel' || a.kind === 'form_fireball') {
      speed = Math.max(speed, a.value);
    }
    // Fury Enrage: +10% move speed (non-stacking with other speed buffs).
    if (a.kind === 'enrage') speed = Math.max(speed, ENRAGE_MOVE_MULT);
  }
  // Mounted travel: the active ground mount rides the entity mirror (mountKey,
  // synced over the wire like skin), so the online self-extrapolator predicts
  // mounted speed in lockstep with the server. Additive with buff_speed like
  // the Fiesta augment below; slows still bite multiplicatively.
  if (e.mountKey) speed += mountMoveSpeedPct(e.mountKey);
  // Fiesta move-speed augments (only ever non-zero inside a Fiesta bout).
  if (extraSpeedPct) speed += extraSpeedPct;
  return slow * speed;
}

// Fiesta "Moon Boots" power-up: a buff_jump aura multiplies jump height.
export function jumpMult(e: Entity): number {
  let m = 1;
  for (const a of e.auras) if (a.kind === 'buff_jump') m = Math.max(m, a.value);
  // Mounted riders spring higher (multiplicative with any jump-buff aura), so the
  // show-jumping course reads as hoppable on horseback.
  if (e.mountKey) m *= MOUNT_JUMP_MULT;
  return m;
}

export function isSwimming(e: Entity, seed: number): boolean {
  const ground = groundHeight(e.pos.x, e.pos.z, seed);
  return swimsAt(e.pos.y, ground, waterLevelAt(e.pos.x, e.pos.z, seed));
}

export interface PlayerMotionDeps {
  seed: number;
  /** Fiesta-aware on the live Sim; the pure moveSpeedMult(e, 0) on the client. */
  moveSpeedMult(e: Entity): number;
  /** Swept static collision; the live Sim layers delve module bounds + doors on top. */
  resolveMove(
    fromX: number,
    fromZ: number,
    nx: number,
    nz: number,
    r: number,
    e: Entity,
    ignoreFences: boolean,
  ): { x: number; z: number };
  /** Talent-resolved ability lookup for the cast-while-moving check; null on the client. */
  resolvedAbility(
    abilityId: string,
    pid: number,
  ): { def: { castWhileMoving?: boolean }; castWhileMoving?: boolean } | null;
  cancelCast(p: Entity): void;
  standUp(p: Entity): void;
  /** Fall damage: the one rng-reachable callee. A no-op on the client. */
  dealDamage(
    source: null,
    target: Entity,
    amount: number,
    crit: boolean,
    school: string,
    ability: string | null,
    kind: 'hit',
    noRage: boolean,
  ): void;
}

export function stepPlayerMotion(deps: PlayerMotionDeps, p: Entity, inp: MoveInput): void {
  const stepStartX = p.pos.x;
  const stepStartZ = p.pos.z;
  // Convention: facing f points along (sin f, cos f); the camera sits behind
  // the player, so screen-right is the world vector (-cos f, sin f).
  // Turning right therefore DECREASES facing.
  if (!isStunned(p)) {
    if (inp.turnLeft) p.facing = normAngle(p.facing + TURN_SPEED * DT);
    if (inp.turnRight) p.facing = normAngle(p.facing - TURN_SPEED * DT);
  }

  let mx = 0,
    mz = 0; // local: z forward, x strafe-right
  if (inp.forward) mz += 1;
  if (inp.back) mz -= 1;
  if (inp.strafeLeft) mx -= 1;
  if (inp.strafeRight) mx += 1;

  const wantsMove = mx !== 0 || mz !== 0 || inp.jump;
  if (wantsMove && p.sitting) deps.standUp(p);

  const hasMoveInput = mx !== 0 || mz !== 0;
  // One terrain sample serves both latches for the whole tick.
  const swimGround = groundHeight(p.pos.x, p.pos.z, deps.seed);
  const swimLevel = waterLevelAt(p.pos.x, p.pos.z, deps.seed);
  const swimming = swimsAt(p.pos.y, swimGround, swimLevel);
  const submerged = swimming && p.pos.y < swimLevel - 0.75 - SWIM_SUBMERGE_EPS;
  // Stroke lead-in for the underwater ramp. It banks while submerged (a pause to
  // look around does not cost you the cruise you earned) and only resets when
  // the body surfaces or leaves the water entirely.
  if (submerged) {
    p.swimStroke = Math.min(SWIM_STROKE_PERIOD, p.swimStroke + (hasMoveInput ? DT : 0));
  } else {
    p.swimStroke = 0;
  }
  if (!swimming) p.swimDiving = false;
  // Standing on unwalkably steep ground: no control, no jump, slide downhill.
  // Steepness is of the RIDDEN surface (submerged ground clamps to the
  // waterline), so an uneven lake bed never strips control from a wader and
  // slides it back into deep water.
  //
  // The steepness gate reads a 1-yard-CELL memo (rideSteepnessAt rounds to the
  // cell): a level point one step from a sheer riser inherits the cell's slope
  // and reads steep though the ground under the feet is flat. Stripping control
  // off that alone froze the body against the riser base, input disabled and no
  // downhill to slide off (players stuck all along the Last Keep's west terrace
  // edge). So the control strip also requires an ACTUAL downhill, sampled at the
  // EXACT position (terrainDownhill): genuinely steep ground still strips
  // control and slides, but a flat shoulder the cell memo over-reads keeps
  // control, and the wall/contour gate below still refuses the climb.
  const steepFlagged =
    p.onGround && !swimming && rideSteepnessAt(p.pos.x, p.pos.z, deps.seed) > MAX_CLIMB_SLOPE;
  const steepSlide = steepFlagged ? terrainDownhill(p.pos.x, p.pos.z, deps.seed) : null;
  const steepGround = steepSlide !== null;
  // Move-to-cancel: any movement input during a summon channel cancels the cast.
  // Dismount channels (mountCastKey === '') remain fully rooted (handled by mountLocked below).
  if (p.mountCastRemaining > 0 && p.mountCastKey !== '' && hasMoveInput) {
    p.mountCastRemaining = 0;
    p.mountCastKey = '';
  }
  // Keep the root ONLY during the dismount channel (mountCastKey === '' means dismounting).
  // During a summon channel, movement is allowed (and handled above via move-to-cancel).
  const mountLocked = p.mountCastRemaining > 0 && p.mountCastKey === '';
  const moving = hasMoveInput && !isRooted(p) && !steepGround && !mountLocked;
  let wishX = 0,
    wishZ = 0,
    wishSpeed = 0;
  if (moving) {
    if (p.castingAbility) {
      // A mobile cast (def flag, or talent-granted via the resolved ability)
      // survives its caster's movement; everything else breaks, fishing included.
      // Ice Floes (mage choice row) also protects: while its aura is worn the
      // cast survives, and COMPLETING the hard cast spends one of the aura's
      // protected uses (casting_lifecycle), so moving mid-cast never overspends.
      const casting = deps.resolvedAbility(p.castingAbility, p.id);
      const mobile =
        casting != null &&
        (casting.def.castWhileMoving ||
          casting.castWhileMoving ||
          iceFloesAuraForAbility(p, p.castingAbility) !== undefined ||
          afflictionCanCastWhileMoving(p, p.castingAbility) ||
          p.auras.some((a) => a.kind === 'processional_grace'));
      if (!mobile) deps.cancelCast(p);
    }
    const len = Math.hypot(mx, mz);
    mx /= len;
    mz /= len;
    let speed = RUN_SPEED * deps.moveSpeedMult(p);
    if (mz < 0) speed *= BACKPEDAL_MULT;
    if (swimming) speed *= swimSpeedMult(p.swimStroke, submerged);
    // Shallow water pushes back. Reuses the waterline this tick already
    // sampled, and is inert both on dry ground (no water level there) and while
    // swimming (the stroke multiplier above owns that speed).
    else if (p.onGround) speed *= wadeSpeedMult(swimLevel - p.pos.y);
    // world = forward * mz + right * mx, with right = (-cos f, sin f)
    const sin = Math.sin(p.facing),
      cos = Math.cos(p.facing);
    const wx = mz * sin - mx * cos;
    const wz = mz * cos + mx * sin;
    wishX = wx;
    wishZ = wz;
    wishSpeed = speed;
  }

  const movingOnGround = moving && (p.onGround || swimming);
  // Air control: held keys steer the airborne velocity toward the wish vector.
  // Also what lets a jump STARTED in place drift forward, and a fall off a
  // ledge stay steerable, instead of the old frozen-at-takeoff trajectory.
  const airSteering = moving && !p.onGround && !swimming;
  const slide = steepSlide;
  if (slide || movingOnGround || airSteering || (!p.onGround && (p.vx !== 0 || p.vz !== 0))) {
    if (slide && p.castingAbility) deps.cancelCast(p);
    if (airSteering) {
      // Steer the air velocity toward the wish vector, limited as a VECTOR
      // rather than per axis: a per-axis clamp is anisotropic (diagonal
      // steering gets root-two more authority) and, because the result only
      // has to land inside the box spanned by the old and wanted velocities,
      // a spinning wish vector can walk the SPEED up. Measured at about 3
      // percent above run speed by spinning the camera mid-air, which is the
      // classic air-strafe exploit in miniature.
      const accel = AIR_CONTROL_ACCEL * DT;
      let dvx = wishX * wishSpeed - p.vx;
      let dvz = wishZ * wishSpeed - p.vz;
      const dLen = Math.hypot(dvx, dvz);
      if (dLen > accel) {
        const k = accel / dLen;
        dvx *= k;
        dvz *= k;
      }
      const before = Math.hypot(p.vx, p.vz);
      p.vx += dvx;
      p.vz += dvz;
      // Steering redirects momentum, it never adds any. The cap keeps whatever
      // speed the body already carried (a knockback or a charge stays fast) and
      // forbids growing past it or past the wish speed.
      const after = Math.hypot(p.vx, p.vz);
      const cap = Math.max(wishSpeed, before);
      if (after > cap && after > 1e-9) {
        const k = cap / after;
        p.vx *= k;
        p.vz *= k;
      }
    }
    const stepX = slide ? slide.x * STEEP_SLIDE_SPEED : movingOnGround ? wishX * wishSpeed : p.vx;
    const stepZ = slide ? slide.z * STEEP_SLIDE_SPEED : movingOnGround ? wishZ * wishSpeed : p.vz;
    // Slide along buildings, trees, crypt walls; but while airborne from a
    // jump, pass through fences for the whole arc. Keying off the jump itself
    // (not a height threshold) makes this independent of slope: an uphill
    // approach no longer flickers the clearance off right at the rail.
    const clearFences = !p.onGround && p.jumping;
    if (!isInstancedRegion(p.pos.x)) {
      // OPEN WORLD: the character physics solver. Swept collision with
      // multi-plane sliding, depenetration, the terrain wall/contour gate,
      // and step-up, so a walking body climbs low stones and kerbs without a
      // jump instead of stopping dead against them.
      moveParams.seed = deps.seed;
      moveParams.radius = BODY_RADIUS;
      moveParams.stepHeight = MAX_STEP_HEIGHT;
      moveParams.maxSlope = MAX_CLIMB_SLOPE;
      moveParams.grounded = p.onGround && !swimming;
      moveParams.swimming = swimming;
      moveParams.ignoreFences = clearFences;
      moveCharacter(moveParams, p.pos.x, p.pos.y, p.pos.z, stepX * DT, stepZ * DT, moveOut);
      // While mounted the deep-water line is a wall: a ground mount will not
      // step off dry land into swimming depth. Wading stays allowed (the gate
      // keys on swim depth, not water presence), and a player who is ALREADY
      // swimming is force-dismounted by updateMountTransition, so this only
      // bites the entry from land. Applied to the solver's RESULT (it owns
      // slide and step-up), so the body stops at the shore instead of clipping
      // into the water; horizontal velocity dies with it while airborne,
      // matching the steep-wall airborne gate.
      const mountBlockedByWater =
        !!p.mountKey && !swimming && isDeepFor(moveOut.x, moveOut.z, deps.seed);
      if (mountBlockedByWater) {
        if (!p.onGround) {
          p.vx = 0;
          p.vz = 0;
        }
      } else {
        p.pos.x = moveOut.x;
        p.pos.z = moveOut.z;
      }
      // A step-up raises the feet; the vertical pass below then finds this
      // same surface as the floor and keeps the body settled on it.
      if (!mountBlockedByWater && moveOut.stepped > 0) p.pos.y = moveOut.y;
      if (!p.onGround && moveOut.blocked && !mountBlockedByWater) {
        p.vx = (p.pos.x - p.prevPos.x) / DT;
        p.vz = (p.pos.z - p.prevPos.z) / DT;
      }
    } else {
      stepInstancedRegion(deps, p, stepX, stepZ, swimming, clearFences);
    }
  }

  verticalPass(deps, p, inp, wishX, wishZ, wishSpeed, swimming, steepGround, mountLocked);
  standoffPass(deps, p, stepStartX, stepStartZ, wishX, wishZ, wishSpeed, movingOnGround);
}

// Instanced interiors (dungeons, delves, arena, the Yumi maze): flat floors
// walled by full-height layouts, where step-up has nothing to act on and the
// delve module bounds/doors must still clamp. Unchanged from the pre-physics
// kernel on purpose, so every interior test stays byte-identical.
function stepInstancedRegion(
  deps: PlayerMotionDeps,
  p: Entity,
  stepX: number,
  stepZ: number,
  swimming: boolean,
  clearFences: boolean,
): void {
  let nx = p.pos.x + stepX * DT;
  let nz = p.pos.z + stepZ * DT;
  {
    // cliffs, steep mountainsides, and the world rim are walls, not ramps:
    // an uphill step is blocked when the step itself is too steep OR when it
    // lands on ground whose true gradient is unwalkable (so approaching at an
    // angle cannot cheat the limit). Heights and gradients are of the RIDDEN
    // surface (ride_height.ts: submerged ground clamps to the waterline), so a
    // bumpy lake bed is never a wall and the climb out of water measures the
    // real waterline-to-bank rise; a too-steep bank still yields to the shore
    // step-out onto a low standable lip. (Off-world this branch only ever runs
    // in an instanced interior, where waterLevelAt is -Infinity and the ridden
    // surface IS the terrain; the open world runs the physics kernel.)
    // A rise within MAX_STEP_HEIGHT is a STRIDE, never a wall: the only
    // interior elevation is the boss dais, a single discrete plateau, so the
    // step allowance cannot ladder the way a per-tick allowance on continuous
    // terrain would (the open-world kerb rule, applied to the one kerb
    // interiors have).
    if (p.onGround && !swimming) {
      // ride heights clamp to the STEP's waterline (the higher of both ends'),
      // so stepping back into a water body from the submerged bed just outside
      // its footprint is never a wall (real water can continue past a
      // footprint edge into the open sea)
      const wls = stepWaterLevel(p.pos.x, p.pos.z, nx, nz, deps.seed);
      const g1 = groundHeight(nx, nz, deps.seed);
      const r0 = Math.max(groundHeight(p.pos.x, p.pos.z, deps.seed), wls);
      const r1 = Math.max(g1, wls);
      const run = Math.hypot(nx - p.pos.x, nz - p.pos.z);
      if (
        r1 > r0 &&
        r1 - r0 > MAX_STEP_HEIGHT &&
        run > 1e-5 &&
        ((r1 - r0) / run > MAX_CLIMB_SLOPE ||
          (g1 >= wls && rideSteepnessAt(nx, nz, deps.seed) > MAX_CLIMB_SLOPE)) &&
        !shoreStepOut(p.pos.x, p.pos.z, nx, nz, deps.seed, MAX_CLIMB_SLOPE)
      ) {
        nx = p.pos.x;
        nz = p.pos.z;
      }
    } else if (!p.onGround) {
      // Airborne, the same wall rule applies: terrain rising above the body
      // that could not be walked up cannot be jumped into either. The player
      // drops at the base of the face instead of beaching partway up it. The
      // shore step-out also applies, so the swim-surface hop can land on the
      // same low banks a wading step can reach.
      // The mantle allowance mirrors the open world: a floor no higher than
      // the feet plus MANTLE_REACH is something the arc carries onto (the
      // dais rim), not a face to bounce off.
      const h1 = groundHeight(nx, nz, deps.seed);
      if (h1 > p.pos.y + MANTLE_REACH) {
        const wls = stepWaterLevel(p.pos.x, p.pos.z, nx, nz, deps.seed);
        const r0 = Math.max(groundHeight(p.pos.x, p.pos.z, deps.seed), wls);
        const r1 = Math.max(h1, wls);
        const run = Math.hypot(nx - p.pos.x, nz - p.pos.z);
        if (
          r1 > r0 &&
          run > 1e-5 &&
          ((r1 - r0) / run > MAX_CLIMB_SLOPE ||
            (h1 >= wls && rideSteepnessAt(nx, nz, deps.seed) > MAX_CLIMB_SLOPE)) &&
          !shoreStepOut(p.pos.x, p.pos.z, nx, nz, deps.seed, MAX_CLIMB_SLOPE)
        ) {
          nx = p.pos.x;
          nz = p.pos.z;
          p.vx = 0;
          p.vz = 0;
        }
      }
    }
    // While mounted the deep-water line is a wall: a ground mount will not step
    // off dry land into swimming depth. Wading stays allowed (the gate keys on
    // swim depth, not water presence), and a player who is ALREADY swimming is
    // force-dismounted by updateMountTransition, so this only bites the entry
    // from land. Reset the candidate to the current pose (and kill horizontal
    // velocity when airborne, matching the steep-wall airborne gate) so the body
    // stops at the shore instead of clipping into the water.
    if (p.mountKey && !swimming && isDeepFor(nx, nz, deps.seed)) {
      nx = p.pos.x;
      nz = p.pos.z;
      if (!p.onGround) {
        p.vx = 0;
        p.vz = 0;
      }
    }
    const resolved = deps.resolveMove(p.pos.x, p.pos.z, nx, nz, BODY_RADIUS, p, clearFences);
    p.pos.x = resolved.x;
    p.pos.z = resolved.z;
    if (!p.onGround && (resolved.x !== nx || resolved.z !== nz)) {
      p.vx = (resolved.x - p.prevPos.x) / DT;
      p.vz = (resolved.z - p.prevPos.z) / DT;
    }
  }
}

// The vertical state machine: swim tread, jump (with the coyote window),
// gravity, landing and fall damage, and the walkable step-down that keeps a
// body glued to the surface instead of bouncing airborne off every kerb.
function verticalPass(
  deps: PlayerMotionDeps,
  p: Entity,
  inp: MoveInput,
  wishX: number,
  wishZ: number,
  wishSpeed: number,
  swimming: boolean,
  steepGround: boolean,
  // A dismount channel roots the rider outright, so it gates every jump arm
  // here as well as the horizontal wish above (one rule, threaded rather than
  // recomputed, so the two can never drift).
  mountLocked: boolean,
): void {
  const ground = groundHeight(p.pos.x, p.pos.z, deps.seed);
  // The surface the body rests on: the terrain, or a standable prop top
  // (crate, rock) under the feet. Grounded the query is exact (a taller prop
  // beside the body never lifts it); airborne it reaches MANTLE_REACH above
  // the feet, so a jump that carries the body over a rim seats on the top:
  // the mantle. Away from props this IS the terrain height.
  const support = floorHeightAt(
    deps.seed,
    p.pos.x,
    p.pos.z,
    BODY_RADIUS,
    p.pos.y + (p.onGround ? 0 : MANTLE_REACH),
  );
  // `ground` is already sampled above: reuse it rather than paying for the
  // terrain again on every vertical step.
  const waterHere = waterLevelAt(p.pos.x, p.pos.z, deps.seed);
  const deepWater = ground < waterHere - SWIM_DEPTH;
  if (deepWater && p.pos.y <= waterHere - 0.75 + 0.05) {
    swimVerticalPass(p, inp, wishX, wishZ, wishSpeed, mountLocked, ground, waterHere);
    return;
  }
  // Coyote window: within COYOTE_TIME of WALKING off a ledge (vy starts at 0
  // there and only gravity has touched it since; a jump sets `jumping`), the
  // jump still fires, so running off a crate or a bank never eats the input.
  // Denied while the body hangs over unwalkably steep terrain: a steep-slide
  // carrying the player off a cliff lip must stay the uncontrollable drop the
  // grounded steepGround gate enforces, not become a steerable mid-air jump.
  const coyote =
    !p.onGround &&
    !p.jumping &&
    !swimming &&
    p.vy <= 0 &&
    p.vy > -GRAVITY * COYOTE_TIME &&
    terrainSteepnessAt(p.pos.x, p.pos.z, deps.seed) <= MAX_CLIMB_SLOPE;
  if (inp.jump && (p.onGround || coyote) && !isRooted(p) && !steepGround && !mountLocked) {
    p.vy = JUMP_VELOCITY * jumpMult(p);
    p.vx = wishX * wishSpeed;
    p.vz = wishZ * wishSpeed;
    p.onGround = false;
    p.jumping = true;
    p.fallStartY = p.pos.y;
  }
  if (!p.onGround) {
    p.vy -= GRAVITY * DT;
    p.pos.y += p.vy * DT;
    p.fallStartY = Math.max(p.fallStartY, p.pos.y);
    if (deepWater && p.pos.y <= waterHere - 0.75) {
      // Splashing into deep water breaks the fall — and the harder the hit,
      // the deeper the body drives under before buoyancy lifts it back
      // (swimVerticalPass floats a non-diving body at SWIM_ASCEND_RATE).
      // A hop's landing speed (JUMP_VELOCITY) plunges nothing, so stepping
      // off a bank into a lake still just settles at the seat; a flail-height
      // fall drives a couple of yards under. The floor clamp keeps a plunge
      // in a barely-deep-enough pool off the bed.
      const impact = -p.vy;
      const plunge = Math.min(
        SWIM_PLUNGE_MAX,
        Math.max(0, (impact - JUMP_VELOCITY) * SWIM_PLUNGE_PER_SPEED),
      );
      const plungeFloor = Math.min(waterHere - 0.75, ground + SWIM_FLOOR_CLEARANCE);
      p.pos.y = Math.max(plungeFloor, waterHere - 0.75 - plunge);
      p.vy = 0;
      p.vx = 0;
      p.vz = 0;
      p.onGround = true;
      p.jumping = false;
      p.fallStartY = p.pos.y;
      return;
    }
    if (p.pos.y <= support) {
      // Landing surface: the terrain, or a standable prop top the body is
      // over. When the support sits ABOVE the feet (within MANTLE_REACH,
      // gated by the query above) this snap-up IS the mantle: the body hoists
      // onto the crate/rock rim it jumped at.
      p.pos.y = support;
      p.vy = 0;
      p.vx = 0;
      p.vz = 0;
      p.onGround = true;
      p.jumping = false;
      const drop = p.fallStartY - support;
      if (drop > FALL_SAFE_DISTANCE) {
        const dmg = Math.round(p.maxHp * (drop - FALL_SAFE_DISTANCE) * 0.07);
        if (dmg > 0) deps.dealDamage(null, p, dmg, false, 'physical', 'Falling', 'hit', true);
      }
      p.fallStartY = support;
    }
  } else {
    // Distinguish a walkable downhill slope from a genuine cliff/ledge. The
    // drop the surface can take in one tick scales with how far we moved: a
    // slope no steeper than MAX_CLIMB_SLOPE (the same gate that blocks uphill
    // climbs) is walkable, so we snap down to follow it instead of falling.
    // Only a steeper-than-walkable drop counts as walking off a ledge. The
    // 0.4 base keeps a near-stationary player snapped over tiny terrain noise.
    // The step height floors it: a body that strides UP a kerb must be able to
    // walk back DOWN one without launching into a fall (the classic stair
    // stutter), so descent and ascent share the same reach.
    const run = Math.hypot(p.pos.x - p.prevPos.x, p.pos.z - p.prevPos.z);
    const maxStepDown = Math.max(MAX_STEP_HEIGHT, 0.4 + run * MAX_CLIMB_SLOPE);
    // The slope glue comes FIRST, before either step-down or walk-off: it
    // re-samples exactly the surface the body stood on at its previous
    // position, at full body-radius reach. That covers two cases the strict
    // support query (capped at the feet, the anti-levitation rule) cannot:
    // walking UPHILL on a pitched top (a roof gable, a coffin lid), and
    // walking OFF any top's edge, where the body stays on the surface while
    // any of its disc still covers it. The second half is load-bearing for
    // honesty: dropping the body the moment strict support ends would seat
    // it still overlapping the prop's face, and the following depenetration
    // would convert that overlap into free forward distance every crossing
    // (the kerb speed exploit tests/parkour.test.ts pins away).
    const glue = slopeGlueHeight(
      deps.seed,
      p.prevPos.x,
      p.prevPos.z,
      p.pos.x,
      p.pos.z,
      BODY_RADIUS,
      p.pos.y,
    );
    if (glue > -Infinity && Math.abs(glue - p.pos.y) <= MAX_STEP_HEIGHT) {
      p.pos.y = glue;
      p.fallStartY = glue;
      return;
    }
    if (support < p.pos.y - maxStepDown) {
      // Walked off a ledge or a prop top (not a jump), so fences still block.
      // Momentum carries: the horizontal velocity this tick keeps driving the
      // fall (steerable via air control) instead of dropping dead straight.
      p.onGround = false;
      p.jumping = false;
      p.vx = (p.pos.x - p.prevPos.x) / DT;
      p.vz = (p.pos.z - p.prevPos.z) / DT;
      p.vy = 0;
      p.fallStartY = p.pos.y;
    } else {
      p.pos.y = support;
      p.fallStartY = support;
    }
  }
}

// The vertical half of swimming: hold depth, dive, ascend, or hop out onto a
// bank. The water carries the body, so this branch owns Y outright — no gravity,
// no fall damage, and `onGround` stays true (the body is supported, just not by
// terrain), which is what keeps the jump pose and landing thud off a swimmer.
//
// Buoyancy keys off INTENT, not depth. A body that chose to be down here (the
// dive input has been held since it entered the water — `swimDiving`) is
// neutrally buoyant, so exploring a lake bed is not a key you have to keep
// held. A body that did NOT choose it — teleported in, knocked in, spawned in —
// rides straight back up to the line, which is the rule the rest of the game
// leans on: nothing ever ends up parked on a lake bed. Surfacing is always one
// held jump away either way, and the descent is floored a fixed clearance above
// the bed so a diver never sinks into terrain.
function swimVerticalPass(
  p: Entity,
  inp: MoveInput,
  wishX: number,
  wishZ: number,
  wishSpeed: number,
  mountLocked: boolean,
  ground: number,
  waterHere: number,
): void {
  const surface = waterHere - 0.75;
  // Never let the clamp push the body UP into the surface in water too shallow
  // to dive in: there, the floor and the ceiling are the same line.
  const floor = Math.min(surface, ground + SWIM_FLOOR_CLEARANCE);
  const controllable = !isRooted(p) && !mountLocked;
  p.vx = 0;
  p.vz = 0;
  p.vy = 0;
  p.onGround = true;
  p.jumping = false;

  // How hard the camera is aimed into it. The keys and every hand-built
  // MoveInput read as full rate, so only a graded camera steer is ever slower.
  const steer = swimSteerRate(inp.swimSteer);

  if (inp.jump && controllable && p.pos.y >= surface - 1e-3) {
    // At the line already: the small hop that climbs onto shores and docks.
    p.vy = JUMP_VELOCITY * 0.7 * jumpMult(p);
    p.vx = wishX * wishSpeed;
    p.vz = wishZ * wishSpeed;
    p.onGround = false;
    p.jumping = true;
  } else if (inp.jump && controllable) {
    // JUMP outranks dive. `dive` is a latched camera BAND as well as a key,
    // and a swimmer naturally looks down at where they are going — with dive
    // ranked first, the space bar silently did nothing whenever the camera
    // was pitched past the dive line, which read as "the controls stopped
    // working". An explicit jump press is always deliberate: it climbs at the
    // full rate, whatever the camera or a simultaneously-held Ctrl says, and
    // it also ends the dive so the body keeps floating on release.
    p.swimDiving = false;
    p.pos.y = Math.min(surface, p.pos.y + SWIM_ASCEND_RATE * DT);
  } else if (inp.dive && controllable) {
    // ...but dive still wins over `surface` (the look-up camera): the key is
    // explicit, the camera band is passive.
    p.swimDiving = true;
    p.pos.y = Math.max(floor, p.pos.y - SWIM_DIVE_RATE * steer * DT);
  } else if (inp.surface && controllable) {
    // Rise on the look-up camera. Deliberately NOT the hop branch above:
    // holding the view up while already floating must leave you floating,
    // not fling you out of the water once a second. Camera input is steered.
    p.pos.y = Math.min(surface, p.pos.y + SWIM_ASCEND_RATE * steer * DT);
  } else if (p.swimDiving) {
    // Neutral buoyancy, but only for a body that DOVE here: hold this depth so
    // exploring a lake bed is not a key you have to keep held. The floor clamp
    // also lifts a swimmer who drifted over rising ground.
    p.pos.y = Math.min(surface, Math.max(floor, p.pos.y));
  } else {
    // Never dove (teleported in, knocked in, plunged in from a fall): the
    // water carries the body up to the line — at the real ascend rate rather
    // than a snap, so a plunge entry visibly bobs back to the surface. The
    // long-standing rule still holds: nothing ever ends up parked on a lake
    // bed, it just takes the float a beat to get there.
    p.pos.y = Math.min(surface, p.pos.y + SWIM_ASCEND_RATE * DT);
  }
  // Reaching the line ends the dive: the next release of the controls floats.
  if (p.pos.y >= surface - 1e-6) p.swimDiving = false;
  p.fallStartY = p.pos.y;
}

// Ease the body off any terrain wall it now overlaps. The slope gates above
// block the CENTER from climbing a wall, but nothing keeps the body's WIDTH
// clear of one, so standing at (or strafing along) a wall foot buries the near
// side of the model. Only on settled ground (a fall/ledge is resolved above),
// never while standing on a prop top (the standoff reseats onto TERRAIN
// height, which would yank the body off its crate/rock), and never onto
// ground steeper than the climb limit (a rare terrace corner: a tick's clip
// beats being shoved onto a wall). Lives in the kernel so the server Sim and
// the client self-predictor apply it identically; no-op on open ground and
// on flat instanced floors. Skipped whenever the feet are under a waterline
// (not just while swimming): the ridden surface is flat there, so a submerged
// bed bump must not shove the body around or fight a shore exit. The
// acceptance gate below can still commit a push onto ground steeper than the
// climb limit when it strictly improves on the player's current steepness, so
// a concave wall pocket converges instead of wedging the player forever.
function standoffPass(
  deps: PlayerMotionDeps,
  p: Entity,
  stepStartX: number,
  stepStartZ: number,
  wishX: number,
  wishZ: number,
  wishSpeed: number,
  movingOnGround: boolean,
): void {
  const ground = groundHeight(p.pos.x, p.pos.z, deps.seed);
  if (p.onGround && p.pos.y <= ground + 1e-3 && !isSubmergedAt(p.pos.x, p.pos.z, deps.seed)) {
    const s = terrainWallStandoff(p.pos.x, p.pos.z, deps.seed, BODY_RADIUS, MAX_CLIMB_SLOPE);
    if (s.x !== p.pos.x || s.z !== p.pos.z) {
      const resolved = deps.resolveMove(p.pos.x, p.pos.z, s.x, s.z, BODY_RADIUS, p, false);
      let standX = resolved.x;
      let standZ = resolved.z;
      if (movingOnGround && wishSpeed > 0) {
        const startStand = terrainWallStandoff(
          stepStartX,
          stepStartZ,
          deps.seed,
          BODY_RADIUS,
          MAX_CLIMB_SLOPE,
        );
        const alreadyClear =
          Math.hypot(startStand.x - stepStartX, startStand.z - stepStartZ) < 1e-4;
        const netX = standX - stepStartX;
        const netZ = standZ - stepStartZ;
        const progress = netX * wishX + netZ * wishZ;
        if (alreadyClear && progress < -1e-6) {
          const slideX = standX - wishX * progress;
          const slideZ = standZ - wishZ * progress;
          const slide = deps.resolveMove(
            stepStartX,
            stepStartZ,
            slideX,
            slideZ,
            BODY_RADIUS,
            p,
            false,
          );
          standX = slide.x;
          standZ = slide.z;
        }
      }
      // Commit the nudge once it clears the climb limit outright, OR once it
      // is no steeper than the current spot (<=, not <). A single tick's
      // push is not always enough to escape a concave wall pocket (a notch
      // where two faces meet, e.g. a coastline cliff cove or a ridge/rim
      // corner); requiring full clearance in one shot silently discards
      // every partial improvement, so the position never changes and the
      // player is frozen there forever (this tick's push is recomputed from
      // the SAME unmoved spot next tick too). Accepting any non-worsening
      // push instead lets each of the sim's 20 ticks/sec inch the player
      // further from the wall, guaranteeing eventual escape instead of a
      // permanent wedge. The compare is deliberately <=, not <: the dry-land
      // steepness view rounds to 1-yard cells and a single pass moves at
      // most one body radius (0.5yd), so a push often lands back in the same
      // steepness cell it started in, reading exactly equal. Tightening to <
      // would make that equal-cell case stop committing, which is precisely
      // the wedge case this gate exists to fix. Steepness is of the RIDDEN
      // surface (ride_height.ts): on dry ground it is exactly the memoized
      // terrain view this comment describes, and a nudge toward water never
      // reads a submerged bed bump as a wall.
      const standSteep = rideSteepnessAt(standX, standZ, deps.seed);
      if (
        standSteep <= MAX_CLIMB_SLOPE ||
        standSteep <= rideSteepnessAt(p.pos.x, p.pos.z, deps.seed)
      ) {
        p.pos.x = standX;
        p.pos.z = standZ;
        p.pos.y = groundHeight(standX, standZ, deps.seed);
      }
    }
  }
}
