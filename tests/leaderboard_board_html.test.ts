// @vitest-environment happy-dom
//
// Each leaderboard tab's podium card (src/ui/leaderboard_board_html.ts): every
// player-authored value (name, guild, login, realm, deed title text) is escaped,
// the card keeps everything the tab's ladder row shows for that place (so the
// podium never hides information), the viewer's own card is flagged, and an
// unclaimed place reads "Unclaimed" with no number.
import { describe, expect, it } from 'vitest';
import type { DeedsLeaderboardRow } from '../src/ui/deeds_leaderboard_view';
import type { DevLeaderboardRow } from '../src/ui/dev_leaderboard_view';
import { devTierByIndex, devTierDisplayName } from '../src/ui/dev_tier';
import type { GuildLeaderboardRow } from '../src/ui/guild_leaderboard_view';
import {
  dailyPodiumSlot,
  deedsPodiumSlot,
  devPodiumSlot,
  guildPodiumSlot,
  playersPodiumSlot,
} from '../src/ui/leaderboard_board_html';
import type { PodiumSlotHtml } from '../src/ui/leaderboard_podium_html';
import type { PodiumSlot } from '../src/ui/leaderboard_podium_view';
import type { LeaderboardRow } from '../src/ui/leaderboard_view';

const HOSTILE = '<img src=x onerror=alert(1)>';

function at<T>(entry: T | null, place: 1 | 2 | 3 = 1): PodiumSlot<T> {
  return { place, rankText: String(place), entry };
}

/** Paint one card's three markup fields into a detached element. */
function dom(card: PodiumSlotHtml): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = `<b class="n">${card.nameHtml}</b><b class="m">${card.metricHtml}</b><b class="d">${card.detailHtml}</b>`;
  return host;
}

function noInjectedMarkup(host: HTMLElement): void {
  // A dev badge is the one legitimate image, and only with the procedural data
  // url; nothing player-authored may add one.
  for (const img of Array.from(host.querySelectorAll('img'))) {
    expect(img.classList.contains('lb-dev-badge')).toBe(true);
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml,/);
  }
  expect(host.querySelector('[onerror]')).toBeNull();
}

function player(over: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    rank: 1,
    name: 'Seraphine',
    cls: 'warrior',
    knownClass: true,
    level: 20,
    virtualLevel: 34,
    lifetimeXp: 980_000,
    prestigeRank: 0,
    title: null,
    guild: null,
    me: false,
    ...over,
  };
}

describe('playersPodiumSlot', () => {
  it('escapes the name, guild tag and deed title text', () => {
    const card = playersPodiumSlot(
      at(player({ name: HOSTILE, guild: HOSTILE, title: 'deed_x' })),
      () => HOSTILE,
    );
    const host = dom(card);
    noInjectedMarkup(host);
    expect(host.querySelector('.n')?.textContent).toContain(HOSTILE);
    expect(host.querySelector('.lb-guild')?.textContent).toBe(`<${HOSTILE}>`);
    expect(host.querySelector('.lb-deed-title')?.textContent).toBe(HOSTILE);
  });

  it('keeps level, virtual level, deed title and the prestige tooltip on the card', () => {
    const card = playersPodiumSlot(
      at(player({ prestigeRank: 2, title: 'deed_first_steps' })),
      (id) => (id === 'deed_first_steps' ? 'the Wanderer' : ''),
    );
    const host = dom(card);
    expect(card.filled).toBe(true);
    expect(host.querySelector('.m')?.textContent).toBe('980,000');
    const stats = Array.from(host.querySelectorAll('.lbp-stat-value')).map((s) => s.textContent);
    expect(stats).toEqual(['20', '34']);
    expect(host.querySelector('.lb-deed-title')?.textContent).toBe('the Wanderer');
    const star = host.querySelector('.lb-prestige');
    expect(star?.getAttribute('title')).toBe('Prestige 2');
  });

  it('renders no title span for an untitled or stale title', () => {
    expect(
      dom(playersPodiumSlot(at(player()), () => 'x')).querySelector('.lb-deed-title'),
    ).toBeNull();
    expect(
      dom(playersPodiumSlot(at(player({ title: 'gone' })), () => '')).querySelector(
        '.lb-deed-title',
      ),
    ).toBeNull();
  });

  it('flags the viewer standing in the top three with "(You)"', () => {
    const card = playersPodiumSlot(at(player({ name: 'Ari', me: true }), 2), () => '');
    expect(card.me).toBe(true);
    expect(card.place).toBe(2);
    expect(dom(card).querySelector('.lb-you')).not.toBeNull();
  });

  it('an unclaimed place reads Unclaimed with no number or detail', () => {
    const card = playersPodiumSlot(at<LeaderboardRow>(null, 3), () => '');
    expect(card).toMatchObject({ filled: false, me: false, metricHtml: '', detailHtml: '' });
    expect(card.nameHtml).toBe('Unclaimed');
  });
});

