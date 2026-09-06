// Thin painter for the shared corpse-harvest preference picker (Intentional
// Gathering PR3): one radio choice of All or a single material, reused
// unmodified by the Field Kit use, Professions, and corpse Change entrances.
// Content only: the caller owns the surrounding dialog, its open/close, its
// Tab trap, and pointer-blur focus handling (root src/ui/CLAUDE.md); this
// module mints no second focus manager.
//
// Single-select rows follow the house APG pattern (src/ui/hud/professions/
// CLAUDE.md, farming_plant_sheet_window.ts): a `role="radiogroup"` of
// `role="radio"` buttons with `aria-checked`, ONE roving `tabindex="0"`, and
// arrows (both axes) plus Home/End through the shared `rovingTarget` core.
// A roving landing updates the DRAFT selection only (aria-checked, the tab
// stop, the hint, Apply's disabled state); it never calls `onCommit`, which
// only the explicit Apply button does. Enter/Space keep native button
// activation (a real `<button>`, untouched by the roving keydown handler).
//
// A stored material the current row list does not offer is described by
// NAME, never by its raw internal id: an OWN-PROPERTY ITEMS lookup
// (`knownItemDef`) so a retired id shaped like "constructor" or "__proto__"
// can never resolve to an inherited Object/Function member, falling back to
// a generic "unavailable material" line. The raw id lives only in the
// view-core's `currentUnavailableItemId` for that one lookup; nothing here
// ever prints it, and every name is written through `textContent`.
//
// `render` replaces the whole subtree under `container` on every call and
// returns void; a caller refreshes by calling it again. Two independent
// guards keep a stale control inert, applied to EVERY control (rows
// included, not just Apply/Cancel):
//  - ownership: every click/keydown re-checks `container.contains(root)`
//    (never `Element.isConnected`, so a container mounted into the document
//    LATER by its own caller is unaffected) so a control from a subtree the
//    container no longer owns, whether superseded by a newer render or torn
//    down directly by the outer popup (its own Escape/close), can never fire.
//  - terminal: a per-render flag set BEFORE invoking onCommit/onDismiss, so a
//    second click (or a reentrant one from inside the callback) on the SAME
//    still-owned render cannot act again: Apply commits at most once, Cancel
//    dismisses at most once, doing one forecloses the other, and neither a
//    stray row click nor a roving key can move the draft afterward.
//
// Every focusable control carries `data-focus-key` (`radio:<token>`,
// `apply`, `cancel`) so a caller that repaints in place (the controller's
// relocalize, on a language switch) can carry the EXACT focused control
// across via the shared `captureFocusKey`/`findFocusKey`/`restoreFirstEnabled`
// seam (src/ui/focus_restore.ts), not merely re-derive "the checked row":
// a player can focus Apply or Cancel before the language changes.

import { ITEMS } from '../../../sim/data';
import type { HarvestPreference } from '../../../sim/professions/harvest_preference';
import { itemDisplayName } from '../../entity_i18n';
import { t } from '../../i18n';
import { knownItemDef } from '../../known_item';
import { rovingTarget } from '../../roving_index';
import { buildHarvestPreferencePickerView } from './harvest_preference_view';

export interface HarvestPreferencePickerInput {
  readonly preference: HarvestPreference | null;
  readonly componentTags?: readonly string[];
}

export interface HarvestPreferencePickerDeps {
  /** Fires on every draft change (a click or a roving key landing), with the
   *  new canonical token. Never fires from Apply/Cancel, and never implies a
   *  command: this is local UI state the controller may keep (e.g. to
   *  survive a relocalize repaint) without ever sending it to the world. */
  onDraftChange(raw: string): void;
  /** Fires at most once, on Apply, with the canonical token (All or an item
   *  id). The outer controller owns closing the picker afterward. */
  onCommit(raw: string): void;
  /** Fires at most once, on Cancel. Never fires on Apply, and never fires
   *  after Apply already fired (or vice versa). */
  onDismiss(): void;
}

let instanceCounter = 0;

function rowLabelText(itemId: string | null): string {
  if (itemId === null) return t('hudChrome.harvestPreference.allLabel');
  const item = knownItemDef(ITEMS, itemId);
  return item ? itemDisplayName(item) : t('hudChrome.harvestPreference.unknownMaterial');
}

function currentUnavailableText(itemId: string): string {
  const item = knownItemDef(ITEMS, itemId);
  const material = item ? itemDisplayName(item) : t('hudChrome.harvestPreference.unknownMaterial');
  return t('hudChrome.harvestPreference.currentUnavailable', { material });
}

