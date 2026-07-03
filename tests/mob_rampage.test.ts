import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';

const SEED = 42;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });

// Spawn Warlord Drogmar next to a beefy player so the fury can ramp over many
// landed swings without the target ever dropping.
const setup = () => {
  const sim = makeSim();
  const player = sim.player;
  player.maxHp = 100000;
  player.hp = player.maxHp;
  player.dodgeChance = 0; // never dodge: every swing lands and stokes the fury
  const mob = createMob(990700, MOBS.warlord_drogmar, 17, { x: 0, y: 0, z: 0 });
  sim.entities.set(mob.id, mob);
  return { sim, player, mob };
};

const rampageStacks = (mob: any) =>
  mob.auras.find((a: any) => a.id === `rampage_${mob.templateId}`)?.stacks ?? 0;

// Swing repeatedly, keeping the target topped off so no swing kills it.
const swingTimes = (sim: Sim, mob: any, target: any, n: number) => {
  for (let i = 0; i < n; i++) {
    target.hp = target.maxHp;
    (sim as any).mobSwing(mob, target);
  }
};

describe('mob Mounting Rage (Rampage)', () => {
  it('Warlord Drogmar carries the rampage mechanic', () => {
    const r = MOBS.warlord_drogmar.rampage;
    expect(r).toBeDefined();
    expect(r!.name).toBe('Mounting Rage');
    expect(r!.ap).toBeGreaterThan(0);
    expect(r!.maxStacks).toBeGreaterThan(1);
  });

  it('a landed hit applies a self buff_ap aura that grows the mob attack power', () => {
    const { sim, player, mob } = setup();
    const baseAp = (sim as any).effectiveAttackPower(mob);
    swingTimes(sim, mob, player, 1);
    expect(rampageStacks(mob)).toBe(1);
    // one stack of +ap is now folded into the mob's effective attack power
    expect((sim as any).effectiveAttackPower(mob)).toBe(baseAp + MOBS.warlord_drogmar.rampage!.ap);
  });

  it('stacks build with each landed swing up to the cap, and no further', () => {
    const { sim, player, mob } = setup();
    const { maxStacks, ap } = MOBS.warlord_drogmar.rampage!;
    const baseAp = (sim as any).effectiveAttackPower(mob);
    swingTimes(sim, mob, player, maxStacks + 10);
    expect(rampageStacks(mob)).toBe(maxStacks);
    // the single shared aura is valued at ap * maxStacks — never beyond the cap
    expect((sim as any).effectiveAttackPower(mob)).toBe(baseAp + ap * maxStacks);
    expect(mob.auras.filter((a: any) => a.id === `rampage_${mob.templateId}`).length).toBe(1);
  });

  it('a friendly pet never self-buffs (hostile guard)', () => {
    const { sim, player, mob } = setup();
    mob.hostile = false; // emulate a tamed pet swinging through mobSwing
    swingTimes(sim, mob, player, 5);
    expect(rampageStacks(mob)).toBe(0);
  });

  it('the fury falls off after its duration, undoing the ramp', () => {
    const { sim, player, mob } = setup();
    swingTimes(sim, mob, player, 3);
    expect(rampageStacks(mob)).toBeGreaterThan(0);
    const baseAp = mob.attackPower;
    // drop the player so the warlord stops swinging — otherwise it keeps landing
    // hits during tick() and refreshes the fury forever. Now let it time out.
    player.dead = true;
    player.hp = 0;
    for (let i = 0; i < 20 * (MOBS.warlord_drogmar.rampage!.duration + 2); i++) sim.tick();
    expect(rampageStacks(mob)).toBe(0);
    expect((sim as any).effectiveAttackPower(mob)).toBe(baseAp);
  });
});
