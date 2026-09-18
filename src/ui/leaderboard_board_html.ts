// What each leaderboard tab's podium card says. The leaderboard window
// (leaderboard_window.ts) splits every ranked page through
// leaderboard_podium_view.ts and paints the top three with the podium markup
// (leaderboard_podium_html.ts); this module turns one tab's row into that
// card: the name with the tab's own tags (prestige star and guild tag, guild
// colour tier, dev badge), the ranked number, and one detail line carrying
// everything the tab's ladder row shows for that place (level, virtual level
// and Book of Deeds title; members and top level; realm and title; badge
// tier; score), so standing on the podium never hides information. Every
// player-authored value passes through esc().
import type { DailyRewardLeaderboardEntry } from '../world_api';
import type { DeedsLeaderboardRow } from './deeds_leaderboard_view';
import type { DevLeaderboardRow } from './dev_leaderboard_view';
import { devTierBadgeDataUrl, devTierByIndex, devTierDisplayName } from './dev_tier';
import { classDisplayName } from './entity_i18n';
import { esc } from './esc';
import type { GuildLeaderboardRow } from './guild_leaderboard_view';
import { guildTagHtml } from './guild_tag';
import { formatNumber, t } from './i18n';
import type { PodiumSlotHtml } from './leaderboard_podium_html';
import { isViewerGuild, type PodiumSlot } from './leaderboard_podium_view';
import type { LeaderboardRow } from './leaderboard_view';
import { formatXp } from './xp_bar';

/** Localizes a Book of Deeds title id; '' for an unknown or stale id. */
export type DeedTitleText = (deedId: string) => string;

function whole(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 0 });
}

function youHtml(me: boolean): string {
  return me ? ` <span class="lb-you">(${esc(t('game.leaderboard.you'))})</span>` : '';
}

/** One labelled stat on a podium card's detail line. */
function statHtml(label: string, value: string): string {
  return `<span class="lbp-stat"><span class="lbp-stat-label">${esc(label)}</span> <span class="lbp-stat-value">${esc(value)}</span></span>`;
}

function card<T>(
  slot: PodiumSlot<T>,
  fill: (entry: T) => Pick<PodiumSlotHtml, 'me' | 'nameHtml' | 'metricHtml' | 'detailHtml'>,
): PodiumSlotHtml {
  const base = { place: slot.place, rankText: slot.rankText };
  if (!slot.entry) {
    return {
      ...base,
      filled: false,
      me: false,
      nameHtml: esc(t('hudChrome.leaderboard.unclaimed')),
      metricHtml: '',
      detailHtml: '',
    };
  }
  return { ...base, filled: true, ...fill(slot.entry) };
}

export function playersPodiumSlot(
  slot: PodiumSlot<LeaderboardRow>,
  titleText: DeedTitleText,
): PodiumSlotHtml {
  return card(slot, (row) => {
    // The ladder row's prestige treatment: the star keeps its rank tooltip.
    const star =
      row.prestigeRank > 0
        ? `<span class="lb-prestige" title="${esc(t('hudChrome.leaderboard.prestigeTitle', { rank: whole(row.prestigeRank) }))}">&starf;${whole(row.prestigeRank)}</span> `
        : '';
    const title = row.knownClass ? ` title="${esc(classDisplayName(row.cls))}"` : '';
    const deedTitle = row.title ? titleText(row.title) : '';
    return {
      me: row.me,
      // "(You)" stays beside the name; the guild tag follows it, on its own line on the card.
      nameHtml: `<span${title}>${star}${esc(row.name)}${youHtml(row.me)}${guildTagHtml(row.guild, 'lb-guild')}</span>`,
      metricHtml: esc(formatXp(row.lifetimeXp)),
      detailHtml:
        statHtml(t('game.leaderboard.level'), whole(row.level)) +
        statHtml(t('game.leaderboard.vlevel'), whole(row.virtualLevel)) +
        (deedTitle ? ` <span class="lb-deed-title">${esc(deedTitle)}</span>` : ''),
    };
  });
}

export function guildPodiumSlot(
  slot: PodiumSlot<GuildLeaderboardRow>,
  viewerGuild: string | null | undefined,
): PodiumSlotHtml {
  return card(slot, (row) => ({
    me: isViewerGuild(row.name, viewerGuild),
    nameHtml: `<span class="guild-tier-${row.tier}">${esc(row.name)}</span>`,
    metricHtml: esc(formatXp(row.totalLifetimeXp)),
    detailHtml:
      statHtml(t('hudChrome.leaderboard.members'), whole(row.memberCount)) +
      statHtml(t('hudChrome.leaderboard.topLevel'), whole(row.topLevel)),
  }));
}

export function deedsPodiumSlot(
  slot: PodiumSlot<DeedsLeaderboardRow>,
  titleText: DeedTitleText,
): PodiumSlotHtml {
  return card(slot, (row) => {
    const cls = row.knownClass ? ` title="${esc(classDisplayName(row.cls))}"` : '';
    const deedTitle = row.title ? titleText(row.title) : '';
    return {
      me: row.me,
      nameHtml: `<span${cls}>${esc(row.name)}${youHtml(row.me)}</span>`,
      metricHtml: esc(whole(row.renown)),
      detailHtml:
        `<span class="lb-realm">${esc(row.realm)}</span>` +
        (deedTitle ? ` <span class="lb-deed-title">${esc(deedTitle)}</span>` : ''),
    };
  });
}

export function devPodiumSlot(slot: PodiumSlot<DevLeaderboardRow>): PodiumSlotHtml {
  return card(slot, (row) => {
    const def = devTierByIndex(row.devTier);
    const badge = def
      ? `<img class="lb-dev-badge" src="${devTierBadgeDataUrl(def, 32)}" alt="" draggable="false">`
      : '';
    return {
      me: row.me,
      nameHtml: `${badge}@${esc(row.login)}${youHtml(row.me)}`,
      metricHtml: esc(whole(row.mergedPrs)),
      detailHtml: def
        ? `<span class="lb-dev-tier">${esc(devTierDisplayName(def))}</span>`
        : statHtml(t('hudChrome.leaderboard.mergedPrs'), whole(row.mergedPrs)),
    };
  });
}

export function dailyPodiumSlot(slot: PodiumSlot<DailyRewardLeaderboardEntry>): PodiumSlotHtml {
  return card(slot, (row) => ({
    me: row.me,
    nameHtml: `${esc(row.name)}${youHtml(row.me)}`,
    metricHtml: esc(whole(row.points)),
    detailHtml: esc(t('hudChrome.dailyRewards.score')),
  }));
}
