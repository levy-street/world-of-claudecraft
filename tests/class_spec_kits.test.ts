import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

const KITS = [
  {
    spec: 'beast_mastery',
    owns: ['pack_command', 'bestial_wrath'],
    excludes: [
      'measured_shot',
      'aimed_shot',
      'rapid_fire',
      'cold_focus',
      'bloodhook',
      'raptor_strike',
      'mongoose_bite',
      'shrapnel_charge',
      'bloodtrail_assault',
    ],
  },
  {
    spec: 'marksmanship',
    owns: ['measured_shot', 'aimed_shot', 'rapid_fire', 'cold_focus'],
    excludes: [
      'pack_command',
      'bestial_wrath',
      'bloodhook',
      'raptor_strike',
      'mongoose_bite',
      'shrapnel_charge',
      'bloodtrail_assault',
    ],
  },
  {
    spec: 'survival',
    owns: [
      'bloodhook',
      'raptor_strike',
      'mongoose_bite',
      'shrapnel_charge',
      'bloodtrail_assault',
      'hunting_momentum',
      'fieldcraft_reentry',
    ],
    excludes: [
      'pack_command',
      'bestial_wrath',
      'measured_shot',
      'aimed_shot',
      'rapid_fire',
      'cold_focus',
    ],
  },
] as const;

const SHARED = [
  'arcane_shot',
  'concussive_shot',
  'wing_clip',
  'counter_shot',
  'trailbreak',
  'shellskin',
  'wildheart',
  'frostjaw_trap',
] as const;

function knownFor(spec: string, level = 20): Set<string> {
  const sim = new Sim({ seed: 2900, playerClass: 'hunter', autoEquip: false });
  sim.setPlayerLevel(level);
  expect(sim.setSpec(spec)).toBe(true);
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('missing Hunter metadata');
  return new Set(meta.known.map((entry) => entry.def.id));
}

describe('Hunter v0.29 spec action ownership', () => {
  for (const kit of KITS) {
    it(`${kit.spec} knows only its exclusive rotation and the shared kit`, () => {
      const known = knownFor(kit.spec);
      for (const abilityId of kit.owns) expect(known, `${abilityId} owned`).toContain(abilityId);
      for (const abilityId of kit.excludes)
        expect(known, `${abilityId} excluded`).not.toContain(abilityId);
      for (const abilityId of SHARED) expect(known, `${abilityId} shared`).toContain(abilityId);
    });
  }

  it('keeps Gutting Strike before spec unlock and hands it to Fieldcraft at level 5', () => {
    const preSpec = new Sim({ seed: 2901, playerClass: 'hunter', autoEquip: false });
    preSpec.setPlayerLevel(4);
    const preSpecMeta = preSpec.players.get(preSpec.playerId);
    if (!preSpecMeta) throw new Error('missing pre-spec Hunter metadata');
    expect(preSpecMeta.known.map((entry) => entry.def.id)).toContain('raptor_strike');

    expect(knownFor('beast_mastery', 5)).not.toContain('raptor_strike');
    expect(knownFor('marksmanship', 5)).not.toContain('raptor_strike');
    expect(knownFor('survival', 5)).toContain('raptor_strike');
  });

  it('shows Fieldcraft mechanics as passives and uses 15 second movement cooldowns', () => {
    const sim = new Sim({ seed: 2903, playerClass: 'hunter', autoEquip: false });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('survival')).toBe(true);

    expect(sim.resolvedAbility('hunting_momentum')?.def.passive).toBe(true);
    expect(sim.resolvedAbility('fieldcraft_reentry')?.def.passive).toBe(true);
    expect(sim.resolvedAbility('bloodhook')?.cooldown).toBe(15);
    expect(sim.resolvedAbility('trailbreak')?.cooldown).toBe(15);
  });

  it('re-specializing drops the old exclusive kit and keeps shared actions', () => {
    const sim = new Sim({ seed: 2902, playerClass: 'hunter', autoEquip: false });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('beast_mastery')).toBe(true);
    expect(sim.resolvedAbility('pack_command')).not.toBeNull();

    expect(sim.setSpec('marksmanship')).toBe(true);
    expect(sim.resolvedAbility('pack_command')).toBeNull();
    expect(sim.resolvedAbility('measured_shot')).not.toBeNull();
    expect(sim.resolvedAbility('counter_shot')).not.toBeNull();
  });
});
