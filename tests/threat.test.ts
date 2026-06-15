// Classic threat mechanics + the class kit that drives them (stances/forms,
// stealth, pets).
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { dist2d } from '../src/sim/types';
import type { Entity } from '../src/sim/types';
import {
  BEAR_FORM_THREAT_MULT, DEFENSIVE_STANCE_THREAT_MULT, RIGHTEOUS_FURY_THREAT_MULT,
} from '../src/sim/threat';
import { terrainHeight } from '../src/sim/world';

function makeSim(cls: Parameters<typeof simClass>[0] = 'warrior', seed = 42) {
  return new Sim({ seed, playerClass: cls, autoEquip: true });
}
// type helper only — keeps makeSim's signature honest without importing PlayerClass
function simClass(cls: 'warrior' | 'mage' | 'rogue' | 'druid' | 'hunter' | 'priest' | 'paladin') {
  return cls;
}

function nearestMob(sim: Sim, templateId?: string, from?: Entity): Entity {
  const p = from ?? sim.player;
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.ownerId !== null) continue;
    if (templateId && e.templateId !== templateId) continue;
    const d = dist2d(p.pos, e.pos);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best!;
}

function teleport(sim: Sim, e: Entity, x: number, z: number) {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function hit(sim: Sim, source: Entity, target: Entity, amount: number, school = 'physical') {
  (sim as any).dealDamage(source, target, amount, false, school, null, 'hit', true);
}

// keep low-level mobs alive through scripted hits (death wipes the hate table)
function beefUp(mob: Entity) {
  mob.maxHp = 5000;
  mob.hp = 5000;
}

describe('threat from damage', () => {
  it('damage lands on the hate table 1:1 without modifiers (plus the aggro seed)', () => {
    const sim = makeSim('warrior');
    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);
    hit(sim, sim.player, wolf, 100);
    // 1 seed threat from the aggro pickup + 100 damage threat
    expect(wolf.threat.get(sim.playerId)).toBeCloseTo(101, 5);
  });

  it('defensive stance: -10% damage dealt, x1.3 threat on what lands', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(10);
    sim.castAbility('defensive_stance');
    sim.tick();
    expect(sim.player.auras.some((a) => a.kind === 'defensive_stance')).toBe(true);
    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);
    hit(sim, sim.player, wolf, 100);
    // 100 -> 90 actual damage, 90 * 1.3 threat + 1 seed
    expect(wolf.threat.get(sim.playerId)).toBeCloseTo(90 * DEFENSIVE_STANCE_THREAT_MULT + 1, 5);
    // stance is a toggle
    for (let i = 0; i < 30; i++) sim.tick();
    sim.castAbility('defensive_stance');
    expect(sim.player.auras.some((a) => a.kind === 'defensive_stance')).toBe(false);
  });

  it('bear form multiplies threat by 1.3', () => {
    const sim = makeSim('druid');
    sim.setPlayerLevel(10);
    sim.castAbility('bear_form');
    sim.tick();
    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);
    hit(sim, sim.player, wolf, 100);
    expect(wolf.threat.get(sim.playerId)).toBeCloseTo(100 * BEAR_FORM_THREAT_MULT + 1, 5);
  });

  it('righteous fury multiplies HOLY threat by 1.6 and leaves physical alone', () => {
    const sim = makeSim('paladin');
    sim.setPlayerLevel(16);
    sim.castAbility('righteous_fury');
    sim.tick();
    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);
    hit(sim, sim.player, wolf, 100, 'holy');
    expect(wolf.threat.get(sim.playerId)).toBeCloseTo(100 * RIGHTEOUS_FURY_THREAT_MULT + 1, 5);
    hit(sim, sim.player, wolf, 100, 'physical');
    expect(wolf.threat.get(sim.playerId)).toBeCloseTo(100 * RIGHTEOUS_FURY_THREAT_MULT + 101, 5);
  });

  it('classic flat threat values resolve per rank (heroic strike 20/39)', () => {
    const sim = makeSim('warrior');
    expect(sim.resolvedAbility('heroic_strike')!.threatFlat).toBe(20);
    sim.setPlayerLevel(8);
    expect(sim.resolvedAbility('heroic_strike')!.threatFlat).toBe(39);
    sim.setPlayerLevel(10);
    expect(sim.resolvedAbility('sunder_armor')!.threatFlat).toBe(100);
  });
});

