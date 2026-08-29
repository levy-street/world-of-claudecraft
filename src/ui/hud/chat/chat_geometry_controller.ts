import { t } from '../../i18n';
import { storePromoReservedHeight } from '../../store_promo_card';
import {
  cursorForFrameEdge,
  type FrameEdge,
  frameEdgeAtPoint,
  MIN_FRAME_BOX,
  snapFrameCoord,
  snapFrameSize,
  stepCoordToGridLine,
} from '../../target_frame_pos';
import {
  anchorAdjustedChatBox,
  CHAT_BOX_LIMITS,
  type ChatBoxGeometry,
  parseChatBox,
  placeChatBox,
  serializeChatBox,
} from './chat_window';

const CHAT_GEOMETRY_KEY = 'woc_chat_geometry';
const MOBILE_CHAT_BOTTOM_KEY = 'woc_mobile_chat_bottom';
/** Delay for the trailing post-resize re-derive, long enough for a fullscreen
 *  transition's window metrics to settle (mirrors MovableFrame's). */
const CHAT_RESIZE_SETTLE_MS = 200;
/** Keyboard steps for the move and resize buttons, mirroring MovableFrame's
 *  arrow-key path: a coarse default with Shift as the one-pixel fine step. */
const CHAT_KEY_STEP = 10;
const CHAT_KEY_STEP_FINE = 1;

export interface ChatGeometryControllerDeps {
  document: Document;
  window: Window;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  isMobileLayout(): boolean;
  hasStorePromoCard(): boolean;
  uiScale(): number;
  /** True while the global "Unlock interface" toggle is on: the whole chat box
   *  then drags from anywhere, not only the tab strip, so it moves like every
   *  other unlocked HUD frame. Optional so callers without the toggle (tests)
   *  keep the tab-strip-only contract unchanged. */
  isInterfaceUnlocked?(): boolean;
  /** Whether the arrange-mode Snap to Grid setting is on: a dragged chat box
   *  then lands on the same FRAME_SNAP_GRID every MovableFrame snaps to.
   *  Optional; absent means never snap. */
  snapToGrid?(): boolean;
}

type ChatBoxGesture =
  | { kind: 'move'; pointerId: number; grabX: number; grabY: number }
  | {
      kind: 'resize';
      pointerId: number;
      startX: number;
      startY: number;
      startW: number;
      startH: number;
    }
  | {
      // The arrange-mode border resize: the chat box is one of the two frames
      // whose contents genuinely reflow, so every border sizes the real box.
      // `edge` also decides which corner stays anchored.
      kind: 'edge';
      pointerId: number;
      edge: FrameEdge;
      startX: number;
      startY: number;
      startLeft: number;
      startTop: number;
      startW: number;
      startH: number;
    };

export class ChatGeometryController {
  private chatBox: ChatBoxGeometry | null = null;
  private chatBoxGesture: ChatBoxGesture | null = null;
  private mobileChatResize: {
    pointerId: number;
    startY: number;
    startBottom: number;
  } | null = null;
  /** Elides the inline border-hover cursor write (a CSS value, never text). */
  private hoverCursor = '';
  /** The edge that cursor was set FOR: opposite edges share a cursor, so the
   *  hover elision compares both. */
  private hoverEdge: FrameEdge | null = null;
  /** Coalesces the trailing post-resize re-derive (CHAT_RESIZE_SETTLE_MS). */
  private resizeSettleTimer: ReturnType<typeof setTimeout> | undefined;
  /** The wrap's box for the arrange-mode border hit test, derived from the
   *  APPLIED placement (or the one ensureGeometry measure) rather than a
   *  getBoundingClientRect per pointermove: the review found the per-move
   *  read flushing layout on every hover while unlocked. Nulled whenever the
   *  geometry can move under it (viewport resize); apply() refills it. */
  private wrapRect: { left: number; top: number; width: number; height: number } | null = null;
  /** Localized chrome this controller writes once at init; relocalize()
   *  rewrites them on a runtime language switch. */
  private localized: {
    tabs?: HTMLElement;
    grip?: HTMLElement;
    moveBtn?: HTMLElement;
    frameLabel?: HTMLElement;
    resizeHandle?: HTMLElement;
  } = {};

