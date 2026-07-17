// The Card Duel minigame: a class-agnostic 1v1 push-your-luck card game,
// hosted by the Card Master NPC (src/sim/content/card_master.ts). Deliberately
// NOT built on top of src/sim/social/duel.ts's HP-based DuelState: that system
// is combat-coupled (forfeit-by-death, HP dueling range, ccDr clearing) and
// growing it for a non-combat minigame would be the wrong seam. This module
// owns its own live match state on SimContext, following the same "own module
// behind the seam" shape as arena.ts / duel.ts.
//
// Determinism: every card draw goes through ctx.rng (never Math.random).
// Server-authoritative: rounds resolve here once both sides have played, never
// client-side.

import { cardMasterInRange } from '../instances/card_master';
import {
  type CardHandState,
  createCardHand,
  drawOne,
  playCard as playCardFromHand,
} from '../minigames/card_hand';
import type { SimContext } from '../sim_context';
import {
  type CardDuelQueue,
  isQueuedForCardDuel,
  joinCardDuelQueue,
  leaveCardDuelQueue,
  tryPairCardDuel,
} from './card_duel_queue';

// Best-of-3 rounds; first to 2 round wins takes the match.
export const CARD_DUEL_ROUNDS_TO_WIN = 2;

// A player who never plays a card (opponent gone idle / linkdead-but-not-yet-
// dropped) forfeits the current round, and the match, once this much sim time
// has passed since the round started. Keeps a live match from deadlocking the
// other side forever (see leaveCardMinigameEntirely / forfeitCardDuelMatch for
// the player-issued escape).
export const CARD_DUEL_ROUND_DEADLINE_S = 90;

export interface CardDuelMatch {
  a: number;
  b: number;
  handA: CardHandState;
  handB: CardHandState;
  playedA: number | null;
  playedB: number | null;
  roundsA: number;
  roundsB: number;
  roundDeadline: number; // ctx.time this round's AFK deadline expires
}

// The IWorldCardMinigame read-surface shape (src/world_api/card_minigame.ts
// imports this rather than sim depending on world_api, per the IWorld seam
// direction: world_api reads sim types, never the reverse).
export interface CardMinigameInfo {
  queued: boolean;
  // false when there is no other player in the world to ever pair against
  // (the offline Sim's single-player case): the Join affordance should be
  // hidden/disabled rather than let the player queue forever with no
  // feedback (finding: offline queue never resolves).
  available: boolean;
  match: {
    opponent: { pid: number; name: string };
    hand: number[];
    deckCount: number;
    discardCount: number;
    myRounds: number;
    opponentRounds: number;
    waitingOnOpponent: boolean;
  } | null;
}

export function inCardDuel(ctx: SimContext, pid: number): boolean {
  return ctx.cardDuels.has(pid);
}

export function cardDuelMatchFor(ctx: SimContext, pid: number): CardDuelMatch | null {
  return ctx.cardDuels.get(pid) ?? null;
}

// At least one other QUEUEABLE HUMAN must be present to ever pair off the
// queue. Fiesta and Vale Cup bots share the offline Sim's players map
// (fiesta_bots.ts / vale_cup_bots.ts both reach Sim.addPlayer), but they
// never call joinCardDuelQueue, so counting them here would let the gate
// read "available" while a bot match is live offline, and the human queues
// into a FIFO that can never pair (finding: bots defeat the offline gate).
export function cardMinigameAvailable(ctx: SimContext, pid?: number): boolean {
  for (const [otherPid, meta] of ctx.players) {
    if (otherPid === pid) continue;
    if (meta.isFiestaBot) continue;
    if (ctx.vcup.botPids.includes(otherPid)) continue;
    return true;
  }
  return false;
}

export function joinCardMinigameQueue(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  if (r.e.dead) {
    ctx.error(r.meta.entityId, "You can't do that while dead.");
    return;
  }
  if (!cardMasterInRange(ctx, r.e)) {
    ctx.error(r.meta.entityId, 'You must be at the Card Master to queue for a Card Duel.');
    return;
  }
  if (!cardMinigameAvailable(ctx, r.meta.entityId)) {
    ctx.error(r.meta.entityId, 'Card Duel requires another player online.');
    return;
  }
  const result = joinCardDuelQueue(
    ctx.cardDuelQueue,
    r.meta.entityId,
    inCardDuel(ctx, r.meta.entityId),
  );
  if (!result.ok) {
    // Hoisted to two literal ctx.error calls (rather than one ternary-fed
    // call) so the localization_fixes S3 guard's literal-argument scraper
    // actually sees both strings.
    if (result.reason === 'already_in_duel') {
      ctx.error(r.meta.entityId, 'You are already in a Card Duel.');
    } else {
      ctx.error(r.meta.entityId, 'You are already queued for a Card Duel.');
    }
    return;
  }
  ctx.emit({
    type: 'log',
    text: 'You queue for a Card Duel.',
    color: '#fa6',
    pid: r.meta.entityId,
  });
}

