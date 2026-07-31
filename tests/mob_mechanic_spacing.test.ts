// Rift boss shared mechanic spacing: a rift-spawned boss must never land two
// attack mechanics on top of each other (playtest 2026-07-30: the Abyssal Maw
// feared and AOE'd the same instant, which is unplayable). Every spacing-governed
// mechanic fire arms one shared per-entity lock (mob/mechanic_spacing.ts); while
// it runs, any other due mechanic HOLDS AT DUE and fires the tick the lock
// clears (it never loses its whole cycle). A hardcast arms the lock for its cast
// time plus the spacing, so an instant can never land mid-telegraph either.
// The lock is stamped at rift spawn only (riftMechanicSpacing): world and
// dungeon bosses keep their shipped free-running timers.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  claimMechanicSpacing,
  mechanicSpacingBlocked,
  RIFT_MECHANIC_SPACING_SEC,
  resetMechanicSpacing,
  tickMechanicSpacing,
} from '../src/sim/mob/mechanic_spacing';
import { Sim } from '../src/sim/sim';
import { addThreat } from '../src/sim/threat';
import { DT, type Entity } from '../src/sim/types';

const SPACING = RIFT_MECHANIC_SPACING_SEC;

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
}

const fearAura = (e: Entity) => e.auras.find((a) => a.id === 'fear_incap');
const stunAura = (e: Entity) => e.auras.find((a) => a.id === 'stomp_stun');

// Warlord Grask carries stomp (every 11s) and terrify (every 15s), both
// instants with independent timers: the same-tick collision pair the spacing
// lock exists for. The tank (sim.player) holds the boss on threat; the
// bystander stands in radius and is the fear assertion target, because the
// tank itself is fear-exempt (the terrify tank exemption, mob_terrify.test.ts).
function engagedBrute(sim: Sim): { mob: Entity; off: Entity } {
  sim.player.level = 20;
  const mob = createMob(910300, MOBS.rift_boss_brute, 22, { ...sim.player.pos });
  mob.spawnPos = { ...sim.player.pos }; // sit on the player: in radius, no leash
  mob.aiState = 'attack';
  mob.aggroTargetId = sim.playerId;
  mob.inCombat = true;
  addThreat(mob, sim.playerId, 1000);
  (sim as any).addEntity(mob);
  const offId = sim.addPlayer('warrior', 'Bystander', { autoEquip: true });
  const off = sim.entities.get(offId)!;
  off.level = 20;
  off.pos = { ...mob.pos };
  // Pre-recalc hp pool so the first mechanic hit can never kill either player
  // (the first aura apply recalcs stats onto the level-20 line set above).
  sim.player.maxHp = 5000;
  sim.player.hp = 5000;
  off.maxHp = 5000;
  off.hp = 5000;
  return { mob, off };
}

// Keep both players alive and in radius across a multi-tick drive: aura applies
// recalc player stats (shrinking a hand-set maxHp), and mechanics deal damage.
function holdInRadius(sim: Sim, mob: Entity, off: Entity): void {
  sim.player.hp = sim.player.maxHp;
  off.hp = off.maxHp;
  off.pos = { ...mob.pos };
}

describe('mechanic_spacing pure leaf', () => {
  it('every helper is a no-op on an unstamped mob and never defines the lock field', () => {
    // The defined-vs-undefined distinction is the whole defense against parity
    // entity-sample churn: an unstamped mob must never gain the field.
    const mob = {} as Entity;
    claimMechanicSpacing(mob);
    tickMechanicSpacing(mob);
    resetMechanicSpacing(mob);
    expect('mechanicLockTimer' in mob).toBe(false);
    expect(mechanicSpacingBlocked(mob)).toBe(false);
  });

  it('claim arms one spacing window, plus the cast time for a hardcast', () => {
    const mob = { riftMechanicSpacing: SPACING } as Entity;
    claimMechanicSpacing(mob);
    expect(mob.mechanicLockTimer).toBe(SPACING);
    claimMechanicSpacing(mob, 3.5);
    expect(mob.mechanicLockTimer).toBe(SPACING + 3.5);
  });

  it('tick counts the lock down by DT and clamps exactly at zero', () => {
    const mob = { riftMechanicSpacing: SPACING, mechanicLockTimer: DT * 1.5 } as Entity;
    expect(mechanicSpacingBlocked(mob)).toBe(true);
    tickMechanicSpacing(mob);
    expect(mob.mechanicLockTimer).toBeCloseTo(DT * 0.5, 9);
    tickMechanicSpacing(mob);
    expect(mob.mechanicLockTimer).toBe(0); // floored, no float residue
    expect(mechanicSpacingBlocked(mob)).toBe(false);
  });

  it('reset drops an armed lock', () => {
    const mob = { riftMechanicSpacing: SPACING, mechanicLockTimer: 4 } as Entity;
    resetMechanicSpacing(mob);
    expect(mob.mechanicLockTimer).toBe(0);
  });
});

