import { describe, expect, it } from 'vitest';
import {
  beginPortalCast,
  decodePortalHandoff,
  encodePortalHandoff,
  PORTAL_CAST_SECONDS,
  PORTAL_ENTER_RADIUS,
  PORTAL_FORWARD_YARDS,
  PORTAL_OPEN_SECONDS,
  type PortalHandoff,
  portalSpotBeside,
  shouldEnterPortal,
  tickPortal,
} from '../src/game/portal_travel_core';

describe('portalSpotBeside', () => {
  it('places the gate off the left shoulder, disc turned back at the wizard', () => {
    // facing 0 points along (sin 0, cos 0) = +z, so the left-shoulder ray
    // (facing + pi/2) points along +x.
    const spot = portalSpotBeside(10, 20, 0);
    expect(spot.x).toBeCloseTo(10 + PORTAL_FORWARD_YARDS);
    expect(spot.z).toBeCloseTo(20);
    expect(spot.facing).toBeCloseTo(Math.PI / 2 + Math.PI);
  });

  it('never opens on the conversation spot in front of the wizard', () => {
    // The player asking for passage stands ~1.5 yd ahead on the facing ray;
    // the gate must open outside the walk-in radius of that spot.
    const facing = 1.3;
    const spot = portalSpotBeside(0, 0, facing);
    const talkX = Math.sin(facing) * 1.5;
    const talkZ = Math.cos(facing) * 1.5;
    const d = Math.hypot(spot.x - talkX, spot.z - talkZ);
    expect(d).toBeGreaterThan(PORTAL_ENTER_RADIUS + 1);
  });
});

describe('portal state machine', () => {
  const spot = { x: 5, z: 5, facing: 0 };

  it('casts, opens exactly once, then expires', () => {
    const state = beginPortalCast(spot, 'deepglass', 'portal_wizard_eastbrook');
    expect(state.phase).toBe('casting');
    expect(state.remaining).toBe(PORTAL_CAST_SECONDS);

    // Halfway through the cast: still casting, no events.
    let tick = tickPortal(state, PORTAL_CAST_SECONDS / 2);
    expect(tick.state?.phase).toBe('casting');
    expect(tick.justOpened).toBe(false);

    // Cast completes: one justOpened edge, timer rearmed to the open window.
    tick = tickPortal(tick.state as NonNullable<typeof tick.state>, PORTAL_CAST_SECONDS);
    expect(tick.justOpened).toBe(true);
    expect(tick.state?.phase).toBe('open');
    expect(tick.state?.remaining).toBe(PORTAL_OPEN_SECONDS);

    // The open window runs out: expired, state gone.
    tick = tickPortal(tick.state as NonNullable<typeof tick.state>, PORTAL_OPEN_SECONDS + 1);
    expect(tick.expired).toBe(true);
    expect(tick.state).toBeNull();
  });

  it('never admits a walk-in while still casting', () => {
    const state = beginPortalCast(spot, 'deepglass', null);
    expect(shouldEnterPortal(state, spot.x, spot.z)).toBe(false);
  });

  it('admits the player inside the enter radius of an open gate only', () => {
    const casting = beginPortalCast(spot, 'overworld', null);
    const open = tickPortal(casting, PORTAL_CAST_SECONDS + 0.01).state;
    expect(open?.phase).toBe('open');
    if (!open) throw new Error('unreachable');
    expect(shouldEnterPortal(open, spot.x, spot.z)).toBe(true);
    expect(shouldEnterPortal(open, spot.x + PORTAL_ENTER_RADIUS - 0.05, spot.z)).toBe(true);
    expect(shouldEnterPortal(open, spot.x + PORTAL_ENTER_RADIUS + 0.05, spot.z)).toBe(false);
  });
});

describe('portal handoff codec', () => {
  const handoff: PortalHandoff = {
    v: 1,
    dest: 'deepglass',
    cls: 'mage',
    name: 'Traveller',
    originStopId: 'portal_wizard_eastbrook',
  };

  it('round-trips', () => {
    expect(decodePortalHandoff(encodePortalHandoff(handoff))).toEqual(handoff);
  });

  it('round-trips a null origin (URL boot, no town to return to)', () => {
    const urlBoot: PortalHandoff = { ...handoff, dest: 'overworld', originStopId: null };
    expect(decodePortalHandoff(encodePortalHandoff(urlBoot))).toEqual(urlBoot);
  });

  it('rejects garbage, wrong versions, and missing fields', () => {
    expect(decodePortalHandoff(null)).toBeNull();
    expect(decodePortalHandoff('')).toBeNull();
    expect(decodePortalHandoff('not json')).toBeNull();
    expect(decodePortalHandoff('42')).toBeNull();
    expect(decodePortalHandoff(JSON.stringify({ ...handoff, v: 2 }))).toBeNull();
    expect(decodePortalHandoff(JSON.stringify({ ...handoff, dest: 'moon' }))).toBeNull();
    expect(decodePortalHandoff(JSON.stringify({ ...handoff, cls: '' }))).toBeNull();
    expect(decodePortalHandoff(JSON.stringify({ ...handoff, originStopId: 7 }))).toBeNull();
  });
});
