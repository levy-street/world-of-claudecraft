import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS, ITEMS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';

// #112 — a level-8 elite boss in the starter zone (Hogger homage): it calls its
// pack for aid at half health and enrages near death.

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function findBoss(sim: Sim): Entity {
  const boss = [...sim.entities.values()].find((e) => e.templateId === 'diremaw');
  if (!boss) throw new Error('Diremaw is not spawned in the overworld');
  return boss;
}

function livePacklings(sim: Sim): number {
  return [...sim.entities.values()].filter((e) => e.templateId === 'blighted_packling' && !e.dead).length;
}

describe('Diremaw the Blighted (#112 starter elite boss)', () => {
  it('spawns as a level-8 elite/boss with its encounter mechanics', () => {
    const sim = makeWorld();
    const boss = findBoss(sim);
    const t = MOBS['diremaw'];
    expect(boss.level).toBe(8);
    expect(t.elite).toBe(true);
    expect(t.boss).toBe(true);
    expect(t.summonAdds?.mobId).toBe('blighted_packling');
    expect(t.enrage?.belowHpPct).toBe(0.3);
    // elite scaling is 2.3x of (hpBase + hpPerLevel*(level-1))
    expect(boss.maxHp).toBe(Math.round((t.hpBase + t.hpPerLevel * 7) * 2.3));
  });

  it('calls its pack for aid at half health', () => {
    const sim = makeWorld();
    const boss = findBoss(sim);
    expect(livePacklings(sim)).toBe(0);
    boss.inCombat = true;
    boss.hp = Math.floor(boss.maxHp * 0.5);
    sim.tick();
    expect(boss.firedSummons).toBeGreaterThan(0);
    expect(livePacklings(sim)).toBe(MOBS['diremaw'].summonAdds!.count);
  });

  it('enrages below 30% health', () => {
    const sim = makeWorld();
    const boss = findBoss(sim);
    expect(boss.enraged).toBe(false);
    boss.inCombat = true;
    boss.hp = Math.floor(boss.maxHp * 0.25);
    sim.tick();
    expect(boss.enraged).toBe(true);
  });

  it('summons a level-appropriate pack (a real threat, not trivial low-level adds)', () => {
    const add = MOBS['blighted_packling'];
    expect(add).toBeTruthy();
    expect(add.minLevel).toBeGreaterThanOrEqual(6);
  });

  it('does not respawn killed summoned adds (overworld add cleanup)', () => {
    const sim = makeWorld();
    const boss = findBoss(sim);
    boss.inCombat = true;
    boss.hp = Math.floor(boss.maxHp * 0.5);
    sim.tick(); // summons the pack
    const adds = [...sim.entities.values()].filter((e) => e.templateId === 'blighted_packling');
    expect(adds.length).toBe(2);
    expect(adds.every((a) => a.summoned)).toBe(true);
    // kill the pack and expire their corpses
    for (const a of adds) { a.dead = true; a.aiState = 'dead'; a.corpseTimer = 0; a.respawnTimer = 0; }
    for (let i = 0; i < 5; i++) sim.tick();
    // they are removed, NOT respawned like a normal overworld mob
    expect(livePacklings(sim)).toBe(0);
    expect([...sim.entities.values()].filter((e) => e.templateId === 'blighted_packling').length).toBe(0);
  });

  it('drops coin plus an uncommon and a rare reward that exist in the item table', () => {
    const loot = MOBS['diremaw'].loot;
    expect(loot.some((l) => (l.copper ?? 0) > 0)).toBe(true);
    const itemIds = loot.map((l) => l.itemId).filter(Boolean) as string[];
    expect(itemIds).toContain('diremaw_hide');
    expect(itemIds).toContain('blightfang_cleaver');
    expect(ITEMS['diremaw_hide']?.quality).toBe('uncommon');
    expect(ITEMS['blightfang_cleaver']?.quality).toBe('rare');
  });
});
