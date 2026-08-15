// The Dungeon Finder "group found" popup (docs/prd/dungeon-finder.md): the
// WoW-style timed prompt shown at the TOP of the screen, outside the finder
// window, when an availability proposal opens. Shows one meter per role slot
// (accepted/total, my slot highlighted), the answer countdown, and Accept /
// Decline. It never steals keyboard focus (the player may be fighting); the
// buttons are tab-reachable and localized.
//
// Perf contract: closed it does zero work (hud.update() gates on isOpen; it
// only ARMS from the dfProposal SimEvent). While open it polls the finder
// snapshot at the mediumHud cadence, rebuilds DOM only when the structural
// signature changes, refreshes the countdown text slot in place, and closes
// itself the moment the proposal resolves (formed, declined, or expired).
//
// Arrival order, the reason show() arms instead of opening outright: online,
// the dfProposal event rides the events frame while the proposal state rides
// the `df` self snapshot at its own 2 Hz cadence, so at show() time
// `dungeonFinderInfo.proposal` may trail the event by up to half a second
// (the battleground twin pins the shared ordering in
// tests/battleground_pop_wire_order.test.ts). Reading that gap as "proposal
// resolved" and closing is the queue-pop outage shape: while armed the root
// stays hidden but isOpen reports true so hud.update keeps polling until the
// snapshot lands, bounded by OFFER_SNAPSHOT_GRACE_POLLS.

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

/**
 * MediumHud polls (about 4 Hz) an armed popup waits for the proposal snapshot
 * before giving up: about five seconds, comfortably past the `df` key's 2 Hz
 * worst case. The bound only exists so a proposal that died before its first
 * snapshot cannot hold an invisible armed popup forever.
 */
export const OFFER_SNAPSHOT_GRACE_POLLS = 20;

export class DungeonFinderProposalPopup {
  private lastSig = '';
  private lastRemainingText = '';
  /** Polls left to wait for the proposal snapshot after show(); 0 = not armed. */
  private pendingPolls = 0;

  constructor(private readonly deps: DungeonFinderProposalPopupDeps) {}

  get isOpen(): boolean {
    return this.pendingPolls > 0 || this.deps.root().style.display === 'block';
  }

  // Armed from the dfProposal SimEvent (hud.handleEvents), with the prompt
  // cue. The DOM opens on the first render that can read the proposal.
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
    const view = buildFinderProposalPopupView(this.deps.world().dungeonFinderInfo);
    if (!view) {
      if (this.pendingPolls > 0) {
        // Armed: the proposal rode the events frame but its snapshot has not
        // landed yet. Wait it out (bounded) rather than reading the gap as a
        // resolved proposal; close() when the bound runs dry.
        this.pendingPolls--;
        if (this.pendingPolls === 0) this.close();
        return;
      }
      this.close();
      return;
    }
    const el = this.deps.root();
    if (el.style.display !== 'block') {
      // First readable proposal: take the DOM open here rather than in
      // show(), so the role=alert announcement carries a real prompt instead
      // of an empty box. The popup deliberately never steals focus (the
      // player may be fighting): role=alert announces the prompt where it
      // stands, without moving focus.
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
