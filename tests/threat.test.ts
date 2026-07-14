// Classic threat mechanics + the class kit that drives them (stances/forms,
// stealth, pets).
import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import {
  BEAR_FORM_THREAT_MULT,
  DEFENSIVE_STANCE_THREAT_MULT,
  RIGHTEOUS_FURY_THREAT_MULT,
} from '../src/sim/threat';
import type { Entity } from '../src/sim/types';
import { dist2d, SUNDER_ARMOR_PCT_PER_STACK } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function makeSim(cls: Parameters<typeof simClass>[0] = 'warrior', seed = 42) {
  return new Sim({ seed, playerClass: cls, autoEquip: true });
}
// type helper only — keeps makeSim's signature honest without importing PlayerClass
function simClass(
  cls:
    | 'warrior'
    | 'mage'
    | 'rogue'
    | 'druid'
    | 'hunter'
    | 'priest'
    | 'paladin'
    | 'shaman'
    | 'warlock',
) {
  return cls;
}

function summonImp(sim: Sim): Entity {
  sim.player.resource = sim.player.maxResource;
  sim.castAbility('summon_imp');
  for (let i = 0; i < 20 * 6; i++) sim.tick();
  const imp = sim.petOf(sim.playerId);
  if (!imp) throw new Error('expected summoned imp');
  return imp;
}

