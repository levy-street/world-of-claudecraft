import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { CARD_MASTER_NPC_ID } from '../src/sim/content/card_master';
import { Rng } from '../src/sim/rng';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import {
  CARD_DUEL_ROUND_DEADLINE_S,
  CARD_DUEL_ROUNDS_TO_WIN,
  cardDuelMatchFor,
  forfeitCardDuelMatch,
  joinCardMinigameQueue,
  leaveCardMinigameEntirely,
  leaveCardMinigameQueue,
  playCardInDuel,
  updateCardDuelDeadlines,
  updateCardDuelQueue,
} from '../src/sim/social/card_duel';
import type { Entity } from '../src/sim/types';

function makeCtx(
  overrides: Partial<{ dead: Set<number>; extraPlayers: number[]; time: number }> = {},
) {
  const dead = overrides.dead ?? new Set<number>();
  const players = new Map<number, PlayerMeta>();
  const entities = new Map<number, Entity>();
  const bumpDeedStat = vi.fn();
  const error = vi.fn();
  const emit = vi.fn();
  const ctxState = { time: overrides.time ?? 0 };

  const pids = overrides.extraPlayers ? [1, 2, 3, ...overrides.extraPlayers] : [1, 2, 3];
  for (const pid of pids) {
    players.set(pid, { entityId: pid, name: `Player${pid}` } as unknown as PlayerMeta);
    entities.set(pid, { id: pid, pos: { x: 0, y: 0, z: 0 }, dead: dead.has(pid) } as Entity);
  }
  // The Card Master NPC, standing at the same spot so every test pid is in range.
  entities.set(1000, {
    id: 1000,
    kind: 'npc',
    templateId: CARD_MASTER_NPC_ID,
    pos: { x: 0, y: 0, z: 0 },
  } as unknown as Entity);

  const ctx = {
    rng: new Rng(7),
    players,
    entities,
    cardDuelQueue: [] as number[],
    cardDuels: new Map(),
    vcup: { botPids: [] as number[] },
    bumpDeedStat,
    error,
    emit,
    get time() {
      return ctxState.time;
    },
    set time(v: number) {
      ctxState.time = v;
    },
    resolve: (pid?: number) => {
      if (pid === undefined) return null;
      const meta = players.get(pid);
      const e = entities.get(pid);
      if (!meta || !e) return null;
      return { meta, e };
    },
  } as unknown as SimContext & { time: number };
  return { ctx, players, entities, bumpDeedStat, error, emit };
}

