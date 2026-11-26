// Pure plan of the Guardian of the Breath's fight effects (breath_fight_fx.ts
// paints them; docs/design/raid/smith_heart.md section 7.2): the wind over
// the Storm Cornice (its direction telegraphed before each blow and drawn
// through the whole blow), the gaps' lethal lips, Captain Thessaly's circle
// of calm and her anchored players, the pinned, the vortex, the loose gales,
// the storm's strikes, the leaping bolt, the Thunder's Cradle, Drawn
// Lightning's marks and charged ground, the swelling storm. The sim's numbers
// are read (breath_ids.ts, the layout), never tuned here.
//
// Readability (binding): every footprint a player acts on draws through the
// shared floor telegraph at its exact radius on EVERY tier, and the wind's
// direction and the gaps' lips draw on every tier too. The direction is the
// wind's own look, never a drawn arrow (Jose's playtest: the old chevron
// field read as a UI graphic): sand snakes and sheets of dust streaming over
// the floor with their bright heads downwind, and streaks of wind in the air
// over the whole Cornice. The low tier keeps every stream and fewer streaks;
// only the streaks' count, the leaves, the torn mist, the grit, the motes,
// the domes and the shakes thin.
//
// Three-free, DOM-free, deterministic (a hash, never rng).

import { BREATH, SMITH_HEART_FIELD } from '../../sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import { inBreathArena, lipDistance } from '../../sim/encounters/smith_heart/breath_geometry';
import {
  BREATH_CUES,
  BREATH_DIFFICULTY,
  BREATH_OBJECTS,
  BREATH_TUNING,
  type BreathCalmState,
  type BreathWindPhase,
} from '../../sim/encounters/smith_heart/breath_ids';
import { authoredFieldCliffRuns } from '../../sim/instances/authored_field';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';

const T = BREATH_TUNING;

/** The palette. A footprint's rim is a threat colour (the floor telegraph's
 *  rule); the wind is the vein's own teal and white, never a threat colour
 *  (it is not a hit: what it does is push). */
