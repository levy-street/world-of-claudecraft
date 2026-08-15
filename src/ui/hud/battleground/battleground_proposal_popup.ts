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
// ARMS from the bgProposed SimEvent). While open it polls the battleground
// snapshot at the mediumHud cadence, rebuilds DOM only when the structural
// signature changes, refreshes the countdown text slot in place, and closes
// itself the moment the offer resolves (seated, declined, or lapsed).
//
// Arrival order, the reason show() arms instead of opening outright: online,
// the bgProposed event rides the events frame while the offer state rides the
// next `bg` self snapshot, so at show() time `bgInfo.proposal` may not have
// arrived yet (tests/battleground_pop_wire_order.test.ts pins the ordering).
// Reading that gap as "offer resolved" and closing is the v0.36.0 queue-pop
// outage: the popup never showed, silence counted as a decline, and no match
// could seat. While armed the root stays hidden (there is nothing truthful to
// paint) but isOpen reports true so hud.update keeps polling until the
// snapshot lands, bounded by OFFER_SNAPSHOT_GRACE_POLLS.

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

/**
 * MediumHud polls (about 4 Hz) an armed popup waits for the offer snapshot
 * before giving up: about five seconds. The snapshot normally lands within a
 * frame of the event (the server resets the bg readout throttle as it
 * delivers bgProposed); the bound only exists so an offer that died before
 * its first snapshot cannot hold an invisible armed popup forever.
 */
export const OFFER_SNAPSHOT_GRACE_POLLS = 20;

function num(v: number): string {
  return formatNumber(v, { maximumFractionDigits: 0, useGrouping: false });
}

export class BgProposalPopup {
  private lastSig = '';
  private lastRemainingText = '';
  /** Polls left to wait for the offer snapshot after show(); 0 = not armed. */
  private pendingPolls = 0;

  constructor(private readonly deps: BgProposalPopupDeps) {}

  get isOpen(): boolean {
    return this.pendingPolls > 0 || this.deps.root().style.display === 'block';
  }

  /** Armed from the bgProposed SimEvent (hud.handleEvents), with the cue. The
   *  DOM opens on the first render that can read the offer (see header). */
  show(): void {
    if (!this.isOpen) audio.duelChallenge();
    this.pendingPolls = OFFER_SNAPSHOT_GRACE_POLLS;
    this.lastSig = '';
    this.render();
  }

  close(): void {
    this.pendingPolls = 0;
    const el = this.deps.root();
    if (el.style.display !== 'block') return;
    el.style.display = 'none';
    el.innerHTML = '';
    this.lastSig = '';
    this.lastRemainingText = '';
  }

  relocalize(): void {
    // Displayed, not isOpen: an armed popup has no painted text to re-localize,
    // and running render() from here would burn one of its grace polls.
    if (this.deps.root().style.display !== 'block') return;
    this.lastSig = '';
    this.render();
  }

  render(): void {
    if (!this.isOpen) return;
    const view = buildBgProposalPopupView(this.deps.world().bgInfo);
    if (!view) {
      if (this.pendingPolls > 0) {
        // Armed: the offer rode the events frame but its snapshot has not
        // landed yet. Wait it out (bounded) rather than reading the gap as a
        // resolved offer; close() when the bound runs dry.
        this.pendingPolls--;
        if (this.pendingPolls === 0) this.close();
        return;
      }
      // The offer resolved (seated, declined, or lapsed): the snapshot dropping
      // it is the close signal, so no event needs to carry one.
      this.close();
      return;
    }
    const el = this.deps.root();
    if (el.style.display !== 'block') {
      // First readable offer: take the DOM open here rather than in show(),
      // so the role=alert announcement carries a real prompt instead of an
      // empty box. A screen reader would otherwise miss the whole 30 second
      // answer window, since the prompt never moves focus.
      el.setAttribute('role', 'alert');
      el.setAttribute('aria-live', 'assertive');
      el.style.display = 'block';
    }
    this.pendingPolls = 0;
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