export function renderHarvestPreferencePicker(
  container: HTMLElement,
  input: HarvestPreferencePickerInput,
  deps: HarvestPreferencePickerDeps,
): void {
  const view = buildHarvestPreferencePickerView(input.preference, input.componentTags);
  const document = container.ownerDocument;
  const titleId = `harvest-preference-title-${instanceCounter++}`;

  container.textContent = '';
  const root = document.createElement('div');
  root.className = 'harvest-preference';

  const title = document.createElement('div');
  title.className = 'harvest-preference-title';
  title.id = titleId;
  title.textContent = t('hudChrome.harvestPreference.title');
  root.appendChild(title);

  if (view.currentUnavailableItemId !== null) {
    const note = document.createElement('div');
    note.className = 'harvest-preference-current-unavailable';
    note.textContent = currentUnavailableText(view.currentUnavailableItemId);
    root.appendChild(note);
  }

  const hint = document.createElement('div');
  hint.className = 'harvest-preference-hint';
  hint.setAttribute('role', 'status');
  hint.setAttribute('aria-live', 'polite');
  hint.textContent = t('hudChrome.harvestPreference.pickHint');
  hint.hidden = view.selectedToken !== null;
  root.appendChild(hint);

  let draftToken: string | null = view.selectedToken;
  let terminal = false;
  const canAct = (): boolean => !terminal && container.contains(root);

  const applyButton = document.createElement('button');
  applyButton.type = 'button';
  applyButton.className = 'btn';
  applyButton.dataset.focusKey = 'apply';
  applyButton.textContent = t('hudChrome.harvestPreference.applyButton');
  applyButton.disabled = draftToken === null;

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn-secondary';
  cancelButton.dataset.focusKey = 'cancel';
  cancelButton.textContent = t('hudChrome.harvestPreference.cancelButton');

  const list = document.createElement('ul');
  list.className = 'harvest-preference-rows';
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-labelledby', titleId);

  const buttons: HTMLButtonElement[] = [];
  // The checked row is the tab stop; nothing checked (malformed or an
  // unavailable stored material) parks the roving tab stop on the first
  // option WITHOUT checking it, so the group is still keyboard-reachable but
  // asks for an explicit pick rather than implying one (the farming
  // Math.max(0, findIndex(...)) shape).
  const tabStop = Math.max(
    0,
    view.rows.findIndex((row) => row.token === view.selectedToken),
  );

  /** Land the draft on `index`: updates aria-checked, the roving tab stop,
   *  the hint, and Apply's disabled state, and reports the new token via
   *  onDraftChange. `focus` also moves DOM focus (an arrow/Home/End
   *  landing); a click leaves focus where the pointer put it. Never calls
   *  onCommit/onDismiss: Apply/Cancel are the only paths that do. Guarded by
   *  `canAct()` like Apply/Cancel, so a stale or superseded render's rows
   *  cannot mutate a draft nobody is looking at or report it upstream. */
  const selectRow = (index: number, focus: boolean): void => {
    if (!canAct()) return;
    const button = buttons[index];
    if (!button) return;
    const token = button.dataset.harvestChoice;
    if (token === undefined) return;
    draftToken = token;
    for (const b of buttons) {
      const checked = b === button;
      b.setAttribute('aria-checked', checked ? 'true' : 'false');
      b.tabIndex = checked ? 0 : -1;
    }
    if (focus) button.focus();
    hint.hidden = true;
    applyButton.disabled = false;
    deps.onDraftChange(token);
  };

  view.rows.forEach((row, index) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'none');
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.className = 'harvest-preference-row';
    button.dataset.harvestChoice = row.token;
    button.dataset.focusKey = `radio:${row.token}`;
    button.setAttribute('aria-checked', row.token === view.selectedToken ? 'true' : 'false');
    button.tabIndex = index === tabStop ? 0 : -1;
    button.textContent = rowLabelText(row.itemId);
    button.addEventListener('click', () => selectRow(index, false));
    button.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      const next = rovingTarget(ke.key, index, view.rows.length, 'both');
      if (next === null) return;
      ke.preventDefault();
      selectRow(next, true);
    });
    li.appendChild(button);
    list.appendChild(li);
    buttons.push(button);
  });
  root.appendChild(list);

  const actions = document.createElement('div');
  actions.className = 'harvest-preference-actions';
  applyButton.addEventListener('click', () => {
    if (!canAct() || draftToken === null) return;
    terminal = true;
    deps.onCommit(draftToken);
  });
  cancelButton.addEventListener('click', () => {
    if (!canAct()) return;
    terminal = true;
    deps.onDismiss();
  });
  actions.append(applyButton, cancelButton);
  root.appendChild(actions);

  container.appendChild(root);
}
