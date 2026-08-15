import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import {
  BURNING_PACT_VFX_FULL_SPEC,
  CONFLAGRATE_VFX_FULL_SPEC,
  DUSKFIRE_VFX_FULL_SPEC,
  PYRE_COLOSSUS_VFX_FULL_SPEC,
  RAIN_OF_FIRE_VFX_FULL_SPEC,
  RAIN_OF_FIRE_VFX_SPEC,
  RUINOUS_BRAND_VFX_FULL_SPEC,
} from '../src/render/destruction_vfx_specs';

function harness() {
  const sequenceBolt = vi.fn();
  const sequenceInstant = vi.fn();
  const sequenceInstantAt = vi.fn();
  const orbit = vi.fn(() => true);
  const fx = {
    setDelegates: vi.fn(),
    sequenceBolt,
    sequenceInstant,
    sequenceInstantAt,
    orbit,
    windup: vi.fn(() => true),
    warmSpiritsForClass: vi.fn(),
    bodyGlow: vi.fn(),
    holdShell: vi.fn(),
    holdGroundAura: vi.fn(() => false),
    groundYAt: vi.fn(() => 0),
  } as unknown as AbilityVfxFx;
  const painter = new AbilityVfx(
    {
      fx,
      vfx: {
        projectile: vi.fn(),
        lightningProjectile: vi.fn(),
        burst: vi.fn(),
        nova: vi.fn(),
        tick: vi.fn(),
        shoutwave: vi.fn(),
        buffSwirl: vi.fn(),
        beam: vi.fn(),
      },
      anchor: () => ({ x: 0, y: 1, z: 0 }),
      spawnAoeRing: vi.fn(),
      triggerAttack: vi.fn(),
      localPlayerId: () => 1,
    },
    () => 0,
  );
  return { painter, sequenceBolt, sequenceInstant, sequenceInstantAt, orbit };
}

describe('Destruction premium VFX', () => {
  it.each([
    ['immolate', BURNING_PACT_VFX_FULL_SPEC],
    ['conflagrate', CONFLAGRATE_VFX_FULL_SPEC],
    ['shadowburn', DUSKFIRE_VFX_FULL_SPEC],
  ] as const)('routes %s through its authored fel projectile', (ability, spec) => {
    const h = harness();

    expect(
      h.painter.handleSpellfx({
        sourceId: 1,
        targetId: 2,
        school: ability === 'shadowburn' ? 'shadow' : 'fire',
        fx: 'projectile',
        ability,
      }),
    ).toBe(true);
    expect(h.sequenceBolt).toHaveBeenCalledWith(
      ability,
      spec,
      1,
      2,
      expect.any(Number),
      expect.any(Number),
      0,
      1,
      expect.any(Number),
    );
  });

  it('holds Burning Pact and Ruinous Brand on their victim as readable state', () => {
    const h = harness();

    h.painter.syncEntity({
      id: 2,
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      auras: [{ id: 'immolate' }, { id: 'ruinous_brand' }],
    });

    expect(h.orbit).toHaveBeenCalledWith(
      2,
      'sparks',
      expect.any(Number),
      expect.objectContaining({ n: 5, radius: 0.88 }),
      0,
    );
    expect(h.orbit).toHaveBeenCalledWith(
      2,
      'runes',
      expect.any(Number),
      expect.objectContaining({ n: 3, radius: 1 }),
      0,
    );
    expect(
      h.painter.handleSpellfx({
        sourceId: 1,
        targetId: 2,
        school: 'fire',
        fx: 'selfCast',
        ability: 'ruinous_brand',
      }),
    ).toBe(true);
    expect(h.sequenceInstant).toHaveBeenCalledWith(
      'ruinous_brand',
      RUINOUS_BRAND_VFX_FULL_SPEC,
      1,
      2,
      expect.any(Number),
      0,
      expect.any(Number),
    );
  });

  it('gives Rain of Fire and the Pyre Colossus full point-anchored impacts', () => {
    const rain = harness();
    expect(
      rain.painter.handleSpellfxAt({
        sourceId: 1,
        x: 7,
        z: 9,
        radius: 7,
        school: 'fire',
        fx: 'nova',
        ability: 'rain_of_fire',
      }),
    ).toBe(true);
    expect(rain.sequenceInstantAt).toHaveBeenCalledWith(
      'rain_of_fire',
      RAIN_OF_FIRE_VFX_FULL_SPEC,
      1,
      7,
      9,
      expect.any(Number),
      0,
      expect.any(Number),
    );
    expect(RAIN_OF_FIRE_VFX_SPEC).toMatchObject({ pw: 1.58, sp: 50, fin: 1 });

    const infernal = harness();
    expect(
      infernal.painter.handleSpellfxAt({
        sourceId: 1,
        x: 7,
        z: 9,
        radius: 6,
        school: 'fire',
        fx: 'nova',
        ability: 'summon_infernal',
      }),
    ).toBe(true);
    expect(infernal.sequenceInstantAt).toHaveBeenCalledWith(
      'summon_infernal',
      PYRE_COLOSSUS_VFX_FULL_SPEC,
      1,
      7,
      9,
      expect.any(Number),
      0,
      expect.any(Number),
    );
  });

  it('carries every premium identity through the authoritative event seams', () => {
    const casting = readFileSync(
      new URL('../src/sim/combat/casting_lifecycle.ts', import.meta.url),
      'utf8',
    );
    const effects = readFileSync(
      new URL('../src/sim/combat/effect_dispatch.ts', import.meta.url),
      'utf8',
    );
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

    expect(casting).toContain('ability: ability.id');
    expect(effects).toContain('abilityId: ability.id');
    expect(effects).toContain('ability: ability.id');
    expect(renderer).toContain('this.abilityVfx.handleSpellfx(ev)');
    expect(renderer).toContain('this.abilityVfx.handleSpellfxAt(ev)');
  });
});
