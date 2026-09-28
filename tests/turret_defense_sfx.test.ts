import { describe, expect, it, vi } from 'vitest';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import {
  TURRET_FIRE_SFX,
  TURRET_IMPACT_SFX,
  TurretDefenseSfx,
  type TurretSfxCue,
  turretBlastSize,
  turretSfxCueInto,
} from '../src/game/turret_defense_sfx';
import type { TurretEvent } from '../src/sim/minigames/turret_defense';
import type { TurretFeedback } from '../src/sim/minigames/turret_feedback';
import type { TurretSessionView } from '../src/world_api/vehicles';

const origin = { x: 100, y: 5, z: 200 };
const fired: TurretEvent = {
  type: 'fired',
  shotId: 1,
  fromX: 100,
  fromZ: 200,
  x: 100,
  y: 5,
  z: 230,
  flightTicks: 6,
  impactTick: 16,
};
const impact = (hits: { id: number; falloff: number; damage: number }[], z = 230): TurretEvent => ({
  type: 'impact',
  shotId: 1,
  x: 100,
  y: 5,
  z,
  hits,
});

function cue(): TurretSfxCue {
  return { key: '', x: 0, y: 0, z: 0, gain: 0, rate: 0, jitter: true };
}

function session(entries: TurretFeedback[], startTick = 0): TurretSessionView {
  return {
    origin,
    defense: { startTick } as TurretSessionView['defense'],
    waveCount: 6,
    monstersLeft: 0,
    feedback: entries,
  };
}

function entry(seq: number, tick: number, event: TurretEvent): TurretFeedback {
  return { seq, tick, event };
}

function sink() {
  return {
    playAt: vi.fn((_key: string, _x: number, _y: number, _z: number, _opts?: unknown) => true),
    preload: vi.fn((_key: string) => {}),
  };
}

describe('Fire and Fly sound cues', () => {
  it('ships both samples through the SFX manifest', () => {
    const clips: Record<string, { variants: readonly unknown[]; playbackRate: number }> = SFX_CLIPS;
    expect(clips[TURRET_FIRE_SFX]?.variants).toHaveLength(3);
    expect(clips[TURRET_FIRE_SFX]?.playbackRate).toBe(0.6);
    expect(clips[TURRET_IMPACT_SFX]?.variants).toHaveLength(1);
  });

  it('plays the cannon report at the muzzle, toward the shot', () => {
    const out = turretSfxCueInto(fired, origin, cue());
    expect(out).toMatchObject({ key: TURRET_FIRE_SFX, x: 100, y: 7.2, z: 202, jitter: false });
    expect(out?.gain).toBeGreaterThan(1);
  });

  it('plays the blast louder and deeper-to-brighter with its size, from a pulled-in point', () => {
    const miss = turretSfxCueInto(impact([]), origin, cue());
    const direct = turretSfxCueInto(impact([{ id: 1, falloff: 1, damage: 10 }]), origin, cue());
    expect(miss?.key).toBe(TURRET_IMPACT_SFX);
    expect(direct?.gain).toBeGreaterThan(miss?.gain ?? 0);
    expect(direct?.rate).toBeGreaterThan(miss?.rate ?? 0);
    // 30 yd out is heard from 8 + 22 * 0.35 = 15.7 yd, on the same bearing.
    expect(direct?.x).toBeCloseTo(100, 12);
    expect(direct?.z).toBeCloseTo(200 + 15.7, 9);
    const near = turretSfxCueInto(impact([], 204), origin, cue());
    expect(near?.z).toBeCloseTo(204, 12);
  });

  it('sizes a blast by its strongest hit plus the extra bodies it caught', () => {
    expect(turretBlastSize([])).toBe(0);
    expect(turretBlastSize([{ falloff: 0.4 }])).toBeCloseTo(0.4, 12);
    expect(turretBlastSize([{ falloff: 0.4 }, { falloff: 0.2 }])).toBeCloseTo(0.55, 12);
    expect(turretBlastSize(Array.from({ length: 9 }, () => ({ falloff: 1 })))).toBe(1);
  });

  it('keeps every other event silent', () => {
    const quiet: TurretEvent[] = [
      { type: 'waveStart', wave: 0, count: 3 },
      { type: 'landed', id: 1, x: 0, y: 0, z: 0 },
      { type: 'windupStart', id: 1, x: 0, z: 0 },
    ];
    for (const event of quiet) expect(turretSfxCueInto(event, origin, cue())).toBeNull();
  });
});