  constructor(private readonly deps: ChatGeometryControllerDeps) {}

  init(): void {
    const wrap = this.deps.document.getElementById('chatlog-wrap');
    const tabs = this.deps.document.getElementById('chatlog-tabs');
    const frame = this.deps.document.getElementById('chatlog-frame');
    if (!wrap || !tabs || !frame) return;

    // A real named button, not a decorative div: the SE grip is the chat
    // box's one resize affordance, so it takes arrow keys (Shift for the
    // fine step) exactly like every MovableFrame grip (src/ui/CLAUDE.md, the
    // keyboard-operable frame-gesture contract).
    const grip = this.deps.document.createElement('button');
    grip.type = 'button';
    grip.className = 'chat-resize-grip';
    grip.title = t('hudChrome.chatWindow.resize');
    grip.setAttribute('aria-label', t('hudChrome.chatWindow.resize'));
    grip.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight');
    grip.addEventListener('keydown', (event) => this.onKeyResize(event, wrap, tabs));
    // Hovering the grip lights the two edges it resizes (right and bottom)
    // through the same data-resize-edge channel the border hover writes;
    // arrange mode only, matching the highlight's own CSS gate.
    grip.addEventListener('pointerenter', () => {
      // The hover MEMO tracks the grip's stamp (the grip carries its own
      // CSS cursor, so the wrap's inline cursor is released here).
      if (this.deps.isInterfaceUnlocked?.() && !this.deps.isMobileLayout()) {
        this.hoverCursor = '';
        this.hoverEdge = 'se';
        wrap.style.cursor = '';
        wrap.setAttribute('data-resize-edge', 'se');
      }
    });
    grip.addEventListener('pointerleave', () => {
      // Clear the hover elision MEMO with the attribute: leaving only the
      // attribute meant sliding back onto the border band the pointer came
      // from stayed elided and the highlight never repainted (review round
      // four, mirroring MovableFrame's grip leave).
      if (!this.chatBoxGesture) {
        this.hoverCursor = '';
        this.hoverEdge = null;
        wrap.style.cursor = '';
        wrap.removeAttribute('data-resize-edge');
      }
    });
    frame.appendChild(grip);

    const resizeHandle = this.deps.document.createElement('div');
    resizeHandle.className = 'chat-mobile-resize';
    resizeHandle.title = t('hudChrome.chatWindow.resize');
    resizeHandle.setAttribute('aria-hidden', 'true');
    this.deps.document.body.appendChild(resizeHandle);
    resizeHandle.addEventListener('pointerdown', (event) =>
      this.onMobileResizeStart(event, resizeHandle),
    );
    resizeHandle.addEventListener('pointermove', (event) => this.onMobileResizeMove(event));
    const endMobileResize = (event: PointerEvent): void => this.onMobileResizeEnd(event);
    resizeHandle.addEventListener('pointerup', endMobileResize);
    resizeHandle.addEventListener('pointercancel', endMobileResize);
    try {
      const savedBottom = this.deps.storage.getItem(MOBILE_CHAT_BOTTOM_KEY);
      if (savedBottom) {
        const clamped = this.clampMobileBottom(Number.parseInt(savedBottom, 10) || 52);
        this.deps.document.documentElement.style.setProperty(
          '--mobile-chat-bottom',
          `${clamped}px`,
        );
      }
    } catch {
      // Storage can be unavailable in private browsing modes.
    }

    tabs.setAttribute('aria-label', t('hudChrome.chatWindow.move'));
    tabs.addEventListener('pointerdown', (event) => this.onMoveStart(event, wrap, tabs));
    // While the interface is unlocked the whole box is a drag handle (its panes
    // are pointer-inert under body.interface-unlocked, so the event target is
    // the wrap itself). The tab strip keeps its own listener either way.
    wrap.addEventListener('pointerdown', (event) => {
      if (!this.deps.isInterfaceUnlocked?.()) return;
      // Border first, body second: the same desktop-window split every other
      // unlocked frame uses. The chat box has no MovableFrame, so it wires the
      // shared edge helpers itself.
      const edge = this.edgeAt(event, wrap, tabs);
      if (edge) this.onEdgeStart(event, wrap, tabs, edge);
      else this.onMoveStart(event, wrap, tabs);
    });
    wrap.addEventListener('pointermove', (event) => {
      if (this.chatBoxGesture || !this.deps.isInterfaceUnlocked?.()) return;
      // A move over the grip bubbles through here from inside the border
      // band's dead zone; the grip's own hover stamps the 'se' pair.
      if (event.target === grip) return;
      const edge = this.edgeAt(event, wrap, tabs);
      const cursor = edge ? cursorForFrameEdge(edge) : '';
      // Elided on BOTH halves: opposite edges share a cursor, so a
      // cursor-only guard kept the old side's highlight painted after a
      // jump across the box (review round three).
      if (cursor !== this.hoverCursor || edge !== this.hoverEdge) {
        this.hoverCursor = cursor;
        this.hoverEdge = edge;
        wrap.style.cursor = cursor;
        // The same per-side highlight every MovableFrame border wears
        // (data-resize-edge, painted by the stylesheet): a cursor change
        // alone proved too subtle in live play-testing.
        if (edge) wrap.setAttribute('data-resize-edge', edge);
        else wrap.removeAttribute('data-resize-edge');
      }
    });
    // The arrange-mode name chip every movable frame wears; shown by the
    // stylesheet only under body.interface-unlocked, rewritten by
    // relocalize() on a language switch.
    const frameLabel = this.deps.document.createElement('span');
    frameLabel.className = 'tf-frame-label';
    frameLabel.textContent = t('hudChrome.interfaceUnlock.frameNames.chat');
    wrap.appendChild(frameLabel);
    // The border-hover highlight surface (see .tf-edge-glow in hud.css).
    const edgeGlow = this.deps.document.createElement('span');
    edgeGlow.className = 'tf-edge-glow';
    edgeGlow.setAttribute('aria-hidden', 'true');
    wrap.appendChild(edgeGlow);
    // The arrange-mode keyboard MOVE half (the tab-strip drag's counterpart),
    // a real button like every MovableFrame's corner toggle: arrow keys step
    // the box, Shift for the fine step. The stylesheet shows it only under
    // body.interface-unlocked, so the locked HUD gains no tab stop.
    const moveBtn = this.deps.document.createElement('button');
    moveBtn.type = 'button';
    moveBtn.className = 'tf-move-btn chat-move-btn';
    moveBtn.setAttribute('aria-label', t('hudChrome.chatWindow.move'));
    moveBtn.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight');
    moveBtn.addEventListener('keydown', (event) => this.onKeyMove(event, wrap, tabs));
    wrap.appendChild(moveBtn);
    this.localized = { tabs, grip, moveBtn, frameLabel, resizeHandle };
    grip.addEventListener('pointerdown', (event) => this.onResizeStart(event, wrap, frame));
    this.deps.document.addEventListener('pointermove', (event) => this.onPointerMove(event));
    const end = (event: PointerEvent): void => this.onPointerEnd(event);
    this.deps.document.addEventListener('pointerup', end);
    this.deps.document.addEventListener('pointercancel', end);
    // Derive from the SAVED geometry rather than the last render: apply()
    // clamps into the current viewport AND keeps the clamped box, so leaving
    // fullscreen would otherwise make the shrink permanent. From storage,
    // growing the window back restores the exact saved box. A box that never
    // reached storage keeps its in-memory one; a live drag owns the geometry.
    const rederiveFromSaved = () => {
      if (!this.chatBox) return;
      if (this.chatBoxGesture === null) {
        const savedBox = this.loadSaved();
        // A payload without the viewport stamp cannot re-anchor honestly; the
        // in-memory box carries the stamp of the viewport it was last applied
        // under (the pre-change one), so it is the better basis then.
        if (savedBox?.vw !== undefined) this.chatBox = savedBox;
      }
      this.apply();
    };
    this.deps.window.addEventListener('resize', () => {
      // Once now and once after the metrics settle: a resize event fired
      // mid-transition (an OS fullscreen exit, emulated viewports) can still
      // observe the OLD innerWidth/Height, making the re-anchor a silent
      // no-op with no follow-up event to correct it. The trailing pass
      // re-derives from storage again, which is idempotent.
      this.wrapRect = null;
      rederiveFromSaved();
      clearTimeout(this.resizeSettleTimer);
      this.resizeSettleTimer = setTimeout(rederiveFromSaved, CHAT_RESIZE_SETTLE_MS);
    });

    this.chatBox = this.loadSaved();
    if (this.chatBox) {
      const legacy = this.chatBox.vw === undefined;
      this.apply();
      // One-time migration, exactly as MovableFrame does it: a pre-stamp save
      // cannot re-anchor, so the apply above stamps the current viewport and
      // the persist upgrades the save in place.
      if (legacy) this.persist();
    }
  }

