// The Gyre's wind: the storm peak's own air, worked into the climb. Two things ride it:
//
//   Gale lanes    a run of short air pockets along the path, foot to crown, where the wind blows up
//                 the mountain. A body in one, on foot or mounted, is carried: the gale pushes it up
//                 the track (standing still or running, no key needed), faster and faster to three
//                 times the run, it keeps its momentum and slides, and it follows the road round
//                 every turn, so the climb is a ride on the wind. The keys still steer: strafe to
//                 drift across the road, hold back to walk against the gale; a hop rides the same
//                 law, so a jump on a bend keeps to the road. A stun, a root or another mover's
//                 hold is never pushed, the gale never holds a body below the pace it would run or
//                 ride at on its own, and out of a lane the lingering aura builds no speed the gale
//                 did not give. Its push fades over the last stretch so the crown is reached at a
//                 walk's ease.
//   Launch pockets  four openings in the railing on the path's outer lip, where the wind rises up
//                 the face: a body that steps into, or hops over, the outer part of an opening (or
//                 the railed road a few yards either side of it) is lifted over the face and set
//                 down on the next turn of the road (or, above the last turn, on the crown beside
//                 the seats): a shortcut up the mountain.
//
// The lane is the motion kernel's slippery-ground aura (the same momentum the isle's frozen lakes
// use), so the server, the offline Sim and the online client's own step agree, and online the client
// stands its prediction down in a lane exactly as it does on ice (server/movement_override_epoch.ts
// already reads the aura). The lift is the scripted flight a Heroic Leap and the Muster Grapnel use
// (combat/heroic_leap.ts: `leap`), which the override already covers too.
//
// This module is the leaf: the lanes' and pockets' geometry and every constant (the content modules
// lay the railing and the gate stones from it). The per-tick velocity law is the pure
// quartered_gyre_current.ts, the per-player step that applies it is quartered_gyre_wind_step.ts,
// called once per player per tick from the environment step (environment_damage.ts). Pure and
// deterministic: no rng, no clock.

import { GYRE_PEAK, gyrePathAt, gyrePathPoint } from './quartered_landmarks';
import { SLIPPERY_GROUND_AURA } from './slippery_ground';

// ---- the path, in yards ---------------------------------------------------------------------

const PATH_SAMPLES = 480;
/** Horizontal yards walked from the path's foot at t = k / PATH_SAMPLES. */
const ALONG: number[] = (() => {
  const out = [0];
  let prev = gyrePathPoint(0);
  for (let k = 1; k <= PATH_SAMPLES; k++) {
    const p = gyrePathPoint(k / PATH_SAMPLES);
    out.push(out[k - 1] + Math.hypot(p.x - prev.x, p.z - prev.z));
    prev = p;
  }
  return out;
})();

/** The path's horizontal length, foot to crown, yards. */
export const GYRE_PATH_YARDS = ALONG[PATH_SAMPLES];

/** The path parameter t (0 at the foot to 1 at the crown) `yards` along the path. */
export function gyreTAtYards(yards: number): number {
  if (yards <= 0) return 0;
  if (yards >= GYRE_PATH_YARDS) return 1;
  let lo = 0;
  let hi = PATH_SAMPLES;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ALONG[mid] <= yards) lo = mid;
    else hi = mid;
  }
  const span = ALONG[hi] - ALONG[lo];
  return (lo + (span > 0 ? (yards - ALONG[lo]) / span : 0)) / PATH_SAMPLES;
}

/** Horizontal yards from the path's foot at parameter t (the inverse of gyreTAtYards). */
export function gyreYardsAtT(t: number): number {
  const f = Math.max(0, Math.min(1, t)) * PATH_SAMPLES;
  const lo = Math.min(PATH_SAMPLES - 1, Math.floor(f));
  return ALONG[lo] + (ALONG[lo + 1] - ALONG[lo]) * (f - lo);
}

// ---- the gale lanes -------------------------------------------------------------------------

/** The first lane starts this far up the path from its foot (past the road's last yards). */
export const GYRE_LANE_FIRST_YD = 24;
/** A lane's length along the path, yards. */
export const GYRE_LANE_LEN_YD = 21;
/** The least clear gap between one lane and the next, yards (the gaps are stretched a little so the
 *  lanes fill the climb exactly): a body at speed crosses one well inside the aura's linger, so the
 *  ride is never broken, but each pocket of wind reads on its own. */
export const GYRE_LANE_GAP_YD = 5;
/** The last lane ends this far short of the crown: the ride delivers a body to the crown's edge at
 *  a walking pace and the seat's own ground stays calm. */
