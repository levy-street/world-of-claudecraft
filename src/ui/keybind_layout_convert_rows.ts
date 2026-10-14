// The Key Bindings panel's "convert to keyboard layout" row: a Convert button
// that opens an expando with the layout the hotkeys were made for, the layout
// to convert them to, a keep-movement-in-place switch, a live count of the
// hotkeys that will move, and the apply button. The conversion itself is the
// pure keyboard_layout_convert_core.ts; this is its thin DOM consumer, built
// here rather than as another method cluster on the options painter, which is
// at its line ceiling (tests/monolith_budget.test.ts).

import { audio } from '../game/audio';
import type { ConvertedLayout } from '../game/keybinds';
import { useTouchInterface } from '../game/mobile_controls';
import { formatNumber, t } from './i18n';
import type { KeybindSetup } from './keybind_transfer_core';
import {
  convertBindingsLayout,
  DEFAULT_SOURCE_LAYOUT,
  isKeyboardLayoutId,
  KEYBOARD_LAYOUTS,
  type KeyboardLayoutId,
} from './keyboard_layout_convert_core';
import { detectOsKeyboardLayout } from './keyboard_map';

/** The seam the options painter hands in; OptionsWindowDeps satisfies it
 *  structurally. */
export interface KeybindLayoutConvertDeps {
  /** The live Keybinds store: its snapshot, and its last conversion record
   *  (Reset and an imported code clear it). */
  keybinds(): { snapshot(): KeybindSetup; convertedLayout(): ConvertedLayout | null };
  /** The shared themed dropdown. */
  buildDropdown(
    options: { value: string; label: string }[],
    current: string,
    onChange?: (value: string) => void,
    placeholder?: string,
    a11y?: { ariaLabel?: string; labelledBy?: string },
  ): HTMLElement;
  /** Move a dropdown's shown value without firing its onChange. */
  setDropdownValue(root: HTMLElement, value: string): void;
  /** The listed layout the OS reports, or null when the browser cannot tell.
   *  Defaults to the keyboard overview's layout-map read. */
  detectLayout?(): Promise<KeyboardLayoutId | null>;
}

/** The move and turn actions the keep-in-place switch pins (the WASD and QE
 *  cluster). Deliberately not every held action: the Emote Wheel's X is a
 *  letter like any other and follows it. */
export const MOVEMENT_ACTION_IDS: ReadonlySet<string> = new Set([
  'forward',
  'back',
  'turnLeft',
  'turnRight',
  'strafeLeft',
  'strafeRight',
]);

/** Set across one apply: the rebuild it triggers focuses the new Convert opener. */
let refocusOpener = false;

const layoutLabel = (id: KeyboardLayoutId): string =>
  t(KEYBOARD_LAYOUTS.find((l) => l.id === id)?.labelKey ?? KEYBOARD_LAYOUTS[0].labelKey);

/** Append the row and its expando to `body`. `apply` replaces the live map with
 *  the converted snapshot, records `layout` as its conversion record, and shows
 *  `note` (the painter's applyKeybindSetup). */
