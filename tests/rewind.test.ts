// Chronomancy Rewind (Rebobinar): the "Correct" pillar raid cooldown. Instant, no
// target, 40yd AoE on the caster's group/raid, restoring a fraction of the REAL
// damage each living member took in the last 5s (capped per target). These pin the
// approved design (docs/prd/mage-chronomancy.md) and the 14 mandatory checks.
import { describe, expect, it } from 'vitest';
import { REWIND_WINDOW_TICKS } from '../src/sim/combat/damage_history';
import { rewindHealAmount } from '../src/sim/combat/rewind';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

const REWIND = 'temporal_rewind';

function chronoMage(): { sim: Sim; p: Entity } {
  const sim = new Sim({ seed: 41, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('arcane')).toBe(true);
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

// A group/raid ally added at a spot near the caster, with a roomy pool so the caps
// are easy to reason about. Returns the entity.
function addAlly(sim: Sim, name: string, dx: number, dz: number, maxHp = 100_000): Entity {
  const p = sim.player;
  const id = sim.addPlayer('warrior', name);
  const e = sim.entities.get(id)!;
  e.pos = { x: p.pos.x + dx, y: p.pos.y, z: p.pos.z + dz };
  e.prevPos = { ...e.pos };
  e.maxHp = maxHp;
  e.hp = maxHp;
  return e;
}

function group(sim: Sim, leader: number, members: number[], raid = false): void {
  const invite = (m: number) => {
    sim.partyInvite(m, leader);
    sim.partyAccept(m);
  };
  if (raid) {
    for (const m of members.slice(0, 4)) invite(m);
    (
      sim as unknown as { party: { convertPartyToRaid(pid: number): void } }
    ).party.convertPartyToRaid(leader);
    for (const m of members.slice(4)) invite(m);
  } else {
    for (const m of members) invite(m);
  }
}

// Deal REAL magic damage (armor-independent) through the canonical pipeline so the
// damage history records it, and return the actual HP lost.
function hurt(sim: Sim, target: Entity, amount: number, school = 'shadow'): number {
  const src = sim.entities.get(sim.playerId)!;
  const before = target.hp;
  (
    sim as unknown as {
      dealDamage: (
        s: Entity,
        t: Entity,
        a: number,
        c: boolean,
        sc: string,
        ab: string | null,
        k: string,
      ) => void;
    }
  ).dealDamage(src, target, amount, false, school, null, 'hit');
  return before - target.hp;
}

// Cast Rewind and return the heal2 events it produced.
function castRewind(sim: Sim, caster: Entity): SimEvent[] {
  const heals: SimEvent[] = [];
  sim.castAbility(REWIND);
  for (const e of sim.tick() as SimEvent[]) {
    if (e.type === 'heal2' && e.sourceId === caster.id) heals.push(e);
  }
  return heals;
}

describe('Rewind: healing math', () => {
  it('uses the same capped math for the raid-frame preview', () => {
    expect(rewindHealAmount(1000, 500, 1000)).toBe(300);
    expect(rewindHealAmount(10_000, 0, 1000)).toBe(350);
    expect(rewindHealAmount(1000, 900, 1000)).toBe(100);
  });
  it('1. heals exactly 30% of the real damage taken within the last 5s', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'A', 3, 0);
    group(sim, p.id, [ally.id]);
    const lost = hurt(sim, ally, 10_000); // 30% = 3000, well under the 35% and missing caps
    const hp0 = ally.hp;
    castRewind(sim, p);
    expect(ally.hp - hp0).toBe(Math.round(lost * 0.3));
  });

  it('2. damage older than 5s no longer counts', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'A', 3, 0);
    group(sim, p.id, [ally.id]);
    hurt(sim, ally, 10_000);
    for (let t = 0; t < REWIND_WINDOW_TICKS + 2; t++) sim.tick(); // age it past 5s
    ally.hp = ally.maxHp - 5000; // still hurt, so a heal WOULD land if history counted
    const hp0 = ally.hp;
    castRewind(sim, p);
    expect(ally.hp).toBe(hp0); // nothing recent to rewind
  });

  it('3. respects the 35% max-HP cap', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'A', 3, 0, 20_000);
    group(sim, p.id, [ally.id]);
    // Accumulate 30000 of real damage (two hits, restoring between): 30% = 9000, but
    // the 35% of 20000 = 7000 cap is lower, so it is the binding limit.
    hurt(sim, ally, 15_000);
    ally.hp = ally.maxHp; // restore (healing is not recorded)
    hurt(sim, ally, 15_000);
    ally.hp = 1; // missing = 19999, huge, so it never binds
    const hp0 = ally.hp;
    castRewind(sim, p);
    expect(ally.hp - hp0).toBe(Math.round(ally.maxHp * 0.35));
  });

  it('4. never heals more than the missing health', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'A', 3, 0, 50_000);
    group(sim, p.id, [ally.id]);
    hurt(sim, ally, 40_000); // huge recent damage
    ally.hp = ally.maxHp - 100; // only 100 missing
    castRewind(sim, p);
    expect(ally.hp).toBe(ally.maxHp); // filled exactly, never overhealed
  });

  it('5. fully absorbed damage never enters the history', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'A', 3, 0);
    group(sim, p.id, [ally.id]);
    ally.auras.push({
      id: 'test_shield',
      name: 'Shield',
      kind: 'absorb',
      value: 8000,
      remaining: 60,
      duration: 60,
      sourceId: ally.id,
      school: 'arcane',
    });
    const lost = hurt(sim, ally, 6000); // fully soaked by the 8000 shield
    expect(lost).toBe(0);
    ally.hp = ally.maxHp - 5000; // hurt by other means, so only the absorbed hit is in question
    const hp0 = ally.hp;
    castRewind(sim, p);
    expect(ally.hp).toBe(hp0); // the absorbed hit contributed nothing to rewind
  });
});

