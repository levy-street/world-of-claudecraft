import type { InterpolationValues, TranslationKey } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { MENU_STRIP_ITEMS } from '../menu/menu_strip_core';
import {
  type MobileActionModePreference,
  type MobileActionSurface,
  resolveMobileActionSurface,
} from './mobile_action_mode_core';
import { MOBILE_UTILITY_ACTION_PAGES, type MobileUtilityActionId } from './utility_action_core';

const PAGE_INDICATOR_KEY: TranslationKey = 'hudChrome.mobile.actionPageIndicator';
const PAGE_TOGGLE_ARIA_KEY: TranslationKey = 'hudChrome.mobile.actionPageToggle';
const MODE_UTILITY_KEY: TranslationKey = 'hudChrome.mobile.actionModeUtility';
const MODE_COMBAT_KEY: TranslationKey = 'hudChrome.mobile.actionModeCombat';
const MODE_SWITCH_KEY: TranslationKey = 'hudChrome.mobile.actionModeSwitchTo';

export interface MobileActionSurfaceElements {
  ring: HTMLElement;
  modeButton: HTMLButtonElement;
  modeLabel: HTMLElement;
  utilityPageButton: HTMLButtonElement;
  utilityPageIndicator: HTMLElement;
  utilityButtons: readonly { button: HTMLButtonElement }[];
}

export interface MobileActionSurfacePainterDeps {
  writers: PainterHostWriters;
  elements: MobileActionSurfaceElements;
  t(key: TranslationKey, values?: InterpolationValues): string;
}

/** Paints utility accessible names and the current mode without per-frame writes. */
export class MobileActionSurfacePainter {
  private lastPreference: MobileActionModePreference | null = null;
  private lastUtilityPage = -1;
  constructor(private readonly deps: MobileActionSurfacePainterDeps) {}

  paint(preference: MobileActionModePreference, utilityPage: number, force = false): void {
    if (!force && preference === this.lastPreference && utilityPage === this.lastUtilityPage) {
      return;
    }
    this.lastPreference = preference;
    this.lastUtilityPage = utilityPage;
    this.paintState(resolveMobileActionSurface(preference), utilityPage);
  }

  private paintState(surface: MobileActionSurface, utilityPage: number): void {
    const { writers, elements, t } = this.deps;
    writers.setAttr(elements.ring, 'data-action-surface', surface);

    // The caption names the layout the tap leads to (the swap-arrows glyph
    // makes that read as a switch), while the accessible name spells the action
    // out: "Utility" alone does not say what activating the button does.
    const nextModeKey = surface === 'combat' ? MODE_UTILITY_KEY : MODE_COMBAT_KEY;
    const modeText = t(nextModeKey);
    writers.setText(elements.modeLabel, modeText);
    const switchText = t(MODE_SWITCH_KEY, { mode: modeText });
    writers.setAttr(elements.modeButton, 'aria-label', switchText);
    writers.setAttr(elements.modeButton, 'title', switchText);

    for (let i = 0; i < elements.utilityButtons.length; i++) {
      const { button } = elements.utilityButtons[i];
      const actionId = MOBILE_UTILITY_ACTION_PAGES[utilityPage]?.[i];
      const text = actionId === undefined ? '' : t(utilityActionCaption(actionId));
      writers.setAttr(button, 'aria-label', text);
      writers.setAttr(button, 'title', text);
      writers.setAttr(button, 'data-utility-action', actionId ?? '');
    }

    writers.setText(
      elements.utilityPageIndicator,
      t(PAGE_INDICATOR_KEY, {
        page: utilityPage + 1,
        count: MOBILE_UTILITY_ACTION_PAGES.length,
      }),
    );
    const pageToggleAria = t(PAGE_TOGGLE_ARIA_KEY);
    writers.setAttr(elements.utilityPageButton, 'aria-label', pageToggleAria);
    writers.setAttr(elements.utilityPageButton, 'title', pageToggleAria);
  }
}

function utilityActionCaption(actionId: MobileUtilityActionId): TranslationKey {
  if (actionId === 'dfinder') return 'hudChrome.finder.title';
  if (actionId === 'crafting') return 'hudChrome.crafting.title';
  const menuItem = MENU_STRIP_ITEMS.find((candidate) => candidate.id === actionId);
  if (!menuItem) throw new Error(`Missing mobile utility caption for action "${actionId}"`);
  return menuItem.captionKey;
}
