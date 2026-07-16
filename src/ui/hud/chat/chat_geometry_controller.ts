import { t } from '../../i18n';
import { storePromoReservedHeight } from '../../store_promo_card';
import {
  CHAT_BOX_LIMITS,
  type ChatBoxGeometry,
  parseChatBox,
  placeChatBox,
  serializeChatBox,
} from './chat_window';

const CHAT_GEOMETRY_KEY = 'woc_chat_geometry';
const MOBILE_CHAT_BOTTOM_KEY = 'woc_mobile_chat_bottom';

export interface ChatGeometryControllerDeps {
  document: Document;
  window: Window;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  isMobileLayout(): boolean;
  hasStorePromoCard(): boolean;
  uiScale(): number;
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
    };

export class ChatGeometryController {
  private chatBox: ChatBoxGeometry | null = null;
  private chatBoxGesture: ChatBoxGesture | null = null;
  private mobileChatResize: {
    pointerId: number;
    startY: number;
    startBottom: number;
  } | null = null;

  constructor(private readonly deps: ChatGeometryControllerDeps) {}

  init(): void {
    const wrap = this.deps.document.getElementById('chatlog-wrap');
    const tabs = this.deps.document.getElementById('chatlog-tabs');
    const frame = this.deps.document.getElementById('chatlog-frame');
    if (!wrap || !tabs || !frame) return;

    const grip = this.deps.document.createElement('div');
    grip.className = 'chat-resize-grip';
    grip.title = t('hudChrome.chatWindow.resize');
    grip.setAttribute('aria-hidden', 'true');
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
    grip.addEventListener('pointerdown', (event) => this.onResizeStart(event, wrap, frame));
    this.deps.document.addEventListener('pointermove', (event) => this.onPointerMove(event));
    const end = (event: PointerEvent): void => this.onPointerEnd(event);
    this.deps.document.addEventListener('pointerup', end);
    this.deps.document.addEventListener('pointercancel', end);
    this.deps.window.addEventListener('resize', () => {
      if (this.chatBox) this.apply();
    });

    let saved: string | null = null;
    try {
      saved = this.deps.storage.getItem(CHAT_GEOMETRY_KEY);
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
    this.chatBox = parseChatBox(saved);
    if (this.chatBox) this.apply();
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
      this.chatBox = {
        ...this.chatBox,
        left: event.clientX - gesture.grabX,
        top: event.clientY - gesture.grabY,
      };
    } else {
      this.chatBox = {
        ...this.chatBox,
        width: gesture.startW + (event.clientX - gesture.startX),
        height: gesture.startH + (event.clientY - gesture.startY),
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
    const placement = placeChatBox(
      this.chatBox,
      { w: this.deps.window.innerWidth, h: this.deps.window.innerHeight },
      chromeHeight,
      scale,
      CHAT_BOX_LIMITS,
      this.deps.hasStorePromoCard() ? (width) => storePromoReservedHeight(width, scale) : 0,
    );
    this.chatBox = placement.geo;
    const { css } = placement;
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
