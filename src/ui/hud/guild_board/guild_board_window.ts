// The Guild Signpost window: the in-world guild board every town noticeboard
// opens (docs/prd/guild-pledge-board.md, moved off the leaderboard's guilds
// tab by owner decision: the signpost IS the guild leaderboard). Two views in
// one window: the ranked board (guilds by summed lifetime XP, each row
// carrying the recruiting status, the Guild Master's note, and the viewer's
// pledge affordance) and a per-guild roster drill-in (the Guild Master, then
// officers, then members, each rank tier ranked by lifetime XP). The pure
// cores are guild_leaderboard_view.ts (shared with nothing else now: the
// leaderboard's guilds tab renders the plain ranking) and
// guild_roster_view.ts; this module is the thin async painter, the
// leaderboard-window family's shape (renderSeq staleness, markDialogRoot,
// focus discipline, inline display:flex open).

import { CLASSES } from '../../../sim/data';
import type { PlayerClass } from '../../../sim/types';
import type { GuildLeaderboardPage, IWorld } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { classDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import {
  buildGuildLeaderboardView,
  type GuildBoardViewer,
  type GuildLeaderboardRow,
} from '../../guild_leaderboard_view';
import { formatNumber, t } from '../../i18n';
import type { LeaderboardPager } from '../../leaderboard_view';
import { svgIcon } from '../../ui_icons';
import { formatXp } from '../../xp_bar';
import { buildGuildRosterView, type GuildRosterRow } from './guild_roster_view';

export interface GuildBoardWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  onVisibilityChange?(): void;
  /** Cosmetic soft-profanity mask for the Guild Master's board note (the Hud
   *  wires its maskChat so the player's filter setting applies). Required on
   *  purpose: the construction site decides. */
  maskPlayerText(text: string): string;
}

const PAGE_SIZE = 20;

/** CSS.escape for the attribute selector the back-out focus uses (guild names
 *  are player-authored; a quote or bracket must not break the query). */
function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape
    ? CSS.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

type Focus = 'open' | 'action' | 'prev' | 'next' | 'view' | 'back' | null;

export class GuildBoardWindow {
  /** null = the ranked board; a name = that guild's roster drill-in. */
  private rosterOf: string | null = null;
  /** The guild whose roster was just left: the back-out focus target, so a
   *  keyboard user paging deep into the board never loses their row. */
  private returnTo: string | null = null;
  private page = 0;
  private renderSeq = 0;
  private openerFocus: HTMLElement | null = null;
  // A pledge click this open outranks the mirror's myPledge because it is
  // newer: the confirming social frame lands a beat later. Cleared on open,
  // the leaderboard-era latch carried over unchanged.
  private pledgeSentTo: string | null = null;

  constructor(private readonly deps: GuildBoardWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'flex';
  }

