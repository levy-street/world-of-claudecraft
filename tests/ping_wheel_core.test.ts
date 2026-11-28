// The ping wheel's pure core (src/ui/hud/pings/ping_wheel_core.ts): the four
// wedges and where they sit, which wedge a pointer offset lights, the Ping
// key's tap-versus-hold rule, what a tap pings, and what a release sends.

import { describe, expect, it } from 'vitest';
import {
  PING_ASSIST,
  PING_ATTACK,
  PING_LOOK,
  PING_ON_MY_WAY,
  PING_WARNING,
} from '../src/sim/social/party_pings';
import {
  clampPingWheelCenter,
  PING_TAP_MAX_MS,
  PING_WHEEL_CENTER_PX,
  PING_WHEEL_RADIUS_PX,
  PING_WHEEL_WEDGES,
  type PingContext,
  pingSendFor,
  pingWedgeIconAt,
  pingWedgePath,
  pingWheelDue,
  pingWheelWedgeAt,
  releasePingPress,
  startPingPress,
  tapPingKind,
} from '../src/ui/hud/pings/ping_wheel_core';

const enemy: PingContext = { kind: 'unit', id: 9, hostile: true, x: 1, y: 2, z: 3 };
const friend: PingContext = { kind: 'unit', id: 4, hostile: false, x: 5, y: 6, z: 7 };
const ground: PingContext = { kind: 'ground', x: 10, y: 0, z: -4 };
const none: PingContext = { kind: 'none' };

describe('ping wheel: the wedges', () => {
  it('Warning on top, Attack left, On My Way right, Assist at the bottom', () => {
    const at = Object.fromEntries(PING_WHEEL_WEDGES.map((w) => [w.kind, w.angle]));
    expect(at[PING_WARNING]).toBe(-90);
    expect(at[PING_ATTACK]).toBe(180);
    expect(at[PING_ON_MY_WAY]).toBe(0);
    expect(at[PING_ASSIST]).toBe(90);
    expect(PING_WHEEL_WEDGES).toHaveLength(4);
  });

  it('a pointer lights the wedge it points at', () => {
    const r = PING_WHEEL_CENTER_PX + 40;
    expect(pingWheelWedgeAt(0, -r)).toBe(PING_WARNING);
    expect(pingWheelWedgeAt(-r, 0)).toBe(PING_ATTACK);
    expect(pingWheelWedgeAt(r, 0)).toBe(PING_ON_MY_WAY);
    expect(pingWheelWedgeAt(0, r)).toBe(PING_ASSIST);
    // Off-axis: the nearest wedge wins on either side of a diagonal.
    expect(pingWheelWedgeAt(r, -r * 0.9)).toBe(PING_ON_MY_WAY);
    expect(pingWheelWedgeAt(r * 0.9, -r)).toBe(PING_WARNING);
    expect(pingWheelWedgeAt(-r * 0.9, r)).toBe(PING_ASSIST);
    // Far past the rim still lights its wedge (a flick is fine).
    expect(pingWheelWedgeAt(-900, 10)).toBe(PING_ATTACK);
  });

  it('the cancel centre lights nothing', () => {
    expect(pingWheelWedgeAt(0, 0)).toBeNull();
    expect(pingWheelWedgeAt(PING_WHEEL_CENTER_PX - 1, 0)).toBeNull();
    expect(pingWheelWedgeAt(PING_WHEEL_CENTER_PX + 1, 0)).toBe(PING_ON_MY_WAY);
    expect(pingWheelWedgeAt(Number.NaN, 5)).toBeNull();
  });

  it('a wedge path is a closed annular sector; an icon sits on its axis', () => {
    const d = pingWedgePath(0, 40, 120);
    expect(d.startsWith('M ')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.match(/A /g)).toHaveLength(2);
    const top = pingWedgeIconAt(-90, 80);
    expect(top.x).toBeCloseTo(0, 6);
    expect(top.y).toBeCloseTo(-80, 6);
  });

  it('keeps the wheel on screen', () => {
    const r = PING_WHEEL_RADIUS_PX;
    expect(clampPingWheelCenter(5, 5, 1920, 1080)).toEqual({ x: r, y: r });
    expect(clampPingWheelCenter(1919, 1079, 1920, 1080)).toEqual({ x: 1920 - r, y: 1080 - r });
    expect(clampPingWheelCenter(900, 500, 1920, 1080)).toEqual({ x: 900, y: 500 });
    expect(clampPingWheelCenter(10, 10, 100, 100)).toEqual({ x: 50, y: 50 });
  });
});

describe('ping key: tap or hold', () => {
  it('a tap pings Attack on an enemy, Assist on a friend, Look Here on the ground', () => {
    expect(tapPingKind(enemy)).toBe(PING_ATTACK);
    expect(tapPingKind(friend)).toBe(PING_ASSIST);
    expect(tapPingKind(ground)).toBe(PING_LOOK);
    expect(tapPingKind(none)).toBeNull();
  });

  it('a release under the threshold is a tap; at the threshold the wheel is due', () => {
    const press = startPingPress(1000, enemy);
    expect(pingWheelDue(press, 1000 + PING_TAP_MAX_MS - 1)).toBe(false);
    expect(pingWheelDue(press, 1000 + PING_TAP_MAX_MS)).toBe(true);
    expect(releasePingPress(press, 1000 + PING_TAP_MAX_MS - 1)).toEqual({
      kind: PING_ATTACK,
      target: 9,
      x: 1,
      y: 2,
      z: 3,
    });
  });

  it('a tap on the ground sends the point, never a unit', () => {
    expect(releasePingPress(startPingPress(0, ground), 50)).toEqual({
      kind: PING_LOOK,
      target: null,
      x: 10,
      y: 0,
      z: -4,
    });
    expect(releasePingPress(startPingPress(0, none), 50)).toBeNull();
  });

  it('with the wheel open, the release sends the lit wedge at the press target', () => {
    const press = startPingPress(0, friend);
    press.wheel = true;
    press.wedge = PING_WARNING;
    expect(releasePingPress(press, 900)).toEqual({
      kind: PING_WARNING,
      target: 4,
      x: 5,
      y: 6,
      z: 7,
    });
  });

  it('a release over the centre cancels; a held press never taps', () => {
    const open = startPingPress(0, enemy);
    open.wheel = true;
    expect(releasePingPress(open, 900)).toBeNull();
    // Held past the threshold but the wheel never opened (no DOM): still no tap.
    expect(releasePingPress(startPingPress(0, enemy), PING_TAP_MAX_MS + 5)).toBeNull();
  });

  it('a wheel ping at the ground carries the point', () => {
    expect(pingSendFor(PING_ON_MY_WAY, ground)).toEqual({
      kind: PING_ON_MY_WAY,
      target: null,
      x: 10,
      y: 0,
      z: -4,
    });
    expect(pingSendFor(PING_ON_MY_WAY, none)).toBeNull();
  });
});
