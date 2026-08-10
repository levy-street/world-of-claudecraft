import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import {
  auraIconCssBackground,
  createAuraIconResolver,
  RUNTIME_AURA_ICON_SOURCE_IDS,
  resolveAuraIconId,
} from '../src/ui/aura_icon_view';
import { abilityImageUrl, hasAbilityIconIdentity, hasAuraRecipe } from '../src/ui/icons';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const GENERATED_ABILITY_AURAS = [
  ['arcane_power_buff_spellhaste', 'arcane_power'],
  ['avenging_wrath_buff_spellpower', 'avenging_wrath'],
  ['deterrence_buff_dr', 'deterrence'],
  ['hemorrhage_bleed_vuln', 'hemorrhage'],
  ['icy_veins_cast_shield', 'icy_veins'],
  ['metamorphosis_buff_spelldmg', 'metamorphosis'],
  ['metamorphosis_buff_spellhaste', 'metamorphosis'],
  ['aspect_of_the_wild_ap', 'aspect_of_the_wild'],
  ['demoralizing_roar_ap', 'demoralizing_roar'],
  ['demoralizing_shout_ap', 'demoralizing_shout'],
  ['trueshot_aura_ap', 'trueshot_aura'],
  ['thunder_clap_as', 'thunder_clap'],
  ['emboldening_roar_crit', 'emboldening_roar'],
  ['typhoon_daze', 'typhoon'],
  ['rallying_cry_dr', 'rallying_cry'],
  ['frost_trap_freeze', 'frost_trap'],
  ['rallying_cry_hp', 'rallying_cry'],
  ['blind_incap', 'blind'],
  ['death_coil_incap', 'death_coil'],
  ['dragons_breath_incap', 'dragons_breath'],
  ['gouge_incap', 'gouge'],
  ['hibernate_incap', 'hibernate'],
  ['sap_incap', 'sap'],
  ['startle_shot_incap', 'startle_shot'],
  ['wyvern_sting_incap', 'wyvern_sting'],
  ['counter_shot_lockout', 'counter_shot'],
  ['counterspell_lockout', 'counterspell'],
  ['kick_lockout', 'kick'],
  ['pummel_lockout', 'pummel'],
  ['rebuke_lockout', 'rebuke'],
  ['skull_bash_lockout', 'skull_bash'],
  ['spell_lock_lockout', 'spell_lock'],
  ['bestial_wrath_pet', 'bestial_wrath'],
  ['metamorphosis_pet', 'metamorphosis'],
  ['metamorphosis_pet_pet_spellhaste', 'metamorphosis'],
  ['earthbind_root', 'earthbind'],
  ['entangling_roots_root', 'entangling_roots'],
  ['frost_nova_root', 'frost_nova'],
  ['glacial_front_root', 'glacial_front'],
  ['glacial_spike_root', 'glacial_spike'],
  ['rings_of_frost_root', 'rings_of_frost'],
  ['aura_surge_silence', 'aura_surge'],
  ['silence_silence', 'silence'],
  ['concussive_shot_slow', 'concussive_shot'],
  ['crippling_poison_slow', 'crippling_poison'],
  ['curse_of_exhaustion_slow', 'curse_of_exhaustion'],
  ['frost_shock_slow', 'frost_shock'],
  ['frostbolt_slow', 'frostbolt'],
  ['glacial_front_slow', 'glacial_front'],
  ['hamstring_slow', 'hamstring'],
  ['piercing_howl_slow', 'piercing_howl'],
  ['wing_clip_slow', 'wing_clip'],
  ['bloodlust_spell', 'bloodlust'],
  ['temporal_acceleration_spell', 'temporal_acceleration'],
  ['bash_stun', 'bash'],
  ['bear_charge_stun', 'bear_charge'],
  ['charge_stun', 'charge'],
  ['cheap_shot_stun', 'cheap_shot'],
  ['deep_freeze_stun', 'deep_freeze'],
  ['faultline_stun', 'faultline'],
  ['hammer_of_justice_stun', 'hammer_of_justice'],
  ['kidney_shot_stun', 'kidney_shot'],
  ['pounce_stun', 'pounce'],
  ['sport_shoulder_stun', 'sport_shoulder'],
  ['storm_bolt_stun', 'storm_bolt'],
] as const;

const SOURCE_DERIVED_AURAS = [
  ['aether_surge_free', 'arcane_surge'],
  ['blizzard_slow', 'blizzard'],
  ['frozen_orb_slow', 'frozen_orb'],
  ['greater_invisibility_dr', 'greater_invisibility'],
  ['raised_guard_dr', 'raised_guard'],
  ['breachmaker_vuln', 'breachmaker'],
  ['hot_streak_instant', 'hot_streak'],
  ['revenge_free', 'revenge'],
] as const;

