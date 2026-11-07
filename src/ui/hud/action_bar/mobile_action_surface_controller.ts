import type { InterpolationValues, TranslationKey } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { bindTouchTap } from '../../touch_tap';
import { hydrateIcons } from '../../ui_icons';
import { MENU_STRIP_ITEMS } from '../menu/menu_strip_core';
import {
  MOBILE_ACTION_MODE_AUTO,
  MOBILE_ACTION_MODE_COMBAT,
  type MobileActionModePreference,
  mobileActionModeAfterToggle,
  resolveMobileActionSurface,
} from './mobile_action_mode_core';
import {
  type MobileActionSurfaceElements,
  MobileActionSurfacePainter,
} from './mobile_action_surface_painter';
import {
  MOBILE_UTILITY_ACTION_PAGES,
  MOBILE_UTILITY_ACTION_SLOT_COUNT,
  type MobileUtilityActionId,
} from './utility_action_core';

const RING_ID = 'mobile-action-ring';
const UTILITY_ID = 'mobile-utility-actions';
const MODE_ID = 'mobile-action-mode';
const UTILITY_PAGE_TOGGLE_ID = 'mobile-utility-page-toggle';
const MODE_LABEL_SELECTOR = '.mobile-action-mode-label';
const PAGE_INDICATOR_SELECTOR = '.mobile-action-page-indicator';
const UTILITY_BUTTON_SELECTOR = '.mobile-utility-action';
const UTILITY_SLOT_DATASET = 'utilitySlot';
const ADDITIONAL_UTILITY_ACTIONS = [
  { id: 'dfinder', elementId: 'mobile-dfinder' },
  { id: 'crafting', elementId: 'mobile-crafting' },
] as const satisfies readonly { id: MobileUtilityActionId; elementId: string }[];

export interface MobileActionSurfaceDeps {
  writers: PainterHostWriters;
  t(key: TranslationKey, values?: InterpolationValues): string;
  consumePeekGuard(): boolean;
  hideTooltip(): void;
  clickSfx(): void;
  showUtilitySurface?(): void;
}

export interface MobileActionSurface {
  update(inCombat: boolean, playerId: number): void;
  relocalize(): void;
}

/** Builds touch-only utility shortcuts, page switching, and the combat mode switch. */
export function buildMobileActionSurface(
  deps: MobileActionSurfaceDeps,
): MobileActionSurface | null {
  const ring = document.getElementById(RING_ID);
  const utility = ring?.querySelector<HTMLElement>(`#${UTILITY_ID}`) ?? null;
  const modeButton = document.getElementById(MODE_ID) as HTMLButtonElement | null;
  const modeLabel = modeButton?.querySelector<HTMLElement>(MODE_LABEL_SELECTOR) ?? null;
  const utilityPageButton = document.getElementById(
    UTILITY_PAGE_TOGGLE_ID,
  ) as HTMLButtonElement | null;
  const utilityPageIndicator =
    utilityPageButton?.querySelector<HTMLElement>(PAGE_INDICATOR_SELECTOR) ?? null;
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
    !utilityPageButton ||
    !ring.contains(utilityPageButton) ||
    !utilityPageIndicator ||
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
    utilityPageButton,
    utilityPageIndicator,
    utilityButtons: utilityButtons.map((button) => ({
      button,
    })),
  };
  if (elements.utilityButtons.length !== MOBILE_UTILITY_ACTION_SLOT_COUNT) return null;
  const targets = new Map(
    MENU_STRIP_ITEMS.map((item) => [item.id, document.getElementById(item.elementId)] as const),
  );
  for (const { id, elementId } of ADDITIONAL_UTILITY_ACTIONS) {
    targets.set(id, document.getElementById(elementId));
  }
  if (MENU_STRIP_ITEMS.some((item) => targets.get(item.id) === null)) return null;
  if (MOBILE_UTILITY_ACTION_PAGES.some((page) => page.some((actionId) => !targets.get(actionId)))) {
    return null;
  }
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

  const painter = new MobileActionSurfacePainter({ writers: deps.writers, elements, t: deps.t });
  let preference: MobileActionModePreference = MOBILE_ACTION_MODE_AUTO;
  let inCombat = false;
  let utilityPage = 0;
  let playerId: number | null = null;
  let visibleSurface: 'combat' | 'utility' | null = null;

  // Icons are PAGE state, not frame state: sync them only when the page changes
  // (including the first render). The combat/utility switch only hides the
  // container in CSS, and relocalize only rewrites labels, so neither needs a
  // resync. This keeps the per-frame path free of dataset reads.
  let syncedPage = -1;
  const renderUtilityPage = (): void => {
    if (syncedPage !== utilityPage) {
      MOBILE_UTILITY_ACTION_PAGES[utilityPage].forEach((actionId, index) => {
        syncIcon(index, actionId);
      });
      syncedPage = utilityPage;
    }
    painter.paint(inCombat, preference, utilityPage);
  };
  const render = (): void => {
    const surface = resolveMobileActionSurface(inCombat, preference);
    if (surface !== visibleSurface) {
      visibleSurface = surface;
      if (surface === 'utility') deps.showUtilitySurface?.();
    }
    renderUtilityPage();
  };
  bindTouchTap(modeButton, () => {
    if (deps.consumePeekGuard()) {
      deps.hideTooltip();
      return;
    }
    deps.hideTooltip();
    deps.clickSfx();
    preference = mobileActionModeAfterToggle(preference, inCombat);
    render();
    modeButton.blur();
  });

  bindTouchTap(utilityPageButton, () => {
    if (deps.consumePeekGuard()) {
      deps.hideTooltip();
      return;
    }
    deps.hideTooltip();
    deps.clickSfx();
    utilityPage = (utilityPage + 1) % MOBILE_UTILITY_ACTION_PAGES.length;
    renderUtilityPage();
    utilityPageButton.blur();
  });

  elements.utilityButtons.forEach(({ button }, index) => {
    bindTouchTap(button, () => {
      if (deps.consumePeekGuard()) {
        deps.hideTooltip();
        return;
      }
      const actionId = MOBILE_UTILITY_ACTION_PAGES[utilityPage][index];
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
        utilityPage = 0;
        inCombat = false;
      }
      if (nextInCombat !== inCombat) {
        preference = nextInCombat ? MOBILE_ACTION_MODE_COMBAT : MOBILE_ACTION_MODE_AUTO;
      }
      inCombat = nextInCombat;
      render();
    },
    relocalize(): void {
      painter.paint(inCombat, preference, utilityPage, true);
    },
  };
}
