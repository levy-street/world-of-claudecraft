// The shift's opening: the party is busy in the next room with the last pack,
// Morthen's colleagues, the monsters it cleared lie dead behind it, and it
// only turns on Morthen once he walks up to it.
import { describe, expect, it } from 'vitest';
import { graveyardShiftRunFor } from '../src/sim/graveyard_shift';
import { PARTY_ENGAGE_RADIUS } from '../src/sim/graveyard_shift/bot_brain';
import { GRAVEYARD_SHIFT_ALLY_TEMPLATE } from '../src/sim/graveyard_shift/run_allies';
import {
  GRAVEYARD_SHIFT_ARRIVAL,
  GRAVEYARD_SHIFT_BOT_SPOTS,
  GRAVEYARD_SHIFT_CLEARED_CORPSES,
  GRAVEYARD_SHIFT_PACK,
  GRAVEYARD_SHIFT_PARTY_FACES,
} from '../src/sim/graveyard_shift/run_layout';
import { GRAVEYARD_SHIFT_PACK_HP_FRACTION } from '../src/sim/graveyard_shift/run_opening';
import { instanceOriginOf } from '../src/sim/instances/dungeons';
import { SAY_RANGE, Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
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
  return { sim, run, origin: instanceOriginOf(run.slot) };
}

type Shift = ReturnType<typeof shiftSim>;

const packOf = ({ sim, run }: Shift): Entity[] =>
  run.allyIds
    .map((id) => sim.entities.get(id)!)
    .filter((e) => e.templateId !== GRAVEYARD_SHIFT_ALLY_TEMPLATE);
const tankOf = ({ sim, run }: Shift) =>
  sim.entities.get(run.bots.find((b) => b.role === 'tank')!.pid)!;
const near = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z) < 0.01;

const heard = (events: SimEvent[], pid: number, prefix: string) =>
  events.filter(
    (ev) =>
      ev.type === 'chat' &&
      (ev as { pid?: number }).pid === pid &&
      String((ev as { textKey?: string }).textKey).startsWith(prefix),
  );

