// King of the Hill: the pure rules. Once every three hours, at a random
// moment inside the window, a hill is announced somewhere in one of the
// free-for-all zones; it rises HILL_WARNING_SECONDS later as a HILL_RADIUS
// circle on dry, open ground and stands for HILL_DURATION_SECONDS. The PARTY
// with the most members standing inside it contests it, holds it after
// HILL_CAPTURE_SECONDS of unbroken majority, and every holder standing inside
// earns a slow trickle of Honor for as long as they hold it. Raid members do
// not count; every level does. No SimContext, no rng, no clock: every function here is a plain function of its arguments so the
// sim (hill.ts), the HUD bar and the tests read the same verdicts. The
// ctx-bound system that owns the schedule, the presence pass, the contest
// clock and the payouts is hill.ts.

/** The circle's radius in yards (owner spec). */
export const HILL_RADIUS = 50;
/** One hill per window of this length (owner spec: "once every 3 hours"). */
export const HILL_WINDOW_SECONDS = 3 * 60 * 60;
/** The realm is told where the hill will rise this long before it does
 *  (owner spec: a 15 minute warning), so parties can form and travel. */
export const HILL_WARNING_SECONDS = 15 * 60;
/** A risen hill stands this long, then falls (owner spec: 45 minutes). */
export const HILL_DURATION_SECONDS = 45 * 60;
/** The first window opens this long after boot (the natural rift portal
 *  precedent: never at tick zero). Sim time, so offline the first window
 *  opens two minutes into a session. */
export const HILL_FIRST_WINDOW_AT_SECONDS = 120;
/** The latest a warning may sound inside its window and still leave the
 *  whole warning and the whole stand inside that window, so two hills never
 *  overlap. The warning's offset is drawn uniformly from [0, this]. */
export const HILL_LATEST_WARN_OFFSET_SECONDS =
  HILL_WINDOW_SECONDS - HILL_WARNING_SECONDS - HILL_DURATION_SECONDS;
/** Unbroken majority for this long takes the hill (owner spec). */
export const HILL_CAPTURE_SECONDS = 60;
/** Each holder standing inside accrues this many seconds of presence before a
 *  payout, and each payout RAMPS with how long the holding party has held the
 *  hill (hillHonorPerPayout): HILL_RAMP_STEP_HONOR a minute for the first five
 *  minutes, that much more each further five minutes, capped at
 *  HILL_RAMP_MAX_HONOR a minute. A full uncontested stand pays about 380 each
 *  (owner tuning 2026-09-25: King of the Hill is a real road to Warfare gear,
 *  doubled alongside the Thornhollow Fields awards). The streak belongs to the party and resets when the
 *  hill changes hands, so a long hold is the thing worth taking. Only a party
 *  can hold, so a party's size is the payee cap. */
export const HILL_ACCRUAL_SECONDS = 60;
/** Held seconds per step of the ramp, the Honor each step adds to a minute's
 *  payout, and the per-minute cap it climbs to. */
export const HILL_RAMP_STEP_SECONDS = 300;
export const HILL_RAMP_STEP_HONOR = 2;
export const HILL_RAMP_MAX_HONOR = 12;

/** The Honor one payout is worth after the holding party has held the hill
 *  for `heldSeconds`: HILL_RAMP_STEP_HONOR, then that much more every
 *  HILL_RAMP_STEP_SECONDS, capped at HILL_RAMP_MAX_HONOR. */
export function hillHonorPerPayout(heldSeconds: number): number {
  const steps = Math.floor(Math.max(0, heldSeconds) / HILL_RAMP_STEP_SECONDS);
  return Math.min(HILL_RAMP_MAX_HONOR, HILL_RAMP_STEP_HONOR * (1 + steps));
}
/** The circle keeps this much clear of the zone's edges beyond its own radius,
 *  and this much clear of the hub settlement's radius. */
export const HILL_EDGE_MARGIN = 25;
export const HILL_HUB_MARGIN = 30;
/** Random spots tried before the spawn gives up for this attempt. */
export const HILL_SPAWN_ATTEMPTS = 96;
/** The samples the spot probe takes around the rim and around an inner ring
 *  at half the radius: a lake or a building can sit between two rim samples
 *  or wholly inside the circle, and the probe must see both. */
export const HILL_RIM_SAMPLES = 16;
export const HILL_INNER_SAMPLES = 8;
/** Clearance the centre must have from any collider: a hill never rises on
 *  a building, a wall or a fence. The rings are not collider-checked: the
 *  free-for-all zones are forests, a trunk on a sample point is not a
 *  structure, and the hub exclusion keeps the circle off every settlement. */
export const HILL_CENTER_CLEARANCE = 6;

/** Whether a player counts on the hill (owner spec: parties only): a raid
 *  member does not, so a raid cannot flood the circle. Level does not matter:
 *  anyone on free-for-all ground is fair game, so anyone there can hold. */
export type HillStanding = 'counted' | 'raid';

export function hillStanding(party: { raid: boolean } | null): HillStanding {
  return party?.raid ? 'raid' : 'counted';
}

/** The group a counted player contests for: their party, or a group of one
 *  when ungrouped. A raid has no key (it does not count). */
export function hillGroupKey(
  pid: number,
  party: { id: number; raid: boolean } | null,
): string | null {
  if (!party) return `solo:${pid}`;
  return party.raid ? null : `party:${party.id}`;
}

