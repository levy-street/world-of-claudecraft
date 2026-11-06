// The Rewards hub's World Quests tab (#world-quests-window): today's board,
// lifted whole from the World Map rail (menu consolidation step 7). The model
// and the markup are the board's own (world_quest_rail_view.ts and
// world_quest_rail_section.ts); this window adds the shell, a Show on Map
// beside every open row, and the daily replacement behind its confirm.
//
// The selection is SHARED with the map: picking a row selects that quest's
// pin, and the replacement acts on the selected quest exactly as it did on the
// rail. The map keeps its pins; only the board moved.
//
// Cold: a rebuild on open, on a language change, and on the slow band when the
// board or the expiry countdown's minute moves.

import { audio } from '../../../game/audio';
import { playerActiveWorldQuests } from '../../../sim/world_quest_reroll';
import type { IWorld } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { esc } from '../../esc';
import { focusedWithin, restoreFirstEnabled } from '../../focus_restore';
import { getI18nRevision, t } from '../../i18n';
import { svgIcon } from '../../ui_icons';
import { worldQuestDisplayName } from '../../world_quest_view';
import type { WindowHubStrip } from '../hub/window_hub_controller';
import { worldQuestRailSectionHtml } from '../map/world_quest_rail_section';
import { buildWorldQuestRailView, type WorldQuestRailView } from '../map/world_quest_rail_view';
import { type RewardsMapPoint, worldQuestMapPoint } from './rewards_view';

export interface WorldQuestsWindowDeps {
  /** The #world-quests-window root. */
  root(): HTMLElement;
  world(): IWorld;
  nowMs(): number;
  /** The map's selected world quest (shared with the pin selection). */
  selectedId(): string | null;
  select(questId: string | null): void;
  /** Open the map on a quest's point with its pin selected. */
  showOnMap(questId: string, point: RewardsMapPoint): void;
  confirmDialog(title: string, body: string, ok: string, cancel: string, onOk: () => void): void;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /** The Rewards strip, painted under the title bar. */
  hubStrip?: WindowHubStrip;
}

/** Today's board for `world`, the model the tab and the rail pill both read. */
export function worldQuestBoardView(world: IWorld, selectedId: string | null): WorldQuestRailView {
  return buildWorldQuestRailView({
    worldQuestCycle: world.worldQuestCycle,
    worldQuestLog: world.worldQuestLog,
    worldQuestReplacements: world.worldQuestReplacements,
    worldQuestRerollCycle: world.worldQuestRerollCycle,
    worldQuestExpiresAtMs: world.worldQuestExpiresAtMs,
    playerLevel: world.player.level,
    selectedWorldQuestId: selectedId,
    canReroll: world.canRerollWorldQuest
      ? (questId) => world.canRerollWorldQuest?.(questId) ?? { canReroll: false }
      : undefined,
  });
}

/** The rebuilt twin of a focused control: a row, its Show on Map, the
 *  replacement button or the close button (each carries its own identity). */
function focusSelector(active: HTMLElement | null): string | null {
  if (!active) return null;
  const quest = active.dataset.mapWq ?? active.dataset.wqShowMap;
  if (quest !== undefined) {
    const attr = active.dataset.mapWq !== undefined ? 'data-map-wq' : 'data-wq-show-map';
    return `[${attr}="${CSS.escape(quest)}"]`;
  }
  if (active.hasAttribute('data-map-wq-reroll')) return '[data-map-wq-reroll]';
  if (active.hasAttribute('data-close')) return '[data-close]';
  return null;
}

export class WorldQuestsWindow {
  private opened = false;
  private openerFocus: HTMLElement | null = null;
  private lastSig = '';

  constructor(private readonly deps: WorldQuestsWindowDeps) {}

  get isOpen(): boolean {
    return this.opened;
  }

  rootElement(): HTMLElement {
    return this.deps.root();
  }