export function leaveCardMinigameQueue(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  if (leaveCardDuelQueue(ctx.cardDuelQueue, r.meta.entityId)) {
    ctx.emit({
      type: 'log',
      text: 'You leave the Card Duel queue.',
      color: '#fa6',
      pid: r.meta.entityId,
    });
  }
}

export function isQueuedForCardMinigame(ctx: SimContext, pid: number): boolean {
  return isQueuedForCardDuel(ctx.cardDuelQueue, pid);
}

function startCardDuelMatch(ctx: SimContext, a: number, b: number): void {
  const match: CardDuelMatch = {
    a,
    b,
    handA: createCardHand(ctx.rng),
    handB: createCardHand(ctx.rng),
    playedA: null,
    playedB: null,
    roundsA: 0,
    roundsB: 0,
    roundDeadline: ctx.time + CARD_DUEL_ROUND_DEADLINE_S,
  };
  ctx.cardDuels.set(a, match);
  ctx.cardDuels.set(b, match);
  const aMeta = ctx.players.get(a);
  const bMeta = ctx.players.get(b);
  for (const [pid, opponent] of [
    [a, bMeta],
    [b, aMeta],
  ] as const) {
    // A distinct, fully-literal message for the no-opponent-meta arm (rather
    // than interpolating an "?? 'an opponent'" fallback string): root CLAUDE.md
    // bans that pattern in player-visible text, and the S3 i18n guard only
    // scrapes the outer literal so it is blind to a fallback hidden inside a
    // template. The gap is narrow here (both sides were just confirmed live by
    // updateCardDuelQueue's pairing check moments earlier) but not provably
    // unreachable, so it stays handled rather than asserted away.
    ctx.emit({
      type: 'log',
      text: opponent ? `Your Card Duel against ${opponent.name} begins!` : 'Your Card Duel begins!',
      color: '#fa6',
      pid,
    });
  }
}

// Called every tick from Sim (like updateDuels/updateArena): pairs waiting
// players off the queue and starts a match for each pair.
export function updateCardDuelQueue(ctx: SimContext): void {
  // Sweep stale entries BEFORE pairing, so tryPairCardDuel's shift() never
  // pulls a disconnected or dead pid and silently ejects the still-connected
  // other side of a pair (finding: stale pairing ejects the survivor). Mirrors
  // joinCardMinigameQueue's join-time r.e.dead gate: a queued player who dies
  // before pairing (not just one who disconnects) is dropped too, matching
  // every sibling PvP system (duel.ts forfeits on death; arena.ts/vale_cup.ts
  // resolve desertion) rather than pairing a ghost off the queue.
  for (const pid of [...ctx.cardDuelQueue]) {
    const e = ctx.entities.get(pid);
    if (!ctx.players.has(pid) || !e || e.dead) leaveCardDuelQueue(ctx.cardDuelQueue, pid);
  }
  let pair = tryPairCardDuel(ctx.cardDuelQueue);
  while (pair) {
    const [a, b] = pair;
    // Defense in depth: re-check liveness AND death even though the presweep
    // above should already guarantee both.
    const ea = ctx.entities.get(a);
    const eb = ctx.entities.get(b);
    if (ctx.players.has(a) && ctx.players.has(b) && ea && !ea.dead && eb && !eb.dead) {
      startCardDuelMatch(ctx, a, b);
    }
    pair = tryPairCardDuel(ctx.cardDuelQueue);
  }
}

// Sweeps every live match for an expired per-round AFK deadline and forfeits
// the side that never played (or, if neither played, side A deterministically),
// so an idle opponent cannot deadlock the other side forever. Called every
// tick from Sim, under its own profiler lap marker (distinct from the queue
// pairing phase, since it walks every live match).
export function updateCardDuelDeadlines(ctx: SimContext): void {
  const seen = new Set<number>();
  for (const match of ctx.cardDuels.values()) {
    if (seen.has(match.a)) continue;
    seen.add(match.a);
    seen.add(match.b);
    if (ctx.time < match.roundDeadline) continue;
    const aPlayed = match.playedA !== null;
    const bPlayed = match.playedB !== null;
    if (!aPlayed && !bPlayed) {
      // Both sides idle: nobody earned a win, so void the match rather than
      // handing side A a free deed credit (finding: both-idle AFK sweep
      // handed out a win and the deed for a match where zero cards were
      // played; farmable by two accounts queueing and going AFK together).
      voidMatch(ctx, match);
      continue;
    }
    // Whichever side has not played this round forfeits.
    const forfeiterPid = aPlayed ? match.b : match.a;
    forfeitMatch(ctx, match, forfeiterPid);
  }
}

