import { describe, expect, it } from 'vitest';
import { DUNGEONS } from '../src/sim/data';
import { graveyardShiftRunFor } from '../src/sim/graveyard_shift';
import {
  CORPSE_RELEASE_TICKS,
  CORPSE_RETURN_TICKS,
  partyGivesUp,
  partyWiped,
} from '../src/sim/graveyard_shift/corpse_run';
import { isGraveyardShiftAdventurer } from '../src/sim/graveyard_shift/hostility';
import { GRAVEYARD_SHIFT_DUNGEON_ID } from '../src/sim/graveyard_shift/run_layout';
import { isGraveyardShiftStaffExit } from '../src/sim/graveyard_shift/shift_end_marks';
import { instanceOriginOf } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { RES_HP_FRACTION } from '../src/sim/spirit';
import type { Aura, Entity, SimEvent } from '../src/sim/types';
import {
  clearGraveyardShiftOpening,
  placeMorthenInEarshot,
} from './helpers/graveyard_shift_opening';
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
  placeMorthenInEarshot(sim, run);
  return { sim, run };
}

type Run = ReturnType<typeof shiftSim>['run'];
const bot = (sim: Sim, run: Run, cls: string) =>
  sim.entities.get(run.bots.find((b) => b.cls === cls)!.pid)!;

function kill(sim: Sim, target: Entity) {
  (sim as any).dealDamage(
    sim.player,
    target,
    target.maxHp + 50,
    false,
    'shadow',
    null,
    'hit',
    true,
  );
  expect(target.dead).toBe(true);
}

function ticks(sim: Sim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.tick());
  return out;
}

// Morthen sits still and nobody hurts anyone: the corpse run alone moves.
function holdEveryone(sim: Sim, run: Run) {
  for (const b of run.bots) {
    sim.entities.get(b.pid)!.auras.push({
      id: 'test_hold',
      name: 'Hold',
      kind: 'stun',
      remaining: 999,
      duration: 999,
      value: 0,
      sourceId: sim.playerId,
      school: 'physical',
    } as Aura);
  }
}

const said = (events: SimEvent[], prefix: string) =>
  events.filter(
    (ev) => ev.type === 'chat' && String((ev as any).textKey).startsWith(prefix),
  ) as Array<SimEvent & { textKey: string; fromPid: number }>;

