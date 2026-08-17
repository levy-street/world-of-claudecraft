import { describe, expect, it } from 'vitest';
import {
  GRIT_COLORS,
  GRIT_FULL_SPEED,
  GRIT_MAX_RATE,
  gritEmitRate,
  gritMote,
  RIFTGLOW_COLORS,
  RIFTGLOW_IDLE_RATE,
  RIFTGLOW_MOVING_RATE,
  riftGlowEmitRate,
  riftGlowMote,
} from '../src/render/mount_fx_core';
import { MOUNT_VISUAL_SPECS } from '../src/render/mount_visuals';

/** A generator that hands back a fixed script of draws, so a mote is exact. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('grit emission (the grinding rock)', () => {
  it('emits nothing at all while stationary, at any speed value', () => {
    // A stationary dust cloud reads as a bug, so this is the load-bearing arm:
    // `moving` alone gates it, even if a stale speed is still non-zero.
    expect(gritEmitRate(0, false)).toBe(0);
    expect(gritEmitRate(GRIT_FULL_SPEED, false)).toBe(0);
    expect(gritEmitRate(-4, false)).toBe(0);
  });

  it('ramps with speed and saturates at the full-grind rate', () => {
    expect(gritEmitRate(0, true)).toBe(0);
    expect(gritEmitRate(GRIT_FULL_SPEED / 2, true)).toBeCloseTo(GRIT_MAX_RATE / 2, 6);
    expect(gritEmitRate(GRIT_FULL_SPEED, true)).toBe(GRIT_MAX_RATE);
    // Clamped, not extrapolated: a speed buff must not multiply the spray.
    expect(gritEmitRate(GRIT_FULL_SPEED * 4, true)).toBe(GRIT_MAX_RATE);
    // Backwards travel grinds just as hard as forwards.
    expect(gritEmitRate(-GRIT_FULL_SPEED, true)).toBe(GRIT_MAX_RATE);
  });

  it('throws each mote BEHIND the mount, against its facing', () => {
    // Facing +z (yaw 0): forward is (sin 0, cos 0) = (0, 1), so grit must go -z.
    const north = gritMote(0, GRIT_FULL_SPEED, seq([0.5, 0.5, 0.5, 0.9]));
    expect(north.dz).toBeLessThan(0);
    expect(north.vz).toBeLessThan(0);
    // Facing +x (yaw PI/2): forward is (1, 0), so grit must go -x.
    const east = gritMote(Math.PI / 2, GRIT_FULL_SPEED, seq([0.5, 0.5, 0.5, 0.9]));
    expect(east.dx).toBeLessThan(0);
    expect(east.vx).toBeLessThan(0);
    // It hugs the ground and is kicked upward, never spawned mid-air.
    expect(north.dy).toBeGreaterThan(0);
    expect(north.dy).toBeLessThan(0.2);
    expect(north.vy).toBeGreaterThan(0);
  });

  it('kicks grit harder the faster the rock is grinding', () => {
    const draws = [0.5, 0.5, 0.5, 0.9];
    const slow = gritMote(0, 1, seq(draws));
    const fast = gritMote(0, GRIT_FULL_SPEED, seq(draws));
    // Same draws, so any difference is the speed term alone.
    expect(Math.abs(fast.vz)).toBeGreaterThan(Math.abs(slow.vz));
  });

  it('picks its gravel tone from the draw, and only those two tones', () => {
    const warm = gritMote(0, 4, seq([0.5, 0.5, 0.5, 0.1]));
    const cool = gritMote(0, 4, seq([0.5, 0.5, 0.5, 0.9]));
    expect(warm.color).toBe(GRIT_COLORS[0]);
    expect(cool.color).toBe(GRIT_COLORS[1]);
    expect(GRIT_COLORS).toHaveLength(2);
  });
});

describe('rift-glow emission (the socketed rock)', () => {
  it('glows while standing still, and harder on the move', () => {
    // The epic hovers rather than resting, so unlike grit it never switches off:
    // an idle rate of zero would make the socketed rock indistinguishable from
    // the common one whenever the player stops.
    expect(riftGlowEmitRate(false)).toBe(RIFTGLOW_IDLE_RATE);
    expect(riftGlowEmitRate(false)).toBeGreaterThan(0);
    expect(riftGlowEmitRate(true)).toBe(RIFTGLOW_MOVING_RATE);
    expect(riftGlowEmitRate(true)).toBeGreaterThan(riftGlowEmitRate(false));
  });

  it('rises off the crown in a ring rather than trailing behind', () => {
    const mote = riftGlowMote(seq([0.0, 0.5, 0.9, 0.25]));
    // Above the ground plane and moving upward: light shed, not a wake.
    expect(mote.dy).toBeGreaterThan(0.4);
    expect(mote.vy).toBeGreaterThan(0);
    // Offset sits on a ring around the mount, so it is never dead centre.
    const radius = Math.hypot(mote.dx, mote.dz);
    expect(radius).toBeGreaterThan(0.25);
    expect(radius).toBeLessThan(0.8);
  });

  it('spreads motes around the full circle, not one bearing', () => {
    const a = riftGlowMote(seq([0.0, 0.5, 0.9, 0.25]));
    const b = riftGlowMote(seq([0.5, 0.5, 0.9, 0.25]));
    // Same radius draw, opposite angle draw: the two must land apart.
    expect(Math.hypot(a.dx - b.dx, a.dz - b.dz)).toBeGreaterThan(0.5);
  });

  it('uses the socketed gold palette, matching rift_boulder_placed', () => {
    const hot = riftGlowMote(seq([0.5, 0.5, 0.1, 0.5]));
    const pale = riftGlowMote(seq([0.5, 0.5, 0.9, 0.5]));
    expect(hot.color).toBe(RIFTGLOW_COLORS[0]);
    expect(pale.color).toBe(RIFTGLOW_COLORS[1]);
    // 0xffc24a is the vein colour door_portal.ts uses for the placed boulder.
    expect(RIFTGLOW_COLORS[0]).toBe(0xffc24a);
  });
});

describe('the rock mounts are wired to their effects', () => {
  it('gives the common grit and the epic the rift glow, and nothing else moved', () => {
    expect(MOUNT_VISUAL_SPECS.pet_rock.fx).toBe('grit');
    expect(MOUNT_VISUAL_SPECS.shiny_pet_rock.fx).toBe('riftglow');
    // The pre-existing two are untouched, so this change added effects rather
    // than redistributing them.
    expect(MOUNT_VISUAL_SPECS.stalkglider_snail.fx).toBe('slime');
    expect(MOUNT_VISUAL_SPECS.aether_hover_cycle.fx).toBe('exhaust');
    expect(MOUNT_VISUAL_SPECS.valorsteed.fx).toBeNull();
  });
});
