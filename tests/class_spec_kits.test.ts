import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import {
  computeTalentModifiers,
  emptyAllocation,
  type TalentAllocation,
} from '../src/sim/content/talents';
import { canDualWield, canDualWieldTwoHand } from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';
import { loadoutKnownAbilityIds } from '../src/ui/hud/action_bar/hotbar';

type ShamanSpec = 'elemental' | 'enhancement' | 'restoration';

const SHAMAN_SPECS: readonly ShamanSpec[] = ['elemental', 'enhancement', 'restoration'];

function allocation(spec: ShamanSpec): TalentAllocation {
  return { ...emptyAllocation(), spec };
}

function knownAt(spec: ShamanSpec, level: number): Set<string> {
  const alloc = allocation(spec);
  const mods = computeTalentModifiers('shaman', alloc, level);
  return new Set(abilitiesKnownAt('shaman', level, mods).map((known) => known.def.id));
}

const EXCLUSIVE_KITS: Readonly<Record<ShamanSpec, readonly string[]>> = {
  elemental: ['flametongue_weapon', 'earthquake', 'elemental_mastery'],
  enhancement: ['galeheart_weapon', 'rockbiter_weapon', 'stormstrike'],
  restoration: ['lifespring_weapon', 'tidecall', 'chain_heal'],
};

const SHARED_BACKBONE = [
  'lightning_bolt',
  'healing_wave',
  'earth_shock',
  'flame_shock',
  'frost_shock',
  'lightning_shield',
  'ghost_wolf',
] as const;

describe('Shaman v0.28 specialization ownership', () => {
  it('grants each exclusive action only to its owning specialization', () => {
    for (const owner of SHAMAN_SPECS) {
      const ownerKnown = knownAt(owner, 20);
      for (const abilityId of EXCLUSIVE_KITS[owner]) {
        expect(ownerKnown.has(abilityId), `${owner} should know ${abilityId}`).toBe(true);
        for (const other of SHAMAN_SPECS) {
          if (other === owner) continue;
          expect(
            knownAt(other, 20).has(abilityId),
            `${other} should not know ${owner} action ${abilityId}`,
          ).toBe(false);
        }
      }
    }
  });

  it('keeps the shared Shaman backbone available to every specialization', () => {
    for (const spec of SHAMAN_SPECS) {
      const known = knownAt(spec, 20);
      for (const abilityId of SHARED_BACKBONE) {
        expect(known.has(abilityId), `${spec} should keep ${abilityId}`).toBe(true);
      }
    }
  });

  it('keeps Chain Heal as the Spiritmend signature instead of a talent morph', () => {
    expect(knownAt('restoration', 5).has('chain_heal')).toBe(true);
    expect(knownAt('elemental', 20).has('chain_heal')).toBe(false);
    expect(knownAt('enhancement', 20).has('chain_heal')).toBe(false);
  });

  it('unlocks one-handed dual wield only for Warspirit', () => {
    expect(canDualWield('shaman', 'enhancement')).toBe(true);
    expect(canDualWield('shaman', 'elemental')).toBe(false);
    expect(canDualWield('shaman', 'restoration')).toBe(false);
    expect(canDualWieldTwoHand('shaman', 'enhancement')).toBe(false);
  });

  it('hands Stonebound Weapon from the starter kit to Warspirit at level 5', () => {
    for (const spec of SHAMAN_SPECS) {
      expect(knownAt(spec, 4).has('rockbiter_weapon'), `${spec} level 4 starter`).toBe(true);
    }
    expect(knownAt('elemental', 5).has('rockbiter_weapon')).toBe(false);
    expect(knownAt('enhancement', 5).has('rockbiter_weapon')).toBe(true);
    expect(knownAt('restoration', 5).has('rockbiter_weapon')).toBe(false);
  });

  it('retires Rimebound Weapon from acquisition without deleting its shipped id', () => {
    expect(ABILITIES.frostbrand_weapon).toBeDefined();
    for (const spec of SHAMAN_SPECS) {
      expect(knownAt(spec, 20).has('frostbrand_weapon'), `${spec} Rimebound`).toBe(false);
    }
  });

  it('makes Storm Chorus baseline at level 20 for every specialization', () => {
    for (const spec of SHAMAN_SPECS) {
      expect(knownAt(spec, 19).has('bloodlust'), `${spec} before level 20`).toBe(false);
      expect(knownAt(spec, 20).has('bloodlust'), `${spec} at level 20`).toBe(true);
    }
  });

  it('rejects forged wrong-spec casts on the authoritative Sim', () => {
    const sim = new Sim({ seed: 2800, playerClass: 'shaman', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('restoration')).toBe(true);
    sim.player.resource = sim.player.maxResource;
    sim.events = [];

    sim.castAbility('galeheart_weapon');

    expect(sim.player.auras.some((aura) => aura.id === 'galeheart_weapon')).toBe(false);
    expect(sim.events).toContainEqual({
      type: 'error',
      text: 'You do not know that ability.',
      pid: sim.playerId,
    });
  });

  it('excludes foreign enhancements and actions from saved-loadout hotbar eligibility', () => {
    for (const spec of SHAMAN_SPECS) {
      const eligible = loadoutKnownAbilityIds('shaman', allocation(spec), 20);
      for (const owner of SHAMAN_SPECS) {
        for (const abilityId of EXCLUSIVE_KITS[owner]) {
          expect(
            eligible.has(abilityId),
            `${spec} hotbar eligibility for ${owner} action ${abilityId}`,
          ).toBe(owner === spec);
        }
      }
    }
  });
});
