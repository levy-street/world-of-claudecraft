import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import {
  type CrowdControlDrCategory,
  DT,
  type Entity,
  GCD,
  type WorldContent,
} from '../src/sim/types';

// Rogue stuns walk the PvP diminishing-returns ladder (src/sim/stun_dr.ts,
// stunDiminishesInPvp) while every other player stun stays exempt. Gut Punch
// (openerStun) and Low Blow (controlledStun) each run 100/50/25/immune on their
// own bucket with the 18 sec stun reset. Without this, Cheap Trick's
// stealth-free Gut Punch chained between Low Blows held a player stunned for a
// whole duel. Every case below runs a REAL duel through the live cast gates.

// Two players and nothing else (the pvp_safety.test.ts pattern).
const DUEL_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const TPS = Math.round(1 / DT);

function duel(attacker: 'rogue' | 'paladin', rows: Record<number, string> = {}) {
  const sim = new Sim({ seed: 42, playerClass: attacker, noPlayer: true, world: DUEL_WORLD });
  const aPid = sim.addPlayer(attacker, 'Attacker', { autoEquip: true });
  const bPid = sim.addPlayer('warrior', 'Victim', { autoEquip: true });
  sim.setPlayerLevel(20, aPid);
  sim.setPlayerLevel(20, bPid);
  expect(sim.applyTalents({ spec: null, rows }, aPid)).toBe(true);
  const a = sim.entities.get(aPid);
  const b = sim.entities.get(bPid);
  if (!a || !b) throw new Error('duel players were not spawned');
  b.pos = { ...a.pos, z: a.pos.z + 2 };
  b.prevPos = { ...b.pos };
  a.facing = 0;
  sim.duelRequest(bPid, aPid);
  sim.duelAccept(bPid);
  for (let i = 0; i < 5 * TPS && sim.duelFor(aPid)?.state !== 'active'; i++) sim.tick();
  expect(sim.duelFor(aPid)?.state).toBe('active');
  sim.targetEntity(bPid, aPid);
  return { sim, aPid, bPid, a, b };
}

function drStage(sim: Sim, b: Entity, category: CrowdControlDrCategory): number {
  const state = b.ccDr.get(category);
  return state && state.resetAt > sim.time ? state.stage : 0;
}

// Cast one stun and return the duration it landed with: 0 when the target was
// already immune. A melee special can miss or be dodged, which applies nothing
// and leaves the ladder alone, so retry until the cast connected (the ladder
// advanced, or the target already sat at immune).
function landStun(
  setup: ReturnType<typeof duel>,
  abilityId: string,
  category: CrowdControlDrCategory,
): number {
  const { sim, aPid, a, b } = setup;
  for (let attempt = 0; attempt < 50; attempt++) {
    b.auras = b.auras.filter((aura) => aura.kind !== 'stun');
    b.hp = b.maxHp;
    a.gcdRemaining = 0;
    a.resource = a.maxResource;
    a.comboPoints = 5;
    a.cooldowns.delete(abilityId);
    a.facing = 0;
    const before = drStage(sim, b, category);
    sim.castAbility(abilityId, aPid);
    sim.tick();
    const stun = b.auras.find((aura) => aura.kind === 'stun');
    if (drStage(sim, b, category) > before) return stun?.duration ?? 0;
    if (before >= 3) return stun?.duration ?? 0;
  }
  throw new Error(`${abilityId} never connected`);
}

