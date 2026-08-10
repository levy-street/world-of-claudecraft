// Thornhollow Fields: the ranked 5v5 capture-the-flag battleground (re-cut of
// Dubtribe11's PR #589 on the SimContext seam; the arena slice A2 is the
// structural template, Protect Yumi the band/module precedent).
//
// Battleground state stays on Sim and is reached through SimContext live views
// (`bgQueue`/`bgMatches`/`bgBusySlots`/`nextBgMatchId`). Sim keeps thin
// same-named delegates so foreign callers (the damage/death arms, hostility
// reads, leave/disconnect handling, bgInfoFor, the HUD command path, and tests)
// resolve on the facade.
//
// Determinism: the ACTIVE phase draws ZERO rng, shared or otherwise. Team
// assignment derives from queue order, wave-respawn clocks and rune recharges
// from tick math, and a claimed power rune flips its face deterministically.
// The mode's single draw is at match START (the power runes' seeded opening
// face in startBgMatch), pinned by the /dev bg one-draw test; the in-match
// zero-rng pin holds, so the phase's tick position can never fork the shared
// draw order mid-match.

import {
  BG_BASES,
  BG_GRAVEYARDS,
  BG_POWER_RUNES,
  BG_SPEED_RUNES,
  BG_TEAM_COLORS,
  BG_TEAM_NAMES,
  type BgTeam,
  keepInteriorBounds,
} from '../battleground_layout';
import { applyGreaterInvisibilityAftereffect } from '../combat/greater_invisibility';
import { BG_SLOT_COUNT, battlegroundOrigin } from '../data';
import { createGroundObject } from '../entity';
import { detachFromDungeon } from '../instances/dungeons';
import {
  awardBattlegroundAssistHonor,
  awardBattlegroundHonor,
  awardBattlegroundKillHonor,
  bgFirstWinBonusAvailable,
  honorTeamIdentity,
} from '../pvp';
import type { ArenaReturnPools } from '../sim';
import type { SimContext } from '../sim_context';
import { type Aura, DT, type Entity, type Vec3 } from '../types';
import { eloDelta, snapshotArenaReturnPools } from './arena';
import { bgBackfillSeat, pickBgBackfillGroup } from './battleground_backfill';
import { recordBgOutcome } from './battleground_outcomes';
import {
  formBgTeamParty,
  joinBgTeamParty,
  unwindBgAutoPartyFor,
  unwindBgTeamParties,
} from './battleground_party';
import {
  type BgProposal,
  bgProposalFor,
  bgProposalRemaining,
  bgProposalRespond,
  bgRequeueLockedUntil,
  openBgBackfillProposal,
  openBgProposal,
  sweepBgProposals,
} from './battleground_proposal';

// --- Thornhollow Fields tuning consts (rating reuses the arena's exported eloDelta) ---
export const BG_BASE_RATING = 1500; // every character starts here on the ladder
export const BG_MIN_RATING = 100; // rating floor so a losing streak can't go absurd
export const BG_TEAM_SIZE = 5; // players per team: a full match is 5v5
// Rows of the LIVE online ladder shipped to clients. Matches the arena's
// ARENA_LADDER_SIZE (src/sim/sim.ts) on purpose: the same panel family renders
// both, so the two sections have to be the same height.
export const BG_LADDER_SIZE = 10;
// Queue floor: an under-leveled body on one side decides ranked matches, so
// every queued champion (and every member of a queued party) must be 20.
export const BG_MIN_LEVEL = 20;
const BG_COUNTDOWN = 8; // form-up gate at the keeps before the flags go live
// First team to this many captures wins. THREE, the classic capture-the-flag
// battleground convention (Warsong Gulch ran first-to-3 for its whole classic
// life). Cut from the launch value of 5 on live evidence: a dominating side
// still needed about 8 minutes to reach 3, so 5 put most matches into the
// BG_MAX_DURATION cap and let the clock, rather than the fifth capture, decide
// them. The match-outcome records (the `battleground_outcomes.ts` leaf beside
// this file, drained onto the metrics in server/battleground_telemetry.ts)
// exist to re-check exactly this against real matches.
export const BG_CAPS_TO_WIN = 3;
// 12 min cap; resolves on score, ties draw. Scaled with the field (the stands
// are 236yd apart) against the first-to-3 target above: three captures on even
// teams model out well inside the cap, so the WINNING CAPTURE rather than the
// clock decides most matches. That is exactly the property the retune from 5
// restored, and exactly what the match-outcome records measure (the share of
// results ending 'timer' rather than 'caps').
export const BG_MAX_DURATION = 720;
// Remaining-time calls, in seconds left, DESCENDING. A capture push is a
// minutes-long commitment, so a side that is behind needs to be told the clock
// is about to decide the match rather than discovering it at 0. Two calls only:
// the two-minute mark (still time for one more full run of the field) and the
// one-minute mark (the last-push call). Each fires at most once per match.
export const BG_TIME_WARNINGS = [120, 60] as const;
export const BG_END_HOLD = 15; // post-match hold: the frozen result screen
export const BG_WAVE_PERIOD = 10; // one respawn wave per team every 10s
export const BG_WAVE_OFFSET = 5; // the two team clocks run staggered half-cycles
// Carrier vulnerability (the WSG Focused Assault lineage): after holding an
// enemy flag continuously for BG_CARRIER_VULN_DELAY the carrier takes stacking
// extra damage, a stack every BG_CARRIER_VULN_INTERVAL, each
// BG_CARRIER_VULN_PER_STACK more damage taken, uncapped. Stacks clear the
// moment the flag leaves the carrier (capture, drop, or return). Anti-turtle:
// a hidden carrier gets softer the longer the hold.
// The delay is tuned to the field's real scale: the stands are 236yd apart,
// about 34s of clean running each way, so the anti-turtle clock starts biting
// after roughly two full flag-to-flag runs.
export const BG_CARRIER_VULN_DELAY = 75;
export const BG_CARRIER_VULN_INTERVAL = 15;
export const BG_CARRIER_VULN_PER_STACK = 0.1;
const BG_FLAG_RETURN_TIME = 20; // a dropped flag auto-returns home after this
// Reach for the flag action. The stand is paved ground, not a plinth: a runner
// walks right up to the pole, so the reach stays tight.
export const BG_PICKUP_RADIUS = 2.5;
const BG_CAPTURE_RADIUS = 4; // carry the enemy flag this close to your stand
const BG_RUNE_RADIUS = 2.5; // step this close to a speed rune to claim it
const BG_RUNE_COOLDOWN = 30; // a claimed rune recharges over this (owner: 22 felt too fast)
const BG_RUNE_SPEED = 1.4; // sprint multiplier the rune grants
const BG_RUNE_DURATION = 10; // seconds of haste per rune
// Power runes: a short, honest edge worth a detour, never a win condition
// (owner-tuned: noticeably better than 10, below cooldown-stacking range).
export const BG_POWER_RUNE_VALUE = 0.15; // +15% dealt / -15% taken
const BG_POWER_RUNE_DURATION = 10;

// How long a hit keeps you on the victim's assist roster. Long enough that a
// opener into a teammate's finish still counts, short enough that a hit landed
// a fight ago does not. Tick math, never a clock.
const BG_ASSIST_WINDOW = 10;

// --- matchmaking fairness ---------------------------------------------------
// The queue is RATED but only lightly MATCHED, and that is deliberate at this
// population: a strict band on a thin queue means an empty battleground. So the
// rules below only ever REORDER a ten that is already assembled, or hold it
// briefly, and they always give way to waiting time.
/** Team-average rating gap tolerated straight away. */
export const BG_RATING_BAND = 150;
/** The band widens by this much for every second the oldest group has waited. */
export const BG_BAND_WIDEN_PER_SEC = 5;
/** Past this wait, ANY assembled ten starts: the queue must never starve. */
export const BG_FAIRNESS_MAX_WAIT = 60;
/**
 * How long a premade-versus-pugs ten is held back while a counterweight group
 * is hoped for. Deliberately SHORT: a party of friends queueing together is the
 * most ordinary thing at this population, and making them sit a full minute
 * every time would cost more than the mismatch does.
 */
export const BG_PREMADE_HOLD = 20;
/** A queued group this size or larger counts as a premade for the pug rule. */
export const BG_PREMADE_SIZE = 4;

const CARRIER_VULN_AURA_ID = 'bg_carrier_vulnerability';
/**
 * The always-visible "you have the flag" buff, and the classic WSG affordance
 * that comes with it: cancelling the buff drops the flag on purpose (a desktop
 * right-click, a confirmed long press on touch). Exported because the HUD's
 * toggle list, its never-shed list and the icon registry all name the same id,
 * and the tests assert the aura's lifetime per flag path.
 *
 * Its lifetime is exactly the carry. It is applied at the ONE pickup site and
 * removed by `clearCarrierAuras`, which every flag-leaving path already crosses
 * (capture, proximity return, auto-return, death drop, stealth drop, desertion,
 * match end, teardown). A cancel while it is really being carried is intercepted
 * by `bgCancelCarriedFlagAura` and routed into the authoritative drop instead of
 * a raw aura splice, so the buff can never come off while the flag stays on.
 */
export const CARRIED_FLAG_AURA_ID = 'bg_carried_flag';
export const SPRINT_RUNE_AURA_ID = 'bg_sprint_rune';
export const BATTLE_RUNE_AURA_ID = 'bg_battle_rune';
export const WARD_RUNE_AURA_ID = 'bg_ward_rune';

export interface BgFlagState {
  team: BgTeam; // home team
  home: Vec3; // world-space stand position
  pos: Vec3; // current world position (follows the carrier while carried)
  state: 'home' | 'carried' | 'dropped';
  carrier: number | null; // pid carrying this (enemy) flag
  dropTimer: number; // counts a dropped flag down to its auto-return
  carrySeconds: number; // continuous hold time by the current carrier
  vulnStacks: number; // carrier-vulnerability stacks currently applied
  entityId: number; // the ground entity that renders the flag
}

export type BgRuneType = 'sprint' | 'damage' | 'defense';

export interface BgRuneState {
  type: BgRuneType;
  pos: Vec3; // world
  active: boolean;
  cooldown: number; // seconds until it recharges
  entityId: number; // -1 while spent (the rune mesh despawns on cooldown)
}

