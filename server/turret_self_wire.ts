// The Fire and Fly keys of the snapshot self record, beside the quest self-key
// leaf that calls it (game.ts sits at a zero-margin monolith ceiling). The
// feedback ring is not here: the owner-scoped `turretDefense` event carries each
// entry, and the client rebuilds the ring from those.
import type { TurretStats } from '../src/sim/minigames/turret_defense';
import type { TurretPlan } from '../src/sim/minigames/turret_defense_plan';
import type { PlayerMeta } from '../src/sim/sim';
import { turretSessionView } from '../src/sim/turret_defense_session';
import type { TurretSession } from '../src/sim/types';

type EmitRawSelfKey = (key: string, serialized: string) => void;

const stateJson = new WeakMap<TurretSession, { rev: number; tick: number; json: string }>();
const planJson = new WeakMap<TurretPlan, string>();

// A march multiplies its direction and its speed by the length of the walk.
const FINE_KEYS: ReadonlySet<string> = new Set(['dx', 'dz', 'speed']);
// The result card formats these itself: rounding them first could flip its last digit.
const EXACT_KEYS: ReadonlySet<string> = new Set([
  'longestThrow',
  'longestAirtime',
] satisfies (keyof TurretStats)[]);

/**
 * The `tur` replacer: a non-integer to 3 decimals (positions to the millimetre, speeds to
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

/**
 * The seat's view minus the feedback ring and the plan, serialized once per engine revision.
 * `tick` is the sim tick of the pass: a revision made after this tick's passes (a shot fired
 * between ticks) is held until a later tick, because its `turretDefense` events only route
 * after the next sim tick and the state must never reach the client ahead of its ring entry.
 */
export function turretStateWireJson(session: TurretSession, tick: number): string {
  const rev = session.defense.rev;
  const cached = stateJson.get(session);
  if (cached && cached.rev === rev) {
    cached.tick = tick;
    return cached.json;
  }
  if (cached && cached.tick === tick) return cached.json;
  const { feedback: _ring, defense, ...seat } = turretSessionView(session);
  const { plan: _plan, ...state } = defense;
  const json = JSON.stringify({ ...seat, defense: state }, turretWireNumber);
  stateJson.set(session, { rev, tick, json });
  return json;
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

/** The owner-only `turp` (plan) and `tur` (state) keys; explicit nulls clear a left seat. */
export function emitTurretSelfKeys(
  maybeRaw: EmitRawSelfKey,
  meta: Pick<PlayerMeta, 'vehicle'>,
  tick: number,
): void {
  const session = meta.vehicle?.kind === 'turret' ? meta.vehicle : null;
  // Per pass and per session, a field read plus a memo hit returning the same string, so the
  // diff is a reference compare; a rebuild happens once per engine revision of a seated
  // player. Content-bounded per seated player: at most two consecutive waves' monsters (a
  // corpse lingers `corpseTicks`, as long as the pause between waves), the barrel cap and the
  // shells in flight. The plan rides first so a new seat's two keys decode together.
  maybeRaw('turp', session ? turretPlanWireJson(session.defense.plan) : 'null');
  maybeRaw('tur', session ? turretStateWireJson(session, tick) : 'null');
}
