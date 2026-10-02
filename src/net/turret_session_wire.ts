// Decoders for the Fire and Fly wire: the owner-only `turp` (plan) and `tur`
// (seat state) self keys and the `turretDefense` feedback event. Untrusted JSON:
// every field is re-validated against the sim's own types (a spec per shape, so
// a field the sim adds fails tsc here until it is decoded), numbers finite,
// enums closed, arrays bounded, and a malformed payload rejects the whole
// value, never a stale half.
import { TURRET_ARENA } from '../sim/content/turret_defense';
import { deepFreeze } from '../sim/deep_freeze';
import { FIRE_AND_FLY_MAX_POINTS } from '../sim/fire_and_fly_personal_records';
import type { MotionSegment } from '../sim/minigames/thrown_body';
import type { TurretBarrel } from '../sim/minigames/turret_barrels';
import type {
  TurretBarrelSpot,
  TurretEvent,
  TurretHit,
  TurretShot,
  TurretStats,
} from '../sim/minigames/turret_defense';
import {
  TURRET_PLAN_LIMITS,
  type TurretArsenal,
  type TurretKind,
  type TurretPlan,
  type TurretWavePlan,
  turretMedalBarsValid,
  turretScenarioIdValid,
} from '../sim/minigames/turret_defense_plan';
import type { TurretFeedback } from '../sim/minigames/turret_feedback';
import { TURRET_BOMBLETS, type TurretBombletSpot } from '../sim/minigames/turret_fragmentation';
import {
  TURRET_BONUS_CAP,
  TURRET_POINTS,
  type TurretMedal,
  type TurretPointsBreakdown,
  type TurretResult,
} from '../sim/minigames/turret_result';
import type {
  TurretDefenseView,
  TurretMonsterView,
  TurretSessionView,
} from '../sim/turret_defense_session';
import type {
  TurretArrivalDef,
  TurretBarrelWaveDef,
  TurretBowlingDef,
  TurretMedalBar,
  TurretMedalBars,
  Vec3,
} from '../sim/types';

/** The seat as the wire carries it, the plan joined back in: the view minus its feedback ring. */
export type TurretSeatState = Omit<TurretSessionView, 'feedback'>;

// Bounds on a forged payload, far above the content (a mission wave spawns a few dozen
// monsters, a keg cap is at most the plan's barrel limit, at most 2 shells fly at once).
// The plan's are the resolver's own limits, so every plan the server resolves decodes.
const MAX_MONSTERS = 256;
const MAX_SHOTS = 32;
const MAX_BARRELS = 64;
const MAX_HITS = 256;
const MAX_TEMPLATE_ID = 64;
const MAX_MAGNITUDE = 1e9;
const LIMITS = TURRET_PLAN_LIMITS;
// A Shockwave's ring never rolls past the ring the monsters spawn on.
const MAX_SHOCKWAVE_REACH = TURRET_ARENA.spawnRadius;
// The most each points term can reach on a plan the resolver accepts.
const MAX_KILL_POINTS = LIMITS.waves * LIMITS.spawnsPerWave * TURRET_POINTS.kill;
const MAX_TOWER_POINTS = LIMITS.integrity * TURRET_POINTS.integrity;

const BAD: unique symbol = Symbol('malformed');
type Dec<T> = (value: unknown) => T | typeof BAD;
type Spec<T> = { [K in keyof T]-?: Dec<T[K]> };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const num: Dec<number> = (v) =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_MAGNITUDE ? v : BAD;
const positive: Dec<number> = (v) => (num(v) !== BAD && (v as number) > 0 ? (v as number) : BAD);
const nonNegative: Dec<number> = (v) =>
  num(v) !== BAD && (v as number) >= 0 ? (v as number) : BAD;
const int =
  (min: number): Dec<number> =>
  (v) =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= min ? v : BAD;
const count = int(0);
/** A sim tick, fractional where a contact lands between ticks, or -1 where the sim marks "none". */
const tick: Dec<number> = (v) => (num(v) !== BAD && (v as number) >= -1 ? (v as number) : BAD);
const bool: Dec<boolean> = (v) => (typeof v === 'boolean' ? v : BAD);
const text =
  (max: number): Dec<string> =>
  (v) =>
    typeof v === 'string' && v.length > 0 && v.length <= max ? v : BAD;
