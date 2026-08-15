// Group buffs are ONE per target regardless of caster: a second Hunter's Pack
// Rally replaces the first. The general rule: every aoeAlly group buff must either carry
// Bloodlust-style exhaustion (exhaust: true, the 'sated' debuff blocks a second
// application) or appear in aura_stacking's source-independent dedupe set; the
// guard test at the bottom makes forgetting BOTH a loud CI failure for any
// future group buff.
import { describe, expect, it } from 'vitest';
import {
  auraReplacementConflicts,
  SOURCE_INDEPENDENT_GROUP_BUFF_AURA_IDS,
} from '../src/sim/combat/aura_stacking';
import { runHunterPackRally } from '../src/sim/combat/hunter_shared';
import { ABILITIES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;

describe('Pack Rally never stacks with itself', () => {
  it('a second hunter casting replaces the first copy instead of stacking', () => {
    const sim = new Sim({ seed: 2026, playerClass: 'hunter', noPlayer: true }) as AnySim;
    const a = sim.addPlayer('hunter', 'HunterA');
    const b = sim.addPlayer('hunter', 'HunterB');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    for (const pid of [a, b]) {
      sim.setPlayerLevel(20, pid);
      expect(sim.setSpec('beast_mastery', pid)).toBe(true);
      expect(sim.selectTalentRow(17, 'hun_r17_pack_rally', pid)).toBe(true);
      const p = sim.entities.get(pid) as Entity;
      p.resource = p.maxResource;
      p.inCombat = true;
    }
    const entA = sim.entities.get(a) as Entity;
    const entB = sim.entities.get(b) as Entity;
    entB.pos = { ...entA.pos };

    runHunterPackRally(sim.ctx, entA, 10, 30);
    runHunterPackRally(sim.ctx, entB, 10, 30);

    for (const ent of [entA, entB]) {
      const speed = ent.auras.filter((x) => x.id === 'hunter_pack_rally_speed');
      const attackHaste = ent.auras.filter((x) => x.id === 'hunter_pack_rally_haste');
      const spellHaste = ent.auras.filter((x) => x.id === 'hunter_pack_rally_spellhaste');
      expect(speed, 'one speed copy').toHaveLength(1);
      expect(attackHaste, 'one attack haste copy').toHaveLength(1);
      expect(spellHaste, 'one spell haste copy').toHaveLength(1);
      // The later cast owns the surviving copy.
      expect(speed[0].sourceId).toBe(b);
      expect(attackHaste[0].sourceId).toBe(b);
      expect(spellHaste[0].sourceId).toBe(b);
    }
  });
});

describe('Emboldening Roar never stacks its crit buff with itself', () => {
  it('two Fury warriors casting on an overlapping ally leave exactly one 3-charge copy', () => {
    const sim = new Sim({ seed: 2026, playerClass: 'warrior', noPlayer: true }) as AnySim;
    const a = sim.addPlayer('warrior', 'WarriorA');
    const b = sim.addPlayer('warrior', 'WarriorB');
    for (const pid of [a, b]) {
      sim.setPlayerLevel(20, pid);
      expect(sim.setSpec('fury', pid)).toBe(true);
    }
    const entA = sim.entities.get(a) as Entity;
    const entB = sim.entities.get(b) as Entity;
    entB.pos = { ...entA.pos };

    sim.castAbility('emboldening_roar', a);
    entB.gcdRemaining = 0;
    sim.castAbility('emboldening_roar', b);

    for (const ent of [entA, entB]) {
      const crit = ent.auras.filter((x) => x.id === 'emboldening_roar_crit');
      expect(crit, 'one Emboldened copy').toHaveLength(1);
      expect(crit[0].charges).toBe(3);
      // The later cast owns the surviving copy.
      expect(crit[0].sourceId).toBe(b);
    }
  });
});

describe('Mass Barrier never stacks its shield with itself', () => {
  it('two mages casting on an overlapping group leave exactly one absorb copy per target', () => {
    const sim = new Sim({ seed: 2026, playerClass: 'mage', noPlayer: true }) as AnySim;
    const a = sim.addPlayer('mage', 'MageA');
    const b = sim.addPlayer('mage', 'MageB');
    for (const pid of [a, b]) {
      sim.setPlayerLevel(20, pid);
      expect(sim.applyTalents({ spec: 'frost', rows: { 17: 'mag_r17_mass_barrier' } }, pid)).toBe(
        true,
      );
      const p = sim.entities.get(pid) as Entity;
      p.resource = p.maxResource;
    }
    const entA = sim.entities.get(a) as Entity;
    const entB = sim.entities.get(b) as Entity;
    entB.pos = { ...entA.pos };
    entB.prevPos = { ...entA.pos };
    sim.partyInvite(b, a);
    sim.partyAccept(b);

    sim.castAbility('mass_barrier', a);
    entB.gcdRemaining = 0;
    sim.castAbility('mass_barrier', b);

    for (const ent of [entA, entB]) {
      const shield = ent.auras.filter((x) => x.id === 'mass_barrier');
      expect(shield, 'one Mass Barrier copy').toHaveLength(1);
      // The later cast owns the surviving copy.
      expect(shield[0].sourceId).toBe(b);
    }
  });
});

// Nature's Fury dedupe (the second half of #2868): RETIRED on this line. The
// druid overhaul repurposed dru_r20_improved_hurricane into Nature's Echo (an
// engine mechanic) and no talent grants moonwingPartyCritPct here, so the
// moonwing pulse is unreachable and its dedupe cannot be exercised. The Mass
// Barrier half above remains the live pin; the aura_stacking natures_fury
// entry stays as inert protection if a future talent revives the pulse.

describe('every group buff is exhaustion-gated or source-independent', () => {
  it('replaces a Soulwell ward from another Warlock instead of stacking it', () => {
    const ward = {
      id: 'soulwell',
      name: 'Soulwell',
      kind: 'absorb',
      remaining: 30,
      duration: 30,
      value: 100,
      sourceId: 1,
      school: 'shadow',
    } as const;

    expect(auraReplacementConflicts([ward], { ...ward, sourceId: 2 })).toEqual([0]);
  });

  it('no aoeAlly buff can silently self-stack across casters', () => {
    const offenders: string[] = [];
    for (const ability of Object.values(ABILITIES)) {
      for (const eff of ability.effects ?? []) {
        if (eff.type === 'aoeAllyHaste') {
          if (!eff.exhaust && !SOURCE_INDEPENDENT_GROUP_BUFF_AURA_IDS.has(ability.id)) {
            offenders.push(`${ability.id} (aoeAllyHaste)`);
          }
        } else if (eff.type === 'aoeAllyAttackPower') {
          // The dispatch stamps this half as `${abilityId}_ap`.
          if (!SOURCE_INDEPENDENT_GROUP_BUFF_AURA_IDS.has(`${ability.id}_ap`)) {
            offenders.push(`${ability.id} (aoeAllyAttackPower)`);
          }
        } else if (eff.type === 'aoeAllySureCrit') {
          // The dispatch stamps this as `${abilityId}_crit` (Emboldening Roar).
          if (!SOURCE_INDEPENDENT_GROUP_BUFF_AURA_IDS.has(`${ability.id}_crit`)) {
            offenders.push(`${ability.id} (aoeAllySureCrit)`);
          }
        } else if (eff.type === 'aoeAllyMaxHp') {
          // The dispatch stamps this as `${abilityId}_hp` (Rallying Cry).
          if (!SOURCE_INDEPENDENT_GROUP_BUFF_AURA_IDS.has(`${ability.id}_hp`)) {
            offenders.push(`${ability.id} (aoeAllyMaxHp)`);
          }
        } else if (eff.type === 'aoeAllyAbsorb') {
          // The dispatch applies this straight under the ability id (Mass Barrier).
          if (!SOURCE_INDEPENDENT_GROUP_BUFF_AURA_IDS.has(ability.id)) {
            offenders.push(`${ability.id} (aoeAllyAbsorb)`);
          }
        }
      }
    }
    expect(offenders, 'group buffs missing both self-stack guards').toEqual([]);
  });

  // The aoeAlly sweep above never saw the OTHER shape a group buff can take:
  // `buffTarget` with `party: true`, which is how every shout, blessing and
  // Paladin aura reaches the party. Five Paladin auras stacked across casters
  // for exactly that reason (two Paladins on Dawn Devotion granted +80 AP), so
  // this arm holds the whole family, not just the ids that were fixed.
  it('no party buffTarget aura can silently self-stack across casters', () => {
    const offenders: string[] = [];
    const seen: string[] = [];
    for (const ability of Object.values(ABILITIES)) {
      const effects = [
        ...(ability.effects ?? []),
        ...(ability.ranks ?? []).flatMap((r) => r.effects ?? []),
      ];
      for (const eff of effects) {
        if (eff.type !== 'buffTarget' || !eff.party) continue;
        seen.push(ability.id);
        // A party buffTarget lands under the ability id (see aura_stacking.ts).
        if (!SOURCE_INDEPENDENT_GROUP_BUFF_AURA_IDS.has(ability.id)) {
          offenders.push(`${ability.id} (buffTarget party)`);
        }
        break;
      }
    }
    // Guard the guard: if the party-buff shape is ever renamed, this scan would
    // pass by finding nothing at all. It must keep seeing the real family.
    expect(seen).toContain('battle_shout');
    expect(seen).toContain('dawn_devotion');
    expect(seen).toContain('retribution_aura');
    expect(seen.length).toBeGreaterThanOrEqual(9);
    expect(offenders, 'party buffTarget auras missing the source-independent guard').toEqual([]);
  });
});
