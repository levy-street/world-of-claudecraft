// The pure cores behind Old Thatchgrin's phase-3 visuals: the rain of pumpkins
// (fallWindow, fallPoint, fallOrigin), the Swelling Gourd's growth and throb
// (swellScale, swellThrob, swellGlow). The broom rider's hands on the handle
// (ride_grip_ik.ts) are pinned in tests/ride_grip_ik.test.ts.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  AWAKEN_HEAD_SEC,
  AWAKEN_LAND_SEC,
  AWAKEN_TEAR_SEC,
  FALL_HEIGHT,
  FALL_SEC,
  FALL_SLANT,
  fallOrigin,
  fallPoint,
  fallWindow,
  GOURD_ABILITY,
  GOURDFALL_PURPLE,
  SWELL_RISE_SEC,
  swellGlow,
  swellScale,
  swellThrob,
  THATCHGRIN_POLE,
  thatchgrinPoleAt,
  thatchgrinRuneColor,
} from '../src/render/scarecrow_fx_core';

describe('the rain of pumpkins', () => {
  it('shows each pumpkin for its last FALL_SEC, never before its ring', () => {
    expect(fallWindow(10, 2)).toEqual({ start: 12 - FALL_SEC, end: 12 });
    // a landing sooner than the fall: it appears with the ring
    const quick = fallWindow(10, 0.3);
    expect(quick.start).toBe(10);
    expect(quick.end).toBeCloseTo(10.3, 6);
    // a degenerate landing still gets a visible sliver
    expect(fallWindow(10, 0).end).toBeCloseTo(10.05, 6);
  });

  it('drops along a straight slant that ends on the ring, accelerating', () => {
    const from = { x: 0, y: 26, z: 0 };
    const to = { x: 7, y: 0, z: 0 };
    expect(fallPoint(from, to, 0)).toEqual(from);
    expect(fallPoint(from, to, 1)).toEqual(to);
    // clamped outside 0..1
    expect(fallPoint(from, to, -1)).toEqual(from);
    expect(fallPoint(from, to, 2)).toEqual(to);
    // slower first half than second (accelerating)
    const half = fallPoint(from, to, 0.5);
    expect(half.x).toBeLessThan(3.5);
    expect(half.y).toBeGreaterThan(13);
  });

  it('starts every fall overhead, slanted, the same on every client', () => {
    const o = fallOrigin(12, 3, -40);
    expect(o.y).toBe(3 + FALL_HEIGHT);
    expect(Math.hypot(o.x - 12, o.z + 40)).toBeCloseTo(FALL_SLANT, 6);
    expect(fallOrigin(12, 3, -40)).toEqual(o);
    expect(fallOrigin(13, 3, -40)).not.toEqual(o);
  });
});

describe('his night colours and his pole (round 10)', () => {
  const hsl = (hex: number) => new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 });
  it('dyes the rain, its scorched ground and its rings a dark witch-fire purple', () => {
    for (const hex of [GOURDFALL_PURPLE.ink, GOURDFALL_PURPLE.rind, GOURDFALL_PURPLE.rim]) {
      const c = hsl(hex);
      // purple: between blue and magenta, never the old orange
      expect(c.h, hex.toString(16)).toBeGreaterThan(0.7);
      expect(c.h, hex.toString(16)).toBeLessThan(0.86);
    }
    // the underlay and the rind are DARK (they read by day); the rim glows
    expect(hsl(GOURDFALL_PURPLE.ink).l).toBeLessThan(0.2);
    expect(hsl(GOURDFALL_PURPLE.rind).l).toBeLessThan(0.25);
    expect(hsl(GOURDFALL_PURPLE.rim).l).toBeGreaterThan(0.5);
    expect(thatchgrinRuneColor(GOURD_ABILITY)).toBe(GOURDFALL_PURPLE.rim);
    expect(thatchgrinRuneColor('mob_thatchgrin_puppet')).toBeNull();
    expect(thatchgrinRuneColor(undefined)).toBeNull();
  });

  it('stands his pole behind his back, its bar across his shoulders', () => {
    // facing +z: the post is BEHIND him (-z), centred on his spine
    const at = thatchgrinPoleAt(10, 20, 0);
    expect(at.post.x).toBeCloseTo(10, 6);
    expect(at.post.z).toBeCloseTo(20 - THATCHGRIN_POLE.postBack, 6);
    expect(at.bar.z).toBeGreaterThan(at.post.z);
    // turned to face +x, the post swings round behind him to -x
    const turned = thatchgrinPoleAt(0, 0, Math.PI / 2);
    expect(turned.post.x).toBeCloseTo(-THATCHGRIN_POLE.postBack, 6);
    expect(turned.post.z).toBeCloseTo(0, 6);
    // the bar at his shoulders (his 7.4-yard body), the post above his head's crown
    expect(THATCHGRIN_POLE.barHeight).toBeGreaterThan(4.8);
    expect(THATCHGRIN_POLE.barHeight).toBeLessThan(5.8);
    expect(THATCHGRIN_POLE.postTop).toBeGreaterThan(THATCHGRIN_POLE.barHeight + 1);
    // the wake's beats in order, all inside the 3 s rise hold
    expect(AWAKEN_HEAD_SEC).toBeLessThan(AWAKEN_TEAR_SEC);
    expect(AWAKEN_TEAR_SEC).toBeLessThan(AWAKEN_LAND_SEC);
    expect(AWAKEN_LAND_SEC).toBeLessThan(3);
  });
});

describe('the Swelling Gourd', () => {
  it('heaves up from small, then swells as it ripens', () => {
    expect(swellScale(0, 0, 0)).toBeCloseTo(0.2, 6);
    const risen = swellScale(0, SWELL_RISE_SEC, 0);
    expect(risen).toBeCloseTo(1, 6);
    // steady growth, no throb, through the first three quarters
    expect(swellScale(0.5, 5, 0.123)).toBeGreaterThan(risen);
    expect(swellScale(0.7, 5, 0.123)).toBeGreaterThan(swellScale(0.5, 5, 0.123));
  });

  it('throbs only in the last quarter, faster and harder as the fuse runs out', () => {
    for (const t of [0, 0.1, 0.37, 1.9]) {
      expect(swellThrob(0.5, t)).toBe(0);
      expect(swellThrob(0.75, t)).toBe(0);
    }
    // its amplitude follows how late the fuse is
    const peak = (p: number) => {
      let m = 0;
      for (let i = 0; i < 400; i++) m = Math.max(m, Math.abs(swellThrob(p, i / 400)));
      return m;
    };
    expect(peak(0.85)).toBeLessThan(peak(0.99));
    expect(peak(0.99)).toBeLessThanOrEqual(1);
  });

  it('glows from a low ember to a blaze, always 0..1', () => {
    expect(swellGlow(0, 0)).toBeCloseTo(0.3, 6);
    expect(swellGlow(1, 0)).toBeCloseTo(0.9, 6);
    for (let i = 0; i <= 20; i++) {
      const g = swellGlow(i / 20, i * 0.071);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });
});
