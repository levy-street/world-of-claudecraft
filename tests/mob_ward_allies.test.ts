import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const SEED = 41099;

// Mogger is the seeded carrier of the wardAllies support mechanic — a rare ogre
// boss that shields his crew (mogger_lackeys) with a Bracing Order absorb.
const inner = (sim: Sim) =>
  sim as unknown as {
    addEntity(e: Entity): void;
    updateBossMechanics(m: Entity): void;
    resetEvadingMob(m: Entity): void;
  };

function spawn(sim: Sim, id: number, tmpl: (typeof MOBS)[string], hpFrac = 1) {
  const mob = createMob(id, tmpl, 6, { x: 0, y: 0, z: 0 });
  mob.hp = Math.round(mob.maxHp * hpFrac);
  mob.inCombat = true;
  inner(sim).addEntity(mob);
  return mob;
}

const ward = (e: Entity) => e.auras.find((a) => a.id === 'ward_mogger' && a.kind === 'absorb');

describe('mob support shield (wardAllies)', () => {
  it('seeds the mechanic on Mogger', () => {
    expect(MOBS.mogger.wardAllies).toEqual({
      radius: 12,
      every: 12,
      amount: 70,
      duration: 8,
      name: 'Bracing Order',
      school: 'physical',
    });
  });

  it('shields a nearby ally once the cast timer elapses', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const mogger = spawn(sim, 9001, MOBS.mogger);
    const ally = spawn(sim, 9002, MOBS.mogger_lackey);
    ally.pos = { x: 5, y: 0, z: 0 };
    // Telegraphed: createMob seeds wardTimer to a full interval, so it takes
    // `every` seconds (20 ticks/s) of in-combat updates before the first ward.
    for (let i = 0; i < 20 * 12 + 1; i++) inner(sim).updateBossMechanics(mogger);
    expect(ward(ally)?.value).toBe(70);
    expect(ward(ally)?.remaining).toBe(8);
  });

  it('does not cast before the telegraphed first interval', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const mogger = spawn(sim, 9011, MOBS.mogger);
    const ally = spawn(sim, 9012, MOBS.mogger_lackey);
    for (let i = 0; i < 20 * 11; i++) inner(sim).updateBossMechanics(mogger); // 11s < 12s
    expect(ward(ally)).toBeUndefined();
  });

  it('does not tick the ward cast while the caster is stunned', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const mogger = spawn(sim, 9015, MOBS.mogger);
    const ally = spawn(sim, 9016, MOBS.mogger_lackey);
    mogger.auras.push({
      id: 'test_stun',
      name: 'Test Stun',
      kind: 'stun',
      remaining: 20,
      duration: 20,
      value: 0,
      sourceId: 0,
      school: 'physical',
    });
    for (let i = 0; i < 20 * 12 + 1; i++) inner(sim).updateBossMechanics(mogger);
    expect(mogger.wardTimer).toBe(MOBS.mogger.wardAllies!.every);
    expect(ward(ally)).toBeUndefined();
  });

  it('shields every ally in range plus the caster (AoE, healthy too)', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const mogger = spawn(sim, 9021, MOBS.mogger);
    const a = spawn(sim, 9022, MOBS.mogger_lackey); // full HP — a ward pre-empts damage
    const b = spawn(sim, 9023, MOBS.mogger_lackey);
    for (let i = 0; i < 20 * 12 + 1; i++) inner(sim).updateBossMechanics(mogger);
    expect(ward(a)?.value).toBe(70);
    expect(ward(b)?.value).toBe(70);
    expect(ward(mogger)?.value).toBe(70); // the caster wards itself too
  });

  it('the absorb soaks incoming damage before any HP is lost', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const mogger = spawn(sim, 9101, MOBS.mogger);
    const ally = spawn(sim, 9102, MOBS.mogger_lackey);
    for (let i = 0; i < 20 * 12 + 1; i++) inner(sim).updateBossMechanics(mogger);
    const hpBefore = ally.hp;
    // 50 damage < 70 shield → fully soaked, no HP loss, shield drops to 20.
    (
      sim as unknown as {
        dealDamage(
          s: Entity | null,
          t: Entity,
          amt: number,
          crit: boolean,
          school: string,
          ability: string | null,
          kind: string,
        ): void;
      }
    ).dealDamage(null, ally, 50, false, 'physical', null, 'hit');
    expect(ally.hp).toBe(hpBefore);
    expect(ward(ally)?.value).toBe(20);
  });

  it('ignores allies outside the ward radius', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const mogger = spawn(sim, 9031, MOBS.mogger);
    const far = spawn(sim, 9032, MOBS.mogger_lackey);
    far.pos = { x: 100, y: 0, z: 0 }; // well beyond radius 12
    for (let i = 0; i < 20 * 12 + 1; i++) inner(sim).updateBossMechanics(mogger);
    expect(ward(far)).toBeUndefined();
  });

  it('does not ward mobs of the opposing faction (players/pets excluded by faction)', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const mogger = spawn(sim, 9041, MOBS.mogger);
    const friendlyMob = spawn(sim, 9042, MOBS.mogger_lackey);
    friendlyMob.hostile = false; // flip faction
    for (let i = 0; i < 20 * 12 + 1; i++) inner(sim).updateBossMechanics(mogger);
    expect(ward(friendlyMob)).toBeUndefined();
  });

  it('re-arms the telegraph after Mogger evades and resets', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const mogger = spawn(sim, 9051, MOBS.mogger);
    inner(sim).resetEvadingMob(mogger);
    expect(mogger.wardTimer).toBe(MOBS.mogger.wardAllies!.every);
  });

  it('leaves mobs without the mechanic untouched', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const lackey = spawn(sim, 9061, MOBS.mogger_lackey);
    const ally = spawn(sim, 9062, MOBS.mogger_lackey);
    for (let i = 0; i < 20 * 12 + 1; i++) inner(sim).updateBossMechanics(lackey);
    expect(ward(ally)).toBeUndefined();
  });
});
