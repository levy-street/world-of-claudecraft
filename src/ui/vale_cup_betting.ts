// Thin DOM painter for the Vale Cup spectator BETTING banner + card (the
// ValeCupBriefing self-mounting-painter pattern; docs/prd/vale-cup.md). A
// walk-up spectator at the Sowfield sees a compact banner (the matchup, a live
// pool-split bar, the prize pool, and the wager countdown) that expands to a
// full card: per-team rosters with lifetime form, the parimutuel odds, and the
// stake buttons that place a wager through world.vcupBet.
//
// Per-frame contract (src/ui/CLAUDE.md): the SKELETON (matchup header, roster,
// static labels, stake buttons) is a sig-gated innerHTML rebuild keyed on the
// STRUCTURAL sig (match id, nations, rosters). Everything that moves each tick
// rides the PainterHost ELIDED writers: the pool-split bar width, the two pool /
// odds / percentage texts, the prize pool, the countdown, and the my-wager line
// (setText / setWidth / toggleClass / setAttr). The stake buttons and the expand
// toggle are wired ONCE per skeleton build.
//
// Dismissable via the expand toggle only (it is a passive spectator overlay, not
// a modal): Esc is not wired and it never inerts the page. Flag colors are the
// documented data-driven custom-property exception (vale_cup_flag.ts).

import type { SportRole } from '../sim/types';
import { esc } from './esc';
import { formatMoney, formatNumber, type TranslationKey, t } from './i18n';
import type { PainterHostWriters } from './painter_host';
import type { VcupBettingPlayer, VcupBettingView } from './vale_cup_betting_view';
import { vcupFlagHtml } from './vale_cup_flag';
import { vcupNationName } from './vale_cup_window';