  open(): void {
    if (this.opened) {
      this.render();
      return;
    }
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    this.opened = true;
    this.render();
    this.deps.root().style.display = 'flex';
    this.deps.root().querySelector<HTMLElement>('[data-close]')?.focus();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.deps.root().style.display = 'none';
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  /** Slow-band refresh: repaint when the board or the countdown minute moves. */
  refreshIfChanged(): void {
    if (!this.opened) return;
    if (this.signature(this.view()) === this.lastSig) return;
    this.render();
  }

  /** Self-gated language-switch arm: the signature is locale-free. */
  relocalize(): void {
    if (this.opened) this.render();
  }

  private view(): WorldQuestRailView {
    return worldQuestBoardView(this.deps.world(), this.deps.selectedId());
  }

  private signature(view: WorldQuestRailView): string {
    const minute = Math.floor(Math.max(0, view.expiresAtMs - this.deps.nowMs()) / 60_000);
    return JSON.stringify([view, minute, getI18nRevision()]);
  }

  private render(): void {
    const el = this.deps.root();
    const hub = this.deps.hubStrip;
    const title = hub ? hub.title() : t('hudChrome.rewards.tabWorldQuests');
    const view = this.view();
    const refocus = focusSelector(focusedWithin(el));
    this.lastSig = this.signature(view);
    markDialogRoot(el, { label: title });
    el.innerHTML =
      `<div class="panel-title ui-win-head"><span class="ui-win-title">${esc(title)}</span>` +
      `<button type="button" class="x-btn ui-x-btn" data-close aria-label="${esc(hub ? hub.closeLabel() : t('hudChrome.rewards.close'))}">${svgIcon('close')}</button></div>` +
      (hub?.html() ?? '') +
      `<div class="world-quests-body">${worldQuestRailSectionHtml(view, this.deps.nowMs(), { showOnMap: true })}</div>`;
    hub?.wire(el);
    el.querySelector('[data-close]')?.addEventListener('click', () => {
      this.close();
      audio.click();
    });
    el.querySelector('.world-quests-body')?.addEventListener('click', (ev) =>
      this.onClick(ev.target as HTMLElement),
    );
    if (refocus) restoreFirstEnabled([el.querySelector<HTMLButtonElement>(refocus)]);
  }

  private onClick(target: HTMLElement): void {
    const show = target.closest<HTMLElement>('[data-wq-show-map]');
    if (show) {
      const questId = show.dataset.wqShowMap ?? '';
      const world = this.deps.world();
      const quest = playerActiveWorldQuests({
        worldQuestCycle: world.worldQuestCycle,
        worldQuestReplacements: { ...(world.worldQuestReplacements ?? {}) },
      }).find((q) => q.id === questId);
      if (!quest) return;
      audio.click();
      this.deps.showOnMap(questId, worldQuestMapPoint(quest));
      return;
    }
    const reroll = target.closest<HTMLElement>('[data-map-wq-reroll]');
    if (reroll) {
      const questId = reroll.dataset.mapWqReroll ?? '';
      if (!questId || reroll.hasAttribute('disabled')) return;
      audio.click();
      this.deps.confirmDialog(
        t('hudChrome.mapAtlas.worldQuests.confirmTitle'),
        t('hudChrome.mapAtlas.worldQuests.confirmBody', { quest: worldQuestDisplayName(questId) }),
        t('hudChrome.mapAtlas.worldQuests.confirmOk'),
        t('hudChrome.mapAtlas.worldQuests.confirmCancel'),
        () => {
          if (!this.deps.world().rerollWorldQuest?.(questId)) return;
          this.deps.select(null);
          if (this.opened) this.render();
        },
      );
      return;
    }
    const row = target.closest<HTMLElement>('[data-map-wq]');
    if (!row) return;
    const questId = row.dataset.mapWq ?? '';
    audio.click();
    this.deps.select(this.deps.selectedId() === questId ? null : questId);
    this.render();
  }
}
