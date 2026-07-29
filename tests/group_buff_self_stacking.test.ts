// Group buffs are ONE per target regardless of caster (v0.27.1): a second
// hunter's Wildfang Rally REPLACES the first, never stacks a duplicate +45 AP
// and +5% haste. The general rule: every aoeAlly group buff must either carry
// Bloodlust-style exhaustion (exhaust: true, the 'sated' debuff blocks a second
// application) or appear in aura_stacking's source-independent dedupe set; the
// guard test at the bottom makes forgetting BOTH a loud CI failure for any
// future group buff.
import { describe, expect, it } from 'vitest';
import { SOURCE_INDEPENDENT_GROUP_BUFF_AURA_IDS } from '../src/sim/combat/aura_stacking';
import { ABILITIES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;

describe('Wildfang Rally never stacks with itself', () => {
  it('a second hunter casting replaces the first copy instead of stacking', () => {
    const sim = new Sim({ seed: 2026, playerClass: 'hunter', noPlayer: true }) as AnySim;
    const a = sim.addPlayer('hunter', 'HunterA');
    const b = sim.addPlayer('hunter', 'HunterB');
    for (const pid of [a, b]) {
      sim.setPlayerLevel(20, pid);
      expect(sim.setSpec('beast_mastery', pid)).toBe(true);
      expect(sim.selectTalentRow(20, 'hun_r20_aspect_of_the_wild', pid)).toBe(true);
      const p = sim.entities.get(pid) as Entity;
      p.resource = p.maxResource;
    }
    const entA = sim.entities.get(a) as Entity;
    const entB = sim.entities.get(b) as Entity;
    entB.pos = { ...entA.pos };

    sim.castAbility('aspect_of_the_wild', a);
    entB.gcdRemaining = 0;
    sim.castAbility('aspect_of_the_wild', b);

    for (const ent of [entA, entB]) {
      const haste = ent.auras.filter((x) => x.id === 'aspect_of_the_wild');
      const ap = ent.auras.filter((x) => x.id === 'aspect_of_the_wild_ap');
      expect(haste, 'one haste copy').toHaveLength(1);
      expect(ap, 'one AP copy').toHaveLength(1);
      // The later cast owns the surviving copy.
      expect(haste[0].sourceId).toBe(b);
      expect(ap[0].sourceId).toBe(b);
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

describe("Nature's Fury never stacks its spell-crit pulse with itself", () => {
  it('two druids in the same party pulsing on a shared ally leave exactly one copy', () => {
    const sim = new Sim({ seed: 2026, playerClass: 'druid', noPlayer: true }) as AnySim;
    const a = sim.addPlayer('druid', 'DruidA');
    const b = sim.addPlayer('druid', 'DruidB');
    for (const pid of [a, b]) {
      sim.setPlayerLevel(20, pid);
      expect(
        sim.applyTalents({ spec: null, rows: { 20: 'dru_r20_improved_hurricane' } }, pid),
      ).toBe(true);
    }
    const entA = sim.entities.get(a) as Entity;
    const entB = sim.entities.get(b) as Entity;
    entB.pos = { ...entA.pos };
    entB.prevPos = { ...entA.pos };
    sim.partyInvite(b, a);
    sim.partyAccept(b);

    // Moonwing Form is the Balance signature (gated behind the balance spec);
    // the talent under test only needs the form AURA, so apply it directly
    // like tests/natures_fury.test.ts does, without spending a spec pick.
    const applyAura = sim as unknown as { applyAura(t: Entity, a: Record<string, unknown>): void };
    for (const [ent, sourceId] of [
      [entA, a],
      [entB, b],
    ] as const) {
      applyAura.applyAura(ent, {
        id: 'moonkin_form',
        name: 'Moonwing Form',
        kind: 'form_moonkin',
        remaining: 3600,
        duration: 3600,
        value: 0,
        sourceId,
        school: 'arcane',
      });
    }

    // Nature's Fury pulses once a second, staggered by pid: run past a full
    // cycle so both druids have pulsed onto each other at least once.
    for (let i = 0; i < 40; i++) sim.tick();

    for (const ent of [entA, entB]) {
      const fury = ent.auras.filter((x) => x.id === 'natures_fury');
      expect(fury, "one Nature's Fury copy").toHaveLength(1);
      expect(fury[0].kind).toBe('buff_spellcrit');
    }
  });
});

describe('every group buff is exhaustion-gated or source-independent', () => {
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
});
