// Interface & Comfort toggles that are pure `body` class hooks: the CSS (and,
// for Colorblind Mode, the renderer's hazard palette) does the rest. One table
// owns the setting-to-class pairing so main.ts's applySetting dispatcher stays
// a thin consumer and a new comfort switch is one row here, not a new branch.
//
// Host-agnostic: the body is typed by the one method used, so a Vitest can
// hand in a stub and the module never touches the DOM itself.

import type { BoolSettingKey } from './settings';

export const INTERFACE_BODY_CLASSES = {
  highContrastText: 'high-contrast-text',
  frostedPanels: 'frosted-panels',
  compactChat: 'compact-chat',
  // Purely presentational (issue 2429): the action-bar CSS reads it to strip
  // the empty-slot chrome.
  hideUnusedActionSlots: 'hide-unused-action-slots',
  // The HUD hook for Colorblind Mode; the 3D hazard palette is the renderer's
  // setHazardPaletteMode, driven from the same applySetting branch.
  colorblindMode: 'colorblind-mode',
} as const satisfies Partial<Record<BoolSettingKey, string>>;

export type InterfaceBodyClassSetting = keyof typeof INTERFACE_BODY_CLASSES;

export function isInterfaceBodyClassSetting(key: string): key is InterfaceBodyClassSetting {
  return Object.hasOwn(INTERFACE_BODY_CLASSES, key);
}

export interface BodyClassHost {
  classList: { toggle(className: string, force: boolean): boolean };
}

/** Mirrors one comfort setting onto its body class; returns the class toggled. */
export function applyInterfaceBodyClass(
  body: BodyClassHost,
  key: InterfaceBodyClassSetting,
  on: boolean,
): string {
  const className = INTERFACE_BODY_CLASSES[key];
  body.classList.toggle(className, on);
  return className;
}