export const BREATH_FIGHT_COLORS = {
  /** The dust the wind drags over the floor: a cool slate shade that reads
   *  on the pale scoured granite, a white light on each stream's head. */
  dustShade: 0x4f6274,
  dustLight: 0xf4f9fc,
  /** The streaks of wind in the air: white heads, slate tails. */
  streak: 0xf2f8fc,
  streakTail: 0x7d8fa0,
  /** The gaps' lips: a fall to your death. */
  lip: TELEGRAPH_THREAT_COLORS.lethal,
  lipGlow: 0xff7a4a,
  /** Thessaly's calm: a sanctuary's mint, no threat's hue. */
  calm: 0x7af2c8,
  calmEdge: 0xe8fff4,
  /** The Thunder's Cradle: a soak's gold (gather in it). */
  soak: 0xffc94a,
  danger: TELEGRAPH_THREAT_COLORS.danger,
  lethal: TELEGRAPH_THREAT_COLORS.lethal,
  /** A loose gale throws you: crowd control's colour. */
  control: TELEGRAPH_THREAT_COLORS.control,
  /** The storm's lightning. */
  boltCore: [0.94, 0.99, 1.0] as const,
  boltEdge: [0.36, 0.78, 1.0] as const,
  accent: 0x9fe4ff,
  spark: [0.7, 0.93, 1.0] as const,
  wind: [0.86, 0.93, 0.98] as const,
  grit: [0.42, 0.45, 0.5] as const,
  /** Dry leaves torn up off the mountain's ledges. */
  leaf: [0.46, 0.38, 0.22] as const,
  leafGreen: [0.36, 0.42, 0.24] as const,
  mist: [0.78, 0.84, 0.9] as const,
  scorch: [0.06, 0.08, 0.1] as const,
  calmMote: [0.6, 1.0, 0.85] as const,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

/** Is this spot inside a Smith's Heart claim, and where is its origin? */
export function breathClaimOrigin(x: number, z: number): { x: number; z: number } | null {
  const def = DUNGEONS.smith_heart;
  if (!def) return null;
  const o = instanceOrigin(def.index, instanceSlotForZ(z));
  if (Math.abs(x - o.x) >= 300 || Math.abs(z - o.z) >= 260) return null;
  return o;
}

/** The Cornice's floor outline (instance-local), for the wind's field. */
export function corniceOutline(): readonly (readonly [number, number])[] {
  const s = SMITH_HEART_FIELD.surfaces.find((f) => f.id === 'storm_cornice');
  return s && s.kind === 'poly' ? s.points : [];
}

/** The Cornice's floor height (instance-local). */
export const CORNICE_FLOOR_H = BREATH.cornice.h;

// ---- the wind --------------------------------------------------------------------------

/** How the wind draws in a phase at `fill` (0..1 into it): `dust` the
 *  streams of dust over the floor (the readable direction, every tier),
 *  `strength` the streaks of wind in the air, `debris` the leaves, grit and
 *  torn mist it flings along, `speed` their flow (yards a second over the
 *  floor), `front` the gather's rolling front of dust (0..1 across the
 *  Cornice from upwind; -1 none: only behind it has the wind arrived),
 *  `inward` the pull toward the guardian (the indrawn breath, the storm
 *  breaking). */
export interface WindFieldLook {
  dust: number;
  strength: number;
  debris: number;
  speed: number;
  front: number;
  inward: boolean;
}

export function windFieldLook(
  phase: BreathWindPhase | null,
  fill: number,
  out: WindFieldLook = { dust: 0, strength: 0, debris: 0, speed: 0, front: -1, inward: false },
): WindFieldLook {
  const f = clamp01(fill);
  const last = smooth((f - 0.85) / 0.15);
  out.dust = 0;
  out.strength = 0;
  out.debris = 0;
  out.speed = 0;
  out.front = -1;
  out.inward = false;
  switch (phase) {
    case 'gather':
    case 'gustgather':
      // The coming wind: the dust starts to stream toward its bearing behind
      // a front rolling over the floor from upwind, the first streaks
      // stirring, gathering speed (with the guardian turning and the gather's
      // sound, the telegraph).
      out.dust = 0.3 + 0.6 * smooth(f);
      out.strength = 0.12 + 0.45 * smooth(f);
      out.debris = 0.25 * smooth(f);
      out.speed = 3 + 8 * f;
      out.front = smooth(f);
      break;
    case 'blow':
    case 'gust':
      // The blow: unmistakable, the dust racing, heavy streaks, leaves and
      // torn mist flung over the rim; it eases only in its last breath.
      out.dust = 1 - 0.25 * last;
      out.strength = 1 - 0.3 * last;
      out.debris = 1 - 0.5 * last;
      out.speed = 14;
      break;
    case 'calm':
      // The wind dying away over the first half of the calm.
      out.dust = 0.35 * (1 - smooth(f * 2.5));
      out.strength = 0.4 * (1 - smooth(f * 2));
      out.debris = 0.2 * (1 - smooth(f * 3));
      out.speed = 6 * (1 - f);
      break;
    case 'inhale':
    case 'break':
      // Drawn in (Jose's playtest of 2026-11-18: the pull is a real threat
      // now, and reads as one): the dust and the streaks spiral in to its
      // mouth from the first instant, hard and fast; no leaves.
      out.dust = 0.75 + 0.25 * smooth(f * 1.4);
      out.strength = 0.6 + 0.4 * smooth(f);
      out.debris = 0;
      out.speed = 12 + 10 * f;
      out.inward = true;
      break;
    case 'exhale':
      out.dust = 0.5;
      out.strength = 0.6;
      out.debris = 0.8;
      out.speed = 18;
      break;
    default:
      break;
  }
  return out;
}

/** The indrawn breath's whirl: every inward stream (the floor's dust, the
 *  air's streaks, the ropes of wind into the maw) bends along one log
 *  spiral round the guardian, `twist` radians more round it for each e-fold
 *  nearer (so it curls tighter as it closes in), all turning the same way:
 *  one vortex, never radial spokes. */
export const INHALE_SWIRL = { twist: 0.85 } as const;

/** The angle (radians) an inward stream that left `angle0` at `reach` yards
 *  out has turned to at `r` yards from the maw (the log spiral above). */
export function inhaleSwirlAngle(angle0: number, reach: number, r: number): number {
  return angle0 + INHALE_SWIRL.twist * Math.log(Math.max(1, reach) / Math.max(1, r));
}

/** The streaks of wind in the air over the Cornice (the wind-cue redesign of
 *  2026-11-25, Jose's approval: few, big gust ribbons, not signage): the
 *  SAME count on every tier (`count`, the wind's way is what a player acts
 *  on: docs/design/graphics-settings-fairness.md), each `minLen` to `maxLen`
 *  yards long and up to `width` wide, how far one wraps (yards) and how much
 *  faster than the dust it runs. */
export const WIND_STREAKS = {
  count: 8,
  minLen: 16,
  maxLen: 30,
  width: 0.55,
  span: 120,
  rate: 1.6,
} as const;

/** The wind's direction cue (the redesign of 2026-11-25, in place of the
 *  floor's chevron grid, which cluttered the Cornice and hid other
 *  telegraphs): a STORM WALL of cloud on the upwind edge of the Cornice (the
 *  side the wind blows from: a storm behind you pushes you forward), and on
 *  each turn of the wind a few small arrows down the Cornice's two SIDES
 *  (the edges parallel to the wind; Jose's look of 2026-11-25: the one big
 *  arrow in the middle was too big and sat where the raid fights),
 *  `arrowPerSide` a side, staggered along the flow, each lit `arrowSeconds`
 *  a little after the one upwind of it (`arrowStagger`), slightly
 *  translucent (`arrowOpacity`). The same on every tier. `wallHeight` the
 *  wall's top over the floor and `wallDrop` how far it hangs below the rim
 *  (yards), `wallOut` how far past the rim it stands (a share of the radii),
 *  `wallTurn` how fast it swings round to a new bearing (per second, eased),
 *  `arrowLength` and `arrowWidth` an arrow's yards, `arrowSide` how far out
 *  toward the rim a side's arrows stand (a share of the radius that way),
 *  `arrowSpacing` the yards between a side's arrows, `arrowIn` and
 *  `arrowOut` their fades. */
export const WIND_CUE = {
  wallHeight: 16,
  wallDrop: 10,
  wallOut: 1.04,
  wallTurn: 1.6,
  arrowSeconds: 1.6,
  arrowStagger: 0.15,
  arrowIn: 0.2,
  arrowOut: 0.5,
  arrowPerSide: 3,
  arrowLength: 8,
  arrowWidth: 5,
  arrowSide: 0.72,
  arrowSpacing: 12,
  arrowOpacity: 0.72,
} as const;

/** One small turn arrow's spot over the Cornice (claim-local) and its place
 *  along the flow (`k` 0 upwind first). */
export interface TurnArrowSpot {
  x: number;
  z: number;
  k: number;
}

/** The turn arrows' spots for the wind blowing along the unit `dir`: down the
 *  Cornice's two sides (the edges parallel to the wind), `arrowPerSide` a
 *  side spaced along the flow, the far side half a space on (staggered); each
 *  kept on the floor and clear of a lip (drawn in toward the middle or slid
 *  along a little if not, never in past 0.45 of its way out: nothing in the
 *  middle where the raid fights). Pure over the layout. */
export function turnArrowSpots(dir: { x: number; z: number }): TurnArrowSpot[] {
  const A = WIND_CUE;
  const C = BREATH.cornice;
  const sx = dir.z;
  const sz = -dir.x;
  const out: TurnArrowSpot[] = [];
  for (const side of [1, -1]) {
    // The Cornice's radius along the side's way (its ellipse).
    const r = 1 / Math.hypot((sx * side) / C.rx, (sz * side) / C.rz);
    const shift = side > 0 ? 0 : A.arrowSpacing / 2;
    for (let k = 0; k < A.arrowPerSide; k++) {
      const along = (k - (A.arrowPerSide - 1) / 2) * A.arrowSpacing + shift - A.arrowSpacing / 4;
      // Drawn in toward the middle (never past 0.45 of the way), or slid a
      // little along the flow, until it stands on the floor clear of a lip.
      search: for (let f = A.arrowSide; f >= 0.45 - 1e-9; f -= 0.05) {
        for (const slide of [0, -4, 4]) {
          const x = C.x + sx * side * r * f + dir.x * (along + slide);
          const z = C.z + sz * side * r * f + dir.z * (along + slide);
          if (!inBreathArena(x, z) || lipDistance(x, z) < A.arrowLength * 0.45) continue;
          out.push({ x, z, k });
          break search;
        }
      }
    }
  }
  return out;
}

/** The storm wall's strength for the wind's phase (0 hidden, 1 whole): whole
 *  while it blows, rising through the gather that telegraphs the coming
 *  bearing, gone in the calm and the indrawn breath (the pull has its own
 *  look), and in the storm half. */
export function stormWallLook(phase: BreathWindPhase | null, fill: number): number {
  switch (phase) {
    case 'gather':
    case 'gustgather':
      return 0.45 + 0.45 * smooth(clamp01(fill));
    case 'blow':
    case 'gust':
      return 1;
    default:
      return 0;
  }
}

/** Does the wind's phase show a bearing the turn arrow may announce? */
export function windShowsBearing(phase: BreathWindPhase | null): boolean {
  return phase === 'gather' || phase === 'gustgather' || phase === 'blow' || phase === 'gust';
}

/** A turn arrow's opacity `t` seconds after the wind turned, `k` places down
 *  the flow (each lit `arrowStagger` after the one upwind of it, so the row
 *  reads as the wind running along it): a quick fade in, held, faded out,
 *  times the arrows' translucency. All done by `arrowSeconds` plus the
 *  stagger of the last (about two seconds). */
export function turnArrowAlphaAt(t: number, k: number): number {
  return turnArrowAlpha(t - k * WIND_CUE.arrowStagger) * WIND_CUE.arrowOpacity;
}

/** One arrow's fade `t` seconds after it lit (0 before and after its
 *  window): a quick fade in, held, then faded out by `arrowSeconds`. */
export function turnArrowAlpha(t: number): number {
  const A = WIND_CUE;
  if (!(t >= 0) || t >= A.arrowSeconds) return 0;
  if (t < A.arrowIn) return smooth(t / A.arrowIn);
  const out = A.arrowSeconds - A.arrowOut;
  return t <= out ? 1 : 1 - smooth((t - out) / A.arrowOut);
}

/** How much of the storm wall stands at a point of the rim whose outward
 *  unit normal is (nx, nz), with the wind blowing along the unit (dx, dz):
 *  whole on the side it blows FROM, gone on the side it blows toward. */
export function stormWallWeight(nx: number, nz: number, dx: number, dz: number): number {
  const up = -(nx * dx + nz * dz);
  return smooth(clamp01((up - 0.2) / 0.7));
}

/** Turn `cur` (a unit x, z) toward the unit `target` by `k` (0..1) of the
 *  angle between them, kept unit: it swings round (a reversal the same way
 *  every time), never collapsing through zero. Mutates and returns `cur`. */
export function easeDir(
  cur: { x: number; z: number },
  target: { x: number; z: number },
  k: number,
): { x: number; z: number } {
  const a = Math.atan2(cur.x, cur.z);
  let diff = Math.atan2(target.x, target.z) - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff <= -Math.PI) diff += Math.PI * 2;
  const n = a + diff * clamp01(k);
  cur.x = Math.sin(n);
  cur.z = Math.cos(n);
  return cur;
}

