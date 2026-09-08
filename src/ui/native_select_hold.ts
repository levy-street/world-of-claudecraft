// The native-dropdown repaint hold: "may a background rebuild replace this
// window's subtree right now, or could a native <select> dropdown be open?"
//
// A rebuild replaces a focused <select> and a replaced select's open dropdown
// closes out from under the pointer (the reported Exchange Browse-filter
// bug). Native selects expose no open state, so this watches the delegated
// interactions instead. Focus ALONE is too wide a proxy: a select keeps
// focus after a pick or a dismissal, and holding on focus froze the
// Exchange's countdowns for as long as the player sat reading after touching
// a filter. The rules, and why each side is safe:
//
//  - pointerdown or mousedown ON a select ARMS (the press that opens the
//    dropdown); either anywhere else DISARMS (a press that reached the page
//    means no dropdown swallowed it). Both, because a touch delivers the
//    pointer event directly and the compatibility mousedown after a tap is
//    the mobile browser's to send or skip; on a mouse the pair agrees.
//  - keydown ON a select arms only for the keys that can open a dropdown
//    (Space, Enter, the Arrow pair); any other key disarms. A platform whose
//    arrows step the value on a closed select fires change right after,
//    which disarms again; while a native dropdown is open the browser
//    delivers no page keydowns at all.
//  - change DISARMS (a pick closes the dropdown), which is what lets
//    repaints resume the moment a filter is chosen even though the picked
//    select keeps focus.
//  - focusout from a select DISARMS.
//  - pointercancel DISARMS: the gesture became a scroll (a touch drag that
//    began on the select), so no dropdown opened, and a select still focused
//    from an earlier pick must not freeze the countdowns for the whole read.
//  - wheel anywhere in the root DISARMS once the arming press is older than
//    WHEEL_SETTLE_MS: an open native popup takes the wheel itself or is
//    rolled up by the page scroll, so a wheel that reached the page means no
//    popup is capturing input, and the reader scrolling the list is exactly
//    who a frozen countdown would punish. The settle window is for the tail
//    of a trackpad flick, which keeps delivering wheel events after the
//    fingers lift and would otherwise release a hold armed by the very next
//    click. The premise is a popup OUTSIDE the DOM; a stylable in-DOM picker
//    (appearance: base-select) would bubble its own wheel to the root and
//    needs its own rule before this window adopts one.
//
// The residual: a dropdown dismissed WITHOUT a pick (an outside click or
// Escape swallowed by the native popup, or re-picking the current value,
// which fires no change) leaves the watch armed while the select keeps focus
// until the next press, key, or wheel the page sees. It is bounded either
// way: holdRepaints() additionally requires the focused control inside the
// root to BE a select (through focusedWithin, the sanctioned active-element
// read), so a stray armed state can never outlive the select's focus. The
// consumer's sell-picker guard documents the same bounding doctrine for its
// own flag.
//
// Attaches its own delegated listeners at construction, so the CALLER must
// construct it BEFORE wiring its own handlers on the same root
// (woc_market_window.ts does, first in its built block): a change then
// disarms while the select is still attached (the consumer's change handler
// rebuilds the subtree, and an observe running after that rebuild would see
// a detached target and skip the disarm).
//
// Owns browser state by design (live listeners, instanceof narrowing):
// registered in UI_DOM_MODULES (tests/architecture.test.ts), the
// focus_restore.ts pattern. Its paired test drives it over a real happy-dom
// root; the consumer behavior lives in tests/woc_market_window_rig.test.ts.

import { focusedWithin } from './focus_restore';

export interface NativeSelectHold {
  /** True while a background rebuild must wait: a native select inside the
   *  root holds focus AND the last interaction could have opened its
   *  dropdown. User-initiated repaints never consult this. */
  holdRepaints(): boolean;
}

const OPEN_KEYS = new Set([' ', 'Enter', 'ArrowDown', 'ArrowUp']);

/** How long after an arming press a wheel is read as the flick's momentum
 *  tail rather than the reader scrolling (macOS delivers momentum wheel
 *  events for over a second after the fingers lift). */
const WHEEL_SETTLE_MS = 1500;

/** `now` is injectable for the paired test's clock; the default is the
 *  monotonic page clock, which is all the settle window needs. */
export function createNativeSelectHold(
  root: HTMLElement,
  now: () => number = () => performance.now(),
): NativeSelectHold {
  let armed = false;
  let armedAt = Number.NEGATIVE_INFINITY;
  const arm = (on: boolean): void => {
    armed = on;
    if (on) armedAt = now();
  };
  const onSelect = (e: Event): boolean =>
    e.target instanceof HTMLSelectElement && root.contains(e.target);
  for (const press of ['pointerdown', 'mousedown'] as const) {
    root.addEventListener(press, (e) => {
      arm(onSelect(e));
    });
  }
  root.addEventListener('pointercancel', () => {
    armed = false;
  });
  root.addEventListener('keydown', (e) => {
    if (onSelect(e)) arm(OPEN_KEYS.has(e.key));
  });
  root.addEventListener('change', (e) => {
    if (onSelect(e)) armed = false;
  });
  root.addEventListener('focusout', (e) => {
    if (onSelect(e)) armed = false;
  });
  // Passive: it only observes, and a blocking wheel listener stalls the scroll.
  root.addEventListener(
    'wheel',
    () => {
      if (now() - armedAt >= WHEEL_SETTLE_MS) armed = false;
    },
    { passive: true },
  );
  return {
    holdRepaints(): boolean {
      return armed && focusedWithin(root) instanceof HTMLSelectElement;
    },
  };
}
