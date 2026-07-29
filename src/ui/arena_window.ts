// Thin DOM painter for the Ashen Coliseum (arena) window.
//
// The consumer half of the pure-core + thin-painter split: it paints
// #arena-window from the structured ArenaView (arena_window_view.ts) and owns the
// window's view-state (selected bracket, the all-time-ladder cache + its fetch
// throttle, the render-skip signature, the WCAG focus opener) plus the
// best-effort all-time ladder fetch. The pure core decides WHICH state the
// snapshot is in and WHAT each section shows; this module renders that and wires
// the bracket / queue / leave / practice / close dispatch back through IWorld +
// injected callbacks. It holds no Sim reference and reaches into Hud only through
// its deps.
//
// It is NOT a canvas window (the colors live in the extracted stylesheet, so no
// getComputedStyle token-resolution applies here); thresholds + cadences are named
// constants. The window redraws while open from hud.update()'s
// mediumHud band (the same call site + cadence as the inline renderArenaWindow),
// skipping the DOM rebuild when the content signature is unchanged.

import { audio } from '../game/audio';
import { CLASSES } from '../sim/data';
import type { ArenaMapId } from '../sim/dungeon_layout';
import type { PlayerClass } from '../sim/types';
import type { ArenaFormat, IWorld } from '../world_api';
import {
  type ArenaSeasonChampionRow,
  type ArenaSeasonCountdown,
  type ArenaSeasonHistoryRow,
  type ArenaSeasonReadoutPayload,
  type ArenaSeasonView,
  buildArenaSeasonView,
} from './arena_season_view';
import {
  type ArenaAction,
  type ArenaAllTimeEntry,
  type ArenaAllTimeRow,
  type ArenaBracketTab,
  type ArenaLadderRow,
  type ArenaPartySection,
  type ArenaView,
  buildArenaView,
} from './arena_window_view';
import { deedTitleText } from './deed_i18n';
import { markDialogRoot } from './dialog_root';
import { classDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, t, tPlural } from './i18n';
import { svgIcon } from './ui_icons';

// Best-effort all-time ladder pull is throttled per bracket to this interval.
const LEADERBOARD_REFETCH_MS = 15000;

// The settled-champions readout moves once per season, so one pull per window
// session is plenty; this only guards a rapid open/close/open.
const SEASON_REFETCH_MS = 300000;

// While we still have NO readout (offline, a cold miss, a failed request) the
// throttle drops to the ladder's interval so the banner fills in soon after a
// server comes back, without letting open/close/open spam an unreachable one.
const SEASON_RETRY_MS = LEADERBOARD_REFETCH_MS;

// The countdown units the pure core quantizes to, mapped to their tPlural BASE
// key (tPlural appends the CLDR category). A third unit reds tsc here instead of
// silently rendering nothing.
const SEASON_COUNTDOWN_KEY: Record<ArenaSeasonCountdown['unit'], { ends: string; opens: string }> =
  {
    days: { ends: 'hudChrome.arenaSeason.endsInDays', opens: 'hudChrome.arenaSeason.opensInDays' },
    hours: {
      ends: 'hudChrome.arenaSeason.endsInHours',
      opens: 'hudChrome.arenaSeason.opensInHours',
    },
    minutes: {
      ends: 'hudChrome.arenaSeason.endsInMinutes',
      opens: 'hudChrome.arenaSeason.opensInMinutes',
    },
  };

// Class ids the painter can localize; passed to the pure core so it stays free
// of the i18n layer while still flagging which rows resolve.
const KNOWN_CLASS_IDS: ReadonlySet<string> = new Set(Object.keys(CLASSES));

// Exhaustive by construction: adding a third ArenaMapId reds tsc here instead
// of silently rendering the wrong map name.
const ARENA_MAP_KEY: Record<ArenaMapId, 'hud.arena.map.coliseum' | 'hud.arena.map.drownedCourt'> = {
  coliseum: 'hud.arena.map.coliseum',
  drowned_court: 'hud.arena.map.drownedCourt',
};

// Render-skip sentinel for the offline panel: once-per-open guard so the static offline
// note is not rebuilt every ~250ms mediumHud tick. The live signature is always
// `JSON.stringify([...])` (it starts with '['), so this plain token (which never starts with
// '[') can never equal a real sig: an offline->live transition rebuilds (live sig never matches
// the sentinel) and a
// live->offline transition rebuilds once (lastSig holds a real sig, not the sentinel).
const ARENA_OFFLINE_SIG = 'arena-offline';

