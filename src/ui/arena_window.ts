// Thin DOM painter for the merged PvP window: Thornhollow Fields (the primary tab)
// plus the two ranked arena brackets, one window on the classic G keybind.
//
// The consumer half of the pure-core + thin-painter split, driven by THREE
// pure cores: pvp_tabs_view.ts decides the tab strip (which tab is pinned by a
// live queue/match and which are locked), arena_window_view.ts models the
// arena panel, and hud/battleground/battleground_window_view.ts models the
// Thornhollow Fields panel. This module renders whichever panel the active tab selects
// and wires the tab / queue / leave / close dispatch back through IWorld +
// injected callbacks. It owns the window's view-state (active tab, the
// per-mode all-time-ladder caches + fetch throttles, the render-skip
// signature, the WCAG focus opener) and holds no Sim reference, reaching into
// Hud only through its deps.
//
// It is NOT a canvas window (the colors live in the extracted stylesheet, so no
// getComputedStyle token-resolution applies here); thresholds + cadences are named
// constants. The window redraws while open from hud.update()'s
// mediumHud band, skipping the DOM rebuild when the content signature is unchanged.

import { audio } from '../game/audio';
import type { ArenaMapId } from '../sim/dungeon_layout';
import { ARENA_MIN_LEVEL } from '../sim/social/arena';
import { BG_TEAM_SIZE } from '../sim/social/battleground';
import type { PlayerClass } from '../sim/types';
import type { ArenaFormat, IWorld } from '../world_api';
import {
  type ArenaAction,
  type ArenaAllTimeEntry,
  type ArenaAllTimeRow,
  type ArenaLadderRow,
  type ArenaPartySection,
  type ArenaView,
  buildArenaView,
} from './arena_window_view';
import { markDialogRoot } from './dialog_root';
import { classDisplayName } from './entity_i18n';
import { esc } from './esc';
import {
  type BgAllTimeEntry,
  type BgAllTimeRow,
  type BgLadderRow,
  type BgWindowAction,
  type BgWindowView,
  buildBgWindowView,
} from './hud/battleground';
import { formatNumber, t } from './i18n';
import { formatPvpRecord } from './pvp_record_core';
import { buildPvpTabs, type PvpTabId, type PvpTabsModel } from './pvp_tabs_view';
import { svgIcon } from './ui_icons';

// Best-effort all-time ladder pull is throttled per mode/bracket to this interval.
const LEADERBOARD_REFETCH_MS = 15000;

// Exhaustive by construction: adding a third ArenaMapId reds tsc here instead
// of silently rendering the wrong map name.
const ARENA_MAP_KEY: Record<ArenaMapId, 'hud.arena.map.coliseum' | 'hud.arena.map.drownedCourt'> = {
  coliseum: 'hud.arena.map.coliseum',
  drowned_court: 'hud.arena.map.drownedCourt',
};

// Render-skip sentinel for the offline panel: once-per-open (and once-per-tab-switch,
// since a tab click clears lastSig) guard so the static offline note is not rebuilt
// every ~250ms mediumHud tick. The live signature is always tab-prefixed
// JSON (`ravenrift|[...`), so this plain token can never equal a real sig: an
// offline->live transition rebuilds and a live->offline transition rebuilds once.
const ARENA_OFFLINE_SIG = 'arena-offline';

const num = (n: number): string => formatNumber(n, { maximumFractionDigits: 0 });

/**
 * Hud-supplied glue. The window renders entirely from IWorld + these
 * callbacks; it never reaches into Hud directly. closeOthers mirrors the inline
 * toggle's closeOtherWindows; captureFocus/restoreFocus add WCAG focus-return.
 */
export interface ArenaWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

