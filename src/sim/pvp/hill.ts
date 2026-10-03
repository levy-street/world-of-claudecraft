// King of the Hill: the system half, behind the SimContext seam.
//
// Once every HILL_WINDOW_SECONDS (two hours), at a moment drawn at random
// inside the window, the realm is warned that a hill will rise in one of the
// northern zones (hill_zones.ts); HILL_WARNING_SECONDS later it rises,
// a HILL_RADIUS circle on dry, open ground, clear of the water, the hub
// settlement and every collider, wholly inside its zone, and it stands for
// HILL_DURATION_SECONDS before it falls. Each phase change is announced to the
// whole realm, and while it stands the realm is reminded where it is every
// HILL_NOTICE_SECONDS, with the hold standings (hill_ranking.ts). When it falls
// the final standings are announced and every player who stood inside for the
// group that held it longest earns a point toward the Weekly Vault's PvP row,
// through the credit the host injects (`HillVaultCredit`: the vault module
// reaches entity.ts, which imports this barrel, so it is never imported here).
// Entering the active circle raises the ordinary World PvP flag; outside the
// circle, the surrounding zone remains opt-in.
//
// Once a second while the hill stands the presence pass counts the players
// inside the circle by PARTY (an ungrouped player is a group of one; a raid
// member does not count at all, hill_rules.ts hillStanding; level 10 or above); the largest party that beats the holder's
// present count by a strict majority is the challenger, and after
// HILL_CAPTURE_SECONDS of unbroken majority it takes the hill (a tie never
// moves it; a challenge that lapses starts over). Every holder standing inside
// banks a second of presence per pass, and each HILL_ACCRUAL_SECONDS pays
// hillHonorPerPayout Honor, which ramps with how long the holding party has
// held (hill_rules.ts). A holder who steps out keeps what they banked; a
// capture clears the books and restarts the ramp.
//
// State lives on the Sim as ONE live view (`ctx.hillState`), never in this
// module: the modules hold functions, the Sim holds state (src/sim/CLAUDE.md).
// Session-only and never persisted: a realm restart opens its first window on
// its own clock, and a stand's accruals are not worth a blob field.
//
// The spot probe (the terrain, the water, the colliders) is bound by the Sim
// (hill_probe.ts) and read through `ctx.hillProbe`, never imported here: the
// pvp barrel must not reach the terrain modules (an import cycle).
//
// Determinism: the warning's offset and the spot draw from PRIVATE rngs
// derived from the seed and the window's ordinal (the natural rift portal
// precedent), so the world's own rng stream never moves for a hill and every
// host resolves the same time and spot; a spot retry salts in its attempt
// number so it searches new ground. The schedule, the contest clock and the
// accruals run on ctx.time and ctx.tickCount. No DOM, no wall clock.

import { zoneContaining } from '../data';
import { Rng } from '../rng';
import type { SimContext } from '../sim_context';
import type { ZoneDef } from '../types';
import {
  HILL_RANKING_SHOWN,
  type HillHoldRecord,
  hillRanking,
  hillVaultPayees,
} from './hill_ranking';
import {
  clearHillBounties,
  type HillBountyBook,
  hillCalloutFor,
  syncHillBountyBadges,
} from './hill_bounty';
import {
  HILL_ACCRUAL_SECONDS,
  HILL_CAPTURE_SECONDS,
  HILL_DURATION_SECONDS,
  HILL_EDGE_MARGIN,
  HILL_HUB_MARGIN,
  HILL_LATEST_WARN_OFFSET_SECONDS,
  HILL_NOTICE_SECONDS,
  HILL_RADIUS,
  HILL_SPAWN_ATTEMPTS,
  HILL_VAULT_MIN_INSIDE_SECONDS,
  HILL_WARNING_SECONDS,
  type HillSpotProbe,
  type HillTimes,
  hillChallengeStands,
  hillContains,
  hillContestStep,
  hillGroupKey,
  hillHonorPerPayout,
  hillLeader,
  hillMinutesUntil,
  hillSpotIsOpen,
  hillStanding,
  hillTimes,
  hillTimesFrom,
  hillWindowAt,
} from './hill_rules';
import { hillZones } from './hill_zones';
import { grantHonor } from './honor';
import { worldPvpOnHillPresence } from './world_pvp';