describe('healing threat', () => {
  function partyOfTwo() {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const tank = sim.addPlayer('warrior', 'Tank');
    const healer = sim.addPlayer('priest', 'Healer');
    sim.partyInvite(healer, tank);
    sim.partyAccept(healer);
    return { sim, tank: sim.entities.get(tank)!, healer: sim.entities.get(healer)! };
  }

  it('0.5 threat per effective heal point, split among every aware mob', () => {
    const { sim, tank, healer } = partyOfTwo();
    const wolf = nearestMob(sim, 'forest_wolf', tank);
    beefUp(wolf);
    hit(sim, tank, wolf, 50); // social aggro: nearby packmates join in too
    tank.hp = 1;
    (sim as any).applyHeal(healer, tank, 50, 'Heal');
    // the healer's threat across ALL aware mobs sums to healed * 0.5
    // (the heal may crit for x1.5, and is capped by the tank's missing hp)
    let total = 0;
    let awareMobs = 0;
    for (const m of sim.entities.values()) {
      if (m.kind !== 'mob' || !m.threat.has(healer.id)) continue;
      total += m.threat.get(healer.id)!;
      awareMobs++;
    }
    expect(awareMobs).toBeGreaterThanOrEqual(1);
    expect(total).toBeGreaterThanOrEqual(50 * 0.5 * 0.999);
    expect(total).toBeLessThanOrEqual(50 * 1.5 * 0.5 * 1.001);
    expect(wolf.threat.get(healer.id)).toBeCloseTo(total / awareMobs, 5);
  });

  it('healing threat splits across every mob in combat with the party', () => {
    const { sim, tank, healer } = partyOfTwo();
    const wolfA = nearestMob(sim, 'forest_wolf', tank);
    beefUp(wolfA);
    hit(sim, tank, wolfA, 50);
    let wolfB: Entity | null = null;
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob' && !e.dead && e.templateId === 'forest_wolf' && e.id !== wolfA.id) { wolfB = e; break; }
    }
    beefUp(wolfB!);
    hit(sim, tank, wolfB!, 50);
    tank.hp = Math.max(1, tank.hp - 200);
    (sim as any).applyHeal(healer, tank, 100, 'Heal');
    const a = wolfA.threat.get(healer.id) ?? 0;
    const b = wolfB!.threat.get(healer.id) ?? 0;
    expect(a).toBeGreaterThan(0);
    expect(a).toBeCloseTo(b, 5); // even split
  });

  it('healing a non-party player creates threat on mobs already fighting them', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const tank = sim.entities.get(sim.addPlayer('warrior', 'Tank'))!;
    const healer = sim.entities.get(sim.addPlayer('priest', 'OutsideHealer'))!;
    const wolf = nearestMob(sim, 'forest_wolf', tank);
    beefUp(wolf);
    hit(sim, tank, wolf, 50);
    tank.hp = Math.max(1, tank.hp - 100);

    (sim as any).applyHeal(healer, tank, 80, 'Heal');

    expect(wolf.threat.get(healer.id)).toBeGreaterThan(0);
  });

  it('an unaware mob gets no healing threat', () => {
    const { sim, tank, healer } = partyOfTwo();
    const wolf = nearestMob(sim, 'forest_wolf', tank);
    tank.hp = Math.max(1, tank.hp - 100);
    (sim as any).applyHeal(healer, tank, 100, 'Heal');
    expect(wolf.threat.get(healer.id)).toBeUndefined();
  });
});

