import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { Entity } from '../src/sim/types';

const SEED = 41099;

// Ironvein Foreman is the seeded carrier of the rally commander mechanic.
const inner = (sim: Sim) => sim as unknown as {
  addEntity(e: Entity): void;
  updateBossMechanics(m: Entity): void;
  resetEvadingMob(m: Entity): void;
  effectiveAttackPower(e: Entity): number;
};

function spawn(sim: Sim, id: number, tmpl: typeof MOBS[string]) {
  const mob = createMob(id, tmpl, 16, { x: 0, y: 0, z: 0 });
  mob.inCombat = true;
  inner(sim).addEntity(mob);
  return mob;
}

function buffAp(e: Entity): number {
  return e.auras.filter((a) => a.kind === 'buff_ap').reduce((s, a) => s + a.value, 0);
}

describe('mob commander buff (rally)', () => {
  it('seeds the mechanic on the Ironvein Foreman', () => {
    expect(MOBS.ironvein_foreman.rally).toEqual({
      radius: 14, every: 12, ap: 40, duration: 10, name: 'Rallying Banner',
    });
  });

  it('empowers a nearby ally once the cast timer elapses', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const foreman = spawn(sim, 9001, MOBS.ironvein_foreman);
    const ally = spawn(sim, 9002, MOBS.ironvein_sapper);
    ally.pos = { x: 5, y: 0, z: 0 };
    const before = inner(sim).effectiveAttackPower(ally);
    // Telegraphed: createMob seeds rallyTimer to a full interval, so it takes
    // `every` seconds (20 ticks/s) of in-combat updates before the first rally.
    for (let i = 0; i < 20 * 12 + 1; i++) inner(sim).updateBossMechanics(foreman);
    expect(buffAp(ally)).toBe(40);
    expect(inner(sim).effectiveAttackPower(ally)).toBe(before + 40);
  });

  it('does not rally before the telegraphed first interval', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const foreman = spawn(sim, 9011, MOBS.ironvein_foreman);
    const ally = spawn(sim, 9012, MOBS.ironvein_sapper);
    for (let i = 0; i < 20 * 11; i++) inner(sim).updateBossMechanics(foreman); // 11s < 12s
    expect(buffAp(ally)).toBe(0);
  });

  it('empowers every ally in range plus the caster (AoE)', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const foreman = spawn(sim, 9021, MOBS.ironvein_foreman);
    const a = spawn(sim, 9022, MOBS.ironvein_sapper);
    const b = spawn(sim, 9023, MOBS.ironvein_sapper);
    b.pos = { x: 8, y: 0, z: 0 };
    for (let i = 0; i < 20 * 12 + 1; i++) inner(sim).updateBossMechanics(foreman);
    expect(buffAp(a)).toBe(40);
    expect(buffAp(b)).toBe(40);
    expect(buffAp(foreman)).toBe(40); // the commander rallies itself too
  });

  it('ignores allies outside the rally radius', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const foreman = spawn(sim, 9031, MOBS.ironvein_foreman);
    const far = spawn(sim, 9032, MOBS.ironvein_sapper);
    far.pos = { x: 100, y: 0, z: 0 }; // well beyond radius 14
    for (let i = 0; i < 20 * 12 + 1; i++) inner(sim).updateBossMechanics(foreman);
    expect(buffAp(far)).toBe(0);
  });

  it('does not empower opposing-faction mobs (players/pets excluded by faction)', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const foreman = spawn(sim, 9041, MOBS.ironvein_foreman);
    const enemyMob = spawn(sim, 9042, MOBS.ironvein_sapper);
    enemyMob.hostile = false; // flip faction
    for (let i = 0; i < 20 * 12 + 1; i++) inner(sim).updateBossMechanics(foreman);
    expect(buffAp(enemyMob)).toBe(0);
  });

  it('refreshes rather than stacks on repeated casts', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const foreman = spawn(sim, 9051, MOBS.ironvein_foreman);
    const ally = spawn(sim, 9052, MOBS.ironvein_sapper);
    for (let i = 0; i < 20 * 12 * 2 + 2; i++) inner(sim).updateBossMechanics(foreman);
    expect(ally.auras.filter((a) => a.kind === 'buff_ap').length).toBe(1);
    expect(buffAp(ally)).toBe(40);
  });

  it('re-arms the telegraph after the foreman evades and resets', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const foreman = spawn(sim, 9061, MOBS.ironvein_foreman);
    inner(sim).resetEvadingMob(foreman);
    expect(foreman.rallyTimer).toBe(MOBS.ironvein_foreman.rally!.every);
  });

  it('leaves mobs without the mechanic untouched', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const sapper = spawn(sim, 9071, MOBS.ironvein_sapper);
    const ally = spawn(sim, 9072, MOBS.ironvein_sapper);
    for (let i = 0; i < 20 * 12 + 1; i++) inner(sim).updateBossMechanics(sapper);
    expect(buffAp(ally)).toBe(0);
  });
});