  private loadSaved(): ChatBoxGeometry | null {
    let saved: string | null = null;
    try {
      saved = this.deps.storage.getItem(CHAT_GEOMETRY_KEY);
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
    return parseChatBox(saved);
  }

  reapply(): void {
    const host = this.deps.document.getElementById('chatlog-wrap');
    const tabs = this.deps.document.getElementById('chatlog-tabs');
    if (host && tabs) this.ensureGeometry(host, tabs);
    this.apply();
  }

  reset(): void {
    this.chatBox = null;
    try {
      this.deps.storage.removeItem(CHAT_GEOMETRY_KEY);
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
    for (const id of ['chatlog-wrap', 'chatlog-frame', 'chat-input']) {
      const element = this.deps.document.getElementById(id);
      if (!element) continue;
      for (const property of ['left', 'top', 'right', 'bottom', 'width', 'height']) {
        element.style.removeProperty(property);
      }
    }
  }

  private ensureGeometry(wrap: HTMLElement, tabs: HTMLElement): void {
    if (this.chatBox) return;
    const wrapRect = wrap.getBoundingClientRect();
    const frameRect = this.deps.document.getElementById('chatlog-frame')?.getBoundingClientRect();
    const chromeHeight = tabs.getBoundingClientRect().height;
    this.chatBox = {
      left: wrapRect.left,
      top: wrapRect.top,
      width: wrapRect.width,
      height: frameRect ? frameRect.height : Math.max(0, wrapRect.height - chromeHeight),
    };
    this.wrapRect = {
      left: wrapRect.left,
      top: wrapRect.top,
      width: wrapRect.width,
      height: wrapRect.height,
    };
  }

  private onMoveStart(event: PointerEvent, wrap: HTMLElement, tabs: HTMLElement): void {
    if (event.button !== 0 || this.deps.isMobileLayout()) return;
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('button')) return;
    event.preventDefault();
    this.ensureGeometry(wrap, tabs);
    const rect = wrap.getBoundingClientRect();
    this.chatBoxGesture = {
      kind: 'move',
      pointerId: event.pointerId,
      grabX: event.clientX - rect.left,
      grabY: event.clientY - rect.top,
    };
    this.deps.document.body.classList.add('chat-box-dragging');
    try {
      tabs.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointers do not always implement capture.
    }
  }

  /** Which border of the chat wrap the pointer is on, or null for its body.
   *  Reads the CACHED box (filled by apply()/ensureGeometry, nulled on
   *  viewport resize) rather than measuring per pointermove: the hover hit
   *  test runs on every mouse move over the unlocked chat box, and a layout
   *  read there flushes pending layout each time. */
  private edgeAt(event: PointerEvent, wrap: HTMLElement, tabs: HTMLElement): FrameEdge | null {
    if (this.deps.isMobileLayout()) return null;
    if (!this.wrapRect && !this.chatBox) this.ensureGeometry(wrap, tabs);
    if (!this.wrapRect) return null;
    return frameEdgeAtPoint(this.wrapRect, event.clientX, event.clientY);
  }

  private onEdgeStart(
    event: PointerEvent,
    wrap: HTMLElement,
    tabs: HTMLElement,
    edge: FrameEdge,
  ): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.ensureGeometry(wrap, tabs);
    if (!this.chatBox) return;
    this.chatBoxGesture = {
      kind: 'edge',
      pointerId: event.pointerId,
      edge,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: this.chatBox.left,
      startTop: this.chatBox.top,
      startW: this.chatBox.width,
      startH: this.chatBox.height,
    };
    this.deps.document.body.classList.add('chat-box-dragging');
    try {
      wrap.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointers do not always implement capture.
    }
  }

