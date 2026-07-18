// Thin DOM painter for the Card Duel minigame window (the Card Master NPC).
//
// The consumer half of the pure-core + thin-painter split (ValeCupWindow /
// ArenaWindow shape, scaled down: no bracket tabs, just three states). It
// paints #card-duel-window from the structured CardDuelViewModel
// (card_duel_view.ts) and wires the join/leave/play-card dispatch back
// through IWorld + injected callbacks. It holds no Sim reference and reaches
// into Hud only through its deps.

import type { IWorld } from '../world_api';
import { buildCardDuelView, type CardDuelViewModel } from './card_duel_view';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';

export interface CardDuelWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

export class CardDuelWindow {
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: CardDuelWindowDeps) {}

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
    markDialogRoot(root, { labelledBy: 'card-duel-title' });
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

  // Re-localize after an in-game language switch: clearing the sig forces
  // exactly one rebuild with fresh t(). Self-gated on isOpen so the language
  // fan-out can call it unconditionally.
  relocalize(): void {
    if (!this.isOpen) return;
    this.lastSig = '';
    this.render();
  }

  render(): void {
    if (!this.isOpen) return;
    const world = this.deps.world();
    const view = buildCardDuelView(world.cardMinigameInfo);
    const sig = JSON.stringify(view);
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    const el = this.deps.root();
    el.innerHTML = this.html(view);
    this.wire(el, world);
  }

  private html(view: CardDuelViewModel): string {
    let body = '';
    if (view.state === 'unavailable') {
      body = `<div class="cd-status">${esc(t('cardDuel.unavailable'))}</div>`;
    } else if (view.state === 'idle') {
      body = `<button type="button" class="cd-action-btn" data-join aria-label="${esc(t('cardDuel.joinAria'))}">${esc(t('cardDuel.join'))}</button>`;
    } else if (view.state === 'queued') {
      body =
        `<div class="cd-status">${esc(t('cardDuel.queued'))}</div>` +
        `<button type="button" class="cd-action-btn" data-leave aria-label="${esc(t('cardDuel.leaveAria'))}">${esc(t('cardDuel.leave'))}</button>`;
    } else {
      const roundText = esc(
        t('cardDuel.round', {
          mine: formatNumber(view.myRounds, { maximumFractionDigits: 0 }),
          theirs: formatNumber(view.opponentRounds, { maximumFractionDigits: 0 }),
        }),
      );
      const oppText = esc(t('cardDuel.vsOpponent', { name: view.opponentName }));
      const turnText = esc(
        t(view.waitingOnOpponent ? 'cardDuel.waitingOnOpponent' : 'cardDuel.yourTurn'),
      );
      const hand = view.hand
        .map(
          (card) =>
            `<button type="button" class="cd-card" data-play="${card.value}" ${
              card.playable ? '' : 'disabled'
            } aria-label="${esc(t('cardDuel.playCardAria', { value: formatNumber(card.value, { maximumFractionDigits: 0 }) }))}">${formatNumber(card.value, { maximumFractionDigits: 0 })}</button>`,
        )
        .join('');
      const counts = esc(
        t('cardDuel.counts', {
          deck: formatNumber(view.deckCount, { maximumFractionDigits: 0 }),
          discard: formatNumber(view.discardCount, { maximumFractionDigits: 0 }),
        }),
      );
      const forfeitBtn = `<button type="button" class="cd-action-btn" data-forfeit aria-label="${esc(t('cardDuel.forfeitAria'))}">${esc(t('cardDuel.forfeit'))}</button>`;
      body =
        `<div class="cd-opponent">${oppText}</div>` +
        `<div class="cd-status">${roundText}</div>` +
        `<div class="cd-status cd-turn">${turnText}</div>` +
        `<div class="cd-hand">${hand}</div>` +
        `<div class="cd-counts">${counts}</div>` +
        forfeitBtn;
    }
    return (
      `<div class="panel-title"><span id="card-duel-title">${esc(t('cardDuel.title'))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('cardDuel.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="cd-body">${body}</div>`
    );
  }

  private wire(el: HTMLElement, world: IWorld): void {
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    el.querySelector('[data-join]')?.addEventListener('click', () => world.joinCardDuelQueue());
    el.querySelector('[data-leave]')?.addEventListener('click', () => world.leaveCardDuelQueue());
    el.querySelector('[data-forfeit]')?.addEventListener('click', () => world.forfeitCardDuel());
    el.querySelectorAll('[data-play]:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        const value = Number((btn as HTMLElement).dataset.play);
        world.playCardInDuel(value);
      });
    });
  }
}
