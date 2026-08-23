// The ONE touch gesture layer every strip menu instantiates: pointer capture,
// the reveal timer, measuring the anchor, sticky/tap mode, the open-state
// readout and the Escape closer. Every RULE it applies comes in as a parameter
// or lives in radial_action_core.ts (where the items sit, which one a drag is
// over, when the row comes up, whether the cancel target is live) and
// tap_menu_core.ts (what a press MEANS in tap mode), so this module reads
// pointers and reports; it decides nothing on its own.
//
// It lives beside tap_menu.ts rather than inside either domain because both
// domains are instances of it: the consumables row (src/ui/hud/action_bar/) and
// the menu control (src/ui/hud/menu/) each own a thin wrapper that supplies its
// direction, pitch, count, release rule and callbacks, and neither reaches into
// the other's directory for its own gesture layer. Registered in
// tests/architecture.test.ts UI_DOM_MODULES.
//
// The gesture: pointerdown arms, a quick tap runs the control's DEFAULT action,
// a swipe along the row's direction past the deadzone walks it, and a stationary
// hold of RADIAL_REVEAL_MS reveals the row as a learning affordance. Choosing
// never waits for the reveal. Releasing back in the anchor's own X band with the
// row open cancels; the Y a thumb arc wandered to is ignored on purpose, because
// that arc is a curve and demanding a straight path would reject perfectly clear
// gestures.
//
// Two things that cost real time when they are missing:
//   - Pointer capture is MANDATORY: the finger leaves the anchor long before the
//     release, and without capture the pointerup is delivered elsewhere and the
//     gesture is silently lost. setPointerCapture is called inside try/catch
//     because a synthetic or already-released pointer id throws, which is why
//     the window-level release backstop exists: without it a throw plus a finger
//     that left the anchor strands the drag forever and the row stays painted.
//   - The row is measured at pointerdown, not at the reveal: which way it grows
//     decides which way a swipe counts up and where the caption parks, so the
//     placement has to exist before the first move can be resolved against it.
//
// STICKY MODE is the non-gesture path, for VoiceOver / TalkBack / Switch
// Control: activation opens the row as a persistent, focusable menu of real
// buttons instead of a drag. The touchTapMenus setting is that same path
// promoted to a player option: with it on, a press opens the row instead of
// arming the drag, a press on the anchor with the row open runs the default
// action, and a press outside dismisses. A control with NO default action of its
// own (anchorRole 'toggle') reaches the same row from a bare tap in either mode
// and closes it on the next press. Every rule is tap_menu_core.ts's, shared with
// the radial so the three menus cannot drift.

import type { PainterHostWriters } from '../painter_host';
import {
  placeConsumableStrip,
  RADIAL_REVEAL_MS,
  resolveStripIndex,
  STRIP_DEADZONE_PX,
  type StripDirection,
  type StripPlacement,
  shouldRevealStrip,
  stripCancelIsLive,
} from './action_bar/radial_action_core';
import { armTapMenuOutsideDismiss, registerTouchMenu } from './tap_menu';
import { resolveTapMenuPress, type TapMenuAnchorRole, type TapMenuPress } from './tap_menu_core';

// Row geometry comes from the stylesheet, never from numbers here. An item is
// the same rendered size as the anchor that opens it (both read --menu-btn-size
// and fold in --btn-scale), so the anchor's own measured box IS the item size.
// The gap and the edge margin are read back off the overlay's computed style and
// are authored as LITERALS there: getComputedStyle hands back an unresolved
// calc() for a custom property, so only a literal parses back to a number.
const GAP_PROP = '--strip-gap';
const EDGE_MARGIN_PROP = '--strip-margin';
// The clamp box is the SHARED app-viewport box (#mobile-controls, #game-canvas,
// #ui and #nameplates all size from it), never window.innerWidth: whenever the
// two disagree (device emulation, pinch zoom, a mid-resize snapshot) a row
// clamped against the window lands off the overlay it is painted into. It is a
// px literal written by syncAppViewport, so it parses.
const APP_VIEWPORT_WIDTH_PROP = '--app-vw';
/** Applied only where the stylesheet is absent (a DOM without hud.mobile.css). */
const FALLBACK_ITEM_SIZE_PX = 46;
const FALLBACK_GAP_PX = 8;
const FALLBACK_MARGIN_PX = 6;
/** The anchor's open state, so assistive tech is told the row is showing. The
 *  control it replaced carried it and the gesture menus dropped it (#seam). */
