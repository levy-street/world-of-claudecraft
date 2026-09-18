// Thin DOM painter for the weekly emissary's window (#weekly-quests-window).
//
// The consumer half of the pure-core + thin-painter split: weekly_quests_view.ts
// decides what every card and the confirm dialog say; this module owns the
// window lifecycle (open on the emissary's event, close, focus return), the
// inner confirm dialog, the one wall-clock read (the reset countdown), and the
// click that sends the authoritative pick through IWorld. It holds no Sim
// reference and reaches Hud only through its deps.
import { audio } from '../game/audio';
import { WEEKLY_QUESTS_BY_ID } from '../sim/content/weekly_quests';
import type { FactionId } from '../sim/factions';
import type { IWorld } from '../world_api';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { t } from './i18n';
import { svgIcon } from './ui_icons';
import {
  buildWeeklyQuestDialog,
  buildWeeklyQuestsView,
  type WeeklyCommendationView,
  type WeeklyQuestCardView,
  type WeeklyQuestDialogView,
} from './weekly_quests_view';

export interface WeeklyQuestsWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
}

export class WeeklyQuestsWindow {
  private opened = false;
  private dialogQuestId: string | null = null;
  private lastSig = '';
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: WeeklyQuestsWindowDeps) {}

  get isOpen(): boolean {
    return this.opened;
  }

  /** The emissary's talk event: open (or repaint) the window. */
  open(): void {
    if (!this.opened) {
      this.deps.closeOthers();
      this.openerFocus = this.deps.captureFocus();
      this.opened = true;
      this.dialogQuestId = null;
      audio.bagOpen();
    }
    this.lastSig = '';
    this.render('open');
    this.deps.root().style.display = 'flex';
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.dialogQuestId = null;
    this.deps.root().style.display = 'none';
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  // The repaint signature: the held pick and the dialog; the countdown repaints
  // on its own slow cadence below, so it stays out of the signature.
  private sig(): string {
    const world = this.deps.world();
    return JSON.stringify([
      world.weeklyQuest,
      world.weeklyQuestResetAtMs,
      this.dialogQuestId,
      world.factions,
      world.player.level,
    ]);
  }

  /** Slow-band refresh: repaint when the pick changes or every minute for the clock. */
  /** Language fan-out arm: the sheet is signature-gated on locale-free data,
   *  so a switch rebuilds it once here; render() re-latches the signature. */
  relocalize(): void {
    if (!this.opened) return;
    this.lastSig = '';
    this.render(null);
  }

  refreshIfChanged(): void {
    if (!this.opened) return;
    const sig = `${this.sig()}:${Math.floor(Date.now() / 60_000)}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.render(null);
  }

  private render(focus: 'open' | 'dialog' | null): void {
    const root = this.deps.root();
    const world = this.deps.world();
    const view = buildWeeklyQuestsView(world, Date.now());
    markDialogRoot(root, { labelledBy: 'weekly-quests-title' });
    const dialog =
      this.dialogQuestId && WEEKLY_QUESTS_BY_ID[this.dialogQuestId] && !world.weeklyQuest
        ? buildWeeklyQuestDialog(
            WEEKLY_QUESTS_BY_ID[this.dialogQuestId],
            world.player.level,
            view.resetText,
          )
        : null;
    if (!dialog) this.dialogQuestId = null;
    root.innerHTML =
      `<div class="panel-title wk-title"><span id="weekly-quests-title">${esc(view.title)}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.weekly.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="wk-sub">${esc(view.subtitle)} <b>${esc(view.resetText)}</b></div>` +
      `<div class="wk-cards">${view.cards.map((card) => this.cardHtml(card)).join('')}</div>` +
      // The finished charge swaps the footer line for the commendation strip.
      (view.commendation
        ? this.commendHtml(view.commendation)
        : `<div class="wk-foot">${esc(view.footer)}</div>`) +
      (dialog ? this.dialogHtml(dialog, view) : '');
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    root.querySelectorAll<HTMLButtonElement>('[data-wk-choose]').forEach((button) => {
      button.addEventListener('click', () => {
        this.dialogQuestId = button.dataset.wkChoose ?? null;
        this.lastSig = '';
        this.render('dialog');
      });
    });
    root.querySelector('[data-wk-accept]')?.addEventListener('click', () => {
      const questId = this.dialogQuestId;
      this.dialogQuestId = null;
      if (questId) world.chooseWeeklyQuest(questId);
      this.lastSig = '';
      this.render(null);
    });
    root.querySelector('[data-wk-decline]')?.addEventListener('click', () => {
      this.dialogQuestId = null;
      this.lastSig = '';
      this.render(null);
    });
    root.querySelectorAll<HTMLButtonElement>('[data-wk-commend]').forEach((button) => {
      button.addEventListener('click', () => {
        const factionId = button.dataset.wkCommend as FactionId | undefined;
        if (factionId) world.commendWeeklyQuest(factionId);
        this.lastSig = '';
        this.render(null);
      });
    });
    if (focus === 'open') (root.querySelector('[data-close]') as HTMLElement | null)?.focus();
    if (focus === 'dialog') (root.querySelector('[data-wk-accept]') as HTMLElement | null)?.focus();
  }

  private cardHtml(card: WeeklyQuestCardView): string {
    const disabled = card.state !== 'open';
    const buttonClass =
      card.state === 'active'
        ? 'wk-btn wk-btn-active'
        : card.state === 'completed'
          ? 'wk-btn wk-btn-done'
          : card.state === 'locked'
            ? 'wk-btn wk-btn-locked'
            : 'wk-btn';
    return (
      `<section class="wk-card wk-card-${card.state}" data-wk-card="${esc(card.id)}">` +
      `<div class="wk-cat">${esc(card.category)}</div>` +
      `<div class="wk-art" style="background-image:url('${esc(card.art)}')" role="img" aria-label="${esc(card.category)}">` +
      `<span class="wk-medal" style="background-image:url('${esc(card.medal)}')"></span></div>` +
      `<div class="wk-pill">${esc(card.difficulty)}</div>` +
      `<p class="wk-lore">${esc(card.lore)}</p>` +
      `<p class="wk-goal">${esc(card.goal)}</p>` +
      `<button type="button" class="${buttonClass}" data-wk-choose="${esc(card.id)}"${disabled ? ' disabled' : ''}>${esc(card.buttonLabel)}</button>` +
      `</section>`
    );
  }

  // The commendation strip in the footer's slot: one button per faction, off
  // while the faction has no headroom or once the week's choice is made.
  private commendHtml(view: WeeklyCommendationView): string {
    const claimedAny = view.claimedText !== null;
    const options = view.options
      .map(
        (option) =>
          `<button type="button" class="wk-btn${option.claimed ? ' wk-btn-done' : ''}" data-wk-commend="${esc(option.factionId)}"${option.capped || claimedAny ? ' disabled' : ''}>${esc(option.label)}</button>`,
      )
      .join('');
    return (
      `<section class="wk-commend"><span class="wk-commend-copy"><b class="wk-commend-heading">${esc(view.heading)}</b> ` +
      `<span class="wk-commend-note">${esc(view.claimedText ?? view.note)}</span></span>` +
      `<span class="wk-commend-options">${options}</span></section>`
    );
  }

  private dialogHtml(
    dialog: WeeklyQuestDialogView,
    view: { emissaryName: string; emissaryTitle: string; emissaryPortrait: string },
  ): string {
    return (
      `<div class="wk-backdrop"><div class="wk-dialog" role="dialog" aria-modal="true" aria-labelledby="weekly-quest-dialog-title">` +
      `<div class="wk-dialog-head"><span class="wk-portrait" style="background-image:url('${esc(view.emissaryPortrait)}')"></span>` +
      `<span class="wk-who"><span class="wk-who-name">${esc(view.emissaryName)}</span><span class="wk-who-title">${esc(view.emissaryTitle)}</span></span>` +
      `<button type="button" class="x-btn" data-wk-decline aria-label="${esc(t('hudChrome.weekly.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="wk-dialog-art" style="background-image:url('${esc(dialog.art)}')"></div>` +
      `<div class="wk-dialog-title" id="weekly-quest-dialog-title">${esc(dialog.heading)}</div>` +
      `<p class="wk-dialog-lore">${esc(dialog.lore)}</p>` +
      `<div class="wk-dialog-sub">${esc(t('hudChrome.weekly.objectives'))}</div>` +
      `<div class="wk-dialog-row"><span>${esc(dialog.goalLabel)}</span><b>${esc(dialog.goalCount)}</b></div>` +
      `<div class="wk-dialog-sub">${esc(t('hudChrome.weekly.rewards'))}</div>` +
      `<div class="wk-dialog-row"><span>${esc(t('hudChrome.weekly.alsoReceive'))}</span><b>${esc(dialog.rewardMoney)}</b></div>` +
      `<div class="wk-dialog-row wk-dialog-row-standing"><span>${esc(dialog.rewardStanding)}</span></div>` +
      `<div class="wk-reward"><span class="wk-reward-icon" style="background-image:url('${esc(dialog.rewardItemIcon)}')"></span><span><span class="wk-reward-name">${esc(dialog.rewardItem)}</span><span class="wk-reward-desc">${esc(dialog.rewardItemDesc)}</span></span></div>` +
      `<div class="wk-note">${esc(dialog.note)}</div>` +
      `<div class="wk-actions"><button type="button" class="wk-btn wk-btn-accept" data-wk-accept>${esc(dialog.accept)}</button>` +
      `<button type="button" class="wk-btn" data-wk-decline>${esc(dialog.decline)}</button></div>` +
      `</div></div>`
    );
  }
}
