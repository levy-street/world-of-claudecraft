import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { AbilityVfx, type TrinketRelicsHook } from '../src/render/ability_vfx/painter';
import { abilityVfxFullSpec, abilityVfxSpec } from '../src/render/ability_vfx_registry';
import {
  TRINKET_VFX_FULL_SPECS,
  TRINKET_VFX_SPECS,
  trinketCueReadsAsSelfCast,
} from '../src/render/trinket_vfx_specs';
import { ABILITIES } from '../src/sim/data';

// The display ids the sim stamps on its trinket cues, read from the emitter
// source so a new trinket cue without a visual fails here.
const SIM_SOURCE = readFileSync(new URL('../src/sim/combat/trinkets.ts', import.meta.url), 'utf8');
const EMITTED_IDS = [...new Set([...SIM_SOURCE.matchAll(/'(trinket_[a-z_]+)'/g)].map((m) => m[1]))]
  .filter((id) => !id.endsWith('_icd'))
  .sort();

const SELF_CUES = [
  'trinket_bastion_sigil',
  'trinket_last_bastion',
  'trinket_mooring_stone',
  'trinket_menders_hourglass',
  'trinket_paired_talons',
  'trinket_echoing_lens',
  'trinket_gamblers_die',
  'trinket_wayfarers_lodestone',
  'trinket_medallion_of_defiance',
  'trinket_forgefathers_temper',
  'trinket_kindling_orb',
  'trinket_molten_fletching',
] as const;

function harness(admit = true, trinketRelics?: TrinketRelicsHook) {
  const sequenceInstant = vi.fn();
  const sequenceBolt = vi.fn();
  const sequenceInstantAt = vi.fn();
  const spawnAoeRing = vi.fn();
  const lightningProjectile = vi.fn();
  const nova = vi.fn();
  const fx = {
    setDelegates: vi.fn(),
    sequenceInstant,
    sequenceInstantAt,
    sequenceBolt,
    update: vi.fn(),
    setQuality: vi.fn(),
    jaggedBolt: vi.fn(),
    windup: vi.fn(() => true),
    warmSpiritsForClass: vi.fn(),
    bodyGlow: vi.fn(),
    groundYAt: vi.fn(() => 0),
  } as unknown as AbilityVfxFx;
  const painter = new AbilityVfx(
    {
      fx,
      vfx: {
        projectile: vi.fn(),
        lightningProjectile,
        burst: vi.fn(),
        nova,
        tick: vi.fn(),
        shoutwave: vi.fn(),
        buffSwirl: vi.fn(),
        beam: vi.fn(),
      },
      anchor: () => ({ x: 0, y: 1, z: 0 }),
      spawnAoeRing,
      triggerAttack: vi.fn(),
      localPlayerId: () => 1,
      castVfxAdmit: () => admit,
      trinketRelics,
    },
    () => 0,
  );
  return {
    painter,
    sequenceInstant,
    sequenceInstantAt,
    sequenceBolt,
    spawnAoeRing,
    lightningProjectile,
    nova,
  };
}

