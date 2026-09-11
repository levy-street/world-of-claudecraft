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
// stylesheet; the per-quality reward color comes from the shared itemNameColor
// over QUALITY_COLOR, the fallback is a CSS token, so there is no literal
// hex/px in TS).

import { ITEMS, NPCS } from '../../../sim/data';
import type { IWorld } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import {
  npcDisplayName,
  questNarrative,
  questObjectiveLabel,
  questTitle,
} from '../../entity_display_core';
import { itemDisplayName, zoneDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import { itemNameColor } from '../../item_name_color';
import type { PainterHostPresentation } from '../../painter_host';
import { questMapLocation } from '../../quest_map_location_core';
import { QuestTrackingState, sharedQuestTracking } from '../../quest_tracking_core';
import { svgIcon } from '../../ui_icons';
import { buildQuestLogView, type QuestDetailModel } from './questlog_view';

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
  onVisibilityChange?(): void;
  confirmDialog(
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
  ): void;
  insertQuestChatLink(questId: string): void;
  /** Open the world map on a world position and ring it (Hud.showFinderOnMap).
   *  The generic map launcher is deliberately NOT the path: it opens the player's
   *  current zone and clears the highlight, discarding the selected quest. */
  showOnMap(x: number, z: number): void;
  /** Injectable tracking set; production leaves it out and shares the HUD's one. */
  tracking?: QuestTrackingState;
}

export class QuestLogWindow {
  // The selected quest id. Hud's "/share" command reads it through `selectedQuestId`
  // (it links the selected quest into party chat), so the painter owns the single
  // source of truth and Hud reads it back, mirroring the inline window's field.
  private selected: string | null = null;
  private openerFocus: HTMLElement | null = null;
  private readonly collapsedGroups = new Set<string>(['completed']);

  constructor(private readonly deps: QuestLogWindowDeps) {}