function handFor(match: CardDuelMatch, pid: number): CardHandState {
  return pid === match.a ? match.handA : match.handB;
}

export function playCardInDuel(ctx: SimContext, cardValue: number, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const match = ctx.cardDuels.get(r.meta.entityId);
  if (!match) {
    ctx.error(r.meta.entityId, 'You are not in a Card Duel.');
    return;
  }
  // Mirrors joinCardMinigameQueue's join-time gate: a player who dies mid-match
  // (Card Duel needs no proximity to play, so death is the only way the sim can
  // catch this) cannot keep playing as a ghost. The other side is not left
  // hanging: the existing per-round AFK deadline forfeits the dead side exactly
  // like any other unresponsive opponent, so no separate death-triggers-forfeit
  // path is needed here.
  if (r.e.dead) {
    ctx.error(r.meta.entityId, "You can't do that while dead.");
    return;
  }
  const isA = r.meta.entityId === match.a;
  if ((isA && match.playedA !== null) || (!isA && match.playedB !== null)) {
    ctx.error(r.meta.entityId, 'You already played a card this round.');
    return;
  }
  const played = playCardFromHand(handFor(match, r.meta.entityId), cardValue);
  if (played === null) {
    ctx.error(r.meta.entityId, "You don't hold that card.");
    return;
  }
  if (isA) match.playedA = played;
  else match.playedB = played;
  if (match.playedA !== null && match.playedB !== null) {
    resolveRound(ctx, match);
  }
}

function resolveRound(ctx: SimContext, match: CardDuelMatch): void {
  const a = match.playedA as number;
  const b = match.playedB as number;
  if (a > b) match.roundsA++;
  else if (b > a) match.roundsB++;
  // a === b: a push, neither side scores.
  match.playedA = null;
  match.playedB = null;
  drawOne(ctx.rng, match.handA);
  drawOne(ctx.rng, match.handB);
  match.roundDeadline = ctx.time + CARD_DUEL_ROUND_DEADLINE_S;
  for (const pid of [match.a, match.b]) {
    const mine = pid === match.a ? a : b;
    const theirs = pid === match.a ? b : a;
    ctx.emit({
      type: 'log',
      text: `Card Duel round: you played ${mine}, opponent played ${theirs}.`,
      color: '#fa6',
      pid,
    });
  }
  if (match.roundsA >= CARD_DUEL_ROUNDS_TO_WIN) {
    endCardDuelMatch(ctx, match, match.a);
  } else if (match.roundsB >= CARD_DUEL_ROUNDS_TO_WIN) {
    endCardDuelMatch(ctx, match, match.b);
  }
}

function endCardDuelMatch(ctx: SimContext, match: CardDuelMatch, winnerPid: number): void {
  ctx.cardDuels.delete(match.a);
  ctx.cardDuels.delete(match.b);
  const loserPid = winnerPid === match.a ? match.b : match.a;
  const winnerMeta = ctx.players.get(winnerPid);
  const loserMeta = ctx.players.get(loserPid);
  if (winnerMeta) ctx.bumpDeedStat(winnerMeta, 'cardDuelsWon', 1);
  // Distinct fully-literal messages for the no-opponent-meta arm (the real
  // edge case named by review: the opponent's meta is gone because they left
  // mid-match, e.g. removePlayer ran between their last card and this round
  // resolving) instead of an "?? 'your opponent'" fallback interpolated into
  // the template: see the matching comment in startCardDuelMatch above. Each
  // side gets its own emit call (rather than one shared ternary-of-ternaries)
  // so every branch stays a single literal-or-simple-ternary `text:` the S3
  // guard's emit scanner can actually see and verify.
  for (const pid of [match.a, match.b]) {
    if (pid === winnerPid) {
      ctx.emit({
        type: 'log',
        text: loserMeta
          ? `You win the Card Duel against ${loserMeta.name}!`
          : 'You win the Card Duel!',
        color: '#fa6',
        pid,
      });
    } else {
      ctx.emit({
        type: 'log',
        text: winnerMeta
          ? `You lose the Card Duel against ${winnerMeta.name}.`
          : 'You lose the Card Duel.',
        color: '#fa6',
        pid,
      });
    }
  }
}