const oneOf =
  <T extends string>(...values: readonly T[]): Dec<T> =>
  (v) =>
    values.includes(v as T) ? (v as T) : BAD;
const lit = <T extends string>(value: T): Dec<T> => oneOf(value);
const within =
  (min: number, max: number): Dec<number> =>
  (v) =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max ? v : BAD;
/** A share of a full turn: above 0, at most 1. */
const turn: Dec<number> = (v) =>
  num(v) !== BAD && (v as number) > 0 && (v as number) <= 1 ? (v as number) : BAD;
const flankCount: Dec<2 | 3> = (v) => (v === 2 || v === 3 ? v : BAD);
/** A share of a whole: above 0, at most 1. */
const share: Dec<number> = turn;
const scenarioId: Dec<string> = (v) =>
  typeof v === 'string' && turretScenarioIdValid(v) ? v : BAD;

function nullable<T>(item: Dec<T>): Dec<T | null> {
  return (v) => (v === null ? null : item(v));
}

/** Absent reads as absent (`shape` then leaves the key out); anything present must decode. */
function optional<T>(item: Dec<T>): Dec<T | undefined> {
  return (v) => (v === undefined ? undefined : item(v));
}

/** `decode`, then `valid` on what it decoded: a cross-field rule the shape cannot state. */
function checked<T>(decode: Dec<T>, valid: (value: T) => boolean): Dec<T> {
  return (v) => {
    const decoded = decode(v);
    return decoded !== BAD && valid(decoded) ? decoded : BAD;
  };
}

function list<T>(max: number, item: Dec<T>): Dec<T[]> {
  return (v) => {
    if (!Array.isArray(v) || v.length > max) return BAD;
    const out: T[] = [];
    for (const row of v) {
      const decoded = item(row);
      if (decoded === BAD) return BAD;
      out.push(decoded);
    }
    return out;
  };
}

function shape<T>(spec: Spec<T>): Dec<T> {
  return (v) => {
    if (!record(v)) return BAD;
    const out: Record<string, unknown> = {};
    for (const key in spec) {
      const decoded = spec[key](v[key]);
      if (decoded === BAD) return BAD;
      if (decoded !== undefined) out[key] = decoded;
    }
    return out as T;
  };
}

function tagged<T, Tag extends keyof T & string>(
  tag: Tag,
  arms: { [K in T[Tag] & string]: Dec<Extract<T, Record<Tag, K>>> },
): Dec<T> {
  const table = arms as unknown as Record<string, Dec<T>>;
  return (v) => {
    if (!record(v)) return BAD;
    const kind = v[tag];
    return typeof kind === 'string' && Object.hasOwn(table, kind) ? table[kind](v) : BAD;
  };
}

type Arm<T, Tag extends keyof T, K> = Spec<Extract<T, Record<Tag, K>>>;
const eventArm = <K extends TurretEvent['type']>(spec: Arm<TurretEvent, 'type', K>) =>
  shape<Extract<TurretEvent, { type: K }>>(spec);
const segmentArm = <K extends MotionSegment['kind']>(spec: Arm<MotionSegment, 'kind', K>) =>
  shape<Extract<MotionSegment, { kind: K }>>(spec);
const arrivalArm = <K extends TurretArrivalDef['kind']>(spec: Arm<TurretArrivalDef, 'kind', K>) =>
  shape<Extract<TurretArrivalDef, { kind: K }>>(spec);

const at = { x: num, y: num, z: num };
const vec3 = shape<Vec3>(at);

/** Charges spent: at most the most any plan the resolver accepts can hold (the seat checks its own). */
const charges = within(0, LIMITS.charges);
/** A run's Shockwaves are numbered from 1, one per charge spent. */
const shockwaveId = within(1, LIMITS.charges);
/** Shell ids start at 1. */
const shotId = int(1);
/** A whole sim tick, capped like every other wire number. */
const wholeTick = within(0, MAX_MAGNITUDE);
const bombletIndex = within(0, TURRET_BOMBLETS - 1);

