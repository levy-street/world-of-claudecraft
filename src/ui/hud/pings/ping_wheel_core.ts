// The ping wheel and the Ping key, the pure half (the DOM half is
// ping_wheel_controller.ts): the four wedges and where they sit, which wedge a
// pointer offset lights, the tap-versus-hold rule of the key, what a tap
// pings (Attack on an enemy, Assist on a friend, Look Here on the ground) and
// what a release sends. DOM-free and deterministic; the clock is the
// caller's.

import {
  PARTY_PING_RANGE,
  PARTY_PING_VERTICAL_REACH,
  PING_ASSIST,
  PING_ATTACK,
  PING_LOOK,
  PING_ON_MY_WAY,
  PING_WARNING,
} from '../../../sim/social/party_pings';
import type { TranslationKey } from '../../i18n';

/** One wedge of the wheel: its ping kind and its centre angle in screen
 *  degrees (0 = right, 90 = down, 180 = left, -90 = up). */
export interface PingWedge {
  kind: number;
  angle: number;
}

/** Warning on top, Attack left, On My Way right, Assist at the bottom. */
export const PING_WHEEL_WEDGES: readonly PingWedge[] = Object.freeze([
  { kind: PING_WARNING, angle: -90 },
  { kind: PING_ATTACK, angle: 180 },
  { kind: PING_ON_MY_WAY, angle: 0 },
  { kind: PING_ASSIST, angle: 90 },
]);

/** The wheel's outer radius and the cancel centre's radius (CSS pixels). */
export const PING_WHEEL_RADIUS_PX = 132;
export const PING_WHEEL_CENTER_PX = 38;
/** A press released before this is a tap (a contextual ping at the cursor);
 *  held this long, the wheel opens. */
export const PING_TAP_MAX_MS = 200;

/** Each kind's display name. */
export const PING_KIND_LABEL_KEYS: Readonly<Record<number, TranslationKey>> = Object.freeze({
  [PING_LOOK]: 'hudChrome.pings.kindLook',
  [PING_ATTACK]: 'hudChrome.pings.kindAttack',
  [PING_WARNING]: 'hudChrome.pings.kindWarning',
  [PING_ON_MY_WAY]: 'hudChrome.pings.kindOnMyWay',
  [PING_ASSIST]: 'hudChrome.pings.kindAssist',
});

/** The wedge a pointer at (dx, dy) from the wheel's centre lights, or null
 *  inside the cancel centre. The four wedges split the circle on its
 *  diagonals, so a pointer always lights the wedge it is nearest to. */
export function pingWheelWedgeAt(
  dx: number,
  dy: number,
  center = PING_WHEEL_CENTER_PX,
): number | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.hypot(dx, dy) < center) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? PING_ON_MY_WAY : PING_ATTACK;
  return dy > 0 ? PING_ASSIST : PING_WARNING;
}

/** What sits under the cursor when the key went down. */
export type PingContext =
  | { kind: 'unit'; id: number; hostile: boolean; x: number; y: number; z: number }
  | { kind: 'ground'; x: number; y: number; z: number }
  | { kind: 'none' };

/** How far along the cursor ray a ground ping looks for the floor (yards):
 *  the ping range plus room for the camera boom behind the player. */
export const PING_GROUND_RAY_REACH = PARTY_PING_RANGE * 2;

/** The ground context of a cursor ray's floor hit (null: the ray met nothing,
 *  a sky pick). A hit the sim would refuse (past the ping range from the
 *  player, or too far above or below them) is no ping at all, never a
 *  stand-in spot: the mark only ever lands where the cursor points. */
export function groundPingContext(
  hit: { x: number; y: number; z: number } | null,
  player: { x: number; y: number; z: number },
): PingContext {
  if (!hit) return { kind: 'none' };
  if (Math.hypot(hit.x - player.x, hit.z - player.z) > PARTY_PING_RANGE) return { kind: 'none' };
  if (Math.abs(hit.y - player.y) > PARTY_PING_VERTICAL_REACH) return { kind: 'none' };
  return { kind: 'ground', x: hit.x, y: hit.y, z: hit.z };
}

