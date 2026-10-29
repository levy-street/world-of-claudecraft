import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import {
  computeTalentModifiers,
  emptyAllocation,
  type TalentAllocation,
} from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { loadoutKnownAbilityIds, syncHotbarActions } from '../src/ui/hud/action_bar/hotbar';

type HunterSpec = 'beast_mastery' | 'marksmanship' | 'survival';

const HUNTER_SPECS: readonly HunterSpec[] = ['beast_mastery', 'marksmanship', 'survival'];

const EXCLUSIVE_KITS: Readonly<Record<HunterSpec, readonly string[]>> = {
  beast_mastery: ['pack_command', 'bestial_wrath'],
  marksmanship: ['measured_shot', 'aimed_shot', 'rapid_fire', 'cold_focus'],
  survival: [
    'raptor_strike',
    'mongoose_bite',
    'shrapnel_charge',
    'bloodtrail_assault',
    'bloodhook',
  ],
};

function allocation(spec: HunterSpec): TalentAllocation {
  return { ...emptyAllocation(), spec };
}

function knownAt(spec: HunterSpec): Set<string> {
  const mods = computeTalentModifiers('hunter', allocation(spec), 20);
  return new Set(abilitiesKnownAt('hunter', 20, mods).map(({ def }) => def.id));
}

describe('Hunter v0.29 specialization ownership', () => {
  it('grants each exclusive action only to its owning specialization', () => {
    for (const owner of HUNTER_SPECS) {
      for (const abilityId of EXCLUSIVE_KITS[owner]) {
        for (const spec of HUNTER_SPECS) {
          expect(
            knownAt(spec).has(abilityId),
            `${spec} ownership of ${owner} action ${abilityId}`,
          ).toBe(spec === owner);
        }
      }
    }
  });

  it('removes foreign actions from saved bars and loadout eligibility', () => {
    for (const spec of HUNTER_SPECS) {
      const known = loadoutKnownAbilityIds('hunter', allocation(spec), 20);
      const foreign = HUNTER_SPECS.find((candidate) => candidate !== spec);
      if (!foreign) throw new Error(`missing foreign spec for ${spec}`);
      const foreignAction = EXCLUSIVE_KITS[foreign][0];
      const ownAction = EXCLUSIVE_KITS[spec][0];
      expect(known.has(foreignAction), `${spec} loadout should reject ${foreignAction}`).toBe(
        false,
      );
      expect(
        syncHotbarActions(
          [
            { type: 'ability', id: foreignAction },
            { type: 'ability', id: ownAction },
          ],
          [...known],
          new Set(),
        ).actions,
      ).toEqual([null, { type: 'ability', id: ownAction }]);
    }
  });

  it('rejects a forged wrong-spec signature on the authoritative Sim', () => {
    const sim = new Sim({ seed: 2962, playerClass: 'hunter', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('marksmanship')).toBe(true);
    const resourceBefore = sim.player.resource;

    sim.castAbility('bloodhook');

    expect(sim.player.resource).toBe(resourceBefore);
    expect(sim.player.cooldowns.has('bloodhook')).toBe(false);
    expect(sim.player.chargeTargetId).toBeNull();
    expect(sim.events).toContainEqual({
      type: 'error',
      text: 'You do not know that ability.',
      pid: sim.playerId,
    });
  });
});