describe('Rewind: targeting', () => {
  it('6. affects every living group/raid member in 40yd, with no five-target cap', () => {
    const { sim, p } = chronoMage();
    const allies: Entity[] = [];
    for (let i = 0; i < 8; i++) allies.push(addAlly(sim, `A${i}`, 2 + i * 0.5, 1)); // tight cluster
    group(
      sim,
      p.id,
      allies.map((a) => a.id),
      true,
    );
    for (const a of allies) {
      hurt(sim, a, 10_000);
      a.hp = a.maxHp - 6000;
    }
    const before = allies.map((a) => a.hp);
    castRewind(sim, p);
    // All eight allies healed (a party-only cap of five would have left three dry).
    allies.forEach((a, i) => {
      expect(a.hp).toBeGreaterThan(before[i]);
    });
  });

  it('7. excludes out-of-range, dead, enemies, and non-group players (and pets/NPCs)', () => {
    const { sim, p } = chronoMage();
    const near = addAlly(sim, 'Near', 3, 0);
    const far = addAlly(sim, 'Far', 60, 0); // > 40yd
    const dead = addAlly(sim, 'Dead', 4, 0);
    group(sim, p.id, [near.id, far.id, dead.id]);
    // A non-group player standing in range.
    const outsiderId = sim.addPlayer('warrior', 'Outsider');
    const outsider = sim.entities.get(outsiderId)!;
    outsider.pos = { x: p.pos.x + 2, y: p.pos.y, z: p.pos.z };
    outsider.maxHp = 100_000;
    // An enemy mob in range.
    const enemy = createMob(9600, MOBS.training_dummy, 20, {
      x: p.pos.x + 2,
      y: p.pos.y,
      z: p.pos.z,
    });
    enemy.hostile = true;
    enemy.maxHp = enemy.hp = 100_000;
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(enemy);
    for (const e of [near, far, dead, outsider, enemy]) {
      hurt(sim, e, 10_000);
      e.hp = e.maxHp - 6000;
    }
    dead.dead = true;
    const snap = (e: Entity) => e.hp;
    const farHp = snap(far);
    const deadHp = snap(dead);
    const outHp = snap(outsider);
    const enemyHp = snap(enemy);
    const nearHp = snap(near);
    castRewind(sim, p);
    expect(near.hp).toBeGreaterThan(nearHp); // the only valid target
    expect(far.hp).toBe(farHp);
    expect(dead.hp).toBe(deadHp);
    expect(outsider.hp).toBe(outHp);
    expect(enemy.hp).toBe(enemyHp);
  });

  it('8. heals the Chronomancer itself when playing solo', () => {
    const { sim, p } = chronoMage();
    p.maxHp = 50_000;
    p.hp = p.maxHp;
    const lost = hurt(sim, p, 10_000);
    p.hp = p.maxHp - 6000;
    const hp0 = p.hp;
    castRewind(sim, p);
    expect(p.hp - hp0).toBe(Math.round(lost * 0.3));
  });
});

