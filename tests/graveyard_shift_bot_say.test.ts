// The adventurers' local say lines: keyed, spoken only by living bots, heard
// only within say range, never repeated, rate-limited, drawn on a private rng,
// and fired by observed run state.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { graveyardShiftRunFor } from '../src/sim/graveyard_shift';
import { botSeed } from '../src/sim/graveyard_shift/bot_brain';
import { BOT_LINES, type BotSayTrigger } from '../src/sim/graveyard_shift/bot_lines';
import {
  BOT_SAY_BOT_COOLDOWN_TICKS,
  BOT_SAY_GLOBAL_COOLDOWN_TICKS,
  botSaySeed,
  updateGraveyardShiftSay,
} from '../src/sim/graveyard_shift/bot_say';
import type { GraveyardShiftRun } from '../src/sim/graveyard_shift/run_state';
import { LOSS_OUTRO_TICKS } from '../src/sim/graveyard_shift/shift_end_marks';
import { SAY_RANGE, Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { type TranslationKey, t } from '../src/ui/i18n';
import {
  clearGraveyardShiftOpening,
  placeMorthenInEarshot,
} from './helpers/graveyard_shift_opening';
import { EMPTY_TEST_WORLD } from './sim_shared';

type ChatEvent = Extract<SimEvent, { type: 'chat' }>;
interface Heard {
  tick: number;
  ev: ChatEvent;
}

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
  clearGraveyardShiftOpening(sim, run);
  placeMorthenInEarshot(sim, run);
  return { sim, run };
}

const botEntity = (sim: Sim, run: GraveyardShiftRun, role: string): Entity =>
  sim.entities.get(run.bots.find((b) => b.role === role)!.pid)!;

// A sourceless lethal blow: the bot dies without Morthen engaging the party.
function kill(sim: Sim, e: Entity) {
  (sim as any).dealDamage(null, e, e.maxHp + 500, false, 'physical', null, 'hit', true);
}

function place(sim: Sim, e: Entity, x: number, z: number) {
  e.pos = sim.ctx.groundPos(x, z);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

function isBotSay(ev: SimEvent): ev is ChatEvent {
  return ev.type === 'chat' && ev.channel === 'say' && !!ev.textKey?.includes('.say.');
}

// Every bot chat off the say channel lands in `stray` (party chat, whisper...).
function runTicks(sim: Sim, n: number, out: Heard[] = [], stray?: ChatEvent[]): Heard[] {
  const run = graveyardShiftRunFor(sim.ctx, sim.playerId);
  const botPids = new Set(run?.bots.map((b) => b.pid));
  for (let i = 0; i < n; i++) {
    for (const ev of sim.tick()) {
      if (ev.type !== 'chat') continue;
      if (ev.channel !== 'say' && botPids.has(ev.fromPid)) stray?.push(ev);
      else if (isBotSay(ev)) out.push({ tick: sim.ctx.tickCount, ev });
    }
  }
  return out;
}

const heardBy = (heard: Heard[], pid: number) => heard.filter((h) => h.ev.pid === pid);
const triggerOf = (ev: ChatEvent) => ev.textKey!.split('.')[3] as BotSayTrigger;
const allLines = Object.values(BOT_LINES).flat();

describe('Graveyard Shift say lines (table)', () => {
  it('gives every line a unique id and a catalog key whose English is the fallback text', () => {
    const ids = allLines.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of allLines) {
      expect(l.key).toBe(`devCommand.graveyardShift.say.${l.id}`);
      expect(t(l.key as TranslationKey)).toBe(l.text);
    }
  });

  it('salts the say seed away from the run seed and every bot brain seed', () => {
    for (const runSeed of [1, 42, 0xdeadbeef]) {
      const say = botSaySeed(runSeed);
      expect(say).not.toBe(runSeed);
      for (let i = 0; i < 5; i++) expect(say).not.toBe(botSeed(runSeed, i));
    }
  });
});

