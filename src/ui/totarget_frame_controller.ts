// Interaction wiring for the target-of-target mini frame (#totarget-frame), the
// classic "who is my target looking at" unit frame.
//
// It shipped as a read-only readout while every other unit frame in the HUD acts
// on the unit it shows: the party/raid rows and the pet frame select on click,
// the player frame self-targets, the target frame opens a unit menu, and the
// party rows feed Clique-style mouseover casting. This module gives the mini
// frame the same routes on its own subject, so a healer can take (or heal) the
// tank's target straight off the frame.
//
// A thin DOM adapter, per the HUD component recipe: it owns no state, imports no
// Hud, and every decision it cannot make itself arrives through `deps`. The
// redirect rule the hover feeds is pure (mouseover_cast_core.ts).
//
// Two gates run on every route. While the interface editor is UNLOCKED the frame
// is a drag handle, not a unit frame, so nothing fires (the same guard the pet
// frame uses, or a completed drag would also select). And an event that started
// on a button inside the frame (the corner move toggle, the resize grip) belongs
// to that button.

import { bindMobileFrameLongPress } from './touch_tap';

export interface TargetOfTargetControlsDeps {
  /** The entity on the frame right now, or null while the frame is empty.
   *  Resolved at gesture time, never latched: the target's target changes while
   *  the cursor sits on the frame, and a latched id would act on whoever used to
   *  be there. */
  subjectId(): number | null;
  /** Select that unit, the same call every other unit frame's click makes. */
  onTarget(id: number): void;
  /** Open that unit's own context menu at a viewport point. */
  onMenu(id: number, x: number, y: number): void;
  /** Mouseover-cast source: a resolver while the cursor is over the frame, null
   *  once it leaves. A RESOLVER rather than an id for the same reason
   *  `subjectId` is a call: the frame's unit can change under a still cursor. */
  onHover(resolve: (() => number | null) | null): void;
  /** True while the interface editor owns the frame. */
  isInterfaceUnlocked(): boolean;
  /** True on the touch HUD layout (the long-press menu route's own gate). */
  isMobileLayout(): boolean;
}

/** Wire the mini frame's click, keyboard, context-menu and hover routes. */
export function installTargetOfTargetControls(
  frame: HTMLElement,
  deps: TargetOfTargetControlsDeps,
): void {
  const live = (): number | null =>
    deps.isInterfaceUnlocked() ? null : (deps.subjectId() ?? null);
  const act = (run: (id: number) => void, from?: EventTarget | null): boolean => {
    if ((from as HTMLElement | null)?.closest('button')) return false;
    const id = live();
    if (id === null) return false;
    run(id);
    return true;
  };

  frame.addEventListener('click', (ev) => {
    act(deps.onTarget, ev.target);
  });
  // Enter / Space activate the frame like the pet frame's select button, and the
  // event stops here so the game keybinds behind it (Open Chat, jump) do not also
  // fire from a focused frame.
  frame.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    if (!act(deps.onTarget, ev.target)) return;
    ev.preventDefault();
    ev.stopPropagation();
  });
  // The frame is a #target-frame child until the player moves it, so an unstopped
  // right-click would ALSO open the target's own menu behind this one.
  frame.addEventListener('contextmenu', (ev) => {
    if (!act((id) => deps.onMenu(id, ev.clientX, ev.clientY), ev.target)) return;
    ev.preventDefault();
    ev.stopPropagation();
  });
  // Touch has no right-click: a long press on the frame opens the same menu.
  // stopBubble: the mini sits INSIDE #target-frame, which binds the same gesture,
  // so without it both presses arm and the target's menu opens over this one.
  bindMobileFrameLongPress(
    frame,
    deps.isMobileLayout,
    (x, y) => {
      act((id) => deps.onMenu(id, x, y));
    },
    { stopBubble: true },
  );
  // Clique-style mouseover casting: a friendly press while the cursor is over the
  // frame lands on the unit the frame shows, gated on the same Interface option
  // the party rows use (the rule itself is mouseover_cast_core.ts).
  frame.addEventListener('mouseenter', () => deps.onHover(live));
  frame.addEventListener('mouseleave', () => deps.onHover(null));
}
