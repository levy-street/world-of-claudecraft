import { describe, expect, it } from 'vitest';
import { graveyardShiftRunFor } from '../src/sim/graveyard_shift';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, SimEvent } from '../src/sim/types';
import { MELEE_RANGE } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function shiftSim(seed = 42) {
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    devCommands: true,
    offlineHost: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(15);
  sim.chat('/dev graveyardshift start');
  const run = graveyardShiftRunFor(sim.ctx, sim.playerId)!;
  expect(run).not.toBeNull();
  return { sim, run };
}

type Run = ReturnType<typeof shiftSim>['run'];
const botOf = (sim: Sim, run: Run, cls: string) =>
  sim.entities.get(run.bots.find((b) => b.cls === cls)!.pid)!;

// Morthen walks into the party and stands there, so the fight starts and he
// never moves or swings: the party's own play is all that happens.
function engage(sim: Sim, run: Run) {
  const tank = botOf(sim, run, 'warrior');
  const p = sim.player;
  p.pos = sim.ctx.groundPos(tank.pos.x, tank.pos.z + 6);
  p.prevPos = { ...p.pos };
  (sim as any).rebucket(p);
}

function ticks(sim: Sim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.tick());
  return out;
}

const castsBy = (events: SimEvent[], source: Entity, abilityId: string) =>
  events.filter(
    (ev) =>
      ev.type === 'damage' &&
      (ev as any).sourceId === source.id &&
      (ev as any).abilityId === abilityId,
  ).length;

describe('Graveyard Shift party of five', () => {
  it('the rogue fights in melee, building with Sinister Strike and spending on Eviscerate', () => {
    const { sim, run } = shiftSim();
    const rogue = botOf(sim, run, 'rogue');
    engage(sim, run);
    const events = ticks(sim, 20 * 30);
    expect(castsBy(events, rogue, 'sinister_strike')).toBeGreaterThan(0);
    expect(castsBy(events, rogue, 'eviscerate')).toBeGreaterThan(0);
    const d = Math.hypot(rogue.pos.x - sim.player.pos.x, rogue.pos.z - sim.player.pos.z);
    expect(d).toBeLessThanOrEqual(MELEE_RANGE);
  });

  it('the hunter shoots from range: Serpent Sting kept up and Arcane Shot', () => {
    const { sim, run } = shiftSim();
    const hunter = botOf(sim, run, 'hunter');
    engage(sim, run);
    const events = ticks(sim, 20 * 20);
    expect(castsBy(events, hunter, 'arcane_shot')).toBeGreaterThan(0);
    expect(sim.player.auras.some((a) => a.id === 'serpent_sting' && a.sourceId === hunter.id)).toBe(
      true,
    );
    const d = Math.hypot(hunter.pos.x - sim.player.pos.x, hunter.pos.z - sim.player.pos.z);
    expect(d).toBeGreaterThan(8);
  });

  it("Morthen's Shadow Pulse is never pushed back, however often he is hit", () => {
    const { sim, run } = shiftSim();
    engage(sim, run);
    // Hold the party in place so nothing kicks the cast.
    for (const b of run.bots) {
      sim.entities.get(b.pid)!.auras.push({
        id: 'test_hold',
        name: 'Hold',
        kind: 'stun',
        remaining: 30,
        duration: 30,
        value: 0,
        sourceId: sim.playerId,
        school: 'physical',
      } as Aura);
    }
    const p = sim.player;
    p.resource = p.maxResource;
    sim.castAbility('gshift_shadow_pulse');
    expect(p.castingAbility).toBe('gshift_shadow_pulse');
    const rogue = botOf(sim, run, 'rogue');
    let completed = false;
    for (let i = 0; i < 41 && !completed; i++) {
      (sim as any).dealDamage(rogue, p, 5, false, 'physical', null, 'hit', true);
      const events = sim.tick();
      completed = events.some(
        (ev) => ev.type === 'castStop' && ev.entityId === p.id && (ev as any).success === true,
      );
    }
    expect(completed).toBe(true);
    expect(p.castPushbackReduction).toBe(1);
  });
});
