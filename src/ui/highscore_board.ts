// Home-page global (cross-realm) lifetime-XP high-score board.
//
// Extracted out of src/main.ts (the sanctioned firewall) so the board's markup
// has its own tested home, mirroring the news_feed.ts extraction: the row/head
// builders are host-agnostic string functions, and loadHighscoresInto is a thin
// consumer that takes an injected fetch and paints into a host element. The
// server computes the virtual level and the ranking; this only renders.
//
// The guild tag rides INSIDE the name cell rather than as a seventh grid column,
// so the guild reads beside the name on the desktop grid AND in the mobile
// stacked layout (src/styles/shell.css) without either having to grow a column.
// Angle brackets are HTML entities, the classic `<Guild>` nameplate convention
// (src/render/nameplate_painter.ts), not markup.
import { CLASSES } from '../sim/data';
import type { LeaderboardEntry } from '../world_api';
import { classDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { formatXp } from './xp_bar';

/** The board header row (hidden on the mobile stacked layout). */
function headHtml(): string {
  return (
    `<div class="hs-row hs-head">` +
    `<span class="hs-rank">${esc(t('game.leaderboard.rank'))}</span>` +
    `<span class="hs-name">${esc(t('game.leaderboard.name'))}</span>` +
    `<span class="hs-realm">${esc(t('game.leaderboard.realmCol'))}</span>` +
    `<span class="hs-lvl">${esc(t('game.leaderboard.level'))}</span>` +
    `<span class="hs-vlvl">${esc(t('game.leaderboard.vlevel'))}</span>` +
    `<span class="hs-xp">${esc(t('game.leaderboard.lifetimeXp'))}</span></div>`
  );
}

/** The `<Guild>` tag beside the name; empty for an unguilded row, so such a row
 *  renders exactly as it did before the tag existed. */
function guildTagHtml(guild: string | undefined): string {
  if (!guild) return '';
  return ` <span class="hs-guild" title="${esc(t('hudChrome.leaderboard.guildName'))}">&lt;${esc(guild)}&gt;</span>`;
}

/** One ranked row. `data-label` carries the mobile stacked layout's column
 *  captions (rendered by the `::before` rules in shell.css). */
export function highscoreRowHtml(r: LeaderboardEntry): string {
  const realmLabel = t('game.leaderboard.realmCol');
  const levelLabel = t('game.leaderboard.level');
  const virtualLevelLabel = t('game.leaderboard.vlevel');
  const lifetimeXpLabel = t('game.leaderboard.lifetimeXp');
  // Only a class the content table knows resolves a localized name for the
  // hover title (the main.ts behavior this preserves).
  const known = Boolean(CLASSES[r.cls]);
  const star =
    r.prestigeRank > 0
      ? `<span class="hs-prestige" title="${esc(`${t('game.prestige.rank')} ${formatNumber(r.prestigeRank, { maximumFractionDigits: 0 })}`)}">&starf;${formatNumber(r.prestigeRank, { maximumFractionDigits: 0 })}</span>`
      : '';
  return (
    `<div class="hs-row${r.rank <= 3 ? ' hs-top' : ''}">` +
    `<span class="hs-rank">${formatNumber(r.rank, { maximumFractionDigits: 0 })}</span>` +
    `<span class="hs-name"${known ? ` title="${esc(classDisplayName(r.cls))}"` : ''}>${star}${esc(r.name)}${guildTagHtml(r.guild)}</span>` +
    `<span class="hs-realm" data-label="${esc(realmLabel)}">${esc(r.realm ?? '')}</span>` +
    `<span class="hs-lvl" data-label="${esc(levelLabel)}">${formatNumber(r.level, { maximumFractionDigits: 0 })}</span>` +
    `<span class="hs-vlvl" data-label="${esc(virtualLevelLabel)}">${formatNumber(r.virtualLevel, { maximumFractionDigits: 0 })}</span>` +
    `<span class="hs-xp" data-label="${esc(lifetimeXpLabel)}">${formatXp(r.lifetimeXp)}</span></div>`
  );
}

/** The full ranked board (header plus every row). */
export function highscoreBoardHtml(rows: LeaderboardEntry[]): string {
  return headHtml() + rows.map((r) => highscoreRowHtml(r)).join('');
}

export function highscoreLoadingHtml(): string {
  return `<div class="hs-loading">${esc(t('game.leaderboard.loading'))}</div>`;
}

export function highscoreEmptyHtml(): string {
  return `<div class="hs-empty">${esc(t('game.leaderboard.empty'))}</div>`;
}

export function highscoreErrorHtml(): string {
  return `<div class="hs-error">${esc(t('game.leaderboard.retry'))}</div>`;
}

// One in-flight load at a time, the newsLoading guard's shape: the High Scores
// view re-fetches every time it is opened (the server caches, so it is cheap),
// and a second open while the first is still in flight must not double-paint.
let highscoresLoading = false;

/**
 * Fetch the global board and paint it into `host`. Re-entrancy is dropped while a
 * load is in flight; a rejection paints the localized retry line and a resolved
 * empty board paints the empty state.
 */
export async function loadHighscoresInto(
  host: HTMLElement | null,
  fetchLeaders: () => Promise<LeaderboardEntry[]>,
): Promise<void> {
  if (!host || highscoresLoading) return;
  highscoresLoading = true;
  host.innerHTML = highscoreLoadingHtml();
  let rows: LeaderboardEntry[] = [];
  try {
    rows = await fetchLeaders();
  } catch {
    host.innerHTML = highscoreErrorHtml();
    highscoresLoading = false;
    return;
  }
  highscoresLoading = false;
  if (rows.length === 0) {
    host.innerHTML = highscoreEmptyHtml();
    return;
  }
  host.innerHTML = highscoreBoardHtml(rows);
}
