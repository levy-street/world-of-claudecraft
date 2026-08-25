// Builds and drives the touch quest strip: the top-band, one-quest-at-a-time
// replacement for the right-anchored tracker on phones (Phase 5 of the touch
// rework).
//
// The tracker it replaces is fixed-width per tier and UNBOUNDED in height, so
// every extra quest grows it downward into the action ring (measured: 122 x 42px
// of overlap at only two quests). The strip shows ONE quest with all of its
// objectives in the band the collapsed button row vacated, which makes its
// height a function of one quest's objective count rather than of the whole log.
//
// It is a second PRESENTATION of the tracked quests, never a second data model:
// QuestTrackerController hands it the same TrackedQuest[] it renders on desktop,
// which is why no IWorld member was added for it.
//
// The ANCHOR is authored, not measured: hud.mobile.css derives
// --quest-strip-anchor-left per tier from the target frame's own static seat, so
// the strip sits where it would sit beside a target whether or not the player
// has one. Measuring that frame is what used to slide the strip sideways every
// time a target came or went. What is left here is the one genuinely dynamic
// half, the WIDTH: the buff bars grow leftward and the minimap's zone label is
// as wide as the zone's name, so how far the strip may run before it reaches
// them is measured. Everything else (size, type scale, the constant hit pad) is
// CSS in hud.mobile.css, per tier.