export function buildKeybindLayoutConvertRow(
  body: HTMLElement,
  deps: KeybindLayoutConvertDeps,
  apply: (binds: KeybindSetup, note: string, layout: ConvertedLayout) => void,
): void {
  // Keyboard-only, like the keyboard overview: touch has no layout to convert.
  if (useTouchInterface()) return;
  const wrap = document.createElement('div');
  wrap.className = 'kb-transfer kb-layout';
  const row = document.createElement('div');
  row.className = 'set-row ui-stat-row';
  const name = document.createElement('span');
  name.className = 'set-name';
  name.textContent = t('hudChrome.keybindLayout.title');
  const actions = document.createElement('div');
  actions.className = 'set-seg ui-seg';
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'btn ui-seg-tab set-toggle';
  openBtn.textContent = t('hudChrome.keybindLayout.open');
  openBtn.setAttribute('aria-expanded', 'false');
  actions.appendChild(openBtn);
  row.append(name, actions);

  const pane = document.createElement('div');
  pane.className = 'transfer-pane kb-layout-pane';
  pane.hidden = true;
  wrap.append(row, pane);
  body.appendChild(wrap);

  // Converting rebuilds the whole panel (the painter's renderKeybinds), so the
  // focused Convert Hotkeys button is gone; hand focus to the rebuilt opener.
  if (refocusOpener) {
    refocusOpener = false;
    openBtn.focus();
  }

  // Start from the layout these hotkeys were last converted to, so a second
  // Convert never re-scrambles them; as authored they are QWERTY (US).
  const last = deps.keybinds().convertedLayout();
  const from = last !== null && isKeyboardLayoutId(last.id) ? last.id : DEFAULT_SOURCE_LAYOUT;
  // Movement kept in place last time still sits on its earlier positions, not
  // on `from`'s, so converting it as `from` now would scramble it: keep it pinned.
  const movementLocked = last !== null && last.id === from && last.keptMovement;
  const state = {
    from,
    to: from,
    toChosen: false,
    keepMovement: true,
  };
  const options = KEYBOARD_LAYOUTS.map((l) => ({ value: l.id, label: t(l.labelKey) }));
  const status = document.createElement('div');
  status.className = 'set-note';
  status.setAttribute('role', 'status');
  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'btn ui-btn ui-btn--gold';
  applyBtn.textContent = t('hudChrome.keybindLayout.apply');

  const convert = () =>
    convertBindingsLayout(
      deps.keybinds().snapshot(),
      state.from,
      state.to,
      state.keepMovement ? MOVEMENT_ACTION_IDS : new Set<string>(),
    );
  const sync = () => {
    const { moved } = convert();
    status.textContent =
      moved > 0
        ? t('hudChrome.keybindLayout.moves', { count: formatNumber(moved) })
        : t('hudChrome.keybindLayout.noChange');
    applyBtn.disabled = moved === 0;
  };

  const pickRow = (
    labelText: string,
    current: KeyboardLayoutId,
    onPick: (id: KeyboardLayoutId) => void,
  ) => {
    const pick = document.createElement('div');
    pick.className = 'set-row ui-stat-row';
    const label = document.createElement('span');
    label.className = 'set-name';
    label.textContent = labelText;
    const dropdown = deps.buildDropdown(
      options,
      current,
      (value) => {
        if (!isKeyboardLayoutId(value)) return;
        audio.click();
        onPick(value);
        sync();
      },
      undefined,
      { ariaLabel: labelText },
    );
    dropdown.querySelector('.ui-dd-btn')?.classList.add('ui-btn');
    pick.append(label, dropdown);
    pane.appendChild(pick);
    return dropdown;
  };
  pickRow(t('hudChrome.keybindLayout.from'), state.from, (id) => {
    state.from = id;
  });
  const toDropdown = pickRow(t('hudChrome.keybindLayout.to'), state.to, (id) => {
    state.to = id;
    state.toChosen = true;
  });

  const keepRow = document.createElement('div');
  keepRow.className = 'set-row ui-stat-row';
  const keepName = document.createElement('span');
  keepName.className = 'set-name';
  keepName.textContent = t('hudChrome.keybindLayout.keepMovement');
  const keepToggle = document.createElement('button');
  keepToggle.type = 'button';
  keepToggle.className = 'btn ui-btn ui-btn--plate set-toggle';
  const syncKeep = () => {
    keepToggle.textContent = state.keepMovement ? t('hud.options.on') : t('hud.options.off');
    keepToggle.classList.toggle('off', !state.keepMovement);
    keepToggle.classList.toggle('is-off', !state.keepMovement);
    keepToggle.setAttribute('aria-pressed', String(state.keepMovement));
    keepToggle.setAttribute('aria-label', t('hudChrome.keybindLayout.keepMovement'));
  };
  syncKeep();
  keepToggle.disabled = movementLocked;
  keepToggle.addEventListener('click', () => {
    audio.click();
    state.keepMovement = !state.keepMovement;
    syncKeep();
    sync();
  });
  keepRow.append(keepName, keepToggle);
  const help = document.createElement('div');
  help.className = 'set-note';
  help.textContent = t('hudChrome.keybindLayout.help');
  pane.append(keepRow);
  if (movementLocked) {
    const locked = document.createElement('div');
    locked.className = 'set-note';
    locked.textContent = t('hudChrome.keybindLayout.keepMovementLocked');
    pane.append(locked);
  }
  pane.append(help, status, applyBtn);

  applyBtn.addEventListener('click', () => {
    const { binds, moved } = convert();
    if (moved === 0) return;
    audio.click();
    refocusOpener = true;
    try {
      apply(
        binds,
        t('hudChrome.keybindLayout.converted', {
          from: layoutLabel(state.from),
          to: layoutLabel(state.to),
        }),
        { id: state.to, keptMovement: state.keepMovement },
      );
    } finally {
      // Consumed by the rebuild; a painter that did not rebuild (or threw)
      // must not leave it for the next, unrelated one.
      refocusOpener = false;
    }
  });

  openBtn.addEventListener('click', () => {
    audio.click();
    pane.hidden = !pane.hidden;
    openBtn.setAttribute('aria-expanded', String(!pane.hidden));
    if (pane.hidden) return;
    sync();
    // Preselect the OS layout as the target, unless the player already picked one.
    void (deps.detectLayout ?? detectOsKeyboardLayout)().then((id) => {
      if (id === null || state.toChosen || id === state.from) return;
      state.to = id;
      deps.setDropdownValue(toDropdown, id);
      sync();
    });
  });
}
