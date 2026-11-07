import type { TranslationKey } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { MENU_STRIP_ITEMS } from '../menu/menu_strip_core';
import {
  MOBILE_ACTION_MODE_COMBAT,
  type MobileActionModePreference,
  type MobileActionSurface,
  resolveMobileActionSurface,
} from './mobile_action_mode_core';
import {
  DEFAULT_MOBILE_UTILITY_ACTIONS,
  type MobileUtilityActionId,
} from './utility_action_core';

const MODE_UTILITY_KEY: TranslationKey = 'hudChrome.mobile.actionModeUtility';
const MODE_COMBAT_KEY: TranslationKey = 'hudChrome.mobile.actionModeCombat';
const MODE_PIN_ARIA_KEY: TranslationKey = 'hudChrome.mobile.actionModePinAria';
const MODE_AUTO_ARIA_KEY: TranslationKey = 'hudChrome.mobile.actionModeAutoAria';

export interface MobileActionSurfaceElements {
  ring: HTMLElement;
  modeButton: HTMLButtonElement;
  modeLabel: HTMLElement;
  utilityButtons: readonly { button: HTMLButtonElement }[];
}

export interface MobileActionSurfacePainterDeps {
  writers: PainterHostWriters;
  elements: MobileActionSurfaceElements;
  t(key: TranslationKey): string;
}

/** Paints utility accessible names and the current mode without per-frame writes. */
export class MobileActionSurfacePainter {
  private lastSurface: MobileActionSurface | null = null;
  private lastPreference: MobileActionModePreference | null = null;
  constructor(private readonly deps: MobileActionSurfacePainterDeps) {}

  paint(inCombat: boolean, preference: MobileActionModePreference): void {
    const surface = resolveMobileActionSurface(inCombat, preference);
    if (surface === this.lastSurface && preference === this.lastPreference) return;
    this.lastSurface = surface;
    this.lastPreference = preference;
    this.paintState(surface, preference);
  }

  relocalize(inCombat: boolean, preference: MobileActionModePreference): void {
    this.lastSurface = null;
    this.lastPreference = null;
    this.paintState(resolveMobileActionSurface(inCombat, preference), preference);
    this.lastSurface = resolveMobileActionSurface(inCombat, preference);
    this.lastPreference = preference;
  }

  private paintState(surface: MobileActionSurface, preference: MobileActionModePreference): void {
    const { writers, elements, t } = this.deps;
    writers.setAttr(elements.ring, 'data-action-surface', surface);

    const modeText = t(
      preference === MOBILE_ACTION_MODE_COMBAT ? MODE_UTILITY_KEY : MODE_COMBAT_KEY,
    );
    const modeAria = t(
      preference === MOBILE_ACTION_MODE_COMBAT ? MODE_AUTO_ARIA_KEY : MODE_PIN_ARIA_KEY,
    );
    writers.setText(elements.modeLabel, modeText);
    writers.setAttr(
      elements.modeButton,
      'aria-pressed',
      String(preference === MOBILE_ACTION_MODE_COMBAT),
    );
    writers.setAttr(elements.modeButton, 'aria-label', modeAria);
    writers.setAttr(elements.modeButton, 'title', modeAria);

    for (let i = 0; i < elements.utilityButtons.length; i++) {
      const { button } = elements.utilityButtons[i];
      const actionId = DEFAULT_MOBILE_UTILITY_ACTIONS[i];
      const item = MENU_STRIP_ITEMS.find((candidate) => candidate.id === actionId);
      const text = item === undefined ? '' : t(item.captionKey);
      writers.setAttr(button, 'aria-label', text);
      writers.setAttr(button, 'title', text);
      writers.setAttr(button, 'data-utility-action', actionId);
    }
  }
}