const ARIA_EXPANDED_ATTR = 'aria-expanded';
/** Focusability of the row's own buttons, written as the ATTRIBUTE through the
 *  shared elided writer rather than as the tabIndex IDL property: the facet has
 *  no property writer, and the attribute is what the IDL property reflects. */
const TABINDEX_ATTR = 'tabindex';

/** The measured row metrics a direction rule is resolved against. Every distance
 *  here is in the overlay's padding-box frame (see measure()), which is the frame
 *  the painter's coordinates are resolved in. */
export interface StripMetrics {
  /** Centre of the anchoring control. */
  anchorX: number;
  count: number;
  itemSize: number;
  gap: number;
  viewportWidth: number;
  margin: number;
}

/** What a release on the anchor means, in the one shape both rows share. A row
 *  whose control has no default action of its own answers 'open' instead, which
 *  turns the bare tap into the sticky menu rather than an action. */
export type StripGestureOutcome =
  | { kind: 'pick'; index: number }
  | { kind: 'default' }
  | { kind: 'open' }
  | { kind: 'cancel' };

/** How a pick was made. 'item' means the item element's OWN activation produced
 *  it (a tap, an assistive click, Enter on the focused button), so anything
 *  bound to that element has already run; 'gesture' means the swipe released on
 *  it and nothing has activated the element at all. */
export type StripPickSource = 'gesture' | 'item';

export interface StripReleaseInput {
  /** resolveStripIndex's readout: -1 while the finger is still in the deadzone. */
  index: number;
  /** Whether the row was showing when the finger came up. */
  revealed: boolean;
  count: number;
}

export interface StripGestureDeps {
  /** The control that owns the press (the seat, the menu control). */
  anchor: HTMLElement;
  /** The element whose computed style carries the row geometry per tier. It is
   *  the row OVERLAY, which is also the element the painted items are positioned
   *  against, so its padding defines the frame measure() works in. */
  metricsHost: HTMLElement;
  /** The row's item buttons, in row order (index 0 nearest the anchor). */
  items: readonly HTMLElement[];
  /** The X that sits on top of the anchor and backs out without choosing. */
  cancel: HTMLElement;
  /** Hud's shared write-elision facet: the aria-expanded state is the only DOM
   *  write this layer makes, and it goes through the same cache as every other. */
  writers: PainterHostWriters;
  /** Tap mode (settings.touchTapMenus), read live at press time. */
  tapMenus(): boolean;
  /** What a press on THIS control means beyond opening its row. Defaults to
   *  'action'; the rule itself is tap_menu_core.ts's, never restated here. */
  anchorRole?: TapMenuAnchorRole;
  /** Row items open right now. */
  count(): number;
  /** Travel between adjacent items as the finger sees it. */
  pitch: number;
  /** Which way the row grows, resolved against the measured metrics. */
  direction(metrics: StripMetrics): StripDirection;
  /** What a release means. */
  release(input: StripReleaseInput): StripGestureOutcome;
  /** Choose the item at `index` (open it, use it). A row whose items are real
   *  bound buttons routes a pick by activating one, so it must read `source`: an
   *  'item' pick has already activated that element, and activating it a second
   *  time runs the action twice. */
  onPick(index: number, source: StripPickSource): void;
  /** A bare tap: run the control's default action. Omitted by a control that has
   *  none, whose release rule answers 'open' where this would have been called. */
  onDefault?(): void;
  /** The player opened the row and chose nothing. */
  onCancel(): void;
  /** Repaint from openState(). Supplied only by a control with no per-frame HUD
   *  paint behind it; the consumables seat rides Hud's frame instead. */
  repaint?(): void;
}

/** The measured row: fixed for the whole of one gesture, since the anchor does
 *  not move under a press and the swipe distance to item N must stay
 *  predictable. A superset of what either painter reads, so each wrapper hands
 *  its own narrower open-state shape straight out. */
export interface StripGestureLayout {
  placement: StripPlacement;
  direction: StripDirection;
  anchorX: number;
  anchorY: number;
  viewportWidth: number;
  margin: number;
  count: number;
  itemSize: number;
}

/** Everything either painter needs about an OPEN row. Null means closed. */
export interface StripGestureOpenState extends StripGestureLayout {
  /** The item the finger is over, or -1 for none. */
  live: number;
  /** Whether the cancel target is the live choice. */
  cancelLive: boolean;
}

