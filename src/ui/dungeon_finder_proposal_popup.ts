// The Dungeon Finder "group found" popup (docs/prd/dungeon-finder.md): the
// WoW-style timed prompt shown at the TOP of the screen, outside the finder
// window, when an availability proposal opens. Shows one meter per role slot
// (accepted/total, my slot highlighted), the answer countdown, and Accept /
// Decline. It never steals keyboard focus (the player may be fighting); the
// buttons are tab-reachable and localized.
//
// Perf contract: closed it does zero work (hud.update() gates on isOpen; it
// only OPENS from the dfProposal SimEvent). While open it polls the finder
// snapshot at the mediumHud cadence, rebuilds DOM only when the structural
// signature changes, refreshes the countdown text slot in place, and closes
// itself the moment the proposal resolves (formed, declined, or expired).

import { audio } from '../game/audio';
import type { IWorld } from '../world_api';
import { buildFinderProposalPopupView, type FinderProposalPopupView } from './dungeon_finder_view';
import { dungeonDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';

export interface DungeonFinderProposalPopupDeps {
  root(): HTMLElement;
  world(): IWorld;
}

export class DungeonFinderProposalPopup {
  private lastSig = '';
  private lastRemainingText = '';

  constructor(private readonly deps: DungeonFinderProposalPopupDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  // Opened from the dfProposal SimEvent (hud.handleEvents), with the prompt cue.
  show(): void {
    if (!this.isOpen) {
      const root = this.deps.root();
      // The popup deliberately never steals focus (the player may be fighting), so
      // a screen reader would otherwise miss the whole 30-second answer window:
      // role=alert announces the prompt where it stands, without moving focus.
      root.setAttribute('role', 'alert');
      root.setAttribute('aria-live', 'assertive');
      root.style.display = 'block';
      audio.duelChallenge();
    }
    this.lastSig = '';
    this.render();
  }

  close(): void {
    const el = this.deps.root();
    if (el.style.display !== 'block') return;
    el.style.display = 'none';
    el.innerHTML = '';
    this.lastSig = '';
    this.lastRemainingText = '';
  }

  relocalize(): void {
    if (!this.isOpen) return;
    this.lastSig = '';
    this.render();
  }

  render(): void {
    if (!this.isOpen) return;
    const view = buildFinderProposalPopupView(this.deps.world().dungeonFinderInfo);
    if (!view) {
      this.close();
      return;
    }
    const el = this.deps.root();
    if (view.sig !== this.lastSig) {
      this.lastSig = view.sig;
      this.lastRemainingText = '';
      el.innerHTML = this.html(view);
      this.wire(el);
    }
    const remainingText = t('hudChrome.finder.remaining', {
      seconds: formatNumber(view.remaining, { maximumFractionDigits: 0, useGrouping: false }),
    });
    if (remainingText !== this.lastRemainingText) {
      this.lastRemainingText = remainingText;
      const slot = el.querySelector('[data-dfp-clock]');
      if (slot) slot.textContent = remainingText;
    }
  }

  private wire(el: HTMLElement): void {
    el.querySelector('[data-dfp="accept"]')?.addEventListener('click', () => {
      this.deps.world().dungeonFinderRespond(true);
      audio.click();
    });
    el.querySelector('[data-dfp="decline"]')?.addEventListener('click', () => {
      this.deps.world().dungeonFinderRespond(false);
      audio.click();
    });
  }

  private html(view: FinderProposalPopupView): string {
    const name = dungeonDisplayName(view.dungeonId);
    const badge = `<span class="df-badge${view.difficulty === 'heroic' ? ' heroic' : ''}">${esc(
      view.difficulty === 'heroic' ? t('hudChrome.finder.heroic') : t('hudChrome.finder.normal'),
    )}</span>`;
    const slots = view.slots
      .map((s) => {
        const full = s.accepted >= s.total;
        const label = t('hudChrome.finder.slotState', {
          role: this.roleLabel(s.role),
          accepted: num(s.accepted),
          total: num(s.total),
        });
        return (
          `<span class="dfp-slot${s.mine ? ' mine' : ''}${full ? ' full' : ''}" title="${esc(label)}" aria-label="${esc(label)}">` +
          `${svgIcon(s.role === 'tank' ? 'tank' : s.role === 'healer' ? 'healer' : 'attack')}` +
          `<span class="dfp-count">${esc(
            t('hudChrome.finder.slots', { size: num(s.accepted), capacity: num(s.total) }),
          )}</span></span>`
        );
      })
      .join('');
    const actions =
      view.myResponse === 'pending'
        ? `<div class="dfp-actions">` +
          `<button type="button" class="btn df-accept" data-dfp="accept">${svgIcon('check')}${esc(t('hudChrome.finder.accept'))}</button>` +
          `<button type="button" class="btn df-decline" data-dfp="decline">${svgIcon('close')}${esc(t('hudChrome.finder.decline'))}</button></div>`
        : `<div class="dfp-waiting">${esc(t('hudChrome.finder.acceptedWait'))}</div>`;
    return (
      `<div class="dfp-head">${svgIcon('dfinder')}<span class="dfp-title">${esc(
        t('hudChrome.finder.proposalTitle', { name }),
      )}</span>${badge}</div>` +
      `<div class="dfp-slots">${slots}</div>` +
      `<div class="dfp-remaining" data-dfp-clock role="timer"></div>` +
      actions
    );
  }

  private roleLabel(role: 'tank' | 'healer' | 'dps'): string {
    if (role === 'tank') return t('hudChrome.finder.roleTank');
    if (role === 'healer') return t('hudChrome.finder.roleHealer');
    return t('hudChrome.finder.roleDps');
  }
}

function num(v: number): string {
  return formatNumber(v, { maximumFractionDigits: 0, useGrouping: false });
}
