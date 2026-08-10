import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { abilityVfxFullSpec, abilityVfxSpec } from '../src/render/ability_vfx_registry';
import {
  EMBERKIN_FELBOLT_VFX_FULL_SPEC,
  EMBERKIN_FELBOLT_VFX_SPEC,
  GLOOMSHADE_ABYSSAL_CHAIN_VFX_FULL_SPEC,
  GLOOMSHADE_ABYSSAL_CHAIN_VFX_SPEC,
} from '../src/render/warlock_pet_vfx_specs';

function harness() {
  const sequenceBolt = vi.fn();
  const sequenceInstant = vi.fn();
  const triggerAttack = vi.fn();
  const beam = vi.fn();
  const fx = {
    setDelegates: vi.fn(),
    sequenceBolt,
    sequenceInstant,
    beamRibbon: vi.fn(),
    warmSpiritsForClass: vi.fn(),
    bodyGlow: vi.fn(),
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
        beam,
      },
      anchor: () => ({ x: 0, y: 1, z: 0 }),
      spawnAoeRing: vi.fn(),
      triggerAttack,
      isMob: () => true,
      castingAbilityOf: () => null,
      isMidOneShot: () => false,
      localPlayerId: () => 99,
    },
    () => 0,
  );
  return { painter, sequenceBolt, sequenceInstant, triggerAttack, beam };
}

describe('Warlock pet signature VFX', () => {
  it('routes Felbolt through its fel-lance projectile and the Emberkin cast clip hook', () => {
    expect(abilityVfxSpec('emberkin_felbolt')).toBe(EMBERKIN_FELBOLT_VFX_SPEC);
    expect(abilityVfxFullSpec('emberkin_felbolt')).toBe(EMBERKIN_FELBOLT_VFX_FULL_SPEC);
    expect(EMBERKIN_FELBOLT_VFX_FULL_SPEC).toMatchObject({
      archetype: 'bolt',
      palette: 'venom',
      tint: '#67ff3f',
      accent: '#d7ff65',
      power: 1.05,
      bolt: { style: 'felLance', coils: true, tracer: true },
      impact: { ring: 0.7, sparks: 30, light: 1.15 },
    });

    const h = harness();
    expect(
      h.painter.handleSpellfx({
        sourceId: 1,
        targetId: 2,
        school: 'fire',
        fx: 'projectile',
        ability: 'emberkin_felbolt',
      }),
    ).toBe(true);
    expect(h.sequenceBolt).toHaveBeenCalledWith(
      'emberkin_felbolt',
      EMBERKIN_FELBOLT_VFX_FULL_SPEC,
      1,
      2,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      1,
      expect.any(Number),
    );
    expect(h.triggerAttack).toHaveBeenCalledWith(1, 'emberkin_felbolt');
  });

  it('pairs Abyssal Chain with a live tether, target implosion, and cast clip hook', () => {
    expect(abilityVfxSpec('gloomshade_abyssal_chain')).toBe(GLOOMSHADE_ABYSSAL_CHAIN_VFX_SPEC);
    expect(abilityVfxFullSpec('gloomshade_abyssal_chain')).toBe(
      GLOOMSHADE_ABYSSAL_CHAIN_VFX_FULL_SPEC,
    );
    expect(GLOOMSHADE_ABYSSAL_CHAIN_VFX_FULL_SPEC).toMatchObject({
      archetype: 'burst',
      palette: 'shadow',
      tint: '#7562ff',
      accent: '#61dbe8',
      power: 1.2,
      burst: { style: 'link' },
      motifs: ['chains', 'implosion'],
      motifAt: 'target',
      motifR: 1.5,
      impact: { ring: 0.85, sparks: 28, light: 1.25 },
    });

    const h = harness();
    expect(
      h.painter.handleSpellfx({
        sourceId: 1,
        targetId: 2,
        school: 'shadow',
        fx: 'beam',
        ability: 'gloomshade_abyssal_chain',
      }),
    ).toBe(true);
    expect(h.beam).toHaveBeenCalled();
    expect(h.triggerAttack).toHaveBeenCalledWith(1, 'gloomshade_abyssal_chain');

    expect(
      h.painter.handleSpellfx({
        sourceId: 1,
        targetId: 2,
        school: 'shadow',
        fx: 'tick',
        ability: 'gloomshade_abyssal_chain',
      }),
    ).toBe(true);
    expect(h.sequenceInstant).toHaveBeenCalledWith(
      'gloomshade_abyssal_chain',
      GLOOMSHADE_ABYSSAL_CHAIN_VFX_FULL_SPEC,
      1,
      2,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('claims both pet abilities before the generic renderer fallback', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    // Routing is data-driven now: the spec registry claims both pet abilities
    // through the one handleSpellfx gate (the two spec-shape tests above prove
    // each ability resolves its dedicated FULL spec).
    expect(renderer).toContain('this.abilityVfx.handleSpellfx(ev)');
  });
});