/** Where the wind's sound is heard from: `back` yards upwind of `at` (the
 *  local player), along the unit wind `dir`. */
export function upwindHeardAt(
  at: { x: number; y: number; z: number },
  dir: { x: number; z: number },
  back = 24,
  out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): { x: number; y: number; z: number } {
  out.x = at.x - dir.x * back;
  out.y = at.y;
  out.z = at.z - dir.z * back;
  return out;
}

/** Streak `i`'s seed (deterministic): `across` -1..1 over the span, `lift`
 *  0..1 (squared into 0.4 to 6.5 yd over the floor: most hug it), `phase`
 *  0..1 along its wrap, `length` 0..1 (4 to 11 yd). */
export function windStreakSeed(i: number): {
  across: number;
  lift: number;
  phase: number;
  length: number;
} {
  return {
    across: fxHash01(i, 11) * 2 - 1,
    lift: fxHash01(i, 23),
    phase: fxHash01(i, 37),
    length: fxHash01(i, 41),
  };
}

/** The unit (x, z) a compass bearing (degrees, toward) points along. */
export function bearingDir(
  deg: number,
  out: { x: number; z: number } = { x: 0, z: 0 },
): { x: number; z: number } {
  const a = (deg * Math.PI) / 180;
  out.x = Math.sin(a);
  out.z = Math.cos(a);
  return out;
}

