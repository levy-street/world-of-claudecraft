import { describe, expect, it, vi } from 'vitest';
import { AbilityVfx, type AbilityVfxEntityState } from '../src/render/ability_vfx';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';

// battle_shout is policy-silenced while worn (the long-buff rule in
// ability_vfx_longbuff_core.ts: >= 300s buffs hold no disc/band), so the
// held-read case below wears a SHORT buff that legitimately keeps all three
// reads (disc, band, gain swirl); the latch-prune case keeps battle_shout,
// whose policy gain swirl rides the same semantic stamps.
function wornPresenceOfMind(): AbilityVfxEntityState {
  return {
    id: 41,
    castingAbility: null,
    castRemaining: 0,
    castTotal: 0,
    auras: [{ id: 'presence_of_mind' }],
    queuedOnSwing: null,
  };
}

function wornBattleShout(): AbilityVfxEntityState {
  return {
    id: 41,
    castingAbility: null,
    castRemaining: 0,
    castTotal: 0,
    auras: [{ id: 'battle_shout' }],
    queuedOnSwing: null,
  };
}

function painterHarness() {
  const heldGround = new Set<string>();
  const heldOrbits = new Set<string>();
  const holdGroundAura = vi.fn((entityId: number, band: number) => {
    const key = `${entityId}:${band}`;
    const started = !heldGround.has(key);
    heldGround.add(key);
    return started;
  });
  const orbit = vi.fn((entityId: number, style: string) => {
    const key = `${entityId}:${style}`;
    const started = !heldOrbits.has(key);
    heldOrbits.add(key);
    return started;
  });
  const sleepEntity = vi.fn((entityId: number) => {
    for (const key of heldGround) if (key.startsWith(`${entityId}:`)) heldGround.delete(key);
    for (const key of heldOrbits) if (key.startsWith(`${entityId}:`)) heldOrbits.delete(key);
  });
  const ringAt = vi.fn();
  const burstAt = vi.fn();
  const decalXZ = vi.fn();
  const pulseLight = vi.fn();
  const shakeAt = vi.fn();
  const fx = {
    setDelegates: vi.fn(),
    setQuality: vi.fn(),
    warmSpiritsForClass: vi.fn(),
    windup: vi.fn(() => false),
    holdShell: vi.fn(),
    holdGroundAura,
    orbit,
    bodyGlow: vi.fn(),
    sleepEntity,
    groundYAt: vi.fn(() => 0),
    ringAt,
    burstAt,
    decalXZ,
    pulseLight,
    shakeAt,
    glowIntensityOf: vi.fn(() => 0),
    groundAuraCountOf: vi.fn(() => 0),
    update: vi.fn(),
  } as unknown as AbilityVfxFx;
  const buffSwirl = vi.fn();
  const noop = vi.fn();
  const abilityVfx = new AbilityVfx(
    {
      fx,
      anchor: () => ({ x: 0, y: 0, z: 0 }),
      spawnAoeRing: noop,
      triggerAttack: noop,
      vfx: {
        projectile: noop,
        lightningProjectile: noop,
        burst: noop,
        nova: noop,
        tick: noop,
        shoutwave: noop,
        buffSwirl,
        beam: noop,
      },
    },
    () => 0,
  );
  return {
    abilityVfx,
    buffSwirl,
    heldGround,
    heldOrbits,
    holdGroundAura,
    orbit,
    sleepEntity,
    ringAt,
    burstAt,
    decalXZ,
    pulseLight,
    shakeAt,
  };
}