const num = (n: number): string => formatNumber(n, { maximumFractionDigits: 0 });
const odds = (o: number | null): string =>
  o === null ? '-' : `${formatNumber(o, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;

const ROLE_NAME_KEYS: Record<SportRole, TranslationKey> = {
  allrounder: 'hudChrome.vcup.role.allrounder.name',
  striker: 'hudChrome.vcup.role.striker.name',
  sweeper: 'hudChrome.vcup.role.sweeper.name',
  keeper: 'hudChrome.vcup.role.keeper.name',
};

// The stake ladder (copper): 10c, 1s, 10s, 1g. Labels come from formatMoney so
// they localize; the values are what world.vcupBet receives.
const STAKES: readonly number[] = [10, 100, 1000, 10000];

export interface ValeCupBettingDeps {
  /** The HUD layer the overlay mounts into (the #ui element). */
  layer(): HTMLElement | null;
  writers: PainterHostWriters;
  /** Place a wager (world.vcupBet(side, copper)); wired once on skeleton build. */
  onBet(side: 'A' | 'B', copper: number): void;
}

export class ValeCupBetting {
  private root: HTMLElement | null = null;
  private lastSig = '';
  private expanded = false;
  // Per-tick element refs, resolved once per skeleton rebuild.
  private barA: HTMLElement | null = null;
  private pctAEl: HTMLElement | null = null;
  private pctBEl: HTMLElement | null = null;
  private poolAEl: HTMLElement | null = null;
  private poolBEl: HTMLElement | null = null;
  private oddsAEl: HTMLElement | null = null;
  private oddsBEl: HTMLElement | null = null;
  private prizeEl: HTMLElement | null = null;
  private countdownEl: HTMLElement | null = null;
  private myBetEl: HTMLElement | null = null;
  private recordEl: HTMLElement | null = null;
  private cardEl: HTMLElement | null = null;
  private toggleEl: HTMLButtonElement | null = null;
  private sideAControls: HTMLElement | null = null;
  private sideBControls: HTMLElement | null = null;
  private stakeBtnsA: HTMLButtonElement[] = [];
  private stakeBtnsB: HTMLButtonElement[] = [];
  // Current lock state per side (null until first applied after a rebuild), so
  // the per-tick `disabled` writes are elided to actual transitions and the
  // once-wired click handlers can refuse a keyboard activation that slips
  // through (`.locked` only stops the pointer).
  private lockedA: boolean | null = null;
  private lockedB: boolean | null = null;

  constructor(private readonly deps: ValeCupBettingDeps) {}

  update(view: VcupBettingView): void {
    const w = this.deps.writers;
    if (!view.visible) {
      if (this.root) w.setDisplay(this.root, 'none');
      this.lastSig = view.sig;
      return;
    }
    const root = this.ensureRoot();
    if (!root) return;
    w.setDisplay(root, 'block');

    if (view.sig !== this.lastSig) {
      this.lastSig = view.sig;
      root.innerHTML = this.skeleton(view);
      this.resolveRefs(root);
      this.wire();
      this.applyExpanded();
    }

    // ---- Per-tick elided writes ---------------------------------------------
    if (this.barA) w.setWidth(this.barA, `${view.pctA.toFixed(1)}%`);
    if (this.pctAEl) w.setText(this.pctAEl, `${num(Math.round(view.pctA))}%`);
    if (this.pctBEl) w.setText(this.pctBEl, `${num(Math.round(view.pctB))}%`);
    if (this.poolAEl) w.setText(this.poolAEl, formatMoney(view.poolA));
    if (this.poolBEl) w.setText(this.poolBEl, formatMoney(view.poolB));
    if (this.oddsAEl) w.setText(this.oddsAEl, odds(view.oddsA));
    if (this.oddsBEl) w.setText(this.oddsBEl, odds(view.oddsB));
    if (this.prizeEl)
      w.setText(
        this.prizeEl,
        t('hudChrome.vcup.bet.prize', { amount: formatMoney(view.prizePool) }),
      );
    if (this.countdownEl) {
      w.setText(
        this.countdownEl,
        view.open
          ? t('hudChrome.vcup.bet.closesIn', { seconds: num(view.countdown) })
          : t('hudChrome.vcup.bet.closed'),
      );
    }
    if (this.myBetEl) {
      const label =
        view.myStake > 0 && view.mySide
          ? t('hudChrome.vcup.bet.mine', {
              amount: formatMoney(view.myStake),
              team: vcupNationName(view.mySide === 'A' ? view.nationA : view.nationB),
            })
          : t('hudChrome.vcup.bet.none');
      w.setText(this.myBetEl, label);
    }
    if (this.recordEl) {
      w.setText(
        this.recordEl,
        t('hudChrome.vcup.bet.record', {
          wins: num(view.record.wins),
          losses: num(view.record.losses),
          net: formatMoney(Math.abs(view.record.net)),
          sign: view.record.net < 0 ? '-' : '+',
        }),
      );
    }
    // Lock the losing-side controls once a side is backed, and every control once
    // the window closes (the view core decides view.lockA/lockB; unit-tested in
    // tests/vale_cup_betting_view.test.ts). `.locked` is the visual + pointer
    // gate; `disabled` on the stake buttons is the real control gate (keyboard
    // focus + Enter/Space included), matching the window painter's disabled
    // attributes.
    if (this.sideAControls) w.toggleClass(this.sideAControls, 'locked', view.lockA);
    if (this.sideBControls) w.toggleClass(this.sideBControls, 'locked', view.lockB);
    if (view.lockA !== this.lockedA) {
      this.lockedA = view.lockA;
      for (const btn of this.stakeBtnsA) btn.disabled = view.lockA;
    }
    if (view.lockB !== this.lockedB) {
      this.lockedB = view.lockB;
      for (const btn of this.stakeBtnsB) btn.disabled = view.lockB;
    }
  }

  /** Language switch: clear the structural sig so the next update rebuilds. */
  relocalize(): void {
    this.lastSig = '';
  }

  private resolveRefs(root: HTMLElement): void {
    this.barA = root.querySelector('.vcupbet-bar-a');
    this.pctAEl = root.querySelector('.vcupbet-pct-a');
    this.pctBEl = root.querySelector('.vcupbet-pct-b');
    this.poolAEl = root.querySelector('.vcupbet-pool-a');
    this.poolBEl = root.querySelector('.vcupbet-pool-b');
    this.oddsAEl = root.querySelector('.vcupbet-odds-a');
    this.oddsBEl = root.querySelector('.vcupbet-odds-b');
    this.prizeEl = root.querySelector('.vcupbet-prize');
    this.countdownEl = root.querySelector('.vcupbet-countdown');
    this.myBetEl = root.querySelector('.vcupbet-mine');
    this.recordEl = root.querySelector('.vcupbet-record');
    this.cardEl = root.querySelector('.vcupbet-card');
    this.toggleEl = root.querySelector('.vcupbet-toggle');
    this.sideAControls = root.querySelector('.vcupbet-stakes-a');
    this.sideBControls = root.querySelector('.vcupbet-stakes-b');
    const stakes = (host: HTMLElement | null): HTMLButtonElement[] =>
      host ? Array.from(host.querySelectorAll<HTMLButtonElement>('button[data-stake]')) : [];
    this.stakeBtnsA = stakes(this.sideAControls);
    this.stakeBtnsB = stakes(this.sideBControls);
    // Fresh buttons: force the next update to re-apply the lock state to them.
    this.lockedA = null;
    this.lockedB = null;
  }

  private wire(): void {
    this.toggleEl?.addEventListener('click', () => {
      this.expanded = !this.expanded;
      this.applyExpanded();
    });
    const wireStakes = (btns: HTMLButtonElement[], side: 'A' | 'B'): void => {
      for (const btn of btns) {
        const copper = Number(btn.dataset.stake);
        btn.addEventListener('click', () => {
          // Belt and braces with `disabled`: never place a bet on a locked side.
          if (side === 'A' ? this.lockedA : this.lockedB) return;
          this.deps.onBet(side, copper);
        });
      }
    };
    wireStakes(this.stakeBtnsA, 'A');
    wireStakes(this.stakeBtnsB, 'B');
  }

  private applyExpanded(): void {
    const w = this.deps.writers;
    if (this.cardEl) w.setDisplay(this.cardEl, this.expanded ? 'block' : 'none');
    if (this.toggleEl) {
      w.setAttr(this.toggleEl, 'aria-expanded', this.expanded ? 'true' : 'false');
      w.setText(
        this.toggleEl,
        this.expanded ? t('hudChrome.vcup.bet.collapse') : t('hudChrome.vcup.bet.expand'),
      );
    }
  }

  private ensureRoot(): HTMLElement | null {
    if (this.root) return this.root;
    const layer = this.deps.layer();
    if (!layer) return null;
    const el = document.createElement('div');
    el.id = 'vcup-betting';
    el.setAttribute('aria-label', t('hudChrome.vcup.bet.aria'));
    layer.appendChild(el);
    this.root = el;
    return el;
  }

  // ---- HTML builders ---------------------------------------------------------

  private skeleton(view: VcupBettingView): string {
    const nameA = vcupNationName(view.nationA);
    const nameB = vcupNationName(view.nationB);
    return (
      `<div class="vcupbet-banner">` +
      `<div class="vcupbet-head">` +
      `<span class="vcupbet-title">${esc(t('hudChrome.vcup.bet.title'))}</span>` +
      `<span class="vcupbet-countdown" role="status" aria-live="off"></span>` +
      `</div>` +
      `<div class="vcupbet-matchup">` +
      `<span class="vcupbet-team a">${vcupFlagHtml(view.nationA, { cls: 'sm' })}` +
      `<span class="vcupbet-team-name">${esc(nameA)}</span></span>` +
      `<span class="vcupbet-vs">${esc(t('hudChrome.vcup.briefing.vs'))}</span>` +
      `<span class="vcupbet-team b">${vcupFlagHtml(view.nationB, { away: view.awayPalette, cls: 'sm' })}` +
      `<span class="vcupbet-team-name">${esc(nameB)}</span></span>` +
      `</div>` +
      `<div class="vcupbet-bar" role="img" aria-label="${esc(t('hudChrome.vcup.bet.splitAria'))}">` +
      `<span class="vcupbet-bar-a"></span></div>` +
      `<div class="vcupbet-split">` +
      `<span class="vcupbet-pct-a"></span>` +
      `<span class="vcupbet-prize"></span>` +
      `<span class="vcupbet-pct-b"></span>` +
      `</div>` +
      `<button type="button" class="vcupbet-toggle" aria-expanded="false"></button>` +
      `</div>` +
      `<div class="vcupbet-card">` +
      this.cardHtml(view, nameA, nameB) +
      `</div>`
    );
  }

  private cardHtml(view: VcupBettingView, nameA: string, nameB: string): string {
    return (
      `<div class="vcupbet-columns">` +
      this.sideHtml('A', nameA, view.teamA) +
      this.sideHtml('B', nameB, view.teamB) +
      `</div>` +
      `<div class="vcupbet-mine" role="status" aria-live="polite"></div>` +
      `<div class="vcupbet-record"></div>`
    );
  }

  private sideHtml(side: 'A' | 'B', nation: string, players: VcupBettingPlayer[]): string {
    const rows = players.map((p) => this.playerRowHtml(p)).join('');
    const lower = side === 'A' ? 'a' : 'b';
    const stakes = STAKES.map(
      (c) =>
        `<button type="button" class="vcupbet-stake" data-stake="${c}">${esc(formatMoney(c))}</button>`,
    ).join('');
    return (
      `<div class="vcupbet-col ${lower}">` +
      `<div class="vcupbet-col-head"><span class="vcupbet-col-name">${esc(nation)}</span>` +
      `<span class="vcupbet-col-odds">${esc(t('hudChrome.vcup.bet.oddsLabel'))} ` +
      `<b class="vcupbet-odds-${lower}"></b></span>` +
      `<span class="vcupbet-col-pool"><b class="vcupbet-pool-${lower}"></b></span></div>` +
      `<ul class="vcupbet-players">${rows}</ul>` +
      `<div class="vcupbet-stakes vcupbet-stakes-${lower}">` +
      `<span class="vcupbet-back">${esc(t('hudChrome.vcup.bet.back', { team: nation }))}</span>` +
      `<div class="vcupbet-stake-row">${stakes}</div></div>` +
      `</div>`
    );
  }

  private playerRowHtml(p: VcupBettingPlayer): string {
    const roleName = t(ROLE_NAME_KEYS[p.role]);
    const tag = p.bot
      ? `<span class="vcupbet-tag bot">${esc(t('hudChrome.vcup.briefing.bot'))}</span>`
      : '';
    // Lifetime form: only shown for real players (bots have no standing).
    const form = p.bot
      ? ''
      : `<span class="vcupbet-form">${esc(t('hudChrome.vcup.bet.form', { wins: num(p.wins), losses: num(p.losses) }))}</span>`;
    return (
      `<li class="vcupbet-player">` +
      `<span class="vcupbet-player-name">${esc(p.name)}${tag}</span>` +
      `<span class="vcupbet-player-role">${esc(roleName)}</span>${form}</li>`
    );
  }
}
