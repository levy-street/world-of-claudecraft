import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';

// Sim-level coverage for cardMinigameInfoFor (sim.ts, delegating to
// buildCardMinigameInfo in src/sim/social/card_duel.ts): the IWorldCardMinigame
// read surface both hosts (Sim, ClientWorld) serve. tests/card_duel_view.test.ts
// only pins a hand-written literal shape; this drives the real producer and
// proves it never leaks the opponent's actual hand (only counts/ids), since
// that is exactly the property the whole design depends on.

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
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
  sim.tick(); // updateCardDuelQueue() matchmakes the pair
  return { a, b };
}

describe('Sim.cardMinigameInfoFor', () => {
  it('reports available:false and not-queued when nobody else is present (offline single-player)', () => {
    const sim = makeWorld();
    const info = sim.cardMinigameInfoFor(sim.primaryId);
    expect(info.available).toBe(false);
    expect(info.queued).toBe(false);
    expect(info.match).toBeNull();
  });

  it('reports available:true and queued once a second player joins the queue', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleportToCardMaster(sim, a);
    teleportToCardMaster(sim, b);
    sim.joinCardDuelQueue(a);
    const info = sim.cardMinigameInfoFor(a);
    expect(info.available).toBe(true);
    expect(info.queued).toBe(true);
    expect(info.match).toBeNull();
  });

  it('reports a live match snapshot for each side, without leaking the opponent hand', () => {
    const sim = makeWorld();
    const { a, b } = queueDuo(sim);

    const infoA = sim.cardMinigameInfoFor(a);
    const infoB = sim.cardMinigameInfoFor(b);
    expect(infoA.match).not.toBeNull();
    expect(infoB.match).not.toBeNull();
    if (!infoA.match || !infoB.match) throw new Error('expected live matches');

    // Each side sees the OTHER pid/name as opponent, and only its own hand.
    expect(infoA.match.opponent.pid).toBe(b);
    expect(infoB.match.opponent.pid).toBe(a);

    // The read surface exposes no opponentHand / raw card field at all: the
    // only cross-referenced data is counts and identity, never the actual
    // card values held by the other side.
    expect(Object.keys(infoA.match).sort()).toEqual(
      [
        'opponent',
        'hand',
        'deckCount',
        'discardCount',
        'myRounds',
        'opponentRounds',
        'waitingOnOpponent',
      ].sort(),
    );
    expect(Object.keys(infoA.match.opponent).sort()).toEqual(['name', 'pid']);

    // A's reported hand must be A's actual hand, not B's, and vice versa: a
    // perspective-flip bug (B-side hand leaking into A's view) would fail this.
    const rawMatch = sim.cardDuelMatchFor(a);
    if (!rawMatch) throw new Error('expected a live match on the sim');
    expect(infoA.match.hand.slice().sort()).toEqual(rawMatch.handA.hand.slice().sort());
    expect(infoB.match.hand.slice().sort()).toEqual(rawMatch.handB.hand.slice().sort());
    // And A's view must NOT equal B's actual hand (unless coincidentally
    // identical multiset, which the deck's two-of-each shuffle makes
    // exceedingly unlikely for a 4-card starting hand from the same seed
    // pool; assert the two producer hands are tracked independently instead).
    expect(rawMatch.handA).not.toBe(rawMatch.handB);
  });
});

describe('Sim.removePlayer tears down Card Duel state', () => {
  it('forfeits a live match and frees the survivor to re-queue', () => {
    const sim = makeWorld();
    const { a, b } = queueDuo(sim);
    expect(sim.cardDuelMatchFor(a)).not.toBeNull();

    sim.removePlayer(a);

    // The departed pid's match is gone, and so is the survivor's (both sides
    // of a live match key the same shared object).
    expect(sim.cardDuelMatchFor(b)).toBeNull();

    // The survivor must be free to re-queue immediately: before this fix,
    // ctx.cardDuels never cleared for the offline Sim / headless env, so a
    // leftover entry permanently blocked joinCardDuelQueue with
    // 'already_in_duel'.
    const c = sim.addPlayer('mage', 'Gimel');
    teleportToCardMaster(sim, b);
    teleportToCardMaster(sim, c);
    sim.joinCardDuelQueue(b);
    const info = sim.cardMinigameInfoFor(b);
    expect(info.queued).toBe(true);
  });

  it('the AFK deadline sweep runs from the real Sim.tick(), not just when called directly', () => {
    // Regression guard: updateCardDuelDeadlines was only ever exercised by
    // calling it directly in tests, so deleting its registration from
    // sim.ts's tick loop (and the parity golden, which draws no rng here)
    // would not have been caught. Drive it through the actual tick.
    const sim = makeWorld();
    const { a, b } = queueDuo(sim);
    const match = sim.cardDuelMatchFor(a);
    if (!match) throw new Error('expected a live match');
    sim.time = match.roundDeadline + 1;
    sim.tick();
    expect(sim.cardDuelMatchFor(a)).toBeNull();
    expect(sim.cardDuelMatchFor(b)).toBeNull();
  });

  it('drops a queued (not yet matched) departed player from the queue', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const bystander = sim.addPlayer('mage', 'Bystander');
    teleportToCardMaster(sim, a);
    sim.joinCardDuelQueue(a);
    expect(sim.cardMinigameInfoFor(a).queued).toBe(true);

    sim.removePlayer(a);

    // Assert the real queue state directly. `a`'s pid is never recycled
    // (Sim.nextId is monotonic, sim.ts), so re-adding at a fresh pid reports
    // queued:false trivially regardless of whether removePlayer ever touched
    // cardDuelQueue: that made the previous version of this assertion pass
    // even if Sim.removePlayer never called leaveCardMinigameEntirely.
    expect(sim.cardDuelQueue).toEqual([]);
    expect(bystander).toBeGreaterThan(0);
  });
});