describe('Fire and Fly sound player', () => {
  it('preloads both samples once, at the first seat it sees', () => {
    const s = sink();
    const sounds = new TurretDefenseSfx(s);
    sounds.update(null);
    expect(s.preload).not.toHaveBeenCalled();
    sounds.update(session([]));
    sounds.update(session([], 40));
    expect(s.preload.mock.calls.map((c) => c[0]).sort()).toEqual(
      [TURRET_FIRE_SFX, TURRET_IMPACT_SFX].sort(),
    );
  });

  it('plays each feedback entry once, by sequence number, and restarts with a new seat', () => {
    const s = sink();
    const sounds = new TurretDefenseSfx(s);
    const ring = [entry(1, 10, fired)];
    sounds.update(session(ring), 10);
    sounds.update(session(ring), 11);
    expect(s.playAt).toHaveBeenCalledTimes(1);
    expect(s.playAt.mock.calls[0][0]).toBe(TURRET_FIRE_SFX);
    ring.push(entry(2, 16, impact([])), entry(3, 16, { type: 'landed', id: 1, x: 0, y: 0, z: 0 }));
    sounds.update(session(ring), 16);
    expect(s.playAt).toHaveBeenCalledTimes(2);
    expect(s.playAt.mock.calls[1][0]).toBe(TURRET_IMPACT_SFX);
    sounds.update(session(ring), 17);
    expect(s.playAt).toHaveBeenCalledTimes(2);
    // A new seat numbers its entries from 1 again.
    sounds.update(session([entry(1, 50, fired)], 45), 50);
    expect(s.playAt).toHaveBeenCalledTimes(3);
  });

  it('restarts when the seat is taken again on the same start tick, its sequence back at 1', () => {
    const s = sink();
    const sounds = new TurretDefenseSfx(s);
    sounds.update(session([entry(1, 10, fired), entry(2, 10, fired), entry(3, 10, fired)]), 10);
    expect(s.playAt).toHaveBeenCalledTimes(3);
    sounds.update(session([entry(1, 12, fired)]), 12);
    expect(s.playAt).toHaveBeenCalledTimes(4);
  });

  it('plays every entry of a new seat, even one whose ring already runs past the old sequence', () => {
    const s = sink();
    const sounds = new TurretDefenseSfx(s);
    sounds.update(session([entry(1, 10, fired), entry(2, 10, fired), entry(3, 10, fired)]), 10);
    s.playAt.mockClear();
    const next = [1, 2, 3, 4].map((seq) => entry(seq, 50, fired));
    sounds.update(session(next, 45), 50);
    expect(s.playAt).toHaveBeenCalledTimes(4);
  });

  it('still plays an entry exactly ten ticks old at its first read, not eleven', () => {
    const fresh = sink();
    new TurretDefenseSfx(fresh).update(session([entry(1, 50, fired)]), 60);
    expect(fresh.playAt).toHaveBeenCalledTimes(1);
    const late = sink();
    new TurretDefenseSfx(late).update(session([entry(1, 49, fired)]), 60);
    expect(late.playAt).not.toHaveBeenCalled();
  });

  it('plays nothing for entries already stale when first read', () => {
    const s = sink();
    const sounds = new TurretDefenseSfx(s);
    sounds.update(session([entry(1, 10, fired), entry(2, 16, impact([]))]), 60);
    expect(s.playAt).not.toHaveBeenCalled();
    sounds.update(
      session([entry(1, 10, fired), entry(2, 16, impact([])), entry(3, 60, fired)]),
      60,
    );
    expect(s.playAt).toHaveBeenCalledTimes(1);
  });
});