interface DragState {
  pointerId: number;
  startX: number;
  index: number;
  revealed: boolean;
  revealTimer: ReturnType<typeof setTimeout> | null;
  layout: StripGestureLayout;
}

function readMetric(style: CSSStyleDeclaration, prop: string, fallback: number): number {
  const parsed = Number.parseFloat(style.getPropertyValue(prop));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readPx(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** The device safe area. env() cannot live in the geometry custom properties (a
 *  custom property comes back unresolved, see above), so the overlay carries the
 *  insets as padding, which is a real property and does resolve to px.
 *
 *  That padding is NOT inert: every row item is an absolutely positioned child of
 *  the overlay, so the left/top the painter writes resolves against the overlay's
 *  PADDING box. These four numbers are therefore the offset between the viewport
 *  and the frame the row is actually seated in, which is why measure() works in
 *  that frame rather than in viewport coordinates. */
interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function readInsets(style: CSSStyleDeclaration): EdgeInsets {
  return {
    top: readPx(style.paddingTop),
    right: readPx(style.paddingRight),
    bottom: readPx(style.paddingBottom),
    left: readPx(style.paddingLeft),
  };
}

export class StripGesture {
  private drag: DragState | null = null;
  /** Sticky mode: opened by assistive activation rather than a drag, and kept
   *  open so it can be navigated and chosen without a pointer. */
  private sticky: StripGestureLayout | null = null;
  /** Set when our own pointer handling resolved a gesture, so the synthetic click
   *  the browser fires afterwards is not mistaken for an assistive activation. */
  private suppressClick = false;
  /** Disarms the tap-outside listener, while one is armed. */
  private disarmOutside: (() => void) | null = null;

  constructor(private readonly deps: StripGestureDeps) {}

  /** Bind the anchor and the row's own buttons. Called once, at build. */
  attach(): void {
    const { anchor, cancel } = this.deps;
    anchor.addEventListener('pointerdown', (e) => this.onDown(e as PointerEvent));
    anchor.addEventListener('pointermove', (e) => this.onMove(e as PointerEvent));
    anchor.addEventListener('pointerup', (e) => this.onUp(e as PointerEvent));
    // Matched on the pointer ID like the window backstop below and the radial's
    // twin: a SECOND finger's cancel on the anchor must never drop the first
    // finger's live row.
    anchor.addEventListener('pointercancel', (e) => {
      if ((e as PointerEvent).pointerId === this.drag?.pointerId) this.cancelDrag();
    });
    // The backstop for a release the anchor never sees. It runs AFTER the
    // anchor's own handler on an ordinary release (the event bubbles), so the
    // gesture resolves first and this finds nothing left to drop.
    const release = (e: Event) => {
      if ((e as PointerEvent).pointerId === this.drag?.pointerId) this.cancelDrag();
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    // Assistive technologies activate a button with a plain click and emit no
    // pointer events at all, so a click our own drag handling did not just
    // produce is the non-gesture path asking for the menu.
    anchor.addEventListener('click', () => {
      if (this.suppressClick) {
        this.suppressClick = false;
        return;
      }
      this.openSticky();
    });
    this.deps.items.forEach((btn, index) => {
      btn.addEventListener('click', () => {
        const press = resolveTapMenuPress({
          tapMenus: this.deps.tapMenus(),
          open: this.sticky !== null,
          target: 'item',
          index,
        });
        if (press.kind !== 'choose') return;
        const open = press.index < (this.sticky?.count ?? 0);
        this.closeSticky();
        if (open) this.deps.onPick(press.index, 'item');
      });
    });
    cancel.addEventListener('click', () => {
      if (!this.sticky) return;
      this.closeSticky();
      this.deps.onCancel();
    });
    // Escape belongs to Hud's single closeAll dispatcher, which asks the shared
    // registry rather than knowing any menu by name.
    registerTouchMenu(() => this.closeIfOpen());
  }

  /**
   * Open the row as a persistent, focusable menu. Assistive activation calls
   * this, and so does a tap-mode press.
   */
  openSticky(): void {
    if (this.sticky || this.drag || this.deps.count() <= 0) return;
    this.sticky = this.measure();
    this.setRowFocusable(true);
    // Whether an outside press dismisses is the CORE's answer, not a second
    // reading of the setting: for an 'action' control only tap mode listens (with
    // the setting off the row is assistive-only and closes through its own items
    // or its cancel X, which is what it did before the setting existed), while a
    // 'toggle' control listens in either mode because a plain tap opens its row.
    if (this.press(true, 'outside').kind === 'dismiss') {
      this.disarmOutside = armTapMenuOutsideDismiss(
        () => [this.deps.anchor, ...this.deps.items, this.deps.cancel],
        () => this.dismissSticky(),
      );
    }
    this.syncExpanded();
    this.deps.repaint?.();
    this.deps.items[0]?.focus();
  }

  /** Close the sticky menu and hand focus back to the anchor it came from. */
  closeSticky(): void {
    if (!this.sticky) return;
    this.sticky = null;
    this.setRowFocusable(false);
    this.disarmOutside?.();
    this.disarmOutside = null;
    this.syncExpanded();
    this.deps.repaint?.();
    this.deps.anchor.focus();
  }

  /** The key-driven way out, called by Hud's closeAll Escape dispatcher through
   *  the shared registry. Reports whether it had anything to close, and chooses
   *  nothing: Escape is a dismissal. */
  closeIfOpen(): boolean {
    if (this.sticky === null) return false;
    this.closeSticky();
    this.deps.onCancel();
    return true;
  }

  /** The tap-outside path: close and report the row as chosen-nothing. */
  private dismissSticky(): void {
    if (this.press(this.sticky !== null, 'outside').kind !== 'dismiss') return;
    this.closeSticky();
    this.deps.onCancel();
  }

  /** Ask the shared table what a press means for this control. `open` is passed
   *  rather than read so openSticky can ask about the state it is entering. */
  private press(open: boolean, target: 'anchor' | 'outside'): TapMenuPress {
    return resolveTapMenuPress({
      tapMenus: this.deps.tapMenus(),
      open,
      target,
      anchorRole: this.deps.anchorRole,
    });
  }

  /** An anchor press the gesture layer does NOT own: open the row, close it
   *  again, or run the control's default action. Never arms the drag. */
  private onAnchorPress(e: PointerEvent, press: TapMenuPress): void {
    this.suppressClick = true;
    if (e.pointerType === 'touch') e.preventDefault();
    if (press.kind === 'open') {
      this.openSticky();
      return;
    }
    if (press.kind === 'dismiss') {
      this.closeSticky();
      this.deps.onCancel();
      return;
    }
    if (press.kind !== 'default' || this.deps.count() <= 0) return;
    this.closeSticky();
    this.deps.onDefault?.();
  }

  /** True while the row is showing, from either path. */
  isOpen(): boolean {
    return this.sticky !== null || this.drag?.revealed === true;
  }

  /** True from the moment a press ARMS, which is earlier than isOpen(): a drag
   *  spends RADIAL_REVEAL_MS armed but unrevealed, and the row it will choose
   *  from is already decided. A caller whose item list can be re-sorted by the
   *  world freezes it on THIS, never on isOpen(), or the index the release
   *  resolves names a different item than the press did. */
  isArmed(): boolean {
    return this.sticky !== null || this.drag !== null;
  }

  /** The item the finger is over, or -1 for none. */
  liveIndex(): number {
    return this.sticky ? -1 : (this.drag?.index ?? -1);
  }

  /** What the painter needs to seat the row, or null while it is closed. */
  openState(): StripGestureOpenState | null {
    const layout = this.sticky ?? (this.drag?.revealed ? this.drag.layout : null);
    if (!layout) return null;
    return {
      ...layout,
      // The sticky menu is chosen by FOCUS, not by travel, so no item is under a
      // finger and the cancel target is not the live choice either.
      live: this.liveIndex(),
      cancelLive:
        this.sticky === null &&
        stripCancelIsLive(this.drag?.index ?? -1, this.drag?.revealed === true),
    };
  }

  private setRowFocusable(on: boolean): void {
    const tabIndex = on ? '0' : '-1';
    for (const btn of this.deps.items) this.deps.writers.setAttr(btn, TABINDEX_ATTR, tabIndex);
    this.deps.writers.setAttr(this.deps.cancel, TABINDEX_ATTR, tabIndex);
  }

  /** The anchor's popup state, written on every transition that opens or closes
   *  the row from either path. Through the shared elided writer, so a repeat of
   *  the same state costs no DOM write. */
  private syncExpanded(): void {
    this.deps.writers.setAttr(
      this.deps.anchor,
      ARIA_EXPANDED_ATTR,
      this.isOpen() ? 'true' : 'false',
    );
  }

  /** Measure the anchor and lay the row out around it. The one place this module
   *  reads layout, gated to an opening gesture rather than per frame.
   *
   *  WHY THE FRAME IS THE OVERLAY'S PADDING BOX, not the viewport: the row items
   *  are absolutely positioned children of the overlay, so the coordinates the
   *  painter writes are resolved against its padding box, and the safe-area inset
   *  the overlay carries as padding is exactly the offset between the two.
   *  Measuring in viewport coordinates displaced every item by that inset on a
   *  notched device, and folding the same inset into the clamp margin counted it
   *  twice. Shifting the anchor and shrinking the clamp box here counts it once,
   *  and leaves the margin the stylesheet's own literal clearance INSIDE the safe
   *  area. Everything downstream (the caption clamp, the dim band) then reads one
   *  consistent frame. */
  private measure(): StripGestureLayout {
    const rect = this.deps.anchor.getBoundingClientRect();
    const style = getComputedStyle(this.deps.metricsHost);
    const itemSize = rect.width > 0 ? rect.width : FALLBACK_ITEM_SIZE_PX;
    const inset = readInsets(style);
    const metrics: StripMetrics = {
      anchorX: rect.x + rect.width / 2 - inset.left,
      count: this.deps.count(),
      itemSize,
      gap: readMetric(style, GAP_PROP, FALLBACK_GAP_PX),
      viewportWidth:
        readMetric(style, APP_VIEWPORT_WIDTH_PROP, window.innerWidth) - inset.left - inset.right,
      margin: readMetric(style, EDGE_MARGIN_PROP, FALLBACK_MARGIN_PX),
    };
    const anchorY = rect.y + rect.height / 2 - inset.top;
    const direction = this.deps.direction(metrics);
    return {
      placement: placeConsumableStrip({ ...metrics, anchorY, direction }),
      direction,
      anchorX: metrics.anchorX,
      anchorY,
      viewportWidth: metrics.viewportWidth,
      margin: metrics.margin,
      count: metrics.count,
      itemSize,
    };
  }

  private onDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // A press always clears a stale suppression first: the flag is set on a
    // release and cleared by the click that follows it, so one that never
    // arrived would otherwise swallow the next assistive activation.
    this.suppressClick = false;
    const press = this.press(this.sticky !== null, 'anchor');
    if (press.kind !== 'gesture') {
      this.onAnchorPress(e, press);
      return;
    }
    if (this.drag || this.sticky) return;
    if (this.deps.count() <= 0) return;
    try {
      this.deps.anchor.setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic or already-released pointer id: the anchor's own move/up
         listeners still resolve the drag while the finger stays on it, and the
         window backstop drops it when the finger leaves */
    }
    this.drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      index: -1,
      revealed: false,
      layout: this.measure(),
      revealTimer: setTimeout(() => this.reveal(), RADIAL_REVEAL_MS),
    };
    if (e.pointerType === 'touch') e.preventDefault();
  }

  private reveal(): void {
    if (!this.drag || this.drag.revealed) return;
    this.drag.revealed = true;
    this.syncExpanded();
    this.deps.repaint?.();
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const next = resolveStripIndex(
      e.clientX - d.startX,
      this.deps.pitch,
      d.layout.count,
      STRIP_DEADZONE_PX,
      d.layout.direction,
    );
    if (next === d.index) return;
    d.index = next;
    if (shouldRevealStrip(next, d.revealed)) this.reveal();
    else if (d.revealed) this.deps.repaint?.();
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const outcome = this.deps.release({
      index: d.index,
      revealed: d.revealed,
      count: d.layout.count,
    });
    this.suppressClick = true;
    this.cancelDrag();
    if (outcome.kind === 'pick') this.deps.onPick(outcome.index, 'gesture');
    else if (outcome.kind === 'default') this.deps.onDefault?.();
    // The drag is already dropped above, so the row can take the anchor's own
    // press as its opening one.
    else if (outcome.kind === 'open') this.openSticky();
    else this.deps.onCancel();
  }

  /** Drop the gesture and close the row. Safe to call from any path. */
  cancelDrag(): void {
    const d = this.drag;
    if (!d) return;
    if (d.revealTimer !== null) clearTimeout(d.revealTimer);
    this.drag = null;
    this.syncExpanded();
    this.deps.repaint?.();
  }
}