/** 'warning': announced, drawn on the ground, not yet contestable.
 *  'active': risen; the contest and the payouts run. */
export type HillPhase = 'warning' | 'active';

/** One announced or standing hill. */
export interface ActiveHill extends HillTimes {
  /** The window it belongs to (its private rng's ordinal). */
  ordinal: number;
  phase: HillPhase;
  zoneId: string;
  x: number;
  z: number;
  radius: number;
  /** The holding party's key (hillGroupKey), or null while unheld. */
  holder: string | null;
  /** The leading challenger's key and its banked seconds of majority. */
  challenger: string | null;
  contest: number;
  /** Last presence pass: group key -> counted members inside; pid -> key. */
  counts: Map<string, number>;
  insideKeys: Map<number, string>;
  /** pid -> seconds of paid presence banked toward the next payout. */
  accrual: Map<number, number>;
  /** Seconds the current holder has held the hill: the ramp's clock. Reset to
   *  zero whenever the hill changes hands. */
  heldSeconds: number;
  /** Honor paid out by this hill so far (the readout and the tests). */
  honorPaid: number;
  /** group key -> that group's total hold this stand (hill_ranking.ts),
   *  in the order the groups first held it. */
  holds: Map<string, HillHoldRecord>;
  /** When the next realm reminder and standings sound while risen. */
  nextNoticeAt: number;
  /** Kill and death streaks, repeat counts and the latest callout
   *  (hill_bounty.ts), created on the hill's first hill kill. */
  bounty?: HillBountyBook;
}

/** The Weekly Vault's PvP credit for one player, injected by the host (the Sim
 *  passes weekly_rewards.ts recordWeeklyPvpWin) because this barrel must not
 *  import the vault module (the cycle through entity.ts). True when the row
 *  actually moved (false at its weekly cap), so the notice never lies. */
export type HillVaultCredit = (ctx: SimContext, pid: number) => boolean;

/** No Weekly Vault credit: the default for a caller that drives the hill
 *  without a vault (a unit test stepping `updateHill` directly). The Sim always
 *  passes the real credit, so production never falls back to this. */
export const NO_HILL_VAULT_CREDIT: HillVaultCredit = () => false;

/** The Sim-owned session state, exposed on SimContext as a live view. */
export interface HillState {
  active: ActiveHill | null;
  /** The window whose hill comes next, and its times once drawn. */
  window: number;
  plan: HillTimes | null;
  /** Spot attempts spent on the planned hill, and when the next may run. */
  attempts: number;
  retryAt: number;
  /** Tick of the last once-a-second pass: the dueness form
   *  (`tickCount - passTick >= PASS_TICKS`, the books-sweep shape), never a
   *  modulo of the tick count, so a pass can never be skipped by a host that
   *  does not visit every tick. */
  passTick: number;
  /** The realm's announcer call counter (hill_bounty.ts), so a callout id is
   *  never reused within the realm's session. */
  calloutSeq?: number;
}

export function newHillState(): HillState {
  return { active: null, window: 0, plan: null, attempts: 0, retryAt: 0, passTick: 0 };
}

const PASS_TICKS = 20;
const RETRY_SECONDS = 60;
const NOTICE_COLOR = '#ffd100';
const RISE_COLOR = '#f0c060';
const OFFSET_SALT = 0x2c1b3c6d;
const SPOT_SALT = 0x5bd1e995;

/** "N minutes" with the English plural; the client matcher re-renders the
 *  count through the locale's own plural rules. */
