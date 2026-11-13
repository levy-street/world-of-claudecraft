// The Reputation window (menu consolidation step 2): the faction standing
// cards that were the Character sheet's Reputation tab, moved whole into the
// Book of the Realm as its Reputation tab. The body is the same
// reputationTabHtml painter the sheet used; this window adds only the shell
// (title bar, the hub strip, the close route) and a repaint guard.
//
// Cold: a full rebuild on open, on a language change, and on the slow band
// only when the painted markup would change (the body string IS the
// signature: it is cheap, it already folds in the standings, the level cap
// and the world-quest countdown, and nothing else feeds the paint).

import { audio } from '../../../game/audio';
import type { IWorld } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { esc } from '../../esc';
import { t } from '../../i18n';
import { svgIcon } from '../../ui_icons';
import type { WindowHubStrip } from '../hub/window_hub_controller';
import { reputationTabHtml } from './reputation_tab_html';

export interface ReputationWindowDeps {
  /** The #reputation-window root (Hud owns the id). */
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /** The Book of the Realm strip, painted under the title bar. */
  hubStrip?: WindowHubStrip;
}

export class ReputationWindow {
  private opened = false;
  private openerFocus: HTMLElement | null = null;
  private lastBody = '';

  constructor(private readonly deps: ReputationWindowDeps) {}

  get isOpen(): boolean {
    return this.opened;
  }

  /** The root a hub tab switch carries its position onto. */
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

  /** Slow-band refresh: repaint only when the body would change. */
  refreshIfChanged(): void {
    if (!this.opened) return;
    if (this.bodyHtml() === this.lastBody) return;
    this.render();
  }

  /** Self-gated language-switch arm (Hud.refreshLocalizedDynamicUi). */
  relocalize(): void {
    if (this.opened) this.render();
  }

  private bodyHtml(): string {
    return reputationTabHtml(this.deps.world(), Date.now());
  }

  private render(): void {
    const el = this.deps.root();
    const hub = this.deps.hubStrip;
    const title = hub ? hub.title() : t('hudChrome.bookOfRealm.tabReputation');
    const hadCloseFocus = document.activeElement === el.querySelector('[data-close]');
    markDialogRoot(el, { label: title });
    this.lastBody = this.bodyHtml();
    el.innerHTML =
      `<div class="panel-title ui-win-head"><span class="ui-win-title">${esc(title)}</span>` +
      `<button type="button" class="x-btn ui-x-btn" data-close aria-label="${esc(hub ? hub.closeLabel() : t('hudChrome.bookOfRealm.close'))}">${svgIcon('close')}</button></div>` +
      (hub?.html() ?? '') +
      `<div class="reputation-window-body">${this.lastBody}</div>`;
    hub?.wire(el);
    el.querySelector('[data-close]')?.addEventListener('click', () => {
      this.close();
      audio.click();
    });
    if (hadCloseFocus) el.querySelector<HTMLElement>('[data-close]')?.focus();
  }
}
