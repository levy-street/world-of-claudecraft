// Thin DOM painter for the Battlegrounds (Gravemarch) window.
//
// The consumer half of the pure-core + thin-painter split, cloned structurally
// from arena_window.ts: it paints #battleground-window from the structured
// BgWindowView (battleground_window_view.ts) and owns the window's view-state
// (the render-skip signature, the WCAG focus opener, the offline Practice
// hook). The pure core decides WHICH state the snapshot is in and WHAT each
// section shows; this module renders that and wires queue / watch / stop /
// practice / close dispatch back through IWorld + injected callbacks. It holds
// no Sim reference and reaches into Hud only through its deps.
//
// NOT a canvas window: the colors live in the extracted stylesheet (.bg-*
// classes in src/styles/components.css), so no getComputedStyle token
// resolution applies here. The window redraws while open from hud.update()'s
// mediumHud band, skipping the DOM rebuild when the content signature is
// unchanged.

import { audio } from '../game/audio';
import type { PlayerClass } from '../sim/types';
import type { IWorld } from '../world_api';
import { bgClockText, bgTeamName } from './battleground_format';
import {
  type BgAction,
  type BgLadderRow,
  type BgLiveRow,
  type BgWindowView,
  buildBgWindowView,
} from './battleground_window_view';
import { markDialogRoot } from './dialog_root';
import { classDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';

// Render-skip sentinel for the offline / not-yet-synced panel (same
// collision-proofing as ARENA_OFFLINE_SIG: the live sig is a JSON array string
// and always starts with '[', this token never does).
const BG_OFFLINE_SIG = 'bg-offline';

/**
 * Hud-supplied glue. The window renders entirely from IWorld + these
 * callbacks; it never reaches into Hud directly.
 */
export interface BattlegroundWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

export class BattlegroundWindow {
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;
  // Offline only: hook that starts a full vs-bots practice bout (null online).
  private practiceHook: (() => void) | null = null;

  constructor(private readonly deps: BattlegroundWindowDeps) {}

  /** Wire the offline Practice hook (left null online, which hides it). */
  setPracticeHook(fn: (() => void) | null): void {
    this.practiceHook = fn;
  }

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  /** Open if closed, close if open (keybind / minimap button / indicator). */
  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    const root = this.deps.root();
    // WCAG 2.2 AA: the dialog identity is a STATIC property of the stable root
    // node, so set it ONCE on open, never inside render() (the 250ms mediumHud
    // band repeats render() while open).
    markDialogRoot(root, { labelledBy: 'bg-title' });
    root.style.display = 'block';
    this.lastSig = '';
    this.render();
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

  // Re-localize the open window after an in-game language switch. The sig is
  // text-independent, so clearing it forces exactly one rebuild with fresh
  // t(). Self-gated on isOpen so the language fan-out calls it unconditionally.
  relocalize(): void {
    if (!this.isOpen) return;
    this.lastSig = '';
    this.render();
  }

  render(): void {
    const world = this.deps.world();
    const el = this.deps.root();
    const view = buildBgWindowView({
      info: world.bgInfo,
      playerId: world.playerId,
      party: world.partyInfo,
      practiceAvailable: this.practiceHook !== null,
    });

    if (view.kind === 'offline') {
      // Online mirror not yet synced: static note, built once per open.
      if (this.lastSig === BG_OFFLINE_SIG) return;
      this.lastSig = BG_OFFLINE_SIG;
      el.innerHTML = this.offlineHtml();
      el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
      return;
    }

    if (view.sig === this.lastSig) return;
    this.lastSig = view.sig;
    el.innerHTML = this.liveHtml(view);
    this.wire(el);
  }

  private wire(el: HTMLElement): void {
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    el.querySelector('[data-act="queue"]:not([disabled])')?.addEventListener('click', () => {
      this.deps.world().bgQueueJoin();
      audio.click();
    });
    el.querySelector('[data-act="leave"]')?.addEventListener('click', () => {
      this.deps.world().bgQueueLeave();
      audio.click();
    });
    el.querySelector('[data-act="stop-watching"]')?.addEventListener('click', () => {
      this.deps.world().bgSpectateLeave();
      audio.click();
    });
    el.querySelectorAll('[data-watch]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number((btn as HTMLElement).dataset.watch);
        if (Number.isFinite(id)) this.deps.world().bgSpectate(id);
        audio.click();
      });
    });
    el.querySelector('[data-act="practice"]')?.addEventListener('click', () => {
      this.practiceHook?.();
      this.lastSig = '';
      audio.click();
    });
  }

  // ---- HTML builders (the localized DOM the pure view-model drives) --------

  private titleHtml(): string {
    return (
      `<div class="panel-title"><span id="bg-title">${esc(t('hudChrome.bg.window.title'))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.bg.window.close'))}">${svgIcon('close')}</button></div>`
    );
  }

  private offlineHtml(): string {
    return `${this.titleHtml()}<div class="bg-note">${esc(t('hudChrome.bg.window.offlineNote'))}</div>`;
  }

  private liveHtml(view: Extract<BgWindowView, { kind: 'live' }>): string {
    const num = (n: number) => formatNumber(n, { maximumFractionDigits: 0 });
    const rank =
      `<div class="bg-rank"><span class="rating">${esc(num(view.standing.rating))}</span>` +
      `<span class="wl">${esc(
        t('hud.arena.ratingSummary', {
          wins: num(view.standing.wins),
          losses: num(view.standing.losses),
        }),
      )}</span></div>`;
    const stopWatching =
      view.spectating !== null
        ? `<button class="btn leave" data-act="stop-watching">${esc(t('hudChrome.bg.spectate.stop'))}</button>`
        : '';
    const practice = view.practice
      ? `<button class="btn bg-practice" data-act="practice">${esc(t('hudChrome.bg.window.practice'))}</button>` +
        `<div class="bg-note">${esc(t('hudChrome.bg.window.practiceNote'))}</div>`
      : '';
    return (
      this.titleHtml() +
      `<div class="bg-sub-title">${esc(t('hudChrome.bg.window.subtitle'))}</div>` +
      rank +
      this.actionHtml(view.action) +
      stopWatching +
      practice +
      `<div class="bg-sub">${esc(t('hudChrome.bg.window.liveHeading'))}</div>` +
      this.liveMatchesHtml(view.liveMatches) +
      `<div class="bg-sub">${esc(t('hud.arena.ladderOnline'))}</div>` +
      this.ladderHtml(view.ladder)
    );
  }

  private actionHtml(action: BgAction): string {
    const num = (n: number) => formatNumber(n, { maximumFractionDigits: 0 });
    if (action.kind === 'in-match') {
      return `<div class="bg-queue-status">${esc(t('hudChrome.bg.window.inMatch'))}</div>`;
    }
    if (action.kind === 'queued') {
      return (
        `<button class="btn leave" data-act="leave">${esc(t('hudChrome.bg.window.leaveQueue'))}</button>` +
        `<div class="bg-queue-status">${esc(
          t('hudChrome.bg.window.queued', {
            position: num(action.position),
            time: bgClockText(action.waitSec),
            count: num(action.queueSize),
          }),
        )}</div>`
      );
    }
    if (action.kind === 'deserter') {
      return `<div class="bg-note bg-warn">${esc(
        t('hudChrome.bg.window.deserter', { time: bgClockText(action.seconds) }),
      )}</div>`;
    }
    const btnCls = action.queueDisabled ? 'btn disabled' : 'btn';
    const partyNote =
      action.partySize > 1
        ? `<div class="bg-note">${esc(
            action.isLeader
              ? t('hudChrome.bg.window.partyNote', { count: num(action.partySize) })
              : t('hudChrome.bg.window.leaderNote'),
          )}</div>`
        : '';
    return (
      `<button class="${btnCls}" data-act="queue"${action.queueDisabled ? ' disabled' : ''}>${esc(t('hudChrome.bg.window.enterQueue'))}</button>` +
      partyNote +
      `<div class="bg-note">${esc(t('hudChrome.bg.window.queueNote'))}</div>`
    );
  }

  private liveMatchesHtml(rows: BgLiveRow[]): string {
    const num = (n: number) => formatNumber(n, { maximumFractionDigits: 0 });
    const html = rows
      .map((m) => {
        const line = t('hudChrome.bg.window.matchLine', {
          teamA: bgTeamName('A'),
          killsA: num(m.killsA),
          teamB: bgTeamName('B'),
          killsB: num(m.killsB),
          time: bgClockText(m.elapsed),
          players: num(m.players),
        });
        const control = m.watching
          ? `<button class="btn bg-watch" data-act="stop-watching">${esc(t('hudChrome.bg.spectate.stop'))}</button>`
          : m.canWatch
            ? `<button class="btn bg-watch" data-watch="${m.id}" aria-label="${esc(
                t('hudChrome.bg.window.watchAria', { time: bgClockText(m.elapsed) }),
              )}">${esc(t('hudChrome.bg.window.watch'))}</button>`
            : '';
        return `<div class="bg-live-row"><span class="bg-live-line">${esc(line)}</span>${control}</div>`;
      })
      .join('');
    return html || `<div class="ladder-empty">${esc(t('hudChrome.bg.window.noLive'))}</div>`;
  }

  private ladderHtml(rows: BgLadderRow[]): string {
    const num = (n: number) => formatNumber(n, { maximumFractionDigits: 0 });
    const html = rows
      .map((r) => {
        const cls = r.knownClass ? classDisplayName(r.cls as PlayerClass) : r.cls;
        return (
          `<div class="ladder-row${r.me ? ' me' : ''}"><span class="rank">${esc(num(r.rank))}</span>` +
          `<span class="lr-name" title="${esc(t('hud.arena.playerClassTitle', { name: r.name, className: cls }))}">${esc(r.name)}</span>` +
          `<span class="lr-rating">${esc(num(r.rating))}</span>` +
          `<span class="lr-wl">${esc(num(r.wins))}-${esc(num(r.losses))}</span></div>`
        );
      })
      .join('');
    return html || `<div class="ladder-empty">${esc(t('hud.arena.noChallengers'))}</div>`;
  }
}