describe('trinket VFX specs', () => {
  it('gives every sim trinket cue id its own authored spec through the registry', () => {
    expect(EMITTED_IDS).toHaveLength(21);
    expect(Object.keys(TRINKET_VFX_SPECS).sort()).toEqual(EMITTED_IDS);
    for (const id of EMITTED_IDS) {
      const spec = abilityVfxSpec(id);
      const full = abilityVfxFullSpec(id);
      expect(spec, id).toBe(TRINKET_VFX_SPECS[id]);
      expect(full, id).toBe(TRINKET_VFX_FULL_SPECS[id]);
      expect(spec?.a, id).toBe(full?.archetype);
      expect(spec?.p, id).toBe(full?.palette);
      expect(spec?.c, id).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('never shadows a class ability id', () => {
    for (const id of Object.keys(TRINKET_VFX_SPECS)) expect(ABILITIES[id], id).toBeUndefined();
  });

  it('gives each trinket a distinct identity (no two share color and archetype)', () => {
    const keys = Object.values(TRINKET_VFX_SPECS).map((s) => `${s.c}:${s.a}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('mints no GPU resource: the module is pure spec data over the pooled primitives', () => {
    const src = readFileSync(
      new URL('../src/render/trinket_vfx_specs.ts', import.meta.url),
      'utf8',
    );
    expect(src).not.toMatch(/from 'three'/);
    expect(src).not.toMatch(/Material|new THREE/);
    const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['./ability_vfx_core']);
  });
});

describe('trinket VFX routing through the ability painter', () => {
  it.each(SELF_CUES)('claims the %s selfCast ceremony on the wearer', (ability) => {
    const h = harness();
    expect(
      h.painter.handleSpellfx({
        sourceId: 1,
        targetId: 1,
        school: 'holy',
        fx: 'selfCast',
        ability,
      }),
    ).toBe(true);
    expect(h.sequenceInstant).toHaveBeenCalledTimes(1);
    expect(h.sequenceInstant.mock.calls[0].slice(0, 4)).toEqual([
      ability,
      TRINKET_VFX_FULL_SPECS[ability],
      1,
      1,
    ]);
  });

  it.each(['trinket_hunters_tally', 'trinket_duelists_brand'] as const)(
    'reads the %s dotApply cue as the targeted utility, landing on the victim',
    (ability) => {
      const h = harness();
      expect(
        h.painter.handleSpellfx({
          sourceId: 1,
          targetId: 9,
          school: 'shadow',
          fx: 'dotApply',
          ability,
        }),
      ).toBe(true);
      expect(h.sequenceInstant).toHaveBeenCalledTimes(1);
      expect(h.sequenceInstant.mock.calls[0].slice(0, 4)).toEqual([
        ability,
        TRINKET_VFX_FULL_SPECS[ability],
        1,
        9,
      ]);
      // the generic school nova the renderer would otherwise pop never runs
      expect(h.nova).not.toHaveBeenCalled();
    },
  );

  it('leaves dotApply on a non-trinket ability unclaimed', () => {
    expect(trinketCueReadsAsSelfCast('corruption', 'dotApply')).toBe(false);
    expect(trinketCueReadsAsSelfCast('trinket_hunters_tally', 'nova')).toBe(false);
  });

  it('draws the Sundered Prism departure but never claims the blinkStep snap', () => {
    const h = harness();
    expect(
      h.painter.handleSpellfx({
        sourceId: 1,
        targetId: 1,
        school: 'arcane',
        fx: 'blinkStep',
        ability: 'trinket_sundered_prism',
      }),
    ).toBe(false);
    expect(h.sequenceInstant).toHaveBeenCalledTimes(1);
    expect(h.sequenceInstant.mock.calls[0][0]).toBe('trinket_sundered_prism');
  });

  it('keeps the blinkStep unclaimed and undrawn behind a closed cast gate', () => {
    const h = harness(false);
    expect(
      h.painter.handleSpellfx({
        sourceId: 1,
        targetId: 1,
        school: 'arcane',
        fx: 'blinkStep',
        ability: 'trinket_sundered_prism',
      }),
    ).toBe(false);
    expect(h.sequenceInstant).not.toHaveBeenCalled();
  });

  it('arcs each Stormjar jump as its own lightning link between the two enemies', () => {
    const h = harness();
    expect(
      h.painter.handleSpellfx({
        sourceId: 4,
        targetId: 5,
        school: 'nature',
        fx: 'lightning',
        ability: 'trinket_stormjar',
      }),
    ).toBe(true);
    expect(h.lightningProjectile).toHaveBeenCalledWith(4, 5, 0x9fd2ff);
    expect(h.sequenceInstant.mock.calls[0].slice(0, 4)).toEqual([
      'trinket_stormjar',
      TRINKET_VFX_FULL_SPECS.trinket_stormjar,
      4,
      5,
    ]);
  });

  it.each([true, false])(
    'draws the Wellspring Seed area ring at the exact sim radius (cast gate open: %s)',
    (admit) => {
      const h = harness(admit);
      expect(
        h.painter.handleSpellfxAt({
          sourceId: 1,
          x: 12,
          z: -4,
          radius: 10,
          school: 'nature',
          fx: 'nova',
          ability: 'trinket_wellspring_seed',
        }),
      ).toBe(true);
      expect(h.spawnAoeRing).toHaveBeenCalledWith(12, -4, 10, 'nature', 0x46c6a4);
      if (admit) {
        expect(h.sequenceInstantAt.mock.calls[0].slice(0, 5)).toEqual([
          'trinket_wellspring_seed',
          TRINKET_VFX_FULL_SPECS.trinket_wellspring_seed,
          1,
          12,
          -4,
        ]);
      } else {
        expect(h.sequenceInstantAt).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    ['trinket_heart_of_the_crucible', 10, 0xff4a12],
    ['trinket_last_flame_lantern', 12, 0xffc861],
  ] as const)(
    'draws the %s area ring at the exact sim radius on a cold gate too',
    (ability, radius, color) => {
      for (const admit of [true, false]) {
        const h = harness(admit);
        expect(
          h.painter.handleSpellfxAt({
            sourceId: 1,
            x: 3,
            z: 4,
            radius,
            school: 'fire',
            fx: 'nova',
            ability,
          }),
        ).toBe(true);
        expect(h.spawnAoeRing).toHaveBeenCalledWith(3, 4, radius, 'fire', color);
      }
    },
  );

  it.each(['trinket_kindling_orb_bolt', 'trinket_last_flame_lantern_splash'] as const)(
    'flies the %s projectile cue as its own authored bolt between the two bodies',
    (ability) => {
      const h = harness();
      expect(
        h.painter.handleSpellfx({
          sourceId: 1,
          targetId: 7,
          school: 'fire',
          fx: 'projectile',
          ability,
        }),
      ).toBe(true);
      expect(h.sequenceBolt).toHaveBeenCalledTimes(1);
      expect(h.sequenceBolt.mock.calls[0].slice(0, 4)).toEqual([
        ability,
        TRINKET_VFX_FULL_SPECS[ability],
        1,
        7,
      ]);
    },
  );
});

describe('trinket relic hook in the ability painter', () => {
  function relics(claims: boolean) {
    return {
      handleSpellfx: vi.fn<TrinketRelicsHook['handleSpellfx']>(() => claims),
      update: vi.fn(),
      setQuality: vi.fn(),
    } satisfies TrinketRelicsHook;
  }

  it('lets the relics claim the Kindling bolt leaving a live orb, so no second bolt flies', () => {
    const hook = relics(true);
    const h = harness(true, hook);
    const ev = {
      sourceId: 1,
      targetId: 7,
      school: 'fire',
      fx: 'projectile',
      ability: 'trinket_kindling_orb_bolt',
    };
    expect(h.painter.handleSpellfx(ev)).toBe(true);
    expect(hook.handleSpellfx).toHaveBeenCalledWith(ev, true);
    expect(h.sequenceBolt).not.toHaveBeenCalled();
  });

  it('still plays the authored ceremony when the relics only observe the cue', () => {
    const hook = relics(false);
    const h = harness(true, hook);
    expect(
      h.painter.handleSpellfx({
        sourceId: 1,
        targetId: 1,
        school: 'fire',
        fx: 'selfCast',
        ability: 'trinket_forgefathers_temper',
      }),
    ).toBe(true);
    expect(hook.handleSpellfx).toHaveBeenCalledTimes(1);
    expect(h.sequenceInstant.mock.calls[0][0]).toBe('trinket_forgefathers_temper');
  });

  it('hands the relics the closed cast gate and never offers them a class ability', () => {
    const hook = relics(false);
    const h = harness(false, hook);
    h.painter.handleSpellfx({
      sourceId: 1,
      targetId: 7,
      school: 'fire',
      fx: 'projectile',
      ability: 'trinket_kindling_orb_bolt',
    });
    expect(hook.handleSpellfx.mock.calls[0][1]).toBe(false);
    h.painter.handleSpellfx({
      sourceId: 1,
      targetId: 7,
      school: 'fire',
      fx: 'projectile',
      ability: 'fireball',
    });
    expect(hook.handleSpellfx).toHaveBeenCalledTimes(1);
  });

  it('ticks and tiers the relics with the painter', () => {
    const hook = relics(false);
    const h = harness(true, hook);
    h.painter.update(0.05, true);
    expect(hook.update).toHaveBeenCalledWith(0.05, true);
    h.painter.setQuality(0.25);
    expect(hook.setQuality).toHaveBeenCalledWith(0.25);
  });
});