// A live battleground: two teams of pids, scores, the two flags, the speed
// runes, the wave-respawn clocks, and per-player return bookkeeping.
export interface BgMatch {
  id: number;
  slot: number;
  teams: [number[], number[]]; // pids, index = team
  scores: [number, number];
  flags: [BgFlagState, BgFlagState];
  runes: BgRuneState[];
  state: 'countdown' | 'active' | 'ended';
  timer: number; // countdown remaining, elapsed seconds while active, then the end hold
  winner: BgTeam | null; // set when the result resolves; null is a draw once ended
  waveIn: [number, number]; // seconds until each team's next respawn wave
  returns: Map<number, { x: number; z: number; facing: number }>;
  preMatchPools: Map<number, ArenaReturnPools>;
  pendingFlagPress: Set<number>; // deliberate presses, resolved next update
  honorTeamKeys: [string, string]; // snapshotted at start (rename-proof DR keys)
  // false for /dev bg force-starts (jgyy review): a dev-forced, possibly
  // asymmetric match must never move the real ladder, W/L, or honor.
  rated: boolean;
  // At least one side was seated from a QUEUED GROUP of 2 or more. Supplied by
  // the matchmaker at start, because that is the only place the provenance
  // exists: live party membership answers a different question (a solo queuer
  // can accept an invite mid-wait, a queued party can dissolve mid-wait), and by
  // the time the result resolves formBgTeamParty has welded BOTH teams into
  // match parties so every fighter looks partied. Observability only, no
  // gameplay branch reads it.
  //
  // Deliberately NOT the matchmaker's own `premadeVsPugs` notion, which means a
  // block of BG_PREMADE_SIZE or more facing nothing but solos: that one drives
  // the fairness hold, this one is the coarse composition split for the
  // cap-tuning metrics. Two different questions, kept under two names.
  grouped: boolean;
  // Per-player match tallies for the scoreboard (seeded to zeros at start;
  // a deserter's row drops with their team entry).
  stats: Map<
    number,
    {
      kills: number;
      deaths: number;
      captures: number;
      /** Killing blows this player helped land without finishing. */
      assists: number;
    }
  >;
  ratingAvg: [number, number]; // team average rating at start, for Elo
  // Fighters seated by backfillBgMatches after the match began. They play for
  // honor, objectives, and the scoreboard, but the ladder does not move for
  // them: they inherit a scoreline they had no hand in, and `ratingAvg` was
  // averaged over the ORIGINAL ten, so an arrival is outside the Elo the match
  // is being scored against either way. Their absence from the rating math is
  // what keeps the seat worth accepting.
  backfilled: Set<number>;
  // Candidates who were offered a seat in THIS match and said no. A decline
  // costs them nothing (see declineBgBackfill), so without this the still-open
  // seat would offer them the same match again on the very next tick, forever.
  backfillDeclined: Set<number>;
  // Per team: pids auto-added to the team party at start (never the surviving
  // base premade), unwound at match end or on desertion (battleground_party.ts).
  autoPartyPids: [number[], number[]];
  resultRecorded: boolean;
  fightersReleased: boolean; // releaseBgFighters ran (teardown is once-only)
  // `/dev bg end` forced this result. The match may be perfectly RATED (a real
  // queued one a dev cut short), so `rated` alone cannot keep it out of the
  // operator record: an arbitrary clock and an arbitrary ending would poison
  // the very caps-vs-timer ratio those records exist to answer.
  devEnded: boolean;
  // Remaining-time calls already announced (BG_TIME_WARNINGS thresholds, in
  // seconds left). On the MATCH so a threshold fires exactly once per match:
  // the active-phase clock only moves forward, but the end hold reuses `timer`
  // as a countdown, and a set makes the once-only claim independent of that.
  timeWarningsFired: Set<number>;
  // Assist bookkeeping. `recentDamage` maps a VICTIM pid to everyone who has
  // hit them lately and the match-elapsed second of that hit; the death hook
  // reads it, pays everyone but the killer, and drops the row. Pruned on write
  // and on death, so it can never grow past the ten fighters in the match.
  recentDamage: Map<number, Map<number, number>>;
  // The healer's half of the same idea: who HEALED an ally lately, mapped
  // ally -> healer -> match-elapsed second. A kill pays the healers who kept
  // its fighters standing, so a priest who never lands a blow still earns.
  recentSupport: Map<number, Map<number, number>>;
  // Per-match repeat counters for the kill and assist honor drip, keyed
  // `attacker:victim`. On the MATCH, not the daily window: they exist to stop
  // graveyard farming inside one battleground, not to taper a whole session.
  killHonorPairs: Map<string, number>;
  assistHonorPairs: Map<string, number>;
  // per-tick memo of the viewer-identical match view (server hot-path rule:
  // build shared things once per tick, never per viewer)
  viewTick: number;
  viewShared: import('../../world_api').BgMatchInfo | null;
}

// A queued group: a whole party (or a solo) that matchmaking keeps together.
export interface BgQueueGroup {
  pids: number[];
  /** Seconds this group has waited, ticked by the matchmaker. Fairness is
   *  traded away against it: see BG_FAIRNESS_MAX_WAIT. */
  waited: number;
}

export function bgGroupContaining(ctx: SimContext, pid: number): BgQueueGroup | null {
  return ctx.bgQueue.find((g) => g.pids.includes(pid)) ?? null;
}

export function bgQueueSize(ctx: SimContext): number {
  return ctx.bgQueue.reduce((s, g) => s + g.pids.length, 0);
}

export function bgTeamOf(match: BgMatch, pid: number): BgTeam {
  return match.teams[1].includes(pid) ? 1 : 0;
}

export function bgAllPids(match: BgMatch): number[] {
  return [...match.teams[0], ...match.teams[1]];
}

export function bgMatchFor(ctx: SimContext, pid: number): BgMatch | null {
  return ctx.bgMatches.get(pid) ?? null;
}

function bgEmitAll(ctx: SimContext, match: BgMatch, ev: (pid: number) => void): void {
  for (const mp of bgAllPids(match)) ev(mp);
}

export function bgQueueJoin(ctx: SimContext, pid?: number, opts?: { bypassLevel?: boolean }): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  if (ctx.bgMatches.has(id)) {
    ctx.error(id, 'You are already in a battleground.');
    return;
  }
  // Dying and stepping into a dungeon are deliberately NOT refusals. Waiting in
  // line is not an activity, so it should survive whatever the player does with
  // the wait; a corpse run or a dungeon pull that silently cancelled the queue
  // was the single most common way players lost a spot without noticing. The
  // seat handles both: placeInBg revives and clears the spirit arm, and the pop
  // detaches an instanced fighter through the dungeon door (startBgMatch).
  if (ctx.arenaMatches.has(id)) {
    ctx.error(id, 'You cannot queue for Thornhollow Fields while in another match.');
    return;
  }
  const lockedUntil = bgRequeueLockedUntil(ctx, id);
  if (lockedUntil > 0) {
    ctx.error(
      id,
      `You must wait ${Math.max(1, Math.ceil(lockedUntil - ctx.time))} seconds before queueing for Thornhollow Fields again.`,
    );
    return;
  }
  if (bgProposalFor(ctx, id)) {
    ctx.error(id, 'You have a Thornhollow Fields invitation waiting. Answer it first.');
    return;
  }
  if (!opts?.bypassLevel && r.e.level < BG_MIN_LEVEL) {
    ctx.error(id, `Thornhollow Fields requires level ${BG_MIN_LEVEL}.`);
    return;
  }
  const existing = bgGroupContaining(ctx, id);
  if (existing) {
    ctx.emit({ type: 'bgQueued', position: ctx.bgQueue.indexOf(existing) + 1, pid: id });
    return;
  }
  // Queue the whole party as one group (kept together by matchmaking); solo
  // players queue alone. An over-size party is refused outright rather than
  // silently truncated.
  const party = ctx.partyOf(id);
  if (party && party.members.length > BG_TEAM_SIZE) {
    ctx.error(id, 'Your party is too large for Thornhollow Fields. It queues parties of up to 5.');
    return;
  }
  // Leader-only, the same rule every other grouped queue already runs (arena
  // 2v2 and Protect Yumi, the Vale Cup, the Dungeon Finder): the press commits
  // every member to a rated match, so it belongs to the one player who speaks
  // for the group. A solo player is their own leader, so solo queueing is
  // untouched; leaving the queue stays open to any member.
  if (party && party.members.length > 1 && party.leader !== id) {
    ctx.error(id, 'Only the party leader may queue your team for Thornhollow Fields.');
    return;
  }
  const members = party ? [...party.members] : [id];
  for (const m of members) {
    // A live OFFER counts as unavailable, the same as a seat or a queue slot.
    // Without it a solo could take a queue pop, accept a party invite before
    // answering it, and be queued again by the leader: the character would sit
    // in a pending offer AND a fresh group at once, and declining or lapsing
    // the first would leave the new group standing, bypassing the requeue
    // lockout that decline is supposed to cost them.
    if (
      ctx.bgMatches.has(m) ||
      ctx.arenaMatches.has(m) ||
      bgGroupContaining(ctx, m) ||
      bgProposalFor(ctx, m)
    ) {
      ctx.error(id, 'A party member is already queued or in a match.');
      return;
    }
    // The lockout is the same bypass one step later: it is charged to the
    // PLAYER, so a leader's press must not carry a locked-out member back into
    // the queue the press they ignored just cost them.
    if (bgRequeueLockedUntil(ctx, m) > 0) {
      ctx.error(id, 'A party member must wait before queueing for Thornhollow Fields again.');
      return;
    }
    const member = ctx.entities.get(m);
    if (!opts?.bypassLevel && member && member.level < BG_MIN_LEVEL) {
      ctx.error(
        id,
        `Every party member must be level ${BG_MIN_LEVEL} to queue for Thornhollow Fields.`,
      );
      return;
    }
  }
  ctx.bgQueue.push({ pids: [...members], waited: 0 });
  const position = ctx.bgQueue.length;
  for (const m of members) {
    ctx.emit({ type: 'bgQueued', position, pid: m });
    ctx.emit({
      type: 'log',
      text:
        party && members.length > 1
          ? `Your party of ${members.length} joins the Thornhollow Fields queue.`
          : `You join the Thornhollow Fields queue. Need ${BG_TEAM_SIZE * 2} champions to start a match.`,
      color: '#7fd4ff',
      pid: m,
    });
  }
}

export function bgQueueLeave(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const group = bgGroupContaining(ctx, r.meta.entityId);
  if (!group) return;
  ctx.bgQueue = ctx.bgQueue.filter((g) => g !== group);
  for (const m of group.pids) {
    ctx.emit({ type: 'bgUnqueued', pid: m });
    ctx.emit({
      type: 'log',
      text: 'You leave the Thornhollow Fields queue.',
      color: '#7fd4ff',
      pid: m,
    });
  }
}

/** Drop ONE pid out of the queue (disconnect path); their group stays queued. */
export function bgDequeue(ctx: SimContext, pid: number): boolean {
  const group = bgGroupContaining(ctx, pid);
  if (!group) return false;
  group.pids = group.pids.filter((p) => p !== pid);
  if (group.pids.length === 0) ctx.bgQueue = ctx.bgQueue.filter((g) => g !== group);
  return true;
}

function freeBgSlot(ctx: SimContext): number | null {
  for (let i = 0; i < BG_SLOT_COUNT; i++) if (!ctx.bgBusySlots.has(i)) return i;
  return null;
}

// The deliberate battleground action press. Validated eagerly for feedback,
// then queued and resolved inside the next update pass AFTER proximity
// auto-returns run, so an automatic return beats a same-tick pickup press
// (pinned by tests/battleground.test.ts).
export function bgFlagAction(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  const match = ctx.bgMatches.get(id);
  if (!match || match.state !== 'active' || r.e.dead) return;
  const near = match.flags.some(
    (f) =>
      f.state !== 'carried' &&
      f.team !== bgTeamOf(match, id) &&
      dist2d(r.e.pos, f.pos) <= BG_PICKUP_RADIUS,
  );
  if (!near) {
    ctx.error(id, 'There is no flag within reach.');
    return;
  }
  match.pendingFlagPress.add(id);
}

