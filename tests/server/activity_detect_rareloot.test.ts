// The rare-drop arm of server/activity_detect.ts, imported DIRECTLY.
//
// Player report (Discord, 2026-09-16): a party member got the "epic drop for
// @you" card for Wand of Quenched Sparks after an Ignivar kill but never
// received the item; another player was tagged for a ring somebody else won in
// the Crucible. The arm keyed the card off the `lootRoll` PROMPT, which fans
// one copy out per candidate before anyone has rolled, and the per-roll-id
// dedupe kept whichever candidate's copy came first as the card's subject.
// The card now rides the award-time `lootRollAwarded` event, so the tagged
// player is always the one the sim granted the item to, and a prompt alone
// never enqueues anything.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimEvent } from '../../src/sim/types';

const enqueueActivity =
  vi.fn<(item: Record<string, unknown>, dedupeKey: string | null, now: number) => void>();
vi.mock('../../server/discord_activity', () => ({
  enqueueActivity: (item: Record<string, unknown>, dedupeKey: string | null, now: number) =>
    enqueueActivity(item, dedupeKey, now),
  claimDedupeKey: () => true,
  releaseDedupeKey: () => {},
}));
vi.mock('../../server/deeds_db', () => ({ getDeedBroadcasts: async () => true }));
vi.mock('../../server/daily_rewards', () => ({ dailyRewardService: {} }));
vi.mock('../../server/realm', () => ({ REALM: 'Claudemoon' }));

import { type ActivityDetectDeps, detectActivityEvent } from '../../server/activity_detect';

interface Session {
  accountId: number;
  characterId: number;
  name: string;
}
const NOW = 1_700_000_000_000;
// pid order mirrors the death-time recipient snapshot: the first candidate
// (the pre-fix "subject") is NOT the winner.
const SESSIONS = new Map<number, Session>([
  [11, { accountId: 101, characterId: 1, name: 'Nini' }],
  [12, { accountId: 102, characterId: 2, name: 'Griffain' }],
  [13, { accountId: 103, characterId: 3, name: 'Jorix' }],
]);
const deps: ActivityDetectDeps<Session> = {
  clients: { get: (pid) => SESSIONS.get(pid) },
  profileUrlFor: (name) => `https://worldofclaudecraft.com/c/claudemoon/${name.toLowerCase()}`,
  sessionByName: (name) => [...SESSIONS.values()].find((s) => s.name === name) ?? null,
  sendDailyRewardPointsGained: () => {},
};

const DROP = {
  rollId: 77,
  itemId: 'wand_of_quenched_sparks',
  itemName: 'Wand of Quenched Sparks',
  quality: 'epic' as const,
};

beforeEach(() => enqueueActivity.mockReset());

describe('activity_detect: rare-drop card', () => {
  it('never cards the per-candidate lootRoll prompt (nobody has won yet)', () => {
    for (const pid of [11, 12, 13]) {
      const ev: SimEvent = { type: 'lootRoll', ...DROP, expiresAt: 60, pid };
      detectActivityEvent(ev, NOW, deps);
    }
    const master: SimEvent = {
      type: 'masterLoot',
      ...DROP,
      expiresAt: 300,
      candidates: [],
      pid: 11,
    };
    detectActivityEvent(master, NOW, deps);
    expect(enqueueActivity).not.toHaveBeenCalled();
  });

  it('cards the award, tagging the WINNER, keyed per roll id', () => {
    const ev: SimEvent = { type: 'lootRollAwarded', ...DROP, pid: 13 };
    detectActivityEvent(ev, NOW, deps);
    expect(enqueueActivity).toHaveBeenCalledTimes(1);
    expect(enqueueActivity).toHaveBeenCalledWith(
      {
        kind: 'rareloot',
        accountIds: [103],
        names: ['Jorix'],
        realm: 'Claudemoon',
        profileUrl: 'https://worldofclaudecraft.com/c/claudemoon/jorix',
        itemName: 'Wand of Quenched Sparks',
        quality: 'epic',
      },
      'rareloot:77',
      NOW,
    );
  });

  it('cards legendary awards too, and nothing below epic', () => {
    detectActivityEvent(
      { type: 'lootRollAwarded', ...DROP, quality: 'legendary', pid: 12 },
      NOW,
      deps,
    );
    detectActivityEvent({ type: 'lootRollAwarded', ...DROP, quality: 'rare', pid: 12 }, NOW, deps);
    detectActivityEvent(
      { type: 'lootRollAwarded', ...DROP, quality: 'uncommon', pid: 12 },
      NOW,
      deps,
    );
    expect(enqueueActivity).toHaveBeenCalledTimes(1);
    expect(enqueueActivity.mock.calls[0][0]).toMatchObject({
      quality: 'legendary',
      names: ['Griffain'],
    });
  });

  it('a winner with no live session (a bot, or gone by the tick) cards without a subject', () => {
    detectActivityEvent({ type: 'lootRollAwarded', ...DROP, pid: 999 }, NOW, deps);
    expect(enqueueActivity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'rareloot', accountIds: [], names: [], profileUrl: null }),
      'rareloot:77',
      NOW,
    );
  });
});
