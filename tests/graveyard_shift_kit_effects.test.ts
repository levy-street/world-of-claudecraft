import { describe, expect, it } from 'vitest';
import { graveyardShiftRunFor } from '../src/sim/graveyard_shift';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, SimEvent } from '../src/sim/types';
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

type Run = ReturnType<typeof shiftSim>['run'];
const bot = (sim: Sim, run: Run, role: string) =>
  sim.entities.get(run.bots.find((b) => b.role === role)!.pid)!;

// Stand Morthen next to the party and hold every adventurer in place (a stun
// from Morthen), so nothing kicks or wanders during the test.
function setUp(sim: Sim, run: Run) {
  const tank = bot(sim, run, 'tank');
  const p = sim.player;
  p.pos = sim.ctx.groundPos(tank.pos.x, tank.pos.z + 4);
  p.prevPos = { ...p.pos };
  (sim as any).rebucket(p);
  for (const b of run.bots) {
    const e = sim.entities.get(b.pid)!;
    e.auras.push({
      id: 'test_hold',
      name: 'Hold',
      kind: 'stun',
      remaining: 30,
      duration: 30,
      value: 0,
      sourceId: p.id,
      school: 'physical',
    } as Aura);
  }
}

function castAt(sim: Sim, id: string, target: Entity | null) {
  const p = sim.player;
  if (target) {
    sim.targetEntity(target.id);
    p.facing = Math.atan2(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
  }
  p.cooldowns.delete(id);
  p.gcdRemaining = 0;
  sim.castAbility(id);
}

function ticks(sim: Sim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.tick());
  return out;
}

describe('Graveyard Shift kit effects', () => {
  it('Shadow Pulse hits every adventurer within its radius once, and none beyond', () => {
    const { sim, run } = shiftSim();
    setUp(sim, run);
    const p = sim.player;
    const far = bot(sim, run, 'dps');
    far.pos = sim.ctx.groundPos(p.pos.x, p.pos.z - 30);
    far.prevPos = { ...far.pos };
    (sim as any).rebucket(far);
    const near = run.bots
      .map((b) => sim.entities.get(b.pid)!)
      .filter((e) => Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) <= 12);
    expect(near.length).toBeGreaterThan(1);
    p.resource = p.maxResource;
    castAt(sim, 'gshift_shadow_pulse', null);
    const events = ticks(sim, 50);
    const pulseHits = (target: Entity) =>
      events.filter(
        (ev) =>
          ev.type === 'damage' &&
          (ev as any).targetId === target.id &&
          (ev as any).abilityId === 'gshift_shadow_pulse',
      ).length;
    for (const e of near) expect(pulseHits(e)).toBe(1);
    expect(pulseHits(far)).toBe(0);
  });

  it('Raise the Fallen is refused with nothing to raise and keeps its cooldown', () => {
    const { sim, run } = shiftSim();
    setUp(sim, run);
    castAt(sim, 'gshift_raise_fallen', null);
    expect(
      sim.events.some((ev) => ev.type === 'error' && ev.text === 'There is no corpse to raise.'),
    ).toBe(true);
    expect(sim.player.cooldowns.has('gshift_raise_fallen')).toBe(false);
    expect(run.allyIds).toHaveLength(2);
  });

  it("raises a fallen adventurer once, as Morthen's own skeleton", () => {
    const { sim, run } = shiftSim();
    setUp(sim, run);
    const healer = bot(sim, run, 'healer');
    (sim as any).dealDamage(
      sim.player,
      healer,
      healer.maxHp + 50,
      false,
      'shadow',
      null,
      'hit',
      true,
    );
    expect(healer.dead).toBe(true);
    castAt(sim, 'gshift_raise_fallen', null);
    sim.tick();
    expect(run.raisedCorpseIds.has(healer.id)).toBe(true);
    expect(run.allyIds).toHaveLength(3);
    const raised = sim.entities.get(run.allyIds[2])!;
    expect(raised.ownerId).toBe(sim.playerId);
    expect(raised.petMode).toBe('aggressive');
    expect(Math.hypot(raised.pos.x - healer.pos.x, raised.pos.z - healer.pos.z)).toBeLessThan(3);
    castAt(sim, 'gshift_raise_fallen', null);
    expect(
      sim.events.some((ev) => ev.type === 'error' && ev.text === 'There is no corpse to raise.'),
    ).toBe(true);
  });

  it("never raises Morthen's own fallen skeletons", () => {
    const { sim, run } = shiftSim();
    setUp(sim, run);
    const [ally] = run.allyIds.map((id) => sim.entities.get(id)!);
    (sim as any).dealDamage(null, ally, ally.maxHp + 50, false, 'physical', null, 'hit', true);
    expect(ally.dead).toBe(true);
    castAt(sim, 'gshift_raise_fallen', null);
    expect(
      sim.events.some((ev) => ev.type === 'error' && ev.text === 'There is no corpse to raise.'),
    ).toBe(true);
    expect(run.raisedCorpseIds.size).toBe(0);
  });
});
