import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import { emptyAllocation, type TalentAllocation } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, SimEvent } from '../src/sim/types';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

// Bladed Echo (operator design): casting Bladed Gyre (whirlwind, the fury
// talent AoE) arms an 'aoe_echo' aura with 2 charges. Each of the caster's
// next 2 single-target damaging ability CASTS also strikes every OTHER hostile
// enemy within 8 yd of the primary target for the SAME resolved amounts (no
// re-roll), consuming ONE charge per cast, only when the cast actually dealt
// damage. Already-AoE abilities (whirlwind itself included) neither echo nor
// consume. See src/sim/combat/area_echo.ts.

type TestSim = Sim & {
  nextId: number;
  players: Map<number, PlayerMeta>;
  addEntity(entity: Entity): void;
};

const furyWhirlwindAlloc = (): TalentAllocation => ({
  ...emptyAllocation(),
  spec: 'fury',
  ranks: { fury_cruelty: 2, fury_whirlwind: 1 },
});

function makeSim(seed = 31337): { sim: TestSim; p: Entity } {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true }) as unknown as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.applyTalents(furyWhirlwindAlloc())).toBe(true);
  // A warrior spawns seeded in Battle Stance; one tick lets the stance reconcile
  // swap it to Berserker (the Fury default) so rage mints carry no Battle bonus.
  sim.tick();
  return { sim, p: sim.player };
}

function spawnMob(sim: TestSim, p: Entity, dz: number): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 1, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  });
  mob.maxHp = 50000;
  mob.hp = 50000;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  return mob;
}

/** Primary target at 4 yd, a second enemy 3 yd behind it (inside the 8 yd echo
 *  ring around the PRIMARY), and a third far outside it. */
function arena(sim: TestSim, p: Entity): { primary: Entity; near: Entity; far: Entity } {
  const primary = spawnMob(sim, p, 4);
  const near = spawnMob(sim, p, 7);
  const far = spawnMob(sim, p, 30);
  p.facing = Math.atan2(primary.pos.x - p.pos.x, primary.pos.z - p.pos.z);
  sim.targetEntity(primary.id, p.id);
  return { primary, near, far };
}

function echoAura(p: Entity): Aura | undefined {
  return p.auras.find((a) => a.kind === 'aoe_echo');
}

function hitsOn(events: SimEvent[], abilityName: string, targetId: number): number[] {
  return events
    .filter(
      (e): e is Extract<SimEvent, { type: 'damage' }> =>
        e.type === 'damage' &&
        e.ability === abilityName &&
        e.targetId === targetId &&
        e.kind === 'hit',
    )
    .map((e) => e.amount);
}

function recast(sim: TestSim, p: Entity, abilityId: string): SimEvent[] {
  p.gcdRemaining = 0;
  p.cooldowns.delete(abilityId);
  p.resource = 100;
  sim.drainEvents();
  sim.castAbility(abilityId);
  return sim.drainEvents();
}

describe('Bladed Gyre arms the echo', () => {
  it('(a) casting whirlwind applies the aoe_echo aura with 2 charges under its own name', () => {
    const { sim, p } = makeSim();
    arena(sim, p);
    p.resource = 100;
    sim.drainEvents();
    sim.castAbility('whirlwind');
    const aura = echoAura(p);
    expect(aura).toBeDefined();
    expect(aura?.id).toBe('bladed_echo');
    expect(aura?.name).toBe('Bladed Echo');
    expect(aura?.charges).toBe(2);
    // Arming it never consumes it: whirlwind is itself AoE.
    expect(aura?.duration).toBe(12);
  });

  it('the aura name has a client i18n matcher row (buff bar + combat log)', () => {
    expect(localizeSimAuraName('Bladed Echo')).not.toBeNull();
  });
});