describe('Graveyard Shift say lines (run)', () => {
  it('a death is answered by a living bot, keyed, once per player in say range', () => {
    const { sim, run } = shiftSim();
    const mage = botEntity(sim, run, 'dps');
    kill(sim, mage);
    const heard = heardBy(runTicks(sim, 5), sim.playerId);
    expect(heard).toHaveLength(1);
    const { ev } = heard[0];
    expect(triggerOf(ev)).toBe('death');
    const line = allLines.find((l) => l.key === ev.textKey)!;
    expect(ev.text).toBe(line.text);
    expect(ev.fromPid).not.toBe(mage.id);
    expect(ev.entityId).toBe(ev.fromPid);
    expect(ev.from).toBe(sim.entities.get(ev.fromPid)!.name);
    expect(run.bots.some((b) => b.pid === ev.fromPid)).toBe(true);
  });

  it('nothing is heard from beyond say range', () => {
    const { sim, run } = shiftSim();
    // Morthen steps back down the nave, every bot more than say range away.
    place(sim, sim.player, sim.player.pos.x, sim.player.pos.z - 50);
    for (const bot of run.bots) {
      const e = sim.entities.get(bot.pid)!;
      expect(Math.hypot(e.pos.x - sim.player.pos.x, e.pos.z - sim.player.pos.z)).toBeGreaterThan(
        SAY_RANGE,
      );
    }
    kill(sim, botEntity(sim, run, 'dps'));
    const heard = runTicks(sim, 40);
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBe(run);
    // The line was spoken (the run records it) but never reached Morthen, and
    // no adventurer, living or fallen, got a copy either.
    expect(run.say?.used.size ?? 0).toBeGreaterThan(0);
    expect(heard).toEqual([]);
  });

  it('dead bots never speak: with four down only the survivor talks', () => {
    const { sim, run } = shiftSim();
    for (const bot of run.bots) if (bot.role !== 'tank') kill(sim, sim.entities.get(bot.pid)!);
    const heard = heardBy(runTicks(sim, BOT_SAY_BOT_COOLDOWN_TICKS + 20), sim.playerId);
    const tank = botEntity(sim, run, 'tank');
    expect(heard.map((h) => triggerOf(h.ev))).toEqual(['death', 'wipeThreat']);
    expect(heard.every((h) => h.ev.fromPid === tank.id)).toBe(true);
  });

  it('the party noticing Morthen fires a notice line', () => {
    const { sim, run } = shiftSim();
    const tank = botEntity(sim, run, 'tank');
    place(sim, sim.player, tank.pos.x, tank.pos.z + 6);
    const heard = heardBy(runTicks(sim, 5), sim.playerId);
    expect(run.engaged).toBe(true);
    expect(heard.map((h) => triggerOf(h.ev))).toEqual(['notice']);
  });

  it('the healer calls oom below 15 percent mana, and only the healer, never twice the same line', () => {
    const { sim, run } = shiftSim();
    const healer = botEntity(sim, run, 'healer');
    const said: string[] = [];
    for (let round = 0; round < 4; round++) {
      healer.resource = Math.floor(healer.maxResource * 0.1);
      const heard = heardBy(runTicks(sim, 2), sim.playerId);
      said.push(...heard.map((h) => h.ev.textKey!));
      expect(heard.every((h) => h.ev.fromPid === healer.id)).toBe(true);
      healer.resource = healer.maxResource;
      runTicks(sim, BOT_SAY_BOT_COOLDOWN_TICKS);
    }
    // Three oom lines in the pool: three distinct lines, then silence.
    expect(said).toHaveLength(3);
    expect(new Set(said).size).toBe(3);
    expect(said.every((k) => k.includes('.say.healerOom.'))).toBe(true);
  });

  it('the healer stays quiet above the threshold', () => {
    const { sim, run } = shiftSim();
    const healer = botEntity(sim, run, 'healer');
    healer.resource = Math.ceil(healer.maxResource * 0.2);
    expect(heardBy(runTicks(sim, 40), sim.playerId)).toEqual([]);
  });

  it('a wipe threat fires on the living party falling under 35 percent average health', () => {
    const { sim, run } = shiftSim();
    for (const bot of run.bots) {
      const e = sim.entities.get(bot.pid)!;
      e.hp = Math.floor(e.maxHp * 0.3);
    }
    const heard = heardBy(runTicks(sim, BOT_SAY_GLOBAL_COOLDOWN_TICKS + 10), sim.playerId);
    // A wounded bot also engages the party, so the notice line rides along.
    expect(heard.map((h) => triggerOf(h.ev)).sort()).toEqual(['notice', 'wipeThreat']);
  });

  it('no wipe threat while the party is healthy and whole', () => {
    const { sim, run } = shiftSim();
    for (const bot of run.bots) {
      const e = sim.entities.get(bot.pid)!;
      e.hp = Math.floor(e.maxHp * 0.5);
    }
    const heard = heardBy(runTicks(sim, BOT_SAY_GLOBAL_COOLDOWN_TICKS + 10), sim.playerId);
    // Wounded, the party is fighting: its chatter is overheard, then it walks
    // onto the skeletons by Morthen and spots him. Never a wipe threat.
    expect(heard.map((h) => triggerOf(h.ev))).toEqual(['clearing', 'notice']);
  });

  it('Morthen losing makes a living bot say a win line, then the loot lines, before the teardown', () => {
    const { sim, run } = shiftSim();
    runTicks(sim, 2);
    // A lethal blow on Morthen is clamped and sets the loss.
    (sim as any).dealDamage(
      botEntity(sim, run, 'tank'),
      sim.player,
      sim.player.maxHp + 500,
      false,
      'physical',
      null,
      'hit',
      true,
    );
    expect(run.pendingOutcome).toBe('lost');
    const heard = heardBy(runTicks(sim, 3), sim.playerId);
    // The defeat scene plays: the win line comes first, the run is still on.
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBe(run);
    expect(heard.map((h) => triggerOf(h.ev))).toEqual(['partyWins']);
    const rest = heardBy(runTicks(sim, LOSS_OUTRO_TICKS), sim.playerId);
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    expect(rest.map((h) => triggerOf(h.ev))).toEqual(['loot', 'loot']);
  });

  it('the two loot lines come from two different living bots', () => {
    // Two left standing, so a repeated speaker would show on most seeds.
    for (const seed of [42, 7, 99, 1234, 2026, 31337]) {
      const { sim, run } = shiftSim(seed);
      const standing = new Set([botEntity(sim, run, 'tank').id, botEntity(sim, run, 'healer').id]);
      for (const b of run.bots) if (!standing.has(b.pid)) kill(sim, sim.entities.get(b.pid)!);
      runTicks(sim, 2);
      (sim as any).dealDamage(
        null,
        sim.player,
        sim.player.maxHp + 500,
        false,
        'physical',
        null,
        'hit',
        true,
      );
      const loot = heardBy(runTicks(sim, LOSS_OUTRO_TICKS + 3), sim.playerId).filter(
        (h) => triggerOf(h.ev) === 'loot',
      );
      expect(loot, `seed ${seed}`).toHaveLength(2);
      for (const h of loot) expect(standing.has(h.ev.fromPid), `seed ${seed}`).toBe(true);
      expect(loot[0].ev.fromPid, `seed ${seed}`).not.toBe(loot[1].ev.fromPid);
    }
  });

  it('Morthen dying outright (the /dev kill path) also makes the party cheer', () => {
    const { sim } = shiftSim();
    runTicks(sim, 2);
    sim.chat('/dev kill');
    expect(sim.player.dead).toBe(true);
    const heard = heardBy(runTicks(sim, 3), sim.playerId);
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    expect(heard.map((h) => triggerOf(h.ev))).toEqual(['partyWins']);
  });

  it('an end or a pending win makes no win line', () => {
    for (const outcome of ['aborted', 'won'] as const) {
      const { sim, run } = shiftSim();
      runTicks(sim, 2);
      if (outcome === 'aborted') sim.chat('/dev graveyardshift end');
      else run.pendingOutcome = 'won';
      expect(run.pendingOutcome).toBe(outcome);
      const heard = runTicks(sim, 3);
      expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
      expect(heard).toEqual([]);
    }
  });

  it('holds the rate limits and never repeats a line through a full fight', () => {
    const { sim, run } = shiftSim();
    const tank = botEntity(sim, run, 'tank');
    place(sim, sim.player, tank.pos.x, tank.pos.z + 6);
    const heard: Heard[] = [];
    const stray: ChatEvent[] = [];
    runTicks(sim, 5, heard, stray);
    kill(sim, botEntity(sim, run, 'dps'));
    runTicks(sim, 30, heard, stray);
    botEntity(sim, run, 'healer').resource = 0;
    runTicks(sim, 150, heard, stray);
    kill(sim, botEntity(sim, run, 'healer'));
    runTicks(sim, 600, heard, stray);
    // Nothing the bots say rides party chat or any channel but say.
    expect(stray).toEqual([]);
    const mine = heardBy(heard, sim.playerId);
    expect(mine.length).toBeGreaterThanOrEqual(4);
    const keys = mine.map((h) => h.ev.textKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (let i = 1; i < mine.length; i++) {
      expect(mine[i].tick - mine[i - 1].tick).toBeGreaterThanOrEqual(BOT_SAY_GLOBAL_COOLDOWN_TICKS);
    }
    const byBot = new Map<number, number[]>();
    for (const h of mine) byBot.set(h.ev.fromPid, [...(byBot.get(h.ev.fromPid) ?? []), h.tick]);
    for (const ticks of byBot.values()) {
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i] - ticks[i - 1]).toBeGreaterThanOrEqual(BOT_SAY_BOT_COOLDOWN_TICKS);
      }
    }
  });

  it('is deterministic: the same seed says the same lines from the same bots', () => {
    const script = () => {
      const { sim, run } = shiftSim(7);
      kill(sim, botEntity(sim, run, 'dps'));
      const heard = runTicks(sim, 20);
      const tank = botEntity(sim, run, 'tank');
      place(sim, sim.player, tank.pos.x, tank.pos.z + 6);
      runTicks(sim, 300, heard);
      return heardBy(heard, sim.playerId).map((h) => [h.tick, h.ev.fromPid, h.ev.textKey]);
    };
    const a = script();
    expect(a.length).toBeGreaterThanOrEqual(2);
    expect(script()).toEqual(a);
  });

  it('draws nothing from the shared rng or the bots brain rngs', () => {
    const { sim, run } = shiftSim();
    kill(sim, botEntity(sim, run, 'dps'));
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    for (const bot of run.bots) bot.brain.rng.setObserver(() => draws++);
    const before = sim.events.length;
    updateGraveyardShiftSay(sim.ctx, run);
    sim.rng.setObserver(null);
    for (const bot of run.bots) bot.brain.rng.setObserver(null);
    expect(sim.events.slice(before).filter(isBotSay).length).toBeGreaterThan(0);
    expect(draws).toBe(0);
  });
});