describe('ability VFX offscreen presentation sleep', () => {
  it('keeps a persistent aura latched without rendering it or replaying its gain effect', () => {
    const heldGround = new Set<string>();
    const heldOrbits = new Set<string>();
    const holdGroundAura = vi.fn((entityId: number, band: number) => {
      const key = `${entityId}:${band}`;
      const started = !heldGround.has(key);
      heldGround.add(key);
      return started;
    });
    const orbit = vi.fn((entityId: number, style: string) => {
      const key = `${entityId}:${style}`;
      const started = !heldOrbits.has(key);
      heldOrbits.add(key);
      return started;
    });
    const sleepEntity = vi.fn((entityId: number) => {
      for (const key of heldGround) if (key.startsWith(`${entityId}:`)) heldGround.delete(key);
      for (const key of heldOrbits) if (key.startsWith(`${entityId}:`)) heldOrbits.delete(key);
    });
    const fx = {
      setDelegates: vi.fn(),
      setQuality: vi.fn(),
      warmSpiritsForClass: vi.fn(),
      windup: vi.fn(() => false),
      holdShell: vi.fn(),
      holdGroundAura,
      orbit,
      bodyGlow: vi.fn(),
      sleepEntity,
      groundYAt: vi.fn(() => 0),
      ringAt: vi.fn(),
      burstAt: vi.fn(),
      decalXZ: vi.fn(),
      pulseLight: vi.fn(),
      shakeAt: vi.fn(),
      glowIntensityOf: vi.fn(() => 0),
      groundAuraCountOf: vi.fn(() => 0),
      update: vi.fn(),
    } as unknown as AbilityVfxFx;
    const buffSwirl = vi.fn();
    const noop = vi.fn();
    const abilityVfx = new AbilityVfx(
      {
        fx,
        anchor: () => ({ x: 0, y: 0, z: 0 }),
        spawnAoeRing: noop,
        triggerAttack: noop,
        vfx: {
          projectile: noop,
          lightningProjectile: noop,
          burst: noop,
          nova: noop,
          tick: noop,
          shoutwave: noop,
          buffSwirl,
          beam: noop,
        },
      },
      () => 0,
    );
    const entity = wornPresenceOfMind();

    abilityVfx.syncEntity(entity);
    abilityVfx.update(1 / 60);
    expect(holdGroundAura).toHaveBeenCalledTimes(1);
    expect(orbit).toHaveBeenCalledTimes(1);
    expect(buffSwirl).toHaveBeenCalledTimes(1);

    abilityVfx.syncEntity(entity, false);
    abilityVfx.update(1 / 60);
    expect(sleepEntity).toHaveBeenCalledWith(entity.id);
    expect(holdGroundAura).toHaveBeenCalledTimes(1);
    expect(orbit).toHaveBeenCalledTimes(1);

    abilityVfx.syncEntity(entity);
    expect(holdGroundAura).toHaveBeenCalledTimes(2);
    expect(orbit).toHaveBeenCalledTimes(2);
    expect(buffSwirl).toHaveBeenCalledTimes(1);
  });

  it('does not replay a rooted hostile arrival when its victim re-enters view', () => {
    const h = painterHarness();
    const entity: AbilityVfxEntityState = {
      id: 42,
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      auras: [{ id: 'charge_slow' }, { id: 'charge_root' }],
      queuedOnSwing: null,
    };

    h.abilityVfx.syncEntity(entity);
    h.abilityVfx.update(1 / 60);
    expect(h.orbit).toHaveBeenCalledTimes(2);
    expect(h.buffSwirl).not.toHaveBeenCalled();
    expect(h.ringAt).toHaveBeenCalledTimes(1);
    expect(h.burstAt).toHaveBeenCalledTimes(2);
    expect(h.decalXZ).toHaveBeenCalledTimes(1);
    expect(h.pulseLight).toHaveBeenCalledTimes(1);
    expect(h.shakeAt).toHaveBeenCalledTimes(1);

    h.abilityVfx.syncEntity(entity, false);
    h.abilityVfx.update(1 / 60);
    h.abilityVfx.syncEntity(entity);

    expect(h.orbit).toHaveBeenCalledTimes(4);
    expect(h.ringAt).toHaveBeenCalledTimes(1);
    expect(h.burstAt).toHaveBeenCalledTimes(2);
    expect(h.decalXZ).toHaveBeenCalledTimes(1);
    expect(h.pulseLight).toHaveBeenCalledTimes(1);
    expect(h.shakeAt).toHaveBeenCalledTimes(1);
  });

  it('prunes semantic latches for entities absent from the next frame', () => {
    const h = painterHarness();
    const semantic = h.abilityVfx as unknown as { heldSemantic: Map<number, unknown> };

    h.abilityVfx.syncEntity(wornBattleShout());
    h.abilityVfx.update(1 / 60);
    expect(semantic.heldSemantic.has(41)).toBe(true);
    expect(h.buffSwirl).toHaveBeenCalledTimes(1);

    h.abilityVfx.update(1 / 60);
    expect(semantic.heldSemantic.has(41)).toBe(false);

    h.heldGround.clear();
    h.heldOrbits.clear();
    h.abilityVfx.syncEntity(wornBattleShout());
    expect(h.buffSwirl).toHaveBeenCalledTimes(2);
  });
});
