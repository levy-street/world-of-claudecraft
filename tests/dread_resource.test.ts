// Morthen's Dread bar on a Graveyard Shift run: built by dealing damage, spent
// by Shadow Pulse (the kit's only cost), capped at 100, carried across every
// stat recalc, and handed back as the real resource on exit.
import { describe, expect, it } from 'vitest';
import { graveyardShiftRunFor } from '../src/sim/graveyard_shift';
import {
  carriedDread,
  DREAD_MAX,
  DREAD_PER_DAMAGE,
  dreadForHit,
  dreadFromDamageDealt,
  SHADOW_PULSE_DREAD,
} from '../src/sim/graveyard_shift/dread';
import { MORTHEN_KIT } from '../src/sim/graveyard_shift/kit';
import { persistedResource } from '../src/sim/serialize_resource';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, PlayerClass, SimEvent } from '../src/sim/types';
import { resourceDisplayName } from '../src/ui/ability_tooltip_lines';
import { lowResourceView } from '../src/ui/low_resource';
import { EMPTY_TEST_WORLD } from './sim_shared';

function shiftSim(cls: PlayerClass = 'warrior', level = 10) {
  const sim = new Sim({
    seed: 42,
    playerClass: cls,
    autoEquip: true,
    devCommands: true,
    offlineHost: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(level);
  return sim;
}

const meta = (sim: Sim) => (sim as any).players.get(sim.playerId);

function start(sim: Sim) {
  sim.chat('/dev graveyardshift start');
  expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).not.toBeNull();
}

function end(sim: Sim) {
  sim.chat('/dev graveyardshift end');
  sim.tick();
  expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
}

// A frozen, unkillable level-10 wolf `dz` yards in front of the player, targeted.
function frozenWolfAhead(sim: Sim, dz: number): Entity {
  sim.chat('/dev spawn forest_wolf 1 10');
  sim.chat('/dev freezemobs on');
  const wolf = [...sim.entities.values()].find((e) => e.devSpawnOwnerId === sim.playerId)!;
  expect(wolf).toBeDefined();
  const p = sim.player;
  wolf.pos = sim.ctx.groundPos(p.pos.x, p.pos.z - dz);
  wolf.prevPos = { ...wolf.pos };
  (sim as any).rebucket(wolf);
  wolf.maxHp = 1e7;
  wolf.hp = 1e7;
  p.facing = Math.PI;
  p.targetId = wolf.id;
  return wolf;
}

function hitWolf(sim: Sim, wolf: Entity, amount: number) {
  (sim as any).dealDamage(sim.player, wolf, amount, false, 'shadow', null, 'hit', true);
}

// Every damage the player dealt this tick, from the tick's own events.
function playerHits(sim: Sim, events: readonly SimEvent[]): number[] {
  const hits: number[] = [];
  for (const e of events)
    if (e.type === 'damage' && e.sourceId === sim.playerId) hits.push(e.amount);
  return hits;
}

function errors(sim: Sim): string[] {
  return sim.events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
}

function strBuff(sourceId: number, remaining: number): Aura {
  return {
    id: 'test_buff_str',
    name: 'buff_str',
    kind: 'buff_str',
    remaining,
    duration: remaining,
    value: 50,
    sourceId,
    school: 'physical',
  };
}

const kitCost = (id: string) => MORTHEN_KIT.find((def) => def.id === id)!.cost;

describe('Dread: the bar Morthen fights on', () => {
  it('pins the kit costs: Pulse 25, the Chain and Raise the Fallen free', () => {
    expect(SHADOW_PULSE_DREAD).toBe(25);
    expect(kitCost('gshift_shadow_pulse')).toBe(SHADOW_PULSE_DREAD);
    expect(kitCost('gshift_sextons_chain')).toBe(0);
    expect(kitCost('gshift_raise_fallen')).toBe(0);
    expect(MORTHEN_KIT.map((def) => def.id)).toEqual([
      'gshift_sextons_chain',
      'gshift_shadow_pulse',
      'gshift_raise_fallen',
    ]);
  });

  it.each(['warrior', 'mage'] as const)(
    'a %s owner starts the shift on an empty Dread bar',
    (cls) => {
      const sim = shiftSim(cls);
      sim.player.resource = cls === 'warrior' ? 55 : sim.player.maxResource;
      start(sim);
      expect(sim.player.resourceType).toBe('dread');
      expect(sim.player.maxResource).toBe(DREAD_MAX);
      expect(sim.player.resource).toBe(0);
    },
  );

  it('fills from damage dealt at the documented rate', () => {
    const sim = shiftSim('warrior');
    start(sim);
    const wolf = frozenWolfAhead(sim, 2);
    hitWolf(sim, wolf, 200);
    expect(sim.player.resource).toBeCloseTo(200 * DREAD_PER_DAMAGE, 9);
    expect(sim.player.resource).toBeCloseTo(10, 9);
  });

  it('earns a whole point per hit, rounded to nearest, so the bar stays an integer', () => {
    expect(dreadForHit(9)).toBe(0);
    expect(dreadForHit(10)).toBe(1);
    expect(dreadForHit(29)).toBe(1);
    expect(dreadForHit(30)).toBe(2);
    expect(dreadForHit(53)).toBe(3);
    expect(dreadForHit(0)).toBe(0);
    expect(dreadForHit(-40)).toBe(0);
  });

  it('never holds a fractional pool the frame would round up to a refused cost', () => {
    // Five 98-damage hits: a fractional pool would sit at 24.5, read "25" on the
    // frame, and refuse the 25 Dread Pulse. Whole points per hit make it 25.
    const sim = shiftSim('warrior');
    start(sim);
    const wolf = frozenWolfAhead(sim, 2);
    for (let i = 0; i < 5; i++) hitWolf(sim, wolf, 98);
    expect(sim.player.resource).toBe(25);
    sim.castAbility('gshift_shadow_pulse');
    expect(errors(sim)).not.toContain('Not enough Dread!');
    expect(sim.player.castingAbility).toBe('gshift_shadow_pulse');
  });

  it('fills from real swings: the bar sums the whole Dread of every hit dealt', () => {
    const sim = shiftSim('warrior');
    start(sim);
    frozenWolfAhead(sim, 2);
    sim.player.autoAttack = true;
    const hits: number[] = [];
    for (let i = 0; i < 20 * 10; i++) hits.push(...playerHits(sim, sim.tick()));
    expect(hits.length).toBeGreaterThan(1);
    const earned = hits.reduce((sum, amount) => sum + dreadForHit(amount), 0);
    expect(earned).toBeGreaterThan(0);
    expect(Number.isInteger(sim.player.resource)).toBe(true);
    expect(sim.player.resource).toBe(Math.min(DREAD_MAX, earned));
  });

  it('a real character dealing the same hit gains nothing from the Dread hook', () => {
    const sim = shiftSim('mage');
    const wolf = frozenWolfAhead(sim, 2);
    const before = sim.player.resource;
    hitWolf(sim, wolf, 200);
    expect(sim.player.resourceType).toBe('mana');
    expect(sim.player.resource).toBe(before);
  });

  it('Shadow Pulse spends its 25 Dread when it lands, not when it starts', () => {
    const sim = shiftSim('warrior');
    start(sim);
    sim.player.resource = 100;
    sim.castAbility('gshift_shadow_pulse');
    expect(sim.player.castingAbility).toBe('gshift_shadow_pulse');
    expect(sim.player.resource).toBe(100);
    for (let i = 0; i < 20 * 3 && sim.player.castingAbility; i++) sim.tick();
    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.cooldowns.get('gshift_shadow_pulse') ?? 0).toBeGreaterThan(0);
    expect(sim.player.resource).toBe(75);
  });

  it('refuses a cast it cannot pay with "Not enough Dread!" and spends nothing', () => {
    const sim = shiftSim('warrior');
    start(sim);
    sim.player.resource = 24;
    sim.castAbility('gshift_shadow_pulse');
    expect(sim.player.castingAbility).toBeNull();
    expect(errors(sim)).toContain('Not enough Dread!');
    expect(errors(sim)).not.toContain('Not enough mana!');
    expect(sim.player.resource).toBe(24);
    expect(sim.player.cooldowns.has('gshift_shadow_pulse')).toBe(false);
  });

  it('refuses a Pulse whose Dread drained mid-cast, with the same message', () => {
    const sim = shiftSim('warrior');
    start(sim);
    sim.player.resource = 25;
    sim.castAbility('gshift_shadow_pulse');
    expect(sim.player.castingAbility).toBe('gshift_shadow_pulse');
    // Nothing drains Dread today; the commit-time check is the guard for any
    // future drain.
    sim.player.resource = 20;
    const seen: string[] = [];
    for (let i = 0; i < 20 * 3 && sim.player.castingAbility; i++) {
      for (const e of sim.tick()) if (e.type === 'error') seen.push(e.text);
    }
    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.resource).toBe(20);
    expect(sim.player.cooldowns.has('gshift_shadow_pulse')).toBe(false);
    expect(seen).toEqual(['Not enough Dread!']);
  });

  it('caps at 100', () => {
    const sim = shiftSim('warrior');
    start(sim);
    const wolf = frozenWolfAhead(sim, 2);
    sim.player.resource = 95;
    hitWolf(sim, wolf, 5000);
    expect(sim.player.resource).toBe(DREAD_MAX);
    hitWolf(sim, wolf, 200);
    expect(sim.player.resource).toBe(DREAD_MAX);
  });

  it('neither regenerates nor decays, in or out of combat', () => {
    const sim = shiftSim('mage');
    start(sim);
    sim.player.resource = 50;
    for (let i = 0; i < 20 * 30; i++) sim.tick();
    expect(sim.player.inCombat).toBe(false);
    expect(sim.player.resource).toBe(50);
    // The frozen wolf stays engaged once hit, so the in-combat leg runs last.
    const wolf = frozenWolfAhead(sim, 2);
    hitWolf(sim, wolf, 1);
    for (let i = 0; i < 20 * 10; i++) sim.tick();
    expect(sim.player.inCombat).toBe(true);
    expect(sim.player.resource).toBe(50);
  });

  it.each(['warrior', 'mage'] as const)(
    'a %s owner keeps the exact Dread across a buff landing and expiring',
    (cls) => {
      const sim = shiftSim(cls);
      start(sim);
      const p = sim.player;
      p.resource = 37.5;
      (sim as any).applyAura(p, strBuff(p.id, 0.2));
      expect(p.resourceType).toBe('dread');
      expect(p.maxResource).toBe(DREAD_MAX);
      expect(p.resource).toBe(37.5);
      for (let i = 0; i < 10; i++) sim.tick();
      expect(p.auras.some((a) => a.id === 'test_buff_str')).toBe(false);
      expect(p.resource).toBe(37.5);
    },
  );

  it('a mage exits with the exact mana pool and bar it walked in with', () => {
    const sim = shiftSim('mage', 20);
    const p = sim.player;
    const maxMana = p.maxResource;
    p.resource = maxMana - 117;
    start(sim);
    p.resource = 80;
    end(sim);
    expect(p.resourceType).toBe('mana');
    expect(p.maxResource).toBe(maxMana);
    expect(p.resource).toBe(maxMana - 117);
  });

  it('a warrior exits with the exact rage it walked in with, not the Dread', () => {
    const sim = shiftSim('warrior');
    const p = sim.player;
    p.resource = 23;
    start(sim);
    p.resource = 90;
    end(sim);
    expect(p.resourceType).toBe('rage');
    expect(p.maxResource).toBe(100);
    expect(p.resource).toBe(23);
  });
});