export const GYRE_LANE_CROWN_CLEAR_YD = 7;

export interface GyreWindLane {
  /** the stretch of path, as parameter t */
  t0: number;
  t1: number;
  /** the same stretch in yards from the foot */
  yd0: number;
  yd1: number;
}

function buildLanes(): GyreWindLane[] {
  const lanes: GyreWindLane[] = [];
  const end = GYRE_PATH_YARDS - GYRE_LANE_CROWN_CLEAR_YD;
  const span = end - GYRE_LANE_FIRST_YD;
  // as many lanes as fit at the least gap, the gaps then stretched so the last lane ends exactly at
  // the crown's clearance: the gale blows right up to the seat's calm, with no dead stretch to
  // strand a rider short of it
  const n = Math.max(
    1,
    Math.floor((span + GYRE_LANE_GAP_YD) / (GYRE_LANE_LEN_YD + GYRE_LANE_GAP_YD)),
  );
  const gap = n > 1 ? (span - n * GYRE_LANE_LEN_YD) / (n - 1) : 0;
  for (let k = 0; k < n; k++) {
    const yd = GYRE_LANE_FIRST_YD + k * (GYRE_LANE_LEN_YD + gap);
    lanes.push({
      t0: gyreTAtYards(yd),
      t1: gyreTAtYards(yd + GYRE_LANE_LEN_YD),
      yd0: yd,
      yd1: yd + GYRE_LANE_LEN_YD,
    });
  }
  return lanes;
}

/** Every gale lane, foot to crown. */
export const GYRE_WIND_LANES: readonly GyreWindLane[] = buildLanes();

/** The Gale Lane aura IS the kernel's slippery-ground aura (slippery_ground.ts: ground velocity
 *  keeps its momentum, value2 is the grip), worn as a speed buff (`buff_speed`: the multiplier
 *  that sets the slide's ceiling). One aura, one name on the wire. */
export const GALE_LANE_AURA_ID = SLIPPERY_GROUND_AURA;
/** The aura's player-visible name (re-localized by the client matcher, ui/sim_i18n.ts). */
export const GALE_LANE_AURA_NAME = 'Gale Lane';
/** The ceiling of the ride, a multiple of the run: the kernel caps a slide at RUN_SPEED times this,
 *  so a body in a lane tops out at three times the run (21 yd/s). */
export const GALE_LANE_SPEED = 3;
/** How fast the keys can change the slide, yards a second per second (the grip): a stop slides on
 *  and a turn swings wide, so the ride feels like riding the air, not running. */
export const GALE_LANE_GRIP = 7;
/** How long the aura holds after the last tick in a lane, seconds: the ride carries through the
 *  gaps between lanes (a body at speed crosses one in a quarter second). */
export const GALE_LANE_LINGER = 1.2;
/** The gale's push up the track, yards a second per second: from a standstill to the ceiling in a
 *  little over a second, no key held. */
export const GALE_WIND_ACCEL = 24;
/** How fast a body above the (tapered) ceiling is eased down to it, yards a second per second. */
export const GALE_WIND_BRAKE = 14;
/** The share of the body's own grip the gale keeps when the keys ask for the other way (holding
 *  back): under the grip, so the keys win and a body can walk down against the wind. */
export const GALE_WIND_OPPOSED_SHARE = 0.3;
/** How hard the road pulls a body back to its centre line, sideways yards a second per yard off it:
 *  holding a strafe key at the run's speed settles at the road's edge, so the whole width is
 *  reachable, and letting go brings the body back. */
export const GALE_WIND_CENTERING = 2;
/** The gale eases off over the last stretch of the climb, yards, to this share of its ceiling at the
 *  crown, so the ride ends at a walking pace beside the seats. */
export const GALE_TAPER_YD = 90;
export const GALE_TAPER_END = 0.4;

/** The gale's share of its ceiling `yards` along the path: 1 up to the last GALE_TAPER_YD yards,
 *  then a smooth fall to GALE_TAPER_END at the crown. */
export function galeStrengthAtYards(yards: number): number {
  const k = Math.max(0, Math.min(1, (yards - (GYRE_PATH_YARDS - GALE_TAPER_YD)) / GALE_TAPER_YD));
  return 1 - (1 - GALE_TAPER_END) * (k * k * (3 - 2 * k));
}

/** How far above the path a body still counts as on it: a hop keeps the lane. */
const ON_PATH_HEIGHT = 2.5;