/** What a tap pings: Attack on an enemy, Assist on a friend, Look Here on
 *  the ground; nothing when the cursor was over nothing. */
export function tapPingKind(ctx: PingContext): number | null {
  if (ctx.kind === 'unit') return ctx.hostile ? PING_ATTACK : PING_ASSIST;
  if (ctx.kind === 'ground') return PING_LOOK;
  return null;
}

/** One ping to send: the kind and where (a unit id, or the ground point). */
export interface PingSend {
  kind: number;
  target: number | null;
  x: number;
  y: number;
  z: number;
}

/** The send a ping of `kind` at `ctx` makes (null with nothing under the cursor). */
export function pingSendFor(kind: number, ctx: PingContext): PingSend | null {
  if (ctx.kind === 'none') return null;
  return {
    kind,
    target: ctx.kind === 'unit' ? ctx.id : null,
    x: ctx.x,
    y: ctx.y,
    z: ctx.z,
  };
}

/** The Ping key's press, from down to release. */
export interface PingPress {
  /** When the key went down (the caller's clock, ms). */
  downAt: number;
  /** What was under the cursor then. */
  ctx: PingContext;
  /** The wheel is open (the press outlived PING_TAP_MAX_MS). */
  wheel: boolean;
  /** The wedge the pointer lights (null: the cancel centre). */
  wedge: number | null;
}

export function startPingPress(now: number, ctx: PingContext): PingPress {
  return { downAt: now, ctx, wheel: false, wedge: null };
}

/** Whether a still-held press should open the wheel now. */
export function pingWheelDue(press: PingPress, now: number): boolean {
  return !press.wheel && now - press.downAt >= PING_TAP_MAX_MS;
}

/** What the key's release does: a quick tap pings contextually; a release
 *  with the wheel open sends the lit wedge, or nothing over the centre. */
export function releasePingPress(press: PingPress, now: number): PingSend | null {
  if (!press.wheel && now - press.downAt < PING_TAP_MAX_MS) {
    const kind = tapPingKind(press.ctx);
    return kind === null ? null : pingSendFor(kind, press.ctx);
  }
  if (press.wedge === null) return null;
  return pingSendFor(press.wedge, press.ctx);
}

/** The SVG path of one wedge: an annular sector `span` degrees wide around
 *  `angle`, between radii `r0` and `r1`, with a small gap between wedges. */
export function pingWedgePath(
  angle: number,
  r0: number,
  r1: number,
  span = 90,
  gapDeg = 3,
): string {
  const half = (span - gapDeg) / 2;
  const rad = (d: number) => (d * Math.PI) / 180;
  const pt = (r: number, d: number) =>
    `${(r * Math.cos(rad(d))).toFixed(2)} ${(r * Math.sin(rad(d))).toFixed(2)}`;
  const a0 = angle - half;
  const a1 = angle + half;
  return [
    `M ${pt(r1, a0)}`,
    `A ${r1} ${r1} 0 0 1 ${pt(r1, a1)}`,
    `L ${pt(r0, a1)}`,
    `A ${r0} ${r0} 0 0 0 ${pt(r0, a0)}`,
    'Z',
  ].join(' ');
}

/** Where a wedge's icon sits (CSS px from the centre), at radius `r`. */
export function pingWedgeIconAt(angle: number, r: number): { x: number; y: number } {
  const a = (angle * Math.PI) / 180;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

/** Keep the wheel fully on screen: the centre clamped `radius` from each edge. */
export function clampPingWheelCenter(
  x: number,
  y: number,
  width: number,
  height: number,
  radius = PING_WHEEL_RADIUS_PX,
): { x: number; y: number } {
  const cx = width <= radius * 2 ? width / 2 : Math.min(width - radius, Math.max(radius, x));
  const cy = height <= radius * 2 ? height / 2 : Math.min(height - radius, Math.max(radius, y));
  return { x: cx, y: cy };
}
