// The ping wheel and the Ping key, the DOM half (every decision is in
// ping_wheel_core.ts). The key's press reads what is under the cursor; a
// quick release pings it (Attack an enemy, Assist a friend, Look Here on the
// ground). Held past PING_TAP_MAX_MS, a radial wheel opens centred on the
// cursor: Warning on top, Attack left, On My Way right, Assist at the bottom
// and a cancel X in the middle. Moving the pointer lights the wedge it points
// at; releasing the key sends that ping at what was under the cursor when the
// press began. Releasing over the centre, Escape, or losing the press cancels.
//
// Event-driven, cold chrome: the wheel is built once on first open (static
// SVG plus icons and labels), shown and hidden by class, and a pointer move
// only toggles which wedge is lit. The one timer is the single-shot hold
// delay of a press; there is no repeating driver.

import { t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { pingIconUrl } from '../../ping_icons';
import {
  clampPingWheelCenter,
  PING_KIND_LABEL_KEYS,
  PING_TAP_MAX_MS,
  PING_WHEEL_CENTER_PX,
  PING_WHEEL_RADIUS_PX,
  PING_WHEEL_WEDGES,
  type PingContext,
  type PingPress,
  type PingSend,
  pingWedgeIconAt,
  pingWedgePath,
  pingWheelDue,
  pingWheelWedgeAt,
  releasePingPress,
  startPingPress,
} from './ping_wheel_core';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The wedge band's inner edge and the icons' radius (CSS px). */
const WEDGE_INNER_PX = PING_WHEEL_CENTER_PX + 6;
const ICON_RADIUS_PX = 88;
/** A rim stud's half size (CSS px). */
const STUD_PX = 6;
/** A lit wedge's glow stops: faint at the centre, strongest at the rim. */
const GLOW_STOPS: readonly (readonly [string, string])[] = [
  ['0.3', 'core'],
  ['0.78', 'mid'],
  ['1', 'edge'],
];

export interface PingWheelDeps {
  doc: Document;
  writers: PainterHostWriters;
  /** Where the wheel mounts (the HUD root). */
  mount: () => HTMLElement | null;
  /** The caller's clock (ms). */
  now: () => number;
  /** The viewport size, for keeping the wheel on screen. */
  viewport: () => { width: number; height: number };
  /** settings.partyPings: off, the key does nothing. */
  enabled: () => boolean;
  /** What is under the screen point (x, y) right now. */
  pick: (x: number, y: number) => PingContext;
  /** What the pad's flat press pings (the current target), if anything. */
  targetContext: () => PingContext;
  send: (ping: PingSend) => void;
  /** Schedule `fn` once after `ms` (the hold delay); returns its canceller. */
  later: (fn: () => void, ms: number) => () => void;
}

interface WheelParts {
  root: HTMLDivElement;
  wedges: Map<number, SVGPathElement>;
  slots: Map<number, HTMLDivElement>;
  center: SVGGElement;
}

export class PingWheelController {
  private press: PingPress | null = null;
  private parts: WheelParts | null = null;
  private centerX = 0;
  private centerY = 0;
  private cancelHold: (() => void) | null = null;
  private readonly onMove = (e: PointerEvent | MouseEvent) => this.point(e.clientX, e.clientY);
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !this.press) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.close();
  };

  constructor(private readonly deps: PingWheelDeps) {}

  /** The wheel is open (tests and the HUD read it). */
  isOpen(): boolean {
    return this.press?.wheel === true;
  }

  /** The Ping key: its press, its release, or a lost press. */
  key(phase: 'down' | 'up' | 'cancel', x: number, y: number): void {
    if (phase === 'down') {
      if (this.press || !this.deps.enabled()) return;
      this.press = startPingPress(this.deps.now(), this.deps.pick(x, y));
      this.centerX = x;
      this.centerY = y;
      this.cancelHold = this.deps.later(() => this.maybeOpen(), PING_TAP_MAX_MS);
      return;
    }
    const press = this.press;
    if (!press) return;
    const send = phase === 'up' ? releasePingPress(press, this.deps.now()) : null;
    this.close();
    if (send && this.deps.enabled()) this.deps.send(send);
  }

  /** The pad's flat press: a contextual ping at the current target. */
  padPing(): void {
    if (!this.deps.enabled()) return;
    const press = startPingPress(this.deps.now(), this.deps.targetContext());
    const send = releasePingPress(press, press.downAt);
    if (send) this.deps.send(send);
  }

  private maybeOpen(): void {
    this.cancelHold = null;
    const press = this.press;
    if (!press || !pingWheelDue(press, this.deps.now())) return;
    press.wheel = true;
    const parts = this.build();
    if (!parts) return;
    // Labels re-read per open, so a language switch never shows a stale wheel.
    this.relocalize();
    const view = this.deps.viewport();
    const c = clampPingWheelCenter(this.centerX, this.centerY, view.width, view.height);
    this.centerX = c.x;
    this.centerY = c.y;
    const w = this.deps.writers;
    w.setTransform(parts.root, `translate(${c.x}px, ${c.y}px)`);
    w.setDisplay(parts.root, 'block');
    w.toggleClass(parts.root, 'is-open', true);
    this.light(null);
    const win = this.deps.doc.defaultView;
    win?.addEventListener('pointermove', this.onMove);
    win?.addEventListener('mousemove', this.onMove);
    win?.addEventListener('keydown', this.onKey, true);
  }

  private point(x: number, y: number): void {
    const press = this.press;
    if (!press?.wheel) return;
    const wedge = pingWheelWedgeAt(x - this.centerX, y - this.centerY);
    if (wedge === press.wedge) return;
    press.wedge = wedge;
    this.light(wedge);
  }

  private light(wedge: number | null): void {
    const parts = this.parts;
    if (!parts) return;
    const w = this.deps.writers;
    for (const [kind, path] of parts.wedges)
      w.toggleClass(path as unknown as HTMLElement, 'is-lit', kind === wedge);
    for (const [kind, slot] of parts.slots) w.toggleClass(slot, 'is-lit', kind === wedge);
    w.toggleClass(parts.center as unknown as HTMLElement, 'is-lit', wedge === null);
    w.toggleClass(parts.root, 'is-center', wedge === null);
  }

  private close(): void {
    this.cancelHold?.();
    this.cancelHold = null;
    const wasOpen = this.press?.wheel === true;
    this.press = null;
    const win = this.deps.doc.defaultView;
    win?.removeEventListener('pointermove', this.onMove);
    win?.removeEventListener('mousemove', this.onMove);
    win?.removeEventListener('keydown', this.onKey, true);
    if (!wasOpen || !this.parts) return;
    this.deps.writers.toggleClass(this.parts.root, 'is-open', false);
    this.deps.writers.setDisplay(this.parts.root, 'none');
  }

  /** Build the wheel once: the backdrop, four wedges, the cancel centre, and
   *  each wedge's icon and label. */
  private build(): WheelParts | null {
    if (this.parts) return this.parts;
    const mount = this.deps.mount();
    if (!mount) return null;
    const doc = this.deps.doc;
    const root = doc.createElement('div');
    root.id = 'ping-wheel';
    root.className = 'ping-wheel';
    root.setAttribute('role', 'menu');
    root.setAttribute('aria-label', t('hudChrome.pings.wheelAria'));
    const r = PING_WHEEL_RADIUS_PX;
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ping-wheel-ring');
    svg.setAttribute('viewBox', `${-r - 8} ${-r - 8} ${2 * r + 16} ${2 * r + 16}`);
    svg.setAttribute('aria-hidden', 'true');
    // One radial glow per kind for its lit wedge: the stops read the kind's
    // --ping-color through the gradient's own ping-kind class (CSS).
    const defs = doc.createElementNS(SVG_NS, 'defs');
    for (const wedge of PING_WHEEL_WEDGES) {
      const glow = doc.createElementNS(SVG_NS, 'radialGradient');
      glow.setAttribute('id', `ping-wheel-glow-${wedge.kind}`);
      glow.setAttribute('class', `ping-kind-${wedge.kind}`);
      glow.setAttribute('gradientUnits', 'userSpaceOnUse');
      glow.setAttribute('cx', '0');
      glow.setAttribute('cy', '0');
      glow.setAttribute('r', String(r));
      for (const [offset, part] of GLOW_STOPS) {
        const stop = doc.createElementNS(SVG_NS, 'stop');
        stop.setAttribute('offset', offset);
        stop.setAttribute('class', `ping-wheel-glow-${part}`);
        glow.appendChild(stop);
      }
      defs.appendChild(glow);
    }
    svg.appendChild(defs);
    const backdrop = doc.createElementNS(SVG_NS, 'circle');
    backdrop.setAttribute('class', 'ping-wheel-backdrop');
    backdrop.setAttribute('r', String(r + 4));
    svg.appendChild(backdrop);
    const wedges = new Map<number, SVGPathElement>();
    const slots = new Map<number, HTMLDivElement>();
    for (const wedge of PING_WHEEL_WEDGES) {
      const path = doc.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', `ping-wheel-wedge ping-kind-${wedge.kind}`);
      path.setAttribute('d', pingWedgePath(wedge.angle, WEDGE_INNER_PX, r));
      svg.appendChild(path);
      wedges.set(wedge.kind, path);
      const slot = doc.createElement('div');
      slot.className = `ping-wheel-slot ping-kind-${wedge.kind}`;
      slot.setAttribute('role', 'menuitem');
      const at = pingWedgeIconAt(wedge.angle, ICON_RADIUS_PX);
      slot.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
      const img = doc.createElement('img');
      img.className = 'ping-wheel-icon';
      img.src = pingIconUrl(wedge.kind);
      img.alt = '';
      img.draggable = false;
      const label = doc.createElement('span');
      label.className = 'ping-wheel-label';
      label.textContent = t(PING_KIND_LABEL_KEYS[wedge.kind]);
      slot.append(img, label);
      slots.set(wedge.kind, slot);
    }
    // The rim: a dark keyline outside a fine gold edge, with a gold stud in
    // each gap between the wedges.
    for (const [cls, rr] of [
      ['ping-wheel-keyline', r + 6],
      ['ping-wheel-rim', r + 4],
    ] as const) {
      const ring = doc.createElementNS(SVG_NS, 'circle');
      ring.setAttribute('class', cls);
      ring.setAttribute('r', String(rr));
      svg.appendChild(ring);
    }
    for (const wedge of PING_WHEEL_WEDGES) {
      const at = pingWedgeIconAt(wedge.angle + 45, r + 4);
      const x = (dx: number) => (at.x + dx).toFixed(1);
      const y = (dy: number) => (at.y + dy).toFixed(1);
      const stud = doc.createElementNS(SVG_NS, 'path');
      stud.setAttribute('class', 'ping-wheel-stud');
      stud.setAttribute(
        'd',
        `M ${x(0)} ${y(-STUD_PX)} L ${x(STUD_PX)} ${y(0)} L ${x(0)} ${y(STUD_PX)} L ${x(-STUD_PX)} ${y(0)} Z`,
      );
      svg.appendChild(stud);
    }
    const center = doc.createElementNS(SVG_NS, 'g');
    center.setAttribute('class', 'ping-wheel-center');
    const disc = doc.createElementNS(SVG_NS, 'circle');
    disc.setAttribute('r', String(PING_WHEEL_CENTER_PX));
    const cross = doc.createElementNS(SVG_NS, 'path');
    cross.setAttribute('class', 'ping-wheel-x');
    cross.setAttribute('d', 'M -11 -11 L 11 11 M 11 -11 L -11 11');
    center.append(disc, cross);
    svg.appendChild(center);
    const cancel = doc.createElement('span');
    cancel.className = 'ping-wheel-cancel';
    cancel.textContent = t('hudChrome.pings.cancel');
    root.append(svg, ...slots.values(), cancel);
    root.style.display = 'none';
    mount.appendChild(root);
    this.parts = { root, wedges, slots, center };
    return this.parts;
  }

  /** Re-read the wheel's localized labels (a language change). */
  relocalize(): void {
    const parts = this.parts;
    if (!parts) return;
    parts.root.setAttribute('aria-label', t('hudChrome.pings.wheelAria'));
    for (const [kind, slot] of parts.slots) {
      const label = slot.querySelector('.ping-wheel-label');
      if (label) label.textContent = t(PING_KIND_LABEL_KEYS[kind]);
    }
    const cancel = parts.root.querySelector('.ping-wheel-cancel');
    if (cancel) cancel.textContent = t('hudChrome.pings.cancel');
  }
}
