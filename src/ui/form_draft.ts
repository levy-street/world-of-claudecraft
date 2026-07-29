// Preserve what a player has TYPED across a forced window rebuild.
//
// The `woc:languagechange` fan-out (Hud.refreshLocalizedDynamicUi) forces one
// full repaint of every open window so its t() text lands in the new locale.
// Three of those windows build their text fields with innerHTML and emit them
// empty every time (the calendar's guild-event booking form, the mailbox Send
// tab, the social window's typeahead and guild billboard), so the repaint that
// fixes the language would wipe a half-written letter. Those windows capture the
// live values first, rebuild, and write them back.
//
// This is the same hazard the mailbox already ruled on for a different trigger:
// attaching a parcel used to run the full render and wiped the compose form
// (#1695), which is why stageParcel repaints only the parcels row. A language
// switch cannot narrow that way, since every label in the window is what moved.
//
// KEYED ON THE FIELD'S OWN IDENTITY, its `id` or its `data-field`, never its
// position. A rebuild in another language reorders nothing, but the social
// window's footer markup differs per tab, and an index-keyed restore would put a
// half-typed guild name into the friend field the moment a tab was involved. A
// field carrying neither key is skipped rather than guessed at.
//
// THE FOCUS HALF GOES THROUGH ./focus_restore.ts, the seam #2528 extracted for
// carrying focus across a rebuild: `focusedWithin` owns the activeElement
// narrowing and the containment check, and `restoreFirstEnabled` owns the
// disabled skip (a control the rebuild came back DISABLED cannot take focus, and
// focusing it anyway drops the player to <body> in exactly the case the idiom
// exists for). What stays here is the identity, because this module needs one key
// that finds the element again to write a captured VALUE back, which
// `data-focus-key` does not provide.
//
// FOCUS IS RESTORED ONLY IF IT WAS ALREADY INSIDE THIS ROOT. The language picker
// lives in the Options window, so at the moment of a switch the player is
// normally focused there; re-focusing a mailbox field would yank the caret out
// from under them. Capturing it is still worth it because the two windows CAN
// both be open (opening a window no longer closes its siblings), and focus is
// tracked for ANY control under the root, not only the text fields: these
// windows install a Tab trap that only arms while `root.contains(activeElement)`
// (see focus_manager.ts), so a rebuild that dropped focus to `<body>` would let
// the next Tab walk straight out of the window. The spellbook already restores
// focus by selector across its own rebuild for the same reason.

/** The `<input>` types whose `.value` is the text a player typed. A checkbox or
 *  radio carries its state in `.checked`, and a file/color/range input has no
 *  draft to lose, so none of them belong in a draft. */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'number']);

import { focusedWithin, restoreFirstEnabled } from './focus_restore';

type DraftField = HTMLInputElement | HTMLTextAreaElement;

/** A window's live text, captured before a rebuild and written back after it. */
export interface FormDraft {
  /** Field key (`[id="..."]` or `[data-*="..."]`) to the value it held. */
  readonly values: ReadonlyMap<string, string>;
  /**
   * The key of the element that held focus, or null when focus was outside this
   * root. NOT limited to the text fields in `values`: a focused button matters
   * too, because losing it disarms the window's Tab trap.
   */
  readonly focusKey: string | null;
  /** The caret/selection, when the focused element was a text field exposing one. */
  readonly selection: readonly [start: number, end: number] | null;
}

function isDraftField(el: Element): el is DraftField {
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return TEXT_INPUT_TYPES.has((el as HTMLInputElement).type);
}

/**
 * The selector that finds this element again in the rebuilt DOM, or null when it
 * carries no stable identity to find it by.
 *
 * Falls back to the first `data-*` attribute, which is how every window in this
 * repo identifies its controls (`data-tab`, `data-cal-day`, `data-play`,
 * `data-close`, `data-act`). An element with none of the three is skipped rather
 * than guessed at: a wrong restore is worse than none.
 */
function elementKey(el: Element): string | null {
  if (el.id) return `[id="${escapeSelectorString(el.id)}"]`;
  for (const attr of el.attributes) {
    if (attr.name.startsWith('data-'))
      return `[${attr.name}="${escapeSelectorString(attr.value)}"]`;
  }
  return null;
}

/**
 * Escape a value for use inside a quoted CSS attribute-selector string.
 *
 * The id key is written `[id="..."]` rather than `#...` on purpose. A leading
 * digit is a legal HTML id and an ILLEGAL CSS identifier, so `#2fa` makes
 * querySelector throw SyntaxError, and that throw would unwind out of the
 * window's relocalize and out of the whole language fan-out, taking every
 * later surface with it. A quoted attribute selector accepts any value, so the
 * only escaping left is the two characters that would end the string early.
 * (`CSS.escape` would solve the identifier form, but it is absent in the test
 * DOM, and a fix that only holds in a browser is not a fix.)
 */
function escapeSelectorString(value: string): string {
  return value.replace(/[\\"]/g, '\\$&');
}

/** `querySelector` that cannot throw: an unmatchable key skips its restore
 *  rather than unwinding the caller. Belt for the escaping above. */
function findByKey(root: ParentNode, key: string): Element | null {
  try {
    return root.querySelector(key);
  } catch {
    return null;
  }
}

/** `selectionStart`/`setSelectionRange` throw on a number input in Chromium and
 *  Firefox (the spec forbids a selection on a non-text input), and the coin
 *  fields and the calendar's hour field are exactly that. Losing the caret is
 *  acceptable there; throwing out of a language switch is not. */
function readSelection(el: DraftField): readonly [number, number] | null {
  try {
    const { selectionStart, selectionEnd } = el;
    if (selectionStart === null || selectionEnd === null) return null;
    return [selectionStart, selectionEnd];
  } catch {
    return null;
  }
}

/**
 * Snapshot every text field under `root`, plus the caret, if focus is currently
 * inside `root`.
 */
export function captureFormDraft(root: ParentNode): FormDraft {
  const values = new Map<string, string>();
  for (const el of root.querySelectorAll('input, textarea')) {
    if (!isDraftField(el)) continue;
    const key = elementKey(el);
    // First writer wins: a duplicate id restores through one querySelector
    // anyway, so recording the later one would write the wrong value back.
    if (key === null || values.has(key)) continue;
    values.set(key, el.value);
  }
  const active = typeof document === 'undefined' ? null : document.activeElement;
  const focused =
    active !== null && active !== document.body && root.contains(active) ? active : null;
  return {
    values,
    focusKey: focused ? elementKey(focused) : null,
    selection: focused && isDraftField(focused) ? readSelection(focused) : null,
  };
}

/**
 * Write a captured draft back into the rebuilt DOM. Fields the rebuild dropped
 * (a tab switched, a form went read-only) are skipped, never recreated.
 */
export function restoreFormDraft(root: ParentNode, draft: FormDraft): void {
  for (const [key, value] of draft.values) {
    const el = findByKey(root, key);
    if (el && isDraftField(el)) el.value = value;
  }
  if (draft.focusKey === null) return;
  const target = findByKey(root, draft.focusKey);
  if (!(target instanceof HTMLElement)) return;
  restoreFirstEnabled([target]);
  if (draft.selection === null || !isDraftField(target)) return;
  try {
    target.setSelectionRange(draft.selection[0], draft.selection[1]);
  } catch {
    // A number input refuses a selection range; the value is already restored.
  }
}
