import { describe, expect, it, vi } from 'vitest';
import {
  BENISON_PRAYER_AURA_ID,
  BENISON_WHISPER_AURA_ID,
} from '../src/sim/combat/priest/benison_dawnweave';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const SLOTS = ['helmet', 'shoulder', 'chest', 'gloves'] as const;

function setup(pieces = 4, fixedRolls = true) {
  const sim = new Sim({ seed: 733, playerClass: 'priest', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('holy')).toBe(true);
  for (const slot of SLOTS.slice(0, pieces)) {
    sim.addItem(`benison_dawnweave_${slot}`, 1);
    sim.equipItem(`benison_dawnweave_${slot}`);
  }
  const ally = expectDefined(sim.entities.get(sim.addPlayer('warrior', 'Prayer Recipient')));
  sim.setPlayerLevel(20, ally.id);
  ally.pos = { ...sim.player.pos, x: sim.player.pos.x + 4 };
  ally.prevPos = { ...ally.pos };
  sim.partyInvite(ally.id, sim.player.id);
  sim.partyAccept(ally.id);
  for (const entity of [...sim.entities.values()]) {
    if (entity.id !== sim.player.id && entity.id !== ally.id) sim.ctx.dropEntity(entity.id);
  }
  sim.tick();
  ally.maxHp = 100_000;
  ally.hp = 1_000;
  if (fixedRolls) {
    vi.spyOn(sim.rng, 'range').mockImplementation((min, max) => (min + max) / 2);
    vi.spyOn(sim.rng, 'chance').mockReturnValue(false);
  }
  return { sim, ally };
}

function start(sim: Sim, ally: Entity, ability: string): void {
  sim.player.resource = sim.player.maxResource;
  sim.player.gcdRemaining = 0;
  sim.player.cooldowns.delete(ability);
  sim.targetEntity(ally.id);
  sim.castAbility(ability);
}

function finish(sim: Sim): SimEvent[] {
  const events = sim.drainEvents();
  for (let tick = 0; sim.player.castingAbility !== null && tick < 100; tick++) {
    events.push(...sim.tick());
  }
  expect(sim.player.castingAbility).toBeNull();
  return events;
}

function cast(sim: Sim, ally: Entity, ability: string): SimEvent[] {
  sim.drainEvents();
  start(sim, ally, ability);
  return finish(sim);
}

function healing(events: SimEvent[], ally: Entity, name: string): number {
  const heals = events.filter(
    (event) => event.type === 'heal2' && event.targetId === ally.id && event.ability === name,
  );
  expect(heals.length).toBeGreaterThan(0);
  return heals.reduce((sum, event) => sum + (event.type === 'heal2' ? event.amount : 0), 0);
}

function stacks(sim: Sim): number {
  return sim.player.auras.find((aura) => aura.id === BENISON_PRAYER_AURA_ID)?.stacks ?? 0;
}

function whisper(sim: Sim) {
  return sim.player.auras.find((aura) => aura.id === BENISON_WHISPER_AURA_ID);
}

function build(sim: Sim, ally: Entity, count = 3): void {
  for (let index = 0; index < count; index++) cast(sim, ally, 'heal');
}

function empower(sim: Sim, ally: Entity): void {
  build(sim, ally);
  cast(sim, ally, 'prayer_of_healing');
  expect(whisper(sim)).toBeDefined();
}

describe('Benison Dawnweave: preparation through real spell completion', () => {
  it('each core direct prayer adds one stack only on completion, capped at three', () => {
    const { sim, ally } = setup(2);
    for (const [index, ability] of ['lesser_heal', 'heal', 'flash_heal', 'heal'].entries()) {
      start(sim, ally, ability);
      expect(sim.player.castingAbility).toBe(ability);
      expect(stacks(sim)).toBe(Math.min(index, 3));
      finish(sim);
      expect(stacks(sim)).toBe(Math.min(index + 1, 3));
    }
    expect(whisper(sim)).toBeUndefined();
  });

  it('requires actual restored health, excluding overheal and fully absorbed healing', () => {
    const { sim, ally } = setup();
    ally.hp = ally.maxHp;
    expect(healing(cast(sim, ally, 'lesser_heal'), ally, 'Whispered Prayer')).toBe(0);
    expect(stacks(sim)).toBe(0);
    ally.hp = 1_000;
    ally.auras.push({
      id: 'test_heal_absorb',
      name: 'Necrotic Blight',
      kind: 'heal_absorb',
      duration: 30,
      remaining: 30,
      value: 10_000,
      sourceId: 999,
      school: 'shadow',
    });
    expect(healing(cast(sim, ally, 'flash_heal'), ally, 'Urgent Prayer')).toBe(0);
    expect(stacks(sim)).toBe(0);
    ally.auras = [];
    sim.player.auras.push({
      id: 'test_instant',
      name: 'Instant prayer',
      kind: 'next_cast_instant',
      value: 0,
      duration: 60,
      remaining: 60,
      sourceId: sim.player.id,
      school: 'holy',
    });
    ally.hp = ally.maxHp - 1;
    expect(healing(cast(sim, ally, 'flash_heal'), ally, 'Urgent Prayer')).toBe(1);
    expect(stacks(sim)).toBe(1);
  });

  it('does not count a Power Echo twice or build from periodic or group healing', () => {
    const { sim, ally } = setup();
    sim.player.auras.push({
      id: 'test_power_echo',
      name: 'Power Echo',
      kind: 'power_echo',
      value: 0.5,
      duration: 20,
      remaining: 20,
      sourceId: sim.player.id,
      school: 'holy',
    });
    const events = cast(sim, ally, 'lesser_heal');
    expect(
      events.filter((event) => event.type === 'heal2' && event.targetId === ally.id),
    ).toHaveLength(2);
    expect(stacks(sim)).toBe(1);
    cast(sim, ally, 'renew');
    for (let tick = 0; tick < 61; tick++) sim.tick();
    expect(stacks(sim)).toBe(1);
    cast(sim, ally, 'holy_nova');
    expect(stacks(sim)).toBe(1);
    cast(sim, ally, 'prayer_of_healing');
    expect(stacks(sim)).toBe(0);
    expect(whisper(sim)).toBeUndefined();
  });

  it.each([1, 2, 3])(
    'spends %i stacks on Choirmend completion and scales every healed recipient',
    (count) => {
      const { sim, ally } = setup(2);
      const baseline = healing(cast(sim, ally, 'prayer_of_healing'), ally, 'Choirmend');
      build(sim, ally, count);
      sim.player.hp = 1;
      start(sim, ally, 'prayer_of_healing');
      expect(stacks(sim)).toBe(count);
      const events = finish(sim);
      const enhanced = healing(events, ally, 'Choirmend');
      expect(Math.abs(enhanced - baseline * (1 + count * 0.1))).toBeLessThanOrEqual(1);
      expect(healing(events, sim.player, 'Choirmend')).toBe(enhanced);
      expect(stacks(sim)).toBe(0);
      expect(whisper(sim)).toBeUndefined();
    },
  );

  it.each([1, 2])(
    'four pieces do not empower Whispered Prayer below three stacks (%i)',
    (count) => {
      const { sim, ally } = setup(4);
      build(sim, ally, count);
      cast(sim, ally, 'prayer_of_healing');
      expect(stacks(sim)).toBe(0);
      expect(whisper(sim)).toBeUndefined();
      start(sim, ally, 'lesser_heal');
      expect(sim.player.castingAbility).toBe('lesser_heal');
    },
  );

  it('keeps preparation through interruption and spends it on a later successful completion', () => {
    const { sim, ally } = setup();
    build(sim, ally);
    start(sim, ally, 'prayer_of_healing');
    sim.tick();
    sim.ctx.cancelCast(sim.player);
    expect(stacks(sim)).toBe(3);
    expect(whisper(sim)).toBeUndefined();
    cast(sim, ally, 'prayer_of_healing');
    expect(stacks(sim)).toBe(0);
    expect(whisper(sim)?.remaining).toBeGreaterThan(59.9);
  });

  it.each([0, 350])(
    'scales the complete Choirmend and Whispered Prayer heal with %i additional Healing Power',
    (power) => {
      const { sim, ally } = setup();
      const originalPower = sim.player.healPower;
      sim.ctx.applyAura(sim.player, {
        id: 'test_healing_power',
        name: 'Healing Power',
        kind: 'buff_spellpower',
        value: power,
        duration: 600,
        remaining: 600,
        sourceId: sim.player.id,
        school: 'holy',
      });
      expect(sim.player.healPower).toBe(originalPower + power);
      const choirBase = healing(cast(sim, ally, 'prayer_of_healing'), ally, 'Choirmend');
      const whisperBase = healing(cast(sim, ally, 'lesser_heal'), ally, 'Whispered Prayer');
      build(sim, ally, 2);
      const choir = healing(cast(sim, ally, 'prayer_of_healing'), ally, 'Choirmend');
      expect(sim.player.healPower).toBe(originalPower + power);
      expect(Math.abs(choir - choirBase * 1.3)).toBeLessThanOrEqual(1);
      expect(whisper(sim)?.empowerAbilities).toEqual(['lesser_heal']);
      sim.drainEvents();
      start(sim, ally, 'lesser_heal');
      expect(sim.player.castingAbility).toBeNull();
      const instant = healing(sim.drainEvents(), ally, 'Whispered Prayer');
      expect(Math.abs(instant - whisperBase * 2)).toBeLessThanOrEqual(1);
      expect(whisper(sim)).toBeUndefined();
      expect(stacks(sim)).toBe(1);
      start(sim, ally, 'lesser_heal');
      expect(sim.player.castingAbility).toBe('lesser_heal');
    },
  );

  it('retains the empowered heal across an unrelated spell and rejected casts', () => {
    const { sim, ally } = setup();
    empower(sim, ally);
    cast(sim, ally, 'heal');
    expect(whisper(sim)).toBeDefined();
    sim.player.resource = 0;
    sim.player.gcdRemaining = 0;
    sim.castAbility('lesser_heal');
    expect(sim.player.castingAbility).toBeNull();
    expect(whisper(sim)).toBeDefined();
    ally.pos.x += 100;
    start(sim, ally, 'lesser_heal');
    expect(sim.player.castingAbility).toBeNull();
    expect(whisper(sim)).toBeDefined();
  });

  it('spends the empowered Whisper before a generic instant aura and preserves that other aura', () => {
    const { sim, ally } = setup();
    empower(sim, ally);
    sim.player.auras.unshift({
      id: 'test_other_instant',
      name: 'Other instant cast',
      kind: 'next_cast_instant',
      value: 0,
      duration: 60,
      remaining: 60,
      sourceId: sim.player.id,
      school: 'holy',
    });
    start(sim, ally, 'lesser_heal');
    expect(sim.player.castingAbility).toBeNull();
    expect(whisper(sim)).toBeUndefined();
    expect(sim.player.auras.some((aura) => aura.id === 'test_other_instant')).toBe(true);
    start(sim, ally, 'heal');
    expect(sim.player.castingAbility).toBeNull();
    expect(sim.player.auras.some((aura) => aura.id === 'test_other_instant')).toBe(false);
  });

  it('replays complete set rotations with identical real random draws and events', () => {
    const run = () => {
      const { sim, ally } = setup(4, false);
      const draws: number[] = [];
      sim.rng.setObserver((value) => draws.push(value));
      const events: SimEvent[] = [];
      for (const ability of [
        'heal',
        'flash_heal',
        'lesser_heal',
        'prayer_of_healing',
        'lesser_heal',
      ]) {
        events.push(...cast(sim, ally, ability));
      }
      expect(stacks(sim)).toBe(1);
      expect(whisper(sim)).toBeUndefined();
      expect(draws.length).toBeGreaterThan(0);
      return { events, draws, hp: ally.hp, auras: sim.player.auras };
    };
    expect(run()).toEqual(run());
  });

  it('expires after sixty seconds, and earning another proc refreshes one window without a cooldown', () => {
    const { sim, ally } = setup();
    empower(sim, ally);
    for (let tick = 0; tick < 20 * 10; tick++) sim.tick();
    expect(whisper(sim)?.remaining).toBeCloseTo(50, 1);
    empower(sim, ally);
    expect(sim.player.auras.filter((aura) => aura.id === BENISON_WHISPER_AURA_ID)).toHaveLength(1);
    expect(whisper(sim)?.remaining).toBeGreaterThan(59.9);
    for (let tick = 0; tick < 20 * 59; tick++) sim.tick();
    expect(whisper(sim)?.remaining).toBeGreaterThan(0.8);
    for (let tick = 0; tick < 21; tick++) sim.tick();
    expect(whisper(sim)).toBeUndefined();
    start(sim, ally, 'lesser_heal');
    expect(sim.player.castingAbility).toBe('lesser_heal');
  });

  it('losing four pieces clears Whisper, while losing two also clears preparation', () => {
    const { sim, ally } = setup();
    empower(sim, ally);
    build(sim, ally, 1);
    sim.unequipItem('helmet');
    expect(whisper(sim)).toBeUndefined();
    expect(stacks(sim)).toBe(1);
    sim.unequipItem('shoulder');
    expect(stacks(sim)).toBe(1);
    sim.unequipItem('chest');
    expect(stacks(sim)).toBe(0);
  });

  it.each(['death', 'spec change'] as const)('clears both earned buffs on %s', (reason) => {
    const { sim, ally } = setup();
    empower(sim, ally);
    build(sim, ally, 1);
    expect(stacks(sim)).toBe(1);
    if (reason === 'death') {
      sim.ctx.dealDamage(null, sim.player, sim.player.maxHp * 2, false, 'shadow', 'Test', 'hit');
      expect(sim.player.dead).toBe(true);
    } else {
      expect(sim.setSpec('discipline')).toBe(true);
    }
    expect(whisper(sim)).toBeUndefined();
    expect(stacks(sim)).toBe(0);
  });

  it('one piece grants no preparation and set processing adds no random rolls', () => {
    const runs = [1, 4].map((pieces) => {
      const { sim, ally } = setup(pieces);
      const range = vi.mocked(sim.rng.range);
      const chance = vi.mocked(sim.rng.chance);
      range.mockClear();
      chance.mockClear();
      cast(sim, ally, 'heal');
      return { stacks: stacks(sim), ranges: range.mock.calls, chances: chance.mock.calls.length };
    });
    expect(runs[0].stacks).toBe(0);
    expect(runs[1].stacks).toBe(1);
    expect(runs[0].ranges).toEqual(runs[1].ranges);
    expect(runs[0].chances).toBe(runs[1].chances);
  });

  it('four pieces leave Vigil at its baseline rescue and do not add a lingering mend', () => {
    const { sim, ally } = setup();
    cast(sim, ally, 'seraphic_vigil');
    const vigil = expectDefined(ally.auras.find((aura) => aura.id === 'seraphic_vigil'));
    expect(vigil.value).toBe(180);
    ally.hp = Math.ceil(ally.maxHp * 0.36);
    sim.drainEvents();
    sim.ctx.dealDamage(null, ally, ally.maxHp * 0.03, false, 'shadow', 'Test', 'hit');
    expect(healing(sim.drainEvents(), ally, 'Seraphic Vigil')).toBe(180);
    expect(ally.auras.some((aura) => aura.kind === 'hot')).toBe(false);
    expect(stacks(sim)).toBe(0);
  });
});
