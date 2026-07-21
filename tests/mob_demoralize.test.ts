import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { createMob } from '../src/sim/entity';
import { MOBS } from '../src/sim/data';

// Demoralizing mobs sap a player victim's attack power on a landed hit
// (classic Demoralizing Shout / Curse of Weakness), so the damage *they*
// deal back is weaker for the duration.
describe('mob demoralize-on-hit', () => {
  it('the Restless Bones template carries a Withering Wail proc', () => {
    expect(MOBS.restless_bones.demoralize).toMatchObject({
      ap: 20, duration: 8, name: 'Withering Wail',
    });
  });

  it('a landed swing weakens the victim attack power via a negative buff_ap aura', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Weakened');
    const victim = sim.entities.get(pid)!;
    victim.pos = { x: 1, y: 0, z: 0 };
    victim.maxHp = 100000;
    victim.hp = 100000;

    const bones = createMob((sim as any).nextId++, MOBS.restless_bones, 7, { x: 0, y: 0, z: 0 });
    bones.hostile = true;
    bones.hp = bones.maxHp;
    (sim as any).addEntity(bones);

    const baseAp = (sim as any).effectiveAttackPower(victim);

    // Force this single swing to land regardless of world-gen RNG state (mobSwing's
    // first rng.next() is the miss/dodge roll).
    const rng = (sim as any).rng;
    const realNext = rng.next.bind(rng);
    let firstRoll = true;
    rng.next = () => { if (firstRoll) { firstRoll = false; return 0.999; } return realNext(); };
    try {
      (sim as any).mobSwing(bones, victim);
    } finally {
      rng.next = realNext;
    }

    const aura = victim.auras.find((a) => a.name === 'Withering Wail');
    expect(aura).toBeTruthy();
    expect(aura!.kind).toBe('buff_ap');
    expect(aura!.value).toBe(-20);
    expect(aura!.duration).toBe(8);
    // The negative buff_ap is consumed by effectiveAttackPower, so the victim
    // now hits for less.
    expect((sim as any).effectiveAttackPower(victim)).toBe(baseAp - 20);
  });

  it('re-applies (refreshes) rather than stacking on repeated hits', () => {
    const sim = new Sim({ seed: 11, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Hounded');
    const victim = sim.entities.get(pid)!;
    victim.pos = { x: 1, y: 0, z: 0 };
    victim.maxHp = 100000;
    victim.hp = 100000;

    const bones = createMob((sim as any).nextId++, MOBS.restless_bones, 7, { x: 0, y: 0, z: 0 });
    bones.hostile = true;
    bones.hp = bones.maxHp;
    (sim as any).addEntity(bones);

    for (let i = 0; i < 10; i++) (sim as any).mobSwing(bones, victim);

    const wails = victim.auras.filter((a) => a.name === 'Withering Wail');
    expect(wails.length).toBe(1);
    expect(wails[0].value).toBe(-20);
  });

  it('an ordinary mob with no demoralize field never applies the debuff', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Safe');
    const victim = sim.entities.get(pid)!;
    victim.pos = { x: 1, y: 0, z: 0 };
    victim.maxHp = 100000;
    victim.hp = 100000;

    const wolf = createMob((sim as any).nextId++, MOBS.forest_wolf, 2, { x: 0, y: 0, z: 0 });
    wolf.hostile = true;
    wolf.hp = wolf.maxHp;
    (sim as any).addEntity(wolf);

    for (let i = 0; i < 50; i++) (sim as any).mobSwing(wolf, victim);
    expect(victim.auras.some((a) => a.kind === 'buff_ap')).toBe(false);
  });
});