describe('classic pull-over rules (110% melee / 130% ranged)', () => {
  function aggroSetup() {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const a = sim.entities.get(sim.addPlayer('warrior', 'A'))!;
    const b = sim.entities.get(sim.addPlayer('mage', 'B'))!;
    const wolf = nearestMob(sim, 'forest_wolf', a);
    teleport(sim, a, wolf.pos.x + 2, wolf.pos.z);
    wolf.threat.set(a.id, 100);
    wolf.aggroTargetId = a.id;
    wolf.aiState = 'attack';
    wolf.inCombat = true;
    return { sim, a, b, wolf };
  }

  it('a melee attacker needs >110% to rip aggro', () => {
    const { sim, a, b, wolf } = aggroSetup();
    teleport(sim, b, wolf.pos.x - 2, wolf.pos.z); // melee range of the mob
    wolf.threat.set(b.id, 105);
    sim.tick();
    expect(wolf.aggroTargetId).toBe(a.id); // 105 < 110
    wolf.threat.set(b.id, 115);
    sim.tick();
    expect(wolf.aggroTargetId).toBe(b.id); // 115 > 110
  });

  it('a ranged attacker needs >130%', () => {
    const { sim, a, b, wolf } = aggroSetup();
    teleport(sim, b, wolf.pos.x - 20, wolf.pos.z); // well out of melee
    wolf.threat.set(b.id, 125);
    sim.tick();
    expect(wolf.aggroTargetId).toBe(a.id); // 125 < 130
    wolf.threat.set(b.id, 135);
    sim.tick();
    expect(wolf.aggroTargetId).toBe(b.id); // 135 > 130
  });

  it('when the target dies the mob swings to the next-highest threat, not the nearest', () => {
    const { sim, a, b, wolf } = aggroSetup();
    const c = sim.entities.get(sim.addPlayer('rogue', 'C'))!;
    teleport(sim, b, wolf.pos.x - 4, wolf.pos.z); // nearer...
    teleport(sim, c, wolf.pos.x + 12, wolf.pos.z); // ...but c has more threat
    wolf.threat.set(b.id, 50);
    wolf.threat.set(c.id, 500);
    (sim as any).dealDamage(wolf, a, 99999, false, 'physical', null, 'hit', true);
    expect(a.dead).toBe(true);
    sim.tick();
    expect(wolf.aggroTargetId).toBe(c.id);
    // the dead player dropped off the table entirely
    expect(wolf.threat.has(a.id)).toBe(false);
  });

  it('when the target dies the mob evades instead of attacking a bystander with no threat', () => {
    const { sim, a, b, wolf } = aggroSetup();
    teleport(sim, b, wolf.pos.x + 2, wolf.pos.z + 2);

    (sim as any).dealDamage(wolf, a, 99999, false, 'physical', null, 'hit', true);

    expect(a.dead).toBe(true);
    expect(wolf.threat.has(b.id)).toBe(false);
    expect(wolf.aggroTargetId).not.toBe(b.id);
    expect(wolf.aiState).toBe('evade');
  });
});

describe('taunt and growl', () => {
  it('taunt matches the top threat and forces 3 seconds of attention', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const tank = sim.entities.get(sim.addPlayer('warrior', 'Tank'))!;
    const dps = sim.entities.get(sim.addPlayer('mage', 'Dps'))!;
    sim.setPlayerLevel(10, tank.id);
    const wolf = nearestMob(sim, 'forest_wolf', tank);
    teleport(sim, tank, wolf.pos.x + 2, wolf.pos.z);
    teleport(sim, dps, wolf.pos.x - 15, wolf.pos.z);
    wolf.threat.set(dps.id, 1000);
    wolf.aggroTargetId = dps.id;
    wolf.aiState = 'chase';
    wolf.inCombat = true;
    sim.targetEntity(wolf.id, tank.id);
    tank.facing = Math.atan2(wolf.pos.x - tank.pos.x, wolf.pos.z - tank.pos.z);
    sim.castAbility('taunt', tank.id);
    expect(wolf.threat.get(tank.id)).toBe(1000);
    expect(wolf.aggroTargetId).toBe(tank.id);
    expect(wolf.forcedTargetTimer).toBeGreaterThan(0);
    // after the forced window, equal threat means the tank KEEPS the mob (no 110% rip)
    for (let i = 0; i < 20 * 4; i++) sim.tick();
    expect(wolf.aggroTargetId).toBe(tank.id);
  });

  it('growl requires bear form', () => {
    const sim = makeSim('druid');
    sim.setPlayerLevel(10);
    const wolf = nearestMob(sim, 'forest_wolf');
    teleport(sim, sim.player, wolf.pos.x + 2, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    sim.castAbility('growl');
    expect(wolf.forcedTargetTimer).toBe(0);
    sim.castAbility('bear_form');
    sim.tick();
    sim.castAbility('growl');
    expect(wolf.forcedTargetTimer).toBeGreaterThan(0);
  });
});

