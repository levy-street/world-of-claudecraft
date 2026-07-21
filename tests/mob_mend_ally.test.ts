import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { Entity } from '../src/sim/types';

const SEED = 41099;

// Gravecaller Mender is the seeded carrier of the mendAlly support mechanic.
const inner = (sim: Sim) => sim as unknown as {
  addEntity(e: Entity): void;
  updateBossMechanics(m: Entity): void;
  resetEvadingMob(m: Entity): void;
};

function spawn(sim: Sim, id: number, tmpl: typeof MOBS[string], hpFrac = 1) {
  const mob = createMob(id, tmpl, 12, { x: 0, y: 0, z: 0 });
  mob.hp = Math.round(mob.maxHp * hpFrac);
  mob.inCombat = true;
  inner(sim).addEntity(mob);
  return mob;
}

describe('mob support heal (mendAlly)', () => {
  it('seeds the mechanic on the Gravecaller Mender', () => {
    expect(MOBS.gravecaller_mender.mendAlly).toEqual({
      healMin: 26, healMax: 38, radius: 14, every: 6, name: 'Grave Mending', school: 'shadow',
    });
  });

  it('heals a wounded nearby ally once the cast timer elapses', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const mender = spawn(sim, 9001, MOBS.gravecaller_mender);
    const ally = spawn(sim, 9002, MOBS.gravecaller_cultist, 0.4);
    ally.pos = { x: 5, y: 0, z: 0 };
    const before = ally.hp;
    // Telegraphed: createMob seeds mendTimer to a full interval, so it takes
    // `every` seconds (20 ticks/s) of in-combat updates before the first cast.
    for (let i = 0; i < 20 * 6 + 1; i++) inner(sim).updateBossMechanics(mender);
    expect(ally.hp).toBeGreaterThan(before);
    expect(ally.hp).toBeLessThanOrEqual(ally.maxHp);
  });

  it('does not cast before the telegraphed first interval', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const mender = spawn(sim, 9011, MOBS.gravecaller_mender);
    const ally = spawn(sim, 9012, MOBS.gravecaller_cultist, 0.4);
    const before = ally.hp;
    for (let i = 0; i < 20 * 5; i++) inner(sim).updateBossMechanics(mender); // 5s < 6s
    expect(ally.hp).toBe(before);
  });

  it('heals every wounded ally in range at once (AoE)', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const mender = spawn(sim, 9021, MOBS.gravecaller_mender, 0.5);
    const a = spawn(sim, 9022, MOBS.gravecaller_cultist, 0.4);
    const b = spawn(sim, 9023, MOBS.gravecaller_summoner, 0.4);
    const beforeA = a.hp, beforeB = b.hp, beforeSelf = mender.hp;
    for (let i = 0; i < 20 * 6 + 1; i++) inner(sim).updateBossMechanics(mender);
    expect(a.hp).toBeGreaterThan(beforeA);
    expect(b.hp).toBeGreaterThan(beforeB);
    expect(mender.hp).toBeGreaterThan(beforeSelf); // the caster mends itself too
  });

  it('ignores allies outside the heal radius', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const mender = spawn(sim, 9031, MOBS.gravecaller_mender);
    const far = spawn(sim, 9032, MOBS.gravecaller_cultist, 0.4);
    far.pos = { x: 100, y: 0, z: 0 }; // well beyond radius 14
    const before = far.hp;
    for (let i = 0; i < 20 * 6 + 1; i++) inner(sim).updateBossMechanics(mender);
    expect(far.hp).toBe(before);
  });

  it('does not heal hostiles of the opposing faction (players/pets excluded by faction)', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const mender = spawn(sim, 9041, MOBS.gravecaller_mender);
    const friendlyMob = spawn(sim, 9042, MOBS.gravecaller_cultist, 0.4);
    friendlyMob.hostile = false; // flip faction
    const before = friendlyMob.hp;
    for (let i = 0; i < 20 * 6 + 1; i++) inner(sim).updateBossMechanics(mender);
    expect(friendlyMob.hp).toBe(before);
  });

  it('re-arms the telegraph after the mender evades and resets', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const mender = spawn(sim, 9051, MOBS.gravecaller_mender);
    inner(sim).resetEvadingMob(mender);
    expect(mender.mendTimer).toBe(MOBS.gravecaller_mender.mendAlly!.every);
  });

  it('leaves mobs without the mechanic untouched', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const cultist = spawn(sim, 9061, MOBS.gravecaller_cultist, 0.4);
    const ally = spawn(sim, 9062, MOBS.gravecaller_summoner, 0.4);
    const before = ally.hp;
    for (let i = 0; i < 20 * 6 + 1; i++) inner(sim).updateBossMechanics(cultist);
    expect(ally.hp).toBe(before);
  });
});
