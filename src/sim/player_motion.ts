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

import { isRooted, isStunned } from './combat/cc';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from './pathfind';
import { GHOST_RUN_MULT } from './spirit';
import { DT, type Entity, type MoveInput, normAngle, RUN_SPEED, TURN_SPEED } from './types';
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
// Re-exported by sim.ts for social/chat_readouts.ts (the /falling readout shares
// the landing-damage threshold with the fall-damage model below).
export const FALL_SAFE_DISTANCE = 12; // yards of free fall before damage
export const STEEP_SLIDE_SPEED = RUN_SPEED; // yd/s a player skids downhill off unwalkable ground
export const SWIM_SPEED_MULT = 0.65;
// Body bobs just below the water line at this location (terrain/feature-aware:
// -Infinity outside a declared lake, so this is never called off a waterline
// that doesn't exist there).
export function swimSurfaceY(x: number, z: number): number {
  return waterLevelAt(x, z) - 0.75;
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
  for (const a of e.auras) {
    if (a.kind === 'slow' || a.kind === 'stealth') slow = Math.min(slow, a.value);
    // buff_speed and form_travel both carry a 1+fraction multiplier (1.4 = +40%).
    if (a.kind === 'buff_speed' || a.kind === 'form_travel') speed = Math.max(speed, a.value);
  }
  // Fiesta move-speed augments (only ever non-zero inside a Fiesta bout).
  if (extraSpeedPct) speed += extraSpeedPct;
  return slow * speed;
}

// Fiesta "Moon Boots" power-up: a buff_jump aura multiplies jump height.
export function jumpMult(e: Entity): number {
  let m = 1;
  for (const a of e.auras) if (a.kind === 'buff_jump') m = Math.max(m, a.value);
  return m;
}