  private onResizeStart(event: PointerEvent, wrap: HTMLElement, frame: HTMLElement): void {
    if (event.button !== 0 || this.deps.isMobileLayout()) return;
    event.preventDefault();
    event.stopPropagation();
    const tabs = this.deps.document.getElementById('chatlog-tabs');
    if (tabs) this.ensureGeometry(wrap, tabs);
    if (!this.chatBox) return;
    this.chatBoxGesture = {
      kind: 'resize',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startW: this.chatBox.width,
      startH: this.chatBox.height,
    };
    this.deps.document.body.classList.add('chat-box-dragging');
    try {
      frame.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointers do not always implement capture.
    }
  }

  private onPointerMove(event: PointerEvent): void {
    const gesture = this.chatBoxGesture;
    if (!gesture || gesture.pointerId !== event.pointerId || !this.chatBox) return;
    event.preventDefault();
    if (gesture.kind === 'move') {
      // Snap to Grid (when on) aligns the dragged box with every other
      // frame's grid, mirroring MovableFrame (resizes snap too, below).
      const snap = this.deps.snapToGrid?.() ?? false;
      const left = event.clientX - gesture.grabX;
      const top = event.clientY - gesture.grabY;
      this.chatBox = {
        ...this.chatBox,
        left: snap ? snapFrameCoord(left) : left,
        top: snap ? snapFrameCoord(top) : top,
      };
    } else if (gesture.kind === 'edge') {
      // Recomputed from the gesture-start snapshot each event, so a west/north
      // drag keeps the opposite border anchored for the whole gesture. With
      // Snap to Grid on the resized axis quantizes to the same pitch a move
      // drag lands on, mirroring MovableFrame.
      const snap = this.deps.snapToGrid?.() ?? false;
      const quant = (v: number) => Math.max(MIN_FRAME_BOX, snap ? snapFrameSize(v) : v);
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      const width = gesture.edge.includes('w')
        ? quant(gesture.startW - dx)
        : gesture.edge.includes('e')
          ? quant(gesture.startW + dx)
          : gesture.startW;
      const height = gesture.edge.includes('n')
        ? quant(gesture.startH - dy)
        : gesture.edge.includes('s')
          ? quant(gesture.startH + dy)
          : gesture.startH;
      this.chatBox = {
        left: gesture.edge.includes('w')
          ? gesture.startLeft + (gesture.startW - width)
          : gesture.startLeft,
        top: gesture.edge.includes('n')
          ? gesture.startTop + (gesture.startH - height)
          : gesture.startTop,
        width,
        height,
      };
    } else {
      const snap = this.deps.snapToGrid?.() ?? false;
      const quant = (v: number) => (snap ? snapFrameSize(v) : v);
      this.chatBox = {
        ...this.chatBox,
        width: quant(gesture.startW + (event.clientX - gesture.startX)),
        height: quant(gesture.startH + (event.clientY - gesture.startY)),
      };
    }
    this.apply();
  }

