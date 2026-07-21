// Thin DOM painter for the Vale Cup pre-match BRIEFING overlay (the ValeCupHud
// self-mounting-painter pattern; docs/prd/vale-cup.md). A centered festival
// card shown while cupInfo.match.phase === 'briefing': the two banners flanking
// a VS header, a rules panel, your role kit (icon + name + one-line teach), the
// team sheet with ready checks, and a large Ready button + auto-ready countdown.
//
// Per-frame contract (src/ui/CLAUDE.md): the SKELETON (header / rules / kit /
// roster structure) is a sig-gated innerHTML rebuild, keyed on the STRUCTURAL
// sig (nations, my side/role, the roster identity) so it never rebuilds on the
// second-by-second tick. Everything that moves each tick rides the PainterHost
// ELIDED writers: the countdown text (setText), the ready count (setText), each
// fighter's ready checkmark (toggleClass), and the Ready button state
// (setText / setAttr / toggleClass). The Ready button is a real <button> wired
// ONCE on skeleton build.
//
// NOT dismissable: the briefing auto-proceeds to kickoff when every fighter is
// ready or the timer expires, so there is no close control and Esc is NOT wired
// to it (it is not registered with Hud's closeAll dispatcher). WCAG: the card is
// a role=dialog labelled by its title and the Ready button is focused on open;
// the countdown is a role=status region kept aria-live="off" so the per-second
// tick never spams a screen reader (the visible text and focused button carry
// the affordance). Colors live in the stylesheet; flag colors are the documented
// data-driven custom-property exception (vale_cup_flag.ts).

import type { SportRole } from '../sim/types';
import { markDialogRoot } from './dialog_root';
import { tEntity } from './entity_i18n';
import { esc } from './esc';
import { formatMoney, formatNumber, type TranslationKey, t } from './i18n';
import { iconDataUrl } from './icons';
import type { PainterHostWriters } from './painter_host';
import type { VcupBriefingPlayer, VcupBriefingView } from './vale_cup_briefing_view';
import { vcupFlagHtml } from './vale_cup_flag';
import { vcupNationName } from './vale_cup_window';

const num = (n: number): string => formatNumber(n, { maximumFractionDigits: 0 });

// Role display-name keys (the window keeps its own private copy; this is the
// second, so the rule of three has not yet earned a shared module).
const ROLE_NAME_KEYS: Record<SportRole, TranslationKey> = {
  allrounder: 'hudChrome.vcup.role.allrounder.name',
  striker: 'hudChrome.vcup.role.striker.name',
  sweeper: 'hudChrome.vcup.role.sweeper.name',
  keeper: 'hudChrome.vcup.role.keeper.name',
};

const RULE_KEYS: readonly TranslationKey[] = [
  'hudChrome.vcup.briefing.rule1',
  'hudChrome.vcup.briefing.rule2',
  'hudChrome.vcup.briefing.rule3',
  'hudChrome.vcup.briefing.rule4',
  'hudChrome.vcup.briefing.rule5',
];

export interface ValeCupBriefingDeps {
  /** The HUD layer the overlay mounts into (the #ui element). */
  layer(): HTMLElement | null;
  writers: PainterHostWriters;
  /** Ready up (world.vcupReady()); wired once on skeleton build. */
  onReady(): void;
}

export class ValeCupBriefing {
  private root: HTMLElement | null = null;
  private lastSig = '';
  private shown = false;
  // Mirrors view.iAmReady so the once-wired click handler ignores a repeat ready.
  private iAmReady = false;
  // Per-tick element refs, resolved once per skeleton rebuild.
  private readyBtn: HTMLButtonElement | null = null;
  private readyLabelEl: HTMLElement | null = null;
  private whistleEl: HTMLElement | null = null;
  private readyCountEl: HTMLElement | null = null;
  private waitingEl: HTMLElement | null = null;
  private betsEl: HTMLElement | null = null;
  // Roster rows in view order ([...teamA, ...teamB]) for the elided ready toggle.
  private rowEls: HTMLElement[] = [];

  constructor(private readonly deps: ValeCupBriefingDeps) {}

