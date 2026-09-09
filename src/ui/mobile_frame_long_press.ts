// Long-press-to-context-menu binding for a mobile unit frame (target/player):
// extracted from Hud.bindMobileFrameLongPress so the coordinator holds only the
// thin per-frame wrapper. Takes the layout check as a callback rather than
// reading Hud state directly, so it stays a plain DOM helper with no Hud
// dependency. All timer/pointer-id/suppression-window state lives in this one
// closure per bound element, unchanged from the pre-extraction body.
import { CLICK_SUPPRESS_MS, TAP_SLOP_PX } from './touch_tap';

export const MOBILE_CONTEXT_LONG_PRESS_MS = 650;

interface LongPressTarget {
  addEventListener(
    type: string,
    listener: (e: PointerEvent & MouseEvent) => void,
    capture?: boolean,
  ): void;
}

export function bindMobileFrameLongPress(
  el: LongPressTarget,
  onLongPress: (x: number, y: number) => void,
  isMobileLayout: () => boolean,
  opts: { ignoreSelector?: string } = {},
): void {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let downId: number | null = null;
  let downX = 0;
  let downY = 0;
  let suppressUntil = 0;
  const clear = () => {
    if (timer !== undefined) globalThis.clearTimeout(timer);
    timer = undefined;
    downId = null;
  };
  el.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'touch' || !isMobileLayout()) return;
    const target = ev.target as HTMLElement | null;
    if (opts.ignoreSelector && target?.closest(opts.ignoreSelector)) return;
    clear();
    downId = ev.pointerId;
    downX = ev.clientX;
    downY = ev.clientY;
    timer = globalThis.setTimeout(() => {
      timer = undefined;
      suppressUntil = Date.now() + CLICK_SUPPRESS_MS;
      onLongPress(downX, downY);
    }, MOBILE_CONTEXT_LONG_PRESS_MS);
  });
  el.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'touch' || ev.pointerId !== downId) return;
    if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > TAP_SLOP_PX) clear();
  });
  el.addEventListener('pointerup', (ev) => {
    if (ev.pointerId === downId) clear();
  });
  el.addEventListener('pointercancel', (ev) => {
    if (ev.pointerId === downId) clear();
  });
  el.addEventListener(
    'click',
    (ev) => {
      if (Date.now() > suppressUntil) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    },
    true,
  );
  el.addEventListener(
    'contextmenu',
    (ev) => {
      if (!isMobileLayout() || Date.now() > suppressUntil) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    },
    true,
  );
}
