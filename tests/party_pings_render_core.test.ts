// The party pings in the world, pure half (src/render/party_pings_core.ts):
// the palette, the pooled slots, where an icon stands (following its unit),
// the pop, the fade, the ripple and the readable-at-distance size.

import { describe, expect, it } from 'vitest';
import {
  createPartyPingAnchor,
  createPartyPingSlots,
  PARTY_PING_COLORS,
  PARTY_PING_FADE_S,
  PARTY_PING_GROUND_LIFT,
  PARTY_PING_HEAD_LIFT,
  PARTY_PING_MAX_SIZE,
  PARTY_PING_MIN_SIZE,
  PARTY_PING_PLATE_CLEAR,
  PARTY_PING_POP_S,
  PARTY_PING_SLOTS,
  type PartyPingMark,
  partyPingAlpha,
  partyPingAnchorInto,
  partyPingColorCss,
  partyPingIconSize,
  partyPingIconY,
  partyPingPop,
  partyPingRipple,
  syncPartyPingSlots,
} from '../src/render/party_pings_core';
import {
  PARTY_PING_GROUP_MAX,
  PARTY_PING_LIFETIME_S,
  PING_ATTACK,
  PING_KIND_COUNT,
  PING_LOOK,
} from '../src/sim/social/party_pings';

const mark = (id: number, over: Partial<PartyPingMark> = {}): PartyPingMark => ({
  id,
  kind: PING_LOOK,
  target: null,
  x: id,
  y: 0,
  z: 0,
  ...over,
});

