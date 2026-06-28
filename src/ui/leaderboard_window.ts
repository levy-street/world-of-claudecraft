// Thin DOM painter for the lifetime-XP leaderboard window.
//
// The consumer half of the pure-core + thin-painter split: it paints
// #leaderboard-window from the structured LeaderboardView (leaderboard_view.ts) and
// owns the window's view-state (the current page index, the WCAG focus opener) plus
// the ASYNC side it carries: it consumes IWorld.leaderboard(page, size):
// Promise<LeaderboardPage> exactly as V16 already exposes it (the one
// consumed-new signature; consumed, never changed). The pure core decides WHICH
// state a resolved page (or an explicit loading / error discriminator) is in and
// WHAT each row shows; this module owns the Promise, the await, the page controls,
// and the failure handling, and renders the result. It holds no Sim reference and
// reaches into Hud only through its deps.
//
// It is NOT a canvas window (the colors live in the extracted stylesheet, so no
// getComputedStyle token-resolution applies); the page size is the shared
// LEADERBOARD_PAGE_SIZE named constant (no magic values). The
// leaderboard is purely cold: it paints on open and on a page change, never from
// hud.update()'s per-frame path.

import { LEADERBOARD_PAGE_SIZE } from '../sim/leaderboard_page';
import type { IWorld, LeaderboardPage } from '../world_api';
import { markDialogRoot } from './dialog_root';
import { classDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import {
  buildLeaderboardView,
  type LeaderboardPager,
  type LeaderboardRow,
  type LeaderboardStanding,
} from './leaderboard_view';
import { svgIcon } from './ui_icons';
import { formatXp } from './xp_bar';

/**
 * Hud-supplied glue. The leaderboard window renders entirely from IWorld + these
 * callbacks; it never reaches into Hud directly. captureFocus/restoreFocus add the
 * WCAG focus-return that the inline site lacked.
 */
export interface LeaderboardWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

/** Where focus should land after a (re)render: into the window on open, or back
 *  onto the page control the keyboard user just activated. */
type FocusTarget = 'open' | 'prev' | 'next' | null;

export class LeaderboardWindow {
  // The current page index. The server clamps the requested page; render() mirrors
  // its answer back here so the pager state never drifts past the real last page.
  private page = 0;
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: LeaderboardWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  /** Open if closed, close if open (the minimap / menu leaderboard button). */
  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    // Capture the opener BEFORE closing other windows, so a sibling window's own
    // focus-return on close cannot clobber the element we restore to (WCAG).
    this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    this.page = 0;
    this.deps.root().style.display = 'block';
    void this.render('open');
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

  // Owns the Promise + await + page controls (the core is async-free). Paints the
  // title + loading shell, awaits the paged leaderboard(), then renders the
  // resolved page (or the empty / error state). A rejection or offline-unavailable
  // leaderboard() maps to the error state (a localized retry message), instead of
  // silently masquerading as an empty board.
  async render(focus: FocusTarget = null): Promise<void> {
    const el = this.deps.root();
    const world = this.deps.world();
    markDialogRoot(el, { labelledBy: 'leaderboard-title' });
    el.innerHTML = this.titleHtml(world.realm) + this.loadingBodyHtml();
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    if (focus === 'open') (el.querySelector('[data-close]') as HTMLElement | null)?.focus();

    let result: LeaderboardPage | null = null;
    try {
      result = await world.leaderboard(this.page, LEADERBOARD_PAGE_SIZE);
    } catch {
      result = null;
    }
    // The panel may have been closed while the fetch was in flight.
    if (el.style.display !== 'block') return;
    const body = el.querySelector('.lb-body');
    if (!body) return;

    const view = buildLeaderboardView(
      result === null
        ? { kind: 'error' }
        : {
            kind: 'page',
            page: result,
            viewer: {
              name: world.player.name,
              level: world.player.level,
              lifetimeXp: world.lifetimeXp,
            },
          },
    );

    if (view.kind === 'error') {
      body.innerHTML = `<div class="lb-empty lb-error" role="alert">${esc(t('game.leaderboard.retry'))}</div>`;
      this.focusCloseAfterPage(focus);
      return;
    }
    if (view.kind === 'empty') {
      body.innerHTML = `<div class="lb-empty">${esc(t('game.leaderboard.empty'))}</div>`;
      this.focusCloseAfterPage(focus);
      return;
    }
    // 'loading' is painted before the await (loadingBodyHtml), never returned here.
    if (view.kind !== 'ranked') return;
    // Mirror the server's clamped page back into the pager state.
    this.page = view.page;
    body.innerHTML =
      this.headerHtml() +
      view.rows.map((r) => this.rowHtml(r)).join('') +
      this.stickyHtml(view.standing) +
      this.pagerHtml(view.pager);
    this.wirePager(body as HTMLElement, focus);
  }

  // ---- HTML builders (the localized DOM the pure view-model drives) ----------

  private titleHtml(realm: string): string {
    const realmTag = realm ? ` &middot; ${esc(realm)}` : '';
    return (
      `<div class="panel-title"><span id="leaderboard-title">${esc(t('game.leaderboard.title'))} ` +
      `<span class="lb-subtitle">${esc(t('game.leaderboard.subtitle'))}${realmTag}</span></span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.leaderboard.close'))}">${svgIcon('close')}</button></div>`
    );
  }

  // The in-flight state carries aria-busy + role=status (the lazy-load a11y
  // contract) so a screen reader announces the pending board.
  private loadingBodyHtml(): string {
    return `<div class="lb-body"><div class="lb-loading" role="status" aria-busy="true">${esc(t('game.leaderboard.loading'))}</div></div>`;
  }

  private headerHtml(): string {
    return (
      `<div class="lb-row lb-head"><span class="lb-rank">${esc(t('game.leaderboard.rank'))}</span>` +
      `<span class="lb-name">${esc(t('game.leaderboard.name'))}</span>` +
      `<span class="lb-lvl">${esc(t('game.leaderboard.level'))}</span>` +
      `<span class="lb-vlvl">${esc(t('game.leaderboard.vlevel'))}</span>` +
      `<span class="lb-xp">${esc(t('game.leaderboard.lifetimeXp'))}</span></div>`
    );
  }

  private rowHtml(r: LeaderboardRow): string {
    // &starf; renders the prestige star without a literal symbol glyph in source.
    const star =
      r.prestigeRank > 0
        ? `<span class="lb-prestige" title="${esc(`${t('game.prestige.rank')} ${r.prestigeRank}`)}">&starf;${r.prestigeRank}</span> `
        : '';
    const title = r.knownClass ? ` title="${esc(classDisplayName(r.cls))}"` : '';
    const you = r.me ? ` <span class="lb-you">(${esc(t('game.leaderboard.you'))})</span>` : '';
    return (
      `<div class="lb-row${r.me ? ' lb-mine' : ''}"><span class="lb-rank">${r.rank}</span>` +
      `<span class="lb-name"${title}>${star}${esc(r.name)}${you}</span>` +
      `<span class="lb-lvl">${r.level}</span><span class="lb-vlvl">${r.virtualLevel}</span>` +
      `<span class="lb-xp">${formatXp(r.lifetimeXp)}</span></div>`
    );
  }

  // The sticky "your standing" row, shown when the viewer is off the visible page.
  // &mdash; is the unranked-rank placeholder, kept as an entity so the source
  // carries no literal em dash (project style rule).
  private stickyHtml(standing: LeaderboardStanding | null): string {
    if (!standing) return '';
    return (
      `<div class="lb-sticky"><div class="lb-row lb-mine"><span class="lb-rank">&mdash;</span>` +
      `<span class="lb-name">${esc(standing.name)} <span class="lb-you">(${esc(t('game.leaderboard.you'))})</span></span>` +
      `<span class="lb-lvl">${standing.level}</span><span class="lb-vlvl">${standing.virtualLevel}</span>` +
      `<span class="lb-xp">${formatXp(standing.lifetimeXp)}</span></div></div>`
    );
  }

  // Prev/Next pager, mirroring the World Market browse pager (it reuses the same
  // generic, fully-localized page strings). Empty when the board fits on one page.
  private pagerHtml(pager: LeaderboardPager | null): string {
    if (!pager) return '';
    const current = formatNumber(pager.page + 1, { maximumFractionDigits: 0 });
    const total = formatNumber(pager.pageCount, { maximumFractionDigits: 0 });
    const status = t('itemUi.market.pageStatus', { current, total });
    return (
      `<div class="lb-pager">` +
      `<button type="button" class="lb-page-btn" data-leaderboard-page="prev"${pager.prevDisabled ? ' disabled' : ''}>${esc(t('itemUi.market.pagePrev'))}</button>` +
      `<span class="lb-page-status">${esc(status)}</span>` +
      `<button type="button" class="lb-page-btn" data-leaderboard-page="next"${pager.nextDisabled ? ' disabled' : ''}>${esc(t('itemUi.market.pageNext'))}</button>` +
      `</div>`
    );
  }

  private wirePager(body: HTMLElement, focus: FocusTarget): void {
    body.querySelectorAll<HTMLButtonElement>('[data-leaderboard-page]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        const forward = button.dataset.leaderboardPage === 'next';
        this.page += forward ? 1 : -1;
        if (this.page < 0) this.page = 0;
        void this.render(forward ? 'next' : 'prev');
      });
    });
    // Keyboard focus-return after an async page change: land on the control just
    // activated when it survives (still enabled), else the close button, so the
    // keyboard user is never dumped back to <body>.
    if (focus === 'prev' || focus === 'next') {
      const wanted = body.querySelector<HTMLButtonElement>(`[data-leaderboard-page="${focus}"]`);
      if (wanted && !wanted.disabled) wanted.focus();
      else this.focusCloseAfterPage(focus);
    }
  }

  // After an async page-change swap that has no pager (the error / empty / single-page
  // states), keep keyboard focus inside the window by landing it on the close button
  // rather than letting it fall to <body> (WCAG 2.4.3).
  private focusCloseAfterPage(focus: FocusTarget): void {
    if (focus !== 'prev' && focus !== 'next') return;
    (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
  }
}
