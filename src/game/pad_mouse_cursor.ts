// The opt-in virtual mouse: a real pointer the right stick drives, for the times
// a pad player wants to poke at something the focus order cannot reach (dragging
// an item between bags, a spot on the map). FFXIV ships exactly this alongside its
// focus navigation, toggled with LB + right-stick-click, and it is opt-in there
// for the same reason it is here: steering a cursor to a button is slower than
// stepping onto it, so it is the escape hatch rather than the default.
//
// Distinct from dpad_focus_nav, which is the everyday path. This module owns only
// the pointer element, its position, and synthesising clicks under it.

const CURSOR_ID = 'pad-mouse-cursor';
/** Pixels per second at full stick deflection. */
export const PAD_MOUSE_SPEED = 900;

let cursorEl: HTMLElement | null = null;
let x = 0;
let y = 0;
let placed = false;
// What the pointer is currently over, so entering and leaving can be announced.
let hovered: Element | null = null;

// Marks the element under the virtual pointer. CSS :hover is driven by the REAL
// pointer and cannot be triggered synthetically at all, so any rule that should
// also light up under the pad has to opt in through this class. Synthetic events
// below cover the JS half (tooltips, popovers, anything on mouseenter); this
// covers the CSS half.
const HOVER_CLASS = 'pad-hover';

function ensureCursor(): HTMLElement | null {
  if (cursorEl) return cursorEl;
  if (typeof document === 'undefined') return null;
  const el = document.createElement('div');
  el.id = CURSOR_ID;
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  cursorEl = el;
  return el;
}

function elementUnderPointer(): Element | null {
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
    return null;
  }
  // The pointer must not be what it finds under itself.
  const shown = cursorEl?.style.display;
  if (cursorEl) cursorEl.style.display = 'none';
  const found = document.elementFromPoint(x, y);
  if (cursorEl && shown !== undefined) cursorEl.style.display = shown;
  return found;
}

function mouseInit(extra: Record<string, unknown> = {}): MouseEventInit {
  return { bubbles: true, cancelable: true, clientX: x, clientY: y, ...extra };
}

/**
 * Tell the page the pointer moved. Without this the virtual mouse could only
 * CLICK: hover highlights, tooltips and popovers all hang off move and enter
 * events, so the pad could press things it could never see the state of.
 *
 * enter/leave are dispatched non-bubbling on the element itself (that is their
 * contract) while over/out bubble, so both direct and delegated handlers fire.
 */
// The chain a real pointer considers "entered": the element and every ancestor.
// enter/leave do not bubble, so this is how a listener on a container (which is
// where tooltips actually live, not on the icon inside the button) ever hears.
function hoverChain(el: Element | null): Element[] {
  const chain: Element[] = [];
  for (let node = el; node; node = node.parentElement) chain.push(node);
  return chain;
}

function announceHover(): void {
  const next = elementUnderPointer();
  if (next === hovered) {
    next?.dispatchEvent(new MouseEvent('mousemove', mouseInit()));
    return;
  }
  const from = hoverChain(hovered);
  const to = hoverChain(next);
  if (hovered) {
    hovered.classList?.remove(HOVER_CLASS);
    hovered.dispatchEvent(new MouseEvent('mouseout', mouseInit({ relatedTarget: next })));
  }
  // Left innermost-first, entered outermost-first, exactly as a real pointer does.
  for (const node of from) {
    if (to.includes(node)) continue;
    node.dispatchEvent(
      new MouseEvent('mouseleave', mouseInit({ bubbles: false, relatedTarget: next })),
    );
  }
  hovered = next;
  if (next) {
    next.classList?.add(HOVER_CLASS);
    next.dispatchEvent(new MouseEvent('mouseover', mouseInit({ relatedTarget: null })));
  }
  for (let i = to.length - 1; i >= 0; i--) {
    if (from.includes(to[i])) continue;
    to[i].dispatchEvent(new MouseEvent('mouseenter', mouseInit({ bubbles: false })));
  }
  // After the enters, so a handler armed by mouseenter sees this move.
  next?.dispatchEvent(new MouseEvent('mousemove', mouseInit()));
}

/** What the virtual pointer is currently over, for a caller that needs to act on
 *  it rather than click it (arranging picks an ability up off a hovered row). */
export function padMouseHovered(): Element | null {
  return hovered;
}

/** Screen position of the virtual pointer, for a caller that needs to aim. */
export function padMousePosition(): { x: number; y: number } {
  return { x, y };
}

/**
 * Move the pointer by one frame of stick deflection and draw it. `dx`/`dy` are
 * the post-deadzone stick vector; `dt` keeps the speed resolution-independent.
 * Answers whether the player actually moved it.
 */
export function updatePadMouse(dx: number, dy: number, dt: number): boolean {
  const el = ensureCursor();
  if (!el) return false;
  if (!placed) {
    // Open in the middle rather than at 0,0, so the first nudge is visible.
    x = window.innerWidth / 2;
    y = window.innerHeight / 2;
    placed = true;
  }
  el.style.display = 'block';
  if (dx === 0 && dy === 0) return false;
  x = Math.min(window.innerWidth, Math.max(0, x + dx * PAD_MOUSE_SPEED * dt));
  y = Math.min(window.innerHeight, Math.max(0, y + dy * PAD_MOUSE_SPEED * dt));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  announceHover();
  return true;
}

/** Put the pointer away when mouse mode ends, and leave whatever it was over so
 *  no tooltip or highlight is stranded open behind it. */
export function hidePadMouse(): void {
  if (cursorEl) cursorEl.style.display = 'none';
  if (hovered) {
    hovered.classList?.remove(HOVER_CLASS);
    hovered.dispatchEvent(new MouseEvent('mouseout', mouseInit({ relatedTarget: null })));
    hovered.dispatchEvent(new MouseEvent('mouseleave', mouseInit({ bubbles: false })));
    hovered = null;
  }
}

/**
 * Synthesise a click under the pointer, reusing every DOM handler already wired
 * for a real mouse (use, equip, sell, trade). `button` is the DOM convention:
 * 0 left, 2 right.
 */
export function clickPadMouse(button: 0 | 2): void {
  // elementFromPoint is browser-only and absent from partial DOMs (headless env
  // server, unit stubs), where there is nothing under the pointer anyway.
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return;
  const target = elementUnderPointer() as HTMLElement | null;
  if (!target) return;
  const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, button };
  target.dispatchEvent(new MouseEvent('mousedown', init));
  target.dispatchEvent(new MouseEvent('mouseup', init));
  if (button === 0) target.click();
  else target.dispatchEvent(new MouseEvent('contextmenu', init));
}