/** A frag shell is also a shot, so the frags spent never exceed the shots fired. */
const stats = checked(
  shape<TurretStats>({
    shots: count,
    hits: count,
    kills: count,
    breaches: count,
    pointsLost: count,
    longestThrow: nonNegative,
    longestAirtime: nonNegative,
    bowled: count,
    barrelsDetonated: count,
    barrelKills: count,
    shockwaves: charges,
    frags: charges,
  }),
  (st) => st.frags <= st.shots,
);

const hit = shape<TurretHit>({ id: count, falloff: num, damage: num, ...at });

const medal: Dec<TurretMedal | null> = nullable(oneOf('gold', 'silver', 'bronze'));
const points = within(0, FIRE_AND_FLY_MAX_POINTS);
const breakdown = checked(
  shape<TurretPointsBreakdown>({
    kills: within(0, MAX_KILL_POINTS),
    integrity: within(0, MAX_TOWER_POINTS),
    kegKills: within(0, TURRET_BONUS_CAP),
    bowled: within(0, TURRET_BONUS_CAP),
  }),
  (b) => b.kegKills + b.bowled <= TURRET_BONUS_CAP,
);

/** The whole star in landing order: every bomblet once, by index, none before the one ahead. */
function bombletSchedule(star: readonly TurretBombletSpot[]): boolean {
  return (
    star.length === TURRET_BOMBLETS &&
    star.every((b, i) => b.index === i && (i === 0 || b.landTick >= star[i - 1].landTick))
  );
}

/** A run's result as the sim builds it: its terms sum to its points, only a win holds a medal. */
function resultConsistent(won: boolean, r: Omit<TurretResult, 'won'>): boolean {
  const b = r.breakdown;
  return r.points === b.kills + b.integrity + b.kegKills + b.bowled && won === (r.medal !== null);
}

const result = checked(shape<TurretResult>({ won: bool, medal, points, breakdown }), (r) =>
  resultConsistent(r.won, r),
);

const turretEvent = tagged<TurretEvent, 'type'>('type', {
  fired: eventArm({
    type: lit('fired'),
    shotId,
    fromX: num,
    fromZ: num,
    ...at,
    flightTicks: nonNegative,
    impactTick: tick,
    weapon: optional(lit('frag')),
  }),
  impact: eventArm({ type: lit('impact'), shotId, ...at, hits: list(MAX_HITS, hit) }),
  launched: eventArm({ type: lit('launched'), id: count, ...at, vx: num, vy: num, vz: num }),
  bounce: eventArm({
    type: lit('bounce'),
    id: count,
    surface: oneOf('ground', 'wall'),
    ...at,
    speed: num,
  }),
  landed: eventArm({ type: lit('landed'), id: count, ...at }),
  bowled: eventArm({
    type: lit('bowled'),
    flyerId: count,
    struckId: count,
    ...at,
    speed: num,
    damage: num,
  }),
  splash: eventArm({ type: lit('splash'), id: count, ...at }),
  killed: eventArm({ type: lit('killed'), id: count, ...at }),
  windupStart: eventArm({ type: lit('windupStart'), id: count, x: num, z: num }),
  breach: eventArm({ type: lit('breach'), id: count, points: num, integrity: num, ...at }),
  vanished: eventArm({ type: lit('vanished'), id: count, ...at }),
  waveStart: eventArm({ type: lit('waveStart'), wave: count, count }),
  barrelsPlaced: eventArm({
    type: lit('barrelsPlaced'),
    barrels: list(MAX_BARRELS, shape<TurretBarrelSpot>({ id: count, ...at })),
  }),
  barrelLit: eventArm({ type: lit('barrelLit'), id: count, ...at, fuseTicks: nonNegative }),
  barrelExploded: eventArm({
    type: lit('barrelExploded'),
    id: count,
    ...at,
    hits: list(MAX_HITS, hit),
  }),
  waveCleared: eventArm({ type: lit('waveCleared'), wave: count }),
  shockwave: eventArm({
    type: lit('shockwave'),
    id: shockwaveId,
    ...at,
    startTick: wholeTick,
    reach: checked(positive, (r) => r <= MAX_SHOCKWAVE_REACH),
  }),
  shockwaveHit: eventArm({
    type: lit('shockwaveHit'),
    id: shockwaveId,
    hits: list(MAX_HITS, hit),
  }),
  fragBurst: eventArm({
    type: lit('fragBurst'),
    shotId,
    ...at,
    bomblets: checked(
      list(TURRET_BOMBLETS, shape<TurretBombletSpot>({ index: count, ...at, landTick: wholeTick })),
      bombletSchedule,
    ),
  }),
  bomblet: eventArm({
    type: lit('bomblet'),
    shotId,
    index: bombletIndex,
    ...at,
    hits: list(MAX_HITS, hit),
  }),
  ended: checked(
    eventArm({
      type: lit('ended'),
      result: oneOf('won', 'lost'),
      stats,
      medal,
      points,
      breakdown,
    }),
    (e) => resultConsistent(e.result === 'won', e),
  ),
});

