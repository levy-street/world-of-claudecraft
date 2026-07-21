import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

const SEED = 5150;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior' });

// Force a drowned_dead swing to land its plague, returning the applied aura (or
// undefined). Resets the player's HP each iteration so a connecting swing never
// kills before the disease is observed.
function forcePlague(sim: Sim, p: any, mob: any): any {
  for (let i = 0; i < 80; i++) {
    p.maxHp = 100000; p.hp = 100000;
    (sim as any).mobSwing(mob, p);
    const a = p.auras.find((x: any) => x.id === 'plague_drowned_dead');
    if (a) return a;
  }
  return undefined;
}

describe('Plague Stamina-drain affix (Bog Rot)', () => {
  it('a landed drowned_dead swing drains the victim Stamina and shrinks max HP', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    // A disease-free twin in an identical sim — same seed/class/level, so its
    // recalculated maxHp is exactly what ours would be without the plague.
    const cleanMaxHp = makeSim().entities.get(sim.playerId)!.maxHp;
    const baseSta = p.stats.sta;
    const tmpl = MOBS.drowned_dead;
    const saved = tmpl.plague!.chance;
    tmpl.plague!.chance = 1; // force the proc; misses/dodges still possible
    try {
      const a = forcePlague(sim, p, createMob(910700, tmpl, 10, { x: 0, y: 0, z: 0 }));
      expect(a).toBeDefined();
      expect(a.kind).toBe('buff_sta');
      expect(a.name).toBe('Bog Rot');
      expect(a.value).toBe(-12);
      expect(a.school).toBe('nature');
      // Stamina and the health pool both shrank under the disease.
      expect(p.stats.sta).toBe(baseSta - 12);
      expect(p.maxHp).toBeLessThan(cleanMaxHp);
    } finally {
      tmpl.plague!.chance = saved;
    }
  });

  it('the drained Stamina is restored when the disease expires', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    const baseSta = p.stats.sta;
    const tmpl = MOBS.drowned_dead;
    const saved = tmpl.plague!.chance;
    tmpl.plague!.chance = 1;
    try {
      const a = forcePlague(sim, p, createMob(910701, tmpl, 10, { x: 0, y: 0, z: 0 }));
      expect(a).toBeDefined();
      expect(p.stats.sta).toBe(baseSta - 12);
      a.remaining = 0; // let this tick expire it
      sim.tick();
      expect(p.auras.some((x) => x.id === 'plague_drowned_dead')).toBe(false);
      expect(p.stats.sta).toBe(baseSta); // Stamina fully restored
    } finally {
      tmpl.plague!.chance = saved;
    }
  });

  it('a friendly pet swing (hostile=false) never plagues its target', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    const tmpl = MOBS.drowned_dead;
    const saved = tmpl.plague!.chance;
    tmpl.plague!.chance = 1;
    try {
      const pet = createMob(910702, tmpl, 10, { x: 0, y: 0, z: 0 });
      pet.hostile = false; // pets call mobSwing too
      for (let i = 0; i < 80; i++) { p.maxHp = 100000; p.hp = 100000; (sim as any).mobSwing(pet, p); }
      expect(p.auras.some((a) => a.id === 'plague_drowned_dead')).toBe(false);
    } finally {
      tmpl.plague!.chance = saved;
    }
  });

  it('a mob without the plague affix applies no Stamina debuff', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    const mob = createMob(910703, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 60; i++) { p.maxHp = 100000; p.hp = 100000; (sim as any).mobSwing(mob, p); }
    expect(p.auras.some((a) => a.kind === 'buff_sta' && a.value < 0)).toBe(false);
  });
});