describe('Dread leaf rules', () => {
  it('only a Dread bar earns from damage, and never past its maximum', () => {
    const e = { resourceType: 'rage', resource: 10, maxResource: 100 } as Entity;
    dreadFromDamageDealt(e, 400);
    expect(e.resource).toBe(10);
    e.resourceType = 'dread';
    dreadFromDamageDealt(e, 400);
    expect(e.resource).toBe(30);
    dreadFromDamageDealt(e, 0);
    expect(e.resource).toBe(30);
    dreadFromDamageDealt(e, 1e6);
    expect(e.resource).toBe(100);
  });

  it('pins what a save would write today: a warrior Dread as rage, a mana class its parked mana', () => {
    expect(persistedResource('rage', 'dread', 70, 0)).toBe(70);
    expect(persistedResource('mana', 'dread', 70, 0)).toBe(0);
    expect(persistedResource('mana', 'dread', 70, 312)).toBe(312);
  });

  it('carries only a previous Dread pool, clamped to the bar', () => {
    expect(carriedDread('dread', 42)).toBe(42);
    expect(carriedDread('dread', 140)).toBe(DREAD_MAX);
    expect(carriedDread('mana', 900)).toBe(0);
    expect(carriedDread('rage', 55)).toBe(0);
    expect(carriedDread(null, 10)).toBe(0);
  });
});

describe('Dread on the HUD', () => {
  it('names the resource through its key and keeps the low-resource warning silent', () => {
    expect(resourceDisplayName('dread')).toBe('Dread');
    expect(lowResourceView({ resource: 1, maxResource: 100, resourceType: 'dread' }).active).toBe(
      false,
    );
  });
});
