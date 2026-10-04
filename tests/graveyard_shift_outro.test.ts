import { describe, expect, it } from 'vitest';
import { dungeonAt } from '../src/sim/data';
import { graveyardShiftRunFor } from '../src/sim/graveyard_shift';
import { LOOT_LINES } from '../src/sim/graveyard_shift/bot_lines';
import { STAFF_EXIT_TRIGGER_RADIUS, WON_OUTRO_MAX_TICKS } from '../src/sim/graveyard_shift/outro';
import { GRAVEYARD_SHIFT_STAFF_EXIT } from '../src/sim/graveyard_shift/run_layout';
import {
  DEFEATED_AURA_ID,
  isGraveyardShiftDefeated,
  isGraveyardShiftStaffExit,
  LOSS_OUTRO_TICKS,
  STAFF_EXIT_NAME,
} from '../src/sim/graveyard_shift/shift_end_marks';
import { instanceOriginOf } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { type TranslationKey, t } from '../src/ui/i18n';
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
  return { sim, run };
}

type Run = ReturnType<typeof shiftSim>['run'];
const meta = (sim: Sim) => (sim as any).players.get(sim.playerId);
const botOf = (sim: Sim, run: Run, cls: string) =>
  sim.entities.get(run.bots.find((b) => b.cls === cls)!.pid)!;

function place(sim: Sim, e: Entity, x: number, z: number) {
  e.pos = sim.ctx.groundPos(x, z);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

function lethal(sim: Sim, source: Entity | null, target: Entity) {
  (sim as any).dealDamage(source, target, target.maxHp + 500, false, 'physical', null, 'hit', true);
}

function ticks(sim: Sim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.tick());
  return out;
}

const logs = (events: SimEvent[]) =>
  events.flatMap((ev) => (ev.type === 'log' && (ev as any).text ? [(ev as any).text] : []));
const ENDED = (outcome: string) => `[dev] Graveyard Shift ended (${outcome}).`;

// Morthen walks into the party and the fight runs a while.
function engage(sim: Sim, run: Run) {
  const tank = botOf(sim, run, 'warrior');
  place(sim, sim.player, tank.pos.x, tank.pos.z + 4);
  ticks(sim, 20 * 4);
}

// The last death of every adventurer counts as its final one: each has spent
// its corpse run already.
function spendCorpseRuns(run: Run, exceptPid?: number) {
  for (const bot of run.bots) if (bot.pid !== exceptPid) bot.deaths = 1;
}

