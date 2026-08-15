// The Thornhollow Fields "battle ready" prompt: the timed Accept / Decline
// popup shown when a queue pop opens an offer. Deliberately the same component
// shape as the Dungeon Finder's proposal popup (src/ui/dungeon_finder_proposal_popup.ts),
// because it is the same question asked the same way, and two queues that
// prompt differently would read as a bug.
//
// It never steals keyboard focus (the player may be mid-fight), so the buttons
// are tab-reachable and the prompt announces itself where it stands via
// role=alert instead of moving focus.
//
// Perf contract: closed it does zero work (hud.update() gates on isOpen; it only
// OPENS from the bgProposed SimEvent). While open it polls the battleground
// snapshot at the mediumHud cadence, rebuilds DOM only when the structural
// signature changes, refreshes the countdown text slot in place, and closes
// itself the moment the offer resolves (seated, declined, or lapsed).

import { audio } from '../../../game/audio';
import type { IWorld } from '../../../world_api';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import { svgIcon } from '../../ui_icons';
import { type BgProposalPopupView, buildBgProposalPopupView } from './battleground_proposal_view';

export interface BgProposalPopupDeps {
  root(): HTMLElement;
  world(): IWorld;
}

function num(v: number): string {
  return formatNumber(v, { maximumFractionDigits: 0, useGrouping: false });
}

export class BgProposalPopup {
  private lastSig = '';
  private lastRemainingText = '';

  constructor(private readonly deps: BgProposalPopupDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  /** Opened from the bgProposed SimEvent (hud.handleEvents), with the cue. */
  show(): void {
    if (!this.isOpen) {
      const root = this.deps.root();
      // A screen reader would otherwise miss the whole 30 second answer window,
      // since the prompt never moves focus.
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
    const view = buildBgProposalPopupView(this.deps.world().bgInfo);
    if (!view) {
      // The offer resolved (seated, declined, or lapsed): the snapshot dropping
      // it is the close signal, so no event needs to carry one.
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
    const remainingText = t('hudChrome.bgOffer.remaining', { seconds: num(view.remaining) });
    if (remainingText !== this.lastRemainingText) {
      this.lastRemainingText = remainingText;
      const slot = el.querySelector('[data-bgp-clock]');
      if (slot) slot.textContent = remainingText;
    }
  }

  private wire(el: HTMLElement): void {
    el.querySelector('[data-bgp="accept"]')?.addEventListener('click', () => {
      this.deps.world().bgRespond(true);
      audio.click();
    });
    el.querySelector('[data-bgp="decline"]')?.addEventListener('click', () => {
      this.deps.world().bgRespond(false);
      audio.click();
    });
  }

  private html(view: BgProposalPopupView): string {
    const tally = t('hudChrome.bgOffer.accepted', {
      accepted: num(view.accepted),
      size: num(view.size),
    });
    const actions =
      view.myResponse === 'pending'
        ? `<div class="bgp-actions">` +
          `<button type="button" class="btn bgp-accept" data-bgp="accept">${svgIcon('check')}${esc(t('hudChrome.bgOffer.accept'))}</button>` +
          `<button type="button" class="btn bgp-decline" data-bgp="decline">${svgIcon('close')}${esc(t('hudChrome.bgOffer.decline'))}</button></div>`
        : `<div class="bgp-waiting">${esc(t('hudChrome.bgOffer.acceptedWait'))}</div>`;
    // A backfill is a materially different offer: a live match, a scoreline the
    // joiner had no part in, and no rating either way. The chat line says so
    // too, but that is the surface that scrolls away mid-fight, so consent has
    // to be answerable from the prompt itself.
    const isBackfill = view.kind === 'backfill';
    const title = t(isBackfill ? 'hudChrome.bgOffer.backfillTitle' : 'hudChrome.bgOffer.title');
    const body = isBackfill
      ? `<div class="bgp-body">${esc(t('hudChrome.bgOffer.backfillBody'))}</div>`
      : '';
    return (
      `<div class="bgp-head">${svgIcon('battleground')}<span class="bgp-title">${esc(title)}</span></div>` +
      body +
      `<div class="bgp-tally${view.full ? ' full' : ''}" aria-label="${esc(tally)}">${esc(tally)}</div>` +
      `<div class="bgp-remaining" data-bgp-clock role="timer"></div>` +
      actions
    );
  }
}
