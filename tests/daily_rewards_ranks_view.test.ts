// @vitest-environment jsdom
// The rewards tab's two rank panels, now that they are reachable.
//
// Extracted by Bank Storage phase 17's review round. Neither had an arm: both
// were private markup builders reachable only by painting a whole rewards tab
// against a full status record, and their EMPTY states in particular had nothing
// pinning them at all.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  dailyRewardsHistoryHtml,
  dailyRewardsLeaderboardHtml,
} from '../src/ui/daily_rewards_ranks_view';
import { dailyRewardsWalletCardHtml } from '../src/ui/daily_rewards_wallet_card_view';
import { t } from '../src/ui/i18n';
import { usdDollarsText } from '../src/ui/usd_text';
import type { DailyRewardHistory, DailyRewardStatus } from '../src/world_api';

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

function status(over: Partial<DailyRewardStatus> = {}): DailyRewardStatus {
  return { leaderboard: [], leaderboardTotal: 0, ...over } as unknown as DailyRewardStatus;
}

describe('dailyRewardsLeaderboardHtml', () => {
  it('says the board is empty rather than rendering an empty list', () => {
    const host = mount(dailyRewardsLeaderboardHtml(status()));
    expect(host.querySelector('.dr-empty')?.textContent).toBe(
      t('hudChrome.dailyRewards.noLeaders'),
    );
    expect(host.querySelectorAll('.dr-rank').length).toBe(0);
  });

  it('marks the VIEWER row and only it', () => {
    const host = mount(
      dailyRewardsLeaderboardHtml(
        status({
          leaderboardTotal: 3,
          leaderboard: [
            { rank: 1, name: 'Ayla', points: 900, me: false },
            { rank: 2, name: 'Borin', points: 400, me: true },
            { rank: 3, name: 'Cira', points: 100, me: false },
          ],
        } as unknown as Partial<DailyRewardStatus>),
      ),
    );
    const rows = [...host.querySelectorAll('.dr-rank')];
    expect(rows.map((r) => r.className.includes('mine'))).toEqual([false, true, false]);
  });

  it('picks the SINGULAR total sentence at exactly one participant', () => {
    // The plural boundary, which is the only decision in the header and which no
    // paint-level arm could reach without a one-player board.
    const one = mount(dailyRewardsLeaderboardHtml(status({ leaderboardTotal: 1 })));
    expect(one.querySelector('.dr-leaderboard-total')?.textContent).toBe(
      t('hudChrome.dailyRewards.totalPlayer', { count: '1' }),
    );
    for (const n of [0, 2, 11]) {
      const many = mount(dailyRewardsLeaderboardHtml(status({ leaderboardTotal: n })));
      expect(many.querySelector('.dr-leaderboard-total')?.textContent, `total ${n}`).toBe(
        t('hudChrome.dailyRewards.totalPlayers', { count: String(n) }),
      );
    }
  });

  it('escapes a player name, which is the one server-authored string on this surface', () => {
    const host = mount(
      dailyRewardsLeaderboardHtml(
        status({
          leaderboardTotal: 1,
          leaderboard: [{ rank: 1, name: '<b>Ayla</b>', points: 5, me: false }],
        } as unknown as Partial<DailyRewardStatus>),
      ),
    );
    expect(host.querySelector('.dr-rank b')?.textContent).toBe('<b>Ayla</b>');
    expect(host.querySelectorAll('.dr-rank b b').length, 'no markup was interpreted').toBe(0);
  });
});

describe('dailyRewardsHistoryHtml', () => {
  it('says there is no history rather than rendering an empty list', () => {
    const host = mount(dailyRewardsHistoryHtml({ payouts: [] } as DailyRewardHistory));
    expect(host.querySelector('.dr-empty')?.textContent).toBe(
      t('hudChrome.dailyRewards.noHistory'),
    );
    // The second half its leaderboard twin already asserts, and the half the title
    // actually names: "RATHER THAN an empty list". Without it the arm passes over a
    // branch that emits the empty sentence AND an empty row list beside it.
    expect(host.querySelectorAll('.dr-rank').length).toBe(0);
  });

  it('shows at most TEN payouts, keeping the ones the wire sent FIRST', () => {
    // DISTINCT rows, or the count alone is satisfied by slice(-10) too and the
    // arm's own title is unpinned: the wire sends newest first, so taking the
    // tail would show the player their OLDEST ten.
    const payouts = Array.from({ length: 14 }, (_, i) => ({
      day: `2026-08-${String(i + 1).padStart(2, '0')}`,
      rank: 1,
      name: `P${i + 1}`,
      prizeUsd: 100,
    }));
    const host = mount(dailyRewardsHistoryHtml({ payouts } as unknown as DailyRewardHistory));
    const names = [...host.querySelectorAll('.dr-rank b')].map((el) => el.textContent);
    expect(names).toEqual(payouts.slice(0, 10).map((p) => p.name));
  });

  it('escapes the day and the name, and renders the prize through the USD formatter', () => {
    const host = mount(
      dailyRewardsHistoryHtml({
        payouts: [{ day: '2026-08-01', rank: 2, name: '<i>Borin</i>', prizeUsd: 1234 }],
      } as unknown as DailyRewardHistory),
    );
    expect(host.querySelector('.dr-rank b')?.textContent).toBe('<i>Borin</i>');
    expect(host.querySelectorAll('.dr-rank i').length).toBe(0);
    expect(host.querySelector('.dr-rank span')?.textContent).toBe('2026-08-01 #2');
    // The whole resolved sentence through the DOLLARS formatter. A bare
    // not-empty assertion survives a swap to the unit twin (usdText), which is
    // exactly the mistake src/ui/usd_text.ts exists to make nameable.
    expect(host.querySelector('.dr-rank strong')?.textContent).toBe(
      t('hudChrome.dailyRewards.usd', { amount: usdDollarsText(1234) }),
    );
  });
});