describe('rogue stuns diminish in PvP', () => {
  it('Gut Punch walks 4, 2, 1, then immune, and is fresh again after the 18 sec reset', () => {
    const setup = duel('rogue', { 11: 'rog_r11_cheap_trick' });
    const gutPunch = () => landStun(setup, 'cheap_shot', 'openerStun');
    expect(gutPunch()).toBe(4);
    expect(gutPunch()).toBe(2);
    expect(gutPunch()).toBe(1);
    expect(gutPunch()).toBe(0);
    expect(setup.b.auras.some((aura) => aura.kind === 'stun')).toBe(false);

    for (let i = 0; i < 19 * TPS; i++) setup.sim.tick();
    expect(gutPunch()).toBe(4);
  });

  it('Low Blow walks its own ladder, untouched by a spent Gut Punch chain', () => {
    const setup = duel('rogue', { 11: 'rog_r11_cheap_trick' });
    for (let i = 0; i < 3; i++) landStun(setup, 'cheap_shot', 'openerStun');
    expect(drStage(setup.sim, setup.b, 'openerStun')).toBe(3);

    // 5 combo points: 2 sec base plus 1 per point.
    const lowBlow = () => landStun(setup, 'kidney_shot', 'controlledStun');
    expect(lowBlow()).toBe(7);
    expect(lowBlow()).toBe(3.5);
    expect(lowBlow()).toBe(1.75);
    expect(lowBlow()).toBe(0);
  });

  it('leaves other player stuns exempt: Sundering Gavel stays 3 sec on a Low Blow ladder', () => {
    const setup = duel('paladin');
    // The target's controlled-stun bucket is already spent to immune by a rogue.
    setup.b.ccDr.set('controlledStun', { stage: 3, resetAt: setup.sim.time + 18 });
    const { sim, aPid, a, b } = setup;
    const gavel = () => {
      for (let attempt = 0; attempt < 50; attempt++) {
        b.auras = b.auras.filter((aura) => aura.kind !== 'stun');
        a.gcdRemaining = 0;
        a.resource = a.maxResource;
        a.cooldowns.delete('hammer_of_justice');
        sim.castAbility('hammer_of_justice', aPid);
        for (let i = 0; i < 3; i++) sim.tick();
        const stun = b.auras.find((aura) => aura.kind === 'stun');
        if (stun) return stun.duration;
      }
      return 0;
    };
    expect(gavel()).toBe(3);
    expect(gavel()).toBe(3);
    // An exempt stun never writes a DR stage of its own.
    expect(b.ccDr.get('controlledStun')?.stage).toBe(3);
  });
});

describe('the Cheap Trick stunlock is capped', () => {
  it('a 120 sec Gut Punch and Low Blow chain never holds the target past 15 sec', () => {
    const rows = {
      11: 'rog_r11_cheap_trick',
      14: 'rog_r14_dusk_economy',
      17: 'rog_r17_ghostfoot_gambit',
    };
    const { sim, aPid, bPid, a, b } = duel('rogue', rows);
    const immune = (category: CrowdControlDrCategory) => drStage(sim, b, category) >= 3;
    let stunned = 0;
    let chain = 0;
    let gap = 0;
    let longest = 0;
    const total = 120 * TPS;
    for (let t = 0; t < total; t++) {
      b.hp = b.maxHp;
      a.facing = 0;
      const remaining = Math.max(
        0,
        ...b.auras.filter((x) => x.kind === 'stun').map((x) => x.remaining),
      );
      const ready = (id: string) => (a.cooldowns.get(id) ?? 0) <= 0;
      if (remaining <= DT * 1.5) {
        // The best stunlock play: recast as each stun ends, never into immunity.
        if (ready('kidney_shot') && a.comboPoints >= 1 && !immune('controlledStun')) {
          sim.castAbility('kidney_shot', aPid);
        } else if (!immune('openerStun')) {
          if (a.resource < 50) {
            sim.castAbility('adrenaline_rush', aPid);
            if (a.resource < 50) sim.castAbility('evasion', aPid);
            if (a.resource < 50) sim.castAbility('vanish', aPid);
            sim.targetEntity(bPid, aPid);
          }
          sim.castAbility('cheap_shot', aPid);
        } else if (a.resource >= 85) {
          sim.castAbility('hemorrhage', aPid);
        }
      } else if (remaining > GCD + 0.25 && a.resource >= 85) {
        sim.castAbility('hemorrhage', aPid);
      }
      sim.tick();
      // A gap of up to 2 ticks is the expire-then-recast ordering, not a window.
      if (b.auras.some((x) => x.kind === 'stun')) {
        stunned++;
        chain += 1 + gap;
        gap = 0;
        longest = Math.max(longest, chain);
      } else if (chain > 0 && gap < 2) {
        gap++;
      } else {
        chain = 0;
        gap = 0;
      }
    }
    // Gut Punch 4 + Low Blow 7 + Gut Punch 2 + 1 is the longest the ladders allow.
    expect(longest / TPS).toBeLessThanOrEqual(14.5);
    expect(stunned / total).toBeLessThan(0.7);
    // The rotation really did chain: a broken harness would pass the bounds above.
    expect(longest / TPS).toBeGreaterThan(10);
  });
});
