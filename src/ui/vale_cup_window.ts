// Thin DOM painter for the Vale Cup window (docs/prd/vale-cup.md).
//
// The consumer half of the pure-core + thin-painter split (ArenaWindow is the
// direct template): it paints #valecup-window from the structured VcupView
// (vale_cup_window_view.ts) and owns the window's view-state (selected bracket /
// banner nation / sport role, the render-skip signature, the WCAG focus opener).
// The pure core decides WHICH state the snapshot is in and WHAT each section
// shows; this module renders that and wires the bracket / nation / role / queue /
// practice / close dispatch back through IWorld + injected callbacks. It holds no
// Sim reference and reaches into Hud only through its deps.
//
// It is NOT a canvas window (colors live in the extracted stylesheet; the nation
// flag colors are CSS custom properties DERIVED from the VC_NATIONS data record
// via vale_cup_flag.ts, the one documented data-driven exception). The window
// redraws while open from hud.update()'s mediumHud band, skipping the DOM
// rebuild when the content signature is unchanged.

import { audio } from '../game/audio';
import type { SportRole, VcBracket, VcNationId } from '../sim/types';
import type { IWorld } from '../world_api';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import { svgIcon } from './ui_icons';
import { VCUP_NATION_NAME_KEYS, vcupFlagHtml } from './vale_cup_flag';
import {
  buildVcupView,
  type VcupAction,
  type VcupBracketTab,
  type VcupLivePanel,
  type VcupNationCell,
  type VcupRoleRow,
  type VcupView,
} from './vale_cup_window_view';

// Render-skip sentinel for the offline panel (ArenaWindow's ARENA_OFFLINE_SIG
// pattern): the live sig is always JSON.stringify([...]) and starts with '[',
// so this token can never collide with a real signature.
const VCUP_OFFLINE_SIG = 'vcup-offline';

const ROLE_NAME_KEYS: Record<SportRole, TranslationKey> = {
  allrounder: 'hudChrome.vcup.role.allrounder.name',
  striker: 'hudChrome.vcup.role.striker.name',
  sweeper: 'hudChrome.vcup.role.sweeper.name',
  keeper: 'hudChrome.vcup.role.keeper.name',
};

const ROLE_DESC_KEYS: Record<SportRole, TranslationKey> = {
  allrounder: 'hudChrome.vcup.role.allrounder.desc',
  striker: 'hudChrome.vcup.role.striker.desc',
  sweeper: 'hudChrome.vcup.role.sweeper.desc',
  keeper: 'hudChrome.vcup.role.keeper.desc',
};

const num = (n: number): string => formatNumber(n, { maximumFractionDigits: 0 });

/** mm:ss clock text through t() so the separator stays localizable. */
function clockText(minutes: number, seconds: number): string {
  return t('hudChrome.vcup.clock', {
    minutes: num(minutes),
    seconds: String(seconds).padStart(2, '0'),
  });
}

export function vcupNationName(id: VcNationId): string {
  return t(VCUP_NATION_NAME_KEYS[id]);
}

/**
 * Hud-supplied glue. The window renders entirely from IWorld + these callbacks;
 * it never reaches into Hud directly.
 */
export interface ValeCupWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

export class ValeCupWindow {
  private bracket: VcBracket = 1;
  private nation: VcNationId | null = null;
  private role: SportRole = 'allrounder';
  // "Enter under my guild banner" toggle (default on, so a guilded player reps
  // their guild unless they opt out for a private run).
  private enterAsGuild = true;
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;
  // Offline only: enables the practice-vs-bots button (hidden online).
  private practiceAvailable = false;

  constructor(private readonly deps: ValeCupWindowDeps) {}

  /** Offline builds enable the practice button (the online server ignores it). */
  setPracticeAvailable(on: boolean): void {
    this.practiceAvailable = on;
  }

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    const root = this.deps.root();
    // WCAG 2.2 AA: the dialog identity is a STATIC property of the stable root,
    // set ONCE on open (never in render(), which the mediumHud band repeats).
    markDialogRoot(root, { labelledBy: 'valecup-title' });
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

  // Re-localize after an in-game language switch: the sig is text-independent,
  // so clearing it forces exactly one rebuild with fresh t(). Self-gated on
  // isOpen so the language fan-out can call it unconditionally.
  relocalize(): void {
    if (!this.isOpen) return;
    this.lastSig = '';
    this.render();
  }