describe('Graveyard Shift corpse run', () => {
  it('a fallen adventurer walks back in at the entrance after its delay, at re-entry pools', () => {
    const { sim, run } = shiftSim();
    const mage = bot(sim, run, 'mage');
    kill(sim, mage);
    ticks(sim, CORPSE_RETURN_TICKS);
    expect(mage.dead).toBe(true);
    sim.tick();
    expect(mage.dead).toBe(false);
    expect(mage.hp).toBe(Math.round(mage.maxHp * RES_HP_FRACTION));
    const origin = instanceOriginOf(run.slot);
    const entry = DUNGEONS[GRAVEYARD_SHIFT_DUNGEON_ID].entry;
    // At the entrance, a hundred yards from the boss chamber (it has started walking).
    expect(Math.abs(mage.pos.x - (origin.x + entry.x))).toBeLessThan(3);
    expect(Math.abs(mage.pos.z - (origin.z + entry.z))).toBeLessThan(5);
    // Hostile again: the death had stripped the marker.
    expect(isGraveyardShiftAdventurer(mage)).toBe(true);
    expect((sim as any).isHostileTo(sim.player, mage)).toBe(true);
  });

  it('a second death is final', () => {
    const { sim, run } = shiftSim();
    holdEveryone(sim, run);
    const mage = bot(sim, run, 'mage');
    kill(sim, mage);
    ticks(sim, CORPSE_RETURN_TICKS + 1);
    expect(mage.dead).toBe(false);
    kill(sim, mage);
    ticks(sim, 2 * CORPSE_RETURN_TICKS);
    expect(mage.dead).toBe(true);
    expect(run.bots.find((b) => b.pid === mage.id)!.deaths).toBe(2);
  });

  it('the survivors call the corpse run at the release, and the returner speaks on arrival', () => {
    const { sim, run } = shiftSim();
    holdEveryone(sim, run);
    const mage = bot(sim, run, 'mage');
    kill(sim, mage);
    // Let the death line clear the say cooldowns first.
    const beforeRelease = ticks(sim, CORPSE_RELEASE_TICKS);
    expect(said(beforeRelease, 'devCommand.graveyardShift.say.corpseRun')).toHaveLength(0);
    const window = ticks(sim, CORPSE_RETURN_TICKS - CORPSE_RELEASE_TICKS);
    const calls = said(window, 'devCommand.graveyardShift.say.corpseRun');
    // One copy, to Morthen only: the fallen mage (marker stripped) gets none.
    expect(calls).toHaveLength(1);
    expect((calls[0] as any).pid).toBe(sim.playerId);
    expect(calls[0].fromPid).not.toBe(mage.id);
    sim.tick();
    expect(mage.dead).toBe(false);
    // Walk it into earshot (but short of the notice radius, so no notice line
    // takes the voice first): only the returner announces its own arrival.
    mage.pos = sim.ctx.groundPos(sim.player.pos.x, sim.player.pos.z - 20);
    mage.prevPos = { ...mage.pos };
    (sim as any).rebucket(mage);
    const arrival = ticks(sim, 20 * 4);
    const returned = said(arrival, 'devCommand.graveyardShift.say.returned');
    expect(returned).toHaveLength(1);
    expect(returned[0].fromPid).toBe(mage.id);
  });

  it('the last one standing gives up once nobody can come back, and that wins the shift', () => {
    const { sim, run } = shiftSim();
    const tank = bot(sim, run, 'warrior');
    const others = run.bots.map((b) => sim.entities.get(b.pid)!).filter((e) => e !== tank);
    for (const e of others) kill(sim, e);
    ticks(sim, CORPSE_RETURN_TICKS + 1);
    for (const e of others) expect(e.dead).toBe(false);
    for (const e of others.slice(0, -1)) kill(sim, e);
    sim.tick();
    expect(run.outro).toBeNull();
    kill(sim, others[others.length - 1]);
    const events = sim.tick();
    const goodbye = said(events, 'devCommand.graveyardShift.say.giveUp');
    expect(goodbye).toHaveLength(1);
    expect(goodbye[0].fromPid).toBe(tank.id);
    // The quitter walks out and the Staff Exit opens: the shift is won.
    expect(run.outro?.kind).toBe('won');
    expect(sim.ctx.players.has(tank.id)).toBe(false);
    const exit = sim.entities.get(run.outro!.portalId!)!;
    expect(isGraveyardShiftStaffExit(exit)).toBe(true);
    sim.player.pos = sim.ctx.groundPos(exit.pos.x, exit.pos.z);
    sim.player.prevPos = { ...sim.player.pos };
    (sim as any).rebucket(sim.player);
    const end = sim.tick();
    expect(
      end.some(
        (ev) => ev.type === 'log' && (ev as any).text === '[dev] Graveyard Shift ended (won).',
      ),
    ).toBe(true);
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
  });

  it('nobody gives up while a fallen friend is still running back', () => {
    const { sim, run } = shiftSim();
    const tank = bot(sim, run, 'warrior');
    for (const b of run.bots) if (b.pid !== tank.id) kill(sim, sim.entities.get(b.pid)!);
    ticks(sim, CORPSE_RETURN_TICKS - 1);
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).not.toBeNull();
  });

  it('the last one down with its corpse run to come does not give up, even with nobody else left', () => {
    const { sim, run } = shiftSim();
    const tank = bot(sim, run, 'warrior');
    const others = run.bots.map((b) => sim.entities.get(b.pid)!).filter((e) => e !== tank);
    for (const e of others) kill(sim, e);
    ticks(sim, CORPSE_RETURN_TICKS + 1);
    for (const e of others) expect(e.dead).toBe(false);
    // Same instant: the four fall for good, the tank falls for the first time.
    for (const e of others) kill(sim, e);
    kill(sim, tank);
    const events = sim.tick();
    expect(partyWiped(sim.ctx, run)).toBe(false);
    expect(partyGivesUp(sim.ctx, run)).toBe(false);
    expect(run.outro).toBeNull();
    expect(said(events, 'devCommand.graveyardShift.say.giveUp')).toHaveLength(0);
    ticks(sim, CORPSE_RETURN_TICKS - 2);
    expect(tank.dead).toBe(true);
    expect(run.outro).toBeNull();
    // Back in alone, it is the last one standing with nobody to wait for.
    ticks(sim, 2);
    expect(run.outro?.kind).toBe('won');
    expect(sim.ctx.players.has(tank.id)).toBe(false);
  });

  it('a raised corpse leaves with its owner: the next corpse can rise again', () => {
    const { sim, run } = shiftSim();
    holdEveryone(sim, run);
    const healer = bot(sim, run, 'priest');
    kill(sim, healer);
    const p = sim.player;
    p.pos = sim.ctx.groundPos(healer.pos.x, healer.pos.z + 4);
    p.prevPos = { ...p.pos };
    (sim as any).rebucket(p);
    p.gcdRemaining = 0;
    sim.castAbility('gshift_raise_fallen');
    sim.tick();
    expect(run.raisedCorpseIds.has(healer.id)).toBe(true);
    ticks(sim, CORPSE_RETURN_TICKS);
    expect(healer.dead).toBe(false);
    expect(run.raisedCorpseIds.has(healer.id)).toBe(false);
  });
});