/** The path's surface height at parameter t (GYRE_PEAK: base plus the rise, linear in t). */
function pathY(t: number): number {
  return GYRE_PEAK.baseY + GYRE_PEAK.rise * t;
}

/** The gale lane (x, y, z) stands in, or null: on the path, inside a lane's stretch, and on its
 *  surface (not high over it). */
export function gyreLaneAt(x: number, y: number, z: number): GyreWindLane | null {
  const at = gyrePathAt(x, z);
  if (!at) return null;
  const surface = pathY(at.t);
  if (y > surface + ON_PATH_HEIGHT || y < surface - ON_PATH_HEIGHT) return null;
  for (const lane of GYRE_WIND_LANES) {
    if (at.t >= lane.t0 && at.t <= lane.t1) return lane;
  }
  return null;
}

// ---- the road's frame ------------------------------------------------------------------------

/** The path's rate of change of radius per radian climbed (it winds anticlockwise, in a turnStep
 *  closer to the peak each full turn). */
const DR_DPHI = -GYRE_PEAK.turnStep / (2 * Math.PI);

/** The road's frame at a point: the unit tangent up the climb (tx, tz), the unit normal out over
 *  the drop (nx, nz, to the right of the way up), how far outboard of the centre line the point is
 *  (`off`, yards), and where along the path it is. */
export interface GyreTrackFrame {
  t: number;
  yards: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  off: number;
}

/** Write the road's frame at (x, z) into `out`; false (and `out` untouched) off the path. */
export function gyreTrackFrameAt(x: number, z: number, out: GyreTrackFrame): boolean {
  const at = gyrePathAt(x, z);
  if (!at) return false;
  const dx = x - GYRE_PEAK.x;
  const dz = z - GYRE_PEAK.z;
  const r = Math.hypot(dx, dz) || 1;
  const cx = dx / r;
  const cz = dz / r;
  // the centre line's own radius at this bearing: d(position)/d(phi) of the spiral there
  const rc = r - at.off;
  let tx = -cz * rc + cx * DR_DPHI;
  let tz = cx * rc + cz * DR_DPHI;
  const tl = Math.hypot(tx, tz) || 1;
  tx /= tl;
  tz /= tl;
  out.t = at.t;
  out.yards = gyreYardsAtT(at.t);
  out.tx = tx;
  out.tz = tz;
  out.nx = tz;
  out.nz = -tx;
  out.off = at.off;
  return true;
}

// ---- the launch pockets ---------------------------------------------------------------------

/** Where along the path (t) the four openings sit, chosen by the bearing the path has there (it
 *  winds anticlockwise from the south foot, 840 degrees in all): north-east over the sea at t 0.19
 *  and 0.61, and south over the town's lanes at t 0.429 and 0.875, clear of the way beacons and
 *  the standing stones (quartered_council_seat.ts, quartered_gyre_crags.ts). */
export const GYRE_LAUNCH_T: readonly number[] = [0.19, 0.4286, 0.61, 0.875];
/** A pocket's visual pad stands this far outboard of the path's centre line: on the outer lip. */
export const GYRE_LAUNCH_OFFSET = 3.1;
/** The lift covers the opening in the railing and a good stretch either side of it: this far either
 *  side of the pad along the path, yards. The opening is 5.5 either side and its gate stones stand
 *  just inside it, so the catch begins three yards up the railed road before the opening: a rider
 *  at the ride's full speed has most of a second to drift into it, and nobody reaches a stone's
 *  face, or the edge, without being lifted first. */
export const GYRE_LAUNCH_HALF_YD = 8.5;
/** ... but only the road's outer part: a body this far outboard of the centre line or more. A rider
 *  who does not steer passes the opening by (coasting the gaps between lanes it drifts up to about
 *  0.9 yd out on the tight upper bends, so the line stands clear of that); a moment's strafe toward
 *  the drop, or a hop that way, is enough to be caught. */
export const GYRE_LAUNCH_MIN_OFF = 1.1;
/** The lift's pace over the ground, yards a second, which sets its duration (clamped below). */
export const GALE_LIFT_SPEED = 11;
export const GALE_LIFT_MIN_SECONDS = 1.2;
export const GALE_LIFT_MAX_SECONDS = 2.4;
/** How far above the straight line from take-off to touchdown the lift's arc rises at its crest,
 *  yards: enough to clear the face and the next turn's railing with room to spare. */
