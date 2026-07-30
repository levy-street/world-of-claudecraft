// Direct unit tests for src/sim/combat/auras.ts (C3). The per-tick aura/regen/timer
// runner is exercised against a real Sim.ctx (so the SimContext seam, entities,
// players, rng, and the heal/stat-aura delegates are the real shared ones the engine
// uses), proving the extracted module is callable on its own and that the moved
// behavior (the two e.dead guards, the DoT/HoT/expiry branches, the eat-tick regen,
// and the friendly-NPC cleanse) is intact, independent of the parity golden.

import { describe, expect, it } from 'vitest';
import {
  cleanseFriendlyNpcAuras,
  isRejectedFriendlyNpcAura,
  updateAuras,
  updateRegen,
  updateTimers,
} from '../src/sim/combat/auras';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { DT } from '../src/sim/types';

function makeSim(seed = 7373): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function aura(kind: Aura['kind'], value: number, extra: Partial<Aura> = {}): Aura {
  return {
    id: `${kind}_${value}`,
    name: kind,
    kind,
    remaining: 60,
    duration: 60,
    value,
    sourceId: 0,
    school: 'physical',
    ...extra,
  } as Aura;
}

function spawnMob(sim: Sim, hp = 1000): Entity {
  const p = sim.player;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 5, {
    x: p.pos.x + 40,
    y: p.pos.y,
    z: p.pos.z + 40,
  });
  mob.maxHp = hp;
  mob.hp = hp;
  sim.addEntity(mob);
  return mob;
}

describe('auras: isRejectedFriendlyNpcAura', () => {
  it('is true for rejected control/debuff kinds and false otherwise', () => {
    expect(isRejectedFriendlyNpcAura(aura('stun', 1))).toBe(true);
    expect(isRejectedFriendlyNpcAura(aura('dot', 1))).toBe(true);
    expect(isRejectedFriendlyNpcAura(aura('tongues', 1.5))).toBe(true);
    expect(isRejectedFriendlyNpcAura(aura('hot', 1))).toBe(false);
    expect(isRejectedFriendlyNpcAura(aura('buff_ap', 1))).toBe(false);
  });
});

describe('auras: unbreakable control replacement', () => {
  it('cannot be downgraded by an ordinary refresh and can refresh as protected', () => {
    const sim = makeSim();
    const p = sim.player;
    const protectedStun = {
      ...aura('stun', 0, { id: 'scripted_stun', sourceId: 9000 }),
      unbreakableControl: true,
    } as const;
    sim.ctx.applyAura(p, protectedStun);

    sim.ctx.applyAura(
      p,
      aura('stun', 0, {
        id: 'scripted_stun',
        sourceId: 9000,
        remaining: 3,
        duration: 3,
      }),
    );
    expect(p.auras.filter((entry) => entry.id === 'scripted_stun')).toEqual([protectedStun]);

    const refreshed = { ...protectedStun, remaining: 90, duration: 90 };
    sim.ctx.applyAura(p, refreshed);
    expect(p.auras.filter((entry) => entry.id === 'scripted_stun')).toEqual([refreshed]);
  });
});

describe('auras: updateTimers', () => {
  it('decrements gcd, advances rule/combat timers, and expires cooldowns', () => {
    const sim = makeSim();
    const p = sim.player;
    p.gcdRemaining = DT; // exactly one tick from 0
    p.fiveSecondRule = 0;
    p.combatTimer = 0;
    p.cooldowns = new Map<string, number>([
      ['a', DT],
      ['b', 5],
    ]);
    updateTimers(p);
    expect(p.gcdRemaining).toBe(0);
    expect(p.fiveSecondRule).toBeCloseTo(DT, 9);
    expect(p.combatTimer).toBeCloseTo(DT, 9);
    expect(p.cooldowns.has('a')).toBe(false); // <= 0 deleted
    expect(p.cooldowns.get('b')).toBeCloseTo(5 - DT, 9);
  });
});