describe('Graveyard Shift outro: a lost shift', () => {
  it('lays Morthen down defeated and locked, at 1 hp, while the party stands down', () => {
    const { sim, run } = shiftSim();
    engage(sim, run);
    expect(run.allyIds.length).toBeGreaterThan(0);
    const allyIds = [...run.allyIds];
    lethal(sim, botOf(sim, run, 'warrior'), sim.player);
    sim.tick();
    const p = sim.player;
    expect(run.outro?.kind).toBe('lost');
    expect(isGraveyardShiftDefeated(p)).toBe(true);
    expect(p.auras.find((a) => a.id === DEFEATED_AURA_ID)?.kind).toBe('stun');
    expect(p.hp).toBe(1);
    expect(p.autoAttack).toBe(false);
    // The allies collapse with him.
    expect(run.allyIds).toEqual([]);
    for (const id of allyIds) expect(sim.entities.get(id)?.dead ?? true).toBe(true);
    for (const bot of run.bots) {
      const e = sim.entities.get(bot.pid)!;
      if (!e.dead) expect(e.autoAttack).toBe(false);
    }
    // Locked: a cast is refused, a step goes nowhere.
    p.resource = p.maxResource;
    p.gcdRemaining = 0;
    sim.castAbility('gshift_shadow_pulse');
    expect(p.castingAbility).toBeFalsy();
    const before = { ...p.pos };
    meta(sim).moveInput.forward = true;
    const events = ticks(sim, 20 * 2);
    meta(sim).moveInput.forward = false;
    expect(Math.hypot(p.pos.x - before.x, p.pos.z - before.z)).toBeLessThan(0.01);
    // Nobody hurts anybody during the scene (a bolt already in flight may still
    // land on Morthen, for nothing: the clamp holds him at 1 hp).
    expect(events.filter((ev) => ev.type === 'damage' && (ev as any).amount > 0)).toEqual([]);
    expect(p.hp).toBe(1);
  });

  it('the party gloats over the trousers, in order, at 2 and 4 sec, heard by Morthen', () => {
    const { sim, run } = shiftSim();
    engage(sim, run);
    lethal(sim, botOf(sim, run, 'warrior'), sim.player);
    sim.tick();
    const started = run.outro!.startedTick;
    const living = new Set(
      run.bots.filter((b) => !sim.entities.get(b.pid)!.dead).map((b) => b.pid),
    );
    const loot: { tick: number; key: string; from: number; to: number }[] = [];
    for (let i = 0; i < LOSS_OUTRO_TICKS - 1; i++) {
      for (const ev of sim.tick()) {
        const key = (ev as any).textKey as string | undefined;
        if (ev.type === 'chat' && key?.startsWith('devCommand.graveyardShift.say.loot.')) {
          loot.push({
            tick: sim.ctx.tickCount - started,
            key,
            from: ev.fromPid,
            to: (ev as any).pid,
          });
        }
      }
    }
    expect(loot.map((l) => l.key)).toEqual(LOOT_LINES.map((l) => l.key));
    expect(loot.map((l) => l.tick)).toEqual([40, 80]);
    for (const l of loot) {
      expect(living.has(l.from)).toBe(true);
      expect(l.to).toBe(sim.playerId);
    }
    for (const l of LOOT_LINES) expect(t(l.key as TranslationKey)).toBe(l.text);
  });

  it('ends exactly at LOSS_OUTRO_TICKS with the owner outside, alive and never dead', () => {
    const { sim, run } = shiftSim();
    const deaths = meta(sim).counters.deaths;
    lethal(sim, null, sim.player);
    const events = sim.tick();
    const started = run.outro!.startedTick;
    let endedAt = -1;
    for (let i = 0; i < LOSS_OUTRO_TICKS + 5 && endedAt < 0; i++) {
      const step = sim.tick();
      events.push(...step);
      if (logs(step).includes(ENDED('lost'))) endedAt = sim.ctx.tickCount - started;
    }
    expect(endedAt).toBe(LOSS_OUTRO_TICKS);
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    expect(events.some((ev) => ev.type === 'playerDeath')).toBe(false);
    expect(meta(sim).counters.deaths).toBe(deaths);
    const p = sim.player;
    expect(p.dead).toBe(false);
    expect(p.hp).toBeGreaterThan(1);
    expect(isGraveyardShiftDefeated(p)).toBe(false);
    expect(dungeonAt(p.pos.x)).toBeNull();
  });
});

