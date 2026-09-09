// The duel activity card builder (server/discord_activity_pvp.ts), extracted
// from the duelEnd arm of the game loop: the card shape and its dedupe key, and
// the participant rule (a missing session is left off the lists, never
// defaulted, while the names on the card come from the event).
import { describe, expect, it } from 'vitest';
import { duelActivityCard } from '../../server/discord_activity_pvp';

const ev = { winnerName: 'Ann', loserName: 'Bo' };

describe('duelActivityCard', () => {
  it('builds the card from both sessions with the winner-loser dedupe key', () => {
    expect(
      duelActivityCard(
        ev,
        { accountId: 1, name: 'Ann' },
        { accountId: 2, name: 'Bo' },
        'Claudemoon',
        'https://woc.test/c/Ann',
      ),
    ).toEqual({
      item: {
        kind: 'duel',
        accountIds: [1, 2],
        names: ['Ann', 'Bo'],
        realm: 'Claudemoon',
        profileUrl: 'https://woc.test/c/Ann',
        winnerName: 'Ann',
        loserName: 'Bo',
      },
      key: 'duel:Ann:Bo',
    });
  });

  it('leaves a session-less participant off the lists (null and undefined alike)', () => {
    const card = duelActivityCard(ev, null, { accountId: 2, name: 'Bo' }, 'R', null);
    expect(card.item.accountIds).toEqual([2]);
    expect(card.item.names).toEqual(['Bo']);
    expect(card.item.winnerName).toBe('Ann');
    const none = duelActivityCard(ev, undefined, undefined, 'R', null);
    expect(none.item.accountIds).toEqual([]);
    expect(none.item.names).toEqual([]);
    expect(none.key).toBe('duel:Ann:Bo');
  });
});