  update(view: VcupBriefingView): void {
    const w = this.deps.writers;
    if (!view.visible) {
      if (this.root) w.setDisplay(this.root, 'none');
      this.lastSig = view.sig;
      this.shown = false;
      return;
    }
    const root = this.ensureRoot();
    if (!root) return;
    w.setDisplay(root, 'flex');

    if (view.sig !== this.lastSig) {
      this.lastSig = view.sig;
      root.innerHTML = this.skeleton(view);
      this.readyBtn = root.querySelector('.vcupb-ready');
      this.readyLabelEl = root.querySelector('.vcupb-ready-label');
      this.whistleEl = root.querySelector('.vcupb-whistle');
      this.readyCountEl = root.querySelector('.vcupb-ready-count');
      this.waitingEl = root.querySelector('.vcupb-waiting');
      this.betsEl = root.querySelector('.vcupb-bets');
      this.rowEls = Array.from(root.querySelectorAll<HTMLElement>('.vcupb-player'));
      // Wire the Ready button exactly once per skeleton (arena/window pattern).
      // Guarded on the mirrored ready flag so a repeat click is a no-op.
      this.readyBtn?.addEventListener('click', () => {
        if (this.iAmReady) return;
        this.deps.onReady();
      });
    }

    // First appearance (or a structural rebuild while hidden): focus the Ready
    // button for keyboard users (WCAG). A rebuild while already shown (a roster
    // change) does not steal focus.
    if (!this.shown) {
      this.shown = true;
      this.readyBtn?.focus();
    }

    // ---- Per-tick elided writes (no DOM churn on an unchanged value) --------
    const rows: VcupBriefingPlayer[] = [...view.teamA, ...view.teamB];
    let readyCount = 0;
    for (let i = 0; i < this.rowEls.length && i < rows.length; i++) {
      const ready = rows[i].ready;
      if (ready) readyCount++;
      w.toggleClass(this.rowEls[i], 'ready', ready);
    }
    if (this.readyCountEl) {
      w.setText(
        this.readyCountEl,
        t('hudChrome.vcup.briefing.readyCount', {
          ready: num(readyCount),
          total: num(rows.length),
        }),
      );
    }
    if (this.whistleEl) {
      w.setText(
        this.whistleEl,
        t('hudChrome.vcup.briefing.whistle', { seconds: num(view.briefingLeft) }),
      );
    }
    this.iAmReady = view.iAmReady;
    if (this.readyBtn && this.readyLabelEl) {
      w.toggleClass(this.readyBtn, 'done', view.iAmReady);
      w.setAttr(this.readyBtn, 'aria-pressed', view.iAmReady ? 'true' : 'false');
      w.setAttr(this.readyBtn, 'aria-disabled', view.iAmReady ? 'true' : 'false');
      w.setText(
        this.readyLabelEl,
        view.iAmReady ? t('hudChrome.vcup.briefing.readyDone') : t('hudChrome.vcup.briefing.ready'),
      );
    }
    if (this.waitingEl) w.setDisplay(this.waitingEl, view.iAmReady ? 'block' : 'none');
    // Live crowd bets rolling in during the ready-up window (composed from
    // already-localized pieces + numbers, so it needs no new wordy string).
    if (this.betsEl) {
      const total = view.poolA + view.poolB;
      if (total > 0) {
        w.setDisplay(this.betsEl, 'block');
        const pctA = Math.round((view.poolA / total) * 100);
        w.setText(
          this.betsEl,
          `${t('hudChrome.vcup.bet.title')}: ${vcupNationName(view.nationA)} ${num(pctA)}% / ` +
            `${num(100 - pctA)}% ${vcupNationName(view.nationB)} · ` +
            t('hudChrome.vcup.bet.prize', { amount: formatMoney(total) }),
        );
      } else {
        w.setDisplay(this.betsEl, 'none');
      }
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
    el.id = 'vcup-briefing';
    // A non-dismissable pre-match dialog: labelled by its title, focus lands on
    // the Ready button on open; aria-modal stays false (the live pitch shows
    // underneath and the player is already placed on it, so the page is not
    // inerted). markDialogRoot writes the static aria once; it is byte-identical
    // across rebuilds, so it stays outside the elided per-tick path.
    markDialogRoot(el, { labelledBy: 'vcupb-title' });
    layer.appendChild(el);
    this.root = el;
    return el;
  }

  // ---- HTML builders (the localized DOM the pure view-model drives) ----------

  private skeleton(view: VcupBriefingView): string {
    return (
      `<div class="vcupb-card">` +
      this.headerHtml(view) +
      `<div class="vcupb-panels">` +
      this.rulesHtml() +
      this.kitHtml(view) +
      this.rosterHtml(view) +
      `</div>` +
      this.footerHtml() +
      `</div>`
    );
  }

  private headerHtml(view: VcupBriefingView): string {
    const nameA = vcupNationName(view.nationA);
    const nameB = vcupNationName(view.nationB);
    const format = t('hudChrome.vcup.bracketLabel', { n: num(view.format) });
    const mineA = view.myTeam === 'A' ? ' mine' : '';
    const mineB = view.myTeam === 'B' ? ' mine' : '';
    return (
      `<div class="vcupb-header">` +
      `<div class="vcupb-title-row">` +
      `<span id="vcupb-title" class="vcupb-title">${esc(t('hudChrome.vcup.title'))}</span>` +
      `<span class="vcupb-subtitle">${esc(t('hudChrome.vcup.briefing.subtitle'))}</span>` +
      `</div>` +
      `<div class="vcupb-matchup">` +
      `<span class="vcupb-team a${mineA}">${vcupFlagHtml(view.nationA, { cls: 'xl' })}` +
      `<span class="vcupb-team-name">${esc(nameA)}</span></span>` +
      `<span class="vcupb-vs"><span class="vcupb-vs-word">${esc(t('hudChrome.vcup.briefing.vs'))}</span>` +
      `<span class="vcupb-format">${esc(format)}</span></span>` +
      `<span class="vcupb-team b${mineB}">${vcupFlagHtml(view.nationB, { away: view.awayPalette, cls: 'xl' })}` +
      `<span class="vcupb-team-name">${esc(nameB)}</span></span>` +
      `</div></div>`
    );
  }

  private rulesHtml(): string {
    const rows = RULE_KEYS.map(
      (key, i) =>
        `<li class="vcupb-rule"><span class="vcupb-rule-mark r${i + 1}" aria-hidden="true"></span>` +
        `<span class="vcupb-rule-text">${esc(t(key))}</span></li>`,
    ).join('');
    return (
      `<section class="vcupb-panel vcupb-rules">` +
      `<h3 class="vcupb-panel-title">${esc(t('hudChrome.vcup.briefing.rulesHeading'))}</h3>` +
      `<ul class="vcupb-rule-list">${rows}</ul></section>`
    );
  }

  private kitHtml(view: VcupBriefingView): string {
    const roleName = view.myRole ? t(ROLE_NAME_KEYS[view.myRole]) : t(ROLE_NAME_KEYS.allrounder);
    const abilities = view.kit
      .map((k) => {
        const name = tEntity({ kind: 'ability', id: k.abilityId, field: 'name' });
        const desc = tEntity({ kind: 'ability', id: k.abilityId, field: 'description' });
        return (
          `<li class="vcupb-ability">` +
          `<span class="vcupb-ability-icon" style="background-image:url(${iconDataUrl('ability', k.abilityId)})" aria-hidden="true"></span>` +
          `<span class="vcupb-ability-text"><span class="vcupb-ability-name">${esc(name)}</span>` +
          `<span class="vcupb-ability-desc">${esc(desc)}</span></span></li>`
        );
      })
      .join('');
    return (
      `<section class="vcupb-panel vcupb-kit">` +
      `<h3 class="vcupb-panel-title">${esc(t('hudChrome.vcup.briefing.kitHeading'))}` +
      `<span class="vcupb-kit-role">${esc(roleName)}</span></h3>` +
      `<ul class="vcupb-ability-list">${abilities}</ul>` +
      `<p class="vcupb-kit-note">${esc(t('hudChrome.vcup.briefing.kitNote'))}</p></section>`
    );
  }

  private rosterHtml(view: VcupBriefingView): string {
    const nameA = vcupNationName(view.nationA);
    const nameB = vcupNationName(view.nationB);
    const teamHtml = (
      players: VcupBriefingPlayer[],
      nation: string,
      side: 'a' | 'b',
      mine: boolean,
    ): string => {
      const rows = players.map((p) => this.playerRowHtml(p)).join('');
      return (
        `<div class="vcupb-team-col ${side}${mine ? ' mine' : ''}">` +
        `<div class="vcupb-team-head">${esc(nation)}</div>` +
        `<ul class="vcupb-player-list">${rows}</ul></div>`
      );
    };
    return (
      `<section class="vcupb-panel vcupb-roster">` +
      `<h3 class="vcupb-panel-title">${esc(t('hudChrome.vcup.briefing.rosterHeading'))}` +
      `<span class="vcupb-ready-count"></span></h3>` +
      `<div class="vcupb-teams">` +
      teamHtml(view.teamA, nameA, 'a', view.myTeam === 'A') +
      teamHtml(view.teamB, nameB, 'b', view.myTeam === 'B') +
      `</div></section>`
    );
  }

  private playerRowHtml(p: VcupBriefingPlayer): string {
    const roleName = t(ROLE_NAME_KEYS[p.role]);
    const tag = p.me
      ? `<span class="vcupb-tag you">${esc(t('hudChrome.vcup.briefing.you'))}</span>`
      : p.bot
        ? `<span class="vcupb-tag bot">${esc(t('hudChrome.vcup.briefing.bot'))}</span>`
        : '';
    return (
      `<li class="vcupb-player${p.me ? ' me' : ''}">` +
      `<span class="vcupb-check" aria-hidden="true"></span>` +
      `<span class="vcupb-player-name">${esc(p.name)}${tag}</span>` +
      `<span class="vcupb-player-role">${esc(roleName)}</span></li>`
    );
  }

  private footerHtml(): string {
    return (
      `<div class="vcupb-footer">` +
      `<button type="button" class="btn vcupb-ready" aria-pressed="false" aria-label="${esc(t('hudChrome.vcup.briefing.readyAria'))}">` +
      `<span class="vcupb-ready-label">${esc(t('hudChrome.vcup.briefing.ready'))}</span></button>` +
      `<div class="vcupb-status">` +
      `<span class="vcupb-whistle" role="status" aria-live="off"></span>` +
      `<span class="vcupb-waiting">${esc(t('hudChrome.vcup.briefing.waiting'))}</span>` +
      `<span class="vcupb-bets" role="status" aria-live="off"></span>` +
      `</div></div>`
    );
  }
}
