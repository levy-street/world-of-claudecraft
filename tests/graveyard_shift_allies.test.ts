import { describe, expect, it } from 'vitest';
import { graveyardShiftRunFor } from '../src/sim/graveyard_shift';
import { ALLY_DEATH_DREAD } from '../src/sim/graveyard_shift/dread';
import { GRAVEYARD_SHIFT_ALLY_TEMPLATE } from '../src/sim/graveyard_shift/run_allies';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { clearGraveyardShiftOpening } from './helpers/graveyard_shift_opening';
import { EMPTY_TEST_WORLD } from './sim_shared';

function shiftSim() {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    devCommands: true,
    offlineHost: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(15);
  sim.chat('/dev graveyardshift start');
  const run = graveyardShiftRunFor(sim.ctx, sim.playerId)!;
  expect(run).not.toBeNull();
  clearGraveyardShiftOpening(sim, run);
  return { sim, run };
}

const isHostile = (sim: Sim, a: Entity, b: Entity) => (sim as any).isHostileTo(a, b) as boolean;
const allies = (sim: Sim, run: { allyIds: number[] }) =>
  run.allyIds.map((id) => sim.entities.get(id)!);

function engage(sim: Sim, run: { bots: { pid: number }[] }) {
  const tank = sim.entities.get(run.bots[0].pid)!;
  const p = sim.player;
  p.pos = sim.ctx.groundPos(tank.pos.x, tank.pos.z + 6);
  p.prevPos = { ...p.pos };
  (sim as any).rebucket(p);
}

describe('Graveyard Shift skeleton allies', () => {
  it('raises two level-10 skeletons owned by Morthen that are never his pet', () => {
    const { sim, run } = shiftSim();
    const skeletons = allies(sim, run);
    expect(skeletons).toHaveLength(2);
    for (const s of skeletons) {
      expect(s.templateId).toBe(GRAVEYARD_SHIFT_ALLY_TEMPLATE);
      expect(s.ownerId).toBe(sim.playerId);
      expect(s.level).toBe(10);
    }
    expect(sim.petOf(sim.playerId)).toBeNull();
  });

  it('holds passive while the party waits, then turns aggressive once engaged', () => {
    const { sim, run } = shiftSim();
    for (let i = 0; i < 40; i++) sim.tick();
    expect(run.engaged).toBe(false);
    for (const s of allies(sim, run)) expect(s.petMode).toBe('passive');
    engage(sim, run);
    for (let i = 0; i < 10; i++) sim.tick();
    expect(run.engaged).toBe(true);
    for (const s of allies(sim, run)) expect(s.petMode).toBe('aggressive');
  });

  it('the party and the skeletons are enemies both ways', () => {
    const { sim, run } = shiftSim();
    const tank = sim.entities.get(run.bots[0].pid)!;
    const [skeleton] = allies(sim, run);
    expect(isHostile(sim, tank, skeleton)).toBe(true);
    expect(isHostile(sim, skeleton, tank)).toBe(true);
  });

  it('the tank taunts a skeleton off the healer', () => {
    const { sim, run } = shiftSim();
    engage(sim, run);
    const healer = sim.entities.get(run.bots.find((b) => b.role === 'healer')!.pid)!;
    const tank = sim.entities.get(run.bots.find((b) => b.role === 'tank')!.pid)!;
    const [skeleton] = allies(sim, run);
    skeleton.pos = sim.ctx.groundPos(tank.pos.x + 2, tank.pos.z);
    skeleton.prevPos = { ...skeleton.pos };
    (sim as any).rebucket(skeleton);
    let taunted = false;
    for (let i = 0; i < 20 * 4 && !taunted; i++) {
      skeleton.aggroTargetId = taunted ? skeleton.aggroTargetId : healer.id;
      sim.tick();
      taunted = skeleton.aggroTargetId === tank.id;
    }
    expect(taunted).toBe(true);
  });

  it('an ally falling close to Morthen feeds his Dread once; a far one does not', () => {
    const { sim, run } = shiftSim();
    const p = sim.player;
    expect(p.resourceType).toBe('dread');
    p.resource = 0;
    const [near, far] = allies(sim, run);
    far.pos = sim.ctx.groundPos(p.pos.x, p.pos.z - 40);
    far.prevPos = { ...far.pos };
    (sim as any).rebucket(far);
    (sim as any).dealDamage(null, near, near.maxHp + 50, false, 'physical', null, 'hit', true);
    (sim as any).dealDamage(null, far, far.maxHp + 50, false, 'physical', null, 'hit', true);
    sim.tick();
    expect(p.resource).toBe(ALLY_DEATH_DREAD);
    expect(run.allyIds).toEqual([]);
    sim.tick();
    expect(p.resource).toBe(ALLY_DEATH_DREAD);
  });

  it('the teardown dismisses the skeletons', () => {
    const { sim, run } = shiftSim();
    const ids = [...run.allyIds];
    sim.chat('/dev graveyardshift end');
    sim.tick();
    for (const id of ids) expect(sim.entities.get(id)?.dead ?? true).toBe(true);
    expect([...sim.entities.values()].some((e) => e.ownerId === sim.playerId && !e.dead)).toBe(
      false,
    );
  });
});
