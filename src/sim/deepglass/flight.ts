// Flooded flight: the three-axis thrustpack movement inside the bell.
//
// Modelled directly on swimVerticalPass (src/sim/player_motion.ts): the water
// carries the body, so this pass owns X, Y and Z outright — no gravity, no fall
// damage, and `onGround` stays true (the body is supported, just not by
// terrain), which is what keeps the jump pose and the landing thud off a
// swimmer and now off a flier.
//
// The control scheme, and it is worth reading before any of the numbers:
//
//   - WASD rides the LOOK frame — the entity's facing, pitched by the camera's
//     own pitch (`MoveInput.aimPitch`). You fly where you look, and a Shot leaves
//     down the same vector (match.ts aimOf), so the two can never disagree.
//   - SPACE and CTRL are ABSOLUTE vertical trim, deliberately outside the look
//     frame: holding a height while you aim somewhere else is what makes lining a
//     shot up possible at all.
//   - F is the throttle, and F ON ITS OWN thrusts along the look, because a
//     throttle that needs a second key held is not a throttle.
//   - A LEFT CLICK is a dash (see DG_DASH_SPEED) along whatever the keys are
//     asking for in the look frame, or straight down the look with the hands
//     off; the back key with nothing else is an air brake (DG_BRAKE).
//
// The first pass had none of that: `dive` / `surface` are LATCHED swim bands — a
// three-position switch — so the thrust was flat wherever the view pointed and a
// ring above you was unreachable except by holding SPACE and hoping.

import { DT, type Entity, type MoveInput } from '../types';
import { DG_BODY_CENTRE_Y } from './ball';
import { clampToBell, DEEPGLASS_CENTER, type Vec3 } from './layout';

// ---------------------------------------------------------------------------
// Tuning (yards / seconds). See the PRD's flight table.
// ---------------------------------------------------------------------------
// Rocket League's proportions, scaled to the bell: a car covers about twelve
// of its own lengths a second on the throttle and nineteen supersonic. The
// first cut sat at 10.5 / 26, and the cruise was the number every complaint
// about the bell feeling "restrictive" was really about — the ball's own cap
// is 34, so an unboosted flier could never keep up with a moving ball.
export const DG_SWIM_SPEED = 13; // unboosted cruise: ~6s to cross the bell
export const DG_BOOST_SPEED = 28; // boosted: ~3s to cross
export const DG_BOOST_ACCEL = 36;
export const DG_CARRY_MULT = 0.82; // carrying the Tidesow is slower
export const DG_DRAG = 0.4; // /s, exponential — low, so a body GLIDES

/**
 * The spool: how flooded flight builds and sheds pace.
 *
 * The first pass gave the pack its full authority on the first tick, so a body
 * went from dead stop to cruise inside a fifth of a second and stopped just as
 * fast — the bell felt like a mouse cursor rather than something you fly. Now
 * both the thrust AND the speed ceiling ramp in over {@link DG_SPOOL_UP}: you
 * push off slowly, wind up to full pace, and when you let go the ceiling walks
 * back down instead of snapping, leaving a long coast.
 *
 * `dgSpool` (0..1) lives on the entity so the render can read it — the burner
 * cones are scaled by exactly this number, which is what makes the pack read as
 * the engine actually spinning up.
 */
export const DG_SPOOL_UP = 0.35; // s of held thrust to full authority
export const DG_SPOOL_DOWN = 1.1; // s back to idle once the sticks are released
/**
 * Thrust and ceiling at zero spool, as a fraction of the full figure.
 *
 * Raised from 0.5: with the ceiling riding the spool too, half authority on the
 * first tick meant the first half-second of every course correction was flown at
 * a speed cap under the cruise figure, and the bell read as syrup. The spool is
 * meant to make a standing start feel like an engine winding up, not to take the
 * controls away for a beat.
 */
export const DG_SPOOL_FLOOR = 0.86;

