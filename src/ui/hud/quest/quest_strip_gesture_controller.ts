// The touch gesture layer for the quest strip: pointer capture, the per-pointer
// drag state, and nothing else. Every RULE it applies lives in
// quest_strip_core.ts (questStripStep decides what a release means), so this
// module reads pointers and reports; it decides nothing on its own and it makes
// no DOM write of its own either (the pressed state goes back to the owner,
// which routes it through the painter's elided writers).
//
// The gesture: a tap advances one quest, a swipe LEFT advances and a swipe RIGHT
// goes back, wrapping both ways. Tap is the primary path on purpose, so the
// strip is fully usable without any gesture at all and Phase 6's tap mode has
// nothing left to promote here.
//
// Two things that cost real time when they are missing:
//   - Pointer capture is MANDATORY: the strip's visual box grows and shrinks
//     with the tracked quest's objective count, so a swipe leaves it routinely,
//     and without capture the pointerup is delivered elsewhere and the gesture
//     is silently lost. setPointerCapture is called inside try/catch because a
//     synthetic or already-released pointer id throws, which is why the
//     window-level release backstop exists: without it a throw plus a finger
//     that left the box strands the drag forever and the strip stays pressed.
//   - Assistive technologies activate a button with a plain click and emit no
//     pointer events at all, so a click our own handling did not just produce
//     has to advance the strip as well, or VoiceOver and Switch Control cannot
//     reach the other tracked quests.

import { type QuestStripStep, questStripStep } from './quest_strip_core';

/** An assistive or keyboard activation reports detail 0; a pointer-driven click
 *  reports its click count. Only the latter can be the compatibility click a
 *  release synthesizes, which is the one the gesture path suppresses. */
const ASSISTIVE_CLICK_DETAIL = 0;

export interface QuestStripGestureDeps {
  /** The strip's own button: the visual panel plus its constant hit pad. */
  surface: HTMLElement;
  /** Move the selection by one quest, wrapping in both directions. */
  cycle(step: QuestStripStep): void;
  /** The finger is down on the strip; the owner paints the pressed state. */
  setPressed(pressed: boolean): void;
}

export class QuestStripGesture {
  /** The one pointer that owns the gesture; a second finger is ignored while it
   *  is live, so a two-finger touch cannot cycle twice. */
  private pointerId: number | null = null;
  private startX = 0;
  /** Set when our own pointer handling resolved a gesture, so the synthetic
   *  click the browser fires afterwards is not taken for an assistive one. */
  private suppressClick = false;

  constructor(private readonly deps: QuestStripGestureDeps) {}

  /** Bind the strip's button. Called once, at build. */
  attach(): void {
    const { surface } = this.deps;
    surface.addEventListener('pointerdown', (e) => this.onDown(e as PointerEvent));
    surface.addEventListener('pointerup', (e) => this.onUp(e as PointerEvent));
    surface.addEventListener('pointercancel', () => this.cancel());
    // The backstop for a release the button never sees. It runs AFTER the
    // button's own handler on an ordinary release (the event bubbles), so the
    // gesture resolves first and this finds nothing left to drop.
    const release = (e: Event) => {
      if ((e as PointerEvent).pointerId === this.pointerId) this.cancel();
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    surface.addEventListener('click', (e) => {
      // Only a COMPATIBILITY click is ever suppressed. The browser reports one
      // with a click count (detail 1); an assistive or keyboard activation
      // reports 0 and is the strip's primary path, so a suppression left standing
      // by a release no click ever followed (a swipe past the browser's tap slop)
      // can never swallow it.
      if (this.suppressClick && (e as MouseEvent).detail !== ASSISTIVE_CLICK_DETAIL) {
        this.suppressClick = false;
        return;
      }
      this.suppressClick = false;
      this.deps.cycle(1);
    });
  }

  /** Drop the gesture. Safe to call from any path. */
  cancel(): void {
    if (this.pointerId === null) return;
    this.pointerId = null;
    this.deps.setPressed(false);
  }

  private onDown(e: PointerEvent): void {
    if (this.pointerId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // A press always clears a stale suppression first: it is set on a release and
    // cleared by the click that follows it, so one that never arrived would
    // otherwise swallow the next activation. Both sibling gesture layers
    // (radial_gesture_controller, strip_gesture_controller) do the same.
    this.suppressClick = false;
    this.pointerId = e.pointerId;
    this.startX = e.clientX;
    try {
      this.deps.surface.setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic or already-released pointer id: the button's own up listener
         still resolves the gesture while the finger stays on it, and the window
         backstop drops it when the finger leaves */
    }
    this.deps.setPressed(true);
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    const step = questStripStep(e.clientX - this.startX);
    this.suppressClick = true;
    this.cancel();
    this.deps.cycle(step);
  }
}