/** The group with the most members inside, or null on a tie for first place
 *  (or an empty hill): a tie never moves the hill. Iteration order does not
 *  matter: the answer is the strict maximum or nothing. */
export function hillLeader(
  counts: ReadonlyMap<string, number>,
): { key: string; count: number } | null {
  let best: { key: string; count: number } | null = null;
  let tied = false;
  for (const [key, count] of counts) {
    if (count <= 0) continue;
    if (best === null || count > best.count) {
      best = { key, count };
      tied = false;
    } else if (count === best.count) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/** Does a challenger with this many inside beat the holder with that many? A
 *  strict majority over the holder's PRESENT count (owner spec: "a majority
 *  will win the zone over"); an absent holder is beaten by anyone. */
export function hillChallengeStands(challengerCount: number, holderCount: number): boolean {
  return challengerCount > 0 && challengerCount > holderCount;
}

/** The contest clock after one pass. A lapsed challenge resets it (a group
 *  that thins out below the holder starts over), a new challenger starts it
 *  over from this pass, the same challenger keeps counting. */
export function hillContestStep(
  prev: number,
  contested: boolean,
  sameChallenger: boolean,
  dt: number,
): number {
  if (!contested) return 0;
  return sameChallenger ? prev + dt : dt;
}

/** The world reads a spawn probe needs; the sim binds them to the terrain,
 *  the water bodies and the collider grid, the tests to fakes. */
export interface HillSpotProbe {
  /** Water surface or open sea at this point, or ground below the water line. */
  wet(x: number, z: number): boolean;
  /** Too steep to stand on at this point. */
  steep(x: number, z: number): boolean;
  /** A collider (a building, a wall, a prop) within `r` of this point. */
  blocked(x: number, z: number, r: number): boolean;
  /** The zone id the point falls in, or null outside every zone. */
  zoneIdAt(x: number, z: number): string | null;
}

/** Is a circle of `radius` at (x, z) a legal hill in `zoneId`: dry, flat and
 *  clear of colliders at the centre; dry and inside the zone at
 *  HILL_RIM_SAMPLES points around the rim and HILL_INNER_SAMPLES points
 *  around the half-radius ring (no circle straddles a zone line or a lake). */
export function hillSpotIsOpen(
  probe: HillSpotProbe,
  zoneId: string,
  x: number,
  z: number,
  radius: number,
): boolean {
  if (probe.zoneIdAt(x, z) !== zoneId) return false;
  if (probe.wet(x, z) || probe.steep(x, z)) return false;
  if (probe.blocked(x, z, HILL_CENTER_CLEARANCE)) return false;
  const ring = (samples: number, r: number): boolean => {
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      const rx = x + Math.cos(a) * r;
      const rz = z + Math.sin(a) * r;
      if (probe.zoneIdAt(rx, rz) !== zoneId) return false;
      if (probe.wet(rx, rz)) return false;
    }
    return true;
  };
  return ring(HILL_RIM_SAMPLES, radius) && ring(HILL_INNER_SAMPLES, radius / 2);
}

/** The three moments of one hill: the realm-wide warning, the rise, the fall. */
export interface HillTimes {
  warnAt: number;
  risesAt: number;
  closesAt: number;
}

/** The window open at sim time `now`: -1 before the first, then 0, 1, 2... */
export function hillWindowAt(now: number): number {
  if (now < HILL_FIRST_WINDOW_AT_SECONDS) return -1;
  return Math.floor((now - HILL_FIRST_WINDOW_AT_SECONDS) / HILL_WINDOW_SECONDS);
}

/** The times of window `ordinal`'s hill whose warning sounds `offset` seconds
 *  into the window (clamped into [0, HILL_LATEST_WARN_OFFSET_SECONDS], so the
 *  hill always falls inside its own window). */
export function hillTimes(ordinal: number, offset: number): HillTimes {
  const clamped = Math.max(0, Math.min(HILL_LATEST_WARN_OFFSET_SECONDS, Math.floor(offset)));
  const warnAt = HILL_FIRST_WINDOW_AT_SECONDS + ordinal * HILL_WINDOW_SECONDS + clamped;
  const risesAt = warnAt + HILL_WARNING_SECONDS;
  return { warnAt, risesAt, closesAt: risesAt + HILL_DURATION_SECONDS };
}

/** `times` as they run when the warning actually sounds at `now`: unchanged
 *  on schedule, else slid whole so a late hill (a spot retry, a /dev hill
 *  still standing, a realm switched back on) keeps its full warning and its
 *  full stand. A slid hill may run past its window; the next window waits. */
export function hillTimesFrom(times: HillTimes, now: number): HillTimes {
  if (now <= times.warnAt) return times;
  const risesAt = now + HILL_WARNING_SECONDS;
  return { warnAt: now, risesAt, closesAt: risesAt + HILL_DURATION_SECONDS };
}

/** Whole minutes from `now` to `at`, rounded up, never below zero: the one
 *  rounding every countdown (the notices, /hill, the bar) shares. */
export function hillMinutesUntil(at: number, now: number): number {
  return Math.max(0, Math.ceil((at - now) / 60));
}

/** Is (px, pz) inside the circle? Squared distance, no sqrt on the presence pass. */
export function hillContains(
  hill: { x: number; z: number; radius: number },
  px: number,
  pz: number,
): boolean {
  const dx = px - hill.x;
  const dz = pz - hill.z;
  return dx * dx + dz * dz <= hill.radius * hill.radius;
}