function minutesPhrase(minutes: number): string {
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** The notice lines the client matcher re-localizes (src/ui/sim_i18n.ts). The
 *  zone lines carry the zone's English name, localized by the matcher's zone
 *  rule like the rift portal lines. */
export function hillWarningLine(zoneName: string, minutes: number): string {
  return `A hill will rise in ${zoneName} in ${minutesPhrase(minutes)}.`;
}
export function hillRiseLine(zoneName: string): string {
  return `A hill has risen in ${zoneName}: hold it to earn Honor.`;
}
export function hillFallenLine(zoneName: string): string {
  return `The hill in ${zoneName} has fallen.`;
}
export const HILL_TAKEN_LINE = 'Your group holds the hill.';
export const HILL_LOST_LINE = 'Another group has taken the hill.';
/** The reminder every HILL_NOTICE_SECONDS while the hill stands. */
export function hillStillStandsLine(zoneName: string, minutes: number): string {
  return `The hill still stands in ${zoneName}: it falls in ${minutesPhrase(minutes)}.`;
}
/** One place of the standings: a party by its leader's name, a lone player by
 *  their own; the hold in whole minutes, rounded up like every hill figure. */
export function hillRankLine(rank: number, record: HillHoldRecord): string {
  const who = record.party ? `${record.name}'s group` : record.name;
  const minutes = hillMinutesUntil(record.seconds, 0);
  return `Hill ranking #${rank}: ${who}, held ${minutesPhrase(minutes)}.`;
}
/** Told to each player the longest hold pays when the hill falls. */
export const HILL_VAULT_LINE =
  'Your group held the hill longest: +1 PvP progress toward the Weekly Vault.';

function hillRng(ctx: SimContext, ordinal: number, salt: number): Rng {
  return new Rng((ctx.cfg.seed ^ Math.imul(ordinal + 1, 0x7f4a7c15) ^ salt) >>> 0);
}

/** Window `ordinal`'s times: the warning's offset inside the window is the
 *  first draw of a seed-specific private rng, reused so rises are two hours apart. */
export function hillPlanFor(ctx: SimContext, ordinal: number): HillTimes {
  const offset = hillRng(ctx, 0, OFFSET_SALT).int(0, HILL_LATEST_WARN_OFFSET_SECONDS);
  return hillTimes(ordinal, offset);
}

/** A legal spot for a hill in `zone`, or null when HILL_SPAWN_ATTEMPTS random
 *  tries found none (the caller retries later with a fresh attempt salt). */
export function pickHillSpot(
  ctx: SimContext,
  rng: Rng,
  zone: ZoneDef,
  probe: HillSpotProbe = ctx.hillProbe,
): { x: number; z: number } | null {
  const pad = HILL_RADIUS + HILL_EDGE_MARGIN;
  const xMin = (zone.xMin ?? -180) + pad;
  const xMax = (zone.xMax ?? 180) - pad;
  const zMin = zone.zMin + pad;
  const zMax = zone.zMax - pad;
  if (xMin >= xMax || zMin >= zMax) return null;
  const hubClear = zone.hub.radius + HILL_RADIUS + HILL_HUB_MARGIN;
  for (let attempt = 0; attempt < HILL_SPAWN_ATTEMPTS; attempt++) {
    const x = rng.range(xMin, xMax);
    const z = rng.range(zMin, zMax);
    if (Math.hypot(x - zone.hub.x, z - zone.hub.z) < hubClear) continue;
    if (!hillSpotIsOpen(probe, zone.id, x, z, HILL_RADIUS)) continue;
    return { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
  }
  return null;
}

function announce(ctx: SimContext, text: string, color: string): void {
  ctx.emit({ type: 'log', text, color });
}

function notice(ctx: SimContext, pid: number, text: string, color = NOTICE_COLOR): void {
  ctx.emit({ type: 'log', text, color, pid });
}

function zoneName(zoneId: string): string {
  return hillZones().find((z) => z.id === zoneId)?.name ?? zoneId;
}

/** Tell the realm what just happened to the hill: the warning (with the
 *  minutes left, whole and rounded up), the rise, or the fall. */
function announcePhase(
  ctx: SimContext,
  hill: ActiveHill,
  what: 'warning' | 'risen' | 'fallen',
): void {
  const name = zoneName(hill.zoneId);
  if (what === 'warning') {
    announce(ctx, hillWarningLine(name, hillMinutesUntil(hill.risesAt, ctx.time)), RISE_COLOR);
  } else if (what === 'risen') {
    announce(ctx, hillRiseLine(name), RISE_COLOR);
  } else {
    announce(ctx, hillFallenLine(name), RISE_COLOR);
  }
}

/**
 * Place window `ordinal`'s hill on `times` in a hill zone (a random
 * one by the private rng, or `zoneId` when given: the /dev arm and the tests)
 * and announce it: the warning when it has not risen yet, else the rise.
 * `attempt` salts the spot rng so a retry searches new ground. Returns the
 * hill, or null when no legal spot was found this attempt.
 */
export function spawnHill(
  ctx: SimContext,
  ordinal: number,
  times: HillTimes,
  attempt = 0,
  zoneId?: string,
): ActiveHill | null {
  const zones = hillZones();
  if (zones.length === 0) return null;
  const rng = hillRng(ctx, ordinal, SPOT_SALT ^ Math.imul(attempt, 0x27d4eb2f));
  const zone = zoneId ? zones.find((z) => z.id === zoneId) : zones[rng.int(0, zones.length - 1)];
  if (!zone) return null;
  const spot = pickHillSpot(ctx, rng, zone);
  if (!spot) return null;
  const phase: HillPhase = ctx.time >= times.risesAt ? 'active' : 'warning';
  const hill: ActiveHill = {
    ...times,
    ordinal,
    phase,
    zoneId: zone.id,
    x: spot.x,
    z: spot.z,
    radius: HILL_RADIUS,
    holder: null,
    challenger: null,
    contest: 0,
    counts: new Map(),
    insideKeys: new Map(),
    accrual: new Map(),
    heldSeconds: 0,
    honorPaid: 0,
    holds: new Map(),
    nextNoticeAt: times.risesAt + HILL_NOTICE_SECONDS,
  };
  clearHillBounties(ctx, ctx.hillState.active);
  ctx.hillState.active = hill;
  announcePhase(ctx, hill, phase === 'warning' ? 'warning' : 'risen');
  return hill;
}

// ---- The /dev arms (src/sim/dev_commands.ts `/dev hill ...`). Each is a test
// lever over the real phases: it announces through the same lines and leaves
// the schedule to resume on its own when the staged hill falls.

/** Announce a hill now (replacing any that stands), on the next window's
 *  ordinal so its spot is one the schedule could have picked. With `warn` it
 *  counts down first (the full HILL_WARNING_SECONDS, or `warningSeconds` to
 *  shorten a test); without, it rises at once. It stands a full
 *  HILL_DURATION_SECONDS either way. */
export function spawnHillNow(
  ctx: SimContext,
  zoneId?: string,
  opts: { warn?: boolean; warningSeconds?: number } = {},
): ActiveHill | null {
  const warning = opts.warn ? Math.max(1, opts.warningSeconds ?? HILL_WARNING_SECONDS) : 0;
  const risesAt = ctx.time + warning;
  const times: HillTimes = {
    warnAt: ctx.time,
    risesAt,
    closesAt: risesAt + HILL_DURATION_SECONDS,
  };
  return spawnHill(ctx, ctx.hillState.window, times, 0, zoneId);
}

/** Skip the countdown: the announced hill rises now and stands its full
 *  HILL_DURATION_SECONDS. Null when no hill is counting down. */
export function riseHillNow(ctx: SimContext): ActiveHill | null {
  const hill = ctx.hillState.active;
  if (!hill || hill.phase !== 'warning') return null;
  hill.risesAt = ctx.time;
  hill.closesAt = ctx.time + HILL_DURATION_SECONDS;
  hill.nextNoticeAt = ctx.time + HILL_NOTICE_SECONDS;
  hill.phase = 'active';
  announcePhase(ctx, hill, 'risen');
  return hill;
}

/** End the announced or standing hill now, exactly as if its time had come:
 *  the realm's fall line, the final standings and the longest hold's Weekly
 *  Vault credit. Null when there is none. */
export function endHillNow(
  ctx: SimContext,
  credit: HillVaultCredit = NO_HILL_VAULT_CREDIT,
): ActiveHill | null {
  const hill = ctx.hillState.active;
  if (!hill) return null;
  fallHill(ctx, hill, credit);
  return hill;
}

/** Tell the realm the standings, longest hold first, HILL_RANKING_SHOWN deep;
 *  nothing when nobody has held the hill yet. */
function announceRanking(ctx: SimContext, hill: ActiveHill): void {
  const ranked = hillRanking(hill.holds.values()).slice(0, HILL_RANKING_SHOWN);
  for (const [i, record] of ranked.entries()) {
    announce(ctx, hillRankLine(i + 1, record), RISE_COLOR);
  }
}

/** The hill falls: the fall line, the final standings, and one Weekly Vault
 *  PvP point to every player who stood inside for HILL_VAULT_MIN_INSIDE_SECONDS
 *  for the group that held it longest (every group tied at the top) and is
 *  still in the realm and in that group now. */
function fallHill(ctx: SimContext, hill: ActiveHill, credit: HillVaultCredit): void {
  clearHillBounties(ctx, hill);
  ctx.hillState.active = null;
  announcePhase(ctx, hill, 'fallen');
  announceRanking(ctx, hill);
  const stillInGroup = (pid: number, key: string): boolean => {
    const meta = ctx.players.get(pid);
    return !!meta && !meta.leaving && hillGroupKey(pid, ctx.partyOf(pid)) === key;
  };
  for (const pid of hillVaultPayees(
    hill.holds.values(),
    HILL_VAULT_MIN_INSIDE_SECONDS,
    stillInGroup,
  )) {
    if (credit(ctx, pid)) notice(ctx, pid, HILL_VAULT_LINE);
  }
}

/** Run the real schedule now: the next window's hill is warned of at once (its
 *  own zone and spot, the full warning), and that window is spent, exactly as
 *  if its random moment had come. Ends any hill that stands first. Null when no
 *  spot was found this attempt (the schedule then retries it on its own). */
export function warnNextHillNow(
  ctx: SimContext,
  credit: HillVaultCredit = NO_HILL_VAULT_CREDIT,
): ActiveHill | null {
  const state = ctx.hillState;
  if (state.active) endHillNow(ctx, credit);
  const current = hillWindowAt(ctx.time);
  if (state.window < current) state.window = current;
  const risesAt = ctx.time + HILL_WARNING_SECONDS;
  const times: HillTimes = {
    warnAt: ctx.time,
    risesAt,
    closesAt: risesAt + HILL_DURATION_SECONDS,
  };
  const hill = spawnHill(ctx, state.window, times, state.attempts);
  if (!hill) return null;
  state.window += 1;
  state.plan = null;
  state.attempts = 0;
  state.retryAt = 0;
  return hill;
}

/** The schedule: move a standing hill through its phases, then warn of the
 *  planned one when its time comes. A late warning (a spot retry, a standing
 *  /dev hill, a realm switched back on) slides the hill whole, so every hill
 *  keeps its full warning and stand. A failed spot retries a minute on with a
 *  fresh salt; a window whose planned stand has passed before any warning is
 *  skipped. */
function updateSchedule(ctx: SimContext, credit: HillVaultCredit): void {
  const state = ctx.hillState;
  const hill = state.active;
  if (hill) {
    if (ctx.time >= hill.closesAt) {
      fallHill(ctx, hill, credit);
    } else {
      if (hill.phase === 'warning' && ctx.time >= hill.risesAt) {
        hill.phase = 'active';
        announcePhase(ctx, hill, 'risen');
      } else if (hill.phase === 'active' && ctx.time >= hill.nextNoticeAt) {
        hill.nextNoticeAt += HILL_NOTICE_SECONDS;
        announce(
          ctx,
          hillStillStandsLine(zoneName(hill.zoneId), hillMinutesUntil(hill.closesAt, ctx.time)),
          RISE_COLOR,
        );
        announceRanking(ctx, hill);
      }
      return;
    }
  }
  const current = hillWindowAt(ctx.time);
  if (current < 0) return;
  // A realm that slept through whole windows (or a sim clock jumped forward)
  // plans the CURRENT window, not every missed one in turn.
  if (state.window < current) {
    state.window = current;
    state.plan = null;
  }
  if (!state.plan) {
    state.plan = hillPlanFor(ctx, state.window);
    state.attempts = 0;
    state.retryAt = 0;
  }
  const plan = state.plan;
  if (ctx.time >= plan.closesAt) {
    state.window += 1;
    state.plan = null;
    return;
  }
  if (ctx.time < plan.warnAt || ctx.time < state.retryAt) return;
  if (!spawnHill(ctx, state.window, hillTimesFrom(plan, ctx.time), state.attempts)) {
    state.attempts += 1;
    state.retryAt = ctx.time + RETRY_SECONDS;
    return;
  }
  state.window += 1;
  state.plan = null;
}

/** The presence pass: who stands inside, by party. The dead and raid members
 *  are not counted. */
function countInside(ctx: SimContext, hill: ActiveHill): void {
  hill.counts.clear();
  hill.insideKeys.clear();
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead || !hillContains(hill, e.pos.x, e.pos.z)) continue;
    if (!worldPvpOnHillPresence(ctx, e)) continue;
    const party = ctx.partyOf(e.id);
    if (hillStanding(party, e.level) !== 'counted') continue;
    const key = hillGroupKey(e.id, party);
    if (key === null) continue;
    hill.insideKeys.set(e.id, key);
    hill.counts.set(key, (hill.counts.get(key) ?? 0) + 1);
  }
}