const NON_CHOICE_RUNTIME_AURA_SOURCES = [
  ['aether_surge_free', 'arcane_surge'],
  ['feral_instinct_energy', 'feral_charge'],
  ['fury_enrage', 'enrage_passive'],
  ['ignite', 'ignition'],
  ['natures_fury', 'hurricane'],
] as const;

const AURA_RESPONSE_KINDS = new Set(['empowerNext', 'absorb', 'aura', 'echo']);

describe('resolveAuraIconId', () => {
  const resolve = (id: string, kind = 'buff'): string =>
    resolveAuraIconId({ id, kind }, hasAbilityIconIdentity, hasAuraRecipe);

  it('keeps exact ability, modifier-art, and dedicated aura identities intact', () => {
    expect(resolve('moonfire', 'dot')).toBe('moonfire');
    expect(resolve('bg_sprint_rune', 'buff_speed')).toBe('bg_sprint_rune');
    for (const id of ['bloodbath', 'elemental_convergence', 'pursuit']) {
      expect(hasAbilityIconIdentity(id), `${id} fixture`).toBe(true);
      expect(resolve(id), id).toBe(id);
    }
  });

  it('recovers all unambiguous generated ability identities', () => {
    expect(GENERATED_ABILITY_AURAS).toHaveLength(65);
    for (const [id, expected] of [...GENERATED_ABILITY_AURAS, ...SOURCE_DERIVED_AURAS]) {
      expect(resolve(id), id).toBe(expected);
    }
  });

  it('maps every aura-producing choice proc and exact non-choice producer to painted art', () => {
    const choiceSources: [string, string][] = [];
    for (const tree of Object.values(CHOICE_ROWS)) {
      for (const row of tree.rows) {
        for (const option of row.options) {
          const proc = option.effect.proc;
          if (!proc?.responses.some((response) => AURA_RESPONSE_KINDS.has(response.kind))) {
            continue;
          }
          expect(option.icon, `${option.id} painted proc source`).toBeDefined();
          choiceSources.push([proc.id, option.icon ?? '']);
        }
      }
    }

    expect(choiceSources).toHaveLength(37);
    expect(new Set(choiceSources.map(([id]) => id)).size).toBe(choiceSources.length);
    const expected = new Map<string, string>([
      ...choiceSources,
      ...NON_CHOICE_RUNTIME_AURA_SOURCES,
    ]);
    expect([...RUNTIME_AURA_ICON_SOURCE_IDS.entries()].sort()).toEqual(
      [...expected.entries()].sort(),
    );
    expect(RUNTIME_AURA_ICON_SOURCE_IDS.size).toBe(42);
    for (const [id, source] of expected) {
      const imageUrl = abilityImageUrl(source);
      expect(imageUrl, `${id} -> ${source} static painted source`).toMatch(
        /^\/ui\/skills\/[a-z]+\/[a-z0-9_]+\.webp$/,
      );
      expect(
        existsSync(path.join(repoRoot, 'public', (imageUrl as string).slice(1))),
        `${id} -> ${source} shipped WebP`,
      ).toBe(true);
      expect(resolve(id), id).toBe(source);
    }
  });

  it('recovers painted modifier identities from generated timer suffixes', () => {
    for (const [id, expected] of [
      ['battle_rhythm_rage', 'battle_rhythm'],
      ['colossal_might_cap', 'colossal_might'],
      ['overflowing_power_cap', 'overflowing_power'],
    ] as const) {
      expect(hasAbilityIconIdentity(expected), `${expected} fixture`).toBe(true);
      expect(resolve(id), id).toBe(expected);
    }
  });

  it('supports nested and dormant generated suffix grammar without blind prefix walking', () => {
    const known = new Set(['source_ability']);
    const probe = (id: string): boolean => known.has(id);
    expect(
      resolveAuraIconId(
        { id: 'source_ability_pet_pet_spellhaste', kind: 'buff_spellhaste' },
        probe,
        () => false,
      ),
    ).toBe('source_ability');
    expect(
      resolveAuraIconId({ id: 'source_ability_absorb', kind: 'absorb' }, probe, () => false),
    ).toBe('source_ability');
    expect(
      resolveAuraIconId({ id: 'source_ability_dmg', kind: 'buff_dmg_done' }, probe, () => false),
    ).toBe('source_ability');
  });

  it('leaves shared fear and mob-authored prefix IDs on their generic identities', () => {
    expect(resolve('fear_incap', 'incapacitate')).toBe('aura_incapacitate');
    expect(resolve('blind_willow_sprite', 'blind')).toBe('aura_blind');
    expect(resolve('silence_abyssal_horror', 'silence')).toBe('aura_silence');
  });

  it('falls back to the generic aura-kind identity when no authored identity exists', () => {
    expect(resolve('unknown_runtime_aura', 'buff_ap_pct')).toBe('aura_buff_ap_pct');
    for (const hostile of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(resolve(hostile, 'buff'), hostile).toBe('aura_buff');
    }
  });

  it('caches stable wire identities before they return to the frame path', () => {
    let abilityProbes = 0;
    let auraProbes = 0;
    const cached = createAuraIconResolver(
      (id) => {
        abilityProbes++;
        return id === 'painted_source';
      },
      () => {
        auraProbes++;
        return false;
      },
    );

    expect(cached({ id: 'painted_source_ap', kind: 'buff_ap' })).toBe('painted_source');
    const firstCounts = [abilityProbes, auraProbes];
    for (let frame = 0; frame < 120; frame++) {
      expect(cached({ id: 'painted_source_ap', kind: 'buff_ap' })).toBe('painted_source');
    }
    expect([abilityProbes, auraProbes]).toEqual(firstCounts);

    // A server changing the kind for the same id must recompute the generic
    // identity instead of returning the stale kind-specific fallback.
    expect(cached({ id: 'unknown', kind: 'blind' })).toBe('aura_blind');
    expect(cached({ id: 'unknown', kind: 'silence' })).toBe('aura_silence');
  });

  it('bounds the frame-path identity cache and evicts the oldest wire id first', () => {
    let probes = 0;
    const cached = createAuraIconResolver(
      () => {
        probes++;
        return false;
      },
      () => {
        probes++;
        return false;
      },
    );
    for (let index = 0; index <= 256; index++) {
      cached({ id: `server_aura_${index}`, kind: 'buff' });
    }
    const afterFill = probes;
    cached({ id: 'server_aura_1', kind: 'buff' });
    expect(probes, 'a retained identity must stay cache-hot').toBe(afterFill);
    cached({ id: 'server_aura_0', kind: 'buff' });
    expect(probes, 'the oldest identity must be recomputed after the 257th insert').toBeGreaterThan(
      afterFill,
    );
  });

  it('layers painted art over warmed fallback without synchronously composing on cold caches', () => {
    let demandCalls = 0;
    expect(
      auraIconCssBackground(
        'counter_shot',
        (id) => `/ui/skills/hunter/${id}.webp`,
        () => 'data:image/png;base64,fallback',
        '/ui/crests/status/combat.webp',
        () => {
          demandCalls++;
          return 'data:image/png;base64,demand';
        },
      ),
    ).toBe('url(/ui/skills/hunter/counter_shot.webp), url(data:image/png;base64,fallback)');
    expect(
      auraIconCssBackground(
        'counter_shot',
        (id) => `/ui/skills/hunter/${id}.webp`,
        () => null,
        '/ui/crests/status/combat.webp',
        () => {
          demandCalls++;
          return 'data:image/png;base64,demand';
        },
      ),
    ).toBe('url(/ui/skills/hunter/counter_shot.webp), url(/ui/crests/status/combat.webp)');
    expect(demandCalls).toBe(0);

    expect(
      auraIconCssBackground(
        'aura_lockout',
        () => null,
        () => 'data:image/png;base64,warmed-generic',
        '/ui/crests/status/combat.webp',
        () => {
          demandCalls++;
          return 'data:image/png;base64,demand';
        },
      ),
    ).toBe('url(data:image/png;base64,warmed-generic)');
    expect(demandCalls).toBe(0);

    expect(
      auraIconCssBackground(
        'aura_lockout',
        () => null,
        () => null,
        '/ui/crests/status/combat.webp',
        () => {
          demandCalls++;
          return 'data:image/png;base64,generic';
        },
      ),
    ).toBe('url(data:image/png;base64,generic)');
    expect(demandCalls).toBe(1);
  });

  it('wires the cached identity and layered URL resolvers into every HUD aura surface', () => {
    const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    expect(hud.match(/iconId: resolveHudAuraIconId/g)).toHaveLength(2);
    expect(hud.match(/resolveIconUrl: resolveHudAuraIconUrl/g)).toHaveLength(3);
    expect(hud).toContain("(id) => cachedProceduralIconDataUrl('aura', id)");
    expect(hud).toContain("crestIconUrl('status_combat')");
  });
});
