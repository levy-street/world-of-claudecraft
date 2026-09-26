// Options > Overlays, and the Auras and Cooldown Manager panels under it: the
// on-screen overlay sub-panels, composed by the Options window as one sibling
// module rather than inline render methods (options_window.ts is on the
// monolith ratchet). The Overlays view itself is a short button list (Auras,
// Cooldown Manager, Performance Overlay) painted with the main menu's own list
// builder; Performance keeps its self-contained panel in the window.
//
// Both panels share the same contract with the window: the wide layout while
// either is open, a live placement preview of its overlay only while its own
// view is open, and a teardown when the window closes. This owns that
// contract; each panel module owns its own controls.

import { audio } from '../game/audio';
import { type AuraOverlayHooks, AuraOverlaySettingsPanel } from './aura_overlay_settings';
import type { FocusTrapHandle } from './focus_manager';
import { type CooldownManagerHooks, CooldownManagerSettingsPanel } from './hud/cooldown_manager';
import { t } from './i18n';
import { buildOptionsMenuList, type OptionsMenuRoutedAction } from './options_main_menu_controller';
import { buildOverlaysMenu, type OptionsPanelId, optionsParentView } from './options_view';

export type OverlayPanelView = 'overlays' | 'auras' | 'cooldowns';

export interface OptionsOverlayPanelsDeps {
  root(): HTMLElement;
  /** Mount the window shell (head plus the one scrolling body) and return the body. */
  viewShell(title: string, bodyClass?: string): HTMLElement;
  /** Undefined on a host that does not drive that overlay. */
  auras(): AuraOverlayHooks | undefined;
  cooldowns(): CooldownManagerHooks | undefined;
  openFocusTrap(root: () => HTMLElement, returnFocusTo: HTMLElement): FocusTrapHandle;
  close(): void;
  /** Route a pressed Overlays row, exactly as a main-menu press routes. */
  route(action: OptionsMenuRoutedAction): void;
}

export class OptionsOverlayPanels {
  private auraSettings: AuraOverlaySettingsPanel | null = null;
  private cooldownSettings: CooldownManagerSettingsPanel | null = null;

  constructor(private readonly deps: OptionsOverlayPanelsDeps) {}

  /** Run on every window render: keep the wide layout and each overlay's
   *  placement preview in step with whichever view is open. */
  sync(view: string): void {
    if (view !== 'auras' && view !== 'cooldowns') this.deps.root().classList.remove('aura-wide');
    this.deps.auras()?.setPlacement(view === 'auras');
    this.deps.cooldowns()?.setPlacement(view === 'cooldowns');
    if (view !== 'cooldowns') this.cooldownSettings?.dispose();
  }

  /** The window closed: drop any placement toolbar and every preview. */
  close(): void {
    this.auraSettings?.closePlacement();
    this.deps.auras()?.setPlacement(false);
    this.deps.cooldowns()?.setPlacement(false);
    this.cooldownSettings?.dispose();
  }

  /** Where the window's Back control lands from `view`. */
  parentView(view: 'main' | OptionsPanelId): 'main' | 'overlays' {
    return optionsParentView(view);
  }

  render(view: OverlayPanelView): void {
    if (view === 'overlays') {
      const body = this.deps.viewShell(t('hudChrome.options.overlays'));
      body.appendChild(
        buildOptionsMenuList(buildOverlaysMenu(), {
          // The Overlays list holds routing rows only, never the unlock action.
          toggleInterfaceUnlock: () => false,
          dispatch: (action) => this.deps.route(action),
        }),
      );
    } else if (view === 'auras') {
      const hooks = this.deps.auras();
      if (!hooks) return;
      this.deps.root().classList.add('aura-wide');
      const body = this.deps.viewShell(t('hudChrome.auraOverlay.title'), 'set-rows');
      this.auraSettings ??= new AuraOverlaySettingsPanel({
        auras: hooks,
        click: () => audio.click(),
        openFocusTrap: this.deps.openFocusTrap,
      });
      this.auraSettings.render(body);
    } else {
      const hooks = this.deps.cooldowns();
      if (!hooks) return;
      this.deps.root().classList.add('aura-wide');
      const body = this.deps.viewShell(t('hudChrome.cooldownManager.title'), 'set-rows');
      this.cooldownSettings ??= new CooldownManagerSettingsPanel({
        hooks,
        click: () => audio.click(),
      });
      this.cooldownSettings.render(body);
    }
    this.deps
      .root()
      .querySelector('[data-close]')
      ?.addEventListener('click', () => this.deps.close());
  }
}