/** The contest clock: the leader beats the holder for HILL_CAPTURE_SECONDS
 *  of unbroken majority and takes the hill. Tells everyone inside. */
function updateContest(ctx: SimContext, hill: ActiveHill, dt: number): void {
  const holderCount = hill.holder === null ? 0 : (hill.counts.get(hill.holder) ?? 0);
  const leader = hillLeader(hill.counts);
  const challenger =
    leader && leader.key !== hill.holder && hillChallengeStands(leader.count, holderCount)
      ? leader.key
      : null;
  hill.contest = hillContestStep(
    hill.contest,
    challenger !== null,
    challenger === hill.challenger,
    dt,
  );
  hill.challenger = challenger;
  if (challenger === null || hill.contest < HILL_CAPTURE_SECONDS) return;
  const ousted = hill.holder;
  hill.holder = challenger;
  hill.challenger = null;
  hill.contest = 0;
  hill.accrual.clear();
  hill.heldSeconds = 0;
  if (!hill.holds.has(challenger)) {
    hill.holds.set(challenger, {
      key: challenger,
      seconds: 0,
      name: '',
      party: challenger.startsWith('party:'),
      holders: new Map(),
    });
  }
  for (const [pid, key] of hill.insideKeys) {
    if (key === challenger) notice(ctx, pid, HILL_TAKEN_LINE);
    else if (key === ousted) notice(ctx, pid, HILL_LOST_LINE);
  }
}

