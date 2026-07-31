// Wing 1 of The Undermount Descent: the Kiln-Keepers duo (Vosh the Glazier +
// Saan the Stoker). The wing clears only when BOTH keepers fall, and killing one
// frenzies the survivor (Kiln Fury), the kill-together tension. Test-first: RED
// until saan_the_stoker and the wing-1 duo spawn list are authored.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { enterDungeon, heroicLockoutId, instanceKeyFor } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function makeSim(seed = 5): AnySim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true }) as AnySim;
}

function metaOf(sim: AnySim, pid: number): any {
  const r = sim.ctx.resolve(pid);
  if (!r) throw new Error(`no player ${pid}`);
  return r.meta;
}

function claimFor(sim: AnySim, dungeonId: string, pid: number): any {
  return (sim.instances as any[]).find(
    (i) => i.dungeonId === dungeonId && i.partyKey === instanceKeyFor(sim.ctx, pid),
  );
}

function bossIn(sim: AnySim, inst: any, templateId: string): AnyEntity {
  const boss = inst.mobIds
    .map((id: number) => sim.entities.get(id))
    .find((e: AnyEntity | undefined) => e?.templateId === templateId);
  if (!boss) throw new Error(`no ${templateId} in ${inst.dungeonId}`);
  return boss as AnyEntity;
}

