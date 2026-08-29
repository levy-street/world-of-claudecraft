// Shared movable / lockable HUD-frame controller: the DOM wiring behind the
// small corner button that toggles a frame between locked (fixed) and unlocked
// (draggable), the pointer drag itself, the optional SE-corner size grip, and
// localStorage persistence of the chosen spot. Extracted from the hud.ts
// target-frame cluster on its second instance (the player frame),
// INSTANCE-PARAMETERIZED per the HUD component recipe: each frame passes its
// element, storage key, labels, and body class.
// The pure position + scale math (clamping, (de)serialization) stays in
// target_frame_pos.ts; the saved spot survives reloads, the lock state does not
// (a frame always loads locked so a stray drag never moves it). Desktop only:
// the button is hidden on mobile-touch by CSS and the drag gate checks
// isMobileLayout(), where the mobile stylesheet owns frame positions.
//
// Two config shapes ride this one class. The three unit frames keep their
// always-visible corner button and move only. The frames the "Unlock interface"
// option governs (interface_unlock.ts) pass `buttonOnlyWhenUnlocked` plus
// `scalable`, so they carry no permanent chrome and gain both gestures the
// moment the coordinator calls setLockState(true).
// Both gestures are pointer AND keyboard operable: the move button takes arrow
// keys to position, and the grip takes arrow keys to size. Neither is a
// pointer-only affordance, because each is the ONLY route to what it changes.

import { t } from './i18n';
import type { TranslationKey } from './i18n.catalog';
import {
  anchorAdjustedPos,
  boxFromEdgeDrag,
  clampFrameDimension,
  clampFrameScale,
  cursorForFrameEdge,
  type FrameEdge,
  frameEdgeAtPoint,
  frameScales,
  labelBelowFrame,
  parseTargetFramePos,
  placeTargetFrame,
  posFromEdgeResize,
  scaleFromKeyStep,
  serializeTargetFramePos,
  sizeFromEdgeDrag,
  snapFrameCoord,
  snapFrameSize,
  snapScaleToGrid,
  stepCoordToGridLine,
  type TargetFramePos,
} from './target_frame_pos';
import { getUiScale } from './ui_scale';

export interface MovableFrameConfig {
  frame: HTMLElement;
  /** localStorage key the chosen top-left persists under. */
  storageKey: string;
  /** aria-label / title while LOCKED (aria-pressed=false): press to move it. */
  unlockLabelKey: TranslationKey;
  /** aria-label / title while UNLOCKED (aria-pressed=true): press to fix it. */
  lockLabelKey: TranslationKey;
  /** Body class set while a drag is live (CSS disables user-select under it). */
  draggingBodyClass: string;
  /** Nominal size used to clamp a saved spot while the frame is display:none. */
  fallbackSize: { w: number; h: number };
  isMobileLayout(): boolean;
  /** Fired whenever a custom position starts (true) or stops (false) applying,
   *  e.g. the player frame detaches from the action-bar stack to position:fixed. */
  onPositioned?(active: boolean): void;
  /** Give the frame the shared SE-corner grip (the chat box / meter panel one)
   *  so it can be scaled as well as moved. Off by default: the three unit frames
   *  that shipped this controller are sized by their own Interface sliders. */
  scalable?: boolean;
  /** Accessible name / tooltip on the resize grip. Required when `scalable` is
   *  set: the grip is a real button, so it is never nameless. */
  resizeLabelKey?: TranslationKey;
  /** Hide the corner move button while the frame is LOCKED, so the frame is
   *  movable only through the global "Unlock interface" toggle. The three unit
   *  frames leave this unset and keep their always-visible corner button. */
  buttonOnlyWhenUnlocked?: boolean;
  /** Name chip shown on the frame while unlocked, so a force-shown placeholder
   *  (an empty cast bar, a disabled action bar) is never an anonymous box. */
  frameLabelKey?: TranslationKey;
  /**
   * What a SIDE-edge drag does. 'scale' (the default) stretches that axis of
   * the frame's transform (the horizontal-only / vertical-only adjustment),
   * which visibly resizes fixed content: an action bar's slots, the minimap,
   * a portrait. 'box' writes a real layout width/height instead and belongs to
   * frames that genuinely reflow (the chat box, the wrapping aura rows), where
   * the box IS the content area. Corners and the grip are always the
   * proportional whole-frame zoom under those two modes. 'dimensions' is the
   * raid-frame model: EVERY resize gesture (sides, corners, the grip) reads
   * and writes the frame's real width/height SETTINGS through `dimensions`,
   * so contents re-lay-out at their crisp text size and the options sliders
   * stay the one source of truth; no transform is ever written, and a legacy
   * saved stretch (scale/scaleX/scaleY) is dropped rather than re-applied.
   */
  resizeMode?: 'scale' | 'box' | 'dimensions';
  /** The setting-backed axes 'dimensions' mode drives. An absent axis leaves
   *  that direction inert. Values are SETTING px, not visual px. */
  dimensions?: {
    width?: FrameDimension;
    height?: FrameDimension;
  };
  /** Whether the arrange-mode Snap to Grid setting is on (drags land on the
   *  shared FRAME_SNAP_GRID and resizes quantize to the same pitch). Absent
   *  means never snap: the same optional-dep shape the chat controller's
   *  snapToGrid takes. */
  snapToGrid?: () => boolean;
}

/** One settings-backed axis for resizeMode 'dimensions'. `factor` converts one
 *  setting px into the visual px it paints BEFORE the global UI scale (the
 *  frame's content zoom, times any fan-out such as party row count for a
 *  per-row height setting); default 1. Read once at gesture start. */
export interface FrameDimension {
  get(): number;
  set(value: number): void;
  min: number;
  max: number;
  factor?: () => number;
}

/** Class stamped on a frame the player chose to hide via the frames menu. The
 *  stylesheet's matching rules use !important so the class beats the painters'
 *  inline display writes AND the edit mode's force-shown placeholders. */
export const FRAME_USER_HIDDEN_CLASS = 'tf-user-hidden';
/** Appended to storageKey for the persisted hidden flag, so the choice rides
 *  the same per-frame key family as the saved box. */
const HIDDEN_STORAGE_SUFFIX = '_hidden';
/** Delay for the trailing post-resize re-derive, long enough for a fullscreen
 *  transition's window metrics to settle. */
const RESIZE_SETTLE_MS = 200;

/** One shared listener set per Document (see MovableFrame.registryFor):
 *  the registered frames, the coalesced resize settle timer, and the count
 *  of live gestures the pointermove fan-out gates on. */
interface FrameDispatchEntry {
  frames: Set<MovableFrame>;
  settleTimer?: ReturnType<typeof setTimeout>;
  active: number;
}