/**
 * Turn authority — the Rocket League rule.
 *
 * A car in that game accelerates in a straight line at a measured rate, but a
 * flick of the stick redirects it RIGHT NOW; the momentum is real and yet it
 * never feels sluggish. Spool alone gave the momentum and none of the snap.
 * So thrust that fights your current motion bites harder than thrust that
 * agrees with it: at full reversal the pack pushes {@link DG_TURN_AUTHORITY}
 * times as hard, tapering to 1x when you are simply going faster in the
 * direction you are already going. Cornering is crisp, top speed is unchanged.
 */
const DG_TURN_AUTHORITY = 2.2;

/** A burn's opening kick, yd/s, dumped in on the tick the throttle opens.
 *  Boost in Rocket League has a shove to it; ramping in from nothing reads as
 *  the pack sighing rather than lighting. */
const DG_BOOST_KICK = 4.5;

/**
 * Seconds for the thrust vector to catch up with the keys.
 *
 * Flying a sphere is three simultaneous axes, and raw key state made every
 * press a step change in the acceleration — at 20 Hz that reads as the body
 * twitching between headings rather than flying between them. The lag costs no
 * authority (turn authority above is what makes a hard change of direction
 * bite); it only rounds the corners off the input itself.
 */
const DG_STEER_LAG = 0.07;

/** Climb/dive weight against one unit of horizontal input. Above 1 on purpose:
 *  changing altitude while moving is the single most common thing a flier does
 *  in here, and as one third of a normalised 3-vector it was the weakest
 *  control on the pad. */
const DG_VERTICAL_AUTHORITY = 1.15;

/**
 * Altitude hold — now a WHISPER, not a hold.
 *
 * Hands off the vertical axis and the body's climb/sink bleeds away a little
 * faster than its horizontal drift does. The first cut damped it at 1.8/s,
 * which parked you at whatever height you last picked inside half a second:
 * safe, and the single most un-Rocket-League thing in the bell. A car that
 * leaves the ground keeps going where it was going; a flier that lets go of
 * the climb should too, and only the water (DG_DRAG) should slow it. What is
 * left here is just enough to settle a body that has stopped meaning to climb,
 * so a hover does not wander a yard a second forever.
 *
 * Gated on the whole vertical INTENT, not just the climb/dive keys: once the
 * thrust follows the aim (see {@link DG_AIM_MAX}), a nose-up burn is a climb
 * the player asked for, and bleeding it here fought the one control that makes
 * the bell feel like flight.
 */
const DG_ALTITUDE_HOLD = 0.5; // /s of extra vertical damping
/** Vertical thrust intent under which altitude hold is allowed to bite. */
const DG_HOLD_DEADZONE = 0.12;

/**
 * Steepest aim the camera is allowed to pitch the thrust to, radians.
 *
 * This is the control the bell was missing. `dive`/`surface` are LATCHED BANDS —
 * a three-position switch — so before this the thrust was flat no matter where
 * the view pointed, and a ring 20 yards above you could only be reached by
 * holding Space and hoping. Now the camera's real pitch pitches the whole
 * forward axis: you fly, and shoot, exactly where you look. Space and Ctrl stay
 * ABSOLUTE vertical, because a pure altitude trim you can hold while looking
 * somewhere else is what makes lining a shot up possible at all.
 */
export const DG_AIM_MAX = 1.35;

/**
 * Air brake. Holding back with no forward input throws the pack into reverse:
 * the retro thrust is already there through turn authority, but a body at boost
 * pace in low drag took the better part of three seconds to stop, and "I cannot
 * stop" is the complaint that made the bell feel like ice. This is the extra
 * damping on top, and it only bites while the body is actually travelling.
 */
const DG_BRAKE = 3.4; // /s
const DG_BRAKE_MIN_SPEED = 4;