// Shared forfeit resolution for both the player-issued forfeit action and the
// AFK-deadline sweep: the forfeiting side loses, the other side wins and is
// credited the deed progress, matching how PvP disconnects/desertion are
// treated elsewhere (arena/Vale Cup desertion). A forfeit used to credit
// nobody, letting a player one round from losing deny the opponent the deed
// by disconnecting; that is now fixed here.
//
// A forfeit before EITHER side has won a round credits nobody: this is the
// same farm hole voidMatch's own comment names (two accounts queueing and
// going AFK together for a free deed credit), just reached through the
// player-issuable card_forfeit command instead of the 90s AFK deadline, and
// strictly EASIER (no wait at all). Route that case through voidMatch instead
// of the win/lose messaging below, making the manual-forfeit and AFK-timeout
// paths consistent; a forfeit after at least one round has been won still
// credits the non-forfeiting side normally.
function forfeitMatch(ctx: SimContext, match: CardDuelMatch, forfeiterPid: number): void {
  if (match.roundsA + match.roundsB === 0) {
    voidMatch(ctx, match);
    return;
  }
  const winnerPid = forfeiterPid === match.a ? match.b : match.a;
  ctx.cardDuels.delete(match.a);
  ctx.cardDuels.delete(match.b);
  const winnerMeta = ctx.players.get(winnerPid);
  if (winnerMeta) ctx.bumpDeedStat(winnerMeta, 'cardDuelsWon', 1);
  if (ctx.players.has(forfeiterPid)) {
    ctx.emit({
      type: 'log',
      text: 'You forfeit the Card Duel.',
      color: '#fa6',
      pid: forfeiterPid,
    });
  }
  if (winnerMeta) {
    ctx.emit({
      type: 'log',
      text: 'Your opponent forfeited the Card Duel. You win!',
      color: '#fa6',
      pid: winnerPid,
    });
  }
}

// No side has earned a round win, so end the match with no winner and no deed
// credit. Two callers: both sides let the round's AFK deadline expire without
// playing a card, or forfeitMatch delegates here when the forfeit happens
// before either side has won a round (see forfeitMatch's comment).
function voidMatch(ctx: SimContext, match: CardDuelMatch): void {
  ctx.cardDuels.delete(match.a);
  ctx.cardDuels.delete(match.b);
  for (const pid of [match.a, match.b]) {
    ctx.emit({
      type: 'log',
      text: 'Your Card Duel is void: neither side played in time.',
      color: '#fa6',
      pid,
    });
  }
}

// Player-issuable forfeit: lets someone stuck in a live match against an idle
// opponent get out immediately, instead of waiting for the AFK deadline.
// Wired to the window's Leave/Forfeit action while in a live match (the queue
// leave path stays leaveCardMinigameQueue).
export function forfeitCardDuelMatch(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const match = ctx.cardDuels.get(r.meta.entityId);
  if (!match) {
    ctx.error(r.meta.entityId, 'You are not in a Card Duel.');
    return;
  }
  forfeitMatch(ctx, match, r.meta.entityId);
}

// Drops a player from the queue and/or forfeits their live match (leave-path /
// disconnect handling, mirroring duelFor's forfeit-on-death shape). Also
// called from Sim.removePlayer so the offline Sim and headless env never leak
// cardDuels/cardDuelQueue entries for a departed pid.
export function leaveCardMinigameEntirely(ctx: SimContext, pid: number): void {
  leaveCardDuelQueue(ctx.cardDuelQueue, pid);
  const match = ctx.cardDuels.get(pid);
  if (!match) return;
  forfeitMatch(ctx, match, pid);
}

// IWorldCardMinigame read surface: the local/queried player's queue/match
// snapshot. Lives here (not on the sim.ts coordinator) because it needs
// nothing from Sim's private state, matching the six thin delegates directly
// above cardMinigameInfoFor on sim.ts.
export function buildCardMinigameInfo(ctx: SimContext, pid: number): CardMinigameInfo {
  const match = cardDuelMatchFor(ctx, pid);
  if (!match) {
    return {
      queued: isQueuedForCardMinigame(ctx, pid),
      available: cardMinigameAvailable(ctx, pid),
      match: null,
    };
  }
  const isA = pid === match.a;
  const oppPid = isA ? match.b : match.a;
  const oppMeta = ctx.players.get(oppPid);
  const myHand = isA ? match.handA : match.handB;
  const played = isA ? match.playedA : match.playedB;
  return {
    queued: false,
    available: true,
    match: {
      opponent: { pid: oppPid, name: oppMeta?.name ?? '' },
      hand: myHand.hand.slice(),
      deckCount: myHand.deck.length,
      discardCount: myHand.discard.length,
      myRounds: isA ? match.roundsA : match.roundsB,
      opponentRounds: isA ? match.roundsB : match.roundsA,
      waitingOnOpponent: played !== null,
    },
  };
}

export type { CardDuelQueue };
