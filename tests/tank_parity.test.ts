import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';
import { armorReduction, type EquipSlot, type ItemDef, type PlayerClass } from '../src/sim/types';

// Tank parity (2026-07): the three committed tanks land within a band of each
// other in effective HP against a level-22 heroic mob, each with a distinct
// texture. Warrior: parry + block + Defensive Stance (the pure-tank ceiling).
// Paladin: best armor + staPct 0.35 baseline. Druid: Sloth Form 2.3x armor +
// feral staPct 0.25 (the Dire-Bear logic: the form fakes the missing plate
// tier out of leather). Before the parity pass the paladin sat at 76% and the
// druid at 66% of the warrior's EHP.

function tankEhp(cls: PlayerClass, spec: string, form?: string): number {
  const sim = new Sim({ seed: 1, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer(cls, 'T');
  sim.setPlayerLevel(20, pid);
  sim.applyTalents({ spec, rows: {} }, pid);
  const p = sim.entities.get(pid)!;
  const score = (i: ItemDef) => (i.stats?.sta ?? 0) * 100 + (i.stats?.armor ?? 0) * 0.1;
  for (const slot of [
    'helmet',
    'neck',
    'shoulder',
    'chest',
    'waist',
    'legs',
    'gloves',
    'feet',
  ] as EquipSlot[]) {
    const best = Object.values(ITEMS)
      .filter((i) => i.slot === slot && i.kind === 'armor' && canEquipItem(cls, i))
      .sort((a, b) => score(b) - score(a))[0];
    if (best) {
      sim.addItem(best.id, 1, pid);
      sim.equipItem(best.id, pid);
    }
  }
  const rings = Object.values(ITEMS)
    .filter((i) => i.slot === 'ring' && canEquipItem(cls, i))
    .sort((a, b) => score(b) - score(a))
    .slice(0, 2);
  rings.forEach((r, j) => {
    sim.addItem(r.id, 1, pid);
    sim.equipItemToSlot(r.id, `ring${j + 1}` as EquipSlot, pid);
  });
  const offhand = Object.values(ITEMS)
    .filter((i) => i.slot === 'offhand' && canEquipItem(cls, i))
    .sort((a, b) => score(b) - score(a))[0];
  if (offhand) {
    sim.addItem(offhand.id, 1, pid);
    sim.equipItem(offhand.id, pid);
  }
  if (cls === 'warrior') {
    sim.castAbility('defensive_stance', pid);
    sim.tick();
  }
  if (form) {
    sim.castAbility(form, pid);
    sim.tick();
    expect(p.auras.some((a) => a.kind === 'form_bear')).toBe(true);
  }
  sim.ctx.recalcPlayer(p);
  const pass = 1 - armorReduction(sim.ctx.effectiveArmor(p), 22);
  const stance = cls === 'warrior' ? 0.9 : 1;
  return Math.round(p.maxHp / (pass * stance));
}

describe('committed-tank effective HP parity', () => {
  it('paladin and druid land within 88-108% of the prot warrior', () => {
    const warrior = tankEhp('warrior', 'prot');
    const paladin = tankEhp('paladin', 'protection');
    const druid = tankEhp('druid', 'feral', 'bear_form');
    expect(warrior).toBeGreaterThan(6000); // the unbuffed ceiling stays real
    for (const [name, ehp] of [
      ['paladin', paladin],
      ['druid', druid],
    ] as const) {
      expect(ehp / warrior, `${name} ${ehp} vs warrior ${warrior}`).toBeGreaterThan(0.88);
      expect(ehp / warrior, `${name} ${ehp} vs warrior ${warrior}`).toBeLessThan(1.08);
    }
  });
});