/** gapThreat's scratch (it runs every frame for every lip). */
const _dir = { x: 0, z: 0 };

/** Is the phase one that pushes players (the floor shows the push)? */
export function windPushes(phase: BreathWindPhase | null): boolean {
  return phase === 'blow' || phase === 'gust';
}

// ---- the gaps --------------------------------------------------------------------------

/** One stretch of the open lip: its segments (instance-local, each with the
 *  outward normal toward the void) and its bearing from the Cornice's
 *  middle. Since the open rim (2026-11-03) the whole edge is lethal: it is
 *  drawn as LIP_SECTORS stretches, each flaring on its own when the wind
 *  blows its way. */
export interface GapLip {
  deg: number;
  x: number;
  z: number;
  segments: { ax: number; az: number; bx: number; bz: number; nx: number; nz: number }[];
}

/** How many stretches the open rim is drawn in (the lip shader's eight). */
export const LIP_SECTORS = 8;

/** The open rim's stretches, read off the field's own cliff runs (the runs
 *  the field builds no wall for), so the lip drawn IS the lip that kills;
 *  each run goes to the sector of its bearing. */
export function gapLips(): GapLip[] {
  const C = BREATH.cornice;
  const runs = authoredFieldCliffRuns(SMITH_HEART_FIELD).filter(
    (r) => r.open && r.surface === 'storm_cornice',
  );
  const out: GapLip[] = [];
  for (let k = 0; k < LIP_SECTORS; k++) {
    const deg = (k + 0.5) * (360 / LIP_SECTORS);
    const a = (deg * Math.PI) / 180;
    out.push({
      deg,
      x: C.x + Math.sin(a) * C.rx,
      z: C.z + Math.cos(a) * C.rz,
      segments: [],
    });
  }
  for (const r of runs) {
    const mx = (r.ax + r.bx) / 2 - C.x;
    const mz = (r.az + r.bz) / 2 - C.z;
    const deg = ((Math.atan2(mx, mz) * 180) / Math.PI + 360) % 360;
    const k = Math.min(LIP_SECTORS - 1, Math.floor(deg / (360 / LIP_SECTORS)));
    out[k].segments.push({ ax: r.ax, az: r.az, bx: r.bx, bz: r.bz, nx: r.nx, nz: r.nz });
  }
  return out;
}