  private tracking(): QuestTrackingState {
    // Instance check, not nullish: a proxy-built test deps bag answers every
    // key with a stub function, and a stub is not a tracking state.
    const own = this.deps.tracking;
    return own instanceof QuestTrackingState ? own : sharedQuestTracking();
  }

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
    this.deps.onVisibilityChange?.();
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
      this.deps.onVisibilityChange?.();
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
    this.deps.onVisibilityChange?.();
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
      collapsedGroupIds: [...this.collapsedGroups],
    });
    this.selected = view.selectedQuestId;

    markDialogRoot(el, { labelledBy: 'quest-log-title' });
    el.innerHTML = `<div class="panel-title ui-win-head"><img class="ui-win-art" src="/ui/chrome/questlog.webp" alt="" draggable="false"><span class="ui-win-title" id="quest-log-title">${esc(t('questUi.log.title'))}<span class="quest-muted ui-win-sub">${esc(
      t('questUi.log.summary', {
        active: this.questNumber(view.summary.active),
        completed: this.questNumber(view.summary.completed),
      }),
    )}</span></span><button type="button" class="x-btn ui-x-btn" data-close aria-label="${esc(t('questUi.log.close'))}">${svgIcon('close')}</button></div>`;
    const cols = document.createElement('div');
    cols.className = 'ql-cols';
    const list = document.createElement('div');
    list.className = 'ql-list';
    const detail = document.createElement('div');
    detail.className = 'ql-detail';
    cols.append(list, detail);
    el.appendChild(cols);

    if (view.empty) {
      list.innerHTML = `<div class="ql-empty ui-card">${esc(t('questUi.log.emptyTitle'))}</div>`;
      detail.innerHTML = `<div class="ql-detail-body"><div class="qd-text">${esc(t('questUi.log.emptyHint'))}</div></div>`;
    }
    for (const group of view.groups) {
      if (view.empty && group.id === 'completed' && group.count === 0) continue;
      const section = document.createElement('section');
      section.className = `ql-group${group.dimmed ? ' is-dimmed' : ''}${group.collapsed ? ' is-collapsed' : ''}`;
      const name = group.zoneId ? zoneDisplayName(group.zoneId) : t('hudChrome.questLog.completed');
      const summary =
        group.readyCount > 0
          ? t('hudChrome.questLog.zoneSummary', {
              count: this.questNumber(group.count),
              ready: this.questNumber(group.readyCount),
            })
          : this.questNumber(group.count);
      if (group.expandable) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'ql-group-toggle ui-btn';
        toggle.dataset.questGroup = group.id;
        toggle.setAttribute('aria-expanded', String(!group.collapsed));
        toggle.innerHTML = `<span class="ql-group-chevron" aria-hidden="true">${svgIcon(group.collapsed ? 'next' : 'prev')}</span><span>${esc(name)}</span><span class="ql-group-count">${esc(summary)}</span>`;
        toggle.addEventListener('click', () => {
          if (this.collapsedGroups.has(group.id)) this.collapsedGroups.delete(group.id);
          else this.collapsedGroups.add(group.id);
          this.render();
          const rebuilt = [
            ...this.deps.root().querySelectorAll<HTMLElement>('[data-quest-group]'),
          ].find((candidate) => candidate.dataset.questGroup === group.id);
          rebuilt?.focus();
        });
        section.appendChild(toggle);
      } else {
        // Nothing to open onto (the completed tally lists no rows), so the row
        // is a plain count LINE: no button, no aria-expanded, no chevron.
        const line = document.createElement('div');
        line.className = 'ql-group-toggle ql-group-line';
        line.innerHTML = `<span aria-hidden="true"></span><span>${esc(name)}</span><span class="ql-group-count">${esc(summary)}</span>`;
        section.appendChild(line);
      }
      if (!group.collapsed) {
        for (const item of group.items) {
          const status = item.ready ? t('questUi.log.readyStatus') : t('questUi.log.activeStatus');
          const title = questTitle(item.questId);
          const button = document.createElement('button');
          button.type = 'button';
          button.className = `ql-item ui-btn${item.selected ? ' sel' : ''}${item.ready ? ' is-complete' : ''}`;
          // Row identity for the island coach's press-this-next glow (the
          // bootcamp overlay toggles .qd-coach by this attribute).
          button.dataset.quest = item.questId;
          button.setAttribute('aria-pressed', item.selected ? 'true' : 'false');
          if (item.selected) button.setAttribute('aria-current', 'true');
          button.setAttribute(
            'aria-label',
            t('questUi.log.selectedQuestAria', { name: title, status }),
          );
          button.title = t('hudChrome.questShare.linkTitle');
          button.innerHTML = `<span>${esc(title)}</span>${item.ready ? `<span class="quest-complete">${esc(t('questUi.log.readyStatus'))}</span>` : ''}`;
          button.addEventListener('click', (ev) => {
            if (ev.shiftKey) {
              this.deps.insertQuestChatLink(item.questId);
              return;
            }
            this.selected = item.questId;
            this.render();
          });
          section.appendChild(button);
        }
      }
      list.appendChild(section);
    }
    if (!view.empty) {
      const hint = document.createElement('div');
      hint.className = 'ql-shift-hint';
      hint.textContent = t('hudChrome.questLog.shiftHint');
      list.appendChild(hint);
    }

    if (view.detail) this.renderDetail(detail, view.detail, world.player.name);

    this.deps
      .root()
      .querySelector('[data-close]')
      ?.addEventListener('click', () => this.close());
    this.deps.focusFirstInteractive(el);
  }

  private renderDetail(detail: HTMLElement, d: QuestDetailModel, playerName: string): void {
    let html = `<div class="qd-sub ql-detail-title">${esc(questTitle(d.questId))}${this.questSuggestedPlayersHtml(d.suggestedPlayers)}</div>`;
    html += d.objectives
      .map(
        (o) =>
          `<div class="qd-obj${o.done ? ' done' : ''}"><span>${esc(this.questProgressText(questObjectiveLabel(d.questId, o.index), o.count, o.required))}</span><span class="ui-bar qd-progress"><span class="ui-bar-fill" style="width:${o.required > 0 ? Math.min(100, (o.count / o.required) * 100) : o.done ? 100 : 0}%"></span></span></div>`,
      )
      .join('');
    html += `<div class="qd-text ql-detail-text">${esc(questNarrative(d.questId, 'text', playerName))}</div>`;
    html += `<div class="qd-sub">${esc(t('questUi.detail.rewards'))}</div><div class="ui-divider"></div><div class="qd-obj qd-reward-currency">${esc(t('questUi.detail.xpReward', { xp: this.questNumber(d.xpReward) }))}<span class="ui-money">${this.deps.moneyHtml(d.copperReward)}</span></div>`;
    if (d.rewardItemId) {
      const item = ITEMS[d.rewardItemId];
      // The bare .q-* family is the socket RIM (border plus glow), so it leaves
      // a name uncolored and haloed; the name's quality color is the shared
      // itemNameColor, exactly as chat links and loot names paint it.
      html += `<div class="qd-reward-row ui-card" data-reward><span class="qd-reward-label">${esc(t('questUi.detail.itemReward'))}</span><span class="qd-reward-socket ui-socket ui-socket--bag">${this.deps.itemIcon(item)}</span><span class="qd-reward-name q-${item.quality ?? 'common'}" style="color:${itemNameColor(item)}">${esc(itemDisplayName(item))}</span></div>`;
    }
    const giver = NPCS[d.turnInNpcId];
    html += `<div class="qd-obj quest-return">${esc(t('questUi.log.returnTo', { name: giver ? npcDisplayName(giver.id) : '?' }))}</div>`;
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
    const showMap = document.createElement('button');
    showMap.className = 'ui-btn';
    showMap.type = 'button';
    showMap.textContent = t('hudChrome.finder.showOnMap');
    showMap.dataset.questShowMap = d.questId;
    // The SELECTED quest's own objective (or turn-in) position, resolved by the
    // same rule the atlas rail's Show Route uses. A quest with no resolvable
    // position (unknown content, no placed NPC) disables the control rather than
    // opening the map somewhere unrelated.
    const location = questMapLocation(d.questId, this.deps.world().questLog);
    showMap.disabled = location === null;
    showMap.addEventListener('click', () => {
      if (location) this.deps.showOnMap(location.x, location.z);
    });
    const tracking = this.tracking();
    const tracked = tracking.isTracked(d.questId);
    const track = document.createElement('button');
    track.className = 'ui-btn';
    track.type = 'button';
    track.dataset.questTrack = d.questId;
    track.setAttribute('aria-pressed', tracked ? 'true' : 'false');
    track.textContent = t(tracked ? 'hudChrome.mapAtlas.untrack' : 'hudChrome.mapAtlas.track');
    track.addEventListener('click', () => {
      tracking.setTracked(d.questId, !tracked);
      this.render();
    });
    const abandon = document.createElement('button');
    abandon.className = 'ui-btn ui-btn--red';
    abandon.type = 'button';
    abandon.textContent = t('questUi.log.abandon');
    abandon.addEventListener('click', () => {
      const questId = this.selected;
      if (!questId) return;
      this.deps.confirmDialog(
        t('questUi.log.abandonConfirmTitle'),
        t('questUi.log.abandonConfirmBody', { name: questTitle(questId) }),
        t('questUi.log.abandonConfirm'),
        t('questUi.log.abandonCancel'),
        () => {
          this.deps.world().abandonQuest(questId);
          this.selected = null;
          this.render();
        },
      );
    });
    actions.append(track, showMap, abandon);
    detail.appendChild(actions);
  }

  // ---- localized helpers. The display-name resolvers (questTitle,
  // questNarrative, questObjectiveLabel, npcDisplayName) come from the shared
  // entity_display_core pure core, the one home of the HUD's id-to-text
  // rules; what stays here is the number / progress composition this window
  // alone renders. -----------------------------------------------------------

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