describe('guildPodiumSlot', () => {
  const guild = (over: Partial<GuildLeaderboardRow> = {}): GuildLeaderboardRow =>
    ({
      rank: 1,
      name: 'Moonwardens',
      memberCount: 40,
      totalLifetimeXp: 9_800_000,
      topLevel: 20,
      tier: 2,
      open: null,
      minLevel: 1,
      note: '',
      ...over,
    }) as GuildLeaderboardRow;

  it('escapes the guild name and keeps members and top level', () => {
    const host = dom(guildPodiumSlot(at(guild({ name: HOSTILE })), null));
    noInjectedMarkup(host);
    expect(host.querySelector('.n')?.textContent).toBe(HOSTILE);
    const stats = Array.from(host.querySelectorAll('.lbp-stat-value')).map((s) => s.textContent);
    expect(stats).toEqual(['40', '20']);
  });

  it("flags the viewer's own guild, exact name only", () => {
    expect(guildPodiumSlot(at(guild()), 'Moonwardens').me).toBe(true);
    expect(guildPodiumSlot(at(guild()), 'moonwardens').me).toBe(false);
    expect(guildPodiumSlot(at(guild()), undefined).me).toBe(false);
  });
});

describe('deedsPodiumSlot', () => {
  const deeds = (over: Partial<DeedsLeaderboardRow> = {}): DeedsLeaderboardRow => ({
    rank: 1,
    name: 'Brannoc',
    realm: 'Claudemoon',
    cls: 'mage',
    knownClass: true,
    level: 20,
    renown: 5090,
    title: null,
    me: false,
    ...over,
  });

  it('escapes the name, realm and title, and keeps both on the card', () => {
    const host = dom(
      deedsPodiumSlot(at(deeds({ name: HOSTILE, realm: HOSTILE, title: 'd' })), () => HOSTILE),
    );
    noInjectedMarkup(host);
    expect(host.querySelector('.lb-realm')?.textContent).toBe(HOSTILE);
    expect(host.querySelector('.lb-deed-title')?.textContent).toBe(HOSTILE);
    expect(host.querySelector('.m')?.textContent).toBe('5,090');
  });
});

describe('devPodiumSlot', () => {
  const dev = (over: Partial<DevLeaderboardRow> = {}): DevLeaderboardRow => ({
    rank: 1,
    login: 'ari-dev',
    mergedPrs: 42,
    devTier: 0,
    me: false,
    ...over,
  });

  it('escapes the login and falls back to the merged count below the first tier', () => {
    const card = devPodiumSlot(at(dev({ login: HOSTILE, me: true })));
    const host = dom(card);
    noInjectedMarkup(host);
    expect(host.querySelector('.n')?.textContent).toContain(`@${HOSTILE}`);
    expect(card.me).toBe(true);
    expect(host.querySelector('.m')?.textContent).toBe('42');
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.lb-dev-tier')).toBeNull();
    expect(host.querySelector('.d .lbp-stat-value')?.textContent).toBe('42');
  });

  it('renders the badge and the tier name once a tier is earned', () => {
    const tier = devTierByIndex(1);
    if (!tier) throw new Error('dev tier 1 is missing');
    const host = dom(devPodiumSlot(at(dev({ login: HOSTILE, devTier: 1 }))));
    noInjectedMarkup(host);
    expect(host.querySelectorAll('img')).toHaveLength(1);
    expect(host.querySelector('img.lb-dev-badge')?.getAttribute('src')).toMatch(
      /^data:image\/svg\+xml,/,
    );
    expect(host.querySelector('.d .lb-dev-tier')?.textContent).toBe(devTierDisplayName(tier));
    expect(host.querySelector('.d .lbp-stat')).toBeNull();
  });
});

describe('dailyPodiumSlot', () => {
  it('escapes the name and keeps the score', () => {
    const entry: DailyRewardLeaderboardEntryLike = {
      rank: 1,
      name: HOSTILE,
      points: 900,
      me: true,
    };
    const card = dailyPodiumSlot(at(entry));
    const host = dom(card);
    noInjectedMarkup(host);
    expect(host.querySelector('.n')?.textContent).toContain(HOSTILE);
    expect(host.querySelector('.m')?.textContent).toBe('900');
    expect(card.me).toBe(true);
  });
});

type DailyRewardLeaderboardEntryLike = { rank: number; name: string; points: number; me: boolean };
