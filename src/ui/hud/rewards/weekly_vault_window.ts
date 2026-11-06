// The Rewards hub's Vault tab (#weekly-vault-window): the weekly rewards
// sheet, painted ONCE here. It used to paint twice, as the Bank's Rewards tab
// (the only copy that could claim) and as the Dungeon Finder's read-only Vault
// tab. The sheet itself is unchanged (WeeklyRewardsTab and its claim, reveal
// and loot-focus controllers); this window adds the shell: the title bar, the
// hub strip and the close route. Claiming stays at the Vault keeper exactly as
// the sim gates it (`weeklyRewardInfo.canClaim`); anywhere else the sheet reads
// as progress and the claim button says where to go.
//
// Cold: a rebuild on open and on a language change; the slow band asks the
// pane, whose own signature repaints only when the rolls or the state move.

import { audio } from '../../../game/audio';
import type { IWorld } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { esc } from '../../esc';
import { t } from '../../i18n';
import type { PainterHostPresentation } from '../../painter_host';
import { svgIcon } from '../../ui_icons';
import { WeeklyRewardsTab } from '../../weekly_rewards_window';
import type { WindowHubStrip } from '../hub/window_hub_controller';

export interface WeeklyVaultWindowDeps {
  /** The #weekly-vault-window root. */
  root(): HTMLElement;
  world(): IWorld;
  presentation: PainterHostPresentation;
  onInventoryChanged(): void;
  hideTooltip(): void;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /** The Rewards strip, painted under the title bar. */
  hubStrip?: WindowHubStrip;
}

export class WeeklyVaultWindow {
  private opened = false;
  private openerFocus: HTMLElement | null = null;
  private readonly pane: WeeklyRewardsTab;

  constructor(private readonly deps: WeeklyVaultWindowDeps) {
    this.pane = new WeeklyRewardsTab({
      world: () => deps.world(),
      presentation: deps.presentation,
      onInventoryChanged: () => deps.onInventoryChanged(),
      hideTooltip: () => deps.hideTooltip(),
    });
  }

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
    this.pane.close();
    this.deps.hideTooltip();
    this.deps.root().style.display = 'none';
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  /** Slow-band refresh: the pane repaints only when its signature moves. */
  refreshIfChanged(): void {
    if (!this.opened) return;
    this.pane.refreshIfChanged(() => this.render());
  }

  /** Self-gated language-switch arm: the pane's signature is locale-free. */
  relocalize(): void {
    if (this.opened) this.render();
  }

  private render(): void {
    const el = this.deps.root();
    const hub = this.deps.hubStrip;
    const title = hub ? hub.title() : t('hudChrome.weeklyRewards.title');
    const hadCloseFocus = document.activeElement === el.querySelector('[data-close]');
    markDialogRoot(el, { label: title });
    el.innerHTML =
      `<div class="panel-title ui-win-head"><span class="ui-win-title">${esc(title)}</span>` +
      `<button type="button" class="x-btn ui-x-btn" data-close aria-label="${esc(hub ? hub.closeLabel() : t('hudChrome.rewards.close'))}">${svgIcon('close')}</button></div>` +
      (hub?.html() ?? '');
    this.pane.renderInto(el);
    hub?.wire(el);
    el.querySelector('[data-close]')?.addEventListener('click', () => {
      this.close();
      audio.click();
    });
    if (hadCloseFocus) el.querySelector<HTMLElement>('[data-close]')?.focus();
  }
}