describe('party pings render core: palette', () => {
  it('one distinct colour per kind', () => {
    expect(PARTY_PING_COLORS).toHaveLength(PING_KIND_COUNT);
    expect(new Set(PARTY_PING_COLORS).size).toBe(PING_KIND_COUNT);
    expect(partyPingColorCss(PING_ATTACK)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('the palette matches the stylesheet tokens', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
    const names = ['look', 'attack', 'warning', 'on-my-way', 'assist'];
    names.forEach((name, kind) => {
      expect(css).toContain(`--color-ping-${name}: ${partyPingColorCss(kind)};`);
    });
  });
});

describe('party pings render core: slots', () => {
  it('a pool for a whole group', () => {
    expect(PARTY_PING_SLOTS).toBe(PARTY_PING_GROUP_MAX);
  });

  it('new pings take free slots, born now; kept ones stay; gone ones free', () => {
    const slots = createPartyPingSlots();
    expect(syncPartyPingSlots(slots, [mark(1), mark(2)], 10)).toBe(true);
    expect(slots.filter((s) => s.id !== 0).map((s) => [s.id, s.born])).toEqual([
      [1, 10],
      [2, 10],
    ]);
    expect(syncPartyPingSlots(slots, [mark(1), mark(2)], 11)).toBe(false);
    expect(syncPartyPingSlots(slots, [mark(2), mark(3)], 12)).toBe(true);
    const live = slots.filter((s) => s.id !== 0);
    expect(live.map((s) => s.id).sort()).toEqual([2, 3]);
    expect(live.find((s) => s.id === 2)?.born).toBe(10);
    expect(live.find((s) => s.id === 3)?.born).toBe(12);
    expect(syncPartyPingSlots(slots, [], 13)).toBe(true);
    expect(slots.every((s) => s.id === 0)).toBe(true);
  });

  it('a bad kind never takes a slot; a full pool drops the overflow', () => {
    const slots = createPartyPingSlots();
    syncPartyPingSlots(slots, [mark(1, { kind: 99 })], 0);
    expect(slots.every((s) => s.id === 0)).toBe(true);
    const many = Array.from({ length: PARTY_PING_SLOTS + 3 }, (_, i) => mark(i + 1));
    syncPartyPingSlots(slots, many, 0);
    expect(slots.every((s) => s.id !== 0)).toBe(true);
  });
});

describe('party pings render core: motion', () => {
  it('pops in with an overshoot and settles at 1', () => {
    expect(partyPingPop(0, false)).toBe(0);
    const peak = Math.max(
      ...[0.5, 0.6, 0.7, 0.8].map((f) => partyPingPop(PARTY_PING_POP_S * f, false)),
    );
    expect(peak).toBeGreaterThan(1);
    expect(partyPingPop(PARTY_PING_POP_S, false)).toBe(1);
    expect(partyPingPop(0, true)).toBe(1);
  });

  it('fades out over the end of its life', () => {
    expect(partyPingAlpha(1)).toBe(1);
    expect(partyPingAlpha(PARTY_PING_LIFETIME_S - PARTY_PING_FADE_S / 2)).toBeCloseTo(0.5, 5);
    expect(partyPingAlpha(PARTY_PING_LIFETIME_S + 1)).toBe(0);
    expect(partyPingAlpha(0)).toBe(0);
  });

  it('the ripple loops 0..1; reduced motion holds it still', () => {
    for (const age of [0, 0.4, 1.3, 7.9]) {
      const r = partyPingRipple(age, false);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
    expect(partyPingRipple(0.4, true)).toBe(partyPingRipple(2, true));
  });

  it('holds a readable screen share, clamped', () => {
    const near = partyPingIconSize(0.5, 60);
    const mid = partyPingIconSize(40, 60);
    const far = partyPingIconSize(100_000, 60);
    expect(near).toBe(PARTY_PING_MIN_SIZE);
    expect(far).toBe(PARTY_PING_MAX_SIZE);
    expect(mid).toBeGreaterThan(near);
    expect(mid).toBeLessThan(far);
    // The same share at twice the distance is twice the world size.
    expect(partyPingIconSize(80, 60)).toBeCloseTo(mid * 2, 6);
  });
});

describe('party pings render core: anchor', () => {
  it('a ground ping floats over its point', () => {
    const [slot] = createPartyPingSlots();
    Object.assign(slot, { id: 1, target: null, x: 5, y: 2, z: -3 });
    const a = partyPingAnchorInto(createPartyPingAnchor(), slot, null, 0);
    expect(a).toEqual({ x: 5, y: 2, z: -3, iconY: 2 + PARTY_PING_GROUND_LIFT });
  });

  it('a unit ping follows the unit while this client draws it', () => {
    const [slot] = createPartyPingSlots();
    Object.assign(slot, { id: 1, target: 9, x: 5, y: 2, z: -3 });
    const unit = { x: 50, y: 1, z: 60, top: 3.5 };
    const a = partyPingAnchorInto(createPartyPingAnchor(), slot, unit, 0);
    expect(a).toEqual({ x: 50, y: 1, z: 60, iconY: 3.5 + PARTY_PING_HEAD_LIFT });
    // Out of view: it stays where the unit stood when pinged.
    const b = partyPingAnchorInto(createPartyPingAnchor(), slot, null, 0);
    expect(b.x).toBe(5);
  });

  it('a unit ping icon rises clear of its nameplate by its own size; a ground one does not', () => {
    const [slot] = createPartyPingSlots();
    Object.assign(slot, { id: 1, target: 9 });
    const a = partyPingAnchorInto(createPartyPingAnchor(), slot, { x: 0, y: 0, z: 0, top: 2 }, 0);
    expect(partyPingIconY(a, slot, 4)).toBeCloseTo(a.iconY + 4 * PARTY_PING_PLATE_CLEAR, 9);
    slot.target = null;
    const g = partyPingAnchorInto(createPartyPingAnchor(), slot, null, 0);
    expect(partyPingIconY(g, slot, 4)).toBe(g.iconY);
  });

  it('anchors far from the world origin exactly (the raid sits ~119k yd out)', () => {
    const [slot] = createPartyPingSlots();
    Object.assign(slot, { id: 1, target: null, x: 119_234.5, y: 12, z: -880.25 });
    const a = partyPingAnchorInto(createPartyPingAnchor(), slot, null, 0);
    expect(a.x).toBe(119_234.5);
    expect(a.z).toBe(-880.25);
  });
});
