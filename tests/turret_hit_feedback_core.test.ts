import { describe, expect, it, vi } from 'vitest';
import type { TurretEvent } from '../src/sim/minigames/turret_defense';
import type { TurretFeedback } from '../src/sim/minigames/turret_feedback';
import {
  TURRET_HIT_ATTACK_MS,
  TURRET_HIT_MAX_FLASH,
  TURRET_HIT_REDUCED_FLASH,
  TURRET_HIT_RELEASE_MS,
  TurretHitFeedback,
  turretHitCameraShake,
  turretHitLevel,
  turretHitStrength,
} from '../src/ui/hud/vehicle/turret_hit_feedback_core';
import type { TurretSessionView } from '../src/world_api/vehicles';
import { probeAllocationStability } from './util/alloc_probe';

function session(entries: TurretFeedback[], startTick = 0): TurretSessionView {
  return {
    origin: { x: 0, y: 0, z: 0 },
    defense: { startTick } as unknown as TurretSessionView['defense'],
    waveCount: 6,
    monstersLeft: 0,
    feedback: entries,
  };
}

const breach = (points: number, id = 1): TurretEvent => ({
  type: 'breach',
  id,
  points,
  integrity: 100 - points,
  x: 3,
  y: 0,
  z: 0,
});

function entry(seq: number, tick: number, event: TurretEvent): TurretFeedback {
  return { seq, tick, event };
}

