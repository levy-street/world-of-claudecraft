import { describe, expect, it, vi } from 'vitest';
import {
  abilityVfxFullSpecFor,
  abilityVfxSpecFor,
} from '../src/render/ability_vfx/encounter_specs';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import { planCast } from '../src/render/ability_vfx_core';
import {
  ROACH_KING_VFX_FULL_SPECS,
  ROACH_KING_VFX_SPECS,
} from '../src/render/roach_king_vfx_specs';

function painterFixture() {
  const fx = {
    setDelegates: vi.fn(),
    windup: vi.fn().mockReturnValue(true),
    holdShell: vi.fn(),
    holdGroundAura: vi.fn().mockReturnValue(true),
    orbit: vi.fn().mockReturnValue(true),
    bodyGlow: vi.fn(),
    sleepEntity: vi.fn(),
    update: vi.fn(),
    groundYAt: () => 4,
    sequenceInstant: vi.fn(),
    sequenceInstantAt: vi.fn(),
  };
  const vfx = { buffSwirl: vi.fn() };
  const spawnAoeRing = vi.fn();
  const painter = new AbilityVfx(
    {
      fx,
      vfx,
      anchor: () => ({ x: 0, y: 0, z: 0 }),
      spawnAoeRing,
      triggerAttack: vi.fn(),
    } as unknown as AbilityVfxDeps,
    () => 12.5,
  );
  return { painter, fx, vfx, spawnAoeRing };
}

const boss = {
  id: 7,
  kind: 'mob' as const,
  templateId: 'rift_boss_asmon',
  castingAbility: null,
  castRemaining: 0,
  castTotal: 0,
  auras: [],
  queuedOnSwing: null,
};

describe('Roach King encounter VFX', () => {
  it('lands the swarm spectacle at the authoritative point and radius', () => {
    const { painter, fx, spawnAoeRing } = painterFixture();
    expect(
      painter.handleSpellfxAt({
        x: 20,
        z: 40,
        sourceId: 7,
        school: 'nature',
        fx: 'nova',
        ability: 'rift_asmon_swarm',
        radius: 10,
      }),
    ).toBe(true);
    expect(spawnAoeRing).toHaveBeenCalledWith(20, 40, 10, 'nature', expect.any(Number));
    expect(fx.sequenceInstantAt).toHaveBeenCalledWith(
      'rift_asmon_swarm',
      ROACH_KING_VFX_FULL_SPECS.rift_asmon_swarm,
      7,
      20,
      40,
      expect.any(Number),
      0,
      0,
    );
  });

  it('plays the coronation climax from its completion cue without another windup', () => {
    const { painter, fx } = painterFixture();
    expect(
      painter.handleSpellfx({
        sourceId: 7,
        targetId: 7,
        school: 'nature',
        fx: 'selfCast',
        ability: 'rift_asmon_coronation',
      }),
    ).toBe(true);
    expect(fx.sequenceInstant).toHaveBeenCalledWith(
      'rift_asmon_coronation',
      ROACH_KING_VFX_FULL_SPECS.rift_asmon_coronation,
      7,
      7,
      expect.any(Number),
      0,
      0,
    );
  });

  it('resolves every authored identity through the actual encounter painter registry', () => {
    expect(Object.keys(ROACH_KING_VFX_SPECS).sort()).toEqual(
      Object.keys(ROACH_KING_VFX_FULL_SPECS).sort(),
    );
    for (const [id, spec] of Object.entries(ROACH_KING_VFX_SPECS)) {
      expect(abilityVfxSpecFor(id)).toBe(spec);
      expect(abilityVfxFullSpecFor(id)).toBe(ROACH_KING_VFX_FULL_SPECS[id]);
      const full = planCast(spec, 1, 0);
      const minimal = planCast(spec, 0, 2);
      expect(minimal.color).toBe(full.color);
      expect(minimal.burstCount).toBeGreaterThan(0);
      expect(minimal.burstCount).toBeLessThanOrEqual(6);
      // No cosmetic impact ring substitutes a different hazard footprint.
      expect(full.ringScale).toBe(0);
    }
  });

  it('drives distinct cast ceremonies from live replicated boss casting state', () => {
    for (const id of [
      'rift_asmon_coronation',
      'rift_asmon_desk_slam',
      'rift_asmon_tribute',
      'rift_asmon_filth',
      'rift_asmon_swarm',
    ]) {
      const { painter, fx } = painterFixture();
      painter.syncEntity({ ...boss, castingAbility: id, castTotal: 3, castRemaining: 1.5 });
      expect(fx.windup).toHaveBeenCalledOnce();
      expect(fx.windup.mock.calls[0][2]).toBe(0.5);
      expect(fx.windup.mock.calls[0][3]).toBe(ROACH_KING_VFX_FULL_SPECS[id].windupStyle);
      expect(painter.statsSnapshot()[id]?.primitives).toBeGreaterThan(0);
      expect(fx.bodyGlow.mock.calls[0][2]).toBeLessThan(0.5);
    }
  });

  it('holds a crowned swarm halo from aura snapshots and drops it when the aura disappears', () => {
    const { painter, fx } = painterFixture();
    const crowned = { ...boss, auras: [{ id: 'rift_roach_crown' }] };
    painter.syncEntity(crowned);
    painter.syncEntity(crowned);
    expect(fx.orbit).toHaveBeenCalledTimes(2);
    expect(fx.orbit.mock.calls[0][1]).toBe('halo');
    fx.orbit.mockClear();
    painter.syncEntity(boss);
    expect(fx.orbit).not.toHaveBeenCalled();
  });
});