describe('Kiln-Keepers duo (wing 1)', () => {
  it('gives the keepers their signature kit', () => {
    // Vosh: the two tank-swap pressures (Glazing stack + the Cinder-Toad).
    expect(MOBS.vosh_the_glazier.expose?.name, 'Glazing').toBe('Glazing');
    expect(MOBS.vosh_the_glazier.polymorphHex?.name, 'Cinder-Toad').toBe('Cinder-Toad');
    // Saan: the interruptible Anneal that keeps Vosh up while she lives.
    expect(MOBS.saan_the_stoker.mendAlly, 'Anneal').toBeDefined();
    expect(MOBS.saan_the_stoker.mendAlly?.name).toBe('Anneal');
  });

  it('authors one guaranteed group and the exact 0.55 bonus group on both keepers', () => {
    for (const id of ['vosh_the_glazier', 'saan_the_stoker']) {
      const loot = MOBS[id].loot;
      const guaranteed = loot.filter((entry) => entry.rollGroup === 'undermount_wing1_guaranteed');
      const bonus = loot.filter((entry) => entry.rollGroup === 'undermount_wing1_bonus');
      expect(guaranteed.map((entry) => entry.itemId)).toEqual([
        'slag_tempered_sabatons',
        'glasswalker_treads',
        'twice_fired_slippers',
        'stokebrand_striders',
      ]);
      expect(guaranteed.reduce((sum, entry) => sum + entry.chance, 0)).toBe(1);
      expect(bonus.map((entry) => [entry.itemId, entry.chance])).toEqual([
        ['saans_stoking_iron', 0.12],
        ['glassblowers_shiv', 0.1],
        ['sluicebearer', 0.1],
        ['cindertoad_signet', 0.08],
        ['ring_of_the_first_quench', 0.08],
        ['coalglow_band', 0.07],
      ]);
      expect(bonus.reduce((sum, entry) => sum + entry.chance, 0)).toBeCloseTo(0.55);
    }
  });

  it('spawns both keepers in the wing-1 instance', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    enterDungeon(sim.ctx, 'undermount_wing1', pid);
    const inst = claimFor(sim, 'undermount_wing1', pid);
    expect(bossIn(sim, inst, 'vosh_the_glazier')).toBeDefined();
    expect(bossIn(sim, inst, 'saan_the_stoker')).toBeDefined();
  });

  it('clears only when BOTH keepers fall, and the survivor frenzies', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    const player = sim.entities.get(pid) as AnyEntity;
    const meta = metaOf(sim, pid);
    enterDungeon(sim.ctx, 'undermount_wing1', pid);
    const inst = claimFor(sim, 'undermount_wing1', pid);
    const vosh = bossIn(sim, inst, 'vosh_the_glazier');
    const saan = bossIn(sim, inst, 'saan_the_stoker');

    // Kill Vosh first: the wing does NOT clear, and Saan flies into Kiln Fury.
    sim.dealDamage(player, vosh, vosh.hp, false, 'physical', null, 'hit', true);
    expect(vosh.dead).toBe(true);
    expect(meta.undermountCleared.has('undermount_wing1'), 'not cleared on first keeper').toBe(
      false,
    );
    expect(
      saan.auras.some((a: any) => a.id === 'undermount_keeper_frenzy'),
      'survivor frenzied',
    ).toBe(true);

    // Kill Saan: now the wing clears.
    sim.dealDamage(player, saan, saan.hp, false, 'physical', null, 'hit', true);
    expect(saan.dead).toBe(true);
    expect(meta.undermountCleared.has('undermount_wing1'), 'cleared on last keeper').toBe(true);
    expect(meta.deedStats.dungeonClears.undermount_wing1).toBe(1);
    expect(meta.raidLockouts.has('undermount_wing1')).toBe(true);
  });

  for (const order of [
    ['vosh_the_glazier', 'saan_the_stoker'],
    ['saan_the_stoker', 'vosh_the_glazier'],
  ] as const) {
    it(`pays wing loot only on the last keeper for order ${order.join(' then ')}`, () => {
      const sim = makeSim(11);
      const pid = sim.addPlayer('warrior', 'Solo');
      const player = sim.entities.get(pid) as AnyEntity;
      enterDungeon(sim.ctx, 'undermount_wing1', pid);
      const inst = claimFor(sim, 'undermount_wing1', pid);
      const first = bossIn(sim, inst, order[0]);
      const last = bossIn(sim, inst, order[1]);
      sim.dealDamage(player, first, first.hp + 1, false, 'physical', null, 'hit', true);
      expect(first.loot).toBeNull();
      expect(first.lootable).toBe(false);
      sim.dealDamage(player, last, last.hp + 1, false, 'physical', null, 'hit', true);
      expect(last.loot?.copper).toBeGreaterThan(0);
      const ids = (last.loot?.items ?? []).map((slot: any) => slot.itemId);
      expect(
        ids.filter((id: string) =>
          [
            'slag_tempered_sabatons',
            'glasswalker_treads',
            'twice_fired_slippers',
            'stokebrand_striders',
          ].includes(id),
        ),
      ).toHaveLength(1);
    });
  }

  it('spends zero loot draws on the first keeper and the same four on either final keeper', () => {
    const trace = (finalTemplateId: 'vosh_the_glazier' | 'saan_the_stoker') => {
      const sim = makeSim(31);
      const pid = sim.addPlayer('warrior', 'Solo');
      const meta = metaOf(sim, pid);
      enterDungeon(sim.ctx, 'undermount_wing1', pid);
      const inst = claimFor(sim, 'undermount_wing1', pid);
      const finalKeeper = bossIn(sim, inst, finalTemplateId);
      const firstKeeper = bossIn(
        sim,
        inst,
        finalTemplateId === 'vosh_the_glazier' ? 'saan_the_stoker' : 'vosh_the_glazier',
      );
      const firstDraws: number[] = [];
      sim.rng.setObserver((value: number) => firstDraws.push(value));
      sim.ctx.rollLoot(firstKeeper, meta, [meta]);
      sim.rng.setObserver(null);
      firstKeeper.dead = true;
      const finalDraws: number[] = [];
      sim.rng.setObserver((value: number) => finalDraws.push(value));
      sim.ctx.rollLoot(finalKeeper, meta, [meta]);
      sim.rng.setObserver(null);
      return { firstDraws, finalDraws };
    };
    const voshFinal = trace('vosh_the_glazier');
    const saanFinal = trace('saan_the_stoker');
    expect(voshFinal.firstDraws).toEqual([]);
    expect(saanFinal.firstDraws).toEqual([]);
    expect(voshFinal.finalDraws).toHaveLength(4);
    expect(saanFinal.finalDraws).toEqual(voshFinal.finalDraws);
  });

  for (const order of [
    ['vosh_the_glazier', 'saan_the_stoker'],
    ['saan_the_stoker', 'vosh_the_glazier'],
  ] as const) {
    it(`heroic last-keeper settlement is exact for order ${order.join(' then ')}`, () => {
      const sim = makeSim(13);
      const pid = sim.addPlayer('warrior', 'Solo');
      const player = sim.entities.get(pid) as AnyEntity;
      const meta = metaOf(sim, pid);
      sim.setDungeonDifficulty('heroic', pid);
      enterDungeon(sim.ctx, 'undermount_wing1', pid);
      const inst = claimFor(sim, 'undermount_wing1', pid);
      const first = bossIn(sim, inst, order[0]);
      const last = bossIn(sim, inst, order[1]);
      expect(bossIn(sim, inst, 'vosh_the_glazier').maxHp).toBeGreaterThan(26000);
      expect(bossIn(sim, inst, 'saan_the_stoker').maxHp).toBeGreaterThan(20000);
      sim.dealDamage(player, first, first.hp + 1, false, 'physical', null, 'hit', true);
      expect(first.loot).toBeNull();
      expect(first.lootable).toBe(false);
      expect(meta.raidLockouts.has(heroicLockoutId('undermount_wing1'))).toBe(false);
      expect(meta.deedStats.dungeonClears['undermount_wing1:heroic']).toBeUndefined();
      sim.dealDamage(player, last, last.hp + 1, false, 'physical', null, 'hit', true);
      const ids = (last.loot?.items ?? []).map((slot: any) => slot.itemId);
      expect(ids.every((id: string) => id.startsWith('heroic_'))).toBe(true);
      expect(
        ids.filter((id: string) =>
          [
            'heroic_slag_tempered_sabatons',
            'heroic_glasswalker_treads',
            'heroic_twice_fired_slippers',
            'heroic_stokebrand_striders',
          ].includes(id),
        ),
      ).toHaveLength(1);
      expect(meta.raidLockouts.has(heroicLockoutId('undermount_wing1'))).toBe(true);
      expect(meta.deedStats.dungeonClears['undermount_wing1:heroic']).toBe(1);
    });
  }

  it('resets both keepers when either half of the pair evades', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    enterDungeon(sim.ctx, 'undermount_wing1', pid);
    const inst = claimFor(sim, 'undermount_wing1', pid);
    const vosh = bossIn(sim, inst, 'vosh_the_glazier');
    const saan = bossIn(sim, inst, 'saan_the_stoker');
    for (const boss of [vosh, saan]) {
      boss.hp -= 100;
      boss.inCombat = true;
      boss.aiState = 'chase';
      boss.tappedById = pid;
    }
    saan.auras.push({
      id: 'undermount_keeper_frenzy',
      name: 'Kiln Fury',
      kind: 'buff_haste',
      remaining: 10,
      duration: 10,
      value: 0.5,
      sourceId: saan.id,
      school: 'physical',
    });
    sim.ctx.resetEvadingMob(vosh);
    for (const boss of [vosh, saan]) {
      expect(boss.hp).toBe(boss.maxHp);
      expect(boss.inCombat).toBe(false);
      expect(boss.aiState).toBe('idle');
      expect(boss.tappedById).toBeNull();
      expect(boss.auras).toEqual([]);
    }
  });

  for (const order of [
    ['vosh_the_glazier', 'saan_the_stoker'],
    ['saan_the_stoker', 'vosh_the_glazier'],
  ] as const) {
    it(`respawns a dead ${order[0]} when ${order[1]} evades`, () => {
      const sim = makeSim(23);
      const pid = sim.addPlayer('warrior', 'Solo');
      const player = sim.entities.get(pid) as AnyEntity;
      enterDungeon(sim.ctx, 'undermount_wing1', pid);
      const inst = claimFor(sim, 'undermount_wing1', pid);
      const deadKeeper = bossIn(sim, inst, order[0]);
      const survivor = bossIn(sim, inst, order[1]);
      sim.dealDamage(player, deadKeeper, deadKeeper.hp + 1, false, 'physical', null, 'hit', true);
      expect(deadKeeper.dead).toBe(true);
      sim.ctx.resetEvadingMob(survivor);
      for (const boss of [deadKeeper, survivor]) {
        expect(boss.dead).toBe(false);
        expect(boss.hp).toBe(boss.maxHp);
        expect(boss.aiState).toBe('idle');
        expect(boss.inCombat).toBe(false);
        expect(boss.auras).toEqual([]);
      }
    });
  }

  it('Anneal stops outside its tether radius and heals at the boundary', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    enterDungeon(sim.ctx, 'undermount_wing1', pid);
    const inst = claimFor(sim, 'undermount_wing1', pid);
    const vosh = bossIn(sim, inst, 'vosh_the_glazier');
    const saan = bossIn(sim, inst, 'saan_the_stoker');
    vosh.hp -= 1000;
    vosh.pos.x = saan.pos.x + (MOBS.saan_the_stoker.mendAlly?.radius ?? 0) + 5;
    sim.ctx.rebucket(vosh);
    saan.inCombat = true;
    saan.mendTimer = 0.01;
    const before = vosh.hp;
    (sim as any).updateBossMechanics(saan);
    expect(vosh.hp).toBe(before);
    vosh.pos.x = saan.pos.x + (MOBS.saan_the_stoker.mendAlly?.radius ?? 0);
    sim.ctx.rebucket(vosh);
    saan.mendTimer = 0.01;
    (sim as any).updateBossMechanics(saan);
    expect(vosh.hp).toBeGreaterThan(before);
  });
});
