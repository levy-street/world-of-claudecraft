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
        }
      }
    }
    expect(offenders, 'group buffs missing both self-stack guards').toEqual([]);
  });
});