describe('the HUD renders a keyed say through t()', () => {
  const hudSrc = readFileSync(join(__dirname, '..', 'src/ui/hud.ts'), 'utf8');

  it('localizes the say log line and the overhead bubble body', () => {
    const sayBranch = hudSrc.slice(
      hudSrc.indexOf('            default:\n              this.chatLogFrom('),
    );
    expect(sayBranch.slice(0, 200)).toContain(
      'localizeChatBody(ev),\n                CHAT_TEMPLATE_KEYS.say',
    );
    expect(hudSrc).toContain(
      '? localizeAuthoredYellText(ev.text, bubbleSpeaker?.kind, ev.classId)\n                : localizeChatBody(ev);',
    );
    // A keyed body renders through the catalog; an unkeyed (player) one stays verbatim.
    expect(hudSrc).toContain(
      'return ev.textKey ? t(ev.textKey as TranslationKey, ev.textValues) : ev.text;',
    );
  });

  it('sends no copy of a line to the client-less party itself', () => {
    const { sim, run } = shiftSim();
    const tank = botEntity(sim, run, 'tank');
    place(sim, sim.player, tank.pos.x, tank.pos.z + 6);
    const heard = runTicks(sim, 20 * 4);
    expect(heard.length).toBeGreaterThan(0);
    for (const b of run.bots) expect(heardBy(heard, b.pid)).toEqual([]);
  });
});