export const GALE_LIFT_APEX = 13;
/** The scripted flight's name (never shown: it lands with no blast). */
export const GALE_LIFT_NAME = 'Gale Lift';
/** Seconds before the same player can be lifted again (the flight is shorter than this). */
export const GALE_LAUNCH_COOLDOWN = 3;
/** The cooldown's key on the entity's cooldown map, and the flight's ability id. */
export const GALE_LAUNCH_COOLDOWN_ID = 'gyre_gale_launch';

/** The crown's touchdown points, on its level top (GYRE_PEAK.baseY + rise), clear of the council's
 *  gate on the west side (a test pins them free of every collider): the north rim, where a flight
 *  from the west foot's pad lands too (it passes the gate's north side, quartered_gyre_pads.ts),
 *  and the lane in front of the gate. The south side is the crown pad's, the way back down. */
const CROWN_Y = GYRE_PEAK.baseY + GYRE_PEAK.rise;
export const GYRE_CROWN_NORTH_LANDING = {
  x: GYRE_PEAK.x + Math.cos((72.5 * Math.PI) / 180) * 5.2,
  y: CROWN_Y,
  z: GYRE_PEAK.z + Math.sin((72.5 * Math.PI) / 180) * 5.2,
} as const;
export const GYRE_CROWN_LANE_LANDING = {
  x: GYRE_PEAK.x + 2.5,
  y: CROWN_Y,
  z: GYRE_PEAK.z,
} as const;
/** The pockets with no road above them land on the crown, in order. */
const CROWN_LANDINGS = [GYRE_CROWN_NORTH_LANDING, GYRE_CROWN_LANE_LANDING];

export interface GyreLaunchPocket {
  t: number;
  /** yards from the path's foot to the pad */
  yd: number;
  /** the pad: on the outer lip */
  x: number;
  y: number;
  z: number;
  /** the unit vector out over the drop (away from the peak's axis) */
  ox: number;
  oz: number;
  /** where the lift sets a body down: the next turn's centre line at the same bearing, or the
   *  crown above the last turn */
  landing: { x: number; y: number; z: number };
  /** the flight's length and the height of its arc over the straight line, seconds and yards */
  duration: number;
  apex: number;
}

/** The path parameter one full turn on (the next turn up, at the same bearing). */
const TURN_T = GYRE_PEAK.turnStep / (GYRE_PEAK.startR - GYRE_PEAK.endR);

function buildPockets(): GyreLaunchPocket[] {
  let crown = 0;
  return GYRE_LAUNCH_T.map((t) => {
    const p = gyrePathPoint(t);
    const dx = p.x - GYRE_PEAK.x;
    const dz = p.z - GYRE_PEAK.z;
    const r = Math.hypot(dx, dz);
    const ox = dx / r;
    const oz = dz / r;
    const x = p.x + ox * GYRE_LAUNCH_OFFSET;
    const z = p.z + oz * GYRE_LAUNCH_OFFSET;
    let landing: { x: number; y: number; z: number };
    if (t + TURN_T <= 0.97) {
      landing = gyrePathPoint(t + TURN_T);
    } else {
      landing = CROWN_LANDINGS[Math.min(crown++, CROWN_LANDINGS.length - 1)];
    }
    const reach = Math.hypot(landing.x - x, landing.z - z);
    return {
      t,
      yd: gyreYardsAtT(t),
      x,
      y: p.y,
      z,
      ox,
      oz,
      landing: { x: landing.x, y: landing.y, z: landing.z },
      duration: Math.max(
        GALE_LIFT_MIN_SECONDS,
        Math.min(GALE_LIFT_MAX_SECONDS, reach / GALE_LIFT_SPEED),
      ),
      apex: GALE_LIFT_APEX,
    };
  });
}

/** The four launch pockets, foot to crown. */
export const GYRE_LAUNCH_POCKETS: readonly GyreLaunchPocket[] = buildPockets();

/** The pocket (x, y, z) stands in, or null: on the path inside an opening's stretch, in the road's
 *  outer part, and on its surface. */
export function gyreLaunchPocketAt(x: number, y: number, z: number): GyreLaunchPocket | null {
  const at = gyrePathAt(x, z);
  if (!at || at.off < GYRE_LAUNCH_MIN_OFF) return null;
  const yd = gyreYardsAtT(at.t);
  for (const pocket of GYRE_LAUNCH_POCKETS) {
    if (Math.abs(yd - pocket.yd) > GYRE_LAUNCH_HALF_YD) continue;
    if (Math.abs(y - pocket.y) > ON_PATH_HEIGHT) continue;
    return pocket;
  }
  return null;
}