import { formatNumber, t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import {
  cycleQuestStrip,
  QUEST_STRIP_FALLBACK_HEIGHT_PX,
  type QuestStripBox,
  type QuestStripStep,
  type QuestStripView,
  questStripBand,
  questStripProgressJump,
  questStripView,
} from './quest_strip_core';
import { QuestStripGesture } from './quest_strip_gesture_controller';
import {
  type QuestStripFlash,
  type QuestStripObjectiveLine,
  type QuestStripPaintDescriptor,
  QuestStripPainter,
  type QuestStripPaintModel,
} from './quest_strip_painter';
import type { TrackedQuest } from './quest_tracker';

const ROOT_ID = 'quest-strip';
const SURFACE_ID = 'quest-strip-main';
const TITLE_ID = 'quest-strip-title';
const COMPLETE_ID = 'quest-strip-complete';
const CYCLE_ID = 'quest-strip-cycle';
const COUNT_ID = 'quest-strip-count';
const PREV_ID = 'quest-strip-prev';
const NEXT_ID = 'quest-strip-next';
const MORE_ID = 'quest-strip-more';
const HINT_ID = 'quest-strip-hint';
const OBJECTIVE_SELECTOR = '.quest-strip-obj:not(.quest-strip-more)';
/**
 * Repaints between forced band re-measures. The strip paints on the tracker's
 * MEDIUM band (about 4 Hz), so four ticks is roughly one measure per second.
 * The cheap key below catches every occupant change that shows up in an
 * attribute or a child count, but a band occupant can also change WIDTH with
 * neither moving (a buff icon whose stack text grows, the minimap's zone label
 * swapping to a longer name), and there is no non-layout signal for that. One
 * bounded re-measure per second is the price of the strip not overlapping the
 * buff bar until the next quest event; it is one rect helper over five static
 * occupants, off the frame band entirely.
 */
const SEAT_REMEASURE_TICKS = 4;
/** The strip only exists on the touch HUD; desktop keeps its tracker. */
const TOUCH_BODY_CLASS = 'mobile-touch';

/**
 * Everything that can legitimately share the top band, each measured and only
 * counted while it overlaps the strip's own rows AND starts right of the
 * anchor, so one of them can cap the strip's width but none can move it.
 * #target-frame is deliberately absent: the anchor is derived from its STATIC
 * seat in CSS, so reading its live box could only reintroduce the jump. The
 * menu strip is absent too, and that one is load-bearing: it is a full-viewport
 * overlay while open, so measuring it would starve the strip of width every
 * time the player opened the menu.
 */
const BAND_OCCUPANT_SELECTORS = [
  '#party-frames',
  '#buff-bar',
  '#debuff-bar',
  '#minimap-wrap',
  '#right-tracker-stack',
] as const;

export interface QuestStripDeps {
  /** The HUD's click sound, played on a cycle so the tap confirms itself. */
  click(): void;
  /**
   * Hud's shared write-elision facet, handed down by QuestTrackerController. The
   * strip paints on the tracker's medium band, so its writes belong in the
   * coordinator's caches and its skips in the coordinator's skip-rate: a private
   * facet here would be a second write cache inside a domain, which
   * src/ui/hud/CLAUDE.md forbids for exactly this reason.
   */
  writers: PainterHostWriters;
}

/** The strip's static markup, resolved once at build. Identical in shape to the
 *  painter's descriptor, which is built straight from it. */
export type QuestStripElements = QuestStripPaintDescriptor;

function box(el: Element): QuestStripBox {
  const rect = el.getBoundingClientRect();
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
}

/** Owns the selection, the localized render model, and the gated band measure. */
export class QuestStripController {
  private quests: readonly TrackedQuest[] = [];
  private index = 0;
  private pressed = false;
  private flash: QuestStripFlash | null = null;
  private flashPhase: 0 | 1 = 0;
  /** The last painted content, kept for seat()'s own gate below (which needs
   *  the full rendered text, not just the raw key resolve() is gated on). */
  private signature = '';
  /** The raw, pre-t() fingerprint resolve() is gated on: which quest is shown,
   *  its objective counts, and the counter/overflow numbers, plus the locale
   *  generation below. None of those move on a medium-band tick unless the
   *  player's progress or selection actually changed, so a steady strip costs
   *  no t()/formatNumber call at all. */
  private resolveKey = '';
  /** The last resolve() output, reused verbatim while resolveKey holds. */
  private resolved: Omit<QuestStripPaintModel, 'pressed' | 'flash'> | null = null;
  /** Bumped by relocalize(): every field resolveKey is built from is a raw id,
   *  number or flag that a language switch alone never moves, so the
   *  generation is the only signal that a translated string underneath it
   *  changed. */
  private localeGeneration = 0;
  private seatKey = '';
  private ticksSinceSeatMeasure = 0;
  /** The last frame time the tracker handed down, and when the player last
   *  cycled by hand, both on the HUD's monotonic clock. The controller never
   *  reads a clock of its own, so a cycle timestamps itself off the most recent
   *  repaint; that is at most one medium-band tick stale, which the multi-second
   *  grace below cannot notice. */
  private nowMs = 0;
  private lastCycleAt: number | null = null;

  /** Resolved on the first seat: every band occupant is a static shell element. */
  private occupantEls: (Element | null)[] | null = null;

  private readonly painter: QuestStripPainter;
  private readonly gesture: QuestStripGesture;

  constructor(
    private readonly els: QuestStripElements,
    private readonly deps: QuestStripDeps,
    // Injectable so a Node test can drive the seat gating without a real window;
    // the default is the live one.
    private readonly win: Pick<Window, 'innerWidth' | 'innerHeight'> = window,
  ) {
    this.painter = new QuestStripPainter(deps.writers, els);
    this.gesture = new QuestStripGesture({
      surface: els.surface,
      cycle: (step) => this.cycle(step),
      setPressed: (pressed) => {
        this.pressed = pressed;
        this.repaint();
      },
    });
    this.gesture.attach();
  }

  /** True while the strip is the surface in use, which is what tells the
   *  tracker to stop rendering its own (CSS-hidden) markup on touch. */
  active(): boolean {
    return this.els.root.ownerDocument.body?.classList.contains(TOUCH_BODY_CLASS) === true;
  }

  /** Take the tracked quests the tracker already projected. The selection is
   *  CLAMPED rather than reset, so completing a quest does not throw the player
   *  back to the first one mid-fight.
   *
   *  A quest that just made objective progress TAKES the strip: the one line the
   *  band shows should be the one the player is being given credit for. The pure
   *  core owns both halves of that decision (what counts as progress, and the
   *  grace that leaves a hand cycle alone for a few seconds), so `now` is the
   *  HUD's frame clock passed straight through. */
  update(quests: readonly TrackedQuest[], now: number): void {
    this.nowMs = now;
    const jump = questStripProgressJump({
      previous: this.quests,
      next: quests,
      now,
      lastCycleAt: this.lastCycleAt,
    });
    this.quests = quests;
    if (jump !== null) this.index = jump;
    this.repaint();
    // The bounded periodic re-measure, counted on the TRACKER's tick rather
    // than on repaints, so a burst of gesture repaints cannot pull it forward.
    if (++this.ticksSinceSeatMeasure >= SEAT_REMEASURE_TICKS) {
      this.ticksSinceSeatMeasure = 0;
      this.seat(true);
    }
  }

  /** Language switch: bump the generation so the next repaint re-resolves every
   *  t()/formatNumber call even though the raw quest data behind resolveKey may
   *  not have moved (a translated string differing is not something that key
   *  can see on its own). Repaints immediately so the caption is never left one
   *  tick stale in the old language. */
  relocalize(): void {
    this.localeGeneration++;
    this.repaint();
  }

  /** Move the selection, wrapping in both directions. */
  cycle(step: QuestStripStep): void {
    if (this.quests.length < 2) return;
    this.index = cycleQuestStrip(this.index, step, this.quests.length);
    this.lastCycleAt = this.nowMs;
    this.flashPhase = this.flashPhase === 0 ? 1 : 0;
    this.flash = { step, phase: this.flashPhase };
    this.deps.click();
    this.repaint();
  }

  private repaint(): void {
    const view = questStripView(this.quests, this.index);
    this.index = view.index;
    const key = this.rawKey(view);
    if (this.resolved === null || key !== this.resolveKey) {
      this.resolved = this.resolve(view);
      this.resolveKey = key;
    }
    // The press and the chevron pulse are transient, so they always paint even
    // on a tick the resolve above was skipped; the content behind them rides
    // the elided writers either way.
    this.painter.paint({ ...this.resolved, pressed: this.pressed, flash: this.flash });
    // Entered EVERY repaint and gated inside: the band's occupants (the buff
    // bars, the party stack, the minimap's zone label) come and go without the
    // quest text moving, and so do a rotation and a tier flip, so gating the
    // ENTRY on the rendered text left every one of those unseated until the
    // next quest event.
    this.seat(false);
  }

  /** Every raw input the resolve below reads, before a single t()/formatNumber
   *  call: which quest (by id; the title/label strings TrackedQuest carries are
   *  already locale-resolved by the tracker and cannot themselves be compared
   *  for free), its complete flag, the counter's position/total, the overflow
   *  count, and each objective's current/total/done. The locale generation
   *  covers what the strip resolves itself, which none of those raw fields
   *  would otherwise move on a language switch alone (see relocalize()). */
  private rawKey(view: QuestStripView): string {
    return [
      this.localeGeneration,
      view.visible ? '1' : '0',
      view.id,
      view.complete ? '1' : '0',
      view.counter.visible ? '1' : '0',
      view.counter.position,
      view.counter.total,
      view.hiddenObjectives,
      ...view.objectives.map((o) => `${o.current}/${o.total}/${o.done ? '1' : '0'}`),
    ].join('|');
  }

  /** The t()/formatNumber resolve, run only when rawKey() moved. */
  private resolve(view: QuestStripView): Omit<QuestStripPaintModel, 'pressed' | 'flash'> {
    const objectives = view.objectives.map<QuestStripObjectiveLine>((objective) => ({
      text: t('questUi.detail.objectiveProgress', {
        label: objective.label,
        current: this.number(objective.current),
        total: this.number(objective.total),
      }),
      done: objective.done,
    }));
    const model = {
      visible: view.visible,
      title: view.title,
      complete: view.complete,
      completeLabel: view.complete ? `(${t('questUi.tracker.complete')})` : '',
      counter: view.counter.visible
        ? t('hudChrome.mobile.questStripCounter', {
            position: this.number(view.counter.position),
            total: this.number(view.counter.total),
          })
        : '',
      counterVisible: view.counter.visible,
      hint: this.hintText(view),
      objectives,
      more:
        view.hiddenObjectives > 0
          ? t('hudChrome.mobile.questStripMore', { count: this.number(view.hiddenObjectives) })
          : '',
    };
    // Kept for seat()'s own gate, which needs the full rendered text (a buff
    // icon's stack text or the minimap zone label can change width without a
    // quest event, which rawKey() above never sees).
    this.signature = [
      model.visible ? '1' : '0',
      model.title,
      model.completeLabel,
      model.counter,
      model.hint,
      model.more,
      ...objectives.map((line) => `${line.done ? '1' : '0'}${line.text}`),
    ].join('\u0000');
    return model;
  }

  /** The off-screen description: what the strip is and what activating it does.
   *  The visible chevrons are a HINT rather than buttons, so the sentence is the
   *  only place the cycle action is spelled out. */
  private hintText(view: QuestStripView): string {
    if (!view.visible) return '';
    if (!view.counter.visible)
      return t('hudChrome.mobile.questStripAriaSingle', { title: view.title });
    return t('hudChrome.mobile.questStripAria', {
      position: this.number(view.counter.position),
      total: this.number(view.counter.total),
      title: view.title,
    });
  }

  private number(value: number): string {
    return formatNumber(value, { maximumFractionDigits: 0 });
  }

  /**
   * The band occupants' non-layout signature: what each one is (its classes)
   * and how much it holds (its child count, which is what a buff gained or a
   * party member joined moves). Element refs are resolved ONCE, since every
   * selector names a static element of the shell.
   */
  private occupantKey(doc: Document): string {
    if (this.occupantEls === null) {
      this.occupantEls = BAND_OCCUPANT_SELECTORS.map((selector) => doc.querySelector(selector));
    }
    let key = '';
    for (const el of this.occupantEls) {
      if (!el) continue;
      key += `${el.className}:${el.childElementCount};`;
    }
    return key;
  }

  /**
   * Measure the band and bound the strip's width. Gated behind a key built only
   * from non-layout reads, so a steady HUD costs no rect read at all; it runs on
   * a content change (the strip's own box moved), a layout change (viewport,
   * tier, UI scale) or an occupant change (a bar appearing, the zone label
   * swapping), plus the bounded periodic sweep `forced` carries for the width
   * changes no cheap signal can see. The target frame is not in the key, which
   * is the point: neither its class nor its style may change what this writes.
   */
  private seat(forced: boolean): void {
    const doc = this.els.root.ownerDocument;
    const key = [
      this.signature,
      this.win.innerWidth,
      this.win.innerHeight,
      doc.body?.getAttribute('class') ?? '',
      doc.documentElement.getAttribute('style') ?? '',
      this.occupantKey(doc),
    ].join('|');
    if (!forced && key === this.seatKey) return;

    // The strip is seated inside #mobile-controls, which is sized from the
    // shared app-viewport box, so the container's own box is both the clamp
    // width and the origin every measured rect converts against.
    const container = this.els.root.parentElement;
    if (!container) return;
    const origin = box(container);
    const width = origin.right - origin.left;
    if (width <= 0) return;
    const shift = (measured: QuestStripBox): QuestStripBox => ({
      left: measured.left - origin.left,
      right: measured.right - origin.left,
      top: measured.top - origin.top,
      bottom: measured.bottom - origin.top,
    });
    // The anchor is READ, never written: the stylesheet owns it, and reading it
    // back is what lets the width be expressed from the same origin as the
    // occupants. Writing only a max-width cannot move it, so there is no loop.
    const own = shift(box(this.els.root));
    // Nothing tracked yet, so the strip is display:none and its box is at the
    // origin. Leaving without latching keeps a bogus bound off it and lets the
    // first real quest seat it properly.
    if (own.right - own.left <= 0) return;

    const occupants: QuestStripBox[] = [];
    for (const el of this.occupantEls ?? []) {
      if (!el) continue;
      const measured = shift(box(el));
      if (measured.right - measured.left <= 0) continue;
      occupants.push(measured);
    }
    this.painter.place(
      questStripBand({
        viewportWidth: width,
        anchorLeft: own.left,
        occupants,
        // The lane is the CONSTANT band height, deliberately not the strip's
        // own measured box: the box grows downward with the tracked quest's
        // objective count, so feeding that back in would let an occupant start
        // capping the width mid-flight as the objective list changed.
        stripHeight: QUEST_STRIP_FALLBACK_HEIGHT_PX,
      }),
    );
    // Latched only on a seat that actually happened: an early return above (a
    // container with no box yet, before the touch HUD is laid out) must leave
    // the next tick free to try again rather than remembering the attempt.
    this.seatKey = key;
  }
}

/** Build the strip, or return null when the markup is absent (a build that omits
 *  it, or a Node test with no document at all). */
export function buildQuestStrip(deps: QuestStripDeps): QuestStripController | null {
  if (typeof document === 'undefined') return null;
  const root = document.getElementById(ROOT_ID);
  const surface = document.getElementById(SURFACE_ID);
  const title = document.getElementById(TITLE_ID);
  const completeMark = document.getElementById(COMPLETE_ID);
  const cycleHint = document.getElementById(CYCLE_ID);
  const counter = document.getElementById(COUNT_ID);
  const prevArrow = document.getElementById(PREV_ID);
  const nextArrow = document.getElementById(NEXT_ID);
  const more = document.getElementById(MORE_ID);
  const hint = document.getElementById(HINT_ID);
  if (!root || !surface || !title || !completeMark || !cycleHint) return null;
  if (!counter || !prevArrow || !nextArrow || !more || !hint) return null;
  const objectives = [...root.querySelectorAll<HTMLElement>(OBJECTIVE_SELECTOR)];
  if (objectives.length === 0) return null;
  return new QuestStripController(
    {
      root,
      surface,
      title,
      completeMark,
      cycleHint,
      counter,
      prevArrow,
      nextArrow,
      objectives,
      more,
      hint,
    },
    deps,
  );
}
