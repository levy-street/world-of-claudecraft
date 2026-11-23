import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { AbilityVfx, type AbilityVfxEntityState } from '../src/render/ability_vfx/painter';
import { abilityVfxFullSpec, abilityVfxSpec } from '../src/render/ability_vfx_registry';
import { SPIRIT_BOMB_VFX_FULL_SPEC, SPIRIT_BOMB_VFX_SPEC } from '../src/render/priest_vfx_specs';

function harness(open = true) {
  const fx = {
    setDelegates: vi.fn(),
    holdSpiritBomb: vi.fn(() => true),
    releaseSpiritBomb: vi.fn(() => true),
    cancelSpiritBomb: vi.fn(),
    windup: vi.fn(),
    sequenceInstant: vi.fn(),
    warmSpiritsForClass: vi.fn(),
    bodyGlow: vi.fn(),
    sleepEntity: vi.fn(),
    setQuality: vi.fn(),
  };
  const vfx = {
    projectile: vi.fn(),
    lightningProjectile: vi.fn(),
    burst: vi.fn(),
    nova: vi.fn(),
    tick: vi.fn(),
    shoutwave: vi.fn(),
    buffSwirl: vi.fn(),
    beam: vi.fn(),
  };
  const spawnAoeRing = vi.fn();
  const painter = new AbilityVfx(
    {
      fx: fx as unknown as AbilityVfxFx,
      vfx,
      anchor: (id) => ({ x: id * 10, y: 1, z: 5 }),
      spawnAoeRing,
      triggerAttack: vi.fn(),
      localPlayerId: () => 1,
      castVfxAdmit: () => open,
      castVfxReady: () => open,
    },
    () => 0,
  );
  return { painter, fx, vfx, spawnAoeRing };
}

const cast: AbilityVfxEntityState = {
  id: 1,
  castingAbility: 'spirit_bomb',
  castTotal: 3,
  castRemaining: 1.5,
  auras: [],
};
const release = {
  sourceId: 1,
  targetId: 2,
  school: 'shadow',
  fx: 'nova',
  ability: 'spirit_bomb',
};

describe('Tithe Bomb production presentation routing', () => {
  it('registers the bespoke identity and fills the giant sphere from live cast progress', () => {
    expect(abilityVfxSpec('spirit_bomb')).toBe(SPIRIT_BOMB_VFX_SPEC);
    expect(abilityVfxFullSpec('spirit_bomb')).toBe(SPIRIT_BOMB_VFX_FULL_SPEC);
    const h = harness();
    h.painter.syncEntity(cast);
    expect(h.fx.holdSpiritBomb).toHaveBeenCalledWith(1, 0.5, true);
    expect(h.fx.windup).not.toHaveBeenCalled();
    h.painter.castInterrupted(1);
    expect(h.fx.cancelSpiritBomb).toHaveBeenCalledWith(1);
  });

  it('claims completion once with an immediate target-centred eight yard footprint', () => {
    const h = harness();
    expect(h.painter.handleSpellfx(release)).toBe(true);
    expect(h.fx.releaseSpiritBomb).toHaveBeenCalledExactlyOnceWith(1, 2);
    expect(h.spawnAoeRing).toHaveBeenCalledExactlyOnceWith(20, 5, 8, 'shadow', 0xaa55ff);
    expect(h.vfx.nova).not.toHaveBeenCalled();
    expect(h.vfx.projectile).not.toHaveBeenCalled();
    expect(h.fx.sequenceInstant).not.toHaveBeenCalled();
  });

  it('keeps the footprint on a cold GPU while refusing all bespoke pieces', () => {
    const h = harness(false);
    h.painter.syncEntity(cast);
    expect(h.painter.handleSpellfx(release)).toBe(true);
    expect(h.fx.holdSpiritBomb).not.toHaveBeenCalled();
    expect(h.fx.releaseSpiritBomb).not.toHaveBeenCalled();
    expect(h.spawnAoeRing).toHaveBeenCalledExactlyOnceWith(20, 5, 8, 'shadow', 0xaa55ff);
  });

  it('retains the same footprint at minimum quality and never charges a dead caster', () => {
    const h = harness();
    h.painter.setQuality(0);
    h.painter.syncEntity({ ...cast, dead: true, hp: 0 });
    expect(h.fx.holdSpiritBomb).not.toHaveBeenCalled();
    h.painter.handleSpellfx(release);
    expect(h.spawnAoeRing).toHaveBeenCalledExactlyOnceWith(20, 5, 8, 'shadow', 0xaa55ff);
  });
});
