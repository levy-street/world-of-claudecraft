// Thin painter for the party frames' below-target offset: measures the target
// frame, its #tf-debuffs strip, and the party frames container, feeds the pure
// calc (party_below_target_core.ts), and keeps the measured author-space bottom
// in the --party-below-target-bottom custom property on #party-frames. The
// below-target CSS rules (hud.css, hud.mobile.css) derive the frames' top from
// that property, so the frames clear the buff strip at any buff count, UI
// scale, or dragged frame position instead of relying on a hand-tuned constant.
//
// While pushing, it also writes two SENSOR properties, --party-rows-top and
// --party-rows-limit (the member rows' measured top, and the y the rows must
// end above: the move pad's top on mobile, the viewport bottom on desktop),
// from which the below-target .party-rows rules derive their max-height, so
// the pushed-down rows stop above the movement pad on mobile and never run
// off screen on desktop (long raid rosters scroll instead). The painter only
// senses; the policy arithmetic (gaps, floors) stays in the stylesheet.
//
// Hot-path discipline: update() runs every frame from Hud.updatePartyFrames,
// so the (at most five) getBoundingClientRect measures are gated behind a
// cheap invalidation key built ONLY from non-layout reads (attribute strings,
// child count, viewport size). Steady state (unchanged key, the dominant case)
// does no layout read and no DOM write; the property writes route through the
// elided setStyleProp writer. The key includes the container's own style
// attribute, which our writes change once, so a value change costs exactly one
// extra (idempotent, then elided) re-measure before the key settles.

import type { PainterHostWriters } from './painter_host';
import { partyBelowTargetBottom, safeScale } from './party_below_target_core';
import { getUiScale } from './ui_scale';

/** The custom property the below-target CSS rules read (author-space px). */
export const PARTY_BELOW_TARGET_BOTTOM_PROP = '--party-below-target-bottom';
/** Sensor property: the member rows' measured top (author-space px). */
export const PARTY_ROWS_TOP_PROP = '--party-rows-top';
/** Sensor property: the y the rows must end above (author-space px): the move
 *  pad's top on mobile, the viewport bottom on desktop. */
export const PARTY_ROWS_LIMIT_PROP = '--party-rows-limit';
// Writing `initial` explicitly unsets a custom property (guaranteed-invalid),
// so var(--party-below-target-bottom, fallback) resolves to its fallback.
const PROP_UNSET = 'initial';

export interface PartyBelowTargetEls {
  /** #party-frames */
  container: HTMLElement | null;
  /** #target-frame */
  frame: HTMLElement | null;
  /** #tf-debuffs */
  debuffs: HTMLElement | null;
  /** The .party-rows wrapper inside #party-frames; a getter because the pool
   *  builds it lazily on the first member sync. */
  rows: () => HTMLElement | null;
  /** #mobile-move-joystick, the resting move wheel: the preferred bound (the
   *  capture zone's invisible top band may be traded for a member row). */
  moveWheel: () => HTMLElement | null;
  /** #mobile-move-zone, the STATIC capture zone: the fallback bound while the
   *  wheel is mid-drag (.floating, sprung to the touch point). */
  moveZone: () => HTMLElement | null;
}