const segment = tagged<MotionSegment, 'kind'>('kind', {
  march: segmentArm({
    kind: lit('march'),
    start: num,
    end: num,
    ...at,
    dx: num,
    dz: num,
    speed: num,
  }),
  fly: segmentArm({
    kind: lit('fly'),
    start: num,
    end: num,
    ...at,
    vx: num,
    vy: num,
    vz: num,
    g: num,
    contact: oneOf('ground', 'water', 'wall', 'void'),
    nx: num,
    nz: num,
  }),
  skid: segmentArm({
    kind: lit('skid'),
    start: num,
    end: num,
    ...at,
    vx: num,
    vz: num,
    decel: num,
    contact: oneOf('stop', 'wall', 'water'),
  }),
  still: segmentArm({ kind: lit('still'), start: num, end: num, ...at }),
});

const monster = shape<TurretMonsterView>({
  id: count,
  kind: count,
  hp: nonNegative,
  maxHp: positive,
  state: oneOf('march', 'windup', 'fly', 'skid', 'down', 'rise', 'dead', 'gone'),
  seg: segment,
  facing: num,
});

const shot = shape<TurretShot>({
  id: shotId,
  x: num,
  z: num,
  damage: num,
  firedTick: tick,
  impactTick: tick,
  weapon: optional(lit('frag')),
});

const barrel = shape<TurretBarrel>({ id: count, ...at, litTick: tick, blowTick: tick });

const defense = shape<Omit<TurretDefenseView, 'plan'>>({
  cx: num,
  cz: num,
  startTick: tick,
  rev: count,
  phase: oneOf('intro', 'wave', 'between', 'won', 'lost'),
  phaseEndTick: tick,
  wave: count,
  integrity: num,
  readyTick: tick,
  shockReadyTick: wholeTick,
  aimX: num,
  aimZ: num,
  shots: list(MAX_SHOTS, shot),
  monsters: list(MAX_MONSTERS, monster),
  barrels: list(MAX_BARRELS, barrel),
  stats,
  result: optional(result),
});

const seat = shape({ origin: vec3, defense, waveCount: count, monstersLeft: count });

const arrival = tagged<TurretArrivalDef, 'kind'>('kind', {
  ring: arrivalArm({ kind: lit('ring') }),
  arc: arrivalArm({ kind: lit('arc'), widthTurn: turn }),
  flanks: arrivalArm({ kind: lit('flanks'), count: flankCount, widthTurn: turn }),
  burst: arrivalArm({
    kind: lit('burst'),
    groupSize: within(1, LIMITS.spawnsPerWave),
    groupGapTicks: within(0, LIMITS.groupGapTicks),
    widthTurn: turn,
  }),
});

const medalBar = shape<TurretMedalBar>({ minIntegrityShare: share });

