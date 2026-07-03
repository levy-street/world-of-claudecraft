// Thin DOM painter for the quest-log window.
//
// The consumer half of the pure-core + thin-painter split: it paints
// #quest-log-window from the structured QuestLogView (questlog_view.ts) and owns
// the window's view-state (the painter-owned selected quest id, the WCAG focus
// opener) plus the DOM wiring (per-row select / shift-link listeners, the reward
// tooltip, the abandon confirm flow). The pure core decides the list rows, the
// resolved selection, and the selected quest's detail structure; this module
// renders that, resolves the localized titles / objective labels / narrative /
// reward name, and routes abandon + chat-link commands back through IWorld +
// injected callbacks. It holds no Sim reference and reaches into Hud only through
// its deps.
//
// This is the quest LOG window, not the always-on quest TRACKER (quest_tracker.ts,
// a separate pure core). It is NOT a canvas window (colors live in the extracted
// stylesheet; the per-quality reward color comes from the shared QUALITY_COLOR
// map, the fallback is a CSS token, so there is no literal hex/px in TS).

import { ITEMS, NPCS } from '../sim/data';
import type { IWorld } from '../world_api';
import { markDialogRoot } from './dialog_root';
import { itemDisplayName, tEntity } from './entity_i18n';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { QUALITY_COLOR } from './icons';
import type { PainterHostPresentation } from './painter_host';
import { buildQuestLogView, type QuestDetailModel } from './questlog_view';
import { svgIcon } from './ui_icons';

// The reward-name color comes from the shared QUALITY_COLOR map; this token covers
// an unknown quality, so the painter carries no literal hex.
const QUALITY_DEFAULT_COLOR = 'var(--color-quality-default)';

/**
 * Hud-supplied glue. The quest log renders from IWorld + these callbacks plus the
 * shared presentation bag (itemIcon / moneyHtml / itemTooltip / attachTooltip) for
 * the reward row. captureFocus/restoreFocus carry the inline window's focus-return;
 * confirmDialog / insertQuestChatLink / focusFirstInteractive route the shared HUD
 * chrome.
 */
export interface QuestLogWindowDeps extends PainterHostPresentation {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  hideTooltip(): void;
  focusFirstInteractive(root: HTMLElement, preferredSelector?: string): void;
  confirmDialog(
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
  ): void;
  insertQuestChatLink(questId: string): void;
}

export class QuestLogWindow {
  // The selected quest id. Hud's "/share" command reads it through `selectedQuestId`
  // (it links the selected quest into party chat), so the painter owns the single
  // source of truth and Hud reads it back, mirroring the inline window's field.
  private selected: string | null = null;
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: QuestLogWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  /** The currently selected quest id (read by Hud's quest-share command). */
  get selectedQuestId(): string | null {
    return this.selected;
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    this.render();
    this.deps.root().style.display = 'block';
  }

  /** Open the log (if closed) with the given quest selected, so a click on a
   *  tracker row jumps straight to that quest's detail pane. */
  openWithQuest(questId: string): void {
    this.selected = questId;
    if (!this.isOpen) {
      this.openerFocus = this.deps.captureFocus();
      this.deps.closeOthers();
      this.render();
      this.deps.root().style.display = 'block';
      return;
    }
    this.render();
  }

  close(restoreFocus = true): void {
    const el = this.deps.root();
    el.style.display = 'none';
    this.deps.hideTooltip();
    const target = this.openerFocus;
    this.openerFocus = null;
    if (restoreFocus) this.deps.restoreFocus(target);
  }