describe('rift boss shared mechanic spacing', () => {
  it('Warlord Grask carries the colliding stomp + terrify pair this lock exists for', () => {
    expect(MOBS.rift_boss_brute.stomp).toBeDefined();
    expect(MOBS.rift_boss_brute.terrify).toBeDefined();
    expect(MOBS.rift_boss_brute.bigCast).toBeDefined();
  });

  it('the spacing window outlasts the longest mechanic CC with a reaction margin', () => {
    expect(RIFT_MECHANIC_SPACING_SEC).toBe(5);
    // Derived, not hardcoded: every rift boss CC (fear or stun) must fully
    // elapse inside one spacing window before the next mechanic can land, so
    // a future longer CC reds this instead of silently shrinking the margin.
    let longestCc = 0;
    for (const template of Object.values(MOBS)) {
      if (!template.id.startsWith('rift_boss_')) continue;
      longestCc = Math.max(
        longestCc,
        template.terrify?.duration ?? 0,
        template.stomp?.duration ?? 0,
      );
    }
    expect(longestCc).toBeGreaterThan(0);
    expect(RIFT_MECHANIC_SPACING_SEC).toBeGreaterThan(longestCc);
  });

  it('holds the second due mechanic instead of stacking both on one tick', () => {
    const sim = makeSim();
    const { mob, off } = engagedBrute(sim);
    mob.riftMechanicSpacing = SPACING;
    mob.stompTimer = 0.001;
    mob.terrifyTimer = 0.001; // both due the same tick
    (sim as any).updateMob(mob);

    expect(stunAura(off)).toBeDefined(); // first in driver order fires
    expect(fearAura(off)).toBeUndefined(); // second holds behind the shared lock
  });

  it('a held mechanic fires the tick the lock clears, not a full cycle later', () => {
    const sim = makeSim();
    const { mob, off } = engagedBrute(sim);
    mob.riftMechanicSpacing = SPACING;
    mob.stompTimer = 0.001;
    mob.terrifyTimer = 0.001;
    (sim as any).updateMob(mob); // stomp fires and arms the lock; terrify holds

    let ticks = 0;
    while (!fearAura(off) && ticks < 20 / DT) {
      holdInRadius(sim, mob, off);
      (sim as any).updateMob(mob);
      ticks++;
    }
    const waited = ticks * DT;
    expect(fearAura(off)).toBeDefined();
    // Held AT DUE: the fear lands one spacing after the stomp, nowhere near a
    // full 15s terrify cycle later.
    expect(waited).toBeGreaterThanOrEqual(SPACING - 2 * DT);
    expect(waited).toBeLessThanOrEqual(SPACING + 2 * DT);
  });

  it('a hardcast arms the lock through its whole cast: no instant lands mid-telegraph', () => {
    const sim = makeSim();
    const { mob, off } = engagedBrute(sim);
    const bigCast = MOBS.rift_boss_brute.bigCast!;
    mob.riftMechanicSpacing = SPACING;
    mob.bigCastTimer = 0.001;
    mob.terrifyTimer = 0.001; // due while the cast bar fills
    (sim as any).updateMob(mob);
    expect(mob.castingAbility).toBe(bigCast.castId); // the cast started and owns the lock

    let ticks = 0;
    while (!fearAura(off) && ticks < 30 / DT) {
      holdInRadius(sim, mob, off);
      (sim as any).updateMob(mob);
      ticks++;
      if (mob.castingAbility !== null) {
        expect(fearAura(off)).toBeUndefined(); // never feared mid-cast
      }
    }
    const waited = ticks * DT;
    expect(fearAura(off)).toBeDefined();
    // The lock covers the cast bar plus one spacing after the detonation.
    expect(waited).toBeGreaterThanOrEqual(bigCast.castTime + SPACING - 2 * DT);
    expect(waited).toBeLessThanOrEqual(bigCast.castTime + SPACING + 2 * DT);
  });

  it('a boss without the rift spacing stamp still runs free timers (non-rift unchanged)', () => {
    const sim = makeSim();
    const { mob, off } = engagedBrute(sim);
    mob.stompTimer = 0.001;
    mob.terrifyTimer = 0.001;
    (sim as any).updateMob(mob);

    // No stamp: both mechanics land on the same tick, exactly as shipped for
    // world and dungeon bosses.
    expect(stunAura(off)).toBeDefined();
    expect(fearAura(off)).toBeDefined();
  });

  it('a saturated kit drains oldest-due first: no mechanic is starved', () => {
    const sim = makeSim();
    const { mob, off } = engagedBrute(sim);
    mob.riftMechanicSpacing = SPACING;
    // The hand-made brute carries no riftMechanicLimit, so stomp (11s),
    // terrify (15s) AND bigCast (16s + 2.8s cast) are all live: their summed
    // lock demand (~1.2x real time) oversubscribes the shared slot. Under a
    // fixed driver-order drain terrify, the last driver, would starve to
    // roughly one fire a minute; oldest-due-first keeps every mechanic alive
    // with each cadence stretched by roughly the same factor.
    const bigCastId = MOBS.rift_boss_brute.bigCast!.castId;
    let stomps = 0;
    let fears = 0;
    let casts = 0;
    let prevStomp = mob.stompTimer;
    let prevTerrify = mob.terrifyTimer;
    let prevCasting: string | null = mob.castingAbility;
    const ticks = Math.round(60 / DT);
    for (let i = 0; i < ticks; i++) {
      holdInRadius(sim, mob, off);
      (sim as any).updateMob(mob);
      if (mob.stompTimer > prevStomp) stomps++;
      if (mob.terrifyTimer > prevTerrify) fears++;
      if (mob.castingAbility === bigCastId && prevCasting !== bigCastId) casts++;
      prevStomp = mob.stompTimer;
      prevTerrify = mob.terrifyTimer;
      prevCasting = mob.castingAbility;
    }
    expect(stomps).toBeGreaterThanOrEqual(4);
    expect(fears).toBeGreaterThanOrEqual(3);
    expect(casts).toBeGreaterThanOrEqual(2);
  });

  it('the lock dies with the pull: evade home clears it, and only on stamped mobs', () => {
    const sim = makeSim();
    const { mob } = engagedBrute(sim);
    mob.riftMechanicSpacing = SPACING;
    mob.mechanicLockTimer = 3;
    (sim as any).resetEvadingMob(mob);
    expect(mob.mechanicLockTimer).toBe(0);

    // An unstamped mob passing the same reset must not gain the field.
    const wolf = createMob(910301, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 });
    (sim as any).addEntity(wolf);
    (sim as any).resetEvadingMob(wolf);
    expect('mechanicLockTimer' in wolf).toBe(false);
  });

  it('the lock dies with the life: respawn clears it', () => {
    const sim = makeSim();
    const { mob } = engagedBrute(sim);
    mob.riftMechanicSpacing = SPACING;
    mob.mechanicLockTimer = 3;
    (sim as unknown as { ctx: { respawnMob(m: Entity): void } }).ctx.respawnMob(mob);
    expect(mob.mechanicLockTimer).toBe(0);
  });

  it('is deterministic: the same seed spaces mechanics on the same ticks', () => {
    const fearTick = (): number => {
      const sim = makeSim();
      const { mob, off } = engagedBrute(sim);
      mob.riftMechanicSpacing = SPACING;
      mob.stompTimer = 0.001;
      mob.terrifyTimer = 0.001;
      (sim as any).updateMob(mob);
      let ticks = 0;
      while (!fearAura(off) && ticks < 20 / DT) {
        holdInRadius(sim, mob, off);
        (sim as any).updateMob(mob);
        ticks++;
      }
      return ticks;
    };
    expect(fearTick()).toBe(fearTick());
  });
});
