import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { createMob } from '../src/sim/entity';
import { MOBS } from '../src/sim/data';

// Staggering mobs knock a player victim off-balance on a landed hit, cutting
// their dodge chance for the duration so the attacker (and its pack) land more
// of their swings. It rides the existing buff_dodge aura with a NEGATIVE value,
// so recalcPlayerStats folds it straight into the victim's dodgeChance.
describe('mob stagger-on-hit', () => {
  it('the Deeprock Tunneler template carries a Jarring Swing proc', () => {
    expect(MOBS.deeprock_kobold.staggerHit).toMatchObject({
      chance: 0.3, dodgeReduction: 0.05, duration: 8, name: 'Off-Balance',
    });
  });

  it('a landed swing cuts the victim dodge via a negative buff_dodge aura', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Staggered');
    sim.setPlayerLevel(15);
    const victim = sim.entities.get(pid)!;
    victim.pos = { x: 1, y: 0, z: 0 };
    victim.maxHp = 100000;
    victim.hp = 100000;
    victim.gm = true; // invulnerable for the test; applyAura still fires

    const baseDodge = victim.dodgeChance;
    expect(baseDodge).toBeGreaterThan(0.05);

    const kobold = createMob((sim as any).nextId++, MOBS.deeprock_kobold, 15, { x: 0, y: 0, z: 0 });
    kobold.hostile = true;
    kobold.hp = kobold.maxHp;
    (sim as any).addEntity(kobold);

    // Force a landed hit (high roll clears miss+dodge) and a proc, so the test
    // asserts the mechanic, not the RNG.
    (sim as any).rng.next = () => 0.99;
    (sim as any).rng.chance = () => true;
    (sim as any).mobSwing(kobold, victim);

    const aura = victim.auras.find((a) => a.name === 'Off-Balance');
    expect(aura).toBeTruthy();
    expect(aura!.kind).toBe('buff_dodge');
    expect(aura!.value).toBe(-0.05);
    expect(aura!.duration).toBe(8);
    // recalcPlayerStats already folded the negative buff_dodge into dodgeChance.
    expect(victim.dodgeChance).toBeCloseTo(Math.max(0, baseDodge - 0.05), 6);
  });

  it('re-applies (refreshes) rather than stacking on repeated hits', () => {
    const sim = new Sim({ seed: 11, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Hounded');
    sim.setPlayerLevel(15);
    const victim = sim.entities.get(pid)!;
    victim.pos = { x: 1, y: 0, z: 0 };
    victim.maxHp = 100000;
    victim.hp = 100000;
    victim.gm = true; // invulnerable for the test; applyAura still fires

    const kobold = createMob((sim as any).nextId++, MOBS.deeprock_kobold, 15, { x: 0, y: 0, z: 0 });
    kobold.hostile = true;
    kobold.hp = kobold.maxHp;
    (sim as any).addEntity(kobold);

    (sim as any).rng.next = () => 0.99;
    (sim as any).rng.chance = () => true;
    for (let i = 0; i < 10; i++) (sim as any).mobSwing(kobold, victim);

    const staggers = victim.auras.filter((a) => a.name === 'Off-Balance');
    expect(staggers.length).toBe(1);
    expect(staggers[0].value).toBe(-0.05);
  });

  it('the dodge floor keeps dodgeChance from going negative', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Floored');
    sim.setPlayerLevel(15);
    const victim = sim.entities.get(pid)!;

    // A reduction larger than the victim's whole dodge clamps to exactly 0.
    (sim as any).applyAura(victim, {
      id: 'stagger_test', name: 'Off-Balance', kind: 'buff_dodge',
      remaining: 8, duration: 8, value: -1, sourceId: victim.id, school: 'physical',
    });
    expect(victim.dodgeChance).toBe(0);
  });

  it('an ordinary mob with no staggerHit field never applies the debuff', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Safe');
    sim.setPlayerLevel(15);
    const victim = sim.entities.get(pid)!;
    victim.pos = { x: 1, y: 0, z: 0 };
    victim.maxHp = 100000;
    victim.hp = 100000;
    victim.gm = true; // invulnerable for the test; applyAura still fires

    const wolf = createMob((sim as any).nextId++, MOBS.forest_wolf, 2, { x: 0, y: 0, z: 0 });
    wolf.hostile = true;
    wolf.hp = wolf.maxHp;
    (sim as any).addEntity(wolf);

    // Even with every swing landing and every proc roll true, a mob without the
    // staggerHit field can never inflict Off-Balance.
    (sim as any).rng.next = () => 0.99;
    (sim as any).rng.chance = () => true;
    for (let i = 0; i < 50; i++) (sim as any).mobSwing(wolf, victim);
    expect(victim.auras.some((a) => a.name === 'Off-Balance')).toBe(false);
  });
});