/** How hard a gap's lip burns (0 quiet, 1 the wind blowing at it): a lip
 *  always reads lethal; it flares when a push points its way. */
export function gapThreat(
  gap: { x: number; z: number },
  phase: BreathWindPhase | null,
  bearingDeg: number,
): number {
  const push = windPushes(phase) || phase === 'gather' || phase === 'gustgather';
  if (!push) return phase === 'exhale' ? 0.7 : 0;
  const d = bearingDir(bearingDeg, _dir);
  const gx = gap.x - BREATH.cornice.x;
  const gz = gap.z - BREATH.cornice.z;
  const len = Math.hypot(gx, gz) || 1;
  const cos = (d.x * gx + d.z * gz) / len;
  const k = smooth((cos - 0.35) / 0.55);
  // The gather burns nearly as hard as the blow (the team's review of
  // 2026-11-17: a clear warning of where it will blow, on the longer gather).
  return phase === 'gather' || phase === 'gustgather' ? k * 0.9 : k;
}

// ---- Thessaly's calm ----------------------------------------------------------------------

/** The circle of calm's look in a state at `fill` (0..1 into the state). */
export function calmLook(
  state: BreathCalmState,
  fill: number,
): { fill: number; fade: number; dome: number; beam: number } {
  const f = clamp01(fill);
  if (state === 'land') return { fill: f, fade: 1, dome: 0, beam: 1 - 0.6 * f };
  if (state === 'hold')
    return { fill: 1, fade: 1 - 0.35 * smooth((f - 0.8) / 0.2), dome: 1, beam: 0 };
  return { fill: 1, fade: 0.45 * (1 - f), dome: 0.3 * (1 - f), beam: 0 };
}

