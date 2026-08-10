import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { abilityVfxFullSpec, abilityVfxSpec } from '../src/render/ability_vfx_registry';
import { ABYSSAL_RIFT_VFX_FULL_SPEC, ABYSSAL_RIFT_VFX_SPEC } from '../src/render/warlock_vfx_specs';

function harness() {
  const sequenceInstantAt = vi.fn();
  const spawnAoeRing = vi.fn();
  const burst = vi.fn();
  const fx = {
    setDelegates: vi.fn(),
    sequenceInstantAt,
    groundYAt: vi.fn(() => 3),
    warmSpiritsForClass: vi.fn(),
    bodyGlow: vi.fn(),
  } as unknown as AbilityVfxFx;
  const painter = new AbilityVfx(
    {
      fx,
      vfx: {
        projectile: vi.fn(),
        lightningProjectile: vi.fn(),
        burst,
        nova: vi.fn(),
        tick: vi.fn(),
        shoutwave: vi.fn(),
        buffSwirl: vi.fn(),
        beam: vi.fn(),
      },
      anchor: () => ({ x: 0, y: 1, z: 0 }),
      spawnAoeRing,
      triggerAttack: vi.fn(),
      localPlayerId: () => 1,
    },
    () => 0,
  );
  return { painter, sequenceInstantAt, spawnAoeRing, burst };
}

describe('Abyssal Rift powerful VFX', () => {
  it('authors a final-tier implosion with a full readable eight-yard identity', () => {
    expect(abilityVfxSpec('abyssal_rift')).toBe(ABYSSAL_RIFT_VFX_SPEC);
    expect(abilityVfxFullSpec('abyssal_rift')).toBe(ABYSSAL_RIFT_VFX_FULL_SPEC);
    expect(ABYSSAL_RIFT_VFX_SPEC).toMatchObject({
      p: 'shadow',
      pw: 1.85,
      sp: 60,
      rg: 0.43,
      vr: 1,
      db: 1,
      sm: 1,
      li: 1.9,
      fin: 1,
      a: 'nova',
    });
    expect(ABYSSAL_RIFT_VFX_FULL_SPEC).toMatchObject({
      archetype: 'nova',
      palette: 'shadow',
      power: 1.85,
      finisher: true,
      screenFx: true,
      windupStyle: 'vortex',
      motifs: ['implosion', 'chains', 'fissure', 'pillars'],
      motifAt: 'target',
      motifR: 8,
      nova: { radius: 8 },
      decal: 'portal',
      impact: {
        flipbook: true,
        ring: 0.43,
        vRing: 1.5,
        sparks: 60,
        debris: true,
        smoke: true,
        light: 1.9,
        sample: 'imp_shadow',
      },
    });
  });

  it('claims the authoritative ground impact and preserves the exact gameplay radius', () => {
    const h = harness();

    expect(
      h.painter.handleSpellfxAt({
        sourceId: 1,
        x: 13,
        z: -7,
        radius: 8,
        school: 'shadow',
        fx: 'nova',
        ability: 'abyssal_rift',
      }),
    ).toBe(true);

    expect(h.spawnAoeRing).toHaveBeenCalledWith(13, -7, 8, 'shadow', 0x5d24a8);
    expect(h.sequenceInstantAt).toHaveBeenCalledWith(
      'abyssal_rift',
      ABYSSAL_RIFT_VFX_FULL_SPEC,
      1,
      13,
      -7,
      0x5d24a8,
      0,
      0,
    );
    expect(h.burst).not.toHaveBeenCalled();
  });

  it('wires the persistent singularity beside the pooled premium impact', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toContain("ev.ability === 'abyssal_rift' && ev.fx === 'nova'");
    expect(renderer).toContain('this.abyssalRiftFx.spawn({');
    expect(
      renderer.match(/this\.abyssalRiftFx\.update\(dt, this\.reducedMotion\(\)\);/g),
    ).toHaveLength(2);
    expect(renderer).toContain('this.abilityVfx.handleSpellfxAt(ev)');
  });
});