function nearestMob(sim: Sim, templateId?: string, from?: Entity): Entity {
  const p = from ?? sim.player;
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.ownerId !== null) continue;
    if (templateId && e.templateId !== templateId) continue;
    const d = dist2d(p.pos, e.pos);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
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

  it('consecration burns the ground every 2 seconds from 0s to 8s and generates holy threat each pulse', () => {
    const sim = makeSim('paladin');
    sim.setPlayerLevel(20);
    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);
    teleport(sim, sim.player, wolf.pos.x, wolf.pos.z + 2);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('righteous_fury');
    sim.tick();
    sim.player.gcdRemaining = 0;
    sim.castAbility('consecration');

    const damageEvents: number[] = [];
    for (let i = 0; i < 20 * 10; i++) {
      for (const event of sim.tick()) {
        if (
          event.type === 'damage' &&
          event.ability === 'Holy Ground' &&
          event.targetId === wolf.id &&
          event.amount > 0
        ) {
          damageEvents.push(event.amount);
        }
      }
    }

    expect(damageEvents).toHaveLength(5);
    expect(damageEvents.reduce((sum, amount) => sum + amount, 0)).toBeGreaterThanOrEqual(28 * 5);
    expect(wolf.threat.get(sim.playerId) ?? 0).toBeGreaterThan(28 * 5 * RIGHTEOUS_FURY_THREAT_MULT);
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
    (sim as any).applyHeal(healer, tank, 50, 'Solemn Prayer');
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
      if (e.kind === 'mob' && !e.dead && e.templateId === 'forest_wolf' && e.id !== wolfA.id) {
        wolfB = e;
        break;
      }
    }
    beefUp(wolfB!);
    hit(sim, tank, wolfB!, 50);
    tank.hp = Math.max(1, tank.hp - 200);
    (sim as any).applyHeal(healer, tank, 100, 'Solemn Prayer');
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

    (sim as any).applyHeal(healer, tank, 80, 'Solemn Prayer');

    expect(wolf.threat.get(healer.id)).toBeGreaterThan(0);
  });

  it('an unaware mob gets no healing threat', () => {
    const { sim, tank, healer } = partyOfTwo();
    const wolf = nearestMob(sim, 'forest_wolf', tank);
    tank.hp = Math.max(1, tank.hp - 100);
    (sim as any).applyHeal(healer, tank, 100, 'Solemn Prayer');
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

  it('a large mob treats a challenger within its big reach as melee (110%, not 130%)', () => {
    // Regression: the melee/ranged boundary used a flat MELEE_RANGE * 1.2 (6yd),
    // so a challenger standing at a big creature's feet (well within its
    // size-scaled reach) was misclassified as ranged and forced to clear 130%.
    const { sim, a, b, wolf } = aggroSetup();
    wolf.scale = 3; // a boss-sized creature
    const reach = (sim as any).mobMeleeRange(wolf);
    expect(reach).toBeGreaterThan(6); // scaled reach exceeds the old flat 6yd gate
    // 8yd is inside the big reach (~11yd) but beyond the old flat 6yd check
    teleport(sim, b, wolf.pos.x - 8, wolf.pos.z);
    expect(dist2d(wolf.pos, b.pos)).toBeGreaterThan(6);
    expect(dist2d(wolf.pos, b.pos)).toBeLessThanOrEqual(reach);
    // just under 110% does not switch
    wolf.threat.set(b.id, 109);
    sim.tick();
    expect(wolf.aggroTargetId).toBe(a.id);
    // 115 is over 110% but under 130%: the old flat check would have kept a (ranged),
    // the fix counts b as melee and rips aggro
    wolf.threat.set(b.id, 115);
    sim.tick();
    expect(wolf.aggroTargetId).toBe(b.id);
  });

  it('a normal-sized mob keeps the classic 6yd melee boundary (challenger at 5.5yd is melee)', () => {
    // The size-scaled reach for a scale-1 mob is only MELEE_RANGE (5yd), but the
    // melee/ranged pull-over boundary is floored at the classic MELEE_RANGE * 1.2
    // (6yd), so a challenger at 5.5yd (past 5, inside 6) still counts as melee and
    // needs only 110% (not 130%) to pull.
    const { sim, a, b, wolf } = aggroSetup();
    wolf.scale = 1; // a normal-sized creature
    teleport(sim, b, wolf.pos.x - 5.5, wolf.pos.z);
    const d = dist2d(wolf.pos, b.pos);
    expect(d).toBeGreaterThan(5); // beyond the raw scale-1 reach
    expect(d).toBeLessThanOrEqual(6); // within the classic 6yd floor
    // just under 110% does not switch
    wolf.threat.set(b.id, 109);
    sim.tick();
    expect(wolf.aggroTargetId).toBe(a.id);
    // 115 is over 110% but under 130%: the 6yd floor counts b as melee and rips
    // aggro (a size-scaled-only reach of 5yd would misclassify b as ranged).
    wolf.threat.set(b.id, 115);
    sim.tick();
    expect(wolf.aggroTargetId).toBe(b.id);
  });

  it('identical setup yields an identical target choice (determinism)', () => {
    function run(): number | null {
      const { sim, b, wolf } = aggroSetup();
      teleport(sim, b, wolf.pos.x - 8, wolf.pos.z);
      wolf.scale = 3;
      wolf.threat.set(b.id, 115);
      sim.tick();
      return wolf.aggroTargetId;
    }
    const first = run();
    const second = run();
    expect(first).toBe(second);
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

  it('level 10 paladins know Sacred Goad and taunt at 30 yards', () => {
    expect(abilitiesKnownAt('paladin', 10).some((a) => a.def.id === 'holy_taunt')).toBe(true);

    const sim = new Sim({ seed: 42, playerClass: 'paladin', noPlayer: true });
    const tank = sim.entities.get(sim.addPlayer('paladin', 'Tank'))!;
    const dps = sim.entities.get(sim.addPlayer('mage', 'Dps'))!;
    sim.setPlayerLevel(10, tank.id);
    const wolf = nearestMob(sim, 'forest_wolf', tank);
    teleport(sim, tank, wolf.pos.x + 25, wolf.pos.z);
    teleport(sim, dps, wolf.pos.x - 2, wolf.pos.z);
    wolf.threat.set(dps.id, 1000);
    wolf.aggroTargetId = dps.id;
    wolf.aiState = 'chase';
    wolf.inCombat = true;
    sim.targetEntity(wolf.id, tank.id);
    tank.facing = Math.atan2(wolf.pos.x - tank.pos.x, wolf.pos.z - tank.pos.z);

    sim.castAbility('holy_taunt', tank.id);
    for (let i = 0; i < 25; i++) sim.tick();

    expect(wolf.threat.get(tank.id)).toBe(1000);
    expect(wolf.aggroTargetId).toBe(tank.id);
    expect(wolf.forcedTargetTimer).toBeGreaterThan(0);
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
    // Sunder is now a PERCENT armor reduction: 2% of base armor per stack.
    expect((sim as any).effectiveArmor(wolf)).toBe(
      armorBefore * (1 - SUNDER_ARMOR_PCT_PER_STACK * applications),
    );
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

  it('sprint can be used before or during stealth without breaking stealth', () => {
    const sim = makeSim('rogue');
    sim.setPlayerLevel(10);

    sim.castAbility('stealth');
    expect(sim.player.auras.some((a) => a.id === 'stealth' && a.kind === 'stealth')).toBe(true);
    sim.castAbility('sprint');
    expect(sim.player.auras.some((a) => a.id === 'stealth' && a.kind === 'stealth')).toBe(true);
    expect(sim.player.auras.some((a) => a.id === 'sprint' && a.kind === 'buff_speed')).toBe(true);

    sim.castAbility('stealth');
    expect(sim.player.auras.some((a) => a.id === 'stealth')).toBe(false);
    expect(sim.player.auras.some((a) => a.id === 'sprint' && a.kind === 'buff_speed')).toBe(true);

    sim.player.cooldowns.delete('stealth');
    sim.castAbility('stealth');
    expect(sim.player.auras.some((a) => a.id === 'stealth' && a.kind === 'stealth')).toBe(true);
    expect(sim.player.auras.some((a) => a.id === 'sprint' && a.kind === 'buff_speed')).toBe(true);
  });
});

describe('hunter pets', () => {
  function tamedSetup() {
    const sim = makeSim('hunter');
    sim.setPlayerLevel(10);
    const wolf = nearestMob(sim, 'forest_wolf');
    const originalWolfId = wolf.id;
    teleport(sim, sim.player, wolf.pos.x + 5, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    sim.castAbility('tame_beast');
    for (let i = 0; i < 20 * 7; i++) sim.tick(); // 6s cast
    const pet = sim.petOf(sim.playerId)!;
    return { sim, wolf: pet, originalWolfId };
  }

  it('tame beast creates a loyal pet copy and temporarily despawns the wild target', () => {
    const { sim, wolf, originalWolfId } = tamedSetup();
    expect(wolf.ownerId).toBe(sim.playerId);
    expect(wolf.hostile).toBe(false);
    expect(sim.petOf(sim.playerId)).toBe(wolf);
    expect(wolf.id).not.toBe(originalWolfId);
    expect(sim.entities.has(originalWolfId)).toBe(false);
    for (let i = 0; i < 20 * 61; i++) sim.tick();
    expect(
      [...sim.entities.values()].some(
        (e) => e.kind === 'mob' && e.ownerId === null && e.templateId === 'forest_wolf',
      ),
    ).toBe(true);
  });

  it('friendly target spells can affect controlled pets', () => {
    const { sim, wolf: pet } = tamedSetup();
    const druidId = sim.addPlayer('druid', 'Druid');
    const druid = sim.entities.get(druidId)!;
    teleport(sim, druid, pet.pos.x + 5, pet.pos.z);
    druid.resource = druid.maxResource;
    const maxHpBefore = pet.maxHp;

    // Mark of the Wild is now a percent all-attributes raid buff; on a pet its
    // Stamina share scales the HP pool (pets derive no armor/AP from attributes).
    sim.targetEntity(pet.id, druidId);
    sim.castAbility('mark_of_the_wild', druidId);
    expect(pet.auras.some((a) => a.id === 'mark_of_the_wild')).toBe(true);
    expect(pet.maxHp).toBeGreaterThan(maxHpBefore);

    const priestId = sim.addPlayer('priest', 'Priest');
    const priest = sim.entities.get(priestId)!;
    teleport(sim, priest, pet.pos.x + 6, pet.pos.z);
    priest.resource = priest.maxResource;
    const maxHpAfterMotW = pet.maxHp;
    sim.targetEntity(pet.id, priestId);
    sim.castAbility('power_word_fortitude', priestId);
    expect(pet.maxHp).toBeGreaterThan(maxHpAfterMotW);

    const paladinId = sim.addPlayer('paladin', 'Paladin');
    const paladin = sim.entities.get(paladinId)!;
    sim.setPlayerLevel(4, paladinId);
    teleport(sim, paladin, pet.pos.x + 7, pet.pos.z);
    paladin.resource = paladin.maxResource;
    // Blessing of Might is now a percent attack-power raid buff. Give the pet a base
    // AP so the percent has something to scale (tamed pets otherwise deal template
    // damage with 0 attack power, leaving a percent buff inert).
    pet.attackPower = 50;
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
    (sim as any).ctx.respawnMob(pet); // respawnMob moved to mob/lifecycle.ts (M4); reach it via the seam
    expect(sim.entities.has(pet.id)).toBe(false);
    expect(sim.petOf(sim.playerId, true)).toBe(null);
  });

  it('the pet assists against attackers and builds its own threat with Growl autocast off', () => {
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
    expect(boar.forcedTargetId).not.toBe(pet.id);
    expect(boar.forcedTargetTimer).toBe(0);
    // pet damage taps for the owner
    expect(boar.tappedById).toBe(sim.playerId);
  });

  it('right-click autocast state lets a pet Growl whenever the cooldown is ready', () => {
    const { sim, wolf: pet } = tamedSetup();
    const boar = nearestMob(sim, 'wild_boar');
    // The pet kills a stock boar inside the fixed 5s pre-phase since the #1325
    // locomotion change (a dead mob cannot be Growl-forced), so keep it alive.
    beefUp(boar);
    teleport(sim, sim.player, boar.pos.x + 4, boar.pos.z);
    teleport(sim, pet, boar.pos.x + 5, boar.pos.z);
    hit(sim, sim.player, boar, 5);

    for (let i = 0; i < 20 * 5; i++) sim.tick();
    expect(boar.forcedTargetId).not.toBe(pet.id);

    sim.setPetAutoTaunt(true);
    expect(pet.petAutoTaunt).toBe(true);
    for (let i = 0; i < 20 * 5 && boar.forcedTargetId !== pet.id; i++) sim.tick();
    expect(boar.forcedTargetId).toBe(pet.id);
    expect(pet.petTauntTimer).toBeGreaterThan(0);

    sim.setPetAutoTaunt(false);
    expect(pet.petAutoTaunt).toBe(false);
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

  it('dismiss does not release permanent pets back to the wild', () => {
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
    expect(sim.tick().some((e) => e.type === 'error' && /Permanent pets/.test(e.text))).toBe(true);
    expect(sim.entities.has(wolf.id)).toBe(true);
    expect(wolf.ownerId).toBe(sim.playerId);
    expect(wolf.hostile).toBe(false);
    expect(sim.petOf(sim.playerId)).toBe(wolf);
  });

  it('a tamed beast that dies stays owned until revived or abandoned', () => {
    const sim = new Sim({ seed: 42, playerClass: 'hunter', respawnSeconds: 2, autoEquip: true });
    sim.setPlayerLevel(10);
    const wolf = nearestMob(sim, 'forest_wolf');
    const originalWolfId = wolf.id;
    teleport(sim, sim.player, wolf.pos.x + 5, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    sim.castAbility('tame_beast');
    for (let i = 0; i < 20 * 7; i++) sim.tick(); // 6s cast
    const pet = sim.petOf(sim.playerId)!;
    expect(pet.id).not.toBe(originalWolfId);
    expect(pet.ownerId).toBe(sim.playerId);
    expect(pet.hostile).toBe(false); // tamed pets are neutral

    const boar = nearestMob(sim, 'wild_boar');
    pet.hp = 1;
    hit(sim, boar, pet, 9999);
    for (let i = 0; i < 20 * 5 && !pet.dead; i++) sim.tick();
    expect(pet.dead).toBe(true);
    expect(pet.ownerId).toBe(sim.playerId);
    expect(pet.hostile).toBe(false);

    // owned dead pets do not respawn as wild mobs
    for (let i = 0; i < 20 * 10 && pet.dead; i++) sim.tick();
    expect(pet.dead).toBe(true);
    expect(pet.ownerId).toBe(sim.playerId);

    teleport(sim, sim.player, boar.pos.x + 5, boar.pos.z);
    sim.targetEntity(boar.id);
    sim.player.facing = Math.atan2(boar.pos.x - sim.player.pos.x, boar.pos.z - sim.player.pos.z);
    sim.castAbility('tame_beast');
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error' && /already have a pet/.test(e.text))).toBe(true);

    sim.player.resource = sim.player.maxResource;
    sim.castAbility('revive_pet');
    for (let i = 0; i < 20 * 4; i++) sim.tick();
    expect(pet.dead).toBe(false);
    expect(pet.ownerId).toBe(sim.playerId);
    expect(pet.hostile).toBe(false);
    expect(pet.hp).toBeGreaterThan(0);
  });

  it('pet name and dead state persist through character serialization', () => {
    const { sim, wolf } = tamedSetup();
    sim.renamePet('Barkley');
    sim.setPetAutoTaunt(true);
    expect(wolf.name).toBe('Barkley');
    (sim as any).dealDamage(null, wolf, wolf.hp, false, 'physical', 'test', 'hit');
    expect(wolf.dead).toBe(true);
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.pet).toMatchObject({
      templateId: 'forest_wolf',
      name: 'Barkley',
      level: wolf.level,
      dead: true,
      autoTaunt: true,
    });

    const restored = new Sim({ seed: 42, playerClass: 'hunter', noPlayer: true, autoEquip: true });
    const pid = restored.addPlayer('hunter', 'Hunter', { state });
    const pet = restored.petOf(pid, true)!;
    expect(pet).toBeTruthy();
    expect(pet.name).toBe('Barkley');
    expect(pet.dead).toBe(true);
    expect(pet.petAutoTaunt).toBe(true);
    expect(pet.ownerId).toBe(pid);

    restored.entities.get(pid)!.resource = restored.entities.get(pid)!.maxResource;
    restored.castAbility('revive_pet', pid);
    for (let i = 0; i < 20 * 4; i++) restored.tick();
    expect(pet.dead).toBe(false);
    expect(pet.ownerId).toBe(pid);
  });

  it('pet behavior modes gate automatic target selection', () => {
    const { sim, wolf: pet } = tamedSetup();
    const boar = nearestMob(sim, 'wild_boar');
    teleport(sim, sim.player, boar.pos.x + 6, boar.pos.z);
    teleport(sim, pet, boar.pos.x + 7, boar.pos.z);

    sim.setPetMode('passive');
    sim.targetEntity(boar.id);
    sim.startAutoAttack();
    for (let i = 0; i < 10; i++) sim.tick();
    expect(pet.aggroTargetId).toBe(null);

    sim.petAttack();
    sim.tick();
    expect(pet.aggroTargetId).toBe(boar.id);

    pet.aggroTargetId = null;
    sim.setPetMode('aggressive');
    sim.tick();
    expect(pet.aggroTargetId).toBe(boar.id);
  });

  it('pet taunt is commandable and uses a 10 second cooldown', () => {
    const { sim, wolf: pet } = tamedSetup();
    const boar = nearestMob(sim, 'wild_boar');
    teleport(sim, sim.player, boar.pos.x + 6, boar.pos.z);
    teleport(sim, pet, boar.pos.x + 6, boar.pos.z);
    sim.targetEntity(boar.id);

    sim.petTaunt();
    expect(pet.aggroTargetId).toBe(boar.id);
    expect(boar.forcedTargetId).not.toBe(pet.id);
    expect(pet.petManualTauntPending).toBe(true);
    for (let i = 0; i < 20 * 2 && boar.forcedTargetId !== pet.id; i++) sim.tick();
    expect(boar.forcedTargetId).toBe(pet.id);
    expect(pet.petManualTauntPending).toBe(false);

    pet.petTauntTimer = 0;
    boar.forcedTargetId = null;
    teleport(sim, pet, boar.pos.x + 2, boar.pos.z);
    sim.petTaunt();
    expect(boar.forcedTargetId).toBe(pet.id);
    expect(pet.petTauntTimer).toBe(10);

    const events = sim.tick();
    sim.petTaunt();
    expect(sim.tick().some((e) => e.type === 'error' && /not ready/.test(e.text))).toBe(true);
    expect(events).toBeTruthy();
  });

  it('pet taunts do not force bosses onto the pet', () => {
    const { sim, wolf: pet } = tamedSetup();
    sim.players.get(sim.playerId)!.questsDone.add('q_nythraxis_bound_guardian');
    while ((sim.partyOf(sim.playerId)?.members.length ?? 1) < 5) {
      const fill = sim.addPlayer('priest', `RaidFill${sim.players.size}`);
      sim.partyInvite(fill);
      sim.partyAccept(fill);
    }
    sim.convertPartyToRaid();
    sim.enterDungeon('nythraxis_boss_arena');
    const boss = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'nythraxis_scourge_of_thornpeak' && !e.dead,
    )!;
    const tankId = sim.addPlayer('warrior', 'Tank');
    const tank = sim.entities.get(tankId)!;
    teleport(sim, tank, boss.pos.x + 3, boss.pos.z);
    teleport(sim, sim.player, boss.pos.x + 8, boss.pos.z);
    teleport(sim, pet, boss.pos.x + 2, boss.pos.z);
    boss.inCombat = true;
    boss.aiState = 'attack';
    boss.aggroTargetId = tank.id;
    boss.threat.set(tank.id, 1000);
    sim.targetEntity(boss.id);

    sim.petTaunt();

    expect(boss.threat.get(pet.id)).toBeGreaterThan(0);
    expect(boss.forcedTargetId).not.toBe(pet.id);
    expect(boss.aggroTargetId).toBe(tank.id);
    expect(pet.petTauntTimer).toBe(10);
  });

  it('hunter aspects apply to the active pet', () => {
    const { sim, wolf: pet } = tamedSetup();
    const apBefore = (sim as any).effectiveAttackPower(pet);
    sim.castAbility('aspect_of_the_hawk');
    sim.tick();
    expect(pet.auras.some((a) => a.id === 'pet_aspect_of_the_hawk')).toBe(true);
    expect((sim as any).effectiveAttackPower(pet)).toBeGreaterThan(apBefore);
  });

  it('feed pet consumes food only and heals the pet over 5 seconds', () => {
    const { sim, wolf: pet } = tamedSetup();
    pet.hp = Math.max(1, pet.maxHp - 50);
    sim.addItem('baked_bread', 1);
    sim.addItem('minor_healing_potion', 1);

    sim.feedPet('minor_healing_potion');
    expect(sim.tick().some((e) => e.type === 'error' && /only eat food/.test(e.text))).toBe(true);
    expect(sim.countItem('minor_healing_potion')).toBe(1);

    const breadBefore = sim.countItem('baked_bread');
    sim.feedPet('baked_bread');
    expect(sim.countItem('baked_bread')).toBe(breadBefore - 1);
    expect(pet.auras.some((a) => a.id === 'feed_pet' && a.kind === 'hot')).toBe(true);
    const hpAfterFeed = pet.hp;
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    expect(pet.hp).toBeGreaterThan(hpAfterFeed);
  });

  it('abandon pet despawns the owned copy instead of releasing it as wild', () => {
    const { sim, wolf: pet } = tamedSetup();
    sim.abandonPet();
    expect(sim.entities.has(pet.id)).toBe(false);
    expect(sim.petOf(sim.playerId, true)).toBe(null);
  });

  it('pets default defensive, level with the hunter, and regenerate health out of combat', () => {
    const { sim, wolf: pet } = tamedSetup();
    expect(pet.petMode).toBe('defensive');
    expect(pet.level).toBe(sim.player.level);

    sim.setPlayerLevel(12);
    expect(pet.level).toBe(12);
    expect(pet.maxHp).toBeGreaterThan(0);

    pet.inCombat = false;
    pet.hp = Math.max(1, pet.maxHp - 20);
    const hpBefore = pet.hp;
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    expect(pet.hp).toBeGreaterThan(hpBefore);
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
  it('wolf form runs on energy, bear on rage, and mana is restored on shift-out', () => {
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

  // Issue #298: bear should grant armor, stamina, and +15 AP; cat should raise AP.
  // These apply in recalcPlayerStats; the bug the reporter hit was the missing
  // cat-form *visual* (renderer), but lock the stat math so it can't regress.
  it('bear form raises armor, maximum health, and attack power', () => {
    const sim = makeSim('druid');
    sim.setPlayerLevel(20);
    sim.tick();
    const armorBefore = sim.player.stats.armor;
    const hpBefore = sim.player.maxHp;
    const apBefore = sim.player.attackPower;
    sim.castAbility('bear_form');
    sim.tick();
    expect(sim.player.auras.some((a) => a.kind === 'form_bear')).toBe(true);
    expect(sim.player.stats.armor).toBeGreaterThanOrEqual(Math.round(armorBefore * 1.9));
    expect(sim.player.maxHp).toBeGreaterThan(hpBefore);
    expect(sim.player.attackPower).toBeGreaterThan(apBefore + 15);
  });

  it('wolf form raises attack power', () => {
    const sim = makeSim('druid');
    sim.setPlayerLevel(20);
    sim.tick();
    const apBefore = sim.player.attackPower;
    sim.castAbility('cat_form');
    sim.tick();
    expect(sim.player.auras.some((a) => a.kind === 'form_cat')).toBe(true);
    expect(sim.player.attackPower).toBeGreaterThan(apBefore);
  });

  it('bear form generates rage when taking damage from enemy level', () => {
    const sim = makeSim('druid');
    sim.setPlayerLevel(12);
    sim.castAbility('bear_form');
    sim.tick();
    expect(sim.player.resourceType).toBe('rage');
    sim.player.resource = 0;
    const wolf = nearestMob(sim, 'forest_wolf');
    wolf.level = 20;

    hit(sim, wolf, sim.player, 30);

    expect(sim.player.resource).toBeCloseTo(1, 5);
  });

  it('bear charge is learned with Bruin Form and only works while shifted', () => {
    const sim = makeSim('druid');
    sim.setPlayerLevel(10);
    expect(abilitiesKnownAt('druid', 10).some((a) => a.def.id === 'bear_charge')).toBe(true);
    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);
    teleport(sim, sim.player, wolf.pos.x + 12, wolf.pos.z);
    sim.targetEntity(wolf.id);

    sim.castAbility('bear_charge');
    expect(sim.tick().some((e) => e.type === 'error' && /Bruin Form/.test(e.text))).toBe(true);
    expect(sim.player.chargeTargetId).toBe(null);

    sim.castAbility('bear_form');
    sim.tick();
    expect(sim.player.resourceType).toBe('rage');
    sim.player.resource = 0;
    sim.player.gcdRemaining = 0;
    sim.castAbility('bear_charge');

    expect(sim.player.chargeTargetId).toBe(wolf.id);
    expect(sim.player.resource).toBe(9);
    expect(sim.player.cooldowns.get('bear_charge') ?? 0).toBeGreaterThan(0);
    expect(wolf.auras.some((a) => a.kind === 'stun')).toBe(true);
  });

  it('claw needs wolf form, builds combo points, and ferocious bite spends them', () => {
    const sim = makeSim('druid');
    sim.setPlayerLevel(14);
    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf); // must survive a level-14 cat long enough to be bitten
    teleport(sim, sim.player, wolf.pos.x + 2, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    sim.castAbility('claw');
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error' && /Wolf Form/.test(e.text))).toBe(true);
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

  it('bear and wolf forms can only use their own form kits', () => {
    const sim = makeSim('druid');
    sim.setPlayerLevel(14);
    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);
    teleport(sim, sim.player, wolf.pos.x + 2, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);

    sim.castAbility('cat_form');
    for (let i = 0; i < 32; i++) sim.tick();
    sim.player.resource = 100;
    sim.castAbility('wrath');
    let events = sim.tick();
    expect(events.some((e) => e.type === 'error' && /shapeshifted/.test(e.text))).toBe(true);
    sim.castAbility('maul');
    events = sim.tick();
    expect(events.some((e) => e.type === 'error' && /Bruin Form/.test(e.text))).toBe(true);

    sim.castAbility('bear_form');
    for (let i = 0; i < 32; i++) sim.tick();
    sim.player.resource = 100;
    sim.castAbility('claw');
    events = sim.tick();
    expect(events.some((e) => e.type === 'error' && /Wolf Form/.test(e.text))).toBe(true);
  });

  it('bear form learns demoralizing roar at level 10 and lowers nearby mob attack power', () => {
    const sim = makeSim('druid');
    sim.setPlayerLevel(10);
    expect(sim.known.map((k) => k.def.id)).toContain('demoralizing_roar');
    const wolf = nearestMob(sim, 'forest_wolf');
    teleport(sim, sim.player, wolf.pos.x + 2, wolf.pos.z);
    const apBefore = (sim as any).effectiveAttackPower(wolf);
    sim.castAbility('bear_form');
    for (let i = 0; i < 32; i++) sim.tick();
    sim.player.resource = 100;
    sim.castAbility('demoralizing_roar');
    sim.tick();
    const aura = wolf.auras.find((a) => a.kind === 'debuff_ap');
    expect(aura?.value).toBe(20);
    expect((sim as any).effectiveAttackPower(wolf)).toBe(Math.max(0, apBefore - 20));
    expect(wolf.threat.get(sim.playerId)).toBeGreaterThan(0);
  });

  it('wolf form gains agility/AP and supports prowl into rake bleed opener', () => {
    const sim = makeSim('druid');
    sim.setPlayerLevel(12);
    expect(sim.known.map((k) => k.def.id)).toEqual(
      expect.arrayContaining(['cat_form', 'prowl', 'rake']),
    );
    const agiBefore = sim.player.stats.agi;
    const apBefore = sim.player.attackPower;
    sim.castAbility('cat_form');
    sim.tick();
    expect(sim.player.auras.some((a) => a.kind === 'form_cat')).toBe(true);
    expect(sim.player.stats.agi).toBeGreaterThan(agiBefore);
    expect(sim.player.attackPower).toBeGreaterThan(apBefore);

    for (let i = 0; i < 32; i++) sim.tick();
    sim.player.resource = 100;
    sim.castAbility('rake');
    const events = sim.tick();
    expect(events.some((e) => e.type === 'error' && /stealthed/.test(e.text))).toBe(true);
    for (let i = 0; i < 32; i++) sim.tick();
    sim.castAbility('prowl');
    sim.tick();
    expect(sim.player.auras.some((a) => a.kind === 'stealth')).toBe(true);

    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);
    teleport(sim, sim.player, wolf.pos.x + 2, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    for (let i = 0; i < 32; i++) sim.tick();
    sim.player.resource = 100;
    sim.castAbility('rake');
    sim.tick();
    expect(sim.player.auras.some((a) => a.kind === 'stealth')).toBe(false);
    expect(wolf.auras.some((a) => a.id === 'rake' && a.kind === 'dot')).toBe(true);
    expect(sim.player.comboPoints).toBeGreaterThanOrEqual(1);
  });

  it('prowl slows movement without rooting and toggles off', () => {
    const sim = makeSim('druid');
    sim.setPlayerLevel(12);
    sim.castAbility('cat_form');
    for (let i = 0; i < 32; i++) sim.tick();
    sim.castAbility('prowl');
    sim.tick();
    expect(sim.player.auras.some((a) => a.id === 'prowl' && a.kind === 'stealth')).toBe(true);

    const startZ = sim.player.pos.z;
    sim.moveInput.forward = true;
    for (let i = 0; i < 20; i++) sim.tick();
    sim.moveInput.forward = false;
    expect(Math.abs(sim.player.pos.z - startZ)).toBeGreaterThan(1);

    for (let i = 0; i < 32; i++) sim.tick();
    sim.castAbility('prowl');
    sim.tick();
    expect(sim.player.auras.some((a) => a.id === 'prowl' && a.kind === 'stealth')).toBe(false);
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
    const pet = sim.petOf(sim.playerId)!;
    expect(pet.ownerId).toBe(sim.playerId);
    expect(pet.hostile).toBe(false); // pets stay neutral; the self-heal must not touch owned mobs
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
    for (const m of [a, b]) {
      m.aiState = 'idle';
      m.hostile = true;
    }
    teleport(sim, b, a.pos.x + 13, a.pos.z); // beyond the tuned murloc radius
    teleport(sim, sim.player, a.pos.x + 2, a.pos.z);
    (sim as any).grid.refresh(sim.entities.values());
    (sim as any).aggroMob(a, sim.player, true);
    expect(b.aiState).toBe('idle'); // not chain-pulled
  });

  it('a murloc still pulls a neighbour within the tuned radius', () => {
    const sim = makeSim();
    const [a, b] = twoMurlocs(sim);
    for (const m of [a, b]) {
      m.aiState = 'idle';
      m.hostile = true;
    }
    teleport(sim, b, a.pos.x + 7, a.pos.z); // inside the murloc radius
    teleport(sim, sim.player, a.pos.x + 2, a.pos.z);
    (sim as any).grid.refresh(sim.entities.values());
    (sim as any).aggroMob(a, sim.player, true);
    expect(b.aiState).toBe('chase');
  });
});

describe('caster wand auto-attack (#94)', () => {
  it('does not aggro a hostile mob when melee auto-attack is started out of range', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(10);
    const wolf = nearestMob(sim, 'forest_wolf');
    teleport(sim, sim.player, wolf.pos.x + 35, wolf.pos.z);
    sim.targetEntity(wolf.id);

    sim.startAutoAttack(sim.playerId);

    expect(sim.player.autoAttack).toBe(true);
    expect(wolf.aiState).toBe('idle');
    expect(wolf.aggroTargetId).toBeNull();
    expect(wolf.threat.get(sim.playerId)).toBeUndefined();
    expect(sim.player.inCombat).toBe(false);
  });

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
      if (
        events.some(
          (e) =>
            e.type === 'damage' &&
            (e as any).ability === 'Wand' &&
            (e as any).sourceId === sim.playerId,
        )
      )
        sawWand = true;
    }

    expect(sawWand).toBe(true);
    expect(wolf.hp).toBeLessThan(startHp); // damage landed from range
    expect(dist2d(sim.player.pos, wolf.pos)).toBeGreaterThan(5); // never closed to melee
  });
});

describe('on-next-swing cooldowns (#56)', () => {
  it('Gutting Strike applies its 6s cooldown when the queued swing resolves', () => {
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

describe('shaman travel and shock mechanics', () => {
  it('all shock abilities share one cooldown', () => {
    const sim = makeSim('shaman');
    sim.setPlayerLevel(16);
    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);
    teleport(sim, sim.player, wolf.pos.x + 12, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('earth_shock');

    expect(sim.player.cooldowns.get('earth_shock') ?? 0).toBeGreaterThan(0);
    expect(sim.player.cooldowns.get('flame_shock') ?? 0).toBeGreaterThan(0);
    expect(sim.player.cooldowns.get('frost_shock') ?? 0).toBeGreaterThan(0);

    sim.player.gcdRemaining = 0;
    sim.events = [];
    sim.castAbility('frost_shock');
    expect(sim.events).toContainEqual({
      type: 'error',
      text: 'That ability is not ready yet.',
      pid: sim.player.id,
    });
  });

  it('Shadewolf toggles speed and survives damage events', () => {
    const sim = makeSim('shaman');
    sim.setPlayerLevel(16);
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('ghost_wolf');
    for (let i = 0; i < 20 * 3; i++) sim.tick();

    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf' && a.kind === 'buff_speed')).toBe(
      true,
    );
    expect((sim as any).moveSpeedMult(sim.player)).toBeCloseTo(1.4, 5);

    sim.castAbility('ghost_wolf');
    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(false);

    for (let i = 0; i < 40; i++) sim.tick();
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('ghost_wolf');
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);
    hit(sim, sim.player, wolf, 10, 'nature');
    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(true);

    hit(sim, wolf, sim.player, 10);
    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(true);
  });

  it('Shadewolf does not drop when auto-attack cannot swing yet', () => {
    const sim = makeSim('shaman');
    sim.setPlayerLevel(16);
    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('ghost_wolf');
    for (let i = 0; i < 20 * 3 && sim.player.castingAbility; i++) sim.tick();
    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(true);

    sim.startAutoAttack();
    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(true);

    teleport(sim, sim.player, wolf.pos.x + 35, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    sim.startAutoAttack();
    for (let i = 0; i < 20; i++) sim.tick();
    expect(sim.player.autoAttack).toBe(true);
    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(true);
  });

  it('Shadewolf drops when auto-attack actually swings', () => {
    const sim = makeSim('shaman');
    sim.setPlayerLevel(16);
    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);
    teleport(sim, sim.player, wolf.pos.x + 2, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('ghost_wolf');
    for (let i = 0; i < 20 * 3 && sim.player.castingAbility; i++) sim.tick();
    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(true);

    sim.startAutoAttack();
    sim.tick();
    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(false);
  });

  it('Shadewolf stays active while running and jumping', () => {
    const sim = makeSim('shaman');
    sim.setPlayerLevel(16);
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('ghost_wolf');
    for (let i = 0; i < 20 * 3 && sim.player.castingAbility; i++) sim.tick();
    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(true);

    sim.moveInput.forward = true;
    for (let i = 0; i < 20 * 8; i++) {
      sim.moveInput.jump = i % 20 < 3;
      sim.tick();
      expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(true);
    }
  });

  it('Shadewolf stays active through Thunder Ward contact, jump, and respawn cleanup', () => {
    const sim = makeSim('shaman');
    sim.setPlayerLevel(16);
    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);
    wolf.level = sim.player.level;
    wolf.weapon = { min: 10, max: 10, speed: 2 };
    teleport(sim, sim.player, wolf.pos.x + 35, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('lightning_shield');
    expect(sim.player.auras.some((a) => a.id === 'lightning_shield')).toBe(true);
    for (let i = 0; i < 40; i++) sim.tick();

    sim.player.resource = sim.player.maxResource;
    sim.castAbility('ghost_wolf');
    for (let i = 0; i < 20 * 3 && sim.player.castingAbility; i++) sim.tick();
    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(true);

    sim.startAutoAttack();
    sim.moveInput.forward = true;
    for (let i = 0; i < 20; i++) {
      sim.moveInput.jump = i < 3;
      sim.tick();
    }
    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(true);

    teleport(sim, sim.player, wolf.pos.x + 2, wolf.pos.z);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    wolf.facing = Math.atan2(sim.player.pos.x - wolf.pos.x, sim.player.pos.z - wolf.pos.z);
    (sim as any).mobSwing(wolf, sim.player);
    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(true);

    (sim as any).dealDamage(wolf, sim.player, sim.player.hp, false, 'physical', null, 'hit', true);
    expect(sim.player.dead).toBe(true);
    // release rises as a ghost at a graveyard; the angel there resurrects to life
    sim.releaseSpirit();
    sim.resurrectAtSpiritHealer();
    expect(sim.player.dead).toBe(false);
    expect(sim.player.autoAttack).toBe(false);

    sim.moveInput.forward = false;
    sim.moveInput.jump = false;
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('ghost_wolf');
    for (let i = 0; i < 20 * 3 && sim.player.castingAbility; i++) sim.tick();
    sim.moveInput.forward = true;
    sim.moveInput.jump = true;
    sim.tick();
    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(true);
  });

  it('Shadewolf casting is not delayed by incoming damage or standalone jump input', () => {
    const sim = makeSim('shaman');
    sim.setPlayerLevel(16);
    sim.player.resource = sim.player.maxResource;
    const wolf = nearestMob(sim, 'forest_wolf');

    sim.castAbility('ghost_wolf');
    expect(sim.player.castingAbility).toBe('ghost_wolf');

    const remBefore = sim.player.castRemaining;
    hit(sim, wolf, sim.player, 10);
    expect(sim.player.castingAbility).toBe('ghost_wolf');
    expect(sim.player.castRemaining).toBe(remBefore);

    sim.moveInput.jump = true;
    sim.tick();
    sim.moveInput.jump = false;
    expect(sim.player.castingAbility).toBe('ghost_wolf');

    for (let i = 0; i < 20 * 3 && sim.player.castingAbility; i++) sim.tick();
    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(true);
  });

  it('Shadewolf drops before casting shaman spells from the same button press', () => {
    const sim = makeSim('shaman');
    sim.setPlayerLevel(16);
    // This test checks that *casting a spell* auto-cancels Shadewolf form.
    // Taking any damage also breaks the form, so a stray wolf swing landing
    // mid-window would drop it incidentally and make the assertions sensitive
    // to world RNG. Make the shaman invulnerable to isolate the cast-driven
    // cancel; the wolf is still a valid target for the player's own spells.
    sim.player.gm = true;
    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);
    // This test is about Shadewolf's toggle/recast semantics, not the wolf's
    // auto-attacks. A landed melee swing breaks the form (damage cancels Ghost
    // Wolf), so root the wolf in place (it can never close the 12yd gap) to keep
    // the form-checks independent of hit-table RNG. It stays alive and in range
    // of the ranged shocks the test casts at it.
    wolf.moveSpeed = 0;
    teleport(sim, sim.player, wolf.pos.x + 12, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.player.facing = Math.atan2(wolf.pos.x - sim.player.pos.x, wolf.pos.z - sim.player.pos.z);
    sim.player.resource = sim.player.maxResource;

    sim.castAbility('ghost_wolf');
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(true);

    sim.castAbility('lightning_bolt');
    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(false);
    expect(sim.player.castingAbility).toBe('lightning_bolt');
    for (let i = 0; i < 20 * 3; i++) sim.tick();

    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('ghost_wolf');
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(true);

    const beforeHp = wolf.hp;
    sim.player.gcdRemaining = 0;
    sim.castAbility('flame_shock');
    expect(sim.player.auras.some((a) => a.id === 'ghost_wolf')).toBe(false);
    // Cinder Jolt is a projectile now: its damage lands when the bolt reaches the
    // wolf (projectile_travel), a few ticks after the cast.
    for (let i = 0; i < 20 && wolf.hp >= beforeHp; i++) sim.tick();
    expect(wolf.hp).toBeLessThan(beforeHp);
  });
});

describe('warlock demon summons', () => {
  it('Summon Emberkin creates a ranged demon that casts Firebolt', () => {
    const sim = makeSim('warlock');

    const imp = summonImp(sim);
    expect(imp.templateId).toBe('emberkin');
    expect(imp.name).toBe('Emberkin');
    expect(imp.ownerId).toBe(sim.playerId);
    expect(imp.hostile).toBe(false);

    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);
    teleport(sim, sim.player, wolf.pos.x + 14, wolf.pos.z);
    teleport(sim, imp, wolf.pos.x + 12, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.petAttack();

    let firebolt = false;
    for (let i = 0; i < 20 * 4 && !firebolt; i++) {
      const events = sim.tick();
      firebolt = events.some(
        (e) =>
          e.type === 'damage' &&
          (e as any).sourceId === imp.id &&
          (e as any).school === 'fire' &&
          (e as any).amount > 0,
      );
    }
    expect(firebolt).toBe(true);
    expect(wolf.threat.has(imp.id)).toBe(true);
  });

  it('warlocks heal demons with mana instead of food and cannot abandon them', () => {
    const sim = makeSim('warlock');
    const demon = summonImp(sim);
    demon.hp = Math.max(1, demon.maxHp - 50);
    sim.addItem('baked_bread', 1);
    const breadBefore = sim.countItem('baked_bread');

    sim.feedPet('baked_bread');
    expect(sim.tick().some((e) => e.type === 'error' && /Only hunters/.test(e.text))).toBe(true);
    expect(sim.countItem('baked_bread')).toBe(breadBefore);

    const manaBefore = sim.player.resource;
    sim.healPet();
    expect(sim.player.resource).toBeLessThan(manaBefore);
    expect(sim.player.castingAbility).toBe('demon_heal');
    expect(sim.player.channeling).toBe(true);
    expect(
      sim.events.some((e) => e.type === 'castStart' && (e as any).ability === 'demon_heal'),
    ).toBe(true);
    expect(demon.auras.some((a) => a.id === 'demon_heal')).toBe(false);
    const hpBeforeHeal = demon.hp;
    for (let i = 0; i < 20 * 6 && sim.player.castingAbility; i++) sim.tick();
    expect(demon.hp).toBeGreaterThan(hpBeforeHeal);
    expect(sim.player.castingAbility).toBe(null);

    sim.abandonPet();
    expect(sim.tick().some((e) => e.type === 'error' && /Only hunters/.test(e.text))).toBe(true);
    expect(sim.entities.has(demon.id)).toBe(true);
  });

  it('Summon Gloomshade replaces the emberkin with a tank demon that Growls', () => {
    const sim = makeSim('warlock');
    sim.setPlayerLevel(10);
    const imp = summonImp(sim);

    sim.player.resource = sim.player.maxResource;
    sim.castAbility('summon_voidwalker');
    for (let i = 0; i < 20 * 6; i++) sim.tick();
    const voidwalker = sim.petOf(sim.playerId)!;
    expect(voidwalker.templateId).toBe('gloomshade');
    expect(voidwalker.name).toBe('Gloomshade');
    expect(voidwalker.id).not.toBe(imp.id);
    expect(sim.entities.has(imp.id)).toBe(false);
    expect(voidwalker.maxHp).toBeGreaterThan(imp.maxHp);
    expect(voidwalker.stats.armor).toBeGreaterThan(imp.stats.armor);

    const wolf = nearestMob(sim, 'forest_wolf');
    beefUp(wolf);
    teleport(sim, voidwalker, wolf.pos.x + 2, wolf.pos.z);
    teleport(sim, sim.player, wolf.pos.x + 8, wolf.pos.z);
    sim.targetEntity(wolf.id);
    sim.petAttack();
    for (let i = 0; i < 20; i++) sim.tick();

    expect(wolf.forcedTargetId).not.toBe(voidwalker.id);
    expect(voidwalker.petTauntTimer).toBe(0);

    sim.setPetAutoTaunt(true);
    for (let i = 0; i < 20 && wolf.forcedTargetId !== voidwalker.id; i++) sim.tick();
    expect(wolf.forcedTargetId).toBe(voidwalker.id);
    expect(voidwalker.petTauntTimer).toBeGreaterThan(0);
  });

  it('recasting the same demon dismisses it and summons a fresh one', () => {
    const sim = makeSim('warlock');
    const demon = summonImp(sim);
    expect(demon.templateId).toBe('emberkin');

    sim.player.resource = sim.player.maxResource;
    sim.castAbility('summon_imp');
    for (let i = 0; i < 20 * 5; i++) sim.tick();

    expect(sim.entities.has(demon.id)).toBe(false);
    const fresh = sim.petOf(sim.playerId, true);
    expect(fresh).not.toBe(null);
    expect(fresh?.templateId).toBe('emberkin');
    expect(fresh?.id).not.toBe(demon.id);
    expect(fresh?.hp).toBe(fresh?.maxHp);
  });

  it('recasting a dead demon resummons it instead of dismissing', () => {
    const sim = makeSim('warlock');
    const deadDemon = summonImp(sim);
    deadDemon.dead = true;
    deadDemon.hp = 0;
    deadDemon.aiState = 'dead';

    sim.player.resource = sim.player.maxResource;
    sim.castAbility('summon_imp');
    for (let i = 0; i < 20 * 5; i++) sim.tick();

    const freshDemon = sim.petOf(sim.playerId);
    expect(sim.entities.has(deadDemon.id)).toBe(false);
    expect(freshDemon).toBeTruthy();
    expect(freshDemon!.id).not.toBe(deadDemon.id);
    expect(freshDemon!.templateId).toBe('emberkin');
    expect(freshDemon!.dead).toBe(false);
    expect(freshDemon!.hp).toBe(freshDemon!.maxHp);
  });
});