const plan = shape<TurretPlan>({
  scenarioId,
  integrity: within(1, LIMITS.integrity),
  medals: shape<TurretMedalBars>({ gold: medalBar, silver: medalBar }),
  arsenal: shape<TurretArsenal>({
    shockwave: within(0, LIMITS.charges),
    fragmentation: within(0, LIMITS.charges),
  }),
  kinds: list(
    LIMITS.kinds,
    shape<TurretKind>({
      templateId: text(MAX_TEMPLATE_ID),
      level: count,
      sizeClass: oneOf('small', 'medium', 'large', 'huge'),
      maxHp: positive,
      marchSpeed: nonNegative,
      mass: positive,
      radius: positive,
      breachValue: nonNegative,
      height: positive,
    }),
  ),
  waves: list(
    LIMITS.waves,
    shape<TurretWavePlan>({
      spawns: list(LIMITS.spawnsPerWave, count),
      coreDamage: num,
      gapMinTicks: count,
      gapMaxTicks: count,
      barrels: shape<TurretBarrelWaveDef>({
        count: within(0, LIMITS.barrels),
        minRadius: num,
        maxRadius: num,
        placement: optional(lit('lanes')),
        cap: optional(within(1, LIMITS.barrels)),
      }),
      arrival,
    }),
  ),
  bowling: shape<TurretBowlingDef>({
    enabled: bool,
    minSpeed: num,
    reachScale: num,
    transfer: num,
    pop: num,
    damageShare: num,
    flyerKeep: num,
    lyingHeight: num,
  }),
});

/**
 * An entry against its own tick: a Shockwave starts on the tick it is recorded on,
 * and a frag's bomblets all land after the burst.
 */
function entryTimed({ tick: at, event }: TurretFeedback): boolean {
  if (event.type === 'shockwave') return event.startTick === at;
  if (event.type === 'fragBurst') return event.bomblets.every((b) => b.landTick > at);
  return true;
}

const feedback = checked(
  shape<TurretFeedback>({ seq: int(1), tick: count, event: turretEvent }),
  entryTimed,
);

/** The `turp` key: the resolved plan, deep-frozen like the sim's, or null. */
export function decodeTurretPlan(value: unknown): TurretPlan | null {
  const decoded = plan(value);
  if (decoded === BAD || decoded.waves.length === 0) return null;
  if (!turretMedalBarsValid(decoded.medals, decoded.integrity)) return null;
  const kinds = decoded.kinds.length;
  for (const wave of decoded.waves) if (wave.spawns.some((kind) => kind >= kinds)) return null;
  return deepFreeze(decoded);
}

/**
 * The limited weapons against the plan: never more charges spent than it gave,
 * no more frag shells flying than were spent, and the Shockwave's rearm at the
 * seat's start until the first one, after it since.
 */
function armsConsistent(defense: Omit<TurretDefenseView, 'plan'>, turretPlan: TurretPlan): boolean {
  const { stats, startTick, shockReadyTick } = defense;
  const flying = defense.shots.filter((shot) => shot.weapon === 'frag').length;
  return (
    stats.shockwaves <= turretPlan.arsenal.shockwave &&
    stats.frags <= turretPlan.arsenal.fragmentation &&
    flying <= stats.frags &&
    (stats.shockwaves === 0 ? shockReadyTick === startTick : shockReadyTick > startTick)
  );
}

/** The `tur` key against its plan: the seat minus the feedback ring, or null. */
export function decodeTurretSeat(value: unknown, turretPlan: TurretPlan): TurretSeatState | null {
  const decoded = seat(value);
  if (decoded === BAD) return null;
  const { kinds, waves } = turretPlan;
  const { phase, result: outcome } = decoded.defense;
  const ended = phase === 'won' || phase === 'lost';
  if (
    !armsConsistent(decoded.defense, turretPlan) ||
    decoded.waveCount !== waves.length ||
    decoded.defense.wave >= waves.length ||
    decoded.defense.monsters.some((m) => m.kind >= kinds.length) ||
    (outcome === undefined ? ended : !ended || outcome.won !== (phase === 'won'))
  )
    return null;
  return { ...decoded, defense: { ...decoded.defense, plan: turretPlan } };
}

/** One `turretDefense` event as the feedback entry it was recorded as, deep-frozen, or null. */
export function decodeTurretFeedback(value: unknown): TurretFeedback | null {
  const decoded = feedback(value);
  return decoded === BAD ? null : deepFreeze(decoded);
}

/** True when two decoded seats are one run: the same arena tower and the same start tick. */
export function sameTurretSeat(a: TurretSeatState, b: TurretSeatState): boolean {
  return (
    a.defense.startTick === b.defense.startTick &&
    a.origin.x === b.origin.x &&
    a.origin.y === b.origin.y &&
    a.origin.z === b.origin.z
  );
}