/** Seats a circle still offers when `anchoredInside` anchored players stand
 *  in it (its three pips light the free ones). */
export function calmSeatsLeft(anchoredInside: number): number {
  return Math.max(0, T.circleSeats - Math.max(0, anchoredInside));
}

// ---- the storm's spots ----------------------------------------------------------------

/** A strike's warning filling (`age` seconds into its `warn`). */
export function strikeFill(age: number, warn: number): number {
  return warn > 0 ? clamp01(age / warn) : 1;
}

/** Charged ground `age` seconds into its `life`: how bright it still bites
 *  (full, then fading over its last three seconds). */
export function chargedFade(age: number, life: number): number {
  if (life <= 0) return 1;
  return 0.35 + 0.65 * (1 - smooth((age - (life - 3)) / 3));
}

/** The Thunder's Cradle `age` seconds into its `hold`: the gather circle's
 *  fill and the crown's charge. */
export function cradleLook(age: number, hold: number): { fill: number; charge: number } {
  const f = hold > 0 ? clamp01(age / hold) : 1;
  return { fill: f, charge: 0.3 + 0.7 * smooth(f) };
}

/** How many players a Thunder's Cradle circle wants under it, read off the
 *  claim's difficulty (the run view) or, failing that, off the circles: only
 *  Heroic and Mythic lift more than one (BREATH_DIFFICULTY cradleCount). */
export function cradleNeedOf(difficulty: string | null | undefined, circles: number): number {
  const tier = difficulty === 'heroic' || circles > 1 ? 'heroic' : 'normal';
  return BREATH_DIFFICULTY[tier].cradleSoakers;
}

/** A strike's bolt from the cloud: a jagged path from `height` down to the
 *  floor, every point within `spread` of the strike's axis. Deterministic. */
export function strikeBoltPath(
  seed: number,
  height: number,
  spread: number,
  segments = 14,
): { x: number; y: number; z: number }[] {
  const pts: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const taper = i === segments ? 0 : 1 - t * 0.6;
    pts.push({
      x: (fxHash01(seed, i * 2) - 0.5) * 2 * spread * taper,
      y: height * (1 - t),
      z: (fxHash01(seed, i * 2 + 1) - 0.5) * 2 * spread * taper,
    });
  }
  return pts;
}

/** Seconds a strike's bolt burns, its scorch smoulders, a fork's leg flares. */
export const STRIKE_BOLT_SECONDS = 0.45;
export const STRIKE_SCORCH_SECONDS = 2.5;
export const FORK_BEAM_SECONDS = 0.4;
export const ANCHOR_BEAM_SECONDS = 0.7;