/**
 * The dash: a LEFT CLICK throws the body NOW along the keys you are holding,
 * read in the LOOK frame (Rocket League's directional flip: forward + click
 * is a front flip down the nose, a strafe + click a side flip, nothing held a
 * flip straight down the camera line). The double-tap it also used to answer
 * to is gone: it fired on hands rolling across WASD and made the click feel
 * optional.
 *
 * The bell's momentum is long on purpose, which left a flier with no answer to
 * anything sudden — a ball deflected across your nose was simply gone. A dash is
 * the short-range answer. FREE on purpose: it used to cost charge, and a mobility tool that
 * competes with the burners for fuel is a mobility tool nobody uses — the
 * cooldown is the whole cost now, which is why it is a long one. At half a
 * second a dash was simply how you travelled; at two, spending one is a
 * decision and the ball magnet below is a reward for reading the play rather
 * than a button you mash at it.
 */
export const DG_DASH_SPEED = 17; // yd/s of impulse
export const DG_DASH_COST = 0; // free — the cooldown is the cost
export const DG_DASH_CD_TICKS = Math.round(2 / DT);
const DG_DASH_FLARE_TICKS = Math.round(0.3 / DT);

/**
 * The dash MAGNET: a dash thrown near the Tidesow bends onto it.
 *
 * Nothing in the bell is harder than the last yard. You read the ball, you
 * dash, and you miss it by half a body — because a 2.4 yd ball crossing your
 * nose at pace is a target a third-person chibi camera simply cannot place to
 * the inch. The magnet is the fix, and it is deliberately an ASSIST rather than
 * a homing move: it only bites inside {@link DG_DASH_MAGNET_RANGE}, it only
 * bends a dash that was already thrown roughly the right way
 * ({@link DG_DASH_MAGNET_COS}), and it never redirects more than
 * {@link DG_DASH_MAGNET_MAX} of the line even at point-blank. A good read gets
 * finished; a bad one still misses.
 *
 * The same rule for every body in the bout, human and bot alike — a movement
 * rule that only applies to one side is the kind of thing that reads as a bug.
 */
export const DG_DASH_MAGNET_RANGE = 13; // yd, chest to ball centre
/** Strongest pull, as the fraction of the dash line handed to the ball's
 *  bearing. At point-blank; it ramps to nothing at the range edge. */
const DG_DASH_MAGNET_MAX = 0.6;
/** Cosine of the widest angle the assist will bend across (~78 degrees). Wide
 *  enough to feel generous, narrow enough that a dash AWAY from the ball is
 *  always a dash away from the ball. */
const DG_DASH_MAGNET_COS = 0.2;
/** Which axis a dash left along, for the render's flip (Entity.dgDashKind):
 *  1 forward, 2 back, 4 left, 8 right. */
const DASH_FWD = 1;
const DASH_BACK = 2;
const DASH_LEFT = 4;
const DASH_RIGHT = 8;
/** Per-second decay of the ceiling while coasting above it. Together with the
 *  low drag this is the whole "slows down gradually" feel: a body off the
 *  throttle at boost speed takes a few seconds to settle back to cruise — the
 *  supersonic carry, in Rocket League terms. Loosened from 0.25 so a burn buys
 *  you a run, not a moment. */
export const DG_COAST_DECAY = 0.18;

export const DG_CHARGE_MAX = 100;
export const DG_CHARGE_BURN = 40; // /s -> 2.5s of continuous burn

/**
 * The boost economy is Rocket League's: **the map is the fuel supply.**
 *
 * The first pass refilled the tank on its own at 17/s, which meant boost was a
 * cooldown rather than a resource — you never had to go anywhere for it, and
 * the twelve lit vents in the bell were a minor convenience nobody detoured
 * for. Passive regen is now a bare trickle that only exists so a stranded
 * fighter can still limp to the nearest pad; everything else comes off the
 * pads (./layout.ts DG_BOOST_PADS), and the big ones fill you outright.
 */