  render(): void {
    const el = this.deps.root();
    const world = this.deps.world();
    const quests = [...world.questLog.values()];
    const view = buildQuestLogView({
      quests,
      selectedQuestId: this.selected,
      playerClass: world.cfg.playerClass,
      completedCount: world.questsDone.size,
    });
    this.selected = view.selectedQuestId;

    markDialogRoot(el, { labelledBy: 'quest-log-title' });
    el.innerHTML = `<div class="panel-title"><span id="quest-log-title">${esc(t('questUi.log.title'))} <span class="quest-muted">${esc(
      t('questUi.log.summary', {
        active: this.questNumber(view.summary.active),
        completed: this.questNumber(view.summary.completed),
      }),
    )}</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('questUi.log.close'))}">${svgIcon('close')}</button></div>`;
    const cols = document.createElement('div');
    cols.className = 'ql-cols';
    const list = document.createElement('div');
    list.className = 'ql-list';
    const detail = document.createElement('div');
    detail.className = 'ql-detail';
    cols.append(list, detail);
    el.appendChild(cols);

    if (view.empty) {
      list.innerHTML = `<div class="ql-empty">${esc(t('questUi.log.emptyTitle'))}</div>`;
      detail.innerHTML = `<div class="ql-detail-body"><div class="qd-text">${esc(t('questUi.log.emptyHint'))}</div></div>`;
    }
    for (const item of view.items) {
      const status = item.ready ? t('questUi.log.readyStatus') : t('questUi.log.activeStatus');
      const title = this.questTitle(item.questId);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ql-item${item.selected ? ' sel' : ''}`;
      button.setAttribute('aria-pressed', item.selected ? 'true' : 'false');
      button.setAttribute(
        'aria-label',
        t('questUi.log.selectedQuestAria', { name: title, status }),
      );
      button.title = t('hudChrome.questShare.linkTitle');
      button.innerHTML = `${esc(title)}${item.ready ? ` <span class="quest-complete">(${esc(t('questUi.log.readyStatus'))})</span>` : ''}`;
      button.addEventListener('click', (ev) => {
        if (ev.shiftKey) {
          this.deps.insertQuestChatLink(item.questId);
          return;
        }
        this.selected = item.questId;
        this.render();
      });
      list.appendChild(button);
    }

    if (view.detail) this.renderDetail(detail, view.detail, world.player.name);

    this.deps
      .root()
      .querySelector('[data-close]')
      ?.addEventListener('click', () => this.close());
    this.deps.focusFirstInteractive(el);
  }

  private renderDetail(detail: HTMLElement, d: QuestDetailModel, playerName: string): void {
    let html = `<div class="qd-sub ql-detail-title">${esc(this.questTitle(d.questId))}${this.questSuggestedPlayersHtml(d.suggestedPlayers)}</div>`;
    html += d.objectives
      .map(
        (o) =>
          `<div class="qd-obj${o.done ? ' done' : ''}">${esc(this.questProgressText(this.questObjectiveLabel(d.questId, o.index), o.count, o.required))}</div>`,
      )
      .join('');
    html += `<div class="qd-text ql-detail-text">${esc(this.questNarrative(d.questId, playerName))}</div>`;
    html += `<div class="qd-sub">${esc(t('questUi.detail.rewards'))}</div><div class="qd-obj">${esc(t('questUi.detail.xpReward', { xp: this.questNumber(d.xpReward) }))} &nbsp; ${this.deps.moneyHtml(d.copperReward)}</div>`;
    if (d.rewardItemId) {
      const item = ITEMS[d.rewardItemId];
      const qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? QUALITY_DEFAULT_COLOR;
      html += `<div class="qd-reward-row" data-reward><span class="qd-reward-label">${esc(t('questUi.detail.itemReward'))}</span>${this.deps.itemIcon(item)}<span class="qd-reward-name" style="color:${qColor}">${esc(itemDisplayName(item))}</span></div>`;
    }
    const giver = NPCS[d.turnInNpcId];
    html += `<div class="qd-obj quest-return">${esc(t('questUi.log.returnTo', { name: giver ? this.npcDisplayName(giver.id) : '?' }))}</div>`;
    const body = document.createElement('div');
    body.className = 'ql-detail-body';
    body.innerHTML = html;
    detail.replaceChildren(body);
    const rewardRow = body.querySelector('[data-reward]') as HTMLElement | null;
    if (rewardRow && d.rewardItemId) {
      const itemId = d.rewardItemId;
      this.deps.attachTooltip(rewardRow, () => this.deps.itemTooltip(ITEMS[itemId]));
    }
    const actions = document.createElement('div');
    actions.className = 'ql-detail-actions';
    const abandon = document.createElement('button');
    abandon.className = 'btn';
    abandon.type = 'button';
    abandon.textContent = t('questUi.log.abandon');
    abandon.addEventListener('click', () => {
      const questId = this.selected;
      if (!questId) return;
      this.deps.confirmDialog(
        t('questUi.log.abandonConfirmTitle'),
        t('questUi.log.abandonConfirmBody', { name: this.questTitle(questId) }),
        t('questUi.log.abandonConfirm'),
        t('questUi.log.abandonCancel'),
        () => {
          this.deps.world().abandonQuest(questId);
          this.selected = null;
          this.render();
        },
      );
    });
    actions.appendChild(abandon);
    detail.appendChild(actions);
  }

  // ---- localized helpers (the trivial Hud free-function wrappers, reimplemented
  // locally over tEntity / t / formatNumber so the painter holds no Hud reference) -

  private questTitle(questId: string): string {
    return tEntity({ kind: 'quest', id: questId, field: 'title' });
  }

  private questNarrative(questId: string, playerName: string): string {
    return tEntity({ kind: 'quest', id: questId, field: 'text', values: { playerName } });
  }

  private questObjectiveLabel(questId: string, objectiveIndex: number): string {
    return tEntity({ kind: 'questObjective', questId, objectiveIndex, field: 'label' });
  }

  private npcDisplayName(npcId: string): string {
    return tEntity({ kind: 'npc', id: npcId, field: 'name' });
  }

  private questNumber(value: number): string {
    return formatNumber(value, { maximumFractionDigits: 0 });
  }

  private questProgressText(label: string, current: number, total: number): string {
    return t('questUi.detail.objectiveProgress', {
      label,
      current: this.questNumber(current),
      total: this.questNumber(total),
    });
  }

  private questSuggestedPlayersHtml(count?: number): string {
    if (!count) return '';
    return ` <span class="quest-suggested">${esc(t('questUi.log.suggestedPlayers', { count: this.questNumber(count) }))}</span>`;
  }
}
