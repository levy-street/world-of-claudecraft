// The aoePulse boss mechanic is telegraphed like every one of its siblings
// (stomp, terrify, aoeSlow, mendAlly, ...): createMob seeds the timer to one
// full interval so the opening blast never lands the instant melee contact
// opens, and both pull resets (evade home, respawn) restore that interval.
// pulseTimer was the one timer missing from all three sites, so every carrier
// opened with a free AoE, and any leftover negative drift carried into the
// next pull.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { respawnMob } from '../src/sim/mob/lifecycle';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';

const SEED = 42;

// Mogger is the seeded world carrier of the mechanic (Ground Pound).
const PULSE = MOBS.mogger.aoePulse!;

const ctxOf = (sim: Sim) => (sim as unknown as { ctx: SimContext }).ctx;
const updateMob = (sim: Sim, mob: Entity) =>
  (sim as unknown as { updateMob(m: Entity): void }).updateMob(mob);

function makeSim() {
  return new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
}

// Spawn a pulsing rare locked in melee on the player, exactly as it stands the
// instant a pull connects.
function engagedPulser(sim: Sim, id: number): Entity {
  const mob = createMob(id, MOBS.mogger, MOBS.mogger.maxLevel, { ...sim.player.pos });
  mob.spawnPos = { ...sim.player.pos }; // sit on the player: in melee + pulse radius, no leash
  mob.aiState = 'attack';
  mob.aggroTargetId = sim.playerId;
  mob.inCombat = true;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  return mob;
}

const pulseHits = (events: SimEvent[]) =>
  events.filter((e) => e.type === 'damage' && e.ability === PULSE.name);

describe('aoePulse telegraph', () => {
  it('Mogger carries the pulse mechanic', () => {
    expect(PULSE.name).toBe('Ground Pound');
    expect(PULSE.every).toBe(10);
  });

  it('is telegraphed: a fresh carrier waits one interval before its first blast', () => {
    const mob = createMob(900200, MOBS.mogger, MOBS.mogger.maxLevel, { x: 0, y: 0, z: 0 });
    expect(mob.pulseTimer).toBe(PULSE.every);
  });

  it('lands no blast on the first melee-contact tick', () => {
    const sim = makeSim();
    sim.player.maxHp = 5000;
    sim.player.hp = 5000;
    const mob = engagedPulser(sim, 900201);
    sim.drainEvents();
    updateMob(sim, mob);
    expect(pulseHits(sim.drainEvents())).toHaveLength(0);
    expect(mob.pulseTimer).toBeGreaterThan(0);
  });

  it('blasts once the seeded interval has elapsed', () => {
    const sim = makeSim();
    sim.player.maxHp = 5000;
    sim.player.hp = 5000;
    const mob = engagedPulser(sim, 900202);
    mob.pulseTimer = 0.001; // due now
    sim.drainEvents();
    updateMob(sim, mob);
    expect(pulseHits(sim.drainEvents())).toHaveLength(1);
    expect(mob.pulseTimer).toBeCloseTo(PULSE.every, 5);
  });

  // Both pull resets are twins: a timer restored by one and not the other lets
  // leftover negative drift open the next pull with a free blast.
  for (const [label, reset] of [
    ['resetEvadingMob (leashes home)', (sim: Sim, m: Entity) => ctxOf(sim).resetEvadingMob(m)],
    ['respawnMob (a fresh life)', (sim: Sim, m: Entity) => respawnMob(ctxOf(sim), m)],
  ] as const) {
    it(label + ' restores the full interval', () => {
      const sim = makeSim();
      const mob = engagedPulser(sim, 900203);
      mob.pulseTimer = -3.5; // drifted negative behind a held mechanic slot
      reset(sim, mob);
      expect(mob.pulseTimer).toBe(PULSE.every);
    });
  }

  it('leaves a mob without the mechanic at the untouched default', () => {
    const mob = createMob(900204, MOBS.forest_wolf, 6, { x: 0, y: 0, z: 0 });
    expect(MOBS.forest_wolf.aoePulse).toBeUndefined();
    expect(mob.pulseTimer).toBe(0);
  });
});