describe('Graveyard Shift outro: a won shift', () => {
  function giveUp(sim: Sim, run: Run) {
    const tank = botOf(sim, run, 'warrior');
    spendCorpseRuns(run, tank.id);
    const fallen = run.bots.map((b) => sim.entities.get(b.pid)!).filter((e) => e.id !== tank.id);
    for (const e of fallen) lethal(sim, null, e);
    sim.tick();
    return { tank, fallen };
  }

  it('the quitter walks out, the fallen stay, and the Staff Exit opens behind the throne', () => {
    const { sim, run } = shiftSim();
    const { tank, fallen } = giveUp(sim, run);
    expect(run.outro?.kind).toBe('won');
    expect(sim.ctx.players.has(tank.id)).toBe(false);
    expect(sim.entities.has(tank.id)).toBe(false);
    for (const e of fallen) {
      expect(sim.entities.get(e.id)).toBe(e);
      expect(e.dead).toBe(true);
    }
    const exit = sim.entities.get(run.outro!.portalId!)!;
    expect(exit.templateId).toBe('dungeon_exit');
    expect(exit.name).toBe(STAFF_EXIT_NAME);
    expect(isGraveyardShiftStaffExit(exit)).toBe(true);
    expect(run.slot.objectIds).toContain(exit.id);
    const origin = instanceOriginOf(run.slot);
    expect(exit.pos.x).toBeCloseTo(origin.x + GRAVEYARD_SHIFT_STAFF_EXIT.x, 5);
    expect(exit.pos.z).toBeCloseTo(origin.z + GRAVEYARD_SHIFT_STAFF_EXIT.z, 5);
    // Nothing ends until the owner acts.
    expect(logs(ticks(sim, 20 * 30))).toEqual([]);
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBe(run);
  });

  it('walking into the Staff Exit ends the shift as a win and takes the portal down', () => {
    const { sim, run } = shiftSim();
    giveUp(sim, run);
    const exit = sim.entities.get(run.outro!.portalId!)!;
    // Just outside the trigger: nothing yet.
    place(sim, sim.player, exit.pos.x + STAFF_EXIT_TRIGGER_RADIUS + 1, exit.pos.z);
    expect(logs(sim.tick())).toEqual([]);
    place(sim, sim.player, exit.pos.x + STAFF_EXIT_TRIGGER_RADIUS - 0.5, exit.pos.z);
    expect(logs(sim.tick())).toContain(ENDED('won'));
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    expect(sim.entities.has(exit.id)).toBe(false);
    expect(dungeonAt(sim.player.pos.x)).toBeNull();
  });

  it('using the Staff Exit (leaveDungeon, the F-interact path) wins, never aborts', () => {
    const { sim, run } = shiftSim();
    giveUp(sim, run);
    const exitId = run.outro!.portalId!;
    expect(sim.leaveDungeon()).toBe(true);
    expect(run.outro!.leaving).toBe(true);
    const events = sim.tick();
    expect(logs(events)).toContain(ENDED('won'));
    expect(logs(events)).not.toContain(ENDED('aborted'));
    expect(sim.entities.has(exitId)).toBe(false);
    expect(dungeonAt(sim.player.pos.x)).toBeNull();
  });

  it('a won shift nobody walks out of ends as a win on its own', () => {
    const { sim, run } = shiftSim();
    giveUp(sim, run);
    const exitId = run.outro!.portalId!;
    // One tick short of the limit, then the limit.
    (run.outro as any).startedTick = sim.ctx.tickCount - WON_OUTRO_MAX_TICKS + 2;
    expect(logs(sim.tick())).toEqual([]);
    const events = sim.tick();
    expect(logs(events)).toContain(ENDED('won'));
    expect(sim.entities.has(exitId)).toBe(false);
  });

  it('a full wipe of spent adventurers opens the Staff Exit too', () => {
    const { sim, run } = shiftSim();
    spendCorpseRuns(run);
    for (const b of run.bots) lethal(sim, null, sim.entities.get(b.pid)!);
    sim.tick();
    expect(run.outro?.kind).toBe('won');
    expect(isGraveyardShiftStaffExit(sim.entities.get(run.outro!.portalId!))).toBe(true);
  });
});

describe('Graveyard Shift outro: leaveDungeon outside a won shift', () => {
  it('mid-fight it still walks the owner out, which abandons the shift', () => {
    const { sim, run } = shiftSim();
    expect(sim.leaveDungeon()).toBe(true);
    expect(run.outro).toBeNull();
    expect(dungeonAt(sim.player.pos.x)).toBeNull();
    expect(logs(sim.tick())).toContain(ENDED('aborted'));
  });

  it('in the open world with no run it does nothing', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', world: EMPTY_TEST_WORLD });
    expect(sim.leaveDungeon()).toBe(false);
    expect(sim.ctx.graveyardShiftRuns.size).toBe(0);
  });
});