  /** Open at the ranked board (the signpost interaction lands here). */
  open(): void {
    if (this.isOpen) {
      // Re-reading the board mid-open refreshes it rather than closing: the
      // player is standing at a physical signpost, not toggling a menu.
      this.rosterOf = null;
      void this.render('open');
      return;
    }
    this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    this.rosterOf = null;
    this.page = 0;
    this.pledgeSentTo = null;
    this.deps.root().style.display = 'flex';
    this.deps.onVisibilityChange?.();
    void this.render('open');
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  close(): void {
    const el = this.deps.root();
    if (el.style.display !== 'flex') {
      this.openerFocus = null;
      return;
    }
    el.style.display = 'none';
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
    this.deps.onVisibilityChange?.();
  }

  /** Re-localize after an in-game language switch (the Hud fan-out). */
  relocalize(): void {
    if (this.isOpen) void this.render(null);
  }

  async render(focus: Focus = null): Promise<void> {
    const seq = ++this.renderSeq;
    const el = this.deps.root();
    const world = this.deps.world();
    markDialogRoot(el, { labelledBy: 'guild-board-title' });
    el.innerHTML = this.titleHtml(world.realm) + this.loadingBodyHtml();
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    if (focus === 'open') (el.querySelector('[data-close]') as HTMLElement | null)?.focus();
    if (this.rosterOf !== null) {
      await this.renderRoster(el, world, this.rosterOf, focus, seq);
      return;
    }
    await this.renderBoard(el, world, focus, seq);
  }

  // ---------------------------------------------------------------------
  // The ranked board (the leaderboard guilds tab's render, moved here whole).
  // ---------------------------------------------------------------------

  private async renderBoard(
    el: HTMLElement,
    world: IWorld,
    focus: Focus,
    seq: number,
  ): Promise<void> {
    let result: GuildLeaderboardPage | null = null;
    try {
      result = await world.guildLeaderboard(this.page, PAGE_SIZE);
    } catch {
      result = null;
    }
    if (seq !== this.renderSeq || el.style.display !== 'flex') return;
    const body = el.querySelector('.gb-body');
    if (!body) return;

    const social = world.socialInfo;
    const viewer: GuildBoardViewer | null = social
      ? {
          guildName: social.guild?.name ?? null,
          level: world.player.level,
          pledgedTo: this.pledgeSentTo ?? social.myPledge?.guildName ?? null,
        }
      : null;
    const view = buildGuildLeaderboardView(
      result === null ? { kind: 'error' } : { kind: 'page', page: result, viewer },
    );
    if (view.kind === 'error') {
      body.innerHTML = `<div class="lb-empty lb-error" role="alert">${esc(t('game.leaderboard.retry'))}</div>`;
      if (focus !== null && focus !== 'open') this.focusClose(el);
      return;
    }
    if (view.kind === 'empty') {
      // The offline sandbox and a fresh realm both land here: the signpost
      // honestly has nothing posted.
      body.innerHTML = `<div class="lb-empty">${esc(t('hudChrome.noticeboard.empty'))}</div>`;
      if (focus !== null && focus !== 'open') this.focusClose(el);
      return;
    }
    if (view.kind !== 'ranked') return;
    this.page = view.page;
    body.innerHTML =
      this.boardHeaderHtml() +
      view.rows.map((r) => this.boardRowHtml(r)).join('') +
      this.pagerHtml(view.pager);
    this.wirePager(body as HTMLElement, focus);
    this.wirePledgeButtons(body as HTMLElement);
    this.wireRosterLinks(body as HTMLElement);
    if (focus === 'view')
      (body.querySelector('[data-guild-roster]') as HTMLElement | null)?.focus();
    if (focus === 'back') {
      // Land on the roster link of the guild just left, not row one.
      const wanted = this.returnTo
        ? body.querySelector<HTMLElement>(`[data-guild-roster="${cssEscape(this.returnTo)}"]`)
        : null;
      (wanted ?? (body.querySelector('[data-guild-roster]') as HTMLElement | null))?.focus();
      this.returnTo = null;
    }
    // A pledge click destroyed the button it re-rendered as a chip; keep
    // keyboard focus inside the window on the close button (WCAG 2.4.3).
    if (focus === 'action') this.focusClose(el);
  }

  private focusClose(el: HTMLElement): void {
    (el.querySelector('[data-close]') as HTMLElement | null)?.focus();
  }

  private boardHeaderHtml(): string {
    return (
      `<div class="lb-row lb-row-guild lb-head"><span class="lb-rank">${esc(t('game.leaderboard.rank'))}</span>` +
      `<span class="lb-name">${esc(t('hudChrome.leaderboard.guildName'))}</span>` +
      `<span class="lb-members">${esc(t('hudChrome.leaderboard.members'))}</span>` +
      `<span class="lb-vlvl">${esc(t('hudChrome.leaderboard.topLevel'))}</span>` +
      `<span class="lb-xp">${esc(t('hudChrome.leaderboard.guildXp'))}</span></div>`
    );
  }

  // One board entry: the ranked grid row (the guild name is the roster
  // drill-in link), then the recruiting sub-line: status, the level floor
  // when one is set, the Guild Master's note (escaped, soft-masked), and the
  // viewer's pledge affordance.
  private boardRowHtml(r: GuildLeaderboardRow): string {
    const row =
      `<div class="lb-row lb-row-guild"><span class="lb-rank">${formatNumber(r.rank, { maximumFractionDigits: 0 })}</span>` +
      `<button type="button" class="lb-name gb-roster-link guild-tier-${r.tier}" data-guild-roster="${esc(r.name)}" ` +
      `title="${esc(t('hudChrome.noticeboard.rosterTitle', { guild: r.name }))}">${esc(r.name)}</button>` +
      `<span class="lb-members">${formatNumber(r.memberCount, { maximumFractionDigits: 0 })}</span>` +
      `<span class="lb-vlvl">${formatNumber(r.topLevel, { maximumFractionDigits: 0 })}</span>` +
      `<span class="lb-xp">${formatXp(r.totalLifetimeXp)}</span></div>`;
    if (r.open === null) return `<div class="lb-guild-entry">${row}</div>`;
    const status = r.open
      ? `<span class="lb-pledge-status open">${esc(t('hudChrome.pledge.open'))}</span>`
      : `<span class="lb-pledge-status closed">${esc(t('hudChrome.pledge.closed'))}</span>`;
    const floor =
      r.open && r.minLevel > 1
        ? `<span class="lb-pledge-floor">${esc(t('hudChrome.pledge.minLevel', { level: formatNumber(r.minLevel, { maximumFractionDigits: 0 }) }))}</span>`
        : '';
    const note = r.note
      ? `<span class="lb-guild-note">${esc(this.deps.maskPlayerText(r.note))}</span>`
      : '';
    return `<div class="lb-guild-entry">${row}<div class="lb-guild-sub">${status}${floor}${note}${this.pledgeCellHtml(r)}</div></div>`;
  }

  // The pledge affordance at the sub-line's right edge; 'closed'/'belowLevel'
  // render nothing extra, the chips already say why.
  private pledgeCellHtml(r: GuildLeaderboardRow): string {
    if (r.pledge === 'pledge') {
      return (
        `<button type="button" class="btn lb-pledge-btn" data-guild-pledge="${esc(r.name)}" ` +
        `title="${esc(t('hudChrome.pledge.actionTitle', { guild: r.name }))}">${esc(t('hudChrome.pledge.action'))}</button>`
      );
    }
    if (r.pledge === 'pledged')
      return `<span class="lb-pledge-chip on">${esc(t('hudChrome.pledge.pledged'))}</span>`;
    if (r.pledge === 'yours')
      return `<span class="lb-pledge-chip">${esc(t('hudChrome.pledge.yourGuild'))}</span>`;
    return '';
  }

  // Send the pledge and repaint so the clicked row flips to its Pledged chip.
  // Fire-and-forget like every social command: the server answers via chat and
  // the social frame's myPledge corrects the optimistic chip if refused.
  private wirePledgeButtons(body: HTMLElement): void {
    body.querySelectorAll<HTMLButtonElement>('[data-guild-pledge]').forEach((button) => {
      button.addEventListener('click', () => {
        const name = button.dataset.guildPledge ?? '';
        if (!name) return;
        this.pledgeSentTo = name;
        this.deps.world().guildPledge(name);
        void this.render('action');
      });
    });
  }

  private wireRosterLinks(body: HTMLElement): void {
    body.querySelectorAll<HTMLButtonElement>('[data-guild-roster]').forEach((button) => {
      button.addEventListener('click', () => {
        const name = button.dataset.guildRoster ?? '';
        if (!name) return;
        this.rosterOf = name;
        void this.render('view');
      });
    });
  }

  private pagerHtml(pager: LeaderboardPager | null): string {
    if (!pager) return '';
    const current = formatNumber(pager.page + 1, { maximumFractionDigits: 0 });
    const total = formatNumber(pager.pageCount, { maximumFractionDigits: 0 });
    return (
      `<div class="lb-pager">` +
      `<button type="button" class="lb-page-btn" data-board-page="prev"${pager.prevDisabled ? ' disabled' : ''}>${esc(t('itemUi.market.pagePrev'))}</button>` +
      `<span class="lb-page-status">${esc(t('itemUi.market.pageStatus', { current, total }))}</span>` +
      `<button type="button" class="lb-page-btn" data-board-page="next"${pager.nextDisabled ? ' disabled' : ''}>${esc(t('itemUi.market.pageNext'))}</button>` +
      `</div>`
    );
  }

  private wirePager(body: HTMLElement, focus: Focus): void {
    body.querySelectorAll<HTMLButtonElement>('[data-board-page]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        const forward = button.dataset.boardPage === 'next';
        this.page += forward ? 1 : -1;
        if (this.page < 0) this.page = 0;
        void this.render(forward ? 'next' : 'prev');
      });
    });
    // Keyboard focus-return after an async page change: land on the control
    // just activated when it survives (still enabled), else the close button,
    // so the keyboard user is never dumped back to <body> (WCAG 2.4.3).
    if (focus === 'prev' || focus === 'next') {
      const wanted = body.querySelector<HTMLButtonElement>(`[data-board-page="${focus}"]`);
      if (wanted && !wanted.disabled) wanted.focus();
      else this.focusClose(this.deps.root());
    }
  }

  // ---------------------------------------------------------------------
  // The roster drill-in.
  // ---------------------------------------------------------------------

  private async renderRoster(
    el: HTMLElement,
    world: IWorld,
    guild: string,
    focus: Focus,
    seq: number,
  ): Promise<void> {
    let view = buildGuildRosterView({ kind: 'loading', guild });
    try {
      const info = await world.guildRoster(guild);
      view = buildGuildRosterView({ kind: 'info', guild, info });
    } catch {
      view = buildGuildRosterView({ kind: 'error', guild });
    }
    if (seq !== this.renderSeq || el.style.display !== 'flex') return;
    const body = el.querySelector('.gb-body');
    if (!body) return;

    const back =
      `<button type="button" class="btn gb-back" data-board-back>` +
      `${esc(t('hudChrome.noticeboard.back'))}</button>`;
    const heading =
      view.kind === 'loaded'
        ? `<div class="gb-roster-head">${back}<span class="gb-roster-guild guild-tier-${view.tier}">${esc(view.guild)}</span>` +
          `<span class="gb-roster-xp">${formatXp(view.totalLifetimeXp)}</span></div>`
        : `<div class="gb-roster-head">${back}<span class="gb-roster-guild">${esc(view.guild)}</span></div>`;

    if (view.kind === 'error') {
      body.innerHTML = `${heading}<div class="lb-empty lb-error" role="alert">${esc(t('game.leaderboard.retry'))}</div>`;
    } else if (view.kind === 'empty' || view.kind === 'loading') {
      body.innerHTML = `${heading}<div class="lb-empty">${esc(t('hudChrome.noticeboard.empty'))}</div>`;
    } else {
      body.innerHTML =
        heading + this.rosterHeaderHtml() + view.rows.map((r) => this.rosterRowHtml(r)).join('');
    }
    const backBtn = body.querySelector('[data-board-back]') as HTMLElement | null;
    backBtn?.addEventListener('click', () => {
      this.returnTo = this.rosterOf;
      this.rosterOf = null;
      void this.render('back');
    });
    if (focus === 'view') backBtn?.focus();
  }

  private rosterHeaderHtml(): string {
    return (
      `<div class="lb-row gb-row-roster lb-head"><span class="gb-rank-chip">${esc(t('game.leaderboard.rank'))}</span>` +
      `<span class="lb-name">${esc(t('game.leaderboard.name'))}</span>` +
      `<span class="gb-class">${esc(t('auth.class'))}</span>` +
      `<span class="lb-lvl">${esc(t('game.leaderboard.level'))}</span>` +
      `<span class="lb-xp">${esc(t('game.leaderboard.lifetimeXp'))}</span></div>`
    );
  }

  private rosterRowHtml(r: GuildRosterRow): string {
    const rankKey =
      r.rank === 'leader'
        ? 'hud.social.ranks.leader'
        : r.rank === 'officer'
          ? 'hud.social.ranks.officer'
          : 'hud.social.ranks.member';
    // Class colour from the content table (the classic class-colour rule);
    // an unknown class id renders the raw id uncoloured rather than hiding
    // the row.
    const clsDef = (CLASSES as Record<string, { color: number }>)[r.class];
    const clsColor = clsDef ? ` style="color: #${clsDef.color.toString(16).padStart(6, '0')}"` : '';
    const clsName = clsDef ? classDisplayName(r.class as PlayerClass) : r.class;
    return (
      `<div class="lb-row gb-row-roster"><span class="gb-rank-chip gb-rank-${r.rank}">${esc(t(rankKey))}</span>` +
      `<span class="lb-name">${esc(r.name)}</span>` +
      `<span class="gb-class"${clsColor}>${esc(clsName)}</span>` +
      `<span class="lb-lvl">${formatNumber(r.level, { maximumFractionDigits: 0 })}</span>` +
      `<span class="lb-xp">${formatXp(r.lifetimeXp)}</span></div>`
    );
  }

  // ---------------------------------------------------------------------

  private titleHtml(realm: string): string {
    const realmTag = realm ? ` &middot; ${esc(realm)}` : '';
    return (
      `<div class="panel-title"><span id="guild-board-title">${esc(t('hudChrome.noticeboard.popupTitle'))} ` +
      `<span class="lb-subtitle">${esc(t('hudChrome.noticeboard.subtitle'))}${realmTag}</span></span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.leaderboard.close'))}">${svgIcon('close')}</button></div>`
    );
  }

  private loadingBodyHtml(): string {
    return `<div class="lb-body gb-body window-fill" role="region" aria-labelledby="guild-board-title"><div class="lb-loading" role="status" aria-busy="true">${esc(t('game.leaderboard.loading'))}</div></div>`;
  }
}