export function isSwimming(e: Entity, seed: number): boolean {
  return (
    groundHeight(e.pos.x, e.pos.z, seed) < waterLevelAt(e.pos.x, e.pos.z) - SWIM_DEPTH &&
    e.pos.y <= swimSurfaceY(e.pos.x, e.pos.z) + 0.15
  );
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
  const swimming = isSwimming(p, deps.seed);
  // Standing on unwalkably steep ground: no control, no jump, slide downhill.
  const steepGround =
    p.onGround && !swimming && terrainSteepnessAt(p.pos.x, p.pos.z, deps.seed) > MAX_CLIMB_SLOPE;
  const moving = hasMoveInput && !isRooted(p) && !steepGround;
  let wishX = 0,
    wishZ = 0,
    wishSpeed = 0;
  if (moving) {
    if (p.castingAbility) {
      // A mobile cast (def flag, or talent-granted via the resolved ability)
      // survives its caster's movement; everything else breaks, fishing included.
      const casting = deps.resolvedAbility(p.castingAbility, p.id);
      const mobile = casting != null && (casting.def.castWhileMoving || casting.castWhileMoving);
      if (!mobile) deps.cancelCast(p);
    }
    const len = Math.hypot(mx, mz);
    mx /= len;
    mz /= len;
    let speed = RUN_SPEED * deps.moveSpeedMult(p);
    if (mz < 0) speed *= BACKPEDAL_MULT;
    if (swimming) speed *= SWIM_SPEED_MULT;
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
  const slide = steepGround ? terrainDownhill(p.pos.x, p.pos.z, deps.seed) : null;
  if (slide || movingOnGround || (!p.onGround && (p.vx !== 0 || p.vz !== 0))) {
    if (slide && p.castingAbility) deps.cancelCast(p);
    const stepX = slide ? slide.x * STEEP_SLIDE_SPEED : movingOnGround ? wishX * wishSpeed : p.vx;
    const stepZ = slide ? slide.z * STEEP_SLIDE_SPEED : movingOnGround ? wishZ * wishSpeed : p.vz;
    let nx = p.pos.x + stepX * DT;
    let nz = p.pos.z + stepZ * DT;
    // cliffs, steep mountainsides, and the world rim are walls, not ramps:
    // an uphill step is blocked when the step itself is too steep OR when it
    // lands on ground whose true gradient is unwalkable (so approaching at an
    // angle cannot cheat the limit)
    if (p.onGround && !swimming) {
      const h0 = groundHeight(p.pos.x, p.pos.z, deps.seed);
      const h1 = groundHeight(nx, nz, deps.seed);
      const run = Math.hypot(nx - p.pos.x, nz - p.pos.z);
      if (
        h1 > h0 &&
        run > 1e-5 &&
        ((h1 - h0) / run > MAX_CLIMB_SLOPE ||
          terrainSteepnessAt(nx, nz, deps.seed) > MAX_CLIMB_SLOPE)
      ) {
        nx = p.pos.x;
        nz = p.pos.z;
      }
    } else if (!p.onGround) {
      // Airborne, the same wall rule applies: terrain rising above the body
      // that could not be walked up cannot be jumped into either. The player
      // drops at the base of the face instead of beaching partway up it.
      const h1 = groundHeight(nx, nz, deps.seed);
      if (h1 > p.pos.y) {
        const h0 = groundHeight(p.pos.x, p.pos.z, deps.seed);
        const run = Math.hypot(nx - p.pos.x, nz - p.pos.z);
        if (
          h1 > h0 &&
          run > 1e-5 &&
          ((h1 - h0) / run > MAX_CLIMB_SLOPE ||
            terrainSteepnessAt(nx, nz, deps.seed) > MAX_CLIMB_SLOPE)
        ) {
          nx = p.pos.x;
          nz = p.pos.z;
          p.vx = 0;
          p.vz = 0;
        }
      }
    }
    // Slide along buildings, trees, crypt walls; but while airborne from a
    // jump, pass through fences for the whole arc. Keying off the jump itself
    // (not a height threshold) makes this independent of slope: an uphill
    // approach no longer flickers the clearance off right at the rail.
    const clearFences = !p.onGround && p.jumping;
    const resolved = deps.resolveMove(p.pos.x, p.pos.z, nx, nz, BODY_RADIUS, p, clearFences);
    p.pos.x = resolved.x;
    p.pos.z = resolved.z;
    if (!p.onGround && (resolved.x !== nx || resolved.z !== nz)) {
      p.vx = (resolved.x - p.prevPos.x) / DT;
      p.vz = (resolved.z - p.prevPos.z) / DT;
    }
  }

  // Vertical: jumping, gravity, swimming, fall damage
  const ground = groundHeight(p.pos.x, p.pos.z, deps.seed);
  const deepWater = ground < waterLevelAt(p.pos.x, p.pos.z) - SWIM_DEPTH;
  if (deepWater && p.pos.y <= swimSurfaceY(p.pos.x, p.pos.z) + 0.05) {
    // treading water at the surface
    p.pos.y = swimSurfaceY(p.pos.x, p.pos.z);
    p.vy = 0;
    p.vx = 0;
    p.vz = 0;
    p.onGround = true;
    p.jumping = false;
    p.fallStartY = p.pos.y;
    if (inp.jump && !isRooted(p)) {
      // small hop to climb onto shores and docks
      p.vy = JUMP_VELOCITY * 0.7 * jumpMult(p);
      p.vx = wishX * wishSpeed;
      p.vz = wishZ * wishSpeed;
      p.onGround = false;
      p.jumping = true;
    }
    return;
  }
  if (inp.jump && p.onGround && !isRooted(p) && !steepGround) {
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
    if (deepWater && p.pos.y <= swimSurfaceY(p.pos.x, p.pos.z)) {
      // splashing into deep water breaks the fall
      p.pos.y = swimSurfaceY(p.pos.x, p.pos.z);
      p.vy = 0;
      p.vx = 0;
      p.vz = 0;
      p.onGround = true;
      p.jumping = false;
      p.fallStartY = p.pos.y;
      return;
    }
    if (p.pos.y <= ground) {
      p.pos.y = ground;
      p.vy = 0;
      p.vx = 0;
      p.vz = 0;
      p.onGround = true;
      p.jumping = false;
      const drop = p.fallStartY - ground;
      if (drop > FALL_SAFE_DISTANCE) {
        const dmg = Math.round(p.maxHp * (drop - FALL_SAFE_DISTANCE) * 0.07);
        if (dmg > 0) deps.dealDamage(null, p, dmg, false, 'physical', 'Falling', 'hit', true);
      }
      p.fallStartY = ground;
    }
  } else {
    // Distinguish a walkable downhill slope from a genuine cliff/ledge. The
    // drop the ground can take in one tick scales with how far we moved: a
    // slope no steeper than MAX_CLIMB_SLOPE (the same gate that blocks uphill
    // climbs) is walkable, so we snap down to follow it instead of falling.
    // Only a steeper-than-walkable drop counts as walking off a ledge. The
    // 0.4 base keeps a near-stationary player snapped over tiny terrain noise.
    const run = Math.hypot(p.pos.x - p.prevPos.x, p.pos.z - p.prevPos.z);
    const maxStepDown = 0.4 + run * MAX_CLIMB_SLOPE;
    if (ground < p.pos.y - maxStepDown) {
      // walked off a ledge (not a jump), so fences still block
      p.onGround = false;
      p.jumping = false;
      p.vx = 0;
      p.vz = 0;
      p.vy = 0;
      p.fallStartY = p.pos.y;
    } else {
      p.pos.y = ground;
      p.fallStartY = ground;
    }
  }

  // Ease the body off any terrain wall it now overlaps. The slope gates above
  // block the CENTER from climbing a wall, but nothing keeps the body's WIDTH
  // clear of one, so standing at (or strafing along) a wall foot buries the near
  // side of the model. Only on settled ground (a fall/ledge is resolved above),
  // and never onto ground steeper than the climb limit (a rare terrace corner:
  // a tick's clip beats being shoved onto a wall). Lives in the kernel so the
  // server Sim and the client self-predictor apply it identically; no-op on open
  // ground and on flat instanced floors.
  if (p.onGround && !isSwimming(p, deps.seed)) {
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
      if (terrainSteepnessAt(standX, standZ, deps.seed) <= MAX_CLIMB_SLOPE) {
        p.pos.x = standX;
        p.pos.z = standZ;
        p.pos.y = groundHeight(standX, standZ, deps.seed);
      }
    }
  }
}