describe('Graveyard Shift opening', () => {
  it('fields the pack, wounded, owned by Morthen, aggressive and on the tank', () => {
    const shift = shiftSim();
    const { sim, origin } = shift;
    const pack = packOf(shift);
    expect(pack.map((e) => e.templateId)).toEqual(GRAVEYARD_SHIFT_PACK.map((s) => s.templateId));
    pack.forEach((e, i) => {
      const spot = GRAVEYARD_SHIFT_PACK[i];
      expect(near(e.pos, { x: origin.x + spot.x, z: origin.z + spot.z })).toBe(true);
      expect(e.ownerId).toBe(sim.playerId);
      expect(e.petMode).toBe('aggressive');
      expect(e.dead).toBe(false);
      expect(e.hp).toBe(Math.max(1, Math.round(e.maxHp * GRAVEYARD_SHIFT_PACK_HP_FRACTION)));
      expect(e.hp).toBeLessThan(e.maxHp);
      expect(e.aggroTargetId).toBe(tankOf(shift).id);
    });
  });

  it('lays the cleared monsters dead behind the party: ownerless and already looted', () => {
    const { sim, run, origin } = shiftSim();
    expect(run.corpseIds).toHaveLength(GRAVEYARD_SHIFT_CLEARED_CORPSES.length);
    run.corpseIds.forEach((id, i) => {
      const e = sim.entities.get(id)!;
      const spot = GRAVEYARD_SHIFT_CLEARED_CORPSES[i];
      expect(e.templateId).toBe(spot.templateId);
      expect(e.dead).toBe(true);
      expect(e.ownerId).toBeNull();
      expect(e.lootable).toBe(false);
      expect(near(e.pos, { x: origin.x + spot.x, z: origin.z + spot.z })).toBe(true);
    });
  });

  it('stands the party at its spots facing the pack, every one out of earshot of the throne', () => {
    const { sim, run, origin } = shiftSim();
    run.bots.forEach((b, i) => {
      const e = sim.entities.get(b.pid)!;
      const spot = GRAVEYARD_SHIFT_BOT_SPOTS[i];
      expect(near(e.pos, { x: origin.x + spot.x, z: origin.z + spot.z })).toBe(true);
      const facing = Math.atan2(
        GRAVEYARD_SHIFT_PARTY_FACES.x - spot.x,
        GRAVEYARD_SHIFT_PARTY_FACES.z - spot.z,
      );
      expect(e.facing).toBeCloseTo(facing, 6);
      expect(
        Math.hypot(spot.x - GRAVEYARD_SHIFT_ARRIVAL.x, spot.z - GRAVEYARD_SHIFT_ARRIVAL.z),
      ).toBeGreaterThan(SAY_RANGE);
    });
  });

  it('engages the pack within a few seconds and targets nothing else while unnoticed', () => {
    const shift = shiftSim();
    const { sim, run } = shift;
    const pack = new Set(packOf(shift).map((e) => e.id));
    for (let i = 0; i < 20 * 3; i++) {
      sim.tick();
      for (const b of run.bots) {
        const t = sim.entities.get(b.pid)!.targetId;
        if (t !== null) expect(pack.has(t)).toBe(true);
      }
    }
    expect(run.engaged).toBe(true);
    expect(run.noticed).toBe(false);
  });

  it('is overheard as Morthen walks down the nave, then notices him and says so', () => {
    const shift = shiftSim();
    const { sim, run } = shift;
    const p = sim.player;
    const meta = sim.ctx.players.get(p.id)!;
    const tank = tankOf(shift);
    const events: SimEvent[] = [];
    let noticedAt = -1;
    let closest = Number.POSITIVE_INFINITY;
    for (let t = 0; t < 20 * 15; t++) {
      const d = Math.hypot(tank.pos.x - p.pos.x, tank.pos.z - p.pos.z);
      p.facing = Math.atan2(tank.pos.x - p.pos.x, tank.pos.z - p.pos.z);
      meta.moveInput.forward = d > 4;
      events.push(...sim.tick());
      if (noticedAt < 0 && run.noticed) {
        noticedAt = events.length;
        closest = Math.min(
          ...run.bots.map((b) => {
            const e = sim.entities.get(b.pid)!;
            return Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
          }),
        );
      }
    }
    meta.moveInput.forward = false;
    const clearing = heard(events, p.id, 'devCommand.graveyardShift.say.clearing');
    const notice = heard(events, p.id, 'devCommand.graveyardShift.say.notice');
    expect(clearing).toHaveLength(1);
    expect(notice).toHaveLength(1);
    expect(events.indexOf(clearing[0])).toBeLessThan(events.indexOf(notice[0]));
    expect(noticedAt).toBeGreaterThan(0);
    expect(closest).toBeLessThanOrEqual(PARTY_ENGAGE_RADIUS);
    expect(events.indexOf(notice[0])).toBeGreaterThanOrEqual(noticedAt - 1);
  });

  it('a cleared monster rises to Raise the Fallen', () => {
    const { sim, run } = shiftSim();
    const corpse = sim.entities.get(run.corpseIds[0])!;
    const p = sim.player;
    p.pos = sim.ctx.groundPos(corpse.pos.x, corpse.pos.z + 3);
    p.prevPos = { ...p.pos };
    sim.ctx.rebucket(p);
    p.gcdRemaining = 0;
    sim.castAbility('gshift_raise_fallen');
    sim.tick();
    expect(run.raisedCorpseIds.has(corpse.id)).toBe(true);
  });

  it('the teardown leaves no pack mob and no corpse behind', () => {
    const shift = shiftSim();
    const { sim, run } = shift;
    const ids = [...packOf(shift).map((e) => e.id), ...run.corpseIds];
    expect(ids.length).toBe(GRAVEYARD_SHIFT_PACK.length + GRAVEYARD_SHIFT_CLEARED_CORPSES.length);
    sim.chat('/dev graveyardshift end');
    sim.tick();
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    for (const id of ids) expect(sim.entities.has(id)).toBe(false);
  });

  it('the teardown also clears a pack mob the party killed during the shift', () => {
    const shift = shiftSim();
    const { sim } = shift;
    const pack = packOf(shift).map((e) => e.id);
    let killed: number | null = null;
    for (let i = 0; i < 20 * 10 && killed === null; i++) {
      sim.tick();
      killed = pack.find((id) => sim.entities.get(id)?.dead === true) ?? null;
    }
    expect(killed).not.toBeNull();
    sim.chat('/dev graveyardshift end');
    sim.tick();
    expect(sim.entities.has(killed!)).toBe(false);
  });

  it('plays the same opening for the same seed', () => {
    const trace = () => {
      const { sim } = shiftSim(7);
      const out: string[] = [];
      for (let i = 0; i < 20 * 30; i++) out.push(JSON.stringify(sim.tick()));
      return out;
    };
    expect(trace()).toEqual(trace());
  });
});