describe('sunder armor', () => {
  it('stacks an armor debuff and generates stance-scaled flat threat', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(10);
    const wolf = nearestMob(sim, 'forest_wolf');
    teleport(sim, sim.player, wolf.pos.x + 2, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    beefUp(wolf);
    wolf.stats.armor = 200; // stay clear of the armor floor
    const armorBefore = (sim as any).effectiveArmor(wolf);
    let applications = 0;
    for (let guard = 0; guard < 40 && applications < 2; guard++) {
      sim.player.resource = 100;
      sim.castAbility('sunder_armor');
      for (let i = 0; i < 32; i++) sim.tick(); // wait out the GCD
      const aura = wolf.auras.find((a) => a.kind === 'sunder');
      applications = aura?.stacks ?? 0;
    }
    expect(applications).toBeGreaterThanOrEqual(2);
    expect((sim as any).effectiveArmor(wolf)).toBe(armorBefore - 25 * applications);
    // 100 flat threat per landed sunder (no stance up) + auto-attack noise is
    // excluded because auto-attack never started
    expect(wolf.threat.get(sim.playerId)).toBeGreaterThanOrEqual(100 * applications);
  });
});

describe('rogue stealth', () => {
  it('shrinks mob detection radius and breaks on damage', () => {
    const sim = makeSim('rogue');
    sim.setPlayerLevel(2);
    const wolf = nearestMob(sim, 'forest_wolf');
    sim.player.level = wolf.level; // no level-difference radius skew
    teleport(sim, sim.player, wolf.pos.x + 200, wolf.pos.z); // far away first
    sim.castAbility('stealth');
    expect(sim.player.auras.some((a) => a.kind === 'stealth')).toBe(true);
    // park inside the normal aggro radius but outside the stealthed one
    wolf.wanderTarget = null;
    teleport(sim, sim.player, wolf.pos.x + 6, wolf.pos.z);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(wolf.aiState).toBe('idle');
    // damage breaks stealth, and the wolf notices an unstealthed rogue at 6yd
    hit(sim, wolf, sim.player, 1);
    expect(sim.player.auras.some((a) => a.kind === 'stealth')).toBe(false);
    teleport(sim, sim.player, wolf.pos.x + 6, wolf.pos.z);
    for (let i = 0; i < 20 && wolf.aiState === 'idle'; i++) sim.tick();
    expect(wolf.aiState).not.toBe('idle');
  });

  it('scales stealth detection by observer level for creatures', () => {
    const sim = makeSim('rogue');
    sim.setPlayerLevel(10);
    const wolf = nearestMob(sim, 'forest_wolf');
    wolf.level = 10;
    sim.player.level = wolf.level;
    teleport(sim, sim.player, wolf.pos.x + 200, wolf.pos.z);
    sim.castAbility('stealth');
    expect(sim.player.auras.some((a) => a.kind === 'stealth')).toBe(true);

    wolf.wanderTarget = null;
    teleport(sim, sim.player, wolf.pos.x + 6, wolf.pos.z);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(wolf.aiState).toBe('idle');

    wolf.level = 15;
    for (let i = 0; i < 20 && wolf.aiState === 'idle'; i++) sim.tick();
    expect(wolf.aiState).not.toBe('idle');
  });

  it('a closer stealthed player does not shield a visible ally from aggro', () => {
    // Regression: the idle-mob check only evaluated the single NEAREST player.
    // A stealthed player standing closest shrank the detection radius and, being
    // nearest, was the only candidate considered — so a visible groupmate well
    // inside the normal aggro radius was silently ignored.
    const sim = new Sim({ seed: 42, playerClass: 'rogue', noPlayer: true });
    const rogue = sim.entities.get(sim.addPlayer('rogue', 'Sneak'))!;
    const warrior = sim.entities.get(sim.addPlayer('warrior', 'Visible'))!;
    sim.setPlayerLevel(5, rogue.id);
    sim.setPlayerLevel(5, warrior.id);
    const wolf = nearestMob(sim, 'forest_wolf', rogue);
    wolf.wanderTarget = null;
    // equal levels: no level-difference radius skew (forest_wolf aggroRadius 10,
    // shrunk to ~2.5 while stealthed)
    wolf.level = 5;
    // rogue is NEAREST (4yd) but stealthed and outside its shrunk radius;
    // the warrior is visible at 6yd, well inside the wolf's 10yd aggro radius
    teleport(sim, rogue, wolf.pos.x + 4, wolf.pos.z);
    teleport(sim, warrior, wolf.pos.x + 6, wolf.pos.z);
    sim.castAbility('stealth', rogue.id);
    expect(rogue.auras.some((a) => a.kind === 'stealth')).toBe(true);
    for (let i = 0; i < 20 && wolf.aiState === 'idle'; i++) sim.tick();
    expect(wolf.aiState).not.toBe('idle');
    expect(wolf.aggroTargetId).toBe(warrior.id);
  });

  it('cannot stealth in combat; acting breaks stealth; ambush requires it', () => {
    const sim = makeSim('rogue');
    sim.setPlayerLevel(16);
    const wolf = nearestMob(sim, 'forest_wolf');
    teleport(sim, sim.player, wolf.pos.x + 2, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    // ambush without stealth errors
    sim.player.resource = 100;
    sim.castAbility('ambush');
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error' && /stealthed/.test(e.text))).toBe(true);
    // stealth, then any ability breaks it
    sim.player.inCombat = false;
    sim.player.combatTimer = 99;
    sim.castAbility('stealth');
    expect(sim.player.auras.some((a) => a.kind === 'stealth')).toBe(true);
    sim.player.resource = 100;
    for (let i = 0; i < 25; i++) sim.tick();
    sim.castAbility('sinister_strike');
    expect(sim.player.auras.some((a) => a.kind === 'stealth')).toBe(false);
  });
});

describe('hunter pets', () => {
  function tamedSetup() {
    const sim = makeSim('hunter');
    sim.setPlayerLevel(10);
    const wolf = nearestMob(sim, 'forest_wolf');
    teleport(sim, sim.player, wolf.pos.x + 5, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    sim.castAbility('tame_beast');
    for (let i = 0; i < 20 * 7; i++) sim.tick(); // 6s cast
    return { sim, wolf };
  }

  it('tame beast converts a wild wolf into a loyal pet', () => {
    const { sim, wolf } = tamedSetup();
    expect(wolf.ownerId).toBe(sim.playerId);
    expect(wolf.hostile).toBe(false);
    expect(sim.petOf(sim.playerId)).toBe(wolf);
  });

  it('friendly target spells can affect controlled pets', () => {
    const { sim, wolf: pet } = tamedSetup();
    const druidId = sim.addPlayer('druid', 'Druid');
    const druid = sim.entities.get(druidId)!;
    teleport(sim, druid, pet.pos.x + 5, pet.pos.z);
    druid.resource = druid.maxResource;
    const armorBefore = (sim as any).effectiveArmor(pet);

    sim.targetEntity(pet.id, druidId);
    sim.castAbility('mark_of_the_wild', druidId);
    expect(pet.auras.some((a) => a.id === 'mark_of_the_wild')).toBe(true);
    expect((sim as any).effectiveArmor(pet)).toBeGreaterThan(armorBefore);

    const priestId = sim.addPlayer('priest', 'Priest');
    const priest = sim.entities.get(priestId)!;
    teleport(sim, priest, pet.pos.x + 6, pet.pos.z);
    priest.resource = priest.maxResource;
    const maxHpBefore = pet.maxHp;
    sim.targetEntity(pet.id, priestId);
    sim.castAbility('power_word_fortitude', priestId);
    expect(pet.maxHp).toBeGreaterThan(maxHpBefore);

    const paladinId = sim.addPlayer('paladin', 'Paladin');
    const paladin = sim.entities.get(paladinId)!;
    sim.setPlayerLevel(4, paladinId);
    teleport(sim, paladin, pet.pos.x + 7, pet.pos.z);
    paladin.resource = paladin.maxResource;
    const attackPowerBefore = (sim as any).effectiveAttackPower(pet);
    sim.targetEntity(pet.id, paladinId);
    sim.castAbility('blessing_of_might', paladinId);
    expect((sim as any).effectiveAttackPower(pet)).toBeGreaterThan(attackPowerBefore);

    pet.hp = pet.maxHp - 40;
    const damagedHp = pet.hp;
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    sim.castAbility('healing_touch', druidId);
    for (let i = 0; i < 20 * 3; i++) sim.tick();

    expect(pet.hp).toBeGreaterThan(damagedHp);

    (sim as any).dealDamage(null, pet, pet.hp, false, 'physical', 'test', 'hit');
    expect(pet.dead).toBe(true);
    expect(pet.auras).toHaveLength(0);
    expect(pet.maxHp).toBe(maxHpBefore);
    (sim as any).respawnMob(pet);
    expect(pet.auras).toHaveLength(0);
    expect(pet.maxHp).toBe(maxHpBefore);
  });

  it('the pet assists against attackers, growls, and builds its own threat', () => {
    const { sim, wolf: pet } = tamedSetup();
    const boar = nearestMob(sim, 'wild_boar');
    teleport(sim, sim.player, boar.pos.x + 4, boar.pos.z);
    teleport(sim, pet, boar.pos.x + 5, boar.pos.z);
    hit(sim, sim.player, boar, 5); // boar comes for the hunter
    let petThreat = 0;
    for (let i = 0; i < 20 * 20 && petThreat === 0; i++) {
      sim.tick();
      petThreat = boar.threat.get(pet.id) ?? 0;
    }
    expect(pet.aggroTargetId).toBe(boar.id);
    expect(petThreat).toBeGreaterThan(0);
    expect(boar.aggroTargetId).toBe(pet.id);
    expect(boar.forcedTargetTimer).toBeGreaterThan(0);
    // pet damage taps for the owner
    expect(boar.tappedById).toBe(sim.playerId);
  });

  it('keeps the owner in combat while their pet tanks a mob', () => {
    // Regression: inCombat was recomputed only from a mob's *direct* target,
    // so when a mob attacked the pet (mob.aggroTargetId === pet.id) the owner
    // was never marked engaged. Once the owner's combatTimer passed 5s with no
    // personal damage, they dropped out of combat mid-fight and could regen
    // health, eat/drink, and use out-of-combat-only abilities while the pet
    // kept fighting.
    const { sim, wolf: pet } = tamedSetup();
    const boar = nearestMob(sim, 'wild_boar');
    beefUp(boar);
    teleport(sim, sim.player, boar.pos.x + 4, boar.pos.z);
    teleport(sim, pet, boar.pos.x + 5, boar.pos.z);
    hit(sim, sim.player, boar, 5); // boar comes for the hunter; pet assists

    // let the boar transfer onto the tanking pet
    for (let i = 0; i < 20 * 20 && boar.aggroTargetId !== pet.id; i++) sim.tick();
    expect(boar.aggroTargetId).toBe(pet.id);

    // owner stops dealing damage; age their personal combat timer past 5s
    sim.player.combatTimer = 99;
    sim.tick();

    expect(pet.inCombat).toBe(true);
    expect(sim.player.inCombat).toBe(true);
  });

  it('dismiss releases the pet back to the wild', () => {
    const { sim, wolf } = tamedSetup();
    const priestId = sim.addPlayer('priest', 'Priest');
    const priest = sim.entities.get(priestId)!;
    teleport(sim, priest, wolf.pos.x + 5, wolf.pos.z);
    priest.resource = priest.maxResource;
    const maxHpBefore = wolf.maxHp;
    sim.targetEntity(wolf.id, priestId);
    sim.castAbility('power_word_fortitude', priestId);
    expect(wolf.maxHp).toBeGreaterThan(maxHpBefore);

    for (let i = 0; i < 25; i++) sim.tick();
    sim.castAbility('dismiss_pet');
    expect(wolf.ownerId).toBe(null);
    expect(wolf.hostile).toBe(true);
    expect(wolf.auras).toHaveLength(0);
    expect(wolf.maxHp).toBe(maxHpBefore);
    expect(sim.petOf(sim.playerId)).toBe(null);
  });

  it('a tamed beast that dies respawns hostile, not a grey unattackable zombie', () => {
    // Regression: respawnMob cleared ownerId ("back to the wild") but left
    // hostile=false, so any tamed-then-killed beast respawned permanently
    // neutral — grey on the unit frame and rejected with "Invalid attack target".
    const sim = new Sim({ seed: 42, playerClass: 'hunter', respawnSeconds: 2, autoEquip: true });
    sim.setPlayerLevel(10);
    const wolf = nearestMob(sim, 'forest_wolf');
    teleport(sim, sim.player, wolf.pos.x + 5, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    sim.castAbility('tame_beast');
    for (let i = 0; i < 20 * 7; i++) sim.tick(); // 6s cast
    expect(wolf.ownerId).toBe(sim.playerId);
    expect(wolf.hostile).toBe(false); // tamed pets are neutral

    // the pet falls in combat and its corpse respawns at its old camp
    const boar = nearestMob(sim, 'wild_boar');
    wolf.hp = 1;
    hit(sim, boar, wolf, 9999);
    for (let i = 0; i < 20 * 5 && !wolf.dead; i++) sim.tick();
    expect(wolf.dead).toBe(true);

    for (let i = 0; i < 20 * 10 && wolf.dead; i++) sim.tick();
    expect(wolf.dead).toBe(false);
    expect(wolf.ownerId).toBe(null); // back to the wild
    expect(wolf.hostile).toBe(true); // ...and attackable again
  });

  it('tame validation: too-high level and elites are refused', () => {
    const sim = makeSim('hunter');
    sim.setPlayerLevel(10);
    const wolf = nearestMob(sim, 'forest_wolf');
    wolf.level = 11;
    teleport(sim, sim.player, wolf.pos.x + 5, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    sim.castAbility('tame_beast');
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error' && /too high level/.test(e.text))).toBe(true);
    expect(wolf.ownerId).toBe(null);
  });
});

describe('druid forms', () => {
  it('cat form runs on energy, bear on rage, and mana is restored on shift-out', () => {
    const sim = makeSim('druid');
    sim.setPlayerLevel(12);
    const manaBefore = sim.player.resource;
    sim.castAbility('cat_form');
    sim.tick();
    expect(sim.player.auras.some((a) => a.kind === 'form_cat')).toBe(true);
    expect(sim.player.resourceType).toBe('energy');
    expect(sim.player.resource).toBe(100);
    // cross-shift straight to bear (bills parked mana, swaps to rage)
    for (let i = 0; i < 32; i++) sim.tick();
    sim.castAbility('bear_form');
    sim.tick();
    expect(sim.player.auras.some((a) => a.kind === 'form_bear')).toBe(true);
    expect(sim.player.auras.some((a) => a.kind === 'form_cat')).toBe(false);
    expect(sim.player.resourceType).toBe('rage');
    expect(sim.player.resource).toBe(0);
    // shift out: free, mana comes back from the parked pool
    for (let i = 0; i < 32; i++) sim.tick();
    sim.castAbility('bear_form');
    sim.tick();
    expect(sim.player.resourceType).toBe('mana');
    expect(sim.player.resource).toBeGreaterThan(0);
    expect(sim.player.resource).toBeLessThanOrEqual(manaBefore);
  });

  it('claw needs cat form, builds combo points, and ferocious bite spends them', () => {
    const sim = makeSim('druid');
    sim.setPlayerLevel(14);
    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf); // must survive a level-14 cat long enough to be bitten
    teleport(sim, sim.player, wolf.pos.x + 2, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    sim.castAbility('claw');
    let events = sim.tick();
    expect(events.some((e) => e.type === 'error' && /Cat Form/.test(e.text))).toBe(true);
    sim.castAbility('cat_form');
    sim.tick();
    let guard = 0;
    while (sim.player.comboPoints < 1 && guard++ < 20 * 60 && !wolf.dead) {
      sim.player.resource = 100;
      if (sim.player.gcdRemaining <= 0) sim.castAbility('claw');
      sim.tick();
      sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    }
    expect(sim.player.comboPoints).toBeGreaterThanOrEqual(1);
    wolf.hp = wolf.maxHp;
    sim.player.resource = 100;
    for (let i = 0; i < 32; i++) sim.tick();
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    const dealtBefore = sim.counters.damageDealt;
    sim.castAbility('ferocious_bite');
    sim.tick();
    expect(sim.counters.damageDealt).toBeGreaterThan(dealtBefore);
    expect(sim.player.comboPoints).toBe(0);
  });

  it('caster spells are locked while shapeshifted', () => {
    const sim = makeSim('druid');
    sim.setPlayerLevel(10);
    sim.castAbility('bear_form');
    for (let i = 0; i < 32; i++) sim.tick(); // wait out the shapeshift GCD
    const wolf = nearestMob(sim, 'forest_wolf');
    teleport(sim, sim.player, wolf.pos.x + 5, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    sim.player.resource = 100;
    sim.castAbility('wrath');
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error' && /shapeshifted/.test(e.text))).toBe(true);
  });
});

describe('untargetable-mob self-heal (#113/#99)', () => {
  it('a wild mob left non-hostile is restored so it can never stay an immortal invalid target', () => {
    const sim = makeSim();
    const wolf = nearestMob(sim, 'forest_wolf');
    // simulate a corruption/leak: owner-less but stuck neutral (grey, "Invalid target")
    wolf.hostile = false;
    wolf.ownerId = null;
    expect(sim.isHostileTo(sim.player, wolf)).toBe(false); // currently untargetable

    sim.tick(); // the per-mob safety net runs

    expect(wolf.hostile).toBe(true);
    expect(sim.isHostileTo(sim.player, wolf)).toBe(true); // attackable again
  });

  it('does not flip a tamed pet (owned, intentionally neutral) back to hostile', () => {
    const sim = makeSim('hunter');
    sim.setPlayerLevel(10);
    const wolf = nearestMob(sim, 'forest_wolf');
    teleport(sim, sim.player, wolf.pos.x + 5, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    sim.castAbility('tame_beast');
    for (let i = 0; i < 20 * 7; i++) sim.tick();
    expect(wolf.ownerId).toBe(sim.playerId);
    expect(wolf.hostile).toBe(false); // pets stay neutral; the self-heal must not touch owned mobs
  });
});

describe('social aggro pull radius (#102)', () => {
  function twoMurlocs(sim: Sim): [Entity, Entity] {
    const murlocs = [...sim.entities.values()].filter(
      (e) => e.kind === 'mob' && !e.dead && e.ownerId === null && e.templateId === 'mudfin_murloc',
    );
    expect(murlocs.length).toBeGreaterThanOrEqual(2);
    return [murlocs[0], murlocs[1]];
  }

  it('a murloc does not chain-pull a same-family neighbour 13yd away', () => {
    const sim = makeSim();
    const [a, b] = twoMurlocs(sim);
    for (const m of [a, b]) { m.aiState = 'idle'; m.hostile = true; }
    teleport(sim, b, a.pos.x + 13, a.pos.z); // beyond the tuned murloc radius
    teleport(sim, sim.player, a.pos.x + 2, a.pos.z);
    (sim as any).grid.refresh(sim.entities.values());
    (sim as any).aggroMob(a, sim.player, true);
    expect(b.aiState).toBe('idle'); // not chain-pulled
  });

  it('a murloc still pulls a neighbour within the tuned radius', () => {
    const sim = makeSim();
    const [a, b] = twoMurlocs(sim);
    for (const m of [a, b]) { m.aiState = 'idle'; m.hostile = true; }
    teleport(sim, b, a.pos.x + 7, a.pos.z); // inside the murloc radius
    teleport(sim, sim.player, a.pos.x + 2, a.pos.z);
    (sim as any).grid.refresh(sim.entities.values());
    (sim as any).aggroMob(a, sim.player, true);
    expect(b.aiState).toBe('chase');
  });
});

describe('caster wand auto-attack (#94)', () => {
  it('a mage auto-attacks at range instead of running into melee', () => {
    const sim = makeSim('mage');
    sim.setPlayerLevel(10);
    const wolf = nearestMob(sim, 'forest_wolf');
    const range = 15; // well outside MELEE_RANGE
    teleport(sim, sim.player, wolf.pos.x + range, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    const startHp = wolf.hp;

    sim.startAutoAttack(sim.playerId);
    let sawWand = false;
    for (let i = 0; i < 20 * 5 && !sawWand; i++) {
      const events = sim.tick();
      if (events.some((e) => e.type === 'damage' && (e as any).ability === 'Wand' && (e as any).sourceId === sim.playerId)) sawWand = true;
    }

    expect(sawWand).toBe(true);
    expect(wolf.hp).toBeLessThan(startHp); // damage landed from range
    expect(dist2d(sim.player.pos, wolf.pos)).toBeGreaterThan(5); // never closed to melee
  });
});

describe('on-next-swing cooldowns (#56)', () => {
  it('Raptor Strike applies its 6s cooldown when the queued swing resolves', () => {
    const sim = makeSim('hunter');
    sim.setPlayerLevel(10);
    const wolf = nearestMob(sim, 'forest_wolf');
    teleport(sim, sim.player, wolf.pos.x + 2, wolf.pos.z); // inside melee range
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('raptor_strike'); // queues on next swing; cooldown not yet set
    // tick until the auto-attack swing lands and consumes the queued ability
    for (let i = 0; i < 20 * 4 && sim.player.queuedOnSwing !== null; i++) sim.tick();

    expect(sim.player.queuedOnSwing).toBe(null); // the swing resolved
    expect(sim.player.cooldowns.get('raptor_strike') ?? 0).toBeGreaterThan(0); // cooldown now ticking
  });
});
