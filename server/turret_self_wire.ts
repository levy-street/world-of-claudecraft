// The Fire and Fly keys of the snapshot self record, beside the quest self-key
// leaf that calls it (game.ts sits at a zero-margin monolith ceiling). The
// feedback ring is not here: the owner-scoped `turretDefense` event carries each
// entry, and the client rebuilds the ring from those.
import type { TurretStats } from '../src/sim/minigames/turret_defense';
import type { TurretPlan } from '../src/sim/minigames/turret_defense_plan';
import type { PlayerMeta } from '../src/sim/sim';
import { type TurretSessionView, turretSessionView } from '../src/sim/turret_defense_session';
import type { TurretSession } from '../src/sim/types';

type EmitRawSelfKey = (key: string, serialized: string) => void;

/** The seat as the client reassembles it: the view minus its feedback ring and its plan. */
export type TurretSeatWireSource = Omit<TurretSessionView, 'feedback' | 'defense'> & {
  readonly defense: Omit<TurretSessionView['defense'], 'plan'>;
};

/**
 * The seat state's key family. A monster's record only changes at a transition, so the
 * state rides several keys and the self record's per-session diff resends only the ones
 * whose text moved: `tur` the seat and its rarely moving scalars (and the bucket count),
 * `tuv` the engine revision, `tua` the aim and reload, `tus` the shells, `tub` the kegs,
 * `tut` the stats, and `tu0` to `tu31` the monsters, a monster riding bucket `id % 32` in
 * the engine's order (ascending id). No self key outside the family and the plan's `turp`
 * starts with `tu`.
 */
export const TURRET_MONSTER_BUCKETS = 32;
export const TURRET_MONSTER_KEYS: readonly string[] = Array.from(
  { length: TURRET_MONSTER_BUCKETS },
  (_, i) => `tu${i}`,
);
export const TURRET_SEAT_KEYS: readonly string[] = [
  'tur',
  'tuv',
  'tua',
  'tus',
  'tub',
  'tut',
  ...TURRET_MONSTER_KEYS,
];

const stateParts = new WeakMap<TurretSession, { rev: number; tick: number; parts: string[] }>();
const planJson = new WeakMap<TurretPlan, string>();
const NULL_PARTS: readonly string[] = TURRET_SEAT_KEYS.map(() => 'null');

// A march multiplies its direction and its speed by the length of the walk.
const FINE_KEYS: ReadonlySet<string> = new Set(['dx', 'dz', 'speed']);
// The result card formats these itself: rounding them first could flip its last digit.
const EXACT_KEYS: ReadonlySet<string> = new Set([
  'longestThrow',
  'longestAirtime',
] satisfies (keyof TurretStats)[]);

/**
 * The state replacer: a non-integer to 3 decimals (positions to the millimetre, speeds to
 * 1 mm/s, contact ticks to 50 microseconds), a march's direction and speed to 5, the result
 * card's distance and airtime exact; ids, ticks and counts stay exact. The client reads the
 * rounded seat: the online view equals the authoritative one within 1e-3. The half step
 * stays under the 1e-3 the renderer allows when it matches a contact to the segment that
 * starts there (the landing dust and the slide trail).
 */
export function turretWireNumber(key: string, value: unknown): unknown {
  if (typeof value !== 'number' || Number.isInteger(value) || EXACT_KEYS.has(key)) return value;
  const scale = FINE_KEYS.has(key) ? 1e5 : 1e3;
  return Math.round(value * scale) / scale;
}

const wire = (value: unknown): string => JSON.stringify(value, turretWireNumber);

/**
 * One seat's family texts in `TURRET_SEAT_KEYS` order. A part whose text equals `prior`'s
 * keeps `prior`'s string, so an unchanged key diffs by reference on every session.
 */
export function turretSeatWireParts(
  seat: TurretSeatWireSource,
  prior?: readonly string[],
): string[] {
  const { origin, waveCount, monstersLeft, defense } = seat;
  const { rev, readyTick, aimX, aimZ, shots, barrels, stats, monsters, ...rest } = defense;
  const buckets: string[][] = Array.from({ length: TURRET_MONSTER_BUCKETS }, () => []);
  for (const m of monsters) buckets[m.id % TURRET_MONSTER_BUCKETS].push(wire(m));
  const parts = [
    wire({ origin, waveCount, monstersLeft, buckets: TURRET_MONSTER_BUCKETS, defense: rest }),
    wire(rev),
    wire({ readyTick, aimX, aimZ }),
    wire(shots),
    wire(barrels),
    wire(stats),
    ...buckets.map((records) => `[${records.join(',')}]`),
  ];
  if (prior) for (const [i, text] of parts.entries()) if (text === prior[i]) parts[i] = prior[i];
  return parts;
}

/**
 * The seat's family texts, built once per engine revision. `tick` is the sim tick of the
 * pass: a revision made after this tick's passes (a shot fired between ticks) is held until
 * a later tick, because its `turretDefense` events only route after the next sim tick and
 * the state must never reach the client ahead of its ring entry. Every part comes from the
 * same revision, so no record mixes two.
 */
export function turretStateWireParts(session: TurretSession, tick: number): readonly string[] {
  const rev = session.defense.rev;
  const cached = stateParts.get(session);
  if (cached && cached.rev === rev) {
    cached.tick = tick;
    return cached.parts;
  }
  if (cached && cached.tick === tick) return cached.parts;
  const { feedback: _ring, defense, ...seat } = turretSessionView(session);
  const { plan: _plan, ...state } = defense;
  const parts = turretSeatWireParts({ ...seat, defense: state }, cached?.parts);
  stateParts.set(session, { rev, tick, parts });
  return parts;
}

/** The resolved plan, serialized once per plan object (deep-frozen, shared by reference). */
export function turretPlanWireJson(plan: TurretPlan): string {
  let json = planJson.get(plan);
  if (json === undefined) {
    json = JSON.stringify(plan);
    planJson.set(plan, json);
  }
  return json;
}

/** The owner-only `turp` (plan) and seat family keys; explicit nulls clear a left seat. */
export function emitTurretSelfKeys(
  maybeRaw: EmitRawSelfKey,
  meta: Pick<PlayerMeta, 'vehicle'>,
  tick: number,
): void {
  const session = meta.vehicle?.kind === 'turret' ? meta.vehicle : null;
  // Per pass, every connected session (seated or not) pays a field read and the family's 38
  // diffs of strings it already holds (a reference compare each), a seated one also a memo
  // hit. A rebuild happens once per engine revision of a seated player (an aim drag moves
  // it every tick) and costs about 1.3 times one stringify of the whole state, every
  // monster stringified apart and each new part compared by content with the prior one.
  // Content-bounded per seated player: at most two consecutive waves' monsters (a corpse
  // lingers `corpseTicks`, as long as the pause between waves), the barrel cap and the
  // shells in flight. The plan rides first so a new seat's keys decode together.
  maybeRaw('turp', session ? turretPlanWireJson(session.defense.plan) : 'null');
  const parts = session ? turretStateWireParts(session, tick) : NULL_PARTS;
  for (let i = 0; i < TURRET_SEAT_KEYS.length; i++) maybeRaw(TURRET_SEAT_KEYS[i], parts[i]);
}