export class PartyBelowTargetPainter {
  private lastKey = '';
  private lastBottom: number | null = null;
  // Bumped whenever the observed elements change size (see the ctor); part of
  // the invalidation key, so a content-driven size change re-measures.
  private resizeEpoch = 0;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly els: PartyBelowTargetEls,
    // Injectable so a Node test can drive the key/measure gating without a
    // real window; the default is the live one.
    private readonly win: Pick<Window, 'innerWidth' | 'innerHeight'> = window,
  ) {
    // Content-driven size changes (a cast bar appearing under the target's HP,
    // a wrap change inside the debuff strip) move the stack bottom without
    // touching any attribute the key reads, so a ResizeObserver (async, never
    // a forced reflow on the hot path) bumps the epoch the key includes and
    // the next frame re-measures. Absent in Node tests, where the epoch is
    // driven through the injectable global instead.
    const Observer = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (Observer) {
      const ro = new Observer(() => {
        this.resizeEpoch++;
      });
      if (els.frame) ro.observe(els.frame);
      if (els.debuffs) ro.observe(els.debuffs);
    }
  }

  /**
   * Per-frame: keep the measured target-stack bottom current and report it.
   * Returns the author-space bottom the party frames must clear, or null when
   * no push is needed (no target, no horizontal overlap, missing elements);
   * the caller drives the below-target class from that nullness.
   */
  update(targetShown: boolean, memberCount: number, mobile: boolean): number | null {
    const { container, frame, debuffs } = this.els;
    if (!container || !frame || !debuffs) return null;
    const key = targetShown ? this.buildKey(memberCount, mobile) : 'off';
    if (key !== this.lastKey) {
      this.lastKey = key;
      const set = (prop: string, value: number | null): void => {
        this.writers.setStyleProp(
          container,
          prop,
          value === null ? PROP_UNSET : `${value.toFixed(1)}px`,
        );
      };
      this.lastBottom = targetShown ? this.measure() : null;
      set(PARTY_BELOW_TARGET_BOTTOM_PROP, this.lastBottom);
      // The two rows-bound sensors ride the same gate: with no push active
      // they unset, and the .party-rows rules fall back to their unbounded
      // defaults.
      const sensors =
        targetShown && this.lastBottom !== null ? this.measureRowsBound(mobile) : null;
      set(PARTY_ROWS_TOP_PROP, sensors?.rowsTop ?? null);
      set(PARTY_ROWS_LIMIT_PROP, sensors?.limit ?? null);
    }
    return this.lastBottom;
  }

  // The invalidation key: every input the measured geometry depends on, read
  // without forcing layout. Inline style attributes carry the dragged frame
  // positions and the settings-driven scale/layout custom properties
  // (documentElement holds --ui-scale, --target-frame-scale, --party-frame-*);
  // class attributes carry the elite/boss frame variants and the mobile
  // collapse state; the debuff child count tracks the strip's wrap height.
  // The move zone is statically anchored (its geometry depends only on the
  // viewport and the chrome scale, both keyed), so it adds no key input.
  //
  // The container's class attribute is LOAD-BEARING beyond those variants:
  // #party-frames is zero-width out of a party (the pool detaches the rows
  // wrapper in clear()), so a target selected BEFORE joining a party measures
  // a party column the stack cannot overlap and reports no push. The pool
  // toggles `party-present` on the container one frame later, and reading that
  // class here is what forces the re-measure that applies the push. Do not
  // prune it from the key.
  private buildKey(memberCount: number, mobile: boolean): string {
    const { container, frame, debuffs } = this.els;
    const root = frame?.ownerDocument.documentElement;
    return [
      memberCount,
      mobile ? 1 : 0,
      this.resizeEpoch,
      this.win.innerWidth,
      this.win.innerHeight,
      debuffs?.childElementCount ?? 0,
      frame?.getAttribute('class') ?? '',
      frame?.getAttribute('style') ?? '',
      container?.getAttribute('class') ?? '',
      container?.getAttribute('style') ?? '',
      root?.getAttribute('style') ?? '',
    ].join('|');
  }

  // The gated measures: the only layout reads in this module, entered solely
  // on a key change (never steady-state per frame). Rects are visual px,
  // divided back to author space through the live UI scale.
  private measure(): number | null {
    const { container, frame, debuffs } = this.els;
    if (!container || !frame || !debuffs) return null;
    const frameBox = frame.getBoundingClientRect();
    const debuffsBox = debuffs.childElementCount > 0 ? debuffs.getBoundingClientRect() : null;
    const partyBox = container.getBoundingClientRect();
    return partyBelowTargetBottom({
      frame: { left: frameBox.left, right: frameBox.right, bottom: frameBox.bottom },
      debuffs: debuffsBox
        ? { left: debuffsBox.left, right: debuffsBox.right, bottom: debuffsBox.bottom }
        : null,
      party: { left: partyBox.left, right: partyBox.right },
      uiScale: getUiScale(),
    });
  }

  // The rows-bound sensors: the rows' own top (below the collapse chip, so no
  // chip-height arithmetic is ever guessed) and the limit the rows must end
  // above. On desktop that limit is the viewport bottom, so a long raid roster
  // scrolls instead of running off screen. On mobile it is the movement pad,
  // preferring the RESTING wheel (the capture zone's invisible band above the
  // wheel may be traded for a member row; touches there hit real member tap
  // targets) and falling back to the static capture zone when the wheel is
  // mid-drag (.floating, sprung under the thumb, so its rect is meaningless).
  //
  // The floating check does NOT track a drag live: the wheel's class is
  // deliberately absent from the invalidation key, because keying it would
  // force a layout read at the start and end of every joystick drag, the most
  // performance-sensitive interaction on the touch HUD. It exists so that a
  // re-measure triggered by something else while a drag happens to be in
  // flight (a buff count changing mid-combat, routine) does not read the
  // sprung wheel. Between such re-measures the bound is simply stale, which
  // is harmless: the rows are not relaid out during the drag either.
  //
  // An unusable pad (missing, or zero-height) falls back to the viewport
  // bottom rather than reporting null, so mobile keeps a bound for exactly
  // the reason desktop has one; only a missing rows wrapper (no members
  // rendered yet, hence nothing to bound) unsets the sensors. The rows top
  // depends on our own bottom write, which the key's style-attribute input
  // catches, so it settles one gated re-measure after a push change.
  private measureRowsBound(mobile: boolean): { rowsTop: number; limit: number } | null {
    const rows = this.els.rows();
    if (!rows) return null;
    const z = safeScale(getUiScale());
    const viewportLimit = this.win.innerHeight / z;
    let limit = viewportLimit;
    if (mobile) {
      const wheel = this.els.moveWheel();
      const atRest = wheel && !(wheel.getAttribute('class') ?? '').includes('floating');
      const pad = atRest ? wheel : this.els.moveZone();
      const padBox = pad?.getBoundingClientRect();
      limit = padBox && padBox.height > 0 ? padBox.top / z : viewportLimit;
    }
    const rowsBox = rows.getBoundingClientRect();
    return { rowsTop: rowsBox.top / z, limit };
  }
}
