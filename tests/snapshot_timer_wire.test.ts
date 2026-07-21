import { describe, expect, it } from 'vitest';
import {
  jsonWithField,
  StableAuraWireCache,
  StableSelfTimerWireCache,
} from '../server/snapshot_timer_wire';
import type { Aura, Entity } from '../src/sim/types';

function aura(id: string, remaining: number): Aura {
  return {
    id,
    name: id,
    kind: 'buff_ap',
    remaining,
    duration: remaining,
    value: 4,
    sourceId: 0,
    school: 'physical',
  };
}

function timerEntity(
  cooldowns: Map<string, number>,
  auras: Aura[] = [],
  dead = false,
): Pick<Entity, 'cooldowns' | 'auras' | 'dead'> {
  return { cooldowns, auras, dead };
}

describe('jsonWithField', () => {
  it('adds the first field to an empty serialized object without a leading comma', () => {
    const json = jsonWithField('{}', 'auras', '[]');

    expect(JSON.parse(json)).toEqual({ auras: [] });
  });
});

describe('StableAuraWireCache', () => {
  it('does not rebuild while live remaining time and sim time advance together', () => {
    const cache = new StableAuraWireCache();
    const active = aura('long_buff', 10);
    const first = cache.encode([active], 4, false);
    expect(JSON.parse(first.json)).toEqual([expect.objectContaining({ id: 'long_buff', exp: 14 })]);
    expect(cache.rebuilds).toBe(1);

    active.remaining = 9.25;
    const second = cache.encode([active], 4.75, false);
    expect(second).toBe(first);
    expect(cache.rebuilds).toBe(1);
  });

  it('serializes unbreakable control and rebuilds when its protection changes', () => {
    const cache = new StableAuraWireCache();
    const active = aura('scripted_stasis', 10);
    active.kind = 'stasis';
    active.unbreakableControl = true;

    const protectedWire = cache.encode([active], 0, false);
    expect(JSON.parse(protectedWire.json)[0]).toMatchObject({ ub: 1 });

    active.unbreakableControl = undefined;
    const ordinaryWire = cache.encode([active], 0, false);
    expect(ordinaryWire.revision).toBe(protectedWire.revision + 1);
    expect(JSON.parse(ordinaryWire.json)[0]).not.toHaveProperty('ub');
  });

  it('rebuilds for every wire-visible mutation and explicit empty removal', () => {
    const cache = new StableAuraWireCache();
    const first = aura('first', 10);
    const second = aura('second', 12);
    cache.encode([first, second], 0, false);

    const mutations = [
      () => {
        first.remaining = 20;
      },
      () => {
        first.name = 'renamed';
      },
      () => {
        first.kind = 'buff_int';
      },
      () => {
        first.duration = 21;
      },
      () => {
        second.value = 8;
      },
      () => {
        second.value2 = 9;
      },
      () => {
        second.value3 = 10;
      },
      () => {
        second.tickInterval = 2;
      },
      () => {
        second.school = 'arcane';
      },
      () => {
        second.stacks = 2;
      },
      () => {
        second.charges = 3;
      },
      () => {
        second.empowerAbilities = ['cast_a', 'cast_b'];
      },
      () => {
        second.empowerAbilities?.reverse();
      },
      () => {
        second.sourceId = 42;
      },
    ];
    let revision = 1;
    for (const mutate of mutations) {
      mutate();
      expect(cache.encode([first, second], 0.1, false).revision).toBe(++revision);
    }
    expect(cache.encode([second, first], 0.1, false).revision).toBe(++revision);
    const removed = cache.encode([], 0.1, false);
    expect(removed.revision).toBe(++revision);
    expect(removed.json).toBe('[]');
    expect(cache.rebuilds).toBe(revision);
  });

  it('absorbs floating-point drift across hundreds of ordinary ticks', () => {
    const cache = new StableAuraWireCache();
    const active = aura('drift', 20);
    const first = cache.encode([active], 0, false);
    let simTime = 0;
    for (let i = 0; i < 200; i++) {
      simTime += 0.05;
      active.remaining -= 0.05;
      expect(cache.encode([active], simTime, false)).toBe(first);
    }
    expect(cache.rebuilds).toBe(1);
  });

  it('uses a stable frozen remaining value while dead and resumes an expiry when alive', () => {
    const cache = new StableAuraWireCache();
    const retained = aura('retained', 8);
    cache.encode([retained], 2, false);

    const frozen = cache.encode([retained], 2, true);
    expect(JSON.parse(frozen.json)[0]).toMatchObject({ rem: 8 });
    expect(JSON.parse(frozen.json)[0]).not.toHaveProperty('exp');
    const rebuilds = cache.rebuilds;
    expect(cache.encode([retained], 9, true)).toBe(frozen);
    expect(cache.rebuilds).toBe(rebuilds);

    const resumed = cache.encode([retained], 9, false);
    expect(JSON.parse(resumed.json)[0]).toMatchObject({ exp: 17 });
    expect(JSON.parse(resumed.json)[0]).not.toHaveProperty('rem');
  });
});