export const DG_CHARGE_REGEN = 2.5; // /s — a limp home, not a refill
export const DG_REGEN_DELAY = 1; // s off the throttle before the trickle starts
export const DG_REGEN_HOLD_TICKS = Math.round(DG_REGEN_DELAY / DT);
/** A small vent's top-up. The big ones pass DG_CHARGE_MAX instead. */
export const DG_PAD_REFILL = 34;

/** How hard a frozen body's momentum is bled, /s. */
const DG_FREEZE_DAMPING = 2.2;

/** How much of the radial speed a body gets back off the glass. Small: the
 *  glass is a boundary, not a trampoline — but zero read as sticking. */
const DG_WALL_BOUNCE = 0.28;

/** Below this charge the pack is spent and will not relight until it recovers
 *  past DG_RELIGHT — a burnt-out pack must visibly stay out for a beat rather
 *  than stuttering back on for one frame at a time. */
const DG_SPENT = 0;
const DG_RELIGHT = 12;

/**
 * The pitch this body is AIMED along, radians, positive up.
 *
 * `aimPitch` (the camera, continuous) when the frame carries one; otherwise
 * zero. Deliberately NOT derived from the dive/surface bands: those are the
 * absolute climb/sink axis and stay independent of where the view points, which
 * is what lets a player hold altitude while lining a shot up somewhere else.
 */
export function aimPitchOf(inp: MoveInput): number {
  const raw = inp.aimPitch;
  if (raw === undefined || !Number.isFinite(raw)) return 0;
  return Math.max(-DG_AIM_MAX, Math.min(DG_AIM_MAX, raw));
}

/** The unit vector a body is aimed along: yaw, pitched by {@link aimPitchOf}.
 *  The one place flight and the strike moves agree on "forward". */
export function lookDirection(facing: number, pitch: number, out: Vec3): void {
  const cp = Math.cos(pitch);
  out.x = Math.sin(facing) * cp;
  out.y = Math.sin(pitch);
  out.z = Math.cos(facing) * cp;
}

const RAW: Vec3 = { x: 0, y: 0, z: 0 };
const WISH: Vec3 = { x: 0, y: 0, z: 0 };
const LOOK: Vec3 = { x: 0, y: 0, z: 0 };

/** Is the pack currently able to light? */
export function packCanBurn(p: Entity): boolean {
  const charge = p.dgCharge ?? 0;
  if (p.dgBoosting) return charge > DG_SPENT;
  return charge >= DG_RELIGHT;
}

/** Top up at a boost pad. Returns true when the pad actually gave anything. */
export function refillCharge(p: Entity, amount = DG_PAD_REFILL): boolean {
  const before = p.dgCharge ?? 0;
  if (before >= DG_CHARGE_MAX) return false;
  p.dgCharge = Math.min(DG_CHARGE_MAX, before + amount);
  return true;
}

/**
 * One 20 Hz step of flooded flight. Replaces the ENTIRE ground/swim motion
 * pipeline for a body inside the bell: it integrates its own velocity, applies
 * drag, and clamps analytically to the play sphere (the 2D collider grid cannot
 * express a sphere, so participants are clamped here exactly the way practice
 * players are already clamped to their instanced pitch copy).
 *
 * `carrying` slows a body that has the Tidesow. `speedScale` handicaps a body
 * outright (the bots fly at DG_BOT_SPEED_SCALE of a human's pace). `magnet` is
 * where the Tidesow will be in a moment (the match leads it): a dash thrown
 * near it bends onto it — see {@link DG_DASH_MAGNET_RANGE}. Pass null (or
 * nothing) and dashes fly exactly where they were thrown.
 */
