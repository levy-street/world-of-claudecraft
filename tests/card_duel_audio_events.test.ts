import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Card Duel had zero audio events before this change (only generic 'log'
// text). Drives the real sim end-to-end and asserts the new typed events
// (cardDuelMatchStart, cardPlayed, cardRoundResolved, cardDuelMatchEnd) fire
// at the exact moments hud.ts's audio wiring depends on.

function makeWorld(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true });
}

function teleportToCardMaster(sim: Sim, pid: number) {
  const e = sim.entities.get(pid)!;
  const x = 13;
  const z = 2;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as unknown as { rebucket(e: unknown): void }).rebucket(e);
}

function queueDuo(sim: Sim, aName = 'Aleph', bName = 'Bet') {
  const a = sim.addPlayer('warrior', aName);
  const b = sim.addPlayer('mage', bName);
  teleportToCardMaster(sim, a);
  teleportToCardMaster(sim, b);
  sim.joinCardDuelQueue(a);
  sim.joinCardDuelQueue(b);
  const events = sim.tick(); // updateCardDuelQueue() matchmakes the pair
  return { a, b, events };
}

describe('Card Duel audio event wiring', () => {
  it('emits cardDuelMatchStart for both sides the tick they get matched', () => {
    const sim = makeWorld();
    const { a, b, events } = queueDuo(sim);
    const starts = events.filter(
      (e): e is Extract<SimEvent, { type: 'cardDuelMatchStart' }> =>
        e.type === 'cardDuelMatchStart',
    );
    expect(starts.map((e) => e.pid).sort()).toEqual([a, b].sort());
  });

  it('emits cardPlayed for the acting player the moment they play a card', () => {
    const sim = makeWorld();
    const { a } = queueDuo(sim);
    const match = sim.cardDuelMatchFor(a)!;
    sim.playCardInDuel(match.handA.hand[0], a);
    const drained = sim.tick();
    const played = drained.filter(
      (e): e is Extract<SimEvent, { type: 'cardPlayed' }> => e.type === 'cardPlayed',
    );
    expect(played).toEqual([{ type: 'cardPlayed', pid: a }]);
    // cardRoundResolved carries both sides' card values, so it must NOT leak
    // until the opponent has played too; a single play must never emit it.
    expect(drained.some((e) => e.type === 'cardRoundResolved')).toBe(false);
  });

  it('emits a correctly-scored cardRoundResolved for both sides when a round resolves', () => {
    const sim = makeWorld();
    const { a, b } = queueDuo(sim);
    const match = sim.cardDuelMatchFor(a)!;
    // Force a deterministic, unambiguous win/lose instead of trusting whatever
    // the shuffled starting hands happen to hold.
    match.handA.hand[0] = 9;
    match.handB.hand[0] = 3;
    sim.playCardInDuel(9, a);
    sim.playCardInDuel(3, b);
    const drained = sim.tick();
    const resolved = drained.filter(
      (e): e is Extract<SimEvent, { type: 'cardRoundResolved' }> => e.type === 'cardRoundResolved',
    );
    const forA = resolved.find((e) => e.pid === a)!;
    const forB = resolved.find((e) => e.pid === b)!;
    expect(forA).toMatchObject({ mine: 9, theirs: 3, outcome: 'win' });
    expect(forB).toMatchObject({ mine: 3, theirs: 9, outcome: 'lose' });
  });

  it('reports a push outcome (no reshuffle) when both sides play the same value', () => {
    const sim = makeWorld();
    const { a, b } = queueDuo(sim);
    const match = sim.cardDuelMatchFor(a)!;
    match.handA.hand[0] = 5;
    match.handB.hand[0] = 5;
    sim.playCardInDuel(5, a);
    sim.playCardInDuel(5, b);
    const resolved = sim
      .tick()
      .filter(
        (e): e is Extract<SimEvent, { type: 'cardRoundResolved' }> =>
          e.type === 'cardRoundResolved',
      );
    expect(resolved.every((e) => e.outcome === 'push')).toBe(true);
  });

  it('flags reshuffled:true only for the side whose deck ran out this draw', () => {
    const sim = makeWorld();
    const { a, b } = queueDuo(sim);
    const match = sim.cardDuelMatchFor(a)!;
    match.handA.hand[0] = 7;
    match.handB.hand[0] = 2;
    // Starve side A's deck so its post-round drawOne must reshuffle; leave
    // side B's deck alone as the negative control in the same round.
    match.handA.deck = [];
    match.handA.discard = [1, 2, 3];
    sim.playCardInDuel(7, a);
    sim.playCardInDuel(2, b);
    const resolved = sim
      .tick()
      .filter(
        (e): e is Extract<SimEvent, { type: 'cardRoundResolved' }> =>
          e.type === 'cardRoundResolved',
      );
    expect(resolved.find((e) => e.pid === a)?.reshuffled).toBe(true);
    expect(resolved.find((e) => e.pid === b)?.reshuffled).toBe(false);
  });

  it('emits cardDuelMatchEnd with won:true for the winner and won:false for the loser', () => {
    const sim = makeWorld();
    const { a, b } = queueDuo(sim);
    // A wins both rounds straight to close the match (CARD_DUEL_ROUNDS_TO_WIN = 2).
    for (let round = 0; round < 2; round++) {
      const live = sim.cardDuelMatchFor(a)!;
      live.handA.hand[0] = 9;
      live.handB.hand[0] = 1;
      sim.playCardInDuel(9, a);
      sim.playCardInDuel(1, b);
    }
    const ended = sim
      .tick()
      .filter(
        (e): e is Extract<SimEvent, { type: 'cardDuelMatchEnd' }> => e.type === 'cardDuelMatchEnd',
      );
    expect(ended.find((e) => e.pid === a)?.won).toBe(true);
    expect(ended.find((e) => e.pid === b)?.won).toBe(false);
  });

  it('emits cardDuelMatchEnd on a forfeit too, crediting the non-forfeiting side the win', () => {
    const sim = makeWorld();
    const { a, b } = queueDuo(sim);
    const match = sim.cardDuelMatchFor(a)!;
    match.handA.hand[0] = 9;
    match.handB.hand[0] = 1;
    sim.playCardInDuel(9, a);
    sim.playCardInDuel(1, b);
    sim.tick(); // clear the round-resolve emits first
    sim.forfeitCardDuel(a);
    const ended = sim
      .tick()
      .filter(
        (e): e is Extract<SimEvent, { type: 'cardDuelMatchEnd' }> => e.type === 'cardDuelMatchEnd',
      );
    expect(ended.find((e) => e.pid === a)?.won).toBe(false);
    expect(ended.find((e) => e.pid === b)?.won).toBe(true);
  });

  it('emits cardDuelMatchEnd for both sides on a void match (an early forfeit before any round is won)', () => {
    const sim = makeWorld();
    const { a, b } = queueDuo(sim);
    // Forfeit immediately, before either side has won a round: this routes
    // through voidMatch, not the winner/loser forfeit branch above. It used
    // to end in total audio silence, indistinguishable from a no-op button.
    sim.forfeitCardDuel(a);
    const ended = sim
      .tick()
      .filter(
        (e): e is Extract<SimEvent, { type: 'cardDuelMatchEnd' }> => e.type === 'cardDuelMatchEnd',
      );
    expect(ended.map((e) => e.pid).sort()).toEqual([a, b].sort());
    expect(ended.every((e) => e.won === false)).toBe(true);
  });
});
