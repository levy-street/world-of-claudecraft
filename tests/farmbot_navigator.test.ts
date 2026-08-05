import { describe, expect, it } from 'vitest';
import {
  distance,
  distance2,
  pickNextNode,
  StuckDetector,
  steerToward,
} from '../farmbot/navigator';
import { type GatherNodeDef, INTERACT_RANGE } from '../src/sim/types';

function node(id: string, x: number, z: number, over: Partial<GatherNodeDef> = {}): GatherNodeDef {
  return { id, zoneId: 'zone_a', type: 'herb', pos: { x, z }, level: 4, tier: 1, ...over };
}

const ALL_TYPES = new Set(['herb', 'ore', 'wood'] as const);
const READY = () => true;
const NOT_BLACKLISTED = () => false;

describe('farmbot distance helpers', () => {
  it('computes squared and real horizontal distance', () => {
    expect(distance2({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(25);
    expect(distance({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(5);
  });
});

describe('farmbot pickNextNode', () => {
  const nodes = [
    node('near_herb', 10, 0),
    node('far_herb', 50, 0),
    node('other_zone', 1, 0, { zoneId: 'zone_b' }),
    node('ore_node', 5, 0, { type: 'ore' }),
    node('tier3_herb', 2, 0, { tier: 3 }),
  ];

  it('picks the nearest matching node', () => {
    const picked = pickNextNode(
      nodes,
      { x: 0, z: 0 },
      { types: ALL_TYPES, maxTier: 99, zoneId: 'zone_a' },
      READY,
      NOT_BLACKLISTED,
    );
    expect(picked?.id).toBe('tier3_herb');
  });

  it('filters by zone, type set, and tier cap', () => {
    const opts = { types: new Set(['herb'] as const), maxTier: 1, zoneId: 'zone_a' };
    const picked = pickNextNode(nodes, { x: 0, z: 0 }, opts, READY, NOT_BLACKLISTED);
    expect(picked?.id).toBe('near_herb');
  });

  it('skips non-ready nodes', () => {
    const picked = pickNextNode(
      nodes,
      { x: 0, z: 0 },
      { types: ALL_TYPES, maxTier: 99, zoneId: 'zone_a' },
      (id) => id !== 'tier3_herb',
      NOT_BLACKLISTED,
    );
    expect(picked?.id).toBe('ore_node');
  });

  it('skips blacklisted nodes', () => {
    const picked = pickNextNode(
      nodes,
      { x: 0, z: 0 },
      { types: ALL_TYPES, maxTier: 99, zoneId: 'zone_a' },
      READY,
      (id) => id === 'tier3_herb' || id === 'ore_node',
    );
    expect(picked?.id).toBe('near_herb');
  });

  it('returns null when nothing qualifies', () => {
    const picked = pickNextNode(
      nodes,
      { x: 0, z: 0 },
      { types: ALL_TYPES, maxTier: 99, zoneId: 'zone_c' },
      READY,
      NOT_BLACKLISTED,
    );
    expect(picked).toBeNull();
    expect(
      pickNextNode(
        nodes,
        { x: 0, z: 0 },
        { types: ALL_TYPES, maxTier: 99, zoneId: 'zone_a' },
        () => false,
        NOT_BLACKLISTED,
      ),
    ).toBeNull();
  });

  it('sorts candidates by priority index before distance', () => {
    // ore outranks herb: the far ore node beats the nearest herb
    const picked = pickNextNode(
      nodes,
      { x: 0, z: 0 },
      { types: ALL_TYPES, maxTier: 99, zoneId: 'zone_a', priority: ['ore'] },
      READY,
      NOT_BLACKLISTED,
    );
    expect(picked?.id).toBe('ore_node');
    // herb first flips it back to the nearest herb
    const herbFirst = pickNextNode(
      nodes,
      { x: 0, z: 0 },
      { types: ALL_TYPES, maxTier: 99, zoneId: 'zone_a', priority: ['herb'] },
      READY,
      NOT_BLACKLISTED,
    );
    expect(herbFirst?.id).toBe('tier3_herb');
    // within one priority rank, distance decides
    const distBreaks = pickNextNode(
      nodes,
      { x: 48, z: 0 },
      { types: ALL_TYPES, maxTier: 99, zoneId: 'zone_a', priority: ['herb'] },
      READY,
      NOT_BLACKLISTED,
    );
    expect(distBreaks?.id).toBe('far_herb');
  });

  it('applies config id filters independent of the runtime blacklist', () => {
    const base = { types: ALL_TYPES, maxTier: 99, zoneId: 'zone_a' };
    expect(
      pickNextNode(
        nodes,
        { x: 0, z: 0 },
        { ...base, blacklistIds: new Set(['tier3_herb', 'ore_node']) },
        READY,
        NOT_BLACKLISTED,
      )?.id,
    ).toBe('near_herb');
    expect(
      pickNextNode(
        nodes,
        { x: 0, z: 0 },
        { ...base, whitelistIds: new Set(['far_herb']) },
        READY,
        NOT_BLACKLISTED,
      )?.id,
    ).toBe('far_herb');
    // an empty whitelist allows everything
    expect(
      pickNextNode(
        nodes,
        { x: 0, z: 0 },
        { ...base, whitelistIds: new Set() },
        READY,
        NOT_BLACKLISTED,
      )?.id,
    ).toBe('tier3_herb');
    // a whitelist with no live candidates yields null
    expect(
      pickNextNode(
        nodes,
        { x: 0, z: 0 },
        { ...base, whitelistIds: new Set(['nope']) },
        READY,
        NOT_BLACKLISTED,
      ),
    ).toBeNull();
  });
});

describe('farmbot steerToward', () => {
  it('reports arrived inside the default interact range and releases forward', () => {
    const res = steerToward({ x: 0, z: 0 }, 0, { x: 3, z: 4 });
    expect(res.arrived).toBe(true);
    expect(res.input.forward).toBe(false);
    // exactly at the boundary counts as arrived
    const edge = steerToward({ x: 0, z: 0 }, 0, { x: 0, z: INTERACT_RANGE });
    expect(edge.arrived).toBe(true);
    const outside = steerToward({ x: 0, z: 0 }, 0, { x: 0, z: INTERACT_RANGE + 0.01 });
    expect(outside.arrived).toBe(false);
    expect(outside.input.forward).toBe(true);
  });

  it('honors a custom arrive range', () => {
    const res = steerToward({ x: 0, z: 0 }, 0, { x: 3, z: 0 }, 2);
    expect(res.arrived).toBe(false);
    expect(res.input.forward).toBe(true);
  });

  it('aims facing along (sin f, cos f) in every quadrant', () => {
    // facing f points along (sin f, cos f) in (x, z) per src/sim/player_motion.ts
    const at = { x: 0, z: 0 };
    expect(steerToward(at, 0, { x: 0, z: 10 }, 0).facing).toBeCloseTo(0);
    expect(steerToward(at, 0, { x: 10, z: 0 }, 0).facing).toBeCloseTo(Math.PI / 2);
    expect(steerToward(at, 0, { x: 0, z: -10 }, 0).facing).toBeCloseTo(Math.PI);
    expect(steerToward(at, 0, { x: -10, z: 0 }, 0).facing).toBeCloseTo(-Math.PI / 2);
    expect(steerToward(at, 0, { x: 10, z: 10 }, 0).facing).toBeCloseTo(Math.PI / 4);
    expect(steerToward(at, 0, { x: -10, z: -10 }, 0).facing).toBeCloseTo(-(3 * Math.PI) / 4);
  });
});

describe('farmbot StuckDetector', () => {
  it('reports nothing while making progress', () => {
    const det = new StuckDetector({ windowMs: 1000, epsilon: 1 });
    expect(det.update({ x: 0, z: 0 }, 0).stuck).toBe(false);
    expect(det.update({ x: 5, z: 0 }, 500).stuck).toBe(false);
    expect(det.update({ x: 10, z: 0 }, 2500).stuck).toBe(false);
  });

  it('reports stuck with a wiggle after a window without movement', () => {
    const det = new StuckDetector({ windowMs: 1000, epsilon: 1 });
    det.update({ x: 0, z: 0 }, 0);
    expect(det.update({ x: 0.1, z: 0 }, 500).stuck).toBe(false);
    const res = det.update({ x: 0.2, z: 0 }, 1500);
    expect(res.stuck).toBe(true);
    expect(res.escalation).toBe('wiggle');
    expect(res.input).toEqual({ forward: true, jump: true, strafeLeft: true, strafeRight: false });
  });

  it('resets the window when movement resumes', () => {
    const det = new StuckDetector({ windowMs: 1000, epsilon: 1 });
    det.update({ x: 0, z: 0 }, 0);
    expect(det.update({ x: 0, z: 0 }, 1500).stuck).toBe(true);
    // the wiggle worked: progress clears the streak
    expect(det.update({ x: 5, z: 0 }, 2000).stuck).toBe(false);
    expect(det.update({ x: 10, z: 0 }, 4000).stuck).toBe(false);
  });

  it('escalates to blacklist after repeated stuck events', () => {
    const det = new StuckDetector({ windowMs: 1000, epsilon: 1, blacklistAfter: 2 });
    det.update({ x: 0, z: 0 }, 0);
    const first = det.update({ x: 0, z: 0 }, 1500);
    expect(first.escalation).toBe('wiggle');
    const second = det.update({ x: 0, z: 0 }, 3000);
    expect(second.stuck).toBe(true);
    expect(second.escalation).toBe('blacklist');
    // and it keeps recommending blacklist while the caller keeps feeding it
    expect(det.update({ x: 0, z: 0 }, 4500).escalation).toBe('blacklist');
  });

  it('alternates the wiggle strafe side per stuck event', () => {
    const det = new StuckDetector({ windowMs: 1000, epsilon: 1, blacklistAfter: 99 });
    det.update({ x: 0, z: 0 }, 0);
    expect(det.update({ x: 0, z: 0 }, 1500).input.strafeLeft).toBe(true);
    expect(det.update({ x: 0, z: 0 }, 3000).input.strafeRight).toBe(true);
    expect(det.update({ x: 0, z: 0 }, 4500).input.strafeLeft).toBe(true);
  });

  it('reset() clears the anchor and the escalation streak', () => {
    const det = new StuckDetector({ windowMs: 1000, epsilon: 1 });
    det.update({ x: 0, z: 0 }, 0);
    det.update({ x: 0, z: 0 }, 1500);
    det.reset();
    expect(det.update({ x: 0, z: 0 }, 2000).stuck).toBe(false);
    // a fresh window starts from the reset, so this is a first stuck again
    expect(det.update({ x: 0, z: 0 }, 4000).escalation).toBe('wiggle');
  });
});