describe('single-target casts echo onto enemies near the target', () => {
  it('(b) a single strike also hits the second enemy for 65% of the amount and spends one charge', () => {
    const { sim, p } = makeSim();
    const { primary, near, far } = arena(sim, p);
    p.resource = 100;
    sim.castAbility('whirlwind');
    expect(echoAura(p)?.charges).toBe(2);

    const events = recast(sim, p, 'bloodthirst');
    const primaryHits = hitsOn(events, 'Bloodletting', primary.id);
    expect(primaryHits).toHaveLength(1);
    expect(primaryHits[0]).toBeGreaterThan(0);
    // The echo replays the RESOLVED amount at 65% (owner 2026-07-09), no re-roll.
    expect(hitsOn(events, 'Bloodletting', near.id)).toEqual([
      Math.max(1, Math.round(primaryHits[0] * 0.65)),
    ]);
    // Never onto the primary twice, never past the 8 yd ring.
    expect(hitsOn(events, 'Bloodletting', far.id)).toEqual([]);
    expect(echoAura(p)?.charges).toBe(1);
  });

  it('(c) the third single-target cast after both charges no longer echoes', () => {
    const { sim, p } = makeSim();
    const { primary, near } = arena(sim, p);
    p.resource = 100;
    sim.castAbility('whirlwind');

    recast(sim, p, 'bloodthirst'); // charge 2 -> 1
    expect(echoAura(p)?.charges).toBe(1);
    const second = recast(sim, p, 'bloodthirst'); // charge 1 -> 0, aura drops
    expect(hitsOn(second, 'Bloodletting', near.id)).toHaveLength(1);
    expect(echoAura(p)).toBeUndefined();
    expect(
      second.some((e) => e.type === 'aura' && e.name === 'Bladed Echo' && e.gained === false),
    ).toBe(true);

    const third = recast(sim, p, 'bloodthirst');
    expect(hitsOn(third, 'Bloodletting', primary.id)).toHaveLength(1);
    expect(hitsOn(third, 'Bloodletting', near.id)).toEqual([]);
  });

  it('(d) Red Harvest consumes ONE charge and echoes all three strikes', () => {
    const { sim, p } = makeSim();
    const { primary, near, far } = arena(sim, p);
    p.resource = 100;
    sim.castAbility('whirlwind');
    expect(echoAura(p)?.charges).toBe(2);

    const events = recast(sim, p, 'red_harvest');
    const primaryHits = hitsOn(events, 'Red Harvest', primary.id);
    expect(primaryHits).toHaveLength(3);
    // Each strike echoes its own resolved amount at 65%, in strike order.
    expect(hitsOn(events, 'Red Harvest', near.id)).toEqual(
      primaryHits.map((h) => Math.max(1, Math.round(h * 0.65))),
    );
    expect(hitsOn(events, 'Red Harvest', far.id)).toEqual([]);
    // One cast = one charge, no matter how many strikes it carries.
    expect(echoAura(p)?.charges).toBe(1);
  });

  it('(e) AoE and buff casts neither echo nor consume; whirlwind never spends its own aura', () => {
    const { sim, p } = makeSim();
    const { near } = arena(sim, p);
    p.resource = 100;
    sim.castAbility('whirlwind');
    expect(echoAura(p)?.charges).toBe(2);

    // Quaking Blow is already AoE: it must not consume a charge (it hits the
    // nearby enemies through its OWN aoeDamage, so only assert the charges).
    recast(sim, p, 'thunder_clap');
    expect(echoAura(p)?.charges).toBe(2);

    // A pure buff cast (Iron Bellow) has no single-target damage: no consume.
    const shout = recast(sim, p, 'battle_shout');
    expect(echoAura(p)?.charges).toBe(2);
    expect(hitsOn(shout, 'Iron Bellow', near.id)).toEqual([]);

    // Re-casting whirlwind re-arms rather than consuming.
    recast(sim, p, 'whirlwind');
    expect(echoAura(p)?.charges).toBe(2);
  });
});

describe('Bladed Gyre generates rage instead of costing it', () => {
  it('(g) whirlwind costs no rage', () => {
    expect(ABILITIES.whirlwind.cost).toBe(0);
  });

  // Cast Bladed Gyre against `n` enemies clustered inside the 8 yd spin (the
  // first is the melee target) from an EMPTY rage bar, and return the rage
  // gained: rageOnHit = 5 base + 1 per enemy struck, capped at +5 (5 to 10).
  function rageFromSpin(n: number, seed = 4242): number {
    const { sim, p } = makeSim(seed);
    const zs = [3, 2, 4, 5, 6, 7, 7.5, 6.5, 5.5, 4.5];
    const mobs = zs.slice(0, n).map((dz) => spawnMob(sim, p, dz));
    p.facing = 0; // facing +z, into the cluster
    sim.targetEntity(mobs[0].id, p.id);
    p.resource = 0;
    sim.drainEvents();
    sim.castAbility('whirlwind');
    // Every clustered enemy was struck, so each counts toward the rage grant.
    for (const m of mobs) expect(m.hp).toBeLessThan(m.maxHp);
    return p.resource;
  }

  it('(h) 2 enemies struck grants 5 + min(2,5) = 7 rage', () => {
    expect(rageFromSpin(2)).toBe(7);
  });

  it('(i) 7 enemies struck is capped at 5 + min(7,5) = 10 rage', () => {
    expect(rageFromSpin(7)).toBe(10);
  });
});

describe('determinism', () => {
  it('(f) an identical seeded echo fight replays byte-identically', () => {
    const run = (): string => {
      const { sim, p } = makeSim(7);
      const { primary, near, far } = arena(sim, p);
      const amounts: number[] = [];
      const record = (events: SimEvent[]) => {
        for (const e of events) if (e.type === 'damage') amounts.push(e.amount);
      };
      p.resource = 100;
      sim.castAbility('whirlwind');
      record(sim.drainEvents());
      record(recast(sim, p, 'bloodthirst'));
      record(recast(sim, p, 'red_harvest'));
      for (let i = 0; i < 20 * 2; i++) record(sim.tick());
      return JSON.stringify([
        amounts,
        primary.hp,
        near.hp,
        far.hp,
        p.hp,
        echoAura(p)?.charges ?? null,
      ]);
    };
    expect(run()).toBe(run());
  });
});