type MoveGesture = { kind: 'move'; pointerId: number; grabX: number; grabY: number };
/** A transform resize: a side edge stretches its own axis, a corner (or the
 *  SE grip) zooms both proportionally. */
type ScaleGesture = {
  kind: 'scale';
  pointerId: number;
  edge: FrameEdge;
  startX: number;
  startY: number;
  startSx: number;
  startSy: number;
  startLeft: number;
  startTop: number;
  startW: number;
  startH: number;
};
/** A side edge: a LAYOUT stretch of one axis (real width/height, so contents
 *  reflow and text keeps its aspect). `factor` converts the pointer's visual
 *  travel into author px: the live uniform zoom times the UI scale. */
type StretchGesture = {
  kind: 'stretch';
  pointerId: number;
  edge: FrameEdge;
  startX: number;
  startY: number;
  factor: number;
  startLeft: number;
  startTop: number;
  startWVis: number;
  startHVis: number;
  startWAuthor: number;
  startHAuthor: number;
};
/** resizeMode 'dimensions': the drag walks the frame's real width/height
 *  SETTINGS. startW/startH are the setting values at gesture start; fw/fh the
 *  visual px one setting px paints (axis factor x UI scale), captured once so
 *  the whole drag maps pointer travel consistently; lastW/lastH elide the
 *  per-move setting writes to actual changes. */
type DimensionGesture = {
  kind: 'dims';
  pointerId: number;
  edge: FrameEdge;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  startW: number;
  startH: number;
  fw: number;
  fh: number;
  lastW: number;
  lastH: number;
};

/** Keyboard steps for the grip in 'dimensions' mode (setting px per press;
 *  Shift is the 1px fine step). Height steps smaller because its band is a
 *  bar thickness (tens of px), not a frame width (hundreds). */
const DIMENSION_KEY_STEP_W = 5;
const DIMENSION_KEY_STEP_H = 2;

export class MovableFrame {
  private pos: TargetFramePos | null = null;
  private unlocked = false;
  private userHidden = false;
  private gestureState: MoveGesture | ScaleGesture | StretchGesture | DimensionGesture | null =
    null;

  /** The gesture accessor keeps the dispatch entry's live-gesture counter in
   *  step with every assignment site, so the shared pointermove fan-out can
   *  return before touching any frame while nothing is being dragged. */
  private get gesture(): MoveGesture | ScaleGesture | StretchGesture | DimensionGesture | null {
    return this.gestureState;
  }

  private set gesture(next: MoveGesture | ScaleGesture | StretchGesture | DimensionGesture | null) {
    this.entry.active += (next ? 1 : 0) - (this.gestureState ? 1 : 0);
    this.gestureState = next;
  }

  /** Leave the shared dispatcher: the registry is otherwise append-only, and
   *  a torn-down frame (a test document, a future rebuilt HUD) must not keep
   *  receiving fanned-out events. */
  dispose(): void {
    this.gesture = null;
    this.entry.frames.delete(this);
  }

  private readonly entry: FrameDispatchEntry;
  private lastHoverCursor = '';
  /** The edge that cursor was set FOR: opposite edges share a cursor, so the
   *  elision above must compare both (see setHoverCursor). */
  private lastHoverEdge: FrameEdge | undefined;
  /** One shared document/window listener set per Document for EVERY frame
   *  (review finding on PR #3284): with ~17 instances, per-instance
   *  registration meant every pointermove ran seventeen DOM dispatches and a
   *  viewport resize armed seventeen independent settle timers. The
   *  dispatcher fans one event out over the registry instead; per-frame
   *  gesture guards keep the fan-out cheap. Keyed per Document (a WeakMap)
   *  so test harnesses that stub a fresh document per case each get their
   *  own armed listeners and registry. */
  private static readonly registries = new WeakMap<Document, FrameDispatchEntry>();

  private static registryFor(doc: Document): FrameDispatchEntry {
    const existing = MovableFrame.registries.get(doc);
    if (existing) return existing;
    const entry: FrameDispatchEntry = { frames: new Set<MovableFrame>(), active: 0 };
    MovableFrame.registries.set(doc, entry);
    doc.addEventListener('pointermove', (ev) => {
      // The live-gesture counter (kept by the `gesture` accessor) lets an
      // idle mouse move over a locked HUD return without touching a frame.
      if (entry.active <= 0) return;
      for (const frame of entry.frames) frame.onPointerMove(ev as PointerEvent);
    });
    const end = (ev: Event) => {
      for (const frame of entry.frames) frame.onPointerEnd(ev as PointerEvent);
    };
    doc.addEventListener('pointerup', end);
    doc.addEventListener('pointercancel', end);
    // The document's OWN window (falling back to the module global for bare
    // test documents), so a second Document never re-arms the first's.
    (doc.defaultView ?? window).addEventListener('resize', () => {
      // Once now and once after the metrics settle: a resize event fired
      // mid-transition (an OS fullscreen exit, emulated viewports) can still
      // observe the OLD innerWidth/Height, making the re-anchor a silent
      // no-op with no follow-up event to correct it. The trailing pass
      // re-derives from storage again, which is idempotent. ONE coalesced
      // timer for the whole registry, not one per frame.
      const rederiveAll = () => {
        for (const frame of entry.frames) frame.rederiveFromSaved();
      };
      rederiveAll();
      clearTimeout(entry.settleTimer);
      entry.settleTimer = setTimeout(rederiveAll, RESIZE_SETTLE_MS);
    });
    return entry;
  }
  /** Bottom edge (visual px) at the last applyPos, for reanchorBottom(). */
  private lastBottom: number | null = null;
  private readonly btn: HTMLButtonElement;
  private grip: HTMLButtonElement | null = null;
  private label: HTMLElement | null = null;

