import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

const SEED = 42;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });

// Spawn a Drowned Dead next to the player, sitting at a fixed missing-health
// deficit so any leech proc has room to heal.
const setup = () => {
  const sim = makeSim();
  const player = sim.player;
  const mob = createMob(990600, MOBS.drowned_dead, 11, { x: 0, y: 0, z: 0 });
  mob.maxHp = 400;
  mob.hp = 100; // big deficit so a heal is always observable
  sim.entities.set(mob.id, mob);
  return { sim, player, mob };
};

// Swing until a hit lands (a swing can miss/dodge) and the mob's hp moves up.
const swingUntilLeech = (sim: Sim, mob: any, target: any, max = 400) => {
  for (let i = 0; i < max; i++) {
    target.hp = target.maxHp; // keep the target alive; never let a swing kill it
    const before = mob.hp;
    (sim as any).mobSwing(mob, target);
    if (mob.hp > before) return true;
  }
  return false;
};

describe('mob lifesteal (Drowning Grasp)', () => {
  it('Drowned Dead template carries the lifeleech mechanic', () => {
    expect(MOBS.drowned_dead.lifeleech).toBeDefined();
    expect(MOBS.drowned_dead.lifeleech!.name).toBe('Drowning Grasp');
    expect(MOBS.drowned_dead.lifeleech!.healFrac).toBeGreaterThan(0);
  });

  it('a landed hit heals the mob for a fraction of the damage dealt', () => {
    const { sim, player, mob } = setup();
    const leech = MOBS.drowned_dead.lifeleech!;
    const old = leech.chance;
    leech.chance = 1;
    try {
      expect(swingUntilLeech(sim, mob, player)).toBe(true);
    } finally {
      leech.chance = old;
    }
    expect(mob.hp).toBeGreaterThan(100);
  });

  it('never heals the mob above its maximum health', () => {
    const { sim, player, mob } = setup();
    mob.hp = mob.maxHp - 1; // almost full: a 50% leech would overheal without the cap
    const leech = MOBS.drowned_dead.lifeleech!;
    const old = leech.chance;
    leech.chance = 1;
    try {
      for (let i = 0; i < 50; i++) { player.hp = player.maxHp; (sim as any).mobSwing(mob, player); }
    } finally {
      leech.chance = old;
    }
    expect(mob.hp).toBe(mob.maxHp);
  });

  it('a friendly pet never leeches (hostile guard)', () => {
    const { sim, player, mob } = setup();
    mob.hostile = false; // emulate a tamed pet swinging
    const leech = MOBS.drowned_dead.lifeleech!;
    const old = leech.chance;
    leech.chance = 1;
    try {
      for (let i = 0; i < 50; i++) { player.hp = player.maxHp; (sim as any).mobSwing(mob, player); }
    } finally {
      leech.chance = old;
    }
    expect(mob.hp).toBe(100); // unchanged from setup
  });

  it('emits a heal event targeting the mob on a leech proc', () => {
    const { sim, player, mob } = setup();
    const leech = MOBS.drowned_dead.lifeleech!;
    const old = leech.chance;
    leech.chance = 1;
    let healEvent = false;
    try {
      for (let i = 0; i < 400 && !healEvent; i++) {
        player.hp = player.maxHp;
        (sim as any).events.length = 0;
        (sim as any).mobSwing(mob, player);
        healEvent = (sim as any).events.some((ev: any) => ev.type === 'heal' && ev.targetId === mob.id);
      }
    } finally {
      leech.chance = old;
    }
    expect(healEvent).toBe(true);
  });
});
