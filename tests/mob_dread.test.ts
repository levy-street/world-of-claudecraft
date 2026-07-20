import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';

const SEED = 5150;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior' });

// No SHIPPED mob carries `dread` anymore: the Gravecaller Summoner lost its "Wail
// of the Grave" fear-on-hit in the OP-crowd-control nerf. The fear-on-hit ENGINE
// path (runMobSwingAffixes' dread arm) still exists and must stay covered, so we
// register a synthetic carrier into the shared MOBS table for the life of this
// file: a copy of an existing humanoid stripped of its other affixes, with a
// dread proc pinned to 1 so a connecting swing always fears. Restored in afterAll
// so other suites see the unmodified table.
const DREAD_CARRIER_ID = 'test_dread_carrier';
beforeAll(() => {
  MOBS[DREAD_CARRIER_ID] = {
    ...MOBS.gravecaller_summoner,
    id: DREAD_CARRIER_ID,
    name: 'Test Dread Carrier',
    silence: undefined,
    healAbsorb: undefined,
    dread: { chance: 1, duration: 4, name: 'Wail of the Grave', school: 'shadow' },
  };
});
afterAll(() => {
  delete MOBS[DREAD_CARRIER_ID];
});

const dreadCarrier = () => MOBS[DREAD_CARRIER_ID];

describe('Dread fear-on-hit affix', () => {
  it('a landed dread-carrier swing can fear the victim', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.hp = 100000; // survive every swing so we observe the aura
    const mob = createMob(900600, dreadCarrier(), 12, { x: 0, y: 0, z: 0 });
    let applied = false;
    for (let i = 0; i < 60 && !applied; i++) {
      p.hp = p.maxHp; // a hit that connects must not kill before we read the aura
      (sim as any).mobSwing(mob, p);
      applied = p.auras.some((a) => a.id === 'fear_incap' && a.kind === 'incapacitate');
    }
    expect(applied).toBe(true);
    const a = p.auras.find((x) => x.id === 'fear_incap')!;
    expect(a.name).toBe('Wail of the Grave');
    expect(a.kind).toBe('incapacitate');
    expect(a.duration).toBe(4); // mob source gets the full authored duration (DR is PvP-only)
    // value is the panic heading, a finite angle in [-PI, PI]
    expect(Number.isFinite(a.value)).toBe(true);
    expect(Math.abs(a.value)).toBeLessThanOrEqual(Math.PI);
  });

  it('the fear aura drives the panicked flee movement', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.hp = 100000;
    const mob = createMob(900601, dreadCarrier(), 12, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 60 && !p.auras.some((a) => a.id === 'fear_incap'); i++) {
      p.hp = p.maxHp;
      (sim as any).mobSwing(mob, p);
    }
    expect(p.auras.some((a) => a.id === 'fear_incap')).toBe(true);
    // updateFearMovement returns true while the fear is active and no root holds.
    expect((sim as any).updateFearMovement(p)).toBe(true);
    const fear = p.auras.find((a) => a.id === 'fear_incap')!;
    fear.unbreakableControl = true;
    expect((sim as any).updateFearMovement(p)).toBe(true);
  });

  it('unbreakable encounter control freezes an already-feared player', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.hp = 100000;
    const mob = createMob(900604, dreadCarrier(), 12, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 60 && !p.auras.some((a) => a.id === 'fear_incap'); i++) {
      p.hp = p.maxHp;
      (sim as any).mobSwing(mob, p);
    }
    expect(p.auras.some((a) => a.id === 'fear_incap')).toBe(true);
    p.auras.push({
      id: 'scripted_stun',
      name: 'Scripted Stun',
      kind: 'stun',
      remaining: 10,
      duration: 10,
      value: 0,
      sourceId: mob.id,
      school: 'shadow',
      unbreakableControl: true,
    });

    expect((sim as any).updateFearMovement(p)).toBe(false);
  });

  it('a friendly pet swing (hostile=false) never fears the party', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.hp = 100000;
    const pet = createMob(900602, dreadCarrier(), 12, { x: 0, y: 0, z: 0 });
    pet.hostile = false; // pets call mobSwing too
    for (let i = 0; i < 60; i++) {
      p.hp = p.maxHp;
      (sim as any).mobSwing(pet, p);
    }
    expect(p.auras.some((a) => a.id === 'fear_incap')).toBe(false);
  });

  it('a mob without dread applies no fear', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.hp = 100000;
    const mob = createMob(900603, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 40; i++) {
      p.hp = p.maxHp;
      (sim as any).mobSwing(mob, p);
    }
    expect(p.auras.some((a) => a.id === 'fear_incap')).toBe(false);
  });

  it('the shipped Gravecaller Summoner no longer carries dread', () => {
    expect(MOBS.gravecaller_summoner.dread).toBeUndefined();
  });
});
