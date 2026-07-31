// Thin DOM painter for the in-match Thornhollow Fields scoreboard strip and the
// wave-respawn overlay (the ValeCupHud composition template: snapshot-driven
// per mediumHud tick from the pure BgScoreboardView, self-mounting roots,
// sig-diffed skeleton). The skeleton (team labels + pip slots) rebuilds only
// when the STRUCTURAL sig changes (new match / roster change); scores, the
// clock, the phase line, flag states, pip states, and the respawn/protection
// readouts all ride ELIDED writer slots so the per-second tick never rebuilds
// DOM (per-frame perf contract, src/ui/CLAUDE.md).
//
// Fairness: everything here paints identically on every graphics tier; the
// flag states and carrier marker are actionable information and are never
// tier-gated. Colors live in the stylesheet (components.css), never in TS.

import type { PlayerClass } from '../../../sim/types';
import { classDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import type { BgScoreboardView } from './battleground_scoreboard_view';

const num = (n: number): string => formatNumber(n, { maximumFractionDigits: 0 });
const FLAG_STATES = ['home', 'carried', 'dropped'] as const;
// Literal key map (the HONOR_REASON_KEYS pattern): a fourth flag state must
// red-fail tsc here, never throw at runtime through a constructed key.
const FLAG_STATE_KEYS = {
  home: 'hudChrome.bg.flagState.home',
  carried: 'hudChrome.bg.flagState.carried',
  dropped: 'hudChrome.bg.flagState.dropped',
} as const;

export interface BattlegroundScoreboardDeps {
  /** The HUD layer the strip mounts into (the #ui element). */
  layer(): HTMLElement | null;
  writers: PainterHostWriters;
}

export class BattlegroundScoreboard {
  private root: HTMLElement | null = null;
  private respawnRoot: HTMLElement | null = null;
  private lastSig = '';
  private scoreCrimsonEl: HTMLElement | null = null;
  private scoreAzureEl: HTMLElement | null = null;
  private clockEl: HTMLElement | null = null;
  private flagEls: [HTMLElement | null, HTMLElement | null] = [null, null];
  private resultEl: HTMLElement | null = null;
  private fstateEls: [HTMLElement | null, HTMLElement | null] = [null, null];
  // Expanded-board row cells, aligned with view.board order (structural sig).
  private boardRows: { row: HTMLElement; k: HTMLElement; d: HTMLElement; c: HTMLElement }[] = [];

  constructor(private readonly deps: BattlegroundScoreboardDeps) {}

  /** Repaint from the pure view (mediumHud band). */
  update(view: BgScoreboardView): void {
    const w = this.deps.writers;
    if (!view.active) {
      if (this.root) w.setDisplay(this.root, 'none');
      if (this.respawnRoot) w.setDisplay(this.respawnRoot, 'none');
      this.lastSig = view.sig;
      return;
    }
    const root = this.ensureRoot();
    if (!root) return;
    w.setDisplay(root, 'block');
    if (view.sig !== this.lastSig) {
      this.lastSig = view.sig;
      root.innerHTML = this.skeleton(view);
      this.scoreCrimsonEl = root.querySelector('.bg-score.crimson');
      this.scoreAzureEl = root.querySelector('.bg-score.azure');
      this.clockEl = root.querySelector('.bg-clock');
      this.flagEls = [root.querySelector('.bg-flag.crimson'), root.querySelector('.bg-flag.azure')];
      this.fstateEls = [
        root.querySelector('.bg-fstate.crimson'),
        root.querySelector('.bg-fstate.azure'),
      ];
      this.resultEl = root.querySelector('.bg-result');
      this.boardRows = [...root.querySelectorAll<HTMLElement>('.bg-brow.bg-bplayer')].map(
        (row) => ({
          row,
          k: row.querySelector('.bb-k') as HTMLElement,
          d: row.querySelector('.bb-d') as HTMLElement,
          c: row.querySelector('.bb-c') as HTMLElement,
        }),
      );
    }
    // The frozen result screen: the board pins open over the field with the
    // verdict line and the leave-in countdown until everyone is sent home.
    w.toggleClass(root, 'ended', view.state === 'ended');
    if (this.resultEl) {
      w.setText(
        this.resultEl,
        view.result === null
          ? ''
          : view.result === 'win'
            ? t('hudChrome.bg.resultVictory')
            : view.result === 'loss'
              ? t('hudChrome.bg.resultDefeat')
              : t('hudChrome.bg.resultDraw'),
      );
      w.toggleClass(this.resultEl, 'win', view.result === 'win');
      w.toggleClass(this.resultEl, 'loss', view.result === 'loss');
    }
    if (this.scoreCrimsonEl) w.setText(this.scoreCrimsonEl, num(view.scoreCrimson));
    if (this.scoreAzureEl) w.setText(this.scoreAzureEl, num(view.scoreAzure));
    if (this.clockEl) {
      // The one center slot: the form-up countdown before the gates open,
      // the match clock afterward. No standing instruction text.
      w.setText(
        this.clockEl,
        view.state === 'countdown'
          ? t('hudChrome.bg.formUp', { seconds: num(view.countdown) })
          : view.state === 'ended'
            ? t('hudChrome.bg.leavingIn', { seconds: num(view.countdown) })
            : t('hudChrome.bg.clock', {
                minutes: num(view.minutes),
                seconds: String(view.seconds).padStart(2, '0'),
              }),
      );
    }
    for (const team of [0, 1] as const) {
      const state = view.flagStates[team];
      // No player names on the strip (owner direction): the call is about
      // the FLAG ('Flag stolen!'), the combat log keeps the who.
      const stateText = t(FLAG_STATE_KEYS[state]);
      const el = this.flagEls[team];
      if (el) {
        for (const s of FLAG_STATES) w.toggleClass(el, s, state === s);
        w.setAttr(el, 'title', stateText);
        // The flag state is actionable information: give assistive tech the
        // same readout the tooltip carries (the glyph is a real named image,
        // never aria-hidden decoration).
        w.setAttr(el, 'aria-label', stateText);
      }
      // The visible status line under each side: 'Flag at the keep' at rest,
      // the enemy carrier's NAME while carried, 'Flag on the ground' dropped.
      // The status line speaks only when there is a CALL: the enemy
      // carrier's name while taken, the grounded line while dropped. At rest
      // it stays empty (repeating 'at the keep' under both names was noise).
      const fs = this.fstateEls[team];
      if (fs) {
        for (const s of FLAG_STATES) w.toggleClass(fs, s, state === s);
        w.setText(fs, state === 'home' ? '' : t(FLAG_STATE_KEYS[state]));
      }
    }
    for (let i = 0; i < this.boardRows.length && i < view.board.length; i++) {
      const cells = this.boardRows[i];
      const r = view.board[i];
      w.setText(cells.k, num(r.kills));
      w.setText(cells.d, num(r.deaths));
      w.setText(cells.c, num(r.captures));
      w.toggleClass(cells.row, 'dead', r.dead);
      w.toggleClass(cells.row, 'flag', r.carrying);
    }
    this.updateRespawn(view);
  }

  private updateRespawn(view: BgScoreboardView): void {
    const w = this.deps.writers;
    const el = this.ensureRespawnRoot();
    if (!el) return;
    if (view.respawnIn > 0) {
      w.setText(el, t('hudChrome.bg.respawnIn', { seconds: num(view.respawnIn) }));
      w.setDisplay(el, 'block');
    } else {
      w.setDisplay(el, 'none');
    }
  }

  /** Language switch: clear the structural sig so the next update rebuilds. */
  relocalize(): void {
    this.lastSig = '';
  }

  private ensureRoot(): HTMLElement | null {
    if (this.root) return this.root;
    const layer = this.deps.layer();
    if (!layer) return null;
    const el = document.createElement('div');
    el.id = 'bg-scoreboard';
    // A glanceable strip, deliberately NOT a status landmark: the per-second
    // clock must never spam a screen reader (politeness contract), and the
    // flag glyphs inside carry their own accessible names.
    el.setAttribute('aria-live', 'off');
    // Hover reveals the expanded board (CSS); a tap/click pins it open (the
    // touch path), and the strip is FOCUSABLE so keyboard users get the same
    // board: focus reveals via :focus-within, Enter/Space pins it exactly like
    // a click (a keyboard user must never be locked out of kills/deaths/caps).
    el.tabIndex = 0;
    el.setAttribute('aria-label', t('hudChrome.bg.boardToggleLabel'));
    el.setAttribute('aria-expanded', 'false');
    const togglePin = (): void => {
      const pinned = el.classList.toggle('expanded');
      el.setAttribute('aria-expanded', pinned ? 'true' : 'false');
      // Unpinning by a second click leaves FOCUS on the strip, and
      // :focus-within alone would hold the board open (the stuck-open bug):
      // release focus with the pin so the board actually closes.
      if (!pinned) el.blur();
    };
    el.addEventListener('click', togglePin);
    el.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      togglePin();
    });
    // Clicking anywhere OFF the strip closes a pinned board (and drops the
    // focus reveal): the board must never stay stuck over the fight.
    document.addEventListener('pointerdown', (ev) => {
      if (el.contains(ev.target as Node)) return;
      if (!el.classList.contains('expanded') && document.activeElement !== el) return;
      el.classList.remove('expanded');
      el.setAttribute('aria-expanded', 'false');
      el.blur();
    });
    layer.appendChild(el);
    this.root = el;
    return el;
  }

  private ensureRespawnRoot(): HTMLElement | null {
    if (this.respawnRoot) return this.respawnRoot;
    const layer = this.deps.layer();
    if (!layer) return null;
    const el = document.createElement('div');
    el.id = 'bg-respawn';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'off');
    layer.appendChild(el);
    this.respawnRoot = el;
    return el;
  }

  private skeleton(view: BgScoreboardView): string {
    // Own-team marker: a styling class + tooltip on the team label itself
    // (an underline in the team color), keeping the header symmetric instead
    // of the old lopsided "(you)" text tag.
    const mine = (team: number): string => (view.myTeam === team ? ' mine' : '');
    const mineTitle = (team: number): string =>
      view.myTeam === team ? ` title="${esc(t('hudChrome.bg.yourTeamTitle'))}"` : '';
    // Two rows, nothing abstract: the score line, then each side's FLAG
    // status flanking the match clock (the roster lives in the expanded
    // board, and the caps target lives in its header).
    return (
      `<div class="bg-result"></div>` +
      `<div class="bg-score-line">` +
      `<span class="bg-team crimson${mine(0)}"${mineTitle(0)}><span class="bg-flag crimson" role="img"></span>${esc(t('hudChrome.bg.crimson'))}</span>` +
      `<span class="bg-score crimson"></span><span class="bg-score-colon">:</span><span class="bg-score azure"></span>` +
      `<span class="bg-team azure${mine(1)}"${mineTitle(1)}>${esc(t('hudChrome.bg.azure'))}<span class="bg-flag azure" role="img"></span></span>` +
      `</div>` +
      `<div class="bg-under">` +
      `<span class="bg-fstate crimson"></span>` +
      `<span class="bg-clock"></span>` +
      `<span class="bg-fstate azure"></span>` +
      `</div>` +
      this.boardHtml(view)
    );
  }

  // The expanded board: the two rosters in their own team sections under one
  // Kills / Deaths / Captures label row, revealed on hover and pinned by tap.
  // Structural rows only; the stat cells are written through elided slots
  // each update (the collector matches .bg-bplayer ONLY, so the label rows
  // can never be clobbered by data writes).
  private boardHtml(view: BgScoreboardView): string {
    const teamCls = (team: number): string => (team === 0 ? 'crimson' : 'azure');
    const capsLine = `<div class="bg-bcaps">${esc(
      t('hudChrome.bg.firstTo', { caps: num(view.capsToWin) }),
    )}</div>`;
    const header =
      capsLine +
      `<div class="bg-brow bg-bhead">` +
      `<span class="bb-name"></span>` +
      `<span class="bb-k">${esc(t('hudChrome.bg.board.kills'))}</span>` +
      `<span class="bb-d">${esc(t('hudChrome.bg.board.deaths'))}</span>` +
      `<span class="bb-c">${esc(t('hudChrome.bg.board.captures'))}</span></div>`;
    const rowHtml = (r: BgScoreboardView['board'][number]): string => {
      const clsName = classDisplayName(r.cls as PlayerClass) || r.cls;
      return (
        `<div class="bg-brow bg-bplayer ${teamCls(r.team)}${r.me ? ' me' : ''}">` +
        `<span class="bb-name" title="${esc(clsName)}">${esc(r.name)}</span>` +
        `<span class="bb-k">0</span><span class="bb-d">0</span><span class="bb-c">0</span></div>`
      );
    };
    const section = (team: number): string =>
      `<div class="bg-bteam ${teamCls(team)}">${esc(
        team === 0 ? t('hudChrome.bg.crimson') : t('hudChrome.bg.azure'),
      )}</div>` +
      view.board
        .filter((r) => r.team === team)
        .map(rowHtml)
        .join('');
    return `<div class="bg-board">${header}${section(0)}${section(1)}</div>`;
  }
}