/** The trickle: every holder inside banks this pass, and each compressed payout interval pays
 *  the current ramp amount. Only counted players are inside the books, so the raid rule
 *  holds here too, and a party's size is the payee cap. A
 *  holder who steps out keeps their bank; one who leaves the party, or the
 *  realm, loses it. */
function payHolders(ctx: SimContext, hill: ActiveHill, dt: number): void {
  const holder = hill.holder;
  if (holder === null) return;
  hill.heldSeconds += dt;
  recordHold(ctx, hill, holder, dt);
  const amount = hillHonorPerPayout(hill.heldSeconds);
  for (const pid of hill.accrual.keys()) {
    if (!ctx.players.has(pid) || hillGroupKey(pid, ctx.partyOf(pid)) !== holder) {
      hill.accrual.delete(pid);
    }
  }
  for (const [pid, key] of hill.insideKeys) {
    if (key !== holder) continue;
    const meta = ctx.players.get(pid);
    if (!meta) continue;
    const banked = (hill.accrual.get(pid) ?? 0) + dt;
    if (banked + 1e-9 < HILL_ACCRUAL_SECONDS) {
      hill.accrual.set(pid, banked);
      continue;
    }
    hill.accrual.set(pid, Math.max(0, banked - HILL_ACCRUAL_SECONDS));
    hill.honorPaid += grantHonor(ctx, meta, amount, 'hill_hold');
  }
}