describe('auras: updateAuras DoT tick', () => {
  it('a DoT tick damages the carrier (via ctx.dealDamage)', () => {
    const sim = makeSim();
    const mob = spawnMob(sim, 1000);
    mob.auras.push(aura('dot', 100, { tickInterval: DT }));
    const hp0 = mob.hp;
    updateAuras(sim.ctx, mob);
    expect(mob.hp).toBeLessThan(hp0);
  });

  it('the post-DoT e.dead guard fires once a DoT tick kills the carrier', () => {
    const sim = makeSim();
    const mob = spawnMob(sim, 50);
    // A buff at index 0 and a lethal dot at index 1: the backward walk ticks the dot
    // first, kills the mob, and the guard returns before index 0 is reached.
    mob.auras.push(aura('buff_armor', 10));
    mob.auras.push(aura('dot', 9999, { tickInterval: DT }));
    updateAuras(sim.ctx, mob);
    expect(mob.dead).toBe(true);
  });

  // Re-entrancy repro: a DoT tick calls ctx.dealDamage, which runs its own
  // backward sweeps over this SAME e.auras array and can splice a breaksOnDamage
  // control aura (Fear and friends) or a depleted absorb shield out mid-walk.
  // With that aura at a LOWER index than the DoT (pushed first, so the backward
  // walk reaches the DoT before it), the removal shifts the array and a
  // live-indexed walk lands the just-processed DoT back under the cursor: its
  // remaining/tickTimer are decremented twice and it deals a SECOND tick of
  // damage in the same sim tick.
  it('a DoT tick that breaks a lower-indexed breaksOnDamage aura ages and ticks exactly once', () => {
    const sim = makeSim();
    const mob = spawnMob(sim, 1000);
    const fear = aura('incapacitate', 0, { breaksOnDamage: true, remaining: 10, duration: 10 });
    const dot = aura('dot', 50, { tickInterval: DT, remaining: 60, duration: 60 });
    mob.auras.push(fear, dot);

    const hp0 = mob.hp;
    updateAuras(sim.ctx, mob);

    // Exactly one tick: the double-tick this guards against would take 100.
    expect(hp0 - mob.hp).toBe(50);
    // The DoT's own damage still breaks the fear, as it should.
    expect(mob.auras.some((a) => a.kind === 'incapacitate')).toBe(false);
    // ...and the DoT aged by exactly one DT, not two.
    const survivingDot = mob.auras.find((a) => a.kind === 'dot');
    expect(survivingDot).toBeTruthy();
    expect(survivingDot?.remaining).toBeCloseTo(60 - DT, 9);
    expect(mob.auras.length).toBe(1);
  });
});

describe('auras: updateAuras expiry / HoT / top guard', () => {
  it('removes an aura whose remaining has elapsed', () => {
    const sim = makeSim();
    const mob = spawnMob(sim, 1000);
    mob.auras.push(aura('buff_armor', 10, { remaining: DT / 2 })); // elapses this tick
    updateAuras(sim.ctx, mob);
    expect(mob.auras.length).toBe(0);
  });

  it('a HoT tick heals the carrier', () => {
    const sim = makeSim();
    const mob = spawnMob(sim, 1000);
    mob.hp = 500;
    mob.auras.push(aura('hot', 100, { tickInterval: DT }));
    updateAuras(sim.ctx, mob);
    expect(mob.hp).toBeGreaterThan(500);
  });

  it('a HoT tick emits heal2 with hot:true and the aura id as abilityId', () => {
    const sim = makeSim();
    const mob = spawnMob(sim, 1000);
    mob.hp = 500;
    mob.auras.push(aura('hot', 100, { id: 'rejuvenation', tickInterval: DT }));
    sim.drainEvents(); // discard anything queued by spawnMob/setup
    updateAuras(sim.ctx, mob);
    const heals = (sim.drainEvents() as any[]).filter((e) => e.type === 'heal2');
    expect(heals).toHaveLength(1);
    expect(heals[0]).toMatchObject({ hot: true, abilityId: 'rejuvenation', amount: 100 });
  });

  it('applying a hot-kind aura emits one sound-only heal2 (amount:0) at the same moment, distinct from a later tick', () => {
    const sim = makeSim();
    const mob = spawnMob(sim, 1000);
    mob.hp = 500; // below max, or the tick heals for 0 and never emits
    sim.drainEvents();
    sim.ctx.applyAura(mob, aura('hot', 40, { id: 'renew', tickInterval: DT }));
    const onApply = (sim.drainEvents() as any[]).filter((e) => e.type === 'heal2');
    expect(onApply).toHaveLength(1);
    expect(onApply[0]).toMatchObject({ amount: 0, crit: false, abilityId: 'renew' });
    expect(onApply[0].hot).toBeUndefined(); // never flagged as a tick

    // A real tick later still fires its own, separate heal2 with hot:true.
    updateAuras(sim.ctx, mob);
    const onTick = (sim.drainEvents() as any[]).filter((e) => e.type === 'heal2');
    expect(onTick).toHaveLength(1);
    expect(onTick[0]).toMatchObject({ hot: true, abilityId: 'renew' });
    expect(onTick[0].amount).toBeGreaterThan(0);
  });

  it('the top guard skips a dead entity entirely (auras untouched)', () => {
    const sim = makeSim();
    const mob = spawnMob(sim, 1000);
    mob.dead = true;
    mob.auras.push(aura('buff_armor', 10, { remaining: DT / 2 }));
    updateAuras(sim.ctx, mob);
    expect(mob.auras.length).toBe(1); // not processed: still present
  });
});