function dist2d(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function updateBattleground(ctx: SimContext): void {
  // Lapsed offers resolve BEFORE the matchmaker runs, so the slot and the
  // returning groups are back in play on the same tick they are released rather
  // than sitting out until the next one.
  sweepBgProposals(ctx);
  // BEFORE matchmaking, deliberately: repairing a live 4v5 beats starting a
  // fresh match with the same queued player. Draws no rng, so it appends to the
  // battleground phase without moving any existing draw.
  backfillBgMatches(ctx);
  matchmakeBg(ctx);
  const seen = new Set<BgMatch>();
  for (const match of ctx.bgMatches.values()) {
    if (seen.has(match)) continue;
    seen.add(match);
    if (match.state === 'countdown') {
      tickCountdown(ctx, match);
      continue;
    }
    if (match.state === 'ended') {
      // The frozen result screen: no combat (the hostility arm requires
      // 'active'), no flags, no waves; just the hold running out.
      match.timer -= DT;
      if (match.timer <= 0) releaseBgFighters(ctx, match);
      continue;
    }
    match.timer += DT;
    // Graveyards before the wave: an auto-release landing on the wave tick
    // still catches that wave, and the raise position is post-ward.
    tickGraveyards(ctx, match);
    tickWaveRespawns(ctx, match);
    tickRunes(ctx, match);
    tickFlags(ctx, match);
    match.pendingFlagPress.clear();
    // AFTER the flag pass above, so a capture that wins the match on this tick
    // suppresses the call (tickFlags can enter the end hold, and the guard
    // inside tickTimeWarnings is what reads that); before the cap check below,
    // so the calls read in narrative order against the ending they precede.
    tickTimeWarnings(ctx, match);
    if (match.timer >= BG_MAX_DURATION && !match.resultRecorded) {
      // The match cap resolves on score; an equal score is a draw.
      const w: BgTeam | null =
        match.scores[0] === match.scores[1] ? null : match.scores[0] > match.scores[1] ? 0 : 1;
      enterBgEndHold(ctx, match, w, 'timeout');
    }
  }
}

/**
 * The remaining-time calls (BG_TIME_WARNINGS). Pure tick math over the match
 * clock, zero rng, fanned to all ten members like `bgKill`: the clock is the
 * whole field's information, not one player's.
 *
 * A threshold fires only on the tick its remaining time CROSSES the mark
 * (strictly above it before this tick's DT, at or below it after), so a match
 * whose cap is already at or under a mark never announces that mark instead of
 * announcing it on tick one, and the already-fired set makes the claim
 * once-only even though the end hold reuses `timer` as a countdown.
 *
 * Two SEPARATE guards keep it quiet when there is nothing to say, and the
 * second is easy to mistake for redundant:
 *  - the form-up countdown never reaches here at all (the caller's countdown
 *    arm `continue`s before the active phase);
 *  - a match ALREADY WON ON THIS TICK does reach here, because `tickFlags` runs
 *    first in the same straight-line block and can enter the end hold without a
 *    `continue`. The `resultRecorded` bail below is what suppresses that, NOT
 *    the caller. Deleting it would leave `timer` reading as BG_END_HOLD, which
 *    happens not to cross a mark at today's constants, so the bug would sit
 *    latent until BG_END_HOLD or BG_TIME_WARNINGS changed.
 */
function tickTimeWarnings(ctx: SimContext, match: BgMatch): void {
  if (match.resultRecorded) return;
  const remainingBefore = BG_MAX_DURATION - (match.timer - DT);
  const remainingAfter = BG_MAX_DURATION - match.timer;
  for (const mark of BG_TIME_WARNINGS) {
    if (remainingBefore <= mark || remainingAfter > mark) continue;
    if (match.timeWarningsFired.has(mark)) continue;
    match.timeWarningsFired.add(mark);
    bgEmitAll(ctx, match, (pid) => ctx.emit({ type: 'bgTimeWarning', secondsLeft: mark, pid }));
  }
}

function tickCountdown(ctx: SimContext, match: BgMatch): void {
  const origin = battlegroundOrigin(match.slot);
  // Hold the form-up: a player who slips out of their keep mouth before the
  // gates open is set back on their spawn ring.
  for (const team of [0, 1] as BgTeam[]) {
    const bounds = keepInteriorBounds(team);
    match.teams[team].forEach((pid, i) => {
      const e = ctx.entities.get(pid);
      if (!e) return;
      const lx = e.pos.x - origin.x;
      const lz = e.pos.z - origin.z;
      const inKeep =
        lx >= bounds.minX && lx <= bounds.maxX && lz >= bounds.minZ && lz <= bounds.maxZ;
      if (!inKeep) {
        placeInBg(ctx, match, pid, team, i);
        // The set-back needs a reason on screen, not just a teleport
        // (naturally rate-limited: walking back out takes seconds).
        ctx.error(pid, 'The gates open when the battle begins.');
      }
    });
  }
  const before = Math.ceil(match.timer);
  match.timer -= DT;
  const after = Math.ceil(match.timer);
  if (after < before && after > 0) {
    bgEmitAll(ctx, match, (pid) => ctx.emit({ type: 'bgCountdown', seconds: after, pid }));
  }
  if (match.timer <= 0) {
    match.state = 'active';
    match.timer = 0;
    match.waveIn = [BG_WAVE_PERIOD, BG_WAVE_OFFSET];
    for (const pid of bgAllPids(match)) {
      const e = ctx.entities.get(pid);
      if (e) {
        ctx.readyArenaFighter(e, { clearPrep: true });
        e.ghost = false;
        e.corpsePos = null;
        e.corpseInstanceId = null;
      }
      ctx.emit({
        type: 'log',
        text: 'The Thornhollow Fields battle begins: take their flag!',
        color: '#ff5a3c',
        pid,
      });
      ctx.emit({ type: 'bgStart', pid });
    }
  }
}

/**
 * Seat queued solos into live matches that a desertion left short. At most one
 * seat per match per tick: the next tick fills the next one, which keeps this a
 * flat pass over the matches rather than a loop that can drain the whole queue
 * into one battleground.
 *
 * A backfilled fighter plays the match UNRATED (see BgMatch.backfilled): they
 * inherit a scoreline they had no part in, and on a rated ladder that is the
 * difference between a seat worth taking and one every player learns to dodge.
 */
function backfillBgMatches(ctx: SimContext): void {
  if (ctx.bgQueue.length === 0) return;
  const seen = new Set<BgMatch>();
  for (const match of ctx.bgMatches.values()) {
    if (seen.has(match)) continue;
    seen.add(match);
    const team = bgBackfillSeat({
      state: match.state,
      secondsLeft: BG_MAX_DURATION - match.timer,
      scores: match.scores,
      teamSizes: [match.teams[0].length, match.teams[1].length],
      teamSize: BG_TEAM_SIZE,
      capsToWin: BG_CAPS_TO_WIN,
    });
    if (team === null) continue;
    // One offer per match at a time. The seat stays OPEN while a candidate is
    // deciding, so without this the next tick would read the same short side
    // and offer it to somebody else, and the tick after that to a third, until
    // the queue was drained into a pile of competing invitations for one chair.
    if (ctx.bgProposals.some((p) => p.backfill?.match === match)) continue;
    // Liveness is folded into SELECTION, not applied after it. Picking the
    // oldest solo first and only then testing them meant a single temporarily
    // ineligible candidate blocked every backfill behind them: the loop moved
    // on to the next MATCH, so a live 4v5 stayed unfilled while eligible solos
    // waited. A failing candidate is still left queued, so matchmakeBg remains
    // the ONE site that unqueues and tells the player why.
    //
    // The rule mirrors matchmakeBg's hygiene, which is now three causes: gone
    // offline, already seated, or committed to an arena match. Dying and
    // standing in a dungeon deliberately no longer disqualify anyone (the seat
    // revives and detaches them), so a corpse in the queue is a valid backfill.
    const eligible: { index: number; size: number; waited: number }[] = [];
    ctx.bgQueue.forEach((g, i) => {
      const cand = g.pids[0];
      if (!ctx.entities.get(cand) || ctx.bgMatches.has(cand) || ctx.arenaMatches.has(cand)) return;
      // ...and never double-offer: a solo already holding a queue-pop offer, or
      // sitting out the lockout from one they just failed, is not available.
      if (bgProposalFor(ctx, cand) || bgRequeueLockedUntil(ctx, cand) > 0) return;
      if (match.backfillDeclined.has(cand)) return;
      eligible.push({ index: i, size: g.pids.length, waited: g.waited });
    });
    const pickedAt = pickBgBackfillGroup(eligible.map((c) => ({ size: c.size, waited: c.waited })));
    if (pickedAt < 0) return; // no eligible solo waiting: no later match can do better
    const index = eligible[pickedAt].index;
    const [group] = ctx.bgQueue.splice(index, 1);
    // ASK, never seat. The seat is a teleport into a live rated 5v5 that also
    // detaches the player from any dungeon they are standing in, scrubbing
    // their threat off the whole claim; doing that to someone who is not at the
    // keyboard is the exact failure the queue-pop prompt was built to stop, and
    // it lands harder here: a filled side is never offered a backfill again,
    // and a body that never disconnects never deserts, so the seat it consumed
    // cannot reopen. Declining or lapsing frees it for the next candidate.
    openBgBackfillProposal(ctx, match, team, group);
  }
}

/** Put one queued solo into an open seat on a match already under way. */
function seatBackfill(ctx: SimContext, match: BgMatch, team: BgTeam, pid: number): void {
  const e = ctx.entities.get(pid);
  if (!e) return;
  // Snapshot the same per-fighter state startBgMatch takes, so the release path
  // sends them home and hands their pools back exactly like a start-of-match
  // fighter. Skipping either would strand them on the field at match end.
  //
  // detachFromDungeon FIRST, for the same reason startBgMatch does it: the queue
  // hygiene deliberately holds a spot through a dungeon pull, so a candidate can
  // be standing inside an instance. Storing the interior position would send
  // them back to a claim that may be gone by match end, and would leave the
  // instance holding their aggro for the whole match.
  const door = detachFromDungeon(ctx, e);
  match.returns.set(pid, { x: door?.x ?? e.pos.x, z: door?.z ?? e.pos.z, facing: e.facing });
  match.preMatchPools.set(pid, snapshotArenaReturnPools(e));
  match.stats.set(pid, { kills: 0, deaths: 0, captures: 0, assists: 0 });
  match.backfilled.add(pid);
  const index = match.teams[team].length;
  match.teams[team].push(pid);
  ctx.bgMatches.set(pid, match);
  placeInBg(ctx, match, pid, team, index);
  // The auto-added list is what marks which members this system put in the
  // party, and so which of them the join may sweep out; see joinBgTeamParty.
  if (joinBgTeamParty(ctx, match.teams[team], pid, { autoAdded: match.autoPartyPids[team] })) {
    match.autoPartyPids[team].push(pid);
  }
  // honorTeamKeys is deliberately NOT recomputed: it is the anti-farm identity
  // of the side that STARTED the match, and letting a substitution mint a fresh
  // key would hand a farming pair a way to reset their own diminishing returns.
  ctx.emit({ type: 'bgFound', team, pid });
  if (match.state === 'countdown') {
    ctx.emit({ type: 'bgCountdown', seconds: Math.max(0, Math.ceil(match.timer)), pid });
  }
  ctx.emit({
    type: 'log',
    text: `Thornhollow Fields: you join a battle already under way for the ${BG_TEAM_NAMES[team]}. This match will not change your rating.`,
    color: '#7fd4ff',
    pid,
  });
  bgEmitAll(ctx, match, (mp) => {
    if (mp === pid) return;
    ctx.emit({
      type: 'log',
      text: `A fresh fighter joins the ${BG_TEAM_NAMES[team]}.`,
      color: '#7fd4ff',
      pid: mp,
    });
  });
}

function matchmakeBg(ctx: SimContext): void {
  // Waiting in line survives whatever the player does with the wait: dying and
  // walking into a dungeon USED to drop them here, which is how players lost a
  // spot without noticing. Exactly three things still end the wait, and only the
  // last of them is the player's own doing worth a line of text:
  //   offline        the entity is gone, so there is nobody left to tell
  //   already seated a match claimed them (backfill, /dev); silent by design
  //   arena match    they committed to a different rated fight
  // Anything else HOLDS the spot, and the pop cleans up after them instead.
  for (const g of ctx.bgQueue) {
    g.pids = g.pids.filter((p) => {
      const e = ctx.entities.get(p);
      if (!e || ctx.bgMatches.has(p)) return false;
      if (!ctx.arenaMatches.has(p)) return true;
      ctx.emit({ type: 'bgUnqueued', pid: p });
      ctx.emit({
        type: 'log',
        text: 'You leave the Thornhollow Fields queue.',
        color: '#7fd4ff',
        pid: p,
      });
      return false;
    });
  }
  ctx.bgQueue = ctx.bgQueue.filter((g) => g.pids.length > 0);
  // The fairness clock is a TICK clock: a waiting group ages exactly DT per
  // tick, whether this tick seats nothing, one match, or fills every slot.
  // Inside the retry loop below it aged once per seated match, so a leftover
  // group was handed band widening (and the starvation release) it had not
  // actually waited for.
  for (const g of ctx.bgQueue) g.waited += DT;
  let guard = BG_SLOT_COUNT + 1;
  while (guard-- > 0) {
    if (bgQueueSize(ctx) < BG_TEAM_SIZE * 2 || freeBgSlot(ctx) === null) return;
    const picked = pickBgTeams(ctx);
    if (!picked) return;
    const slot = freeBgSlot(ctx);
    if (slot === null) return; // re-checked: the loop above may have taken the last one
    ctx.bgQueue = ctx.bgQueue.filter((g) => !picked.used.includes(g));
    // A pick is now an OFFER, not a seat: it is held as a proposal until all ten
    // accept (battleground_proposal.ts). The QUEUED-GROUP provenance, which only
    // the matchmaker holds, rides along on it: a group of 2+ queued together.
    // Live party membership is NOT the same question (a solo queuer can accept
    // an invite while waiting, and a queued party can dissolve mid-wait), so it
    // is read here rather than from partyOf at start.
    openBgProposal(
      ctx,
      picked.teams,
      picked.used,
      slot,
      picked.used.some((g) => g.pids.length > 1),
    );
  }
}

/** Seat an accepted proposal on the slot it has been holding. */
function seatBgProposal(ctx: SimContext, proposal: BgProposal): void {
  ctx.bgProposals.splice(ctx.bgProposals.indexOf(proposal), 1);
  startBgMatch(ctx, proposal.teams[0], proposal.teams[1], {
    grouped: proposal.grouped,
    slot: proposal.slot,
  });
}

/** Answer a live queue-pop proposal; a full house seats the match immediately. */
export function bgRespond(ctx: SimContext, accept: boolean, pid?: number): void {
  const ready = bgProposalRespond(ctx, accept, pid);
  if (!ready) return;
  if (ready.backfill) {
    // A backfill offer holds no slot of its own, so it is simply dropped and
    // the one accepted fighter takes the seat that was held open for them.
    ctx.bgProposals.splice(ctx.bgProposals.indexOf(ready), 1);
    const { match, team } = ready.backfill;
    const joiner = ready.teams[team][0];
    // Re-resolve the seat at ACCEPT time. Everything the offer was based on is
    // up to thirty seconds old by now, and two of those staleness windows are
    // real damage rather than cosmetic:
    //
    //  - the match can have ENDED underneath the offer (a collapsing team is
    //    what opens a seat in the first place, so the forfeit case is the
    //    likely one). Teardown is once-only, so seating into a released match
    //    put the joiner in bgMatches with nothing left to take them out: they
    //    could neither play nor queue again, and the freed slot meant a fresh
    //    match could start on the field they were standing in.
    //  - the two cutoffs the seat rule enforces, a match not nearly over and a
    //    side not one capture from losing, exist so nobody is dropped into
    //    someone else's ending. Checked only at offer time, accepting at second
    //    29 walks straight past both.
    //
    // Re-running the same rule answers all of it, and a seat that is no longer
    // there costs the player nothing: they keep the place they were holding.
    const gone =
      match.fightersReleased ||
      match.resultRecorded ||
      bgBackfillSeat({
        state: match.state,
        secondsLeft: BG_MAX_DURATION - match.timer,
        scores: match.scores,
        teamSizes: [match.teams[0].length, match.teams[1].length],
        teamSize: BG_TEAM_SIZE,
        capsToWin: BG_CAPS_TO_WIN,
      }) !== team;
    if (gone) {
      ctx.bgQueue.push(...ready.groups);
      ctx.emit({
        type: 'log',
        text: 'That battle no longer needs a fighter. You keep your place in the Thornhollow Fields queue.',
        color: '#7fd4ff',
        pid: joiner,
      });
      return;
    }
    seatBackfill(ctx, match, team, joiner);
    return;
  }
  seatBgProposal(ctx, ready);
}

/** One candidate pairing, plus the numbers the fairness rules read off it. */
interface BgPacking {
  teams: [number[], number[]];
  used: BgQueueGroup[];
  /** Team-average rating gap. */
  gap: number;
  /** A premade on one side facing nothing but solos on the other. */
  premadeVsPugs: boolean;
}

/**
 * Pack whole groups into two teams of five. `preferRating` decides the tiebreak
 * when a group fits on either side: by headcount (the plain balance) or toward
 * the team whose running rating total is lower (which is what actually closes
 * a rating gap). Both walk the SAME group order, so both are deterministic and
 * neither draws rng.
 */
function packBgTeams(ctx: SimContext, preferRating: boolean): BgPacking | null {
  // Size-desc with a queue-order tiebreak: an explicit total order (the repo
  // rule), not a lean on engine sort stability.
  const groups = ctx.bgQueue
    .map((g, seq) => ({ g, seq }))
    .sort((a, b) => b.g.pids.length - a.g.pids.length || a.seq - b.seq)
    .map((x) => x.g);
  const teams: [number[], number[]] = [[], []];
  const totals: [number, number] = [0, 0];
  const used: BgQueueGroup[] = [];
  for (const g of groups) {
    const canA = teams[0].length + g.pids.length <= BG_TEAM_SIZE;
    const canB = teams[1].length + g.pids.length <= BG_TEAM_SIZE;
    let t = -1;
    if (canA && canB) {
      t = preferRating
        ? // Lower running total first; headcount breaks a rating tie, and side
          // 0 breaks that, so the choice is always total.
          totals[0] !== totals[1]
          ? totals[0] < totals[1]
            ? 0
            : 1
          : teams[0].length <= teams[1].length
            ? 0
            : 1
        : teams[0].length <= teams[1].length
          ? 0
          : 1;
    } else if (canA) t = 0;
    else if (canB) t = 1;
    if (t < 0) continue;
    teams[t].push(...g.pids);
    totals[t] += g.pids.reduce(
      (sum, p) => sum + (ctx.players.get(p)?.bgRating ?? BG_BASE_RATING),
      0,
    );
    used.push(g);
  }
  if (teams[0].length !== BG_TEAM_SIZE || teams[1].length !== BG_TEAM_SIZE) return null;
  const biggest = (team: number[]): number => {
    let best = 0;
    for (const g of used) {
      if (g.pids.every((p) => team.includes(p))) best = Math.max(best, g.pids.length);
    }
    return best;
  };
  const bigA = biggest(teams[0]);
  const bigB = biggest(teams[1]);
  return {
    teams,
    used,
    gap: Math.abs(bgTeamAvg(ctx, teams[0]) - bgTeamAvg(ctx, teams[1])),
    // The mismatch players actually feel: a coordinated block on one side with
    // nothing but solo queuers opposite it.
    premadeVsPugs: (bigA >= BG_PREMADE_SIZE && bigB <= 1) || (bigB >= BG_PREMADE_SIZE && bigA <= 1),
  };
}

/**
 * Choose the pairing to start, or null to keep waiting. Two candidate packings
 * are scored and the better one taken; if even that one is unfair, the match is
 * held back until the queue's oldest group has waited long enough that a match
 * beats a fair match. It ALWAYS releases eventually: on a thin queue an empty
 * battleground is the worse outcome, and the queue contents may never improve.
 */
function pickBgTeams(ctx: SimContext): BgPacking | null {
  const candidates = [packBgTeams(ctx, false), packBgTeams(ctx, true)].filter(
    (c): c is BgPacking => c !== null,
  );
  if (candidates.length === 0) return null;
  // A premade facing pugs outweighs any rating gap: it is the mismatch a player
  // can see from the first fight.
  const score = (c: BgPacking): number => (c.premadeVsPugs ? 100_000 : 0) + c.gap;
  let best = candidates[0];
  for (const c of candidates) if (score(c) < score(best)) best = c;
  // The wait that buys a concession is the wait of the groups this pairing
  // actually seats, never the whole queue's: a group nothing can pack (a
  // three-stack behind two full premades, say) ages forever, and reading its
  // clock here would quietly disable the premade hold and the rating band for
  // every unrelated ten behind it. Reduced, not spread: `used` is small today
  // but an argument-count limit that scales with the queue is not a limit
  // worth having (the colliders.ts precedent).
  let waited = 0;
  for (const g of best.used) if (g.waited > waited) waited = g.waited;
  if (waited >= BG_FAIRNESS_MAX_WAIT) return best; // the queue never starves
  // Hold a premade-versus-pugs ten only briefly: long enough for a second
  // group to show up, short enough that a party never feels punished for
  // queueing together.
  if (best.premadeVsPugs && waited < BG_PREMADE_HOLD) return null;
  const band = BG_RATING_BAND + waited * BG_BAND_WIDEN_PER_SEC;
  return best.gap <= band ? best : null;
}

function bgTeamAvg(ctx: SimContext, pids: number[]): number {
  if (pids.length === 0) return BG_BASE_RATING;
  return (
    pids.reduce((s, p) => s + (ctx.players.get(p)?.bgRating ?? BG_BASE_RATING), 0) / pids.length
  );
}

export function startBgMatch(
  ctx: SimContext,
  teamA: number[],
  teamB: number[],
  opts?: { rated?: boolean; grouped?: boolean; slot?: number },
): void {
  // A seat coming out of an accepted proposal brings the slot the proposal
  // reserved when it opened, so the field it has been holding for thirty seconds
  // cannot be taken out from under it here.
  const slot = opts?.slot ?? freeBgSlot(ctx);
  if (slot === null) {
    // Hand the seats back as two TEAM-SIZED groups: a single welded ten-group
    // could never be packed into 5v5 teams again by the matchmaker.
    ctx.bgQueue.unshift({ pids: [...teamB], waited: 0 });
    ctx.bgQueue.unshift({ pids: [...teamA], waited: 0 });
    return;
  }
  ctx.bgBusySlots.add(slot);
  const origin = battlegroundOrigin(slot);
  const returns = new Map<number, { x: number; z: number; facing: number }>();
  const preMatchPools = new Map<number, ArenaReturnPools>();
  for (const pid of [...teamA, ...teamB]) {
    const e = ctx.entities.get(pid);
    if (!e) continue;
    // A fighter popped out of a dungeon is detached from it here: their claim's
    // hate tables are scrubbed exactly as walking out of the door would, and
    // their return point becomes that door rather than the interior coordinates
    // they were standing on, which may belong to no live claim by the time the
    // match ends. Everyone else returns to the spot they were pulled from.
    const door = detachFromDungeon(ctx, e);
    returns.set(pid, { x: door?.x ?? e.pos.x, z: door?.z ?? e.pos.z, facing: e.facing });
    preMatchPools.set(pid, snapshotArenaReturnPools(e));
  }
  const flags = ([0, 1] as BgTeam[]).map((team) => {
    const home = ctx.groundPos(origin.x + BG_BASES[team].flag.x, origin.z + BG_BASES[team].flag.z);
    return {
      team,
      home,
      pos: { ...home },
      state: 'home' as const,
      carrier: null,
      dropTimer: 0,
      carrySeconds: 0,
      vulnStacks: 0,
      entityId: -1,
    };
  }) as [BgFlagState, BgFlagState];
  // ONE seeded draw opens both power pads on the same face (mirror fairness);
  // each pad then alternates per its own claims, deterministically. This is
  // the mode's single rng draw, at match START: the active phase stays
  // draw-free (the zero-rng pin).
  const powerFace: BgRuneType = ctx.rng.int(0, 1) === 0 ? 'damage' : 'defense';
  const runes: BgRuneState[] = [
    ...BG_SPEED_RUNES.map((rp) => ({
      type: 'sprint' as BgRuneType,
      pos: ctx.groundPos(origin.x + rp.x, origin.z + rp.z),
      active: true,
      cooldown: 0,
      entityId: -1,
    })),
    ...BG_POWER_RUNES.map((rp) => ({
      type: powerFace,
      pos: ctx.groundPos(origin.x + rp.x, origin.z + rp.z),
      active: true,
      cooldown: 0,
      entityId: -1,
    })),
  ];
  const match: BgMatch = {
    id: ctx.nextBgMatchId++,
    slot,
    teams: [teamA, teamB],
    stats: new Map(
      [...teamA, ...teamB].map((p) => [p, { kills: 0, deaths: 0, captures: 0, assists: 0 }]),
    ),
    scores: [0, 0],
    flags,
    runes,
    state: 'countdown',
    timer: BG_COUNTDOWN,
    winner: null,
    waveIn: [BG_WAVE_PERIOD, BG_WAVE_OFFSET],
    returns,
    preMatchPools,
    pendingFlagPress: new Set(),
    honorTeamKeys: [honorTeamIdentity(ctx, teamA), honorTeamIdentity(ctx, teamB)],
    rated: opts?.rated !== false,
    // Passed IN by the matchmaker, which is the only caller that still knows
    // which queued groups were seated; a direct-seat caller (tests, /dev) that
    // says nothing gets the honest default of "no grouped queue".
    grouped: opts?.grouped === true,
    ratingAvg: [bgTeamAvg(ctx, teamA), bgTeamAvg(ctx, teamB)],
    backfilled: new Set(),
    backfillDeclined: new Set(),
    autoPartyPids: [[], []],
    resultRecorded: false,
    fightersReleased: false,
    devEnded: false,
    timeWarningsFired: new Set(),
    recentDamage: new Map(),
    recentSupport: new Map(),
    killHonorPairs: new Map(),
    assistHonorPairs: new Map(),
    viewTick: -1,
    viewShared: null,
  };
  for (const pid of bgAllPids(match)) ctx.bgMatches.set(pid, match);
  for (const flag of flags) spawnFlagEntity(ctx, flag);
  for (const rune of runes) spawnRuneEntity(ctx, rune);
  for (const team of [0, 1] as BgTeam[]) {
    match.teams[team].forEach((pid, i) => {
      placeInBg(ctx, match, pid, team, i);
    });
  }
  // Weld each team into one party for the match (party chat + party frames);
  // only the auto-added links are remembered, so they can be unwound later.
  match.autoPartyPids = [formBgTeamParty(ctx, teamA), formBgTeamParty(ctx, teamB)];
  for (const team of [0, 1] as BgTeam[]) {
    for (const pid of match.teams[team]) {
      ctx.emit({ type: 'bgFound', team, pid });
      ctx.emit({ type: 'bgCountdown', seconds: BG_COUNTDOWN, pid });
      ctx.emit({
        type: 'log',
        text: `Thornhollow Fields: you fight for the ${BG_TEAM_NAMES[team]}. First to ${BG_CAPS_TO_WIN} captures wins.`,
        color: '#7fd4ff',
        pid,
      });
    }
  }
}

// Place a player at one of their keep's spawn points (round-robin by index),
// healed and reset for the fight.
function placeInBg(
  ctx: SimContext,
  match: BgMatch,
  pid: number,
  team: BgTeam,
  index: number,
): void {
  const e = ctx.entities.get(pid);
  if (!e) return;
  const origin = battlegroundOrigin(match.slot);
  const spawns = BG_BASES[team].spawns;
  const sp = spawns[index % spawns.length];
  e.pos = ctx.groundPos(origin.x + sp.x, origin.z + sp.z);
  e.prevPos = { ...e.pos };
  e.facing = team === 0 ? 0 : Math.PI; // face the field
  e.prevFacing = e.facing;
  ctx.rebucket(e);
  ctx.readyArenaFighter(e, { clearPrep: true });
  // readyArenaFighter revives but does NOT clear the spirit arm: a fighter
  // seated (or re-seated by the form-up hold) must never stay a ghost.
  e.ghost = false;
  e.corpsePos = null;
  e.corpseInstanceId = null;
  // Thornhollow Fields is fought on foot. Seating a fighter on the field is the
  // one place the whole roster passes through (match start AND the form-up
  // set-back), so it is where a mount summoned in the open world before the
  // queue popped is taken away, along with any channel still in flight (the
  // flag-grab arm's own pattern: a summon started a second and a half ago must
  // not land a rider inside the keep). The refusal in src/sim/mounts.ts is the
  // other half: this clears what is already there, that stops anything new.
  ctx.forceDismount(e);
  e.mountCastRemaining = 0;
  e.mountCastKey = '';
}

function spawnFlagEntity(ctx: SimContext, flag: BgFlagState): void {
  const e = createGroundObject(ctx.nextId++, '', `${BG_TEAM_NAMES[flag.team]} Flag`, {
    ...flag.pos,
  });
  e.templateId = 'bg_flag';
  e.objectItemId = null;
  e.lootable = false;
  e.color = BG_TEAM_COLORS[flag.team];
  ctx.addEntity(e);
  flag.entityId = e.id;
}

export const RUNE_VISUALS: Record<BgRuneType, { name: string; color: number }> = {
  sprint: { name: 'Sprint Rune', color: 0xff9a3c }, // orange (owner call), not gold-white
  damage: { name: 'Battle Rune', color: 0xe0392e }, // red
  defense: { name: 'Ward Rune', color: 0x3ccfe8 }, // cyan
};

function spawnRuneEntity(ctx: SimContext, rune: BgRuneState): void {
  const visual = RUNE_VISUALS[rune.type];
  const e = createGroundObject(ctx.nextId++, '', visual.name, { ...rune.pos });
  e.templateId = 'bg_rune';
  e.objectItemId = null;
  e.lootable = false;
  e.color = visual.color;
  ctx.addEntity(e);
  rune.entityId = e.id;
}

// One team-wide respawn clock per side, period BG_WAVE_PERIOD, the two clocks
// offset by BG_WAVE_OFFSET (staggered half-cycles, never synchronized). The
// wave raises every RELEASED spirit waiting in the team graveyard, together,
// in place; a corpse that never released waits for a later wave (release is
// the classic rite, and auto-release makes sure nobody waits forever).
function tickWaveRespawns(ctx: SimContext, match: BgMatch): void {
  for (const team of [0, 1] as BgTeam[]) {
    match.waveIn[team] -= DT;
    if (match.waveIn[team] > 0) continue;
    match.waveIn[team] += BG_WAVE_PERIOD;
    match.teams[team].forEach((pid) => {
      const e = ctx.entities.get(pid);
      if (!e || !e.dead || !e.ghost) return;
      e.ghost = false;
      // Cooldowns persist through a battleground death (classic rules); only
      // the match start hands out the full clean slate.
      ctx.readyArenaFighter(e, { clearPrep: false });
      // Rise where the spirit stands (inside the plot), facing the field.
      e.prevPos = { ...e.pos };
      e.facing = team === 0 ? 0 : Math.PI;
      e.prevFacing = e.facing;
      ctx.emit({ type: 'respawn', pid });
    });
  }
}

// The graveyard ward: a released spirit is bound to its team plot until the
// wave raises it. The corpse itself is untouched: releasing is the PLAYER'S
// deliberate press (classic rules, no auto-release, no corpse timer), and the
// wave only ever raises released spirits.
function tickGraveyards(ctx: SimContext, match: BgMatch): void {
  const origin = battlegroundOrigin(match.slot);
  // The ward box is the plot inset past the fence rails (which sit ON the
  // plot edge and intrude 1yd) plus the body radius, so the clamp can never
  // park a spirit inside a rail or the keep walls.
  const WARD_INSET = 1.6;
  for (const team of [0, 1] as BgTeam[]) {
    const plot = BG_GRAVEYARDS[team];
    const minX = origin.x + plot.x - plot.hw + WARD_INSET;
    const maxX = origin.x + plot.x + plot.hw - WARD_INSET;
    const minZ = origin.z + plot.z - plot.hd + WARD_INSET;
    const maxZ = origin.z + plot.z + plot.hd - WARD_INSET;
    for (const pid of match.teams[team]) {
      const e = ctx.entities.get(pid);
      if (!e || !e.dead || !e.ghost) continue;
      const cx = Math.min(maxX, Math.max(minX, e.pos.x));
      const cz = Math.min(maxZ, Math.max(minZ, e.pos.z));
      if (cx !== e.pos.x || cz !== e.pos.z) {
        e.pos = ctx.groundPos(cx, cz);
        e.prevPos = { ...e.pos };
        ctx.rebucket(e);
      }
    }
  }
}

function tickRunes(ctx: SimContext, match: BgMatch): void {
  for (const rune of match.runes) {
    if (!rune.active) {
      rune.cooldown -= DT;
      if (rune.cooldown <= 0) {
        rune.active = true;
        spawnRuneEntity(ctx, rune);
      }
      continue;
    }
    // first live player to step on it claims the sprint (team roster order
    // within a tick: deterministic, no rng)
    for (const pid of bgAllPids(match)) {
      const e = ctx.entities.get(pid);
      if (!e || e.dead) continue;
      if (dist2d(e.pos, rune.pos) <= BG_RUNE_RADIUS) {
        if (rune.type === 'sprint') {
          ctx.applyAura(e, {
            id: SPRINT_RUNE_AURA_ID,
            name: 'Sprint',
            kind: 'buff_speed',
            value: BG_RUNE_SPEED,
            remaining: BG_RUNE_DURATION,
            duration: BG_RUNE_DURATION,
            sourceId: e.id,
            school: 'physical',
          });
          ctx.emit({ type: 'log', text: 'You seize a Sprint Rune!', color: '#ff9a3c', pid });
        } else if (rune.type === 'damage') {
          ctx.applyAura(e, {
            id: BATTLE_RUNE_AURA_ID,
            name: 'Battle Rune',
            kind: 'buff_dmg_done',
            value: BG_POWER_RUNE_VALUE,
            remaining: BG_POWER_RUNE_DURATION,
            duration: BG_POWER_RUNE_DURATION,
            sourceId: e.id,
            school: 'physical',
          });
          ctx.emit({ type: 'log', text: 'You seize a Battle Rune!', color: '#ff6a5a', pid });
        } else {
          ctx.applyAura(e, {
            id: WARD_RUNE_AURA_ID,
            name: 'Ward Rune',
            kind: 'shield_wall',
            value: BG_POWER_RUNE_VALUE,
            remaining: BG_POWER_RUNE_DURATION,
            duration: BG_POWER_RUNE_DURATION,
            sourceId: e.id,
            school: 'physical',
          });
          ctx.emit({ type: 'log', text: 'You seize a Ward Rune!', color: '#3ccfe8', pid });
        }
        rune.active = false;
        rune.cooldown = BG_RUNE_COOLDOWN;
        if (rune.entityId >= 0) {
          ctx.dropEntity(rune.entityId);
          rune.entityId = -1;
        }
        // A claimed power pad flips its face for the next spawn: variety
        // without a single draw in the active phase.
        if (rune.type !== 'sprint') rune.type = rune.type === 'damage' ? 'defense' : 'damage';
        break;
      }
    }
  }
}

function tickFlags(ctx: SimContext, match: BgMatch): void {
  // TWO PASSES, and the split is the point. A capture needs the runner's own
  // flag to be home, so if returns and capture checks shared one pass in flag
  // index order, whether a waiting runner scored on this tick or the next one
  // would depend on which team they were: team 0's flag is returned in
  // iteration 0 (before team 1's carried flag is checked), while team 1's is
  // returned in iteration 1 (after team 0's carried flag was already checked).
  // One tick is 50ms and changes no outcome, but a rated field must not be
  // asymmetric between the two sides at all, so every return lands first and
  // both teams' capture checks then read the same world.
  for (const flag of match.flags) {
    if (flag.state !== 'dropped') continue;
    for (const pid of match.teams[flag.team]) {
      const e = ctx.entities.get(pid);
      if (!e || e.dead) continue;
      if (dist2d(e.pos, flag.pos) <= BG_PICKUP_RADIUS) {
        returnFlag(ctx, match, flag, ctx.players.get(pid)?.name ?? '');
        break;
      }
    }
  }
  for (const flag of match.flags) {
    if (flag.state === 'carried') {
      tickCarriedFlag(ctx, match, flag);
      continue;
    }
    // The flag's own team already had its chance to return this flag in the
    // pass above, which is what keeps an automatic return beating a same-tick
    // pickup press (the pinned race rule): a returned flag is no longer
    // 'dropped' by the time the press below is read.
    //
    // The ENEMY team picks it up (from stand or ground) only via the
    // deliberate battleground action press; never by walk-over.
    let taken = false;
    for (const pid of bgAllPids(match)) {
      if (!match.pendingFlagPress.has(pid)) continue;
      const e = ctx.entities.get(pid);
      if (!e || e.dead) continue;
      const team = bgTeamOf(match, pid);
      if (team === flag.team) continue;
      if (dist2d(e.pos, flag.pos) > BG_PICKUP_RADIUS) continue;
      if (match.flags.some((f) => f.carrier === pid)) continue; // one flag per runner
      flag.state = 'carried';
      flag.carrier = pid;
      flag.carrySeconds = 0;
      bgBreakStealth(ctx, e); // and a revealing one: stealth never survives it
      // The flag is carried ON FOOT. A mounted runner is thrown out of the
      // saddle the moment they take it, and an in-flight summon is cancelled
      // with it (the casting-lifecycle pattern), so grabbing mid-summon cannot
      // land a player on a mount a second and a half later.
      ctx.forceDismount(e);
      e.mountCastRemaining = 0;
      e.mountCastKey = '';
      // The carry itself is now WORN, from the first tick and not only once the
      // fatigue delay bites: the runner can see they have it, their team can see
      // it on them, and right-clicking it drops the flag on purpose (the classic
      // voluntary drop, intercepted in bgCancelCarriedFlagAura). The duration
      // mirrors Carrier Fatigue's: longer than any match, so natural expiry can
      // never fire and clearCarrierAuras stays the only way off.
      ctx.applyAura(e, {
        id: CARRIED_FLAG_AURA_ID,
        name: 'Carrying the Flag',
        kind: 'flag_carried',
        value: 0,
        remaining: BG_MAX_DURATION,
        duration: BG_MAX_DURATION,
        sourceId: e.id,
        school: 'physical',
      });
      const byName = ctx.players.get(pid)?.name ?? '?';
      bgEmitAll(ctx, match, (mp) =>
        ctx.emit({
          type: 'bgFlag',
          action: 'taken',
          team: flag.team,
          byName,
          scoreCrimson: match.scores[0],
          scoreAzure: match.scores[1],
          pid: mp,
        }),
      );
      taken = true;
      break;
    }
    if (taken) continue;
    if (flag.state === 'dropped') {
      flag.dropTimer -= DT;
      if (flag.dropTimer <= 0) returnFlag(ctx, match, flag, '');
    }
  }
}

function tickCarriedFlag(ctx: SimContext, match: BgMatch, flag: BgFlagState): void {
  const carrier = flag.carrier !== null ? ctx.entities.get(flag.carrier) : null;
  if (!carrier || carrier.dead || ctx.bgMatches.get(flag.carrier ?? -1) !== match) {
    dropFlag(ctx, match, flag, carrier ?? null);
    return;
  }
  // The classic invisibility rule: flags and hiding never mix. A carrier who
  // turns invisible by ANY means (Stealth, Prowl, a vanish, Greater
  // Invisibility: everything rides the stealth aura kind) drops the flag on
  // the spot and stays hidden, flagless. The enemy team never chases an
  // entity their snapshots cannot see.
  if (carrier.stealthed) {
    dropFlag(ctx, match, flag, carrier);
    return;
  }
  flag.pos = { ...carrier.pos };
  syncFlagEntity(ctx, flag);
  // Carrier vulnerability (Focused Assault lineage; see the consts above).
  flag.carrySeconds += DT;
  const stacks =
    flag.carrySeconds >= BG_CARRIER_VULN_DELAY
      ? 1 + Math.floor((flag.carrySeconds - BG_CARRIER_VULN_DELAY) / BG_CARRIER_VULN_INTERVAL)
      : 0;
  if (stacks !== flag.vulnStacks) {
    flag.vulnStacks = stacks;
    const existing = carrier.auras.find((a) => a.id === CARRIER_VULN_AURA_ID);
    if (existing) {
      existing.value = stacks * BG_CARRIER_VULN_PER_STACK;
      existing.stacks = stacks;
    } else {
      ctx.applyAura(carrier, {
        id: CARRIER_VULN_AURA_ID,
        name: 'Carrier Fatigue',
        kind: 'vulnerability',
        value: stacks * BG_CARRIER_VULN_PER_STACK,
        stacks,
        remaining: BG_MAX_DURATION,
        duration: BG_MAX_DURATION,
        sourceId: carrier.id,
        school: 'shadow',
      });
    }
  }
  // Captured: carry the enemy flag home to your own stand. CLASSIC GATE: the
  // capture only resolves while your OWN flag sits at home. A carrier waiting
  // at the stand captures automatically the moment their flag is returned.
  const carrierTeam = bgTeamOf(match, flag.carrier ?? -1);
  const ownHome = match.flags[carrierTeam].home;
  if (
    dist2d(carrier.pos, ownHome) <= BG_CAPTURE_RADIUS &&
    match.flags[carrierTeam].state === 'home'
  ) {
    captureFlag(ctx, match, flag, carrierTeam);
  }
}

/**
 * The ONE seam every flag-leaving path crosses (capture, proximity return,
 * auto-return, death drop, stealth drop, desertion, match end, teardown): reset
 * the carry clock and take BOTH carrier-worn auras off the runner. Keeping the
 * carried-flag buff on the same seam as Carrier Fatigue is what makes "worn
 * exactly while carrying" true by construction rather than by nine call sites
 * remembering to do it.
 */
function clearCarrierAuras(ctx: SimContext, flag: BgFlagState): void {
  const carrier = flag.carrier !== null ? ctx.entities.get(flag.carrier) : null;
  flag.carrySeconds = 0;
  flag.vulnStacks = 0;
  if (!carrier) return;
  for (const auraId of [CARRIER_VULN_AURA_ID, CARRIED_FLAG_AURA_ID]) {
    const idx = carrier.auras.findIndex((a) => a.id === auraId);
    if (idx >= 0) {
      const [aura] = carrier.auras.splice(idx, 1);
      ctx.emit({ type: 'aura', targetId: carrier.id, name: aura.name, gained: false });
    }
  }
}

/**
 * Right-click-cancel of the carried-flag buff: the classic voluntary drop.
 *
 * Returns TRUE only on the arm that actually DROPS (live carrier in an active
 * match), which is what stops `Sim.cancelAura` falling through to the generic
 * splice there: a raw removal would take the buff off and leave the flag
 * carried, a flag state machine and a HUD that disagree.
 *
 * Every other arm returns FALSE on purpose, including for our own id. If there
 * is no flag to drop then the aura is stale (an inconsistency this module's
 * lifetime rules say cannot happen), and the right answer is to let the generic
 * splice clean it: swallowing the cancel there would convert a self-healing
 * inconsistency into a buff the player can never take off.
 */
export function bgCancelCarriedFlagAura(ctx: SimContext, e: Entity, auraId: string): boolean {
  if (auraId !== CARRIED_FLAG_AURA_ID) return false;
  const match = ctx.bgMatches.get(e.id);
  if (!match || match.state !== 'active') return false;
  const flag = match.flags.find((f) => f.carrier === e.id);
  if (!flag) return false;
  // The same authoritative drop the stealth path takes: the flag lands at the
  // runner's feet, arms its return timer, and calls the drop to all ten.
  dropFlag(ctx, match, flag, e);
  return true;
}

function syncFlagEntity(ctx: SimContext, flag: BgFlagState): void {
  const e = ctx.entities.get(flag.entityId);
  if (!e) return;
  e.pos = { ...flag.pos };
  e.prevPos = { ...flag.pos };
  ctx.rebucket(e);
}

function captureFlag(
  ctx: SimContext,
  match: BgMatch,
  flag: BgFlagState,
  scoringTeam: BgTeam,
): void {
  const carrierPid = flag.carrier;
  const carrierName = carrierPid !== null ? (ctx.players.get(carrierPid)?.name ?? '?') : '?';
  match.scores[scoringTeam]++;
  if (carrierPid !== null) {
    const meta = ctx.players.get(carrierPid);
    if (meta) {
      meta.bgCaptures++;
      ctx.markDeedsDirty(carrierPid);
    }
    const stat = match.stats.get(carrierPid);
    if (stat) stat.captures++;
  }
  returnFlag(ctx, match, flag, '', true); // the captured flag resets home
  bgEmitAll(ctx, match, (mp) =>
    ctx.emit({
      type: 'bgFlag',
      action: 'captured',
      team: flag.team,
      byName: carrierName,
      scoreCrimson: match.scores[0],
      scoreAzure: match.scores[1],
      pid: mp,
    }),
  );
  if (match.scores[scoringTeam] >= BG_CAPS_TO_WIN) enterBgEndHold(ctx, match, scoringTeam, 'caps');
}

// Returns a flag to its stand. `silent` skips the event (capture emits its own).
function returnFlag(
  ctx: SimContext,
  match: BgMatch,
  flag: BgFlagState,
  byName: string,
  silent = false,
): void {
  clearCarrierAuras(ctx, flag);
  flag.state = 'home';
  flag.carrier = null;
  flag.dropTimer = 0;
  flag.pos = { ...flag.home };
  syncFlagEntity(ctx, flag);
  if (!silent) {
    bgEmitAll(ctx, match, (mp) =>
      ctx.emit({
        type: 'bgFlag',
        action: 'returned',
        team: flag.team,
        byName,
        scoreCrimson: match.scores[0],
        scoreAzure: match.scores[1],
        pid: mp,
      }),
    );
  }
}

/** Strip every stealth-kind aura (Stealth, Prowl, vanishes, invisibility all
 *  share the kind), refresh the live cache, and pay out the Greater
 *  Invisibility aftereffect each stripped aura owes: a flag grab is a
 *  deliberate, revealing act, and it must end a vanish on exactly the terms
 *  Sim.breakStealth and natural aura expiry do, or grabbing the flag out of
 *  Greater Invisibility would be the one removal path that silently eats the
 *  damage reduction. The one deliberate difference from Sim.breakStealth is
 *  the sweep: it drops the FIRST stealth aura, this drops them all.
 *  Aftereffects are applied AFTER the sweep so an applyAura here can never
 *  shift an index the removal loop is still walking. */
function bgBreakStealth(ctx: SimContext, e: Entity): void {
  const stripped: Aura[] = [];
  for (let i = e.auras.length - 1; i >= 0; i--) {
    if (e.auras[i].kind !== 'stealth') continue;
    const [removed] = e.auras.splice(i, 1);
    stripped.push(removed);
    ctx.emit({ type: 'aura', targetId: e.id, name: removed.name, gained: false });
  }
  e.stealthed = false; // keep the cache live without waiting for updateAuras
  for (const removed of stripped) applyGreaterInvisibilityAftereffect(ctx, e, removed);
}

function dropFlag(ctx: SimContext, match: BgMatch, flag: BgFlagState, at: Entity | null): void {
  const carrierName = flag.carrier !== null ? (ctx.players.get(flag.carrier)?.name ?? '?') : '?';
  clearCarrierAuras(ctx, flag);
  flag.state = 'dropped';
  flag.carrier = null;
  flag.dropTimer = BG_FLAG_RETURN_TIME;
  if (at) flag.pos = { x: at.pos.x, y: at.pos.y, z: at.pos.z };
  syncFlagEntity(ctx, flag);
  bgEmitAll(ctx, match, (mp) =>
    ctx.emit({
      type: 'bgFlag',
      action: 'dropped',
      team: flag.team,
      byName: carrierName,
      scoreCrimson: match.scores[0],
      scoreAzure: match.scores[1],
      pid: mp,
    }),
  );
}

/**
 * Damage hook (combat/damage.ts): remember that `sourcePid` hit `victimPid`, so
 * the death that follows can pay the players who worked for it and not only the
 * one who landed the blow. Enemy player damage only; heals, self damage and
 * friendly fire never reach here.
 */
export function bgOnPlayerDamaged(ctx: SimContext, victim: Entity, source: Entity): void {
  const match = ctx.bgMatches.get(victim.id);
  if (!match || match.state !== 'active') return;
  // A pet's work is its owner's, the same credit rule the killing blow uses.
  const attackerId = source.kind === 'player' ? source.id : (source.ownerId ?? -1);
  if (attackerId < 0 || attackerId === victim.id) return;
  if (ctx.bgMatches.get(attackerId) !== match) return;
  if (bgTeamOf(match, attackerId) === bgTeamOf(match, victim.id)) return;
  let roster = match.recentDamage.get(victim.id);
  if (!roster) {
    roster = new Map();
    match.recentDamage.set(victim.id, roster);
  }
  // The match's own elapsed clock, which is tick math (timer += DT), never a
  // wall clock: two hosts replaying the same match assist identically.
  roster.set(attackerId, match.timer);
  // Prune on write: anyone whose last hit fell out of the window stops being an
  // assist candidate, and the row can never outgrow the ten live fighters.
  for (const [pid, at] of roster) {
    if (match.timer - at > BG_ASSIST_WINDOW) roster.delete(pid);
  }
}

/**
 * Heal hook (combat/heal.ts): remember that `source` healed `target`, so a kill
 * their teammate lands can pay the healer who kept them up. Without this a
 * dedicated healer could carry a fight and earn nothing from it, which is
 * exactly the class the honor drip should not punish.
 */
export function bgOnPlayerHealed(ctx: SimContext, target: Entity, source: Entity): void {
  const match = ctx.bgMatches.get(target.id);
  if (!match || match.state !== 'active') return;
  const healerId = source.kind === 'player' ? source.id : (source.ownerId ?? -1);
  if (healerId < 0 || healerId === target.id) return; // self-healing is not support
  if (ctx.bgMatches.get(healerId) !== match) return;
  if (bgTeamOf(match, healerId) !== bgTeamOf(match, target.id)) return; // allies only
  let roster = match.recentSupport.get(target.id);
  if (!roster) {
    roster = new Map();
    match.recentSupport.set(target.id, roster);
  }
  roster.set(healerId, match.timer);
  for (const [pid, at] of roster) {
    if (match.timer - at > BG_ASSIST_WINDOW) roster.delete(pid);
  }
}

/** Death hook (combat/damage.ts): carrier death drops the flag in place, the
 *  tallies move, and every match member gets the kill-feed event. The corpse
 *  then waits for the player's own release (spirit.ts owns the rite). */
export function bgOnPlayerDeath(ctx: SimContext, e: Entity, killer: Entity | null): void {
  const match = ctx.bgMatches.get(e.id);
  if (!match || match.state !== 'active') return;
  for (const flag of match.flags) {
    if (flag.carrier === e.id) dropFlag(ctx, match, flag, e);
  }
  const victimStats = match.stats.get(e.id);
  if (victimStats) victimStats.deaths++;
  // Credit the kill to the enemy player behind the blow (a controlled pet
  // credits its owner); same-team and out-of-match sources never count.
  const creditEntity =
    killer?.kind === 'player'
      ? killer
      : killer?.ownerId != null
        ? ctx.entities.get(killer.ownerId)
        : null;
  const credited =
    creditEntity &&
    ctx.bgMatches.get(creditEntity.id) === match &&
    bgTeamOf(match, creditEntity.id) !== bgTeamOf(match, e.id)
      ? creditEntity
      : null;
  if (credited) {
    const killerStats = match.stats.get(credited.id);
    if (killerStats) killerStats.kills++;
  }
  // Read and cleared together, so one death can only ever pay one round.
  const helpers = match.recentDamage.get(e.id);
  match.recentDamage.delete(e.id);
  match.recentSupport.delete(e.id);
  // The honor drip: the blow pays. Rated matches only, a dev-forced match must
  // never move real currency.
  if (match.rated && credited) {
    const killerMeta = ctx.players.get(credited.id);
    if (killerMeta) awardBattlegroundKillHonor(ctx, killerMeta, e.id, match.killHonorPairs);
  }
  // Everyone who counts as having helped: the fighters who damaged the
  // victim, plus the healers who kept THOSE fighters standing while they did
  // it. Collected into one set first, so a player who both healed and hit is
  // still credited exactly once.
  const assisted = new Set<number>();
  const fresh = (at: number) => match.timer - at <= BG_ASSIST_WINDOW;
  if (helpers) {
    for (const [pid, at] of helpers) {
      if (!fresh(at)) continue;
      assisted.add(pid);
      // The healers who supported this damager inside the window.
      const support = match.recentSupport.get(pid);
      if (!support) continue;
      for (const [healerPid, healedAt] of support) {
        if (fresh(healedAt)) assisted.add(healerPid);
      }
    }
  }
  for (const pid of assisted) {
    if (pid === credited?.id) continue; // the blow already paid
    if (pid === e.id) continue; // never the victim
    if (ctx.bgMatches.get(pid) !== match) continue; // deserted mid-fight
    // The scoreboard TALLY is not currency: kills, deaths and captures all
    // count in an unrated dev match, so the assists column must not be the one
    // blank row there. Only the HONOR below stays rated-only.
    const stats = match.stats.get(pid);
    if (stats) stats.assists++;
    if (!match.rated) continue;
    const helperMeta = ctx.players.get(pid);
    if (!helperMeta) continue;
    awardBattlegroundAssistHonor(ctx, helperMeta, e.id, match.assistHonorPairs);
  }
  // Kill feed: names + teams only (the client owns the localized line); an
  // uncredited death still feeds, with a null killer.
  const victimName = ctx.players.get(e.id)?.name ?? '';
  const killerName = credited ? (ctx.players.get(credited.id)?.name ?? '') : null;
  const killerTeam = credited ? bgTeamOf(match, credited.id) : null;
  const victimTeam = bgTeamOf(match, e.id);
  for (const pid of bgAllPids(match)) {
    ctx.emit({ type: 'bgKill', pid, killerName, victimName, killerTeam, victimTeam });
  }
}

/**
 * Is this player carrying an enemy flag right now? The one place the question
 * is answered: a runner may only hold one flag, and the grab itself throws the
 * runner out of the saddle. (It is no longer the mount GATE: mounts are banned
 * for the whole match, see `bgInMatch`.)
 */
export function bgCarryingFlag(ctx: SimContext, pid: number): boolean {
  const match = ctx.bgMatches.get(pid);
  return match ? match.flags.some((f) => f.carrier === pid) : false;
}

/**
 * Is this player seated in a live battleground right now? True for EVERY match
 * state: the form-up countdown, active play, and the frozen post-match hold,
 * because a fighter stands on the field through all three and only leaves the
 * roster when releaseBgFighters sends them home. The one gate every mount
 * summon path asks (src/sim/mounts.ts): Thornhollow Fields is fought on foot,
 * not just carried on foot.
 */
export function bgInMatch(ctx: SimContext, pid: number): boolean {
  return ctx.bgMatches.has(pid);
}

/** Disconnect/leave/jail mid-match: the deserter takes the rating loss and a
 *  recorded L on the spot (a rated ladder must never reward pulling the plug
 *  while losing), drops any carried flag, and leaves the roster (the team
 *  fights on a player down); a fully vacated side forfeits. */
export function bgResolveDesertion(ctx: SimContext, pid: number): void {
  const match = ctx.bgMatches.get(pid);
  if (!match) return;
  for (const flag of match.flags) {
    if (flag.carrier === pid) dropFlag(ctx, match, flag, ctx.entities.get(pid) ?? null);
  }
  const team = bgTeamOf(match, pid);
  const deserter = ctx.players.get(pid);
  // A backfilled fighter who leaves owes nothing either: they were never on the
  // ladder for this match, so charging a desertion loss here would be the one
  // way an unrated seat could still cost rating.
  if (deserter && match.rated && !match.resultRecorded && !match.backfilled.has(pid)) {
    const other = team === 0 ? 1 : 0;
    // The loss delta at score 0 from the deserter's side; no honor (forfeit rule).
    const delta = eloDelta(match.ratingAvg[team], match.ratingAvg[other], 0);
    deserter.bgRating = Math.max(BG_MIN_RATING, deserter.bgRating + delta);
    deserter.bgLosses++;
    ctx.markDeedsDirty(pid);
  }
  // Restore the leaver's body the way endBgMatch would: revive, clear any
  // ghost/corpse state, and send them home to where they queued from. A
  // deserter must never be left dead (or a ghost) stranded inside the band,
  // where the bg rez refusals no longer apply once the match entry is gone.
  const leaver = ctx.entities.get(pid);
  if (leaver) {
    ctx.readyArenaFighter(leaver, { clearPrep: true });
    leaver.dead = false;
    leaver.ghost = false;
    leaver.corpsePos = null;
    leaver.corpseInstanceId = null;
    const ret = match.returns.get(pid);
    if (ret) {
      leaver.pos = ctx.groundPos(ret.x, ret.z);
      leaver.prevPos = { ...leaver.pos };
      leaver.facing = ret.facing;
    }
    ctx.rebucket(leaver);
  }
  match.teams[team] = match.teams[team].filter((p) => p !== pid);
  match.returns.delete(pid);
  match.preMatchPools.delete(pid);
  match.stats.delete(pid);
  match.pendingFlagPress.delete(pid);
  ctx.bgMatches.delete(pid);
  // A deserter auto-added to the team party leaves it too; a premade member
  // keeps their own group (they deserted the match, not their friends).
  unwindBgAutoPartyFor(ctx, match.autoPartyPids, pid);
  // A fully vacated side forfeits, but ONLY while the match is still being
  // played. During the 'ended' hold the result is already recorded and the
  // frozen scoreboard belongs to everyone still reading it: forfeiting there
  // would end that hold early and yank the screen away from them (the result
  // itself is safe either way, resolveBgResult no-ops on resultRecorded).
  if (match.state !== 'ended' && (match.teams[0].length === 0 || match.teams[1].length === 0)) {
    const winner: BgTeam | null =
      match.teams[0].length === 0 && match.teams[1].length === 0
        ? null
        : match.teams[0].length === 0
          ? 1
          : 0;
    endBgMatch(ctx, match, winner, 'forfeit');
  }
}

/** Dev/test only: resolve the caller's live match NOW on the current score
 *  (ties draw) through the normal end-hold flow, so the frozen result screen
 *  and the release are exercised exactly like a played-out finish. Returns
 *  false when the caller is not in an unresolved match. */
export function devEndBg(ctx: SimContext, pid: number): boolean {
  const match = ctx.bgMatches.get(pid);
  if (!match || match.resultRecorded) return false;
  const w: BgTeam | null =
    match.scores[0] === match.scores[1] ? null : match.scores[0] > match.scores[1] ? 0 : 1;
  // Stamp BEFORE resolving: the match itself may be perfectly rated, but its
  // clock and its ending are a dev's, not a played-out result, so it must stay
  // out of the operator record (resolveBgResult reads this flag).
  match.devEnded = true;
  enterBgEndHold(ctx, match, w, 'timeout');
  return true;
}

// The played-out ending: resolve the result on the spot, then hold everyone
// on a frozen result screen (state 'ended', combat off) for BG_END_HOLD
// before releaseBgFighters sends them home. Flags come home silently so no
// carry outlives the battle.
function enterBgEndHold(
  ctx: SimContext,
  match: BgMatch,
  winnerTeam: BgTeam | null,
  reason: 'caps' | 'timeout',
): void {
  if (match.resultRecorded) return;
  resolveBgResult(ctx, match, winnerTeam, reason);
  match.state = 'ended';
  match.timer = BG_END_HOLD;
  for (const flag of match.flags) returnFlag(ctx, match, flag, '', true);
}

// winnerTeam null = draw: Elo moves by the draw math (score 0.5) and no W/L
// is recorded. Honor pays on played-out results only, never on forfeit.
// Immediate variant (forfeits, teardown paths, tests): resolve AND release in
// one call; the played-out tick path goes through enterBgEndHold instead.
export function endBgMatch(
  ctx: SimContext,
  match: BgMatch,
  winnerTeam: BgTeam | null,
  reason: 'caps' | 'timeout' | 'forfeit',
): void {
  resolveBgResult(ctx, match, winnerTeam, reason);
  releaseBgFighters(ctx, match);
}

/** The RESULT half: ratings, W/L, honor, deeds, and the bgEnd events. Runs
 *  exactly once per match (resultRecorded); never touches bodies or slots. */
function resolveBgResult(
  ctx: SimContext,
  match: BgMatch,
  winnerTeam: BgTeam | null,
  reason: 'caps' | 'timeout' | 'forfeit',
): void {
  if (match.resultRecorded) return;
  match.resultRecorded = true;
  match.winner = winnerTeam;
  // The operator-facing record, RATED matches only: a /dev force-start is
  // deliberately asymmetric and would poison the cap-tuning averages. Written
  // here rather than off the `bgEnd` events because those are per-player and a
  // host counting them would count every match ten times. `timer` is elapsed
  // ACTIVE seconds; during form-up it is still the countdown, so that resolves
  // to a duration of zero.
  if (match.rated && !match.devEnded) {
    recordBgOutcome(ctx.bgOutcomes, {
      matchId: match.id,
      durationSec: match.state === 'countdown' ? 0 : Math.max(0, Math.round(match.timer)),
      scoreCrimson: match.scores[0],
      scoreAzure: match.scores[1],
      ended: reason === 'timeout' ? 'timer' : reason,
      grouped: match.grouped,
    });
  }
  // Team Elo over team-average ratings, zero-sum by construction: one delta is
  // computed from the winner's perspective and applied with opposite signs
  // (the rating floor is the only, deliberate, exception).
  const score0 = winnerTeam === null ? 0.5 : winnerTeam === 0 ? 1 : 0;
  const delta0 = match.rated ? eloDelta(match.ratingAvg[0], match.ratingAvg[1], score0) : 0;
  for (const team of [0, 1] as BgTeam[]) {
    const delta = team === 0 ? delta0 : -delta0;
    const won = winnerTeam === team;
    const opponentKey = match.honorTeamKeys[team === 0 ? 1 : 0];
    for (const pid of match.teams[team]) {
      const meta = ctx.players.get(pid);
      if (!meta) continue;
      const before = meta.bgRating;
      // A backfilled fighter is scored on everything EXCEPT the ladder: honor,
      // deeds, and the bgEnd scoreboard below all still pay, but the rating and
      // the W/L/D stay where they were (see BgMatch.backfilled).
      const laddered = !match.backfilled.has(pid);
      if (laddered) meta.bgRating = Math.max(BG_MIN_RATING, before + delta);
      if (laddered && match.rated) {
        // A drawn battleground moved the ladder (eloDelta at score 0.5) but was
        // recorded nowhere, so the match vanished from the player's record. It
        // is now the third figure of W-L-D.
        if (winnerTeam === null) meta.bgDraws++;
        else if (won) meta.bgWins++;
        else meta.bgLosses++;
      }
      let firstWinBonus = 0;
      if (match.rated && reason !== 'forfeit') {
        firstWinBonus = awardBattlegroundHonor(
          ctx,
          meta,
          opponentKey,
          winnerTeam === null ? 'draw' : won ? 'win' : 'loss',
        ).firstWinBonus;
      }
      ctx.markDeedsDirty(pid);
      ctx.emit({
        type: 'bgEnd',
        pid,
        draw: winnerTeam === null,
        won,
        scoreCrimson: match.scores[0],
        scoreAzure: match.scores[1],
        ratingBefore: before,
        ratingAfter: meta.bgRating,
        // The internal reason token says 'timeout'; the WIRE vocabulary is
        // 'timer', which is what the finish surface renders against. Kept as one
        // mapping here rather than renaming the internal token, so the existing
        // endBgMatch signature (and every caller of it) is untouched.
        ended: reason === 'timeout' ? 'timer' : reason,
        firstWinBonus,
      });
    }
  }
}

/** The RELEASE half: field teardown and everyone home. Runs exactly once
 *  (fightersReleased), at the end of the hold or immediately on a forfeit. */
function releaseBgFighters(ctx: SimContext, match: BgMatch): void {
  if (match.fightersReleased) return;
  match.fightersReleased = true;
  for (const pid of bgAllPids(match)) ctx.bgMatches.delete(pid);
  ctx.bgBusySlots.delete(match.slot);
  // Unwind the match-formed party links FIRST, so the disband/leave notices
  // land before the fighters are teleported home (premades stay intact).
  unwindBgTeamParties(ctx, match.autoPartyPids);
  for (const flag of match.flags) {
    clearCarrierAuras(ctx, flag);
    if (flag.entityId >= 0 && ctx.entities.has(flag.entityId)) ctx.dropEntity(flag.entityId);
  }
  for (const rune of match.runes) {
    if (rune.entityId >= 0 && ctx.entities.has(rune.entityId)) ctx.dropEntity(rune.entityId);
  }
  for (const team of [0, 1] as BgTeam[]) {
    for (const pid of match.teams[team]) {
      const e = ctx.entities.get(pid);
      // Send the fighter home to where they queued from. The match is a
      // parenthesis, not a rest stop: HP, resource, cooldowns and CC DR are
      // handed back exactly as carried in (the arena issue #1600 rule).
      if (!e) continue;
      ctx.readyArenaFighter(e, { clearPrep: true });
      const pools = match.preMatchPools.get(pid);
      if (pools) {
        e.cooldowns = new Map(pools.cooldowns);
        e.abilityCharges =
          Object.keys(pools.abilityCharges).length > 0
            ? clonePools(pools.abilityCharges)
            : undefined;
        e.ccDr = new Map([...pools.ccDr].map(([k, v]) => [k, { ...v }]));
        e.hp = Math.max(1, Math.min(pools.hp, e.maxHp));
        e.resource = Math.max(0, Math.min(pools.resource, e.maxResource));
      }
      const ret = match.returns.get(pid);
      if (ret) {
        e.pos = ctx.groundPos(ret.x, ret.z);
        e.prevPos = { ...e.pos };
        e.facing = ret.facing;
      }
      e.dead = false;
      // A fighter who was a released spirit when the match ended must not
      // carry the ghost state home (ghost implies dead everywhere else, and
      // moveSpeedMult/serialize both read it).
      e.ghost = false;
      e.corpsePos = null;
      e.corpseInstanceId = null;
      ctx.rebucket(e);
      ctx.emit({ type: 'respawn', pid });
    }
  }
}

function clonePools(src: ArenaReturnPools['abilityCharges']): ArenaReturnPools['abilityCharges'] {
  const out: ArenaReturnPools['abilityCharges'] = {};
  for (const [id, state] of Object.entries(src)) out[id] = { ...state };
  return out;
}

/** Live standings of the rated champions currently online, best first. The
 *  battleground twin of `Sim.arenaLadder` (src/sim/sim.ts), down to the sort
 *  keys and the row cap, because it is the same readout for the other ranked
 *  mode. Draws no rng and reads no clock.
 *
 *  VIEWER-IDENTICAL, so it is deliberately NOT built inside `bgInfoFor`: the
 *  server passes one instance built once per broadcast pass through its
 *  realm-readout memo (server/game.ts `bgLadderReadout`), the same build-once
 *  seam the Vale Cup and dungeon-finder shared fragments ride. Offline the Sim
 *  builds it per read, which is one row. */
export function bgLadder(ctx: SimContext): import('../../world_api').BgLadderEntry[] {
  const rows: import('../../world_api').BgLadderEntry[] = [];
  for (const meta of ctx.players.values()) {
    if (!ctx.entities.get(meta.entityId)) continue;
    rows.push({
      pid: meta.entityId,
      name: meta.name,
      cls: meta.cls,
      rating: meta.bgRating,
      wins: meta.bgWins,
      losses: meta.bgLosses,
      draws: meta.bgDraws,
    });
  }
  rows.sort((x, y) => y.rating - x.rating || y.wins - x.wins);
  return rows.slice(0, BG_LADDER_SIZE);
}

// The per-viewer wire view. The viewer-identical match core is memoized per
// tick on the match (build-once; the per-viewer remainder is three scalars),
// and the equally viewer-identical online ladder is passed IN by the caller
// that already built it once for this broadcast pass. A caller with no shared
// instance (offline, tests, the RL host) gets one built here.
export function bgInfoFor(
  ctx: SimContext,
  pid: number,
  ladder?: import('../../world_api').BgLadderEntry[],
): import('../../world_api').BgInfo | null {
  const meta = ctx.players.get(pid);
  if (!meta) return null;
  const match = ctx.bgMatches.get(pid);
  let matchInfo: import('../../world_api').BgMatchInfo | null = null;
  if (match) {
    const shared = sharedMatchView(ctx, match);
    const myTeam = bgTeamOf(match, pid);
    const e = ctx.entities.get(pid);
    matchInfo = {
      ...shared,
      myTeam,
      // The wave countdown is a GHOST's readout: a corpse shows nothing (the
      // release press is the player's own move, on their own time).
      respawnIn: e?.dead && e?.ghost ? Math.ceil(match.waveIn[myTeam]) : 0,
    };
  }
  const group = bgGroupContaining(ctx, pid);
  const proposal = bgProposalFor(ctx, pid);
  return {
    rating: meta.bgRating,
    wins: meta.bgWins,
    losses: meta.bgLosses,
    draws: meta.bgDraws,
    captures: meta.bgCaptures,
    queued: group !== null,
    queueSize: bgQueueSize(ctx),
    queuedParty: group?.pids.length ?? 1,
    // The live queue-pop offer. Counts only, never names: the ten have not been
    // introduced yet, and a decline must not leak who was on the other side.
    proposal: proposal
      ? {
          id: proposal.id,
          kind: proposal.backfill ? ('backfill' as const) : ('match' as const),
          size: proposal.teams[0].length + proposal.teams[1].length,
          accepted: proposal.accepted.size,
          myResponse: proposal.accepted.has(pid) ? ('accepted' as const) : ('pending' as const),
          remaining: bgProposalRemaining(ctx, proposal),
        }
      : null,
    // Whole seconds until this character may queue again after failing to
    // answer an offer (0 = clear).
    requeueIn: Math.max(0, Math.ceil(bgRequeueLockedUntil(ctx, pid) - ctx.time)),
    // The first-win-of-the-day bonus is still on the table for this character.
    // A READ, never the rollover: `bgFirstWinBonusAvailable` reports a stored
    // date that is not today as re-armed without writing anything, because a
    // per-viewer wire builder must not mutate the daily window it reports on.
    firstWinBonusReady: bgFirstWinBonusAvailable(ctx.resetDay, meta),
    match: matchInfo,
    ladder: ladder ?? bgLadder(ctx),
  };
}

function sharedMatchView(ctx: SimContext, match: BgMatch): import('../../world_api').BgMatchInfo {
  if (match.viewTick === ctx.tickCount && match.viewShared) return match.viewShared;
  const flags = match.flags.map((f) => ({
    state: f.state,
    carrierPid: f.carrier,
    carrierName: f.carrier !== null ? (ctx.players.get(f.carrier)?.name ?? null) : null,
    carrierTeam: f.carrier !== null ? bgTeamOf(match, f.carrier) : null,
  })) as [import('../../world_api').BgFlagInfo, import('../../world_api').BgFlagInfo];
  const players: import('../../world_api').BgPlayerInfo[] = [];
  for (const team of [0, 1] as BgTeam[]) {
    for (const mp of match.teams[team]) {
      const e = ctx.entities.get(mp);
      const m = ctx.players.get(mp);
      if (!e || !m) continue;
      const stat = match.stats.get(mp);
      players.push({
        pid: mp,
        name: m.name,
        cls: m.cls,
        team,
        carrying: match.flags.some((f) => f.carrier === mp),
        dead: e.dead,
        kills: stat?.kills ?? 0,
        deaths: stat?.deaths ?? 0,
        captures: stat?.captures ?? 0,
        assists: stat?.assists ?? 0,
      });
    }
  }
  const shared: import('../../world_api').BgMatchInfo = {
    state: match.state,
    myTeam: 0, // per-viewer; overwritten in bgInfoFor
    capsToWin: BG_CAPS_TO_WIN,
    scores: [match.scores[0], match.scores[1]],
    flags,
    players,
    countdown: match.state === 'active' ? 0 : Math.max(0, Math.ceil(match.timer)),
    timeLeft:
      match.state === 'active'
        ? Math.max(0, Math.ceil(BG_MAX_DURATION - match.timer))
        : match.state === 'ended'
          ? 0
          : BG_MAX_DURATION,
    waveIn: [Math.ceil(match.waveIn[0]), Math.ceil(match.waveIn[1])],
    respawnIn: 0, // per-viewer; overwritten in bgInfoFor
    winner: match.state === 'ended' ? match.winner : null,
  };
  match.viewTick = ctx.tickCount;
  match.viewShared = shared;
  return shared;
}

// Dev/test only: force-start a battleground from whoever is queued, split into
// two teams even if there aren't a full ten. Server-gated behind
// ALLOW_DEV_COMMANDS so it never runs in production.
export function devStartBg(ctx: SimContext): void {
  const pids = ctx.bgQueue
    .flatMap((g) => g.pids)
    .filter((p) => ctx.entities.get(p) && !ctx.bgMatches.has(p));
  if (pids.length < 2) return;
  const take = pids.slice(0, BG_TEAM_SIZE * 2);
  const half = Math.ceil(take.length / 2);
  const teamA = take.slice(0, half);
  const teamB = take.slice(half);
  ctx.bgQueue = ctx.bgQueue
    .map((g) => ({ ...g, pids: g.pids.filter((p) => !take.includes(p)) }))
    .filter((g) => g.pids.length > 0);
  startBgMatch(ctx, teamA, teamB, { rated: false });
}