/** The ranking's books: the holding group banks this pass only while a
 *  member stands inside (a group that walks away still holds the hill, but
 *  an empty hold earns no rank), and every member inside banks their own
 *  second toward the Weekly Vault point; the name follows the party's leader,
 *  read while a member is inside to ask the party. */
function recordHold(ctx: SimContext, hill: ActiveHill, holder: string, dt: number): void {
  const record = hill.holds.get(holder);
  if (!record) return;
  let occupied = false;
  for (const [pid, key] of hill.insideKeys) {
    if (key !== holder) continue;
    occupied = true;
    record.holders.set(pid, (record.holders.get(pid) ?? 0) + dt);
    const leader = record.party ? (ctx.partyOf(pid)?.leader ?? pid) : pid;
    const name = ctx.entities.get(leader)?.name ?? ctx.entities.get(pid)?.name;
    if (name) record.name = name;
  }
  if (occupied) record.seconds += dt;
}

/**
 * Per-tick entry (the sim's hill lap): once a second run the schedule, then,
 * while a hill stands risen, the presence pass, the contest clock and the
 * payouts. Draws no rng from the world stream. A realm whose World PvP switch
 * is set never announces a hill and drops a standing one silently (no
 * standings, no Weekly Vault credit). `credit` is the host's Weekly Vault PvP
 * credit for the longest hold when a hill falls (HillVaultCredit).
 */
