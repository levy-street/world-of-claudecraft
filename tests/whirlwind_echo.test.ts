// Restored from the pre-revert payload (f274835b1^) and adapted to the current
// design: Bladed Gyre (whirlwind) is the FURY SPEC ability now (specs: ['fury'],
// no fury_whirlwind talent rank), and the echo replay fraction was retuned from
// the payload's 65% to AOE_ECHO_MULT = 0.4 with a 4-target cap. Quaking Blow
// (thunder_clap) went Protection-only, so the AoE no-consume check uses a
// whirlwind re-cast instead. Adds the Widening Arc (sweeping_strikes) replay
// interaction the payload never covered.
import { describe, expect, it } from 'vitest';
import { AOE_ECHO_MULT } from '../src/sim/combat/area_echo';
import { ABILITIES } from '../src/sim/content/classes';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, SimEvent } from '../src/sim/types';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

// Bladed Echo (operator design): casting Bladed Gyre (whirlwind, the fury AoE)
// arms an 'aoe_echo' aura with 2 charges. Each of the caster's next 2
// single-target damaging ability CASTS also strikes every OTHER hostile enemy
// within 8 yd of the primary target for AOE_ECHO_MULT of the SAME resolved
// amounts (no re-roll), consuming ONE charge per cast, only when the cast
// actually dealt damage. Already-AoE abilities (whirlwind itself included)
// neither echo nor consume. See src/sim/combat/area_echo.ts.

type TestSim = Sim & {
  nextId: number;
  addEntity(entity: Entity): void;
};

function makeSim(seed = 31337, spec: 'fury' | 'arms' = 'fury'): { sim: TestSim; p: Entity } {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
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
  it('(b) a single strike also hits the second enemy at the echo fraction and spends one charge', () => {
    const { sim, p } = makeSim();
    const { primary, near, far } = arena(sim, p);
    p.resource = 100;
    sim.castAbility('whirlwind');
    expect(echoAura(p)?.charges).toBe(2);

    const events = recast(sim, p, 'bloodthirst');
    const primaryHits = hitsOn(events, 'Bloodletting', primary.id);
    expect(primaryHits).toHaveLength(1);
    expect(primaryHits[0]).toBeGreaterThan(0);
    // The echo replays the RESOLVED amount at AOE_ECHO_MULT (0.4 after the
    // v0.26 retune from the payload's 65%), no re-roll.
    expect(AOE_ECHO_MULT).toBe(0.4);
    expect(hitsOn(events, 'Bloodletting', near.id)).toEqual([
      Math.max(1, Math.round(primaryHits[0] * AOE_ECHO_MULT)),
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
    // Each strike echoes its own resolved amount at the echo fraction, in order.
    expect(hitsOn(events, 'Red Harvest', near.id)).toEqual(
      primaryHits.map((h) => Math.max(1, Math.round(h * AOE_ECHO_MULT))),
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

    // A pure buff cast (Iron Bellow) has no single-target damage: no consume.
    const shout = recast(sim, p, 'battle_shout');
    expect(echoAura(p)?.charges).toBe(2);
    expect(hitsOn(shout, 'Iron Bellow', near.id)).toEqual([]);

    // Re-casting whirlwind (its own aoeDamage disqualifies it) re-arms rather
    // than consuming: still 2 charges after another spin.
    recast(sim, p, 'whirlwind');
    expect(echoAura(p)?.charges).toBe(2);
  });
});

describe('Widening Arc (sweeping strikes) replays the full strike', () => {
  it('a single-target strike under sweeping_strikes hits ONE nearby enemy for the full amount', () => {
    const { sim, p } = makeSim(31337, 'arms');
    const { primary, near, far } = arena(sim, p);
    p.resource = 100;
    sim.drainEvents();
    sim.castAbility('sweeping_strikes');
    expect(p.auras.some((a) => a.kind === 'sweeping_strikes')).toBe(true);

    const events = recast(sim, p, 'mortal_strike');
    const primaryHits = hitsOn(events, 'Maiming Strike', primary.id);
    expect(primaryHits).toHaveLength(1);
    // SWEEP_MULT is 1: the replay carries the identical resolved amount.
    expect(hitsOn(events, 'Maiming Strike', near.id)).toEqual([Math.max(1, primaryHits[0])]);
    expect(hitsOn(events, 'Maiming Strike', far.id)).toEqual([]);
  });
});

describe('Bladed Gyre costs no rage and mints none (v0.27.1 rage fix)', () => {
  it('(g) whirlwind costs no rage', () => {
    expect(ABILITIES.whirlwind.cost).toBe(0);
  });

  it('(g2) whirlwind carries no rage generation of any kind', () => {
    const hasMint = ABILITIES.whirlwind.effects.some(
      (eff: any) => eff.type === 'gainResource' || eff.rageOnHit !== undefined,
    );
    expect(hasMint).toBe(false);
  });

  // Cast Bladed Gyre against `n` enemies clustered inside the 8 yd spin (the
  // first is the melee target) from an EMPTY rage bar, and return the rage
  // gained. Since the v0.27.1 rage fix the spin mints nothing: with Twinstrike,
  // Bloodletting, AND the spin all generating, Fury's rotation was rage-positive
  // and Red Harvest fired every ~6 seconds.
  function rageFromSpin(n: number, seed = 4242): number {
    const { sim, p } = makeSim(seed);
    const zs = [3, 2, 4, 5, 6, 7, 7.5, 6.5, 5.5, 4.5];
    const mobs = zs.slice(0, n).map((dz) => spawnMob(sim, p, dz));
    p.facing = 0; // facing +z, into the cluster
    sim.targetEntity(mobs[0].id, p.id);
    p.resource = 0;
    sim.drainEvents();
    sim.castAbility('whirlwind');
    // Every clustered enemy was struck; striking must still grant nothing.
    for (const m of mobs) expect(m.hp).toBeLessThan(m.maxHp);
    return p.resource;
  }

  it('(h) 2 enemies struck grants no rage', () => {
    expect(rageFromSpin(2)).toBe(0);
  });

  it('(i) a full 7-enemy spin still grants no rage', () => {
    expect(rageFromSpin(7)).toBe(0);
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