function rig(reduced = false) {
  let now = 1000;
  const clock = vi.fn(() => now);
  const reducedMotion = vi.fn(() => reduced);
  const hits = new TurretHitFeedback(clock, reducedMotion);
  return {
    hits,
    clock,
    reducedMotion,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('turret hit strength', () => {
  it('grows with the points lost, from a readable floor to full', () => {
    expect(turretHitStrength(0)).toBe(0);
    expect(turretHitStrength(-3)).toBe(0);
    expect(turretHitStrength(1)).toBeCloseTo(0.4, 12);
    const steps = [1, 2, 4, 10, 12].map(turretHitStrength);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    expect(turretHitStrength(12)).toBe(1);
    expect(turretHitStrength(40)).toBe(1);
  });

  it('kicks the camera harder for a costlier strike, and never under reduced motion', () => {
    expect(turretHitCameraShake(0, false)).toBe(0);
    expect(turretHitCameraShake(1, false)).toBeGreaterThan(0);
    expect(turretHitCameraShake(12, false)).toBeGreaterThan(turretHitCameraShake(2, false));
    expect(turretHitCameraShake(12, false)).toBeLessThanOrEqual(0.3);
    expect(turretHitCameraShake(12, true)).toBe(0);
  });
});

describe('turret hit envelope', () => {
  it('fades in over the attack and out over the release', () => {
    expect(TURRET_HIT_ATTACK_MS).toBe(80);
    expect(TURRET_HIT_RELEASE_MS).toBe(600);
    expect(turretHitLevel(0, 0, 1)).toBe(0);
    expect(turretHitLevel(TURRET_HIT_ATTACK_MS / 2, 0, 1)).toBeCloseTo(0.5, 12);
    expect(turretHitLevel(TURRET_HIT_ATTACK_MS, 0, 1)).toBe(1);
    const mid = turretHitLevel(TURRET_HIT_ATTACK_MS + TURRET_HIT_RELEASE_MS / 2, 0, 1);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.5);
    expect(turretHitLevel(TURRET_HIT_ATTACK_MS + TURRET_HIT_RELEASE_MS, 0, 1)).toBe(0);
  });

  it('rises from where a running flash stands, never dropping to black first', () => {
    expect(turretHitLevel(0, 0.6, 0.8)).toBe(0.6);
    expect(turretHitLevel(TURRET_HIT_ATTACK_MS / 2, 0.6, 0.8)).toBeCloseTo(0.7, 12);
  });
});

describe('turret hit feedback', () => {
  it('flashes harder the more points a strike cost', () => {
    const small = rig();
    const big = rig();
    small.hits.update(session([entry(1, 10, breach(2))]), 10);
    big.hits.update(session([entry(1, 10, breach(10))]), 10);
    small.advance(TURRET_HIT_ATTACK_MS);
    big.advance(TURRET_HIT_ATTACK_MS);
    const a = small.hits.update(session([entry(1, 10, breach(2))]), 10);
    expect(a.active).toBe(true);
    expect(a.flash).toBeCloseTo(turretHitStrength(2) * TURRET_HIT_MAX_FLASH, 12);
    const aFlash = a.flash;
    const b = big.hits.update(session([entry(1, 10, breach(10))]), 10);
    expect(b.flash).toBeCloseTo(turretHitStrength(10) * TURRET_HIT_MAX_FLASH, 12);
    expect(b.flash).toBeGreaterThan(aFlash);
    expect(b.glow).toBeCloseTo(turretHitStrength(10), 12);
  });

  it('adds up the strikes of one frame and kicks the camera once for them', () => {
    const { hits, advance } = rig();
    const ring = [entry(1, 10, breach(2, 1)), entry(2, 10, breach(4, 2))];
    const first = hits.update(session(ring), 10);
    expect(first.cameraShake).toBeCloseTo(turretHitCameraShake(6, false), 12);
    advance(TURRET_HIT_ATTACK_MS);
    const peak = hits.update(session(ring), 10);
    expect(peak.cameraShake).toBe(0);
    expect(peak.glow).toBeCloseTo(turretHitStrength(6), 12);
  });

  it('plays each breach once per sequence number, then fades out and goes idle', () => {
    const { hits, clock, advance } = rig();
    const ring = [entry(1, 10, breach(4))];
    expect(hits.update(session(ring), 10).cameraShake).toBeGreaterThan(0);
    advance(TURRET_HIT_ATTACK_MS + TURRET_HIT_RELEASE_MS / 2);
    const fading = hits.update(session(ring), 11);
    expect(fading.active).toBe(true);
    expect(fading.cameraShake).toBe(0);
    advance(TURRET_HIT_RELEASE_MS);
    const done = hits.update(session(ring), 12);
    expect(done).toMatchObject({ active: false, flash: 0, glow: 0, shake: 0, cameraShake: 0 });
    clock.mockClear();
    for (let i = 0; i < 10; i++) hits.update(session(ring), 12);
    expect(clock).not.toHaveBeenCalled();
    ring.push(entry(2, 13, breach(1)));
    expect(hits.update(session(ring), 13).active).toBe(true);
  });

  it('ignores every other event', () => {
    const { hits, clock } = rig();
    const quiet: TurretEvent[] = [
      { type: 'windupStart', id: 1, x: 3, z: 0 },
      { type: 'vanished', id: 1, x: 3, y: 0, z: 0 },
      { type: 'waveCleared', wave: 0 },
    ];
    const frame = hits.update(session(quiet.map((e, i) => entry(i + 1, 10, e))), 10);
    expect(frame.active).toBe(false);
    expect(clock).not.toHaveBeenCalled();
  });

  it('skips a breach already stale on the seat clock at its first read', () => {
    const late = rig();
    expect(late.hits.update(session([entry(1, 49, breach(8))]), 60).active).toBe(false);
    const fresh = rig();
    expect(fresh.hits.update(session([entry(1, 50, breach(8))]), 60).cameraShake).toBeGreaterThan(
      0,
    );
  });

  it('restacks a strike on a running flash from where it stands', () => {
    const { hits, advance } = rig();
    const ring = [entry(1, 10, breach(12))];
    hits.update(session(ring), 10);
    advance(TURRET_HIT_ATTACK_MS + 100);
    const before = hits.update(session(ring), 11).glow;
    ring.push(entry(2, 12, breach(1)));
    const after = hits.update(session(ring), 12);
    expect(after.glow).toBeCloseTo(before, 12);
    advance(TURRET_HIT_ATTACK_MS);
    expect(hits.update(session(ring), 12).glow).toBeCloseTo(before, 12);
  });

  it('swings the bar while it flashes', () => {
    const { hits, advance } = rig();
    const ring = [entry(1, 10, breach(12))];
    hits.update(session(ring), 10);
    let swung = 0;
    for (let i = 0; i < 20; i++) {
      advance(16);
      const frame = hits.update(session(ring), 10);
      expect(Math.abs(frame.shake)).toBeLessThanOrEqual(frame.glow + 1e-12);
      swung = Math.max(swung, Math.abs(frame.shake));
    }
    expect(swung).toBeGreaterThan(0.3);
  });

  it('under reduced motion: a softer flash, no swing and no camera kick', () => {
    const { hits, reducedMotion, advance } = rig(true);
    const ring = [entry(1, 10, breach(12))];
    expect(hits.update(session(ring), 10).cameraShake).toBe(0);
    expect(reducedMotion).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) {
      advance(16);
      const frame = hits.update(session(ring), 10);
      expect(frame.shake).toBe(0);
      expect(frame.flash).toBeCloseTo(
        frame.glow * TURRET_HIT_MAX_FLASH * TURRET_HIT_REDUCED_FLASH,
        12,
      );
    }
    expect(reducedMotion).toHaveBeenCalledTimes(1);
  });

  it('stops at once when the seat goes away, and never replays the old seat', () => {
    const { hits, advance } = rig();
    const ring = [entry(1, 10, breach(6))];
    hits.update(session(ring), 10);
    advance(TURRET_HIT_ATTACK_MS);
    expect(hits.update(null, null)).toMatchObject({ active: false, flash: 0 });
    expect(hits.update(session(ring), 10).active).toBe(false);
  });

  it('reuses one frame object through a strike, its fade and the idle frames after it', () => {
    const { hits, advance } = rig();
    const ring = [entry(1, 10, breach(6))];
    const view = session(ring);
    const first = hits.update(view, 10);
    const flashing = probeAllocationStability(() => {
      advance(8);
      const frame = hits.update(view, 10);
      expect(frame.active).toBe(true);
      return frame;
    });
    expect(flashing.stable, flashing.detail).toBe(true);
    advance(TURRET_HIT_RELEASE_MS);
    const idle = probeAllocationStability(() => hits.update(view, 10));
    expect(idle.stable, idle.detail).toBe(true);
    expect(hits.update(view, 10)).toBe(first);
    expect(hits.update(null, null)).toBe(first);
  });

  it('starts clean with a new seat', () => {
    const { hits, advance } = rig();
    hits.update(session([entry(1, 10, breach(12))]), 10);
    advance(TURRET_HIT_ATTACK_MS);
    const next = hits.update(session([], 40), 40);
    expect(next.active).toBe(false);
    const struck = hits.update(session([entry(1, 45, breach(2))], 40), 45);
    expect(struck.cameraShake).toBeCloseTo(turretHitCameraShake(2, false), 12);
  });
});