describe('the spin controller stays inside the painter gate (Bank Storage phase 17)', () => {
  it("its FILENAME matches the gate's own corpus regex, read out of the gate", () => {
    // The rename's justification was prose until this arm. tests/hud_perf_budget
    // discovers its corpus by filename, so a name outside that regex takes the
    // cold contract off code that did not change; the file was renamed for
    // exactly that reason and nothing pinned the reason.
    //
    // The regex is EXTRACTED from the gate rather than restated here: a copy
    // would go on passing after the real one narrowed, which is the whole class
    // of pin this packet keeps finding.
    const gate = readFileSync(resolve(process.cwd(), 'tests/hud_perf_budget.test.ts'), 'utf8');
    // Body and flags taken apart and handed to RegExp, rather than eval'd: the
    // point is to EXECUTE the gate's own literal, and a constructor does that
    // without the ban a raw eval earns.
    const declared = gate.match(/const PAINTER_FILE_RE = \/(.+)\/([a-z]*);/);
    expect(declared, 'the gate still declares PAINTER_FILE_RE as a literal').not.toBeNull();
    const re = new RegExp(declared?.[1] as string, declared?.[2]);
    expect(re.test('daily_rewards_spin_controller.ts'), 'swept').toBe(true);
    // The two names the rename rejected, so the arm says what it is FOR.
    expect(re.test('daily_rewards_spin_overlay.ts'), 'the original name was not swept').toBe(false);
    expect(existsSync(resolve(process.cwd(), 'src/ui/daily_rewards_spin_controller.ts'))).toBe(
      true,
    );
  });
});

describe('dailyRewardsWalletCardHtml: the lock card', () => {
  function ready(over: {
    locked?: boolean;
    lockReason?: string;
    minUsd?: number;
  }): Parameters<typeof dailyRewardsWalletCardHtml>[0] {
    return {
      kind: 'ready',
      locked: over.locked ?? true,
      lockReason: over.lockReason,
      status: { eligibility: { minUsd: over.minUsd ?? 25 } },
    } as unknown as Parameters<typeof dailyRewardsWalletCardHtml>[0];
  }

  it('renders NOTHING when the reward is not locked', () => {
    expect(dailyRewardsWalletCardHtml(ready({ locked: false }))).toBe('');
  });

  it('renders NOTHING for a BAN, which is the arm a reader is most likely to get wrong', () => {
    // A banned player is told by a different surface entirely and must never be
    // invited to connect a wallet as though that would fix it.
    expect(dailyRewardsWalletCardHtml(ready({ lockReason: 'banned' }))).toBe('');
  });

  it('offers the CONNECT button only for a missing wallet', () => {
    const connect = mount(dailyRewardsWalletCardHtml(ready({ lockReason: 'no_wallet' })));
    expect(connect.querySelector('[data-wallet-connect]')).not.toBeNull();
    expect(connect.querySelector('h3')?.textContent).toBe(
      t('hudChrome.dailyRewards.walletConnectTitle'),
    );
    for (const reason of ['under_minimum', 'price_stale', undefined]) {
      const held = mount(dailyRewardsWalletCardHtml(ready({ lockReason: reason })));
      expect(held.querySelector('[data-wallet-connect]'), String(reason)).toBeNull();
      expect(held.querySelector('h3')?.textContent, String(reason)).toBe(
        t('hudChrome.dailyRewards.walletHoldTitle'),
      );
    }
  });

  it('splices the MINIMUM into the under-minimum body, and not into the others', () => {
    const under = mount(
      dailyRewardsWalletCardHtml(ready({ lockReason: 'under_minimum', minUsd: 40 })),
    );
    expect(under.querySelector('p')?.textContent).toBe(
      t('hudChrome.dailyRewards.walletHoldBody', { amount: '40' }),
    );
    const stale = mount(dailyRewardsWalletCardHtml(ready({ lockReason: 'price_stale' })));
    expect(stale.querySelector('p')?.textContent).toBe(t('hudChrome.dailyRewards.walletPriceBody'));
  });
});
