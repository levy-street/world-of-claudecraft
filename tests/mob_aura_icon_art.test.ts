import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob, createPlayer } from '../src/sim/entity';
import { runMobSwingAffixes } from '../src/sim/mob/mob_swing';
import { petRangedAttack } from '../src/sim/pet/pet_ai';
import type { PendingProjectile } from '../src/sim/projectile_travel';
import type { SimContext } from '../src/sim/sim_context';
import type { Aura, Entity, MobTemplate } from '../src/sim/types';
import { MOB_AURA_IMAGE_IDS, resolveMobAuraIconIdentity } from '../src/ui/mob_aura_icon_art';

type RuntimeId = (templateId: string) => string;

const LIVE_MOB_AURA_FAMILIES: readonly (readonly [
  trait: keyof MobTemplate,
  artIdentity: string,
  runtimeId: RuntimeId,
])[] = [
  ['rampage', 'mob_rampage', (id) => `rampage_${id}`],
  ['wardAllies', 'mob_ward_allies', (id) => `ward_${id}`],
  ['rally', 'mob_rally', (id) => `rally_${id}`],
  ['warcry', 'mob_warcry', (id) => `warcry_${id}`],
  ['stoneskin', 'mob_stoneskin', (id) => `stoneskin_${id}`],
  ['packFrenzy', 'mob_pack_frenzy', () => 'pack_frenzy'],
  ['frenzyOnHit', 'mob_frenzy_on_hit', () => 'blood_frenzy'],
  ['venom', 'mob_venom', (id) => `venom_${id}`],
  ['soulrot', 'mob_soulrot', (id) => `soulrot_${id}`],
  ['bleed', 'mob_bleed', (id) => `bleed_${id}`],
  ['frostbite', 'mob_frostbite', (id) => `frostbite_${id}`],
  ['smolder', 'mob_smolder', (id) => `smolder_${id}`],
  ['cinder', 'mob_cinder', (id) => `cinder_${id}`],
  ['arcaneRot', 'mob_arcane_rot', (id) => `arcaneRot_${id}`],
  ['stackPoison', 'mob_stack_poison', (id) => `stackpoison_${id}`],
  ['mortalStrike', 'mob_mortal_strike', (id) => `mortal_wound_${id}`],
  ['healAbsorb', 'mob_heal_absorb', (id) => `heal_absorb_${id}`],
  ['concuss', 'mob_concuss', (id) => `concuss_${id}`],
  ['expose', 'mob_expose', (id) => `expose_${id}`],
  ['corrode', 'mob_corrode', (id) => `corrode_${id}`],
  ['spellVuln', 'mob_spell_vuln', (id) => `spellvuln_${id}`],
  ['staggerHit', 'mob_stagger_hit', (id) => `stagger_${id}`],
  ['ensnare', 'mob_ensnare', (id) => `ensnare_${id}`],
  ['stunOnHit', 'mob_stun_on_hit', (id) => `stun_${id}`],
  ['slowStrike', 'mob_slow_strike', (id) => `slowstrike_${id}`],
  ['tongues', 'mob_tongues', (id) => `tongues_${id}`],
  ['enfeeble', 'mob_enfeeble', (id) => `enfeeble_${id}`],
  ['enervate', 'mob_enervate', (id) => `enervate_${id}`],
  ['plague', 'mob_plague', (id) => `plague_${id}`],
  ['wither', 'mob_wither', (id) => `wither_${id}`],
  ['polymorphHex', 'mob_polymorph_hex', (id) => `hex_${id}`],
  ['vulnerability', 'mob_vulnerability', (id) => `vulnerability_${id}`],
  ['silence', 'mob_silence', (id) => `silence_${id}`],
  ['blind', 'mob_blind', (id) => `blind_${id}`],
  ['disarm', 'mob_disarm', (id) => `disarm_${id}`],
  ['lockout', 'mob_lockout', (id) => `lockout_${id}`],
  ['costTax', 'mob_cost_tax', (id) => `cost_tax_${id}`],
  ['chillOnHit', 'mob_chill_on_hit', (id) => `${id}_chill`],
  ['demoralize', 'mob_demoralize', () => 'mob_demoralize'],
  ['siphonSpirit', 'mob_siphon_spirit', (id) => `siphon_spirit_${id}`],
  ['hex', 'mob_hex', (id) => `hex_${id}`],
  ['critVuln', 'mob_crit_vuln', (id) => `critvuln_${id}`],
  ['aoeSlow', 'mob_aoe_slow', () => 'aoe_slow'],
  ['charge', 'mob_charge_stun', () => 'mob_charge_stun'],
];

function buildLiveMobAuraCensus(): {
  identities: ReadonlyMap<string, string>;
  carrierCount: number;
  populatedFamilyCount: number;
} {
  const identities = new Map<string, string>();
  let carrierCount = 0;
  let populatedFamilyCount = 0;

  const addIdentity = (runtimeId: string, artIdentity: string): void => {
    const existing = identities.get(runtimeId);
    if (existing && existing !== artIdentity) {
      throw new Error(`${runtimeId} has conflicting mob aura art identities`);
    }
    identities.set(runtimeId, artIdentity);
  };

  for (const [trait, artIdentity, runtimeId] of LIVE_MOB_AURA_FAMILIES) {
    let familyCarrierCount = 0;
    for (const [templateId, template] of Object.entries(MOBS)) {
      if (!template[trait]) continue;
      familyCarrierCount++;
      carrierCount++;
      addIdentity(runtimeId(templateId), artIdentity);
    }
    if (familyCarrierCount > 0) populatedFamilyCount++;
  }

  for (const template of Object.values(MOBS)) {
    if (!template.petRanged?.spellVuln) continue;
    carrierCount++;
    addIdentity('raise_bone_mage', 'mob_spell_vuln');
  }

  return { identities, carrierCount, populatedFamilyCount };
}