export function updateHill(ctx: SimContext, credit: HillVaultCredit = NO_HILL_VAULT_CREDIT): void {
  const state = ctx.hillState;
  if (ctx.tickCount - state.passTick < PASS_TICKS) return;
  state.passTick = ctx.tickCount;
  if (ctx.worldPvpDisabled) {
    clearHillBounties(ctx, state.active);
    state.active = null;
    return;
  }
  updateSchedule(ctx, credit);
  const live = state.active;
  if (!live || live.phase !== 'active') return;
  const dt = PASS_TICKS * (1 / 20);
  countInside(ctx, live);
  updateContest(ctx, live, dt);
  payHolders(ctx, live, dt);
  syncHillBountyBadges(ctx, live);
}

/** The IWorld readout for one viewer (src/world_api/world_pvp.ts HillInfo).
 *  The live fields are zero for a viewer outside the hill's zone (and for
 *  everyone during the warning), so outside the zone the readout changes only
 *  on a phase, holder or standing change and once a minute (the countdown). */
export function hillInfoFor(
  ctx: SimContext,
  pid: number,
): import('../../world_api').HillInfo | null {
  const hill = ctx.hillState.active;
  if (!hill) return null;
  const e = ctx.entities.get(pid);
  if (!e || e.kind !== 'player') return null;
  const party = ctx.partyOf(pid);
  const standing = hillStanding(party, e.level);
  const key = standing === 'counted' ? hillGroupKey(pid, party) : null;
  const side = (group: string | null): 'none' | 'you' | 'other' =>
    group === null ? 'none' : group === key ? 'you' : 'other';
  const inZone = zoneContaining(e.pos.x, e.pos.z)?.id === hill.zoneId;
  const minutesLeft = hillMinutesUntil(
    hill.phase === 'warning' ? hill.risesAt : hill.closesAt,
    ctx.time,
  );
  const base = {
    zoneId: hill.zoneId,
    x: hill.x,
    z: hill.z,
    radius: hill.radius,
    phase: hill.phase,
    minutesLeft,
    inZone,
    standing,
    holder: side(hill.holder),
  };
  if (!inZone || hill.phase === 'warning') {
    return {
      ...base,
      inside: false,
      holderCount: 0,
      yourCount: 0,
      challenger: 'none',
      challengerCount: 0,
      contest: 0,
    };
  }
  return {
    ...base,
    inside: hillContains(hill, e.pos.x, e.pos.z),
    holderCount: hill.holder === null ? 0 : (hill.counts.get(hill.holder) ?? 0),
    yourCount: key === null ? 0 : (hill.counts.get(key) ?? 0),
    challenger: side(hill.challenger),
    challengerCount: hill.challenger === null ? 0 : (hill.counts.get(hill.challenger) ?? 0),
    contest: Math.floor(hill.contest),
    // The announcer (hill_bounty.ts): everyone in the zone sees the same call.
    callout: hillCalloutFor(ctx, hill),
  };
}

export const HILL_READOUT_NONE_LINE = 'No hill stands right now.';

/** The /hill chat readout: the warning line while the hill is announced;
 *  where it stands, who holds it from this player's seat, and when it falls
 *  once risen; the no-hill line otherwise. Each shape is re-localized by the
 *  client matcher (the zone name through its zone rule). */
export function hillReadoutLine(ctx: SimContext, pid: number): string {
  const info = hillInfoFor(ctx, pid);
  if (!info) return HILL_READOUT_NONE_LINE;
  const name = zoneName(info.zoneId);
  if (info.phase === 'warning') return hillWarningLine(name, info.minutesLeft);
  const held =
    info.holder === 'you'
      ? 'your group holds it'
      : info.holder === 'other'
        ? 'another group holds it'
        : 'nobody holds it';
  return `The hill stands in ${name}: ${held}. It falls in ${minutesPhrase(info.minutesLeft)}.`;
}