export class ArenaWindow {
  /** The active tab; Thornhollow Fields is the window's primary tab. */
  private tab: PvpTabId = 'ravenrift';
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;
  // All-time ladders, fetched best-effort from the server (online only).
  private allTime: Partial<Record<ArenaFormat, ArenaAllTimeEntry[]>> = {};
  private lbFetchedAt: Partial<Record<ArenaFormat, number>> = {};
  private bgAllTime: BgAllTimeEntry[] | null = null;
  private bgLbFetchedAt = 0;

  constructor(private readonly deps: ArenaWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  /** Open if closed, close if open (the classic G keybind / minimap button). */
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
    this.fetchLeaderboardFor(this.tab);
    this.render();
    // Move keyboard focus into the freshly opened window (onto the close button),
    // matching the sibling cold windows, so a keyboard user is not left on the opener
    // while the focus trap is active.
    (root.querySelector('[data-close]') as HTMLElement | null)?.focus();
  }

  /** Open on (or switch to) a specific tab; a second call on that tab closes.
   *  The Thornhollow Fields deep entry (the shot harness, legacy callers) rides this. */
  openTab(tab: PvpTabId): void {
    if (!this.isOpen) {
      this.tab = tab;
      this.toggle();
      return;
    }
    if (this.tab !== tab) {
      this.tab = tab;
      this.lastSig = '';
      this.fetchLeaderboardFor(tab);
      this.render();
      this.focusActiveTab();
      return;
    }
    this.close();
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
  // signature is text-independent (the offline sentinel, or tab-prefixed JSON of
  // ids/numbers), so a language change never moves it on its own; clearing it forces
  // exactly one rebuild with fresh t(). Self-gated on isOpen so the language fan-out
  // can call it unconditionally.
  relocalize(): void {
    if (!this.isOpen) return;
    this.lastSig = '';
    this.render();
  }

  // Best-effort all-time ladder pulls. Throttled; silently no-op offline (no
  // server) so the panel still shows the live online ladder either way.
  private fetchLeaderboardFor(tab: PvpTabId): void {
    if (tab === 'ravenrift') this.fetchBgLeaderboard();
    else this.fetchArenaLeaderboard(tab);
  }

  private fetchArenaLeaderboard(format: ArenaFormat): void {
    const now = performance.now();
    if (now - (this.lbFetchedAt[format] ?? 0) < LEADERBOARD_REFETCH_MS) return;
    this.lbFetchedAt[format] = now;
    fetch(`/api/arena/leaderboard?format=${encodeURIComponent(format)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.leaders)) {
          this.allTime[format] = d.leaders;
          if (this.tab === format) this.lastSig = '';
        }
      })
      .catch(() => {
        /* offline or no server: live ladder only */
      });
  }

  private fetchBgLeaderboard(): void {
    const now = performance.now();
    if (now - this.bgLbFetchedAt < LEADERBOARD_REFETCH_MS) return;
    this.bgLbFetchedAt = now;
    fetch('/api/battleground/leaderboard')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.leaders)) {
          this.bgAllTime = d.leaders;
          if (this.tab === 'ravenrift') this.lastSig = '';
        }
      })
      .catch(() => {
        /* offline or no server: standing only */
      });
  }

  render(): void {
    const world = this.deps.world();
    const el = this.deps.root();
    // The dialog role / aria-modal / aria-labelledby / tabindex are set ONCE in toggle()
    // on open (the root is stable across renders), not here, so the 250ms mediumHud
    // re-render does not re-write them every tick.
    const strip = buildPvpTabs({
      selected: this.tab,
      bg: world.bgInfo,
      arena: world.arenaInfo,
    });
    if (strip.commit) this.tab = strip.active;

    if (this.tab === 'ravenrift') {
      this.renderThornhollowFields(el, world, strip);
      return;
    }
    this.renderArena(el, world, strip, this.tab);
  }

  private renderThornhollowFields(el: HTMLElement, world: IWorld, strip: PvpTabsModel): void {
    const view = buildBgWindowView({
      info: world.bgInfo,
      playerName: world.player.name,
      playerLevel: world.player.level,
      party: world.partyInfo,
      playerId: world.playerId,
      allTime: this.bgAllTime,
    });
    if (view.kind === 'offline') {
      if (this.lastSig === ARENA_OFFLINE_SIG) return;
      this.lastSig = ARENA_OFFLINE_SIG;
      el.innerHTML =
        this.bgTitleHtml() +
        this.stripHtml(strip) +
        `<div class="bg-note">${esc(t('hudChrome.bg.offlineNote'))}</div>`;
      this.wireChrome(el);
      return;
    }
    this.fetchBgLeaderboard();
    // Named apart from the arena arm's own signature on purpose: the two tab arms
    // guard the same `lastSig` field with the same shape, and a pin that cannot
    // tell them apart cannot prove either one still exists.
    const ravenriftSig = `ravenrift|${strip.tabs.map((tab) => (tab.locked ? 1 : 0)).join('')}|${view.sig}`;
    if (ravenriftSig === this.lastSig) return;
    this.lastSig = ravenriftSig;
    el.innerHTML = this.bgTitleHtml() + this.stripHtml(strip) + this.bgBodyHtml(view);
    this.wireChrome(el);
    el.querySelector('[data-act="queue"]')?.addEventListener('click', () => {
      this.deps.world().bgQueueJoin();
      audio.click();
    });
    el.querySelector('[data-act="leave"]')?.addEventListener('click', () => {
      this.deps.world().bgQueueLeave();
      audio.click();
    });
  }

  private renderArena(el: HTMLElement, world: IWorld, strip: PvpTabsModel, tab: ArenaFormat): void {
    const view = buildArenaView({
      info: world.arenaInfo,
      selectedBracket: tab,
      playerId: world.playerId,
      playerName: world.player.name,
      party: world.partyInfo,
      allTime: this.allTime,
      playerLevel: world.player.level,
    });

    if (view.kind === 'offline') {
      // offline / not yet synced: ranked play is an online feature. The static note is
      // built once per open (skip-guarded by the offline sentinel) instead of every
      // ~250ms mediumHud tick.
      if (this.lastSig === ARENA_OFFLINE_SIG) return;
      this.lastSig = ARENA_OFFLINE_SIG;
      el.innerHTML =
        this.arenaTitleHtml(null) +
        this.stripHtml(strip) +
        `<div class="arena-note">${esc(t('hud.arena.offlineNote'))}</div>`;
      this.wireChrome(el);
      return;
    }

    this.fetchArenaLeaderboard(view.bracket);
    const sig = `${tab}|${strip.tabs.map((s2) => (s2.locked ? 1 : 0)).join('')}|${view.sig}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    el.innerHTML =
      this.arenaTitleHtml(view.bracket) + this.stripHtml(strip) + this.arenaBodyHtml(view);
    this.wireChrome(el);
    el.querySelector('[data-act="queue"]:not([disabled])')?.addEventListener('click', () => {
      this.deps.world().arenaQueueJoin(view.bracket);
      audio.click();
    });
    el.querySelector('[data-act="leave"]')?.addEventListener('click', () => {
      this.deps.world().arenaQueueLeave();
      audio.click();
    });
  }

  /** After a strip-click rebuild, keyboard focus follows the active tab. */
  private focusActiveTab(): void {
    const el = this.deps.root();
    (el.querySelector(`[data-bracket="${this.tab}"]`) as HTMLElement | null)?.focus();
  }

  /** Close + tab-strip wiring shared by every panel state. */
  private wireChrome(el: HTMLElement): void {
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    el.querySelectorAll('[data-bracket]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.getAttribute('aria-disabled') === 'true') return;
        this.tab = (btn as HTMLElement).dataset.bracket as PvpTabId;
        this.lastSig = '';
        this.fetchLeaderboardFor(this.tab);
        this.render();
        this.focusActiveTab();
        audio.click();
      });
    });
  }

  // ---- HTML builders (the localized DOM the pure view-models drive) ----------

  private arenaTitleHtml(bracket: ArenaFormat | null): string {
    const tag = bracket
      ? ` <span class="arena-bracket-tag">${esc(this.tabLabel(bracket))}</span>`
      : '';
    return `<div class="panel-title"><span id="arena-title">${esc(t('hud.arena.title'))}${tag}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.arena.close'))}">${svgIcon('close')}</button></div>`;
  }

  private bgTitleHtml(): string {
    return `<div class="panel-title"><span id="arena-title">${esc(t('hudChrome.bg.title'))} <span class="bg-mode-tag">${esc(t('hudChrome.bg.modeTag'))}</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('hud.arena.close'))}">${svgIcon('close')}</button></div>`;
  }

  private stripHtml(strip: PvpTabsModel): string {
    // Locked tabs carry aria-disabled (still perceivable and announced) rather
    // than disabled (which would drop them from the accessibility tree).
    const btn = (tab: { id: PvpTabId; active: boolean; locked: boolean }): string =>
      `<button class="arena-bracket${tab.active ? ' active' : ''}${tab.locked ? ' locked' : ''}" data-bracket="${tab.id}" aria-pressed="${tab.active ? 'true' : 'false'}"${tab.locked ? ' aria-disabled="true"' : ''}>${esc(this.tabLabel(tab.id))}</button>`;
    return `<div class="arena-brackets">${strip.tabs.map(btn).join('')}</div>`;
  }

  private bgBodyHtml(view: Extract<BgWindowView, { kind: 'live' }>): string {
    const blurb = `<div class="bg-blurb">${esc(t('hudChrome.bg.blurb'))}</div>`;
    const rank =
      `<div class="bg-rank"><span class="rating">${esc(num(view.rating))}</span>` +
      `<span class="wl">${esc(
        t('hudChrome.bg.ratingSummary', {
          wins: num(view.wins),
          losses: num(view.losses),
          draws: num(view.draws),
        }),
      )}</span></div>` +
      `<div class="bg-captures">${esc(t('hudChrome.bg.careerCaptures', { count: num(view.captures) }))}</div>`;
    // The LIVE online ladder sits above the all-time board, the same order the
    // arena tabs use (arenaBodyHtml below): who is here now, then the record.
    const onlineSection =
      `<div class="bg-sub">${esc(t('hudChrome.bg.ladderOnline'))}</div>` +
      this.bgOnlineLadderHtml(view.ladder);
    const allTimeSection =
      view.allTime && view.allTime.length > 0
        ? `<div class="bg-sub">${esc(t('hudChrome.bg.ladderAllTime'))}</div>${this.bgLadderHtml(view.allTime)}`
        : `<div class="bg-sub">${esc(t('hudChrome.bg.ladderAllTime'))}</div><div class="ladder-empty">${esc(t('hudChrome.bg.noRanked'))}</div>`;
    return (
      blurb +
      rank +
      this.bgFirstWinChipHtml(view.firstWinBonus) +
      this.bgActionHtml(view.action) +
      onlineSection +
      allTimeSection
    );
  }

  /** The available-bonus chip, immediately above the queue affordance so the
   *  invitation and the button that acts on it read as one thing. Absent once
   *  today's win has claimed it (the pure view decides, never this painter).
   *
   *  Everything it has to say is VISIBLE: no `title` tooltip, which on a
   *  non-focusable div is unreachable by keyboard, unreliably announced, and
   *  simply absent on touch (and this panel ships to phones). The glyph is
   *  decoration beside real text, so it is aria-hidden rather than named. */
  private bgFirstWinChipHtml(bonus: { honor: number } | null): string {
    if (!bonus) return '';
    const label = t('hudChrome.bg.firstWinBonusLine', { honor: num(bonus.honor) });
    return (
      `<div class="bg-firstwin-chip"><span aria-hidden="true">${svgIcon('battleground')}</span>` +
      `<span>${esc(label)}</span></div>`
    );
  }

  private bgActionHtml(action: BgWindowAction): string {
    if (action.kind === 'in-match') {
      return `<div class="bg-queue-status">${svgIcon('battleground')} ${esc(
        t('hudChrome.bg.matchInProgress', {
          crimson: num(action.scoreCrimson),
          azure: num(action.scoreAzure),
        }),
      )}</div>`;
    }
    if (action.kind === 'queued') {
      const partyNote =
        action.queuedParty > 1
          ? ` ${esc(t('hudChrome.bg.queuedParty', { count: num(action.queuedParty) }))}`
          : '';
      return (
        `<button class="btn leave" data-act="leave">${esc(t('hudChrome.bg.leaveQueue'))}</button>` +
        `<div class="bg-queue-status">${esc(
          t('hudChrome.bg.searching', {
            count: num(action.queueSize),
            size: num(BG_TEAM_SIZE * 2),
          }),
        )}${partyNote}</div>`
      );
    }
    const label =
      action.partySize > 1
        ? t('hudChrome.bg.enterQueueParty', { count: num(action.partySize) })
        : t('hudChrome.bg.enterQueue');
    // The queue floor: under-leveled champions see the requirement and a
    // disabled button (the sim refuses server-side regardless).
    if (action.locked) {
      return (
        `<button class="btn" data-act="queue" disabled aria-disabled="true">${esc(label)}</button>` +
        `<div class="bg-note bg-level-req">${esc(
          t('hudChrome.bg.levelRequirement', { level: num(action.requiredLevel) }),
        )}</div>`
      );
    }
    // Leader-only group queue: a member sees the same button, inert (the sim
    // refuses it server-side regardless, with the leader-only error).
    return (
      `<button class="btn${action.queueDisabled ? ' disabled' : ''}" data-act="queue"${
        action.queueDisabled ? ' disabled aria-disabled="true"' : ''
      }>${esc(label)}</button>` +
      `<div class="bg-note">${esc(t('hudChrome.bg.queueNote'))}</div>` +
      `<div class="bg-note bg-level-req">${esc(
        t('hudChrome.bg.levelRequirement', { level: num(action.requiredLevel) }),
      )}</div>`
    );
  }

  /** The LIVE online ladder rows (the arena's ladderHtml twin: same
   *  ladder-row/rank markup family, no level in the row title). */
  private bgOnlineLadderHtml(rows: BgLadderRow[]): string {
    const html = rows
      .map((r) => {
        const cls = r.knownClass ? classDisplayName(r.cls as PlayerClass) : r.cls;
        return (
          `<div class="ladder-row${r.me ? ' me' : ''}"><span class="rank">${esc(num(r.rank))}</span>` +
          `<span class="lr-name" title="${esc(
            t('hudChrome.bg.playerClassTitle', { name: r.name, className: cls }),
          )}">${esc(r.name)}</span>` +
          `<span class="lr-rating">${esc(num(r.rating))}</span>` +
          `<span class="lr-wl">${esc(formatPvpRecord(r))}</span></div>`
        );
      })
      .join('');
    return html || `<div class="ladder-empty">${esc(t('hudChrome.bg.noChallengers'))}</div>`;
  }

  private bgLadderHtml(rows: BgAllTimeRow[]): string {
    return rows
      .map((r) => {
        const cls = r.knownClass ? classDisplayName(r.cls as PlayerClass) : r.cls;
        return (
          `<div class="ladder-row${r.me ? ' me' : ''}"><span class="rank">${esc(num(r.rank))}</span>` +
          `<span class="lr-name" title="${esc(
            t('hudChrome.bg.playerLevelClassTitle', {
              name: r.name,
              level: num(r.level),
              className: cls,
            }),
          )}">${esc(r.name)}</span>` +
          `<span class="lr-rating">${esc(num(r.rating))}</span>` +
          `<span class="lr-wl">${esc(formatPvpRecord(r))}</span></div>`
        );
      })
      .join('');
  }

  private arenaBodyHtml(view: Extract<ArenaView, { kind: 'live' }>): string {
    const rank =
      `<div class="arena-rank"><span class="rating">${esc(num(view.standing.rating))}</span>` +
      `<span class="wl">${esc(
        t('hud.arena.ratingSummary', {
          wins: num(view.standing.wins),
          losses: num(view.standing.losses),
          draws: num(view.standing.draws),
        }),
      )}</span></div>`;
    const allTimeSection =
      view.allTime && view.allTime.length > 0
        ? `<div class="arena-sub">${esc(t('hud.arena.ladderAllTime'))}</div>${this.allTimeHtml(view.allTime)}`
        : '';
    return (
      rank +
      this.partyHtml(view.party) +
      this.actionHtml(view.action, view.matchMap) +
      `<div class="arena-sub">${esc(t('hud.arena.ladderOnline'))}</div>` +
      this.ladderHtml(view.ladder) +
      allTimeSection
    );
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
                level: num(m.level),
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

  private actionHtml(action: ArenaAction, matchMap: ArenaMapId | null): string {
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
        `<div class="arena-queue-status">${esc(t('hud.arena.searching', { count: num(action.queueSize) }))}</div>`
      );
    }
    const btnCls = action.queueDisabled ? 'btn disabled' : 'btn';
    const note = action.belowMinLevel
      ? t('hudChrome.arenaGate.minLevelNote', {
          level: formatNumber(ARENA_MIN_LEVEL, { maximumFractionDigits: 0 }),
        })
      : t('hud.arena.queueNote');
    return (
      `<button class="${btnCls}" data-act="queue"${action.queueDisabled ? ' disabled' : ''}>${esc(t('hud.arena.enterQueue'))}</button>` +
      `<div class="arena-note">${esc(note)}</div>`
    );
  }

  private ladderHtml(rows: ArenaLadderRow[]): string {
    const html = rows
      .map((r) => {
        const cls = r.knownClass ? classDisplayName(r.cls as PlayerClass) : r.cls;
        return (
          `<div class="ladder-row${r.me ? ' me' : ''}"><span class="rank">${esc(num(r.rank))}</span>` +
          `<span class="lr-name" title="${esc(t('hud.arena.playerClassTitle', { name: r.name, className: cls }))}">${esc(r.name)}</span>` +
          `<span class="lr-rating">${esc(num(r.rating))}</span>` +
          `<span class="lr-wl">${esc(formatPvpRecord(r))}</span></div>`
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
          `<div class="ladder-row${r.me ? ' me' : ''}"><span class="rank">${esc(num(r.rank))}</span>` +
          `<span class="lr-name" title="${esc(
            t('hud.arena.playerLevelClassTitle', {
              name: r.name,
              level: num(r.level),
              className: cls,
            }),
          )}">${esc(r.name)}</span>` +
          `<span class="lr-rating">${esc(num(r.rating))}</span>` +
          `<span class="lr-wl">${esc(formatPvpRecord(r))}</span></div>`
        );
      })
      .join('');
  }

  private tabLabel(tab: PvpTabId | ArenaFormat): string {
    if (tab === 'ravenrift') return t('hudChrome.bg.title');
    if (tab === '1v1') return t('hudChrome.pvp.bracket1v1');
    if (tab === '2v2') return t('hudChrome.pvp.bracket2v2');
    // Retired brackets stay renderable (a dev-started bout commits them into
    // the title tag), so their labels stay localized, never a raw id.
    if (tab === 'fiesta') return t('fiesta.bracket');
    if (tab === 'yumi3') return t('yumi.bracket3');
    return t('yumi.bracket5');
  }
}