  render(): void {
    const world = this.deps.world();
    const el = this.deps.root();
    const view = buildVcupView({
      info: world.cupInfo,
      selectedBracket: this.bracket,
      selectedNation: this.nation,
      selectedRole: this.role,
      playerId: world.playerId,
      party: world.partyInfo,
      practiceAvailable: this.practiceAvailable,
      enterAsGuild: this.enterAsGuild,
    });

    if (view.kind === 'offline') {
      if (this.lastSig === VCUP_OFFLINE_SIG) return;
      this.lastSig = VCUP_OFFLINE_SIG;
      el.innerHTML = this.offlineHtml();
      el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
      return;
    }

    // A queue/match pins its bracket + picks as the selection for the next render.
    if (view.commitSelections) {
      this.bracket = view.bracket;
      if (view.nation !== null) this.nation = view.nation;
      this.role = view.role;
    }
    if (view.sig === this.lastSig) return;
    this.lastSig = view.sig;
    el.innerHTML = this.liveHtml(view);
    this.wire(el, view);
  }

  private wire(el: HTMLElement, view: Extract<VcupView, { kind: 'live' }>): void {
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    el.querySelectorAll('[data-bracket]:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.bracket = Number((btn as HTMLElement).dataset.bracket) as VcBracket;
        this.lastSig = '';
        this.render();
        audio.click();
      });
    });
    el.querySelectorAll('[data-nation]:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.nation = (btn as HTMLElement).dataset.nation as VcNationId;
        this.lastSig = '';
        this.render();
        audio.click();
      });
    });
    el.querySelectorAll('[data-role]:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        const role = (btn as HTMLElement).dataset.role as SportRole;
        this.role = role;
        // While waiting in the queue the pick is live on the queue entry.
        if (view.action.kind === 'queued') this.deps.world().vcupSetRole(role);
        this.lastSig = '';
        this.render();
        audio.click();
      });
    });
    el.querySelector('[data-guild-toggle]')?.addEventListener('click', () => {
      this.enterAsGuild = !this.enterAsGuild;
      this.lastSig = '';
      this.render();
      audio.click();
    });
    el.querySelector('[data-act="queue"]:not([disabled])')?.addEventListener('click', () => {
      if (this.nation === null) return;
      // Only fly the banner when the toggle is actually offered (guilded + idle).
      const asGuild = view.guildEntry !== null && this.enterAsGuild;
      this.deps.world().vcupQueueJoin(view.bracket, this.nation, this.role, asGuild);
      audio.click();
    });
    el.querySelector('[data-act="leave"]')?.addEventListener('click', () => {
      this.deps.world().vcupQueueLeave();
      audio.click();
    });
    el.querySelector('[data-act="practice"]')?.addEventListener('click', () => {
      this.deps.world().vcupPracticeStart(view.bracket);
      this.lastSig = '';
      audio.click();
    });
  }

  // ---- HTML builders (the localized DOM the pure view-model drives) ----------

  private titleHtml(): string {
    return `<div class="panel-title"><span id="valecup-title">${esc(t('hudChrome.vcup.title'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.vcup.close'))}">${svgIcon('close')}</button></div>`;
  }

  private offlineHtml(): string {
    return `${this.titleHtml()}<div class="vcup-note">${esc(t('hudChrome.vcup.offlineNote'))}</div>`;
  }

  private liveHtml(view: Extract<VcupView, { kind: 'live' }>): string {
    return (
      this.titleHtml() +
      this.recordHtml(view.standing) +
      this.bracketsHtml(view.brackets) +
      `<div class="vcup-sub">${esc(t('hudChrome.vcup.nationsHeading'))}</div>` +
      this.nationsHtml(view.nations) +
      `<div class="vcup-note">${esc(t('hudChrome.vcup.awayNote'))}</div>` +
      `<div class="vcup-sub">${esc(t('hudChrome.vcup.rolesHeading'))}</div>` +
      this.rolesHtml(view.roles) +
      this.guildEntryHtml(view.guildEntry, view.guildStanding) +
      this.actionHtml(view.action) +
      this.practiceHtml(view.practice) +
      this.practicingHtml(view.practicing) +
      `<div class="vcup-sub">${esc(t('hudChrome.vcup.liveHeading'))}</div>` +
      this.liveMatchHtml(view.live) +
      `<div class="vcup-sub">${esc(t('hudChrome.vcup.boardHeading'))}</div>` +
      this.boardHtml(view.board) +
      `<div class="vcup-sub">${esc(t('hudChrome.vcup.guildBoardHeading'))}</div>` +
      this.guildBoardHtml(view.guildBoard)
    );
  }

  // The "enter under my guild banner" checkbox, shown only when the player is in
  // a guild and idle. A pressed-state button (no native checkbox in this HUD).
  private guildEntryHtml(
    entry: { guildName: string; on: boolean } | null,
    standing: { wins: number; losses: number },
  ): string {
    if (!entry) return '';
    const label = t('hudChrome.vcup.enterAsGuild', { guild: entry.guildName });
    const rec = t('hudChrome.vcup.guildRecordLine', {
      wins: num(standing.wins),
      losses: num(standing.losses),
    });
    return (
      `<button type="button" class="vcup-guild-toggle${entry.on ? ' on' : ''}" data-guild-toggle` +
      ` role="switch" aria-checked="${entry.on ? 'true' : 'false'}">` +
      `<span class="vcup-guild-box" aria-hidden="true"></span>` +
      `<span class="vcup-guild-label">${esc(label)}</span></button>` +
      `<div class="vcup-note">${esc(rec)}</div>`
    );
  }

  private recordHtml(standing: { wins: number; losses: number; draws: number }): string {
    return `<div class="vcup-record">${esc(
      t('hudChrome.vcup.recordLine', {
        wins: num(standing.wins),
        losses: num(standing.losses),
        draws: num(standing.draws),
      }),
    )}</div>`;
  }

  private bracketsHtml(tabs: VcupBracketTab[]): string {
    const btn = (b: VcupBracketTab): string => {
      const label = t('hudChrome.vcup.bracketLabel', { n: num(b.bracket) });
      const waiting =
        b.waiting > 0 ? t('hudChrome.vcup.waitingCount', { count: num(b.waiting) }) : '';
      return (
        `<button type="button" class="vcup-bracket${b.active ? ' active' : ''}${b.locked ? ' locked' : ''}"` +
        ` data-bracket="${b.bracket}" aria-pressed="${b.active ? 'true' : 'false'}"${b.locked ? ' disabled' : ''}` +
        `${waiting ? ` title="${esc(waiting)}"` : ''}>${esc(label)}${b.waiting > 0 ? `<span class="vcup-wait">${esc(num(b.waiting))}</span>` : ''}</button>`
      );
    };
    return `<div class="vcup-brackets" role="group" aria-label="${esc(t('hudChrome.vcup.bracketsAria'))}">${tabs.map(btn).join('')}</div>`;
  }

  private nationsHtml(cells: VcupNationCell[]): string {
    const btn = (c: VcupNationCell): string => {
      const name = vcupNationName(c.id);
      return (
        `<button type="button" class="vcup-nation${c.selected ? ' selected' : ''}" data-nation="${c.id}"` +
        ` aria-pressed="${c.selected ? 'true' : 'false'}"${c.disabled ? ' disabled' : ''} title="${esc(name)}">` +
        `${vcupFlagHtml(c.id)}<span class="vcup-nation-name">${esc(name)}</span></button>`
      );
    };
    return `<div class="vcup-nations" role="group" aria-label="${esc(t('hudChrome.vcup.nationsHeading'))}">${cells.map(btn).join('')}</div>`;
  }

  private rolesHtml(rows: VcupRoleRow[]): string {
    const btn = (r: VcupRoleRow): string =>
      `<button type="button" class="vcup-role${r.selected ? ' selected' : ''}" data-role="${r.id}"` +
      ` aria-pressed="${r.selected ? 'true' : 'false'}"${r.disabled ? ' disabled' : ''}>` +
      `<span class="vcup-role-name">${esc(t(ROLE_NAME_KEYS[r.id]))}</span>` +
      `<span class="vcup-role-desc">${esc(t(ROLE_DESC_KEYS[r.id]))}</span></button>`;
    return `<div class="vcup-roles" role="group" aria-label="${esc(t('hudChrome.vcup.rolesHeading'))}">${rows.map(btn).join('')}</div>`;
  }

  private actionHtml(action: VcupAction): string {
    if (action.kind === 'in-match') {
      return `<div class="vcup-status">${esc(t('hudChrome.vcup.inMatchNote'))}</div>`;
    }
    if (action.kind === 'deserter') {
      return `<div class="vcup-note vcup-warn">${esc(
        t('hudChrome.vcup.deserterNote', { seconds: num(action.seconds) }),
      )}</div>`;
    }
    if (action.kind === 'queued') {
      return (
        `<button type="button" class="btn leave" data-act="leave">${esc(t('hudChrome.vcup.leaveQueue'))}</button>` +
        `<div class="vcup-status">${esc(
          t('hudChrome.vcup.queuedStatus', {
            bracket: t('hudChrome.vcup.bracketLabel', { n: num(action.bracket) }),
            position: num(action.position),
            count: num(action.queueSize),
          }),
        )}</div>`
      );
    }
    const blockNote =
      action.block === 'nation'
        ? t('hudChrome.vcup.blockNation')
        : action.block === 'party-size'
          ? t('hudChrome.vcup.blockPartySize')
          : action.block === 'not-leader'
            ? t('hudChrome.vcup.blockNotLeader')
            : t('hudChrome.vcup.queueNote');
    return (
      `<button type="button" class="btn${action.queueDisabled ? ' disabled' : ''}" data-act="queue"${action.queueDisabled ? ' disabled' : ''}>${esc(t('hudChrome.vcup.queue'))}</button>` +
      `<div class="vcup-note">${esc(blockNote)}</div>`
    );
  }

  private practiceHtml(show: boolean): string {
    if (!show) return '';
    return (
      `<button type="button" class="btn vcup-practice" data-act="practice">${esc(t('hudChrome.vcup.practice'))}</button>` +
      `<div class="vcup-note">${esc(t('hudChrome.vcup.practiceNote'))}</div>`
    );
  }

  // Region indicator: who is off in a private practice instance right now (their
  // bodies are not on the physical pitch, so this stands in for seeing them).
  private practicingHtml(names: string[]): string {
    if (names.length === 0) return '';
    return (
      `<div class="vcup-practicing">` +
      `<span class="vcup-practicing-label">${esc(
        t('hudChrome.vcup.practicingNow', { count: num(names.length) }),
      )}</span> ` +
      `<span class="vcup-practicing-names">${esc(names.join(', '))}</span>` +
      `</div>`
    );
  }

  private liveMatchHtml(live: VcupLivePanel | null): string {
    if (!live) return `<div class="vcup-note">${esc(t('hudChrome.vcup.noLive'))}</div>`;
    const nameA = vcupNationName(live.nationA);
    const nameB = vcupNationName(live.nationB);
    return (
      `<div class="vcup-live" aria-label="${esc(
        t('hudChrome.vcup.liveAria', {
          nationA: nameA,
          nationB: nameB,
          scoreA: num(live.scoreA),
          scoreB: num(live.scoreB),
        }),
      )}">` +
      `<span class="vcup-live-side">${vcupFlagHtml(live.nationA)}<span class="vcup-live-name">${esc(nameA)}</span></span>` +
      `<span class="vcup-live-score">${esc(num(live.scoreA))}<span class="vcup-live-colon">:</span>${esc(num(live.scoreB))}</span>` +
      `<span class="vcup-live-side">${vcupFlagHtml(live.nationB, { away: live.awayPalette })}<span class="vcup-live-name">${esc(nameB)}</span></span>` +
      `<span class="vcup-live-clock">${esc(clockText(live.minutes, live.seconds))}</span>` +
      `</div>` +
      `<div class="vcup-note">${esc(t('hudChrome.vcup.walkUp'))}</div>`
    );
  }

  private boardHtml(board: { name: string; wins: number }[]): string {
    if (board.length === 0) {
      return `<div class="vcup-note">${esc(t('hudChrome.vcup.boardEmpty'))}</div>`;
    }
    return board
      .map(
        (row, i) =>
          `<div class="ladder-row"><span class="rank">${esc(num(i + 1))}</span>` +
          `<span class="lr-name">${esc(row.name)}</span>` +
          `<span class="lr-wl">${esc(t('hudChrome.vcup.boardWins', { count: num(row.wins) }))}</span></div>`,
      )
      .join('');
  }

  private guildBoardHtml(board: { name: string; wins: number; losses: number }[]): string {
    if (board.length === 0) {
      return `<div class="vcup-note">${esc(t('hudChrome.vcup.guildBoardEmpty'))}</div>`;
    }
    return board
      .map(
        (row, i) =>
          `<div class="ladder-row"><span class="rank">${esc(num(i + 1))}</span>` +
          `<span class="lr-name">${esc(row.name)}</span>` +
          `<span class="lr-wl">${esc(
            t('hudChrome.vcup.guildBoardWl', { wins: num(row.wins), losses: num(row.losses) }),
          )}</span></div>`,
      )
      .join('');
  }
}