describe('auras: updateRegen', () => {
  it('eat heals an out-of-combat player on the 40-tick boundary, decrementing the food', () => {
    const sim = makeSim();
    const p = sim.player;
    const meta = sim.players.get(p.id) as PlayerMeta;
    p.inCombat = false;
    p.hp = Math.max(1, p.maxHp - 500);
    p.eating = {
      itemId: 'food',
      kind: 'food',
      hpPer2s: 90,
      manaPer2s: 0,
      remaining: 6,
      ticksElapsed: 0,
    };
    sim.tickCount = 40; // a multiple of 40 so the regen body runs
    const hp0 = p.hp;
    updateRegen(sim.ctx, p, meta);
    expect(p.hp).toBeGreaterThan(hp0); // the food healed
    expect(p.eating?.remaining).toBe(4); // remaining decremented by 2
  });

  it('does nothing off the 40-tick boundary', () => {
    const sim = makeSim();
    const p = sim.player;
    const meta = sim.players.get(p.id) as PlayerMeta;
    p.inCombat = false;
    p.hp = Math.max(1, p.maxHp - 500);
    p.eating = {
      itemId: 'food',
      kind: 'food',
      hpPer2s: 90,
      manaPer2s: 0,
      remaining: 6,
      ticksElapsed: 0,
    };
    sim.tickCount = 41; // not a multiple of 40
    const hp0 = p.hp;
    updateRegen(sim.ctx, p, meta);
    expect(p.hp).toBe(hp0);
    expect(p.eating?.remaining).toBe(6); // untouched
  });

  it('tags a healing eat tick with source:food and sfxTick only on the 3rd real tick', () => {
    const sim = makeSim();
    const p = sim.player;
    const meta = sim.players.get(p.id) as PlayerMeta;
    p.inCombat = false;
    p.hp = Math.max(1, p.maxHp - 500);
    p.eating = {
      itemId: 'food',
      kind: 'food',
      hpPer2s: 10,
      manaPer2s: 0,
      remaining: 18,
      ticksElapsed: 0,
    };
    sim.tickCount = 0;
    const sfxTicks: boolean[] = [];
    for (let i = 0; i < 9; i++) {
      sim.tickCount = 40 * (i + 1);
      sim.drainEvents();
      updateRegen(sim.ctx, p, meta);
      const heals = (sim.drainEvents() as any[]).filter(
        (e) => e.type === 'heal' && e.source === 'food',
      );
      expect(heals).toHaveLength(1); // still healing every tick (hp never caps here)
      expect(heals[0].sfxTick).toBe((i + 1) % 3 === 0);
      sfxTicks.push(heals[0].sfxTick);
    }
    expect(sfxTicks).toEqual([false, false, true, false, false, true, false, false, true]);
  });

  it('a full-hp eat tick still emits a sound-only event on the sfx tick, but stays silent otherwise', () => {
    const sim = makeSim();
    const p = sim.player;
    const meta = sim.players.get(p.id) as PlayerMeta;
    p.inCombat = false;
    p.hp = p.maxHp; // already full: the heal amount is always 0
    p.eating = {
      itemId: 'food',
      kind: 'food',
      hpPer2s: 10,
      manaPer2s: 0,
      remaining: 18,
      ticksElapsed: 0,
    };
    // Tick 1 and 2: not a sfx tick, already full hp -> no emit at all.
    for (const n of [1, 2]) {
      sim.tickCount = 40 * n;
      sim.drainEvents();
      updateRegen(sim.ctx, p, meta);
      expect((sim.drainEvents() as any[]).filter((e) => e.type === 'heal')).toHaveLength(0);
    }
    // Tick 3: the sfx tick, still full hp -> one sound-only (amount 0) emit.
    sim.tickCount = 40 * 3;
    sim.drainEvents();
    updateRegen(sim.ctx, p, meta);
    const heals = (sim.drainEvents() as any[]).filter((e) => e.type === 'heal');
    expect(heals).toHaveLength(1);
    expect(heals[0]).toMatchObject({ source: 'food', sfxTick: true, amount: 0 });
  });
});

describe('auras: cleanseFriendlyNpcAuras', () => {
  it('strips rejected control/debuff auras and leaves benign ones', () => {
    const sim = makeSim();
    const npc = spawnMob(sim);
    npc.auras = [aura('stun', 1), aura('hot', 1), aura('root', 1)];
    cleanseFriendlyNpcAuras(sim.ctx, npc);
    expect(npc.auras.map((a: Aura) => a.kind)).toEqual(['hot']); // stun + root stripped
  });
});