/**
 * Hud-supplied glue. The arena window renders entirely from IWorld + these
 * callbacks; it never reaches into Hud directly. closeOthers mirrors the inline
 * toggle's closeOtherWindows; captureFocus/restoreFocus add WCAG focus-return that
 * the inline site lacked.
 */
export interface ArenaWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

export class ArenaWindow {
  private bracket: ArenaFormat = '1v1';
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;
  // Offline only: dev hook that spins up a 2v2 Fiesta vs bots (null online).
  private practiceHook: (() => void) | null = null;
  // All-time ladder, fetched best-effort from the server (online only), by bracket.
  private allTime: Partial<Record<ArenaFormat, ArenaAllTimeEntry[]>> = {};
  private lbFetchedAt: Partial<Record<ArenaFormat, number>> = {};
  // Settled season champions, fetched best-effort (online only). Null until the
  // first response; the banner still renders its countdown from the shared
  // calendar without it, so an offline world simply shows no champions.
  private seasons: ArenaSeasonReadoutPayload | null = null;
  // -Infinity, not 0: performance.now() is small on a freshly loaded page, so a
  // zero baseline would throttle the very first open away.
  private seasonFetchedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: ArenaWindowDeps) {}

  /** Wire the offline Fiesta-practice hook (left null online, which hides it). */
  setPracticeHook(fn: (() => void) | null): void {
    this.practiceHook = fn;
  }

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  /** Open if closed, close if open (the classic arena keybind / minimap button). */
  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    const root = this.deps.root();
    // WCAG 2.2 AA: the focus-trapped root's dialog identity is a STATIC property
    // of the (stable, never-replaced) root node, so set it ONCE here on open rather than
    // re-writing it inside render(), which the 250ms mediumHud band repeats while the
    // window is open. The innerHTML rebuilds in render() only replace the children.
    markDialogRoot(root, { labelledBy: 'arena-title' });
    root.style.display = 'block';
    this.lastSig = '';
    this.fetchLeaderboard(this.bracket);
    this.fetchSeasons();
    this.render();
    // Move keyboard focus into the freshly opened window (onto the close button),
    // matching the sibling cold windows, so a keyboard user is not left on the opener
    // while the focus trap is active.
    (root.querySelector('[data-close]') as HTMLElement | null)?.focus();
  }

  close(): void {
    const el = this.deps.root();
    if (el.style.display !== 'block') {
      this.openerFocus = null;
      return;
    }
    el.style.display = 'none';
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  // Re-localize the open window after an in-game language switch. The render-skip
  // signature is text-independent (the offline sentinel, or a JSON of ids/numbers), so a
  // language change never moves it on its own; clearing it forces exactly one rebuild with
  // fresh t(). Self-gated on isOpen so the language fan-out can call it unconditionally.
  relocalize(): void {
    if (!this.isOpen) return;
    this.lastSig = '';
    this.render();
  }

  // Best-effort all-time ladder pull. Throttled; silently no-ops offline (no
  // server) so the panel still shows the live online ladder either way.
  private fetchLeaderboard(format: ArenaFormat): void {
    const now = performance.now();
    if (now - (this.lbFetchedAt[format] ?? 0) < LEADERBOARD_REFETCH_MS) return;
    this.lbFetchedAt[format] = now;
    fetch(`/api/arena/leaderboard?format=${encodeURIComponent(format)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.leaders)) {
          this.allTime[format] = d.leaders;
          this.lastSig = '';
        }
      })
      .catch(() => {
        /* offline or no server: live ladder only */
      });
  }

  // Best-effort settled-champions pull. Silently no-ops offline, where the
  // banner still renders the live season and its countdown from the calendar.
  private fetchSeasons(): void {
    const now = performance.now();
    if (
      now - this.seasonFetchedAt <
      (this.seasons === null ? SEASON_RETRY_MS : SEASON_REFETCH_MS)
    ) {
      return;
    }
    this.seasonFetchedAt = now;
    fetch('/api/arena/seasons')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.season === 'number' && Array.isArray(d.settled)) {
          this.seasons = d as ArenaSeasonReadoutPayload;
          this.lastSig = '';
        }
      })
      .catch(() => {
        /* offline or no server: countdown only */
      });
  }

  render(): void {
    const world = this.deps.world();
    const el = this.deps.root();
    // The dialog role / aria-modal / aria-labelledby / tabindex are set ONCE in toggle()
    // on open (the root is stable across renders), not here, so the 250ms mediumHud
    // re-render does not re-write them every tick.
    const view = buildArenaView({
      info: world.arenaInfo,
      selectedBracket: this.bracket,
      playerId: world.playerId,
      playerName: world.player.name,
      party: world.partyInfo,
      allTime: this.allTime,
      practiceAvailable: this.practiceHook !== null,
    });

    if (view.kind === 'offline') {
      // offline / not yet synced: arena is an online ranked feature. The static note is
      // built once per open (skip-guarded by the offline sentinel) instead of every
      // ~250ms mediumHud tick.
      if (this.lastSig === ARENA_OFFLINE_SIG) return;
      this.lastSig = ARENA_OFFLINE_SIG;
      el.innerHTML = this.offlineHtml();
      el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
      return;
    }

    // A queue/match pins its bracket as the selection for the next render.
    if (view.commitBracket) this.bracket = view.bracket;
    this.fetchLeaderboard(view.bracket);
    // The season banner has its own content signature (season, countdown bucket,
    // champions); both must agree before the 250ms band may skip the rebuild.
    const season = buildArenaSeasonView({
      nowMs: Date.now(),
      readout: this.seasons,
      knownClassIds: KNOWN_CLASS_IDS,
    });
    const sig = `${view.sig}|${season.sig}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    el.innerHTML = this.liveHtml(view, season);
    this.wire(el, view);
  }

  private wire(el: HTMLElement, view: Extract<ArenaView, { kind: 'live' }>): void {
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    el.querySelectorAll('[data-bracket]:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.bracket = (btn as HTMLElement).dataset.bracket as ArenaFormat;
        this.lastSig = '';
        this.render();
        audio.click();
      });
    });
    el.querySelector('[data-act="queue"]:not([disabled])')?.addEventListener('click', () => {
      this.deps.world().arenaQueueJoin(view.bracket);
      audio.click();
    });
    el.querySelector('[data-act="leave"]')?.addEventListener('click', () => {
      this.deps.world().arenaQueueLeave();
      audio.click();
    });
    el.querySelector('[data-act="practice"]')?.addEventListener('click', () => {
      this.practiceHook?.();
      this.lastSig = '';
      audio.click();
    });
  }

  // ---- HTML builders (the localized DOM the pure view-model drives) ----------

  private offlineHtml(): string {
    return (
      `<div class="panel-title"><span id="arena-title">${esc(t('hud.arena.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.arena.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="arena-note">${esc(t('hud.arena.offlineNote'))}</div>`
    );
  }

  private liveHtml(view: Extract<ArenaView, { kind: 'live' }>, season: ArenaSeasonView): string {
    const bracketTag = `<span class="arena-bracket-tag${view.bracket === 'fiesta' ? ' fiesta' : ''}">${esc(this.bracketLabel(view.bracket))}</span>`;
    const title = `<div class="panel-title"><span id="arena-title">${esc(t('hud.arena.title'))} ${bracketTag}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.arena.close'))}">${svgIcon('close')}</button></div>`;
    const bracketTabs = `<div class="arena-brackets">${view.brackets.map((b) => this.bracketBtn(b)).join('')}</div>`;
    const rank =
      `<div class="arena-rank"><span class="rating">${esc(formatNumber(view.standing.rating, { maximumFractionDigits: 0 }))}</span>` +
      `<span class="wl">${esc(
        t('hud.arena.ratingSummary', {
          wins: formatNumber(view.standing.wins, { maximumFractionDigits: 0 }),
          losses: formatNumber(view.standing.losses, { maximumFractionDigits: 0 }),
        }),
      )}</span></div>`;
    const practice = view.practice
      ? `<button class="btn fiesta-practice" data-act="practice">${esc(t('fiesta.practice'))}</button>` +
        `<div class="arena-note">${esc(t('fiesta.practiceNote'))}</div>`
      : '';
    const allTimeSection =
      view.allTime && view.allTime.length > 0
        ? `<div class="arena-sub">${esc(t('hud.arena.ladderAllTime'))}</div>${this.allTimeHtml(view.allTime)}`
        : '';
    return (
      title +
      this.seasonHtml(season) +
      bracketTabs +
      rank +
      this.partyHtml(view.party) +
      this.actionHtml(view.action, view.bracket, view.matchMap) +
      practice +
      `<div class="arena-sub">${esc(t('hud.arena.ladderOnline'))}</div>` +
      this.ladderHtml(view.ladder) +
      allTimeSection
    );
  }

  // ---- Season banner --------------------------------------------------------

  /** The banner: which season is live, its countdown and progress, the title on
   *  offer, and the settled champions below it. Rendered above the bracket tabs
   *  so the season frames the whole panel rather than trailing it. */
  private seasonHtml(season: ArenaSeasonView): string {
    const preseason = season.kind === 'preseason';
    const heading = preseason
      ? t('hudChrome.arenaSeason.preseasonHeading')
      : t('hudChrome.arenaSeason.heading', {
          season: formatNumber(season.season, { maximumFractionDigits: 0 }),
        });
    const keys = SEASON_COUNTDOWN_KEY[season.countdown.unit];
    // tPlural selects the CLDR category from the RAW count, then interpolates the
    // locale-formatted number over it: "Ends in 1 day" but "Ends in 165 days".
    const countdown = tPlural(preseason ? keys.opens : keys.ends, season.countdown.value, {
      count: formatNumber(season.countdown.value, { maximumFractionDigits: 0 }),
    });
    // Absent only once the calendar outruns the authored roster, which is the
    // maintainer's cue to extend src/sim/content/arena_seasons.ts.
    const titleRow = season.deedId
      ? `<div class="arena-season-title">${esc(
          t('hudChrome.arenaSeason.titleReward', { title: deedTitleText(season.deedId) }),
        )}</div>`
      : '';
    const pct = season.kind === 'live' ? Math.round(season.elapsedFrac * 100) : 0;
    const meter =
      season.kind === 'live'
        ? `<span class="arena-season-bar" role="img" aria-label="${esc(t('hudChrome.arenaSeason.progressLabel'))}">` +
          `<span class="arena-season-bar-fill" style="width:${pct}%"></span></span>`
        : '';
    return (
      `<div class="arena-season">` +
      `<div class="arena-season-head"><span class="arena-season-name">${esc(heading)}</span>` +
      `<span class="arena-season-clock">${esc(countdown)}</span></div>` +
      meter +
      titleRow +
      `<div class="arena-note">${esc(t('hudChrome.arenaSeason.note'))}</div>` +
      this.seasonHistoryHtml(season.history) +
      `</div>`
    );
  }

  private seasonHistoryHtml(history: ArenaSeasonHistoryRow[]): string {
    if (history.length === 0) return '';
    const rows = history
      .map(
        (row) =>
          `<div class="arena-season-past">` +
          `<div class="arena-season-past-head"><span>${esc(
            t('hudChrome.arenaSeason.seasonLabel', {
              season: formatNumber(row.season, { maximumFractionDigits: 0 }),
            }),
          )}</span><span class="arena-season-past-title">${esc(deedTitleText(row.deedId))}</span></div>` +
          row.champions.map((c) => this.seasonChampionHtml(c)).join('') +
          `</div>`,
      )
      .join('');
    return `<div class="arena-sub">${esc(t('hudChrome.arenaSeason.champions'))}</div>${rows}`;
  }

  private seasonChampionHtml(row: ArenaSeasonChampionRow): string {
    const names = row.names
      .map((name, i) => {
        const raw = row.classes[i] ?? '';
        const cls = row.knownClasses[i] ? classDisplayName(raw as PlayerClass) : raw;
        return `<span class="arena-season-champ" title="${esc(
          t('hud.arena.playerClassTitle', { name, className: cls }),
        )}">${esc(name)}</span>`;
      })
      .join('');
    return (
      `<div class="arena-season-champ-row"><span class="arena-season-bracket">${esc(row.bracket)}</span>` +
      `<span class="arena-season-champs">${names}</span>` +
      `<span class="lr-rating">${esc(formatNumber(row.rating, { maximumFractionDigits: 0 }))}</span></div>`
    );
  }

  private bracketBtn(b: ArenaBracketTab): string {
    const fiestaCls = b.fmt === 'fiesta' ? ' fiesta' : '';
    return `<button class="arena-bracket${fiestaCls}${b.active ? ' active' : ''}${b.locked ? ' locked' : ''}" data-bracket="${b.fmt}" aria-pressed="${b.active ? 'true' : 'false'}"${b.locked ? ' disabled' : ''}>${esc(this.bracketLabel(b.fmt))}</button>`;
  }

  private partyHtml(section: ArenaPartySection): string {
    if (section.kind === 'members') {
      const rows = section.members
        .map((m) => {
          const cls = m.knownClass ? classDisplayName(m.cls as PlayerClass) : m.cls;
          return (
            `<div class="arena-party-row${m.me ? ' me' : ''}"><span class="apr-name">${esc(m.name)}</span>` +
            `<span class="apr-meta">${esc(
              t('hud.arena.levelClass', {
                level: formatNumber(m.level, { maximumFractionDigits: 0 }),
                className: cls,
              }),
            )}</span></div>`
          );
        })
        .join('');
      return `<div class="arena-party">${rows}</div>`;
    }
    if (section.kind === 'warn') {
      return `<div class="arena-note arena-warn">${esc(t('hud.arena.queueNote'))}</div>`;
    }
    return '';
  }

  private actionHtml(
    action: ArenaAction,
    bracket: ArenaFormat,
    matchMap: ArenaMapId | null,
  ): string {
    if (action.kind === 'in-match') {
      // the bout's fixed map (slot-parity selected), shown from queue pop on
      const mapRow = matchMap
        ? `<div class="arena-note arena-map">${esc(
            t('hud.arena.mapName', { name: t(ARENA_MAP_KEY[matchMap]) }),
          )}</div>`
        : '';
      return `<div class="arena-queue-status">${svgIcon('arena')} ${esc(t('hud.arena.matchInProgress', { name: action.oppName }))}</div>${mapRow}`;
    }
    if (action.kind === 'queued') {
      return (
        `<button class="btn leave" data-act="leave">${esc(t('hud.arena.leaveQueue'))}</button>` +
        `<div class="arena-queue-status">${esc(t('hud.arena.searching', { count: formatNumber(action.queueSize, { maximumFractionDigits: 0 }) }))}</div>`
      );
    }
    const btnCls = action.queueDisabled ? 'btn disabled' : 'btn';
    const queueLabel =
      bracket === 'fiesta'
        ? t('fiesta.enterQueue')
        : bracket === 'yumi3' || bracket === 'yumi5'
          ? t('yumi.enterQueue')
          : t('hud.arena.enterQueue');
    return (
      `<button class="${btnCls}" data-act="queue"${action.queueDisabled ? ' disabled' : ''}>${esc(queueLabel)}</button>` +
      `<div class="arena-note">${esc(t('hud.arena.queueNote'))}</div>`
    );
  }

  private ladderHtml(rows: ArenaLadderRow[]): string {
    const html = rows
      .map((r) => {
        const cls = r.knownClass ? classDisplayName(r.cls as PlayerClass) : r.cls;
        return (
          `<div class="ladder-row${r.me ? ' me' : ''}"><span class="rank">${esc(formatNumber(r.rank, { maximumFractionDigits: 0 }))}</span>` +
          `<span class="lr-name" title="${esc(t('hud.arena.playerClassTitle', { name: r.name, className: cls }))}">${esc(r.name)}</span>` +
          `<span class="lr-rating">${esc(formatNumber(r.rating, { maximumFractionDigits: 0 }))}</span>` +
          `<span class="lr-wl">${esc(formatNumber(r.wins, { maximumFractionDigits: 0 }))}-${esc(formatNumber(r.losses, { maximumFractionDigits: 0 }))}</span></div>`
        );
      })
      .join('');
    return html || `<div class="ladder-empty">${esc(t('hud.arena.noChallengers'))}</div>`;
  }

  private allTimeHtml(rows: ArenaAllTimeRow[]): string {
    return rows
      .map((r) => {
        const cls = r.knownClass ? classDisplayName(r.cls as PlayerClass) : r.cls;
        return (
          `<div class="ladder-row${r.me ? ' me' : ''}"><span class="rank">${esc(formatNumber(r.rank, { maximumFractionDigits: 0 }))}</span>` +
          `<span class="lr-name" title="${esc(
            t('hud.arena.playerLevelClassTitle', {
              name: r.name,
              level: formatNumber(r.level, { maximumFractionDigits: 0 }),
              className: cls,
            }),
          )}">${esc(r.name)}</span>` +
          `<span class="lr-rating">${esc(formatNumber(r.rating, { maximumFractionDigits: 0 }))}</span>` +
          `<span class="lr-wl">${esc(formatNumber(r.wins, { maximumFractionDigits: 0 }))}-${esc(formatNumber(r.losses, { maximumFractionDigits: 0 }))}</span></div>`
        );
      })
      .join('');
  }

  private bracketLabel(fmt: ArenaFormat): string {
    if (fmt === 'fiesta') return t('fiesta.bracket');
    if (fmt === 'yumi3') return t('yumi.bracket3');
    if (fmt === 'yumi5') return t('yumi.bracket5');
    return fmt;
  }
}