function observeSwingAuras(templateId: string): readonly Aura[] {
  const target = createPlayer(9001, 'mage', { x: 0, y: 0, z: 0 }, 'Target');
  const mob = createMob(9002, MOBS[templateId], 20, { x: 0, y: 0, z: 2 });
  const applied: Aura[] = [];
  const ctx = {
    time: 0,
    entities: new Map<number, Entity>(),
    riftInstances: [],
    rng: {
      chance: () => true,
      range: (min: number, max: number) => (min + max) / 2,
    },
    applyAura: (_target: Entity, aura: Aura) => applied.push(aura),
    diminishedCrowdControlDuration: (
      _source: Entity,
      _target: Entity,
      _category: string,
      duration: number,
    ) => duration,
  } as unknown as SimContext;

  runMobSwingAffixes(ctx, mob, target, { dealt: 1, crit: false, rawDmg: 1 });
  return applied;
}

function observeBoneMageAuras(): readonly Aura[] {
  const target = createMob(9010, MOBS.forest_wolf, 20, { x: 0, y: 0, z: 2 });
  const pet = createMob(9011, MOBS.necromancy_bone_mage, 20, { x: 0, y: 0, z: 0 });
  pet.ownerId = 42;
  pet.hostile = false;
  const applied: Aura[] = [];
  const pendingProjectiles: PendingProjectile[] = [];
  const ctx = {
    entities: new Map<number, Entity>(),
    players: new Map(),
    pendingProjectiles,
    rng: {
      chance: () => true,
      range: (min: number, max: number) => (min + max) / 2,
    },
    emit: () => undefined,
    effectiveAttackPower: () => 0,
    dealDamage: () => undefined,
    applyAura: (_target: Entity, aura: Aura) => applied.push(aura),
  } as unknown as SimContext;

  const ranged = MOBS.necromancy_bone_mage.petRanged;
  if (!ranged) throw new Error('Bone Mage fixture lost its ranged producer');
  petRangedAttack(ctx, pet, target, ranged);
  pendingProjectiles[0]?.resolve(pet, target);
  return applied;
}

describe('mob aura icon art', () => {
  it('keeps the closed live mob aura inventory in parity with painted identities', () => {
    const census = buildLiveMobAuraCensus();

    expect(LIVE_MOB_AURA_FAMILIES).toHaveLength(44);
    expect(census.populatedFamilyCount).toBe(44);
    expect(census.carrierCount).toBe(108);
    expect(census.identities.size).toBe(89);
    expect([...MOB_AURA_IMAGE_IDS].sort()).toEqual([...new Set(census.identities.values())].sort());
    expect(MOB_AURA_IMAGE_IDS.size).toBe(44);
    for (const [runtimeId, artIdentity] of census.identities) {
      expect(artIdentity, runtimeId).toMatch(/^mob_[a-z0-9_]+$/);
      expect(resolveMobAuraIconIdentity(runtimeId), runtimeId).toBe(artIdentity);
    }

    expect(resolveMobAuraIconIdentity('aoe_slow')).toBe('mob_aoe_slow');
    expect(resolveMobAuraIconIdentity('mob_charge_stun')).toBe('mob_charge_stun');
  });

  it('observes high-risk runtime ID grammars from the live mob swing producer', () => {
    for (const [templateId, kind, runtimeId, artIdentity] of [
      ['deacon_voss', 'dot', 'arcaneRot_deacon_voss', 'mob_arcane_rot'],
      ['stormcrag_elemental', 'slow', 'stormcrag_elemental_chill', 'mob_chill_on_hit'],
      ['mudfin_murloc', 'polymorph', 'hex_mudfin_murloc', 'mob_polymorph_hex'],
      ['gravecaller_cultist', 'hex', 'hex_gravecaller_cultist', 'mob_hex'],
      ['wyrmcult_zealot', 'buff_int', 'enfeeble_wyrmcult_zealot', 'mob_enfeeble'],
      ['sister_nhalia', 'buff_spi', 'siphon_spirit_sister_nhalia', 'mob_siphon_spirit'],
    ] as const) {
      const aura = observeSwingAuras(templateId).find((candidate) => candidate.kind === kind);
      expect(aura?.id, `${templateId} ${kind} producer`).toBe(runtimeId);
      expect(resolveMobAuraIconIdentity(aura?.id ?? ''), runtimeId).toBe(artIdentity);
    }
  });

  it('observes the Bone Mage spell-vulnerability identity from the live pet producer', () => {
    const auras = observeBoneMageAuras();
    expect(auras.map(({ id, kind }) => [id, kind])).toEqual([['raise_bone_mage', 'spellvuln']]);
    expect(resolveMobAuraIconIdentity(auras[0]?.id ?? '')).toBe('mob_spell_vuln');
  });

  it('rejects arbitrary prefixes, raw traits, case changes, and prototype keys', () => {
    for (const id of [
      'venom_future_boss',
      'blind_willow_sprite',
      'arcaneRot_',
      'mob_future_trait',
      'Venom_duskwisp',
      'venom',
      '__proto__',
      'constructor',
      'toString',
    ]) {
      expect(resolveMobAuraIconIdentity(id), id).toBeNull();
    }
  });
});