export function deepglassFlightPass(
  p: Entity,
  inp: MoveInput,
  carrying: boolean,
  current: Vec3,
  speedScale = 1,
  magnet: Vec3 | null = null,
): void {
  // The water supports the body: no gravity, no fall state, no jump pose.
  p.onGround = true;
  p.jumping = false;
  p.fallStartY = p.pos.y;
  p.swimDiving = false;
  p.swimStroke = 0;
  if (p.dgCharge === undefined) p.dgCharge = DG_CHARGE_MAX;

  // ---- steering ----------------------------------------------------------
  // Two frames at once, and the split is the whole control scheme. W/S and the
  // strafes ride the LOOK frame — the camera's yaw pitched by its actual pitch —
  // so you fly where you point; Space and Ctrl are ABSOLUTE vertical trim, so
  // you can hold a height while aiming somewhere else. F is the throttle on top
  // of whatever direction that produces, and F on its own means "where I look",
  // because a throttle that needs a second key held to do anything is not a
  // throttle.
  const aim = aimPitchOf(inp);
  p.dgAimPitch = aim;
  lookDirection(p.facing, aim, LOOK);
  const fx = Math.sin(p.facing);
  const fz = Math.cos(p.facing);
  // Screen-right is (-cos f, sin f) by the sim's own convention. Flat on
  // purpose: a strafe that pitched with the view would roll the body sideways
  // through its own climb, which is disorienting rather than expressive.
  const rx = -fz;
  const rz = fx;

  let mz = 0;
  let mx = 0;
  if (inp.forward) mz += 1;
  if (inp.back) mz -= 1;
  if (inp.strafeLeft) mx -= 1;
  if (inp.strafeRight) mx += 1;
  let my = 0;
  if (inp.jump) my += 1; // Space: climb
  if (inp.dive) my -= 1; // Ctrl: sink
  if (inp.boost === true && mz === 0 && mx === 0 && my === 0) mz = 1;

  RAW.x = LOOK.x * mz + rx * mx;
  // The vertical axis gets its OWN authority rather than being one third of a
  // normalised 3-vector. Climbing while flying forward used to halve both, so
  // the one thing a flier does constantly — change altitude on the move — was
  // the softest input in the game.
  RAW.y = LOOK.y * mz + my * DG_VERTICAL_AUTHORITY;
  RAW.z = LOOK.z * mz + rz * mx;

  const rawLen = Math.hypot(RAW.x, RAW.y, RAW.z);
  if (rawLen > 1) {
    RAW.x /= rawLen;
    RAW.y /= rawLen;
    RAW.z /= rawLen;
  }

  // Frozen by a Tidewarden's beam, or checked: the body keeps its momentum but
  // has no say in it for a beat.
  const frozen = (p.dgFrozenTicks ?? 0) > 0;
  if (frozen) p.dgFrozenTicks = (p.dgFrozenTicks ?? 0) - 1;
  if ((p.dgTumbleTicks ?? 0) > 0) {
    p.dgTumbleTicks = (p.dgTumbleTicks ?? 0) - 1;
  }
  const noSay = frozen || (p.dgTumbleTicks ?? 0) > 0;
  if (noSay) {
    RAW.x = 0;
    RAW.y = 0;
    RAW.z = 0;
  }

  if ((p.dgDashCd ?? 0) > 0) p.dgDashCd = (p.dgDashCd ?? 0) - 1;
  if ((p.dgDashTicks ?? 0) > 0) p.dgDashTicks = (p.dgDashTicks ?? 0) - 1;

  // ---- steering lag ------------------------------------------------------
  // The thrust vector CHASES the keys rather than snapping to them. Raw axes
  // meant every key press was a discontinuity in the acceleration, which at 20
  // Hz reads as the body twitching between headings; a short lag smooths the
  // whole thing out without costing any authority (the turn-authority term
  // below is what keeps hard changes of direction sharp).
  const lag = 1 - Math.exp(-DT / DG_STEER_LAG);
  if (!p.dgWish) p.dgWish = { x: 0, y: 0, z: 0 };
  const wishState = p.dgWish;
  wishState.x += (RAW.x - wishState.x) * lag;
  wishState.y += (RAW.y - wishState.y) * lag;
  wishState.z += (RAW.z - wishState.z) * lag;
  WISH.x = wishState.x;
  WISH.y = wishState.y;
  WISH.z = wishState.z;

  let wanted = Math.hypot(WISH.x, WISH.y, WISH.z);
  // Below the deadzone the lag tail is just noise; let it settle to nothing.
  if (wanted < 0.04) {
    wanted = 0;
  } else {
    WISH.x /= wanted;
    WISH.y /= wanted;
    WISH.z /= wanted;
    wanted = Math.min(1, wanted);
  }

  // ---- boost -------------------------------------------------------------
  // Overburn floods the burners: they light without drawing on the charge, so
  // the window is pure uptime rather than a bigger tank.
  const overburn = (p.dgOverburnTicks ?? 0) > 0;
  if (overburn) p.dgOverburnTicks = (p.dgOverburnTicks ?? 0) - 1;
  const wantsBoost = inp.boost === true && wanted > 1e-6;
  const burning = wantsBoost && (overburn || packCanBurn(p));
  const lightingUp = burning && p.dgBoosting !== true;
  p.dgBoosting = burning;
  if (burning && !overburn) {
    p.dgCharge = Math.max(0, (p.dgCharge ?? 0) - DG_CHARGE_BURN * DT);
    p.dgRegenHold = DG_REGEN_HOLD_TICKS;
  } else if (burning) {
    p.dgRegenHold = DG_REGEN_HOLD_TICKS;
  } else if ((p.dgRegenHold ?? 0) > 0) {
    p.dgRegenHold = (p.dgRegenHold ?? 0) - 1;
  } else {
    p.dgCharge = Math.min(DG_CHARGE_MAX, (p.dgCharge ?? 0) + DG_CHARGE_REGEN * DT);
  }

  // ---- the dash ----------------------------------------------------------
  // A left click throws the body along whatever the keys are asking for right
  // now (RAW: the look frame, so forward pitches with the camera and a strafe
  // stays flat), or straight down the look when the hands are off — a click
  // always answers with motion. Free (see DG_DASH_COST): the cooldown is the
  // only gate.
  if (inp.dash === true && !noSay && (p.dgDashCd ?? 0) <= 0) {
    let dx = 0;
    let dy = 0;
    let dz = 0;
    // Which axis, for the render's dash flip (front/back flip, side rolls).
    let kind = DASH_FWD;
    if (mx !== 0 || mz !== 0 || my !== 0) {
      const rl = Math.hypot(RAW.x, RAW.y, RAW.z);
      if (rl > 1e-6) {
        dx = RAW.x / rl;
        dy = RAW.y / rl;
        dz = RAW.z / rl;
      }
      if (Math.abs(mx) > Math.abs(mz)) kind = mx < 0 ? DASH_LEFT : DASH_RIGHT;
      else kind = mz < 0 ? DASH_BACK : DASH_FWD;
    }
    if (dx === 0 && dy === 0 && dz === 0) {
      dx = LOOK.x;
      dy = LOOK.y;
      dz = LOOK.z;
    }
    // The magnet: bend the (unit) dash line onto the ball when it is close and
    // already roughly ahead. The flip kind is left alone — it comes off the key
    // you pressed, and a body that flips one way while sliding another reads as
    // broken however right the physics is.
    if (magnet) {
      const mx2 = magnet.x - p.pos.x;
      const my2 = magnet.y - (p.pos.y + DG_BODY_CENTRE_Y);
      const mz2 = magnet.z - p.pos.z;
      const md = Math.hypot(mx2, my2, mz2);
      const dl = Math.hypot(dx, dy, dz);
      if (md > 1e-3 && md <= DG_DASH_MAGNET_RANGE && dl > 1e-6) {
        const ux2 = mx2 / md;
        const uy2 = my2 / md;
        const uz2 = mz2 / md;
        const align = (dx * ux2 + dy * uy2 + dz * uz2) / dl;
        if (align >= DG_DASH_MAGNET_COS) {
          // Strongest at point-blank, nothing at the edge of the range: the
          // assist is for the last yard, not for the approach.
          const pull = DG_DASH_MAGNET_MAX * (1 - md / DG_DASH_MAGNET_RANGE);
          dx = (dx / dl) * (1 - pull) + ux2 * pull;
          dy = (dy / dl) * (1 - pull) + uy2 * pull;
          dz = (dz / dl) * (1 - pull) + uz2 * pull;
          const bl = Math.hypot(dx, dy, dz) || 1;
          dx /= bl;
          dy /= bl;
          dz /= bl;
        }
      }
    }

    const push = DG_DASH_SPEED * speedScale;
    p.vx += dx * push;
    p.vy += dy * push;
    p.vz += dz * push;
    p.dgDashCd = DG_DASH_CD_TICKS;
    p.dgDashTicks = DG_DASH_FLARE_TICKS;
    p.dgDashKind = kind;
  }

  // ---- spool -------------------------------------------------------------
  // Held thrust winds the pack up; letting go winds it down. Both the ceiling
  // and the thrust ride it, so a standing start accelerates gently and a body
  // already at pace keeps its authority through a course correction.
  const spoolPrev = p.dgSpool ?? 0;
  const spool = Math.max(
    0,
    Math.min(1, spoolPrev + (wanted > 1e-6 ? DT / DG_SPOOL_UP : -DT / DG_SPOOL_DOWN)),
  );
  p.dgSpool = spool;
  const authority = DG_SPOOL_FLOOR + (1 - DG_SPOOL_FLOOR) * spool;

  const cap =
    (burning ? DG_BOOST_SPEED : DG_SWIM_SPEED) *
    (carrying ? DG_CARRY_MULT : 1) *
    speedScale *
    authority;
  let accel = (burning ? DG_BOOST_ACCEL : DG_SWIM_SPEED * 3) * speedScale * authority;

  // ---- integrate ---------------------------------------------------------
  // Speed at the start of the tick's THRUST (so: after a dash, which is an
  // impulse rather than thrust). The coast-down below is measured against it,
  // not against the post-thrust speed: otherwise unboosted thrust walks the
  // ceiling up 0.5% at a time and a drifting body accelerates past the swim cap
  // all the way to its drag terminal. Reading it here is also what lets a dash
  // exceed the ceiling and then bleed back down through it.
  const speedBefore = Math.hypot(p.vx, p.vy, p.vz);
  if (wanted > 1e-6) {
    // Turn authority: how much this thrust DISAGREES with where the body is
    // already going. 0 when pushing straight ahead, 1 on a full reversal.
    if (speedBefore > 1e-3) {
      const align = (p.vx * WISH.x + p.vy * WISH.y + p.vz * WISH.z) / speedBefore;
      accel *= 1 + (DG_TURN_AUTHORITY - 1) * Math.max(0, Math.min(1, (1 - align) * 0.5));
    }
    if (lightingUp) {
      // The opening shove of a burn.
      p.vx += WISH.x * DG_BOOST_KICK;
      p.vy += WISH.y * DG_BOOST_KICK;
      p.vz += WISH.z * DG_BOOST_KICK;
    }
    p.vx += WISH.x * accel * DT;
    p.vy += WISH.y * accel * DT;
    p.vz += WISH.z * accel * DT;
  }
  // Altitude hold: no vertical INTENT — neither the trim keys nor a pitched
  // look — and the vertical component bleeds away, so you hold the height you
  // picked. Horizontal momentum is untouched.
  if (my === 0 && Math.abs(WISH.y) * wanted < DG_HOLD_DEADZONE) {
    p.vy *= Math.exp(-DG_ALTITUDE_HOLD * DT);
  }
  // Air brake: back with no forward is a full reverse, and the retro thrust
  // above is only half of it. This is the part you feel.
  const braking = !noSay && inp.back === true && !inp.forward && speedBefore > DG_BRAKE_MIN_SPEED;
  p.dgBraking = braking;
  if (braking) {
    const k = Math.exp(-DG_BRAKE * DT);
    p.vx *= k;
    p.vy *= k;
    p.vz *= k;
  }
  // Frozen solid: the beam does not just take the controls away, it takes the
  // body's pace with them, so a frozen fighter is a floating obstacle.
  if (frozen) {
    const ice = Math.exp(-DG_FREEZE_DAMPING * DT);
    p.vx *= ice;
    p.vy *= ice;
    p.vz *= ice;
  }
  // Currents push a hanging body around; this is the only thing that moves a
  // player who is doing nothing, and it is deterministic (see ./currents.ts).
  p.vx += current.x * DT;
  p.vy += current.y * DT;
  p.vz += current.z * DT;

  const drag = Math.exp(-DG_DRAG * DT);
  p.vx *= drag;
  p.vy *= drag;
  p.vz *= drag;

  // Cap to the mode's top speed. Speed above the cap decays back down through
  // it rather than snapping, so releasing the throttle glides instead of
  // braking — but only ever DOWNWARD from the speed already bought. Applied
  // while burning too, which costs nothing there (a body at the boost cap has
  // `speedBefore` at the cap, so the coast term lands just under it) and is what
  // lets a dash overshoot the ceiling and bleed back instead of being clipped
  // flat on the very tick it fired.
  const speed = Math.hypot(p.vx, p.vy, p.vz);
  const ceiling = Math.max(cap, speedBefore * Math.exp(-DG_COAST_DECAY * DT));
  if (speed > ceiling && speed > 1e-6) {
    const k = ceiling / speed;
    p.vx *= k;
    p.vy *= k;
    p.vz *= k;
  }

  p.pos.x += p.vx * DT;
  p.pos.y += p.vy * DT;
  p.pos.z += p.vz * DT;

  // ---- the glass ---------------------------------------------------------
  if (clampToBell(p.pos)) {
    // Slide along the glass rather than sticking: strip the outward radial
    // component so a body pressed into the wall keeps its tangential speed. A
    // body that arrives FAST also gets a little of it back inward — hitting the
    // wall at boost pace and simply stopping dead reads as a bug, and the small
    // kick is what lets a wall be used as something to push off.
    const nx = p.pos.x - DEEPGLASS_CENTER.x;
    const ny = p.pos.y - DEEPGLASS_CENTER.y;
    const nz = p.pos.z - DEEPGLASS_CENTER.z;
    const n = Math.hypot(nx, ny, nz) || 1;
    const radial = (p.vx * nx + p.vy * ny + p.vz * nz) / n;
    if (radial > 0) {
      const give = radial * (1 + DG_WALL_BOUNCE);
      p.vx -= (give * nx) / n;
      p.vy -= (give * ny) / n;
      p.vz -= (give * nz) / n;
    }
  }
}

/** Leaving the bell: clear every deepball field so the body goes back to
 *  ordinary ground motion with nothing left over. */
export function endDeepglassFlight(p: Entity): void {
  p.dgFlight = undefined;
  p.dgCharge = undefined;
  p.dgBoosting = undefined;
  p.dgRegenHold = undefined;
  p.dgOverburnTicks = undefined;
  p.dgTumbleTicks = undefined;
  p.dgSpool = undefined;
  p.dgWish = undefined;
  p.dgFrozenTicks = undefined;
  p.dgPowerup = undefined;
  p.dgAimPitch = undefined;
  p.dgDashTicks = undefined;
  p.dgDashCd = undefined;
  p.dgDashKind = undefined;
  p.dgStrikeBuf = undefined;
  p.dgDeadTicks = undefined;
  p.dgZappedBy = undefined;
  p.dgBraking = undefined;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
}
