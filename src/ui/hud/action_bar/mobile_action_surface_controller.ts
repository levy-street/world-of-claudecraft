import type { TranslationKey } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { bindTouchTap } from '../../touch_tap';
import { hydrateIcons } from '../../ui_icons';
import { MENU_STRIP_ITEMS } from '../menu/menu_strip_core';
import {
  MOBILE_ACTION_MODE_AUTO,
  type MobileActionModePreference,
  mobileActionModeAfterToggle,
} from './mobile_action_mode_core';
import {
  type MobileActionSurfaceElements,
  MobileActionSurfacePainter,
} from './mobile_action_surface_painter';
import {
  DEFAULT_MOBILE_UTILITY_ACTIONS,
  MOBILE_UTILITY_ACTION_SLOT_COUNT,
  type MobileUtilityActionId,
} from './utility_action_core';

const RING_ID = 'mobile-action-ring';
const UTILITY_ID = 'mobile-utility-actions';
const MODE_ID = 'mobile-action-mode';
const MODE_LABEL_SELECTOR = '.mobile-action-mode-label';
const UTILITY_BUTTON_SELECTOR = '.mobile-utility-action';
const UTILITY_SLOT_DATASET = 'utilitySlot';

export interface MobileActionSurfaceDeps {
  writers: PainterHostWriters;
  t(key: TranslationKey): string;
  consumePeekGuard(): boolean;
  hideTooltip(): void;
  clickSfx(): void;
  showUtilitySurface?(): void;
}

export interface MobileActionSurface {
  update(inCombat: boolean, playerId: number): void;
  relocalize(): void;
}

/** Builds the touch-only utility shortcuts and the automatic/combat mode switch. */
export function buildMobileActionSurface(
  deps: MobileActionSurfaceDeps,
): MobileActionSurface | null {
  const ring = document.getElementById(RING_ID);
  const utility = ring?.querySelector<HTMLElement>(`#${UTILITY_ID}`) ?? null;
  const modeButton = document.getElementById(MODE_ID) as HTMLButtonElement | null;
  const modeLabel = modeButton?.querySelector<HTMLElement>(MODE_LABEL_SELECTOR) ?? null;
  const utilityButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(UTILITY_BUTTON_SELECTOR),
  ).sort(
    (a, b) =>
      Number(a.dataset[UTILITY_SLOT_DATASET] ?? 0) - Number(b.dataset[UTILITY_SLOT_DATASET] ?? 0),
  );
  if (
    !ring ||
    !utility ||
    !modeButton ||
    !ring.contains(modeButton) ||
    !modeLabel ||
    utilityButtons.length !== MOBILE_UTILITY_ACTION_SLOT_COUNT
  ) {
    return null;
  }
  const utilityIconSlots = utilityButtons.map((button) =>
    button.querySelector<HTMLElement>('.mobile-utility-icon'),
  );
  if (utilityIconSlots.some((slot) => slot === null)) return null;

  const elements: MobileActionSurfaceElements = {
    ring,
    modeButton,
    modeLabel,
    utilityButtons: utilityButtons.map((button) => ({
      button,
    })),
  };
  if (elements.utilityButtons.length !== MOBILE_UTILITY_ACTION_SLOT_COUNT) return null;
  const actions = DEFAULT_MOBILE_UTILITY_ACTIONS;
  const targets = new Map(
    MENU_STRIP_ITEMS.map((item) => [item.id, document.getElementById(item.elementId)] as const),
  );
  if (MENU_STRIP_ITEMS.some((item) => targets.get(item.id) === null)) return null;
  const syncIcon = (index: number, actionId: MobileUtilityActionId): void => {
    const slot = utilityIconSlots[index];
    if (!slot) return;
    const icon = actionId ? targets.get(actionId)?.dataset.icon : undefined;
    if (slot.dataset.icon === icon) return;
    slot.querySelector(':scope > .ui-icon, :scope > .ui-icon-art')?.remove();
    if (icon === undefined) {
      slot.removeAttribute('data-icon');
      return;
    }
    slot.dataset.icon = icon;
    hydrateIcons(utilityButtons[index]);
  };
  actions.forEach((actionId, index) => {
    syncIcon(index, actionId);
  });

  const painter = new MobileActionSurfacePainter({ writers: deps.writers, elements, t: deps.t });
  let preference: MobileActionModePreference = MOBILE_ACTION_MODE_AUTO;
  let inCombat = false;
  let playerId: number | null = null;
  let visibleSurface: 'combat' | 'utility' | null = null;

  const render = (): void => {
    const surface = inCombat || preference !== MOBILE_ACTION_MODE_AUTO ? 'combat' : 'utility';
    if (surface !== visibleSurface) {
      visibleSurface = surface;
      if (surface === 'utility') deps.showUtilitySurface?.();
    }
    painter.paint(inCombat, preference);
  };
  bindTouchTap(modeButton, () => {
    if (deps.consumePeekGuard()) {
      deps.hideTooltip();
      return;
    }
    deps.hideTooltip();
    deps.clickSfx();
    preference = mobileActionModeAfterToggle(preference);
    render();
    modeButton.blur();
  });

  elements.utilityButtons.forEach(({ button }, index) => {
    bindTouchTap(button, () => {
      if (deps.consumePeekGuard()) {
        deps.hideTooltip();
        return;
      }
      const actionId = actions[index];
      deps.hideTooltip();
      targets.get(actionId)?.click();
      button.blur();
    });
  });

  return {
    update(nextInCombat, nextPlayerId): void {
      if (playerId !== nextPlayerId) {
        playerId = nextPlayerId;
        preference = MOBILE_ACTION_MODE_AUTO;
      }
      inCombat = nextInCombat;
      render();
    },
    relocalize(): void {
      painter.relocalize(inCombat, preference);
    },
  };
}