  private onPointerEnd(event: PointerEvent): void {
    const gesture = this.chatBoxGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    this.chatBoxGesture = null;
    this.deps.document.body.classList.remove('chat-box-dragging');
    this.persist();
  }

  /** The move button's keyboard half, mirroring MovableFrame.onKeyMove:
   *  arrow keys step the box, Shift the one-pixel fine step, and the result
   *  persists like a completed drag. */
  private onKeyMove(event: KeyboardEvent, wrap: HTMLElement, tabs: HTMLElement): void {
    if (this.deps.isMobileLayout()) return;
    const directions: Partial<Record<string, { left: number; top: number }>> = {
      ArrowLeft: { left: -1, top: 0 },
      ArrowRight: { left: 1, top: 0 },
      ArrowUp: { left: 0, top: -1 },
      ArrowDown: { left: 0, top: 1 },
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    this.ensureGeometry(wrap, tabs);
    if (!this.chatBox) return;
    // With Snap to Grid on the coarse step walks grid LINES (mirroring
    // MovableFrame's keyboard); Shift stays the 1px fine step.
    const snap = !event.shiftKey && (this.deps.snapToGrid?.() ?? false);
    const step = event.shiftKey ? CHAT_KEY_STEP_FINE : CHAT_KEY_STEP;
    this.chatBox = {
      ...this.chatBox,
      left:
        snap && direction.left !== 0
          ? stepCoordToGridLine(this.chatBox.left, direction.left as 1 | -1)
          : this.chatBox.left + direction.left * step,
      top:
        snap && direction.top !== 0
          ? stepCoordToGridLine(this.chatBox.top, direction.top as 1 | -1)
          : this.chatBox.top + direction.top * step,
    };
    this.apply();
    this.persist();
  }

  /** The grip's keyboard half, mirroring MovableFrame's dimensions-mode
   *  keyboard: Left/Right shrink/grow the width, Up/Down shrink/grow the
   *  height (growth matching the SE grip's travel), Shift the fine step.
   *  apply() clamps through the same placement path a pointer resize takes. */
  private onKeyResize(event: KeyboardEvent, wrap: HTMLElement, tabs: HTMLElement): void {
    if (this.deps.isMobileLayout()) return;
    const steps: Partial<Record<string, { axis: 'width' | 'height'; dir: 1 | -1 }>> = {
      ArrowLeft: { axis: 'width', dir: -1 },
      ArrowRight: { axis: 'width', dir: 1 },
      ArrowUp: { axis: 'height', dir: -1 },
      ArrowDown: { axis: 'height', dir: 1 },
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    this.ensureGeometry(wrap, tabs);
    if (!this.chatBox) return;
    const snap = !event.shiftKey && (this.deps.snapToGrid?.() ?? false);
    const size = event.shiftKey ? CHAT_KEY_STEP_FINE : CHAT_KEY_STEP;
    const next = snap
      ? stepCoordToGridLine(this.chatBox[step.axis], step.dir)
      : this.chatBox[step.axis] + step.dir * size;
    this.chatBox = {
      ...this.chatBox,
      [step.axis]: Math.max(MIN_FRAME_BOX, next),
    };
    this.apply();
    this.persist();
  }

  /** Rewrites the localized chrome this controller minted at init (the tab
   *  strip's move label, the grip, the arrange-mode name chip, the mobile
   *  handle): all are written once, so a runtime language switch would
   *  otherwise strand them in the old locale. Called from Hud's language
   *  fan-out; every write is unconditional and idempotent. */
  relocalize(): void {
    const { tabs, grip, moveBtn, frameLabel, resizeHandle } = this.localized;
    tabs?.setAttribute('aria-label', t('hudChrome.chatWindow.move'));
    if (grip) {
      grip.title = t('hudChrome.chatWindow.resize');
      grip.setAttribute('aria-label', t('hudChrome.chatWindow.resize'));
    }
    moveBtn?.setAttribute('aria-label', t('hudChrome.chatWindow.move'));
    if (frameLabel) frameLabel.textContent = t('hudChrome.interfaceUnlock.frameNames.chat');
    if (resizeHandle) resizeHandle.title = t('hudChrome.chatWindow.resize');
  }

  private clampMobileBottom(value: number): number {
    const maximum = Math.max(12, this.deps.window.innerHeight - 320);
    return Math.min(maximum, Math.max(12, value));
  }

  private onMobileResizeStart(event: PointerEvent, handle: HTMLElement): void {
    if (!this.deps.isMobileLayout()) return;
    event.preventDefault();
    event.stopPropagation();
    const raw = this.deps.document.documentElement.style.getPropertyValue('--mobile-chat-bottom');
    const startBottom = this.clampMobileBottom(raw ? Number.parseInt(raw, 10) || 52 : 52);
    this.mobileChatResize = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startBottom,
    };
    this.deps.document.body.classList.add('chat-box-dragging');
    try {
      handle.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointers do not always implement capture.
    }
  }

  private onMobileResizeMove(event: PointerEvent): void {
    const gesture = this.mobileChatResize;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    const bottom = this.clampMobileBottom(gesture.startBottom - (event.clientY - gesture.startY));
    this.deps.document.documentElement.style.setProperty(
      '--mobile-chat-bottom',
      `${Math.round(bottom)}px`,
    );
  }

  private onMobileResizeEnd(event: PointerEvent): void {
    const gesture = this.mobileChatResize;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    this.mobileChatResize = null;
    this.deps.document.body.classList.remove('chat-box-dragging');
    const bottom =
      this.deps.document.documentElement.style.getPropertyValue('--mobile-chat-bottom');
    try {
      if (bottom) this.deps.storage.setItem(MOBILE_CHAT_BOTTOM_KEY, bottom.trim());
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }

  private apply(): void {
    if (!this.chatBox || this.deps.isMobileLayout()) return;
    const wrap = this.deps.document.getElementById('chatlog-wrap');
    const tabs = this.deps.document.getElementById('chatlog-tabs');
    const frame = this.deps.document.getElementById('chatlog-frame');
    if (!wrap || !tabs || !frame) return;
    const chromeHeight = tabs.getBoundingClientRect().height || 22;
    const scale = this.deps.uiScale();
    const viewport = { w: this.deps.window.innerWidth, h: this.deps.window.innerHeight };
    // A box saved under a different viewport re-anchors per axis first, so a
    // bottom-parked chat rides the bottom edge across a fullscreen exit; the
    // applied geometry is stamped with the CURRENT viewport for the next save.
    const placement = placeChatBox(
      anchorAdjustedChatBox(this.chatBox, chromeHeight, viewport),
      viewport,
      chromeHeight,
      scale,
      CHAT_BOX_LIMITS,
      this.deps.hasStorePromoCard() ? (width) => storePromoReservedHeight(width, scale) : 0,
    );
    this.chatBox = { ...placement.geo, vw: viewport.w, vh: viewport.h };
    const { css, geo } = placement;
    // The applied placement IS the wrap's box (left/top on the wrap, the tab
    // chrome above the frame), so the border hit-test cache derives from it
    // with no layout read. It caches the VISUAL half (placement.geo, the
    // space pointer clientX/Y and getBoundingClientRect report), never the
    // author-space css the #ui zoom re-multiplies: at any UI Scale other
    // than 1 those spaces diverge and the edge bands would land wrong
    // (review round three, blocker 1).
    this.wrapRect = {
      left: geo.left,
      top: geo.top,
      width: geo.width,
      height: geo.height + chromeHeight,
    };
    wrap.style.left = `${css.left}px`;
    wrap.style.top = `${css.top}px`;
    wrap.style.right = 'auto';
    wrap.style.bottom = 'auto';
    wrap.style.width = `${css.width}px`;
    frame.style.height = `${css.height}px`;

    const input = this.deps.document.getElementById('chat-input');
    if (input) {
      const { geo } = placement;
      input.style.left = `${geo.left}px`;
      input.style.width = `${geo.width}px`;
      input.style.bottom = `${Math.max(0, this.deps.window.innerHeight - geo.top + 4)}px`;
    }
  }

  private persist(): void {
    if (!this.chatBox) return;
    try {
      this.deps.storage.setItem(CHAT_GEOMETRY_KEY, serializeChatBox(this.chatBox));
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }
}