describe('Rewind: rules', () => {
  it('9. can never be a critical heal (and draws no rng)', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'A', 3, 0);
    group(sim, p.id, [ally.id]);
    hurt(sim, ally, 10_000);
    ally.hp = ally.maxHp - 6000;
    const heals = castRewind(sim, p);
    expect(heals.length).toBe(1);
    expect((heals[0] as { crit: boolean }).crit).toBe(false);
  });

  it('10. applies no Temporal Echo mark and triggers no Arcane conversion', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'A', 3, 0);
    group(sim, p.id, [ally.id]);
    hurt(sim, ally, 10_000);
    ally.hp = ally.maxHp - 6000;
    castRewind(sim, p);
    // No echo mark placed on the ally or the caster by Rewind.
    expect(ally.auras.some((a) => a.kind === 'temporal_echo')).toBe(false);
    expect(p.auras.some((a) => a.kind === 'temporal_echo')).toBe(false);
  });

  it('11. generates normal healing threat', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'A', 3, 0);
    group(sim, p.id, [ally.id]);
    // A hostile mob already in combat with the ally.
    const mob = createMob(9700, MOBS.training_dummy, 20, {
      x: p.pos.x + 3,
      y: p.pos.y,
      z: p.pos.z + 1,
    });
    mob.hostile = true;
    mob.inCombat = true;
    // createMob defaults combatTimer to 99; the ported dummy reset (5s after the
    // last hit) would clear the threat table on the first tick otherwise.
    mob.combatTimer = 0;
    mob.maxHp = mob.hp = 1_000_000;
    mob.threat.set(ally.id, 500);
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
    hurt(sim, ally, 10_000);
    ally.hp = ally.maxHp - 6000;
    castRewind(sim, p);
    expect(mob.threat.get(p.id) ?? 0).toBeGreaterThan(0); // the heal put the mage on the mob's list
  });

  it('12. costs 150 mana and arms a 120s cooldown at level 20', () => {
    const def = ABILITIES[REWIND];
    expect(def.cost).toBe(150);
    expect(def.cooldown).toBe(120);
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'A', 3, 0);
    group(sim, p.id, [ally.id]);
    hurt(sim, ally, 10_000);
    ally.hp = ally.maxHp - 6000;
    const mana0 = p.resource;
    sim.castAbility(REWIND);
    sim.tick();
    expect(mana0 - p.resource).toBe(150);
    expect(p.cooldowns.get(REWIND) ?? 0).toBeGreaterThan(0);
  });

  it('13. multiple Chronomancers rewind independently from the same history', () => {
    const { sim, p } = chronoMage();
    const mage2Id = sim.addPlayer('mage', 'Chrono2');
    sim.setPlayerLevel(20, mage2Id);
    expect(sim.setSpec('arcane', mage2Id)).toBe(true);
    const mage2 = sim.entities.get(mage2Id)!;
    mage2.pos = { x: p.pos.x + 2, y: p.pos.y, z: p.pos.z };
    mage2.resource = mage2.maxResource;
    const ally = addAlly(sim, 'A', 3, 0);
    group(sim, p.id, [mage2.id, ally.id]);
    const lost = hurt(sim, ally, 10_000);
    ally.hp = ally.maxHp - 6000;
    // First mage rewinds.
    const hpA = ally.hp;
    sim.castAbility(REWIND, p.id);
    sim.tick();
    const firstHeal = ally.hp - hpA;
    expect(firstHeal).toBe(Math.round(lost * 0.3));
    // Second mage rewinds from the SAME (un-consumed) history and heals again.
    const hpB = ally.hp;
    sim.castAbility(REWIND, mage2.id);
    sim.tick();
    expect(ally.hp - hpB).toBe(Math.round(lost * 0.3));
  });

  it('14. is fully deterministic (same seed and inputs -> identical result)', () => {
    const run = () => {
      const { sim, p } = chronoMage();
      const ally = addAlly(sim, 'A', 3, 0);
      group(sim, p.id, [ally.id]);
      hurt(sim, ally, 12_345);
      ally.hp = ally.maxHp - 6000;
      castRewind(sim, p);
      return ally.hp;
    };
    expect(run()).toBe(run());
  });

  it('emits one short temporal clock sound event per cast', () => {
    const { sim } = chronoMage();
    sim.castAbility(REWIND);
    const events = sim.tick() as SimEvent[];
    expect(
      events.filter((event) => event.type === 'spellfx' && event.fx === 'temporalClock'),
    ).toHaveLength(1);
    expect(events.some((event) => event.type === 'spellfx' && event.fx === 'nova')).toBe(false);
    expect(
      events.filter((event) => event.type === 'spellfx' && event.fx === 'temporalRewindNova'),
    ).toHaveLength(1);
  });
});