describe('StableSelfTimerWireCache', () => {
  it('reuses cooldown, node, and charge JSON until their semantic state changes', () => {
    const cache = new StableSelfTimerWireCache();
    const cooldowns = new Map([['cast', 5]]);
    const entity = timerEntity(cooldowns);
    const nodes: Record<string, number> = { ore: 30 };
    const charges = {
      cast: { charges: 1, maxCharges: 2, recharge: 5, rechargeLength: 5 },
    };

    const firstCooldowns = cache.encodeCooldowns(7, entity, 0);
    const firstNodes = cache.encodeNodeCooldowns(7, nodes, 0);
    const firstCharges = cache.encodeCharges(7, charges);
    cooldowns.set('cast', 4.5);
    expect(cache.encodeCooldowns(7, entity, 0.5)).toBe(firstCooldowns);
    expect(cache.encodeNodeCooldowns(7, nodes, 0.5)).toBe(firstNodes);
    expect(cache.encodeCharges(7, charges)).toBe(firstCharges);
    expect(cache.cooldownRebuilds).toBe(1);
    expect(cache.nodeCooldownRebuilds).toBe(1);
    expect(cache.chargeRebuilds).toBe(1);

    cooldowns.clear();
    delete nodes.ore;
    charges.cast.charges = 2;
    expect(cache.encodeCooldowns(7, entity, 0.5).json).toBe('{}');
    expect(cache.encodeNodeCooldowns(7, nodes, 0.5).json).toBe('{}');
    expect(cache.encodeCharges(7, charges).json).toBe('{"cast":2}');
    expect(cache.cooldownRebuilds).toBe(2);
    expect(cache.nodeCooldownRebuilds).toBe(2);
    expect(cache.chargeRebuilds).toBe(2);
  });

  it('keeps an accelerated Hourglass schedule stable, then revises it on expiry or removal', () => {
    const cache = new StableSelfTimerWireCache();
    const cooldowns = new Map([
      ['cast', 5],
      ['temporal_hourglass', 5],
    ]);
    const hourglass: Aura = {
      ...aura('temporal_hourglass', 1),
      kind: 'stasis',
      value: 3,
    };
    const entity = timerEntity(cooldowns, [hourglass]);
    const first = cache.encodeCooldowns(1, entity, 0);
    expect(JSON.parse(first.json)).toEqual({ cast: [3, 3, 1], temporal_hourglass: 5 });

    cooldowns.set('cast', 3.5);
    cooldowns.set('temporal_hourglass', 4.5);
    hourglass.remaining = 0.5;
    expect(cache.encodeCooldowns(1, entity, 0.5)).toBe(first);

    cooldowns.set('cast', 2);
    cooldowns.set('temporal_hourglass', 4);
    entity.auras.length = 0;
    const expired = cache.encodeCooldowns(1, entity, 1);
    expect(JSON.parse(expired.json)).toEqual({ cast: 3, temporal_hourglass: 5 });
    expect(expired.revision).toBe(first.revision + 1);
  });

  it('keeps a dead retained Hourglass schedule stable while normal cooldown work advances', () => {
    const cache = new StableSelfTimerWireCache();
    const hourglass: Aura = {
      ...aura('temporal_hourglass', 2),
      kind: 'stasis',
      value: 2,
    };
    const cooldowns = new Map([['cast', 6]]);
    const entity = timerEntity(cooldowns, [hourglass], true);
    const first = cache.encodeCooldowns(1, entity, 4);
    expect(JSON.parse(first.json)).toEqual({ cast: [7, 2, 7] });

    cooldowns.set('cast', 5);
    expect(cache.encodeCooldowns(1, entity, 4.5)).toBe(first);
    expect(hourglass.remaining).toBe(2);
  });

  it('revises same-tick cooldown changes but ignores charge recharge countdown churn', () => {
    const cache = new StableSelfTimerWireCache();
    const cooldowns = new Map([['cast', 5]]);
    const entity = timerEntity(cooldowns);
    const firstCooldowns = cache.encodeCooldowns(1, entity, 10);
    cooldowns.set('cast', 4);
    const reduced = cache.encodeCooldowns(1, entity, 10);
    expect(reduced).not.toBe(firstCooldowns);
    expect(JSON.parse(reduced.json)).toEqual({ cast: 14 });

    const charges = {
      cast: {
        charges: 1,
        maxCharges: 2,
        recharge: 4,
        rechargeLength: 5,
        recharges: [4],
      },
    };
    const firstCharges = cache.encodeCharges(1, charges);
    charges.cast.recharge = 3.5;
    charges.cast.recharges[0] = 3.5;
    expect(cache.encodeCharges(1, charges)).toBe(firstCharges);
    charges.cast.charges = 2;
    expect(cache.encodeCharges(1, charges)).not.toBe(firstCharges);
  });

  it('resets all sub-caches when a spectator changes anchor owner', () => {
    const cache = new StableSelfTimerWireCache();
    const state = timerEntity(new Map([['cast', 5]]));
    const first = cache.encodeCooldowns(1, state, 0);
    expect(cache.encodeCooldowns(1, state, 0)).toBe(first);
    const other = cache.encodeCooldowns(2, state, 0);
    expect(other).not.toBe(first);
    expect(cache.cooldownRebuilds).toBe(2);
  });
});