/** A beam's flare `elapsed` seconds in (a hard flash, a flicker, gone). */
export function boltFlare(elapsed: number, seconds: number): number {
  if (elapsed < 0 || elapsed >= seconds) return 0;
  const flick = elapsed < 0.06 ? 1 : elapsed < 0.12 ? 0.45 : elapsed < 0.2 ? 0.95 : 0.55;
  return flick * (1 - elapsed / seconds) ** 0.6;
}

// ---- the loose gales, the vortex -------------------------------------------------------

/** A loose gale's column: its height and how its funnel widens up it. */
export const GALE_COLUMN = { height: 10, topScale: 1.6, spin: 3.2 } as const;
/** A gale's inner core (a share of its column's width and height, its spin a
 *  multiple of the column's): a storm with a dark heart and a skirt of grit,
 *  never a bare cone (its foot's dust is breath_gale_glsl.ts `GALE_FOOT_DUST`). */
export const GALE_CORE = {
  width: 0.5,
  height: 0.85,
  spin: 1.7,
  /** The scoured grit: warmer and darker than the pale Cornice, so it reads on it. */
  dustColor: [0.38, 0.34, 0.31] as const,
} as const;
/** The vortex's funnel before the guardian's mouth. */
export const VORTEX_FUNNEL = { height: 6, topScale: 1.9, spin: 4.5 } as const;

/** The pinned player's mark: an arc at their feet facing the wall (degrees,
 *  yards). */
export const PINNED_MARK = { arcDeg: 140, r: 1.9 } as const;

/** The leaping bolt's bar draws its jump reach round its first target, so
 *  the raid sees how far to spread. */
export const FORK_REACH = T.forkJump;

// ---- what this painter claims ---------------------------------------------------------

const CLAIMED: ReadonlySet<string> = new Set([
  BREATH_CUES.strike,
  BREATH_CUES.fork,
  BREATH_CUES.discharge,
  BREATH_CUES.tear,
  BREATH_CUES.swell,
  BREATH_CUES.toss,
  BREATH_CUES.blow,
  BREATH_CUES.thunder,
  BREATH_CUES.thunderDraw,
  BREATH_CUES.calmLand,
  BREATH_CUES.anchor,
  BREATH_CUES.fall,
  BREATH_CUES.roarHit,
]);

/** Is this cue the fight painter's (the renderer's generic draw skipped)? */
export function breathFightClaims(ability: string | undefined): boolean {
  return ability !== undefined && CLAIMED.has(ability);
}

/** Which kind of fight object a template is, or null. */
export type BreathObjectKind =
  | 'wind'
  | 'calm'
  | 'vortex'
  | 'gale'
  | 'strike'
  | 'charged'
  | 'cradle';

export function breathObjectKind(templateId: string): BreathObjectKind | null {
  const O = BREATH_OBJECTS;
  if (templateId.startsWith(O.windPrefix)) return 'wind';
  if (templateId.startsWith(O.calmPrefix)) return 'calm';
  if (templateId === O.vortex) return 'vortex';
  if (templateId === O.gale) return 'gale';
  if (templateId.startsWith(O.strikePrefix)) return 'strike';
  if (templateId.startsWith(O.chargedPrefix)) return 'charged';
  if (templateId.startsWith(O.cradlePrefix)) return 'cradle';
  return null;
}

/** Pool sizes at full density (the low tier thins emitted counts only). */
export const BREATH_FIGHT_POOLS = {
  calm: 2,
  vortex: 1,
  gales: 4,
  strikes: 14,
  charged: 14,
  /** Heroic and mythic lift three at once (BREATH_DIFFICULTY cradleCount). */
  cradles: 3,
  marks: 12,
  bolts: 10,
  beams: 12,
  scorches: 10,
  seats: 3,
  crowns: 1,
  beacons: 3,
} as const;

/** A small integer hash in [0, 1). */
export function fxHash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2c1b3c6d) ^ Math.imul(b | 0, 0x297a2d39)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