describe('card_duel', () => {
  it('joining requires standing at the Card Master and queues the player', () => {
    const { ctx, error } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    expect(error).not.toHaveBeenCalled();
    expect(ctx.cardDuelQueue).toEqual([1]);
  });

  it('refuses to queue a dead player', () => {
    const { ctx, error } = makeCtx({ dead: new Set([1]) });
    joinCardMinigameQueue(ctx, 1);
    expect(error).toHaveBeenCalled();
    expect(ctx.cardDuelQueue).toEqual([]);
  });

  it('refuses to queue when no other player is present (offline single-player case)', () => {
    const players = new Map<number, PlayerMeta>();
    const entities = new Map<number, Entity>();
    const error = vi.fn();
    players.set(1, { entityId: 1, name: 'Solo' } as unknown as PlayerMeta);
    entities.set(1, { id: 1, pos: { x: 0, y: 0, z: 0 }, dead: false } as Entity);
    entities.set(1000, {
      id: 1000,
      kind: 'npc',
      templateId: CARD_MASTER_NPC_ID,
      pos: { x: 0, y: 0, z: 0 },
    } as unknown as Entity);
    const ctx = {
      rng: new Rng(7),
      players,
      entities,
      cardDuelQueue: [] as number[],
      cardDuels: new Map(),
      vcup: { botPids: [] as number[] },
      bumpDeedStat: vi.fn(),
      error,
      emit: vi.fn(),
      time: 0,
      resolve: (pid?: number) => {
        if (pid === undefined) return null;
        const meta = players.get(pid);
        const e = entities.get(pid);
        if (!meta || !e) return null;
        return { meta, e };
      },
    } as unknown as SimContext;
    joinCardMinigameQueue(ctx, 1);
    expect(error).toHaveBeenCalledWith(1, 'Card Duel requires another player online.');
    expect(ctx.cardDuelQueue).toEqual([]);
  });

  it('pairs two queued players into a live match on the next update', () => {
    const { ctx } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    joinCardMinigameQueue(ctx, 2);
    updateCardDuelQueue(ctx);
    expect(ctx.cardDuelQueue.length).toBe(0);
    const match = cardDuelMatchFor(ctx, 1);
    expect(match).not.toBeNull();
    expect(cardDuelMatchFor(ctx, 2)).toBe(match);
  });

  it('a stale (disconnected) pairing does not eject the surviving queued player', () => {
    const { ctx, players } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    joinCardMinigameQueue(ctx, 2);
    // pid 1 disconnects between queueing and the next pairing sweep.
    players.delete(1);
    updateCardDuelQueue(ctx);
    // pid 1's stale entry is swept, but pid 2 is neither dropped nor
    // silently ejected: it stays queued for the next pairing.
    expect(ctx.cardDuelQueue).toEqual([2]);
    expect(cardDuelMatchFor(ctx, 2)).toBeNull();
  });

  it('a queued player who dies before pairing is swept off the queue, not paired as a ghost', () => {
    const { ctx, entities } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    joinCardMinigameQueue(ctx, 2);
    // pid 1 dies between queueing and the next pairing sweep (mirrors the
    // disconnect presweep above: joinCardMinigameQueue already blocks a dead
    // pid at JOIN time, but nothing previously caught a death after joining).
    (entities.get(1) as { dead: boolean }).dead = true;
    updateCardDuelQueue(ctx);
    expect(ctx.cardDuelQueue).toEqual([2]);
    expect(cardDuelMatchFor(ctx, 1)).toBeNull();
    expect(cardDuelMatchFor(ctx, 2)).toBeNull();
  });

  it('a player who dies mid-match cannot keep playing as a ghost', () => {
    const { ctx, entities, error } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    joinCardMinigameQueue(ctx, 2);
    updateCardDuelQueue(ctx);
    const match = cardDuelMatchFor(ctx, 1);
    if (!match) throw new Error('expected a live match');
    (entities.get(1) as { dead: boolean }).dead = true;
    const cardValue = match.handA.hand[0];
    playCardInDuel(ctx, cardValue, 1);
    expect(error).toHaveBeenCalledWith(1, "You can't do that while dead.");
    // The blocked attempt did not consume the card or record a play.
    expect(cardDuelMatchFor(ctx, 1)?.handA.hand).toContain(cardValue);
    expect(cardDuelMatchFor(ctx, 1)?.playedA).toBeNull();
  });

  it('resolves a full match to a winner and bumps cardDuelsWon exactly once', () => {
    const { ctx, bumpDeedStat, players } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    joinCardMinigameQueue(ctx, 2);
    updateCardDuelQueue(ctx);

    // Drive rounds until the match ends (best-of-3). Side A always plays its
    // highest card and side B its lowest, which reliably breaks pushes so the
    // match converges instead of tying forever.
    let guard = 0;
    while (cardDuelMatchFor(ctx, 1) !== null && guard < 500) {
      const match = cardDuelMatchFor(ctx, 1);
      if (!match) break;
      const highA = Math.max(...match.handA.hand);
      const lowB = Math.min(...match.handB.hand);
      playCardInDuel(ctx, highA, 1);
      playCardInDuel(ctx, lowB, 2);
      guard++;
    }
    expect(cardDuelMatchFor(ctx, 1)).toBeNull();
    expect(cardDuelMatchFor(ctx, 2)).toBeNull();
    expect(bumpDeedStat).toHaveBeenCalledTimes(1);
    // Side A always plays its highest card, side B its lowest, so A wins
    // every non-push round: assert the credited meta is actually A's, not
    // just that some meta was credited (a loser-credited bug would pass
    // without this).
    expect(bumpDeedStat.mock.calls[0][0]).toBe(players.get(1));
    expect(bumpDeedStat.mock.calls[0][1]).toBe('cardDuelsWon');
    expect(bumpDeedStat.mock.calls[0][2]).toBe(1);
  });

  it('a tie round (a push) scores neither side and does not end the match', () => {
    const { ctx, bumpDeedStat } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    joinCardMinigameQueue(ctx, 2);
    updateCardDuelQueue(ctx);
    const match = cardDuelMatchFor(ctx, 1);
    if (!match) throw new Error('expected a live match');
    // Force both hands to hold a shared value (5) regardless of the actual
    // deal, so the round resolves as a deterministic push (a === b) without
    // depending on the fixed rng's exact draw.
    if (!match.handA.hand.includes(5)) match.handA.hand[0] = 5;
    if (!match.handB.hand.includes(5)) match.handB.hand[0] = 5;
    playCardInDuel(ctx, 5, 1);
    playCardInDuel(ctx, 5, 2);
    const after = cardDuelMatchFor(ctx, 1);
    expect(after).not.toBeNull();
    expect(after?.roundsA).toBe(0);
    expect(after?.roundsB).toBe(0);
    expect(bumpDeedStat).not.toHaveBeenCalled();
  });

  it('rejects playing a card not in hand', () => {
    const { ctx, error } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    joinCardMinigameQueue(ctx, 2);
    updateCardDuelQueue(ctx);
    const match = cardDuelMatchFor(ctx, 1);
    if (!match) throw new Error('expected a live match');
    const notHeld = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((v) => !match.handA.hand.includes(v));
    playCardInDuel(ctx, notHeld as number, 1);
    expect(error).toHaveBeenCalledWith(1, "You don't hold that card.");
  });

  it('rejects playing a second card in the same round before the opponent has played', () => {
    const { ctx, error } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    joinCardMinigameQueue(ctx, 2);
    updateCardDuelQueue(ctx);
    const match = cardDuelMatchFor(ctx, 1);
    if (!match) throw new Error('expected a live match');
    const [first, second] = match.handA.hand;
    playCardInDuel(ctx, first, 1);
    playCardInDuel(ctx, second, 1);
    expect(error).toHaveBeenCalledWith(1, 'You already played a card this round.');
    // The second attempt did not consume the card: hand still holds it.
    expect(cardDuelMatchFor(ctx, 1)?.handA.hand).toContain(second);
  });

  it('rejects playing a card when not in any match', () => {
    const { ctx, error } = makeCtx();
    playCardInDuel(ctx, 5, 3);
    expect(error).toHaveBeenCalledWith(3, 'You are not in a Card Duel.');
  });

  it('leaving the queue removes the pid without touching a live match', () => {
    const { ctx } = makeCtx();
    joinCardMinigameQueue(ctx, 3);
    leaveCardMinigameQueue(ctx, 3);
    expect(ctx.cardDuelQueue).toEqual([]);
  });

  it('leaveCardMinigameEntirely forfeits a live match and credits the opponent a win', () => {
    const { ctx, emit, bumpDeedStat, players } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    joinCardMinigameQueue(ctx, 2);
    updateCardDuelQueue(ctx);
    const match = cardDuelMatchFor(ctx, 1);
    if (!match) throw new Error('expected a live match');
    // Play out one full round first so roundsA + roundsB > 0: a forfeit
    // before either side has won a round voids instead of crediting a win
    // (finding 3, the same anti-farm gate as the both-idle AFK case), so
    // exercising the CREDIT path here needs a round already on the board.
    match.handA.hand[0] = 9;
    match.handB.hand[0] = 1;
    playCardInDuel(ctx, 9, 1);
    playCardInDuel(ctx, 1, 2);
    expect(cardDuelMatchFor(ctx, 1)?.roundsA).toBe(1);
    leaveCardMinigameEntirely(ctx, 1);
    expect(cardDuelMatchFor(ctx, 1)).toBeNull();
    expect(cardDuelMatchFor(ctx, 2)).toBeNull();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Your opponent forfeited the Card Duel. You win!', pid: 2 }),
    );
    expect(bumpDeedStat).toHaveBeenCalledTimes(1);
    expect(bumpDeedStat.mock.calls[0][0]).toBe(players.get(2));
    expect(bumpDeedStat.mock.calls[0][1]).toBe('cardDuelsWon');
  });

  it('forfeitMatch voids a zero-round forfeit instead of crediting a win (anti-farm gate)', () => {
    const { ctx, emit, bumpDeedStat } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    joinCardMinigameQueue(ctx, 2);
    updateCardDuelQueue(ctx);
    expect(cardDuelMatchFor(ctx, 1)).not.toBeNull();
    // Instant forfeit the moment the match starts, before either side has
    // played a single card or won a round: two colluding accounts sending
    // card_forfeit immediately is strictly easier than the both-idle AFK farm
    // voidMatch was already built to close, so this must close the same way.
    forfeitCardDuelMatch(ctx, 1);
    expect(cardDuelMatchFor(ctx, 1)).toBeNull();
    expect(cardDuelMatchFor(ctx, 2)).toBeNull();
    expect(bumpDeedStat).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Your Card Duel is void: neither side played in time.',
        pid: 1,
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Your Card Duel is void: neither side played in time.',
        pid: 2,
      }),
    );
    // Neither the forfeit-specific nor the win-credit messaging fires: this is
    // routed through voidMatch, not the normal forfeit win/lose lines.
    expect(emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: 'You forfeit the Card Duel.' }),
    );
    expect(emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Your opponent forfeited the Card Duel. You win!' }),
    );
  });

  it('forfeitMatch still credits normally once at least one round has been won', () => {
    const { ctx, emit, bumpDeedStat, players } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    joinCardMinigameQueue(ctx, 2);
    updateCardDuelQueue(ctx);
    const match = cardDuelMatchFor(ctx, 1);
    if (!match) throw new Error('expected a live match');
    match.handA.hand[0] = 9;
    match.handB.hand[0] = 1;
    playCardInDuel(ctx, 9, 1);
    playCardInDuel(ctx, 1, 2);
    expect(cardDuelMatchFor(ctx, 1)?.roundsA).toBe(1);
    forfeitCardDuelMatch(ctx, 2);
    expect(cardDuelMatchFor(ctx, 1)).toBeNull();
    expect(bumpDeedStat).toHaveBeenCalledTimes(1);
    expect(bumpDeedStat.mock.calls[0][0]).toBe(players.get(1));
    expect(bumpDeedStat.mock.calls[0][1]).toBe('cardDuelsWon');
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'You forfeit the Card Duel.', pid: 2 }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Your opponent forfeited the Card Duel. You win!', pid: 1 }),
    );
  });

  it('forfeitCardDuelMatch lets a player in a live match forfeit on demand and re-queue afterward', () => {
    const { ctx, error } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    joinCardMinigameQueue(ctx, 2);
    updateCardDuelQueue(ctx);
    expect(cardDuelMatchFor(ctx, 1)).not.toBeNull();
    forfeitCardDuelMatch(ctx, 1);
    expect(cardDuelMatchFor(ctx, 1)).toBeNull();
    expect(cardDuelMatchFor(ctx, 2)).toBeNull();
    // The player is now free to re-queue: before the fix this errored
    // 'already_in_duel' forever, since nothing ever cleared ctx.cardDuels.
    joinCardMinigameQueue(ctx, 1);
    expect(error).not.toHaveBeenCalledWith(1, 'You are already in a Card Duel.');
    expect(ctx.cardDuelQueue).toContain(1);
  });

  it('forfeitCardDuelMatch errors when not in a live match', () => {
    const { ctx, error } = makeCtx();
    forfeitCardDuelMatch(ctx, 3);
    expect(error).toHaveBeenCalledWith(3, 'You are not in a Card Duel.');
  });

  it('an expired round deadline forfeits the side that never played the round', () => {
    const { ctx, emit, bumpDeedStat } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    joinCardMinigameQueue(ctx, 2);
    updateCardDuelQueue(ctx);
    const match = cardDuelMatchFor(ctx, 1);
    if (!match) throw new Error('expected a live match');
    // Play out one full round first so roundsA + roundsB > 0 (finding 3's
    // anti-farm gate voids an AFK forfeit before any round has been won, same
    // as the both-idle case), so this exercises the CREDIT path deliberately.
    match.handA.hand[0] = 9;
    match.handB.hand[0] = 1;
    playCardInDuel(ctx, 9, 1);
    playCardInDuel(ctx, 1, 2);
    expect(cardDuelMatchFor(ctx, 1)?.roundsA).toBe(1);
    // Side A plays round 2; side B goes idle (an unresponsive opponent).
    const live = cardDuelMatchFor(ctx, 1);
    if (!live) throw new Error('expected a live match');
    playCardInDuel(ctx, live.handA.hand[0], 1);
    (ctx as unknown as { time: number }).time = live.roundDeadline + 1;
    updateCardDuelDeadlines(ctx);
    expect(cardDuelMatchFor(ctx, 1)).toBeNull();
    expect(cardDuelMatchFor(ctx, 2)).toBeNull();
    expect(bumpDeedStat).toHaveBeenCalledTimes(1);
    expect(bumpDeedStat.mock.calls[0][1]).toBe('cardDuelsWon');
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'You forfeit the Card Duel.', pid: 2 }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Your opponent forfeited the Card Duel. You win!', pid: 1 }),
    );
  });

  it('an expired round deadline forfeits side A when A is the one who went idle (mirror arm)', () => {
    const { ctx, emit, bumpDeedStat } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    joinCardMinigameQueue(ctx, 2);
    updateCardDuelQueue(ctx);
    const match = cardDuelMatchFor(ctx, 1);
    if (!match) throw new Error('expected a live match');
    // Play out one full round first so roundsA + roundsB > 0 (see the sibling
    // test above for why the zero-round anti-farm gate requires this here).
    match.handA.hand[0] = 9;
    match.handB.hand[0] = 1;
    playCardInDuel(ctx, 9, 1);
    playCardInDuel(ctx, 1, 2);
    expect(cardDuelMatchFor(ctx, 1)?.roundsA).toBe(1);
    // Side B plays round 2; side A goes idle. Without this arm, a regression
    // that always forfeits match.b (the constant that also satisfies the
    // other test) would go undetected.
    const live = cardDuelMatchFor(ctx, 1);
    if (!live) throw new Error('expected a live match');
    playCardInDuel(ctx, live.handB.hand[0], 2);
    (ctx as unknown as { time: number }).time = live.roundDeadline + 1;
    updateCardDuelDeadlines(ctx);
    expect(cardDuelMatchFor(ctx, 1)).toBeNull();
    expect(cardDuelMatchFor(ctx, 2)).toBeNull();
    expect(bumpDeedStat).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'You forfeit the Card Duel.', pid: 1 }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Your opponent forfeited the Card Duel. You win!', pid: 2 }),
    );
  });

  it('an expired round deadline with both sides idle voids the match without crediting anyone', () => {
    const { ctx, emit, bumpDeedStat } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    joinCardMinigameQueue(ctx, 2);
    updateCardDuelQueue(ctx);
    const match = cardDuelMatchFor(ctx, 1);
    if (!match) throw new Error('expected a live match');
    // Neither side plays a card before the deadline expires.
    (ctx as unknown as { time: number }).time = match.roundDeadline + 1;
    updateCardDuelDeadlines(ctx);
    expect(cardDuelMatchFor(ctx, 1)).toBeNull();
    expect(cardDuelMatchFor(ctx, 2)).toBeNull();
    expect(bumpDeedStat).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Your Card Duel is void: neither side played in time.',
        pid: 1,
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Your Card Duel is void: neither side played in time.',
        pid: 2,
      }),
    );
  });

  it('a normally progressing match refreshes its deadline each round and never auto-forfeits', () => {
    const { ctx } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    joinCardMinigameQueue(ctx, 2);
    updateCardDuelQueue(ctx);
    const match = cardDuelMatchFor(ctx, 1);
    if (!match) throw new Error('expected a live match');
    const startDeadline = match.roundDeadline;
    // Advance sim time to just before the deadline started at, then resolve
    // a round: without the per-round deadline refresh, the match would auto-
    // forfeit 90s after it STARTED rather than after its last completed round.
    (ctx as unknown as { time: number }).time = startDeadline - 1;
    playCardInDuel(ctx, match.handA.hand[0], 1);
    playCardInDuel(ctx, match.handB.hand[0], 2);
    expect(match.roundDeadline).toBeGreaterThan(startDeadline - 1);
    updateCardDuelDeadlines(ctx);
    expect(cardDuelMatchFor(ctx, 1)).not.toBeNull();
  });

  it('best-of-CARD_DUEL_ROUNDS_TO_WIN: the match ends the instant a side reaches the pinned threshold, not sooner', () => {
    const { ctx } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    joinCardMinigameQueue(ctx, 2);
    updateCardDuelQueue(ctx);
    const match = cardDuelMatchFor(ctx, 1);
    if (!match) throw new Error('expected a live match');
    // Side A wins CARD_DUEL_ROUNDS_TO_WIN - 1 rounds: the match must still
    // be live (a threshold of 1, i.e. single-round, would have ended it).
    for (let i = 0; i < CARD_DUEL_ROUNDS_TO_WIN - 1; i++) {
      const m = cardDuelMatchFor(ctx, 1);
      if (!m) throw new Error('match ended early');
      playCardInDuel(ctx, Math.max(...m.handA.hand), 1);
      playCardInDuel(ctx, Math.min(...m.handB.hand), 2);
    }
    expect(cardDuelMatchFor(ctx, 1)?.roundsA).toBe(CARD_DUEL_ROUNDS_TO_WIN - 1);
    expect(cardDuelMatchFor(ctx, 1)).not.toBeNull();
    // The next A win reaches the threshold and ends the match.
    const m = cardDuelMatchFor(ctx, 1);
    if (!m) throw new Error('expected a live match');
    playCardInDuel(ctx, Math.max(...m.handA.hand), 1);
    playCardInDuel(ctx, Math.min(...m.handB.hand), 2);
    expect(cardDuelMatchFor(ctx, 1)).toBeNull();
  });

  it('cardMinigameAvailable ignores Fiesta/Vale Cup bots (offline bot matches must not fake availability)', () => {
    const { ctx, error } = makeCtx();
    (ctx.players.get(2) as unknown as { isFiestaBot?: boolean }).isFiestaBot = true;
    ctx.vcup.botPids.push(3);
    // Only pids 2 and 3 exist besides 1, and both are bots: no queueable
    // human opponent exists, so joining must still be refused.
    joinCardMinigameQueue(ctx, 1);
    expect(error).toHaveBeenCalledWith(1, 'Card Duel requires another player online.');
    expect(ctx.cardDuelQueue).toEqual([]);
  });

  it('does not forfeit a match before its round deadline has passed', () => {
    const { ctx } = makeCtx();
    joinCardMinigameQueue(ctx, 1);
    joinCardMinigameQueue(ctx, 2);
    updateCardDuelQueue(ctx);
    (ctx as unknown as { time: number }).time = CARD_DUEL_ROUND_DEADLINE_S - 1;
    updateCardDuelDeadlines(ctx);
    expect(cardDuelMatchFor(ctx, 1)).not.toBeNull();
  });
});

// Root CLAUDE.md bans "?? 'English'" fallbacks interpolated into player-visible
// text, and the S3 i18n guard (tests/localization_fixes.test.ts) only scrapes
// the outer literal at an emit site, so a fallback hidden inside a template
// string's ${...} interpolation is invisible to it. This is a source scan, not
// a runtime probe, precisely because that gap means a runtime test could pass
// while the pattern still ships: it asserts the banned shape never reappears
// in this file's emit paths, regardless of which emit call it hides in.
describe('card_duel.ts source: no ?? English-literal fallback inside a template interpolation', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../src/sim/social/card_duel.ts', import.meta.url)),
    'utf8',
  );

  it('has no `${... ?? \'literal\'}` or `${... ?? "literal"}` pattern', () => {
    const bannedInTemplate = /\$\{[^}]*\?\?\s*(['"])[^'"]*\1[^}]*\}/g;
    const hits = [...src.matchAll(bannedInTemplate)].map((m) => m[0]);
    expect(hits).toEqual([]);
  });
});