  constructor(private readonly cfg: MovableFrameConfig) {
    // The corner toggle. Built here (like the chat resize grip) so index.html
    // stays untouched; its glyph + position are styled in hud.css.
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tf-move-btn';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight');
    cfg.frame.appendChild(btn);
    this.btn = btn;
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.setUnlocked(!this.unlocked);
    });
    btn.addEventListener('keydown', (ev) => this.onKeyMove(ev));

    // The SE-corner grip, built here like the button (and like the chat box's own
    // grip) so index.html stays untouched. CSS keeps it out of the way while the
    // frame is locked; the pointer gate below refuses a locked gesture anyway.
    // It is a real BUTTON, not the decorative div the chat box uses: this one is
    // the only path to a frame's size, so it carries its own accessible name and
    // the arrow-key resize below, exactly as the move button carries arrow-key
    // positioning. A pointer-only grip would leave a keyboard player able to
    // unlock and move every frame but resize none of them.
    if (cfg.scalable) {
      const grip = document.createElement('button');
      grip.type = 'button';
      // The second class is what scopes the "only while unlocked" CSS gate to
      // this controller's grips, leaving the chat box + meter panel grips alone.
      grip.className = 'panel-resize-grip mf-resize-grip';
      grip.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight');
      cfg.frame.appendChild(grip);
      this.grip = grip;
      grip.addEventListener('pointerdown', (ev) => this.onScaleStart(ev));
      grip.addEventListener('keydown', (ev) => this.onKeyScale(ev));
      // Hovering the corner grip lights the two edges it resizes (right and
      // bottom, its own corner), through the same data-resize-edge channel
      // the border hover writes.
      grip.addEventListener('pointerenter', () => {
        // Through setHoverCursor so the hover MEMO tracks the grip's 'se'
        // stamp (the grip carries its own CSS cursor, so the frame's inline
        // cursor is simply released to the stylesheet here).
        if (this.unlocked && !this.cfg.isMobileLayout()) this.setHoverCursor('', 'se');
      });
      grip.addEventListener('pointerleave', () => {
        // Through setHoverCursor so the hover elision MEMO clears too:
        // removing only the attribute left the memo holding the border the
        // pointer arrived from, and sliding back onto that same band stayed
        // elided with the highlight gone (review round four). Also covers
        // the stale 'se' left when a grip drag ends off the frame.
        if (!this.gesture) this.setHoverCursor('', undefined);
      });
    }
    // The name chip: plain text naming WHICH frame this is, because an unlocked
    // placeholder (an empty cast bar, a disabled action bar) is otherwise an
    // anonymous dashed box. Appended after the button + grip so their child
    // indices stay stable; CSS shows it only while the frame is unlocked.
    if (cfg.frameLabelKey) {
      const label = document.createElement('span');
      label.className = 'tf-frame-label';
      cfg.frame.appendChild(label);
      this.label = label;
    }
    // The border-hover highlight surface: a dedicated overlay child the
    // stylesheet paints per data-resize-edge (see .tf-edge-glow in hud.css),
    // stacked over the frame's own content so the hovered side's bar is
    // never hidden behind the bars and buttons inside the frame. Appended
    // LAST so the button/grip/label child indices above stay stable.
    if (cfg.scalable) {
      const glow = document.createElement('span');
      glow.className = 'tf-edge-glow';
      glow.setAttribute('aria-hidden', 'true');
      cfg.frame.appendChild(glow);
    }
    this.refreshChrome();

    // touch-action:none (so a drag is not stolen by browser panning) is scoped to
    // the unlocked state in CSS (.unitframe.tf-unlocked), never applied while
    // locked so it cannot interfere with normal touch behaviour on the frame.
    cfg.frame.addEventListener('pointerdown', (ev) => this.onMoveStart(ev));
    // A scalable frame resizes from its borders like a desktop window: hovering
    // an edge shows the matching resize cursor (onEdgeHover) and a press there
    // starts an edge-scale gesture instead of a move (onMoveStart). Event-driven
    // and unlocked-only, so a locked frame never pays the hit test.
    if (cfg.scalable) {
      cfg.frame.addEventListener('pointermove', (ev) => this.onEdgeHover(ev));
      cfg.frame.addEventListener('pointerleave', () => this.setHoverCursor(''));
    }
    // One SHARED listener set per document dispatches pointer and resize
    // events over every registered frame (see registryFor above).
    this.entry = MovableFrame.registryFor(document);
    this.entry.frames.add(this);

    let saved: string | null = null;
    try {
      saved = localStorage.getItem(cfg.storageKey);
    } catch {
      /* storage unavailable */
    }
    const parsedSaved = parseTargetFramePos(saved);
    const adopted = this.adoptPos(parsedSaved);
    this.pos = adopted;
    if (this.pos) {
      const legacy = this.pos.vw === undefined;
      // Captured BEFORE applyPos, which always rebuilds this.pos.
      const stripped = adopted !== parsedSaved;
      this.applyPos();
      // One-time migration: a payload saved before the viewport stamp existed
      // cannot re-anchor across a resolution change (pre-stamp saves kept
      // drifting between fullscreen and windowed). The apply above stamped
      // the CURRENT viewport, adopting "where the frame renders right now"
      // as the anchor basis; persisting it upgrades the save in place. A
      // payload adoptPos stripped a legacy stretch from is upgraded the same
      // way, so the retired scaleX/scaleY never outlive the mode switch.
      if (legacy || stripped) this.persistPos();
    }

    // The persisted hidden choice (the frames menu), reapplied class-first so a
    // hidden frame never flashes on load.
    let hidden = false;
    try {
      hidden = localStorage.getItem(cfg.storageKey + HIDDEN_STORAGE_SUFFIX) === '1';
    } catch {
      /* storage unavailable */
    }
    if (hidden) this.setUserHidden(true);
  }

  /** Re-resolve the button's + grip's t() labels in place (language switch). */
  relocalize(): void {
    this.refreshChrome();
  }

  /** Localized display name for menus (the frames show/hide list); empty for a
   *  frame that carries no name chip. */
  labelText(): string {
    return this.cfg.frameLabelKey ? t(this.cfg.frameLabelKey) : '';
  }

  /** Whether the player hid this frame via the frames menu. */
  get isUserHidden(): boolean {
    return this.userHidden;
  }

  /** Hide or show the whole frame (the frames menu while editing). Class-driven
   *  so the stylesheet's !important rules beat the painters' inline display
   *  writes; persisted beside the saved box so the choice survives reloads. */
  setUserHidden(hidden: boolean): void {
    this.userHidden = hidden;
    this.cfg.frame.classList.toggle(FRAME_USER_HIDDEN_CLASS, hidden);
    try {
      if (hidden) localStorage.setItem(this.cfg.storageKey + HIDDEN_STORAGE_SUFFIX, '1');
      else localStorage.removeItem(this.cfg.storageKey + HIDDEN_STORAGE_SUFFIX);
    } catch {
      /* storage unavailable */
    }
  }

  /** True while the frame accepts a drag / grip gesture. */
  get isUnlocked(): boolean {
    return this.unlocked;
  }

  /** Drive the lock state from outside the corner button, which is what the
   *  global "Unlock interface" toggle does. Kept a plain setter (no toggle) so
   *  the coordinator decides the state for every frame at once and one frame can
   *  never fall out of step with the others. */
  setLockState(unlocked: boolean): void {
    this.setUnlocked(unlocked);
  }

  /** Repaint the saved visual-space position against the live UI Scale. */
  reapplyPosition(): void {
    if (this.pos) this.applyPos();
  }

  /**
   * Put the frame's BOTTOM edge back where it was the last time a position was
   * applied, absorbing whatever height it gained or lost meanwhile into the
   * saved top. The combined action bar group grows upward from the bottom row
   * this way: adding a bar with the plus button leaves bar 1 exactly where the
   * player's hand expects it (the buttons live on that bar) and stacks the new
   * row above, instead of shoving the whole block downward.
   *
   * A no-op until the frame carries a custom position, since a docked frame is
   * laid out by the stylesheet and has no top of ours to adjust.
   */
  reanchorBottom(): void {
    if (!this.pos || this.lastBottom === null || this.cfg.isMobileLayout()) return;
    const rect = this.cfg.frame.getBoundingClientRect();
    const shift = rect.bottom - this.lastBottom;
    if (Math.abs(shift) < 0.5) return;
    this.pos = { ...this.pos, top: this.pos.top - shift };
    this.applyPos();
    this.persistPos();
  }

  /** Drop the APPLIED geometry (inline styles, any detach, AND the in-memory
   *  position) while KEEPING the saved spot in storage, so a frame that goes
   *  inactive (an action bar folded into the combined group) re-docks to its
   *  stylesheet position and comes back exactly where the player had put it
   *  via restoreSavedPosition(). The in-memory drop matters: a retired shape
   *  that kept `pos` would re-apply it on the next reapplyAll (a UI Scale
   *  change) and position a frame that is not supposed to be positioned.
   *  reset() is the destructive sibling that also forgets the store. */
  clearAppliedGeometry(): void {
    this.setUnlocked(false);
    this.pos = null;
    this.lastBottom = null;
    for (const prop of [
      'left',
      'top',
      'right',
      'bottom',
      'transform',
      'transform-origin',
      'width',
      'height',
    ])
      this.cfg.frame.style.removeProperty(prop);
    this.cfg.onPositioned?.(false);
  }

  /** Re-adopt the saved spot from storage and apply it: the way back after
   *  clearAppliedGeometry, used when a frame becomes the ACTIVE shape again
   *  (the combined group when combining turns on, the three bars when it turns
   *  off). A frame with no saved spot stays on its stylesheet position. */
  restoreSavedPosition(): void {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(this.cfg.storageKey);
    } catch {
      /* storage unavailable */
    }
    this.pos = this.adoptPos(parseTargetFramePos(saved));
    if (this.pos) this.applyPos();
  }

  /** Drop the frame's SIZE adjustments only (the grip and corner zoom, a side
   *  stretch), keeping its position: the Frames Settings menu's Reset Frame
   *  Sizes action. Dimensions-mode frames carry their sizes in real settings,
   *  which the caller resets alongside; stripping the pos fields here still
   *  matters for them (a pre-mode legacy stretch must not survive a reset).
   *  A frame with no saved position has nothing to strip. */
  resetSize(): void {
    if (!this.pos) return;
    this.pos = { left: this.pos.left, top: this.pos.top, vw: this.pos.vw, vh: this.pos.vh };
    this.applyPos();
    this.persistPos();
  }

  /** Snap the frame back to its stock CSS spot: forget the saved position,
   *  clear the inline styles, undo any detach (onPositioned(false)), and lock
   *  the frame. Wired to the "Reset Frame Positions" interface option. */
  reset(): void {
    if (this.gesture) {
      this.gesture = null;
      document.body.classList.remove(this.cfg.draggingBodyClass);
    }
    this.pos = null;
    try {
      localStorage.removeItem(this.cfg.storageKey);
    } catch {
      /* storage unavailable */
    }
    // `transform`, `transform-origin`, `width` and `height` are cleared too: a
    // zoomed or stretched frame that kept its size after a reset would come
    // back wrong, and the cast bar's own translateX centering must go back to
    // owning the property.
    for (const prop of [
      'left',
      'top',
      'right',
      'bottom',
      'transform',
      'transform-origin',
      'width',
      'height',
    ])
      this.cfg.frame.style.removeProperty(prop);
    this.cfg.onPositioned?.(false);
    // Reset means "back to the base game", and a frame the player hid via the
    // frames menu is part of what it undoes.
    this.setUserHidden(false);
    this.setUnlocked(false);
  }

  // The move button's accessible name / tooltip and pressed state track whether the
  // frame is unlocked; the frame gets a class so the cursor + drag affordance show.
  private refreshChrome(): void {
    const label = this.unlocked ? t(this.cfg.lockLabelKey) : t(this.cfg.unlockLabelKey);
    this.btn.setAttribute('aria-pressed', this.unlocked ? 'true' : 'false');
    this.btn.setAttribute('aria-label', label);
    this.btn.title = label;
    this.btn.classList.toggle('active', this.unlocked);
    // A frame driven only by the global toggle keeps no permanent chrome: its
    // button is hidden (and taken out of the tab order) until the interface is
    // unlocked, so the stock HUD looks exactly as it did.
    if (this.cfg.buttonOnlyWhenUnlocked) {
      this.btn.classList.toggle('tf-move-btn-hidden', !this.unlocked);
      this.btn.hidden = !this.unlocked;
    }
    this.cfg.frame.classList.toggle('tf-unlocked', this.unlocked);
    // The grip is a real control too, so it follows the button out of the tab
    // order while the frame is locked. CSS already hides it (it is styled off a
    // .tf-unlocked parent), but `hidden` is what keeps a locked frame's grip
    // unreachable to a keyboard even before the stylesheet has a say.
    if (this.grip) {
      if (this.cfg.resizeLabelKey) {
        const resizeLabel = t(this.cfg.resizeLabelKey);
        this.grip.setAttribute('aria-label', resizeLabel);
        this.grip.title = resizeLabel;
      }
      this.grip.hidden = !this.unlocked;
    }
    // Re-resolved here so the chip rides the same relocalize() path as the
    // button and grip; `hidden` keeps a locked frame's chip out of the
    // accessibility tree even before the stylesheet hides it.
    if (this.label && this.cfg.frameLabelKey) {
      this.label.textContent = t(this.cfg.frameLabelKey);
      this.label.hidden = !this.unlocked;
      if (this.unlocked) this.placeLabel();
    }
  }

  // The chip sits ABOVE the frame, where it never covers the frame's own
  // contents. A frame parked against the top of the viewport has no room up
  // there, and a chip clipped off-screen is what leaves a frame looking
  // nameless, so those flip below instead.
  private placeLabel(): void {
    if (!this.label) return;
    const top = this.cfg.frame.getBoundingClientRect().top;
    this.label.classList.toggle('tf-label-below', labelBelowFrame(top));
  }

  private setUnlocked(unlocked: boolean): void {
    this.unlocked = unlocked;
    // A frame locked mid-hover must not keep a stale resize cursor.
    if (!unlocked) this.setHoverCursor('');
    this.refreshChrome();
  }

  // Seed the position from the live rect the first time a drag starts, so a frame
  // still on its CSS default converts cleanly to explicit px coordinates.
  private ensurePos(): void {
    if (this.pos) return;
    const rect = this.cfg.frame.getBoundingClientRect();
    this.pos = { left: rect.left, top: rect.top };
  }

  private onMoveStart(ev: PointerEvent): void {
    if (ev.button !== 0 || this.cfg.isMobileLayout() || !this.unlocked) return;
    const target = ev.target as HTMLElement | null;
    // The move button (and any icon buttons inside the frame) keep their own
    // behaviour; only the frame body area initiates a drag.
    if (!target || target.closest('button')) return;
    ev.preventDefault();
    this.ensurePos();
    // Apply the position NOW (converting a CSS-default spot to explicit px and
    // firing any detach side effect) so the grab offsets below are measured
    // against the frame's final dragged size, not its docked one.
    this.applyPos();
    const rect = this.cfg.frame.getBoundingClientRect();
    // The border band starts a resize instead of a move on a scalable frame,
    // the desktop-window contract: the outline resizes (corners zoom the whole
    // frame, sides stretch one axis), the interior drags.
    const edge = this.cfg.scalable ? frameEdgeAtPoint(rect, ev.clientX, ev.clientY) : null;
    if (edge) {
      // In dimensions mode every border band walks the real settings: a side
      // its own axis, a corner both at once. Otherwise corners always zoom
      // the whole frame, and a side edge stretches the layout box only on a
      // frame that reflows; everywhere else it zooms too, since a taller box
      // around fixed contents changes nothing a player can see.
      if (this.cfg.resizeMode === 'dimensions') {
        this.beginDimensionGesture(ev, edge, rect);
        return;
      }
      const stretches = edge.length === 1 && this.cfg.resizeMode === 'box';
      if (stretches) this.beginStretchGesture(ev, edge, rect);
      else this.beginScaleGesture(ev, edge, rect);
      return;
    }
    this.gesture = {
      kind: 'move',
      pointerId: ev.pointerId,
      grabX: ev.clientX - rect.left,
      grabY: ev.clientY - rect.top,
    };
    this.beginGesture(ev);
  }

  // The SE grip resizes rather than moves. It sits inside the frame, so its own
  // pointerdown would otherwise also start a move: stopping propagation here is
  // what keeps the two gestures apart (the frame listener runs on the bubble).
  private onScaleStart(ev: PointerEvent): void {
    if (ev.button !== 0 || this.cfg.isMobileLayout() || !this.unlocked) return;
    ev.stopPropagation();
    this.ensurePos();
    this.applyPos();
    const rect = this.cfg.frame.getBoundingClientRect();
    if (this.cfg.resizeMode === 'dimensions') this.beginDimensionGesture(ev, 'se', rect);
    else this.beginScaleGesture(ev, 'se', rect);
  }

  // Shared by the grip (always 'se') and the corner bands: a uniform zoom of
  // the whole frame. The caller has already applied the position, so this.pos
  // holds the clamped visual top-left the anchor math resolves against.
  private beginScaleGesture(
    ev: PointerEvent,
    edge: FrameEdge,
    rect: { left: number; top: number; width: number; height: number },
  ): void {
    const { sx, sy } = frameScales(this.pos);
    this.gesture = {
      kind: 'scale',
      pointerId: ev.pointerId,
      edge,
      startX: ev.clientX,
      startY: ev.clientY,
      startSx: sx,
      startSy: sy,
      startLeft: this.pos?.left ?? rect.left,
      startTop: this.pos?.top ?? rect.top,
      startW: rect.width,
      startH: rect.height,
    };
    this.beginGesture(ev);
  }

  // A side edge: a layout stretch of the axis that edge owns. The author-space
  // start box comes from the persisted w/h when present, else from the live
  // rect divided back through the zoom + UI scale it was measured under.
  private beginStretchGesture(
    ev: PointerEvent,
    edge: FrameEdge,
    rect: { left: number; top: number; width: number; height: number },
  ): void {
    // The visual-to-author factor: the live uniform zoom times the UI scale
    // (box frames keep their axes equal, so sx stands in for the uniform zoom).
    const factor = frameScales(this.pos).sx * getUiScale();
    this.gesture = {
      kind: 'stretch',
      pointerId: ev.pointerId,
      edge,
      startX: ev.clientX,
      startY: ev.clientY,
      factor,
      startLeft: this.pos?.left ?? rect.left,
      startTop: this.pos?.top ?? rect.top,
      startWVis: rect.width,
      startHVis: rect.height,
      startWAuthor: this.pos?.w ?? (factor > 0 ? rect.width / factor : rect.width),
      startHAuthor: this.pos?.h ?? (factor > 0 ? rect.height / factor : rect.height),
    };
    this.beginGesture(ev);
  }

  // resizeMode 'dimensions': the drag drives the frame's real width/height
  // settings. The per-axis factors are read ONCE here (they can query layout,
  // e.g. a party row count) so every move maps travel the same way; the
  // setting write itself happens per move in onPointerMove, giving the live
  // reflow feedback a slider drag has.
  private beginDimensionGesture(
    ev: PointerEvent,
    edge: FrameEdge,
    rect: { left: number; top: number },
  ): void {
    const dims = this.cfg.dimensions;
    const startW = dims?.width?.get() ?? 0;
    const startH = dims?.height?.get() ?? 0;
    this.gesture = {
      kind: 'dims',
      pointerId: ev.pointerId,
      edge,
      startX: ev.clientX,
      startY: ev.clientY,
      startLeft: this.pos?.left ?? rect.left,
      startTop: this.pos?.top ?? rect.top,
      startW,
      startH,
      fw: (dims?.width?.factor?.() ?? 1) * getUiScale(),
      fh: (dims?.height?.factor?.() ?? 1) * getUiScale(),
      lastW: startW,
      lastH: startH,
    };
    this.beginGesture(ev);
  }

  private beginGesture(ev: PointerEvent): void {
    ev.preventDefault();
    document.body.classList.add(this.cfg.draggingBodyClass);
    try {
      this.cfg.frame.setPointerCapture?.(ev.pointerId);
    } catch {
      /* synthetic pointer */
    }
  }

  private onPointerMove(ev: PointerEvent): void {
    const g = this.gesture;
    if (!g || g.pointerId !== ev.pointerId) return;
    ev.preventDefault();
    // With Snap to Grid on (the arrange-mode setting, read through the
    // provider hud wires), a dragged box lands on the shared grid and a
    // resize quantizes the frame's visual size to the same pitch, so
    // frames align without pixel hunting.
    const snap = this.cfg.snapToGrid?.() ?? false;
    if (g.kind === 'move') {
      const left = ev.clientX - g.grabX;
      const top = ev.clientY - g.grabY;
      this.pos = {
        ...this.pos,
        left: snap ? snapFrameCoord(left) : left,
        top: snap ? snapFrameCoord(top) : top,
      };
    } else if (g.kind === 'scale') {
      // A side edge stretches only its own axis (the horizontal-only /
      // vertical-only adjustment); a corner multiplies both by the larger
      // ratio, staying the proportional zoom the SE grip always was.
      let next = sizeFromEdgeDrag(
        g.edge,
        { sx: g.startSx, sy: g.startSy },
        { w: g.startW, h: g.startH },
        ev.clientX - g.startX,
        ev.clientY - g.startY,
      );
      if (snap) {
        // Snap the zoom so the frame's visual size lands on the grid. A
        // corner (or the grip) stays a proportional zoom: the width picks
        // the snapped ratio and both axes take it.
        if (g.edge === 'e' || g.edge === 'w') {
          next = {
            sx: clampFrameScale(snapScaleToGrid(g.startW, g.startSx, next.sx)),
            sy: next.sy,
          };
        } else if (g.edge === 'n' || g.edge === 's') {
          next = {
            sx: next.sx,
            sy: clampFrameScale(snapScaleToGrid(g.startH, g.startSy, next.sy)),
          };
        } else if (g.startSx > 0) {
          const ratio = snapScaleToGrid(g.startW, g.startSx, next.sx) / g.startSx;
          next = {
            sx: clampFrameScale(g.startSx * ratio),
            sy: clampFrameScale(g.startSy * ratio),
          };
        }
      }
      // Recomputed from the gesture-start snapshot each event (not incremental),
      // so a west/north drag keeps the opposite border pixel-anchored.
      const anchored = posFromEdgeResize(
        g.edge,
        { left: g.startLeft, top: g.startTop, w: g.startW, h: g.startH },
        {
          w: g.startSx > 0 ? g.startW * (next.sx / g.startSx) : g.startW,
          h: g.startSy > 0 ? g.startH * (next.sy / g.startSy) : g.startH,
        },
      );
      this.pos = {
        left: anchored.left,
        top: anchored.top,
        scaleX: next.sx,
        scaleY: next.sy,
        w: this.pos?.w,
        h: this.pos?.h,
      };
    } else if (g.kind === 'dims') {
      // Each axis the grabbed edge owns maps pointer travel into SETTING px
      // through the gesture's captured factor and writes the setting (which
      // re-lays-out the frame live); a west/north grab absorbs the growth
      // into left/top so the opposite border stays pixel-anchored and the
      // grabbed edge follows the pointer, like every other resize here.
      const dims = this.cfg.dimensions;
      let left = g.startLeft;
      let top = g.startTop;
      const width = dims?.width;
      if (width && (g.edge.includes('e') || g.edge.includes('w'))) {
        const travel = g.edge.includes('w') ? g.startX - ev.clientX : ev.clientX - g.startX;
        const rawW = g.startW + (g.fw > 0 ? travel / g.fw : 0);
        // Snap the VISUAL extent (setting px times the captured factor), not
        // the setting value: the grid is screen space, and a fanned-out axis
        // (the party stack) still lands its outer edge on it.
        const snappedW = snap && g.fw > 0 ? snapFrameSize(rawW * g.fw) / g.fw : rawW;
        const next = clampFrameDimension(snappedW, width.min, width.max);
        if (next !== g.lastW) {
          g.lastW = next;
          width.set(next);
        }
        if (g.edge.includes('w')) left = g.startLeft - (g.lastW - g.startW) * g.fw;
      }
      const height = dims?.height;
      if (height && (g.edge.includes('n') || g.edge.includes('s'))) {
        const travel = g.edge.includes('n') ? g.startY - ev.clientY : ev.clientY - g.startY;
        const rawH = g.startH + (g.fh > 0 ? travel / g.fh : 0);
        const snappedH = snap && g.fh > 0 ? snapFrameSize(rawH * g.fh) / g.fh : rawH;
        const next = clampFrameDimension(snappedH, height.min, height.max);
        if (next !== g.lastH) {
          g.lastH = next;
          height.set(next);
        }
        if (g.edge.includes('n')) top = g.startTop - (g.lastH - g.startH) * g.fh;
      }
      this.pos = { ...this.pos, left, top };
    } else {
      const box = boxFromEdgeDrag(
        g.edge,
        { w: g.startWAuthor, h: g.startHAuthor },
        ev.clientX - g.startX,
        ev.clientY - g.startY,
        g.factor,
      );
      // Snap ONLY the stretched axis's VISUAL extent onto the grid (author
      // px times the gesture factor), like every other resize here; the
      // cross axis is not part of this gesture (the pos write below drops
      // it anyway, so snapping it was dead math at best).
      if (snap && g.factor > 0) {
        if (g.edge === 'e' || g.edge === 'w') box.w = snapFrameSize(box.w * g.factor) / g.factor;
        else box.h = snapFrameSize(box.h * g.factor) / g.factor;
      }
      const anchored = posFromEdgeResize(
        g.edge,
        { left: g.startLeft, top: g.startTop, w: g.startWVis, h: g.startHVis },
        { w: box.w * g.factor, h: box.h * g.factor },
      );
      // Only the axis this edge owns is persisted; the other stays whatever it
      // was (usually absent), so a width stretch never pins the height inline.
      const horizontal = g.edge === 'e' || g.edge === 'w';
      this.pos = {
        ...this.pos,
        left: anchored.left,
        top: anchored.top,
        w: horizontal ? box.w : this.pos?.w,
        h: horizontal ? this.pos?.h : box.h,
      };
    }
    this.applyPos();
  }

  private onPointerEnd(ev: PointerEvent): void {
    const g = this.gesture;
    if (!g || g.pointerId !== ev.pointerId) return;
    this.gesture = null;
    document.body.classList.remove(this.cfg.draggingBodyClass);
    this.persistPos();
  }

  // The desktop-window hover affordance: the border band shows the matching
  // resize cursor AND advertises itself with a per-side highlight (the
  // data-resize-edge attribute the stylesheet paints; the review's live
  // play-testing found a cursor change alone too subtle to discover). The
  // body keeps the stylesheet's move cursor. Inline so it can vary per edge,
  // elided through lastHoverCursor so an unmoved hover writes nothing, and
  // left alone mid-gesture so the grabbed edge's cursor sticks.
  private onEdgeHover(ev: PointerEvent): void {
    if (this.gesture) return;
    // A move over the grip bubbles through here with the pointer INSIDE the
    // border band's dead zone, which would clear the 'se' pair the grip's
    // own pointerenter just stamped; the grip owns its hover entirely.
    if (this.grip && ev.target === this.grip) return;
    if (!this.unlocked || this.cfg.isMobileLayout()) {
      this.setHoverCursor('');
      return;
    }
    const rect = this.cfg.frame.getBoundingClientRect();
    const edge = frameEdgeAtPoint(rect, ev.clientX, ev.clientY);
    this.setHoverCursor(edge ? cursorForFrameEdge(edge) : '', edge ?? undefined);
  }

  private setHoverCursor(cursor: string, edge?: FrameEdge): void {
    // Elided on BOTH halves: opposite edges share a cursor (n and s are both
    // ns-resize), so a cursor-only guard kept the old side's highlight
    // painted after a jump across the frame (review round three).
    if (cursor === this.lastHoverCursor && edge === this.lastHoverEdge) return;
    this.lastHoverCursor = cursor;
    this.lastHoverEdge = edge;
    // '' clears the inline value, handing the cursor back to the stylesheet's
    // move affordance on the frame body.
    this.cfg.frame.style.cursor = cursor;
    if (edge) this.cfg.frame.setAttribute('data-resize-edge', edge);
    else this.cfg.frame.removeAttribute('data-resize-edge');
  }

  // Re-clamp into view when the viewport changes (mirrors the chat box
  // logic), deriving from the SAVED spot rather than the last render:
  // leaving fullscreen clamps a frame into the smaller window, and
  // re-clamping from the already-clamped value would make that shrink
  // permanent. From storage, growing the window back restores the exact
  // saved location. A mid-gesture resize is left alone (the live drag owns
  // the position; its drop re-applies and persists anyway), and a frame
  // whose spot never reached storage keeps its in-memory one. Driven by the
  // shared per-document dispatcher (registryFor), never a per-instance
  // resize listener.
  private rederiveFromSaved(): void {
    if (this.gesture || !this.pos) return;
    let savedNow: string | null = null;
    try {
      savedNow = localStorage.getItem(this.cfg.storageKey);
    } catch {
      /* storage unavailable */
    }
    const parsed = this.adoptPos(parseTargetFramePos(savedNow));
    // A payload without the viewport stamp cannot re-anchor honestly; the
    // in-memory pos carries the stamp of the viewport it was last applied
    // under (the pre-change one), so it is the better basis then.
    if (parsed && parsed.vw !== undefined) this.pos = parsed;
    this.applyPos();
  }

  // Once unlocked, arrow keys provide the same persisted positioning path as a
  // pointer drag. This keeps the move toggle useful to keyboard-only players;
  // Shift gives a one-pixel fine adjustment instead of the default ten pixels.
  private onKeyMove(ev: KeyboardEvent): void {
    if (!this.unlocked || this.cfg.isMobileLayout()) return;
    const directions: Partial<Record<string, TargetFramePos>> = {
      ArrowLeft: { left: -1, top: 0 },
      ArrowRight: { left: 1, top: 0 },
      ArrowUp: { left: 0, top: -1 },
      ArrowDown: { left: 0, top: 1 },
    };
    const direction = directions[ev.key];
    if (!direction) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.ensurePos();
    // With Snap to Grid on the coarse step walks grid LINES (a 10px step
    // could never land on the 16px pitch, locking keyboard-only players out
    // of the feature); Shift stays the 1px fine step and bypasses the grid.
    const snap = !ev.shiftKey && (this.cfg.snapToGrid?.() ?? false);
    const step = ev.shiftKey ? 1 : 10;
    const left = this.pos?.left ?? 0;
    const top = this.pos?.top ?? 0;
    this.pos = {
      ...this.pos,
      left:
        snap && direction.left !== 0
          ? stepCoordToGridLine(left, direction.left as 1 | -1)
          : left + direction.left * step,
      top:
        snap && direction.top !== 0
          ? stepCoordToGridLine(top, direction.top as 1 | -1)
          : top + direction.top * step,
    };
    this.applyPos();
    this.persistPos();
  }

  // The grip's keyboard half, the exact mirror of onKeyMove: arrow keys walk
  // the uniform zoom the grip drag writes, Shift gives the fine step, and the
  // result persists like any other grip gesture. Right/Down grow and Left/Up
  // shrink, matching which way the SE grip travels for the same change; a
  // stretched box rides along untouched, so keyboard zoom never distorts it.
  private onKeyScale(ev: KeyboardEvent): void {
    if (!this.unlocked || this.cfg.isMobileLayout()) return;
    if (this.cfg.resizeMode === 'dimensions') {
      this.onKeyDimension(ev);
      return;
    }
    const directions: Partial<Record<string, number>> = {
      ArrowLeft: -1,
      ArrowUp: -1,
      ArrowRight: 1,
      ArrowDown: 1,
    };
    const direction = directions[ev.key];
    if (direction === undefined) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.ensurePos();
    // Both axes step together (a proportional zoom, like the grip); a frame
    // that was side-stretched keeps its chosen aspect while the keyboard walks
    // its overall size, since each axis takes the same additive step.
    const { sx, sy } = frameScales(this.pos);
    const snap = !ev.shiftKey && (this.cfg.snapToGrid?.() ?? false);
    if (snap) {
      // Step the frame's VISUAL width to the next grid line and give both
      // axes the shared ratio, so the keyboard reaches exactly the sizes a
      // snapped grip drag does (Shift keeps the fine scale step above).
      const width = this.cfg.frame.getBoundingClientRect().width;
      if (width > 0 && sx > 0) {
        const ratio =
          clampFrameScale(stepCoordToGridLine(width, direction as 1 | -1) / (width / sx)) / sx;
        this.pos = {
          ...this.pos,
          left: this.pos?.left ?? 0,
          top: this.pos?.top ?? 0,
          scaleX: clampFrameScale(sx * ratio),
          scaleY: clampFrameScale(sy * ratio),
        };
        this.applyPos();
        this.persistPos();
        return;
      }
    }
    this.pos = {
      ...this.pos,
      left: this.pos?.left ?? 0,
      top: this.pos?.top ?? 0,
      scaleX: scaleFromKeyStep(sx, direction, ev.shiftKey),
      scaleY: scaleFromKeyStep(sy, direction, ev.shiftKey),
    };
    this.applyPos();
    this.persistPos();
  }

  // The grip keyboard in dimensions mode walks the same settings the pointer
  // gesture drives, one axis per arrow pair: Left/Right shrink/grow the
  // width, Up/Down shrink/grow the height (growth matching the SE grip's
  // travel, like the zoom keyboard above), Shift the 1px fine step. The
  // setting's own persistence is the persistence; no pos write is needed.
  private onKeyDimension(ev: KeyboardEvent): void {
    const dims = this.cfg.dimensions;
    const steps: Partial<Record<string, { axis: 'width' | 'height'; dir: 1 | -1 }>> = {
      ArrowLeft: { axis: 'width', dir: -1 },
      ArrowRight: { axis: 'width', dir: 1 },
      ArrowUp: { axis: 'height', dir: -1 },
      ArrowDown: { axis: 'height', dir: 1 },
    };
    const step = steps[ev.key];
    if (!step) return;
    const dim = step.axis === 'width' ? dims?.width : dims?.height;
    if (!dim) return;
    ev.preventDefault();
    ev.stopPropagation();
    const current = dim.get();
    // With Snap to Grid on the coarse step walks the axis's VISUAL extent
    // (setting px times its factor and the UI scale) to the next grid line,
    // matching a snapped edge drag; Shift stays the 1px fine setting step.
    const snap = !ev.shiftKey && (this.cfg.snapToGrid?.() ?? false);
    const factor = (dim.factor?.() ?? 1) * getUiScale();
    if (snap && factor > 0) {
      const nextVisual = stepCoordToGridLine(current * factor, step.dir);
      const next = clampFrameDimension(nextVisual / factor, dim.min, dim.max);
      if (next !== current) dim.set(next);
      return;
    }
    const size = ev.shiftKey
      ? 1
      : step.axis === 'width'
        ? DIMENSION_KEY_STEP_W
        : DIMENSION_KEY_STEP_H;
    const next = clampFrameDimension(current + step.dir * size, dim.min, dim.max);
    if (next !== current) dim.set(next);
  }

  /** In dimensions mode a saved transform stretch must never re-apply: the
   *  axis sizes live in the real settings now, and a legacy scale/scaleX/
   *  scaleY (or stretch-mode w/h) would distort the reflowed layout. Returns
   *  the SAME reference when nothing needs stripping, so callers can detect
   *  an upgrade and persist it. */
  private adoptPos(pos: TargetFramePos | null): TargetFramePos | null {
    if (!pos || this.cfg.resizeMode !== 'dimensions') return pos;
    if (
      pos.scale === undefined &&
      pos.scaleX === undefined &&
      pos.scaleY === undefined &&
      pos.w === undefined &&
      pos.h === undefined
    )
      return pos;
    return { left: pos.left, top: pos.top, vw: pos.vw, vh: pos.vh };
  }

  private applyPos(): void {
    if (!this.pos) return;
    const frame = this.cfg.frame;
    // On the mobile layout the desktop-saved position must not apply. Clear any
    // inline left/top/right/bottom (e.g. left over after a live desktop-to-mobile
    // viewport shrink) so the mobile stylesheet owns the frame's position again.
    if (this.cfg.isMobileLayout()) {
      for (const prop of [
        'left',
        'top',
        'right',
        'bottom',
        'transform',
        'transform-origin',
        'width',
        'height',
      ])
        frame.style.removeProperty(prop);
      this.cfg.onPositioned?.(false);
      return;
    }
    // Write the zoom + box BEFORE measuring, so the rect the clamp sees is the
    // frame at its chosen size. `scale()` deliberately REPLACES whatever the
    // stylesheet had (the cast bar's translateX(-50%) centering): once the frame
    // carries an explicit left/top, that centering would double-offset it. The
    // stretched box is a real layout width/height, so contents reflow rather
    // than distort; an axis never stretched writes nothing and keeps its
    // stylesheet size.
    if (this.cfg.scalable && this.cfg.resizeMode !== 'dimensions') {
      const { sx, sy } = frameScales(this.pos);
      frame.style.transformOrigin = 'top left';
      // The one-argument form when the axes agree, so a frame that was never
      // side-stretched writes the exact transform it always had.
      frame.style.transform = sx === sy ? `scale(${sx})` : `scale(${sx}, ${sy})`;
      if (this.pos.w !== undefined) frame.style.width = `${this.pos.w}px`;
      else frame.style.removeProperty('width');
      if (this.pos.h !== undefined) frame.style.height = `${this.pos.h}px`;
      else frame.style.removeProperty('height');
    }
    // Detach BEFORE measuring: a docked frame (the player frame in the action-bar
    // stack) changes size when its detached style kicks in, and the clamp must see
    // the size the frame will actually have at the applied position.
    this.cfg.onPositioned?.(true);
    const rect = frame.getBoundingClientRect();
    // The frame may be display:none (target frame with no target; rect is 0x0);
    // fall back to a nominal size so a saved spot still clamps sensibly.
    const size = {
      w: rect.width || this.cfg.fallbackSize.w,
      h: rect.height || this.cfg.fallbackSize.h,
    };
    // this.pos, the rect, and the viewport are all in visual (post-zoom) space; the
    // frame lives inside #ui (`zoom: var(--ui-scale)`), so the style write divides by
    // the live UI scale into author space (placeTargetFrame). The clamped VISUAL spot
    // is what we keep + persist, so a saved position renders at the same visual place
    // at any UI Scale. Before clamping, a spot saved under a DIFFERENT viewport
    // re-anchors per axis (anchorAdjustedPos), so leaving fullscreen moves a
    // bottom-parked bar with the bottom edge instead of leaving it stranded at
    // its old absolute distance from the top; the applied pos is stamped with
    // the CURRENT viewport, which the next persist writes.
    const viewport = { w: window.innerWidth, h: window.innerHeight };
    const placement = placeTargetFrame(
      anchorAdjustedPos(this.pos, size, viewport),
      viewport,
      size,
      getUiScale(),
    );
    this.pos = { ...placement.pos, vw: viewport.w, vh: viewport.h };
    frame.style.left = `${placement.css.left}px`;
    frame.style.top = `${placement.css.top}px`;
    frame.style.right = 'auto';
    frame.style.bottom = 'auto';
    // Re-decide the chip side from the spot the frame just landed on, so
    // dragging one up under the viewport edge flips its name below live.
    if (this.unlocked) this.placeLabel();
    this.lastBottom = placement.pos.top + size.h;
  }

  private persistPos(): void {
    if (!this.pos) return;
    try {
      localStorage.setItem(this.cfg.storageKey, serializeTargetFramePos(this.pos));
    } catch {
      /* storage unavailable */
    }
  }
}
