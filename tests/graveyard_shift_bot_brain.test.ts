import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import { graveyardShiftRunFor } from '../src/sim/graveyard_shift';
import {
  BOT_REACTION_MAX_TICKS,
  BOT_REACTION_MIN_TICKS,
  BOT_THINK_INTERVAL_TICKS,
  botSeed,
  graveyardShiftRunSeed,
  interruptAllowed,
  isControlAbility,
  pickHealTarget,
  pickTarget,
  reactionDelayTicks,
} from '../src/sim/graveyard_shift/bot_brain';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function shiftSim(seed = 42) {
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    devCommands: true,
    offlineHost: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(10);
  sim.chat('/dev graveyardshift start');
  const run = graveyardShiftRunFor(sim.ctx, sim.playerId)!;
  expect(run).not.toBeNull();
  return { sim, run };
}

const bot = (sim: Sim, run: ReturnType<typeof shiftSim>['run'], role: string) =>
  sim.entities.get(run.bots.find((b) => b.role === role)!.pid)!;

// Morthen walks up to the party (inside the engage radius) and stands still.
function engage(sim: Sim, run: ReturnType<typeof shiftSim>['run']) {
  const tank = bot(sim, run, 'tank');
  const p = sim.player;
  p.pos = sim.ctx.groundPos(tank.pos.x, tank.pos.z + 6);
  p.prevPos = { ...p.pos };
  (sim as any).rebucket(p);
}

function runTicks(sim: Sim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.tick());
  return out;
}

describe('Graveyard Shift bot brain (pure rules)', () => {
  it('reaction delays stay within the human band', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 200; i++) {
      const d = reactionDelayTicks(rng);
      expect(d).toBeGreaterThanOrEqual(BOT_REACTION_MIN_TICKS);
      expect(d).toBeLessThanOrEqual(BOT_REACTION_MAX_TICKS);
    }
  });

  it('never allows an interrupt in the first 0.3 sec of a cast', () => {
    expect(interruptAllowed(2, 1.8)).toBe(false);
    expect(interruptAllowed(2, 1.71)).toBe(false);
    expect(interruptAllowed(2, 1.7)).toBe(true);
  });

  it('filters crowd control out of the party kit, keeps interrupts', () => {
    expect(isControlAbility(ABILITIES.polymorph)).toBe(true);
    expect(isControlAbility(ABILITIES.counterspell)).toBe(false);
    expect(isControlAbility(ABILITIES.fireball)).toBe(false);
  });

  it('healer triage favours the tank and neglects itself; ties break on id', () => {
    const pick = pickHealTarget([
      { id: 3, hpFrac: 0.5, role: 'healer', isSelf: true },
      { id: 2, hpFrac: 0.6, role: 'tank', isSelf: false },
      { id: 4, hpFrac: 0.55, role: 'dps', isSelf: false },
    ]);
    expect(pick?.id).toBe(2);
    expect(pickHealTarget([{ id: 1, hpFrac: 1, role: 'tank', isSelf: false }])).toBeNull();
    const tie = pickHealTarget([
      { id: 9, hpFrac: 0.5, role: 'dps', isSelf: false },
      { id: 5, hpFrac: 0.5, role: 'dps', isSelf: false },
    ]);
    expect(tie?.id).toBe(5);
  });

  it('damage dealers assist the tank and keep their current target', () => {
    const base = { hpFrac: 1, attackingMe: false, isCurrent: false, isMinion: false };
    expect(
      pickTarget([
        { ...base, id: 1, isAssist: false },
        { ...base, id: 2, isAssist: true, isMinion: true },
      ])?.id,
    ).toBe(2);
    expect(
      pickTarget([
        { ...base, id: 1, isAssist: false, isCurrent: true },
        { ...base, id: 2, isAssist: false, isMinion: true },
      ])?.id,
    ).toBe(1);
  });

  it('seeds a private stream per run and per roster slot', () => {
    const run = graveyardShiftRunSeed(42, 100, 1);
    expect(run).toBe(graveyardShiftRunSeed(42, 100, 1));
    expect(run).not.toBe(graveyardShiftRunSeed(42, 101, 1));
    expect(botSeed(run, 0)).not.toBe(botSeed(run, 1));
  });
});

describe('Graveyard Shift party in a real fight', () => {
  it('waits idle until Morthen comes close', () => {
    const { sim, run } = shiftSim();
    const before = run.bots.map((b) => ({ ...sim.entities.get(b.pid)!.pos }));
    runTicks(sim, 60);
    expect(run.engaged).toBe(false);
    run.bots.forEach((b, i) => {
      expect(sim.entities.get(b.pid)!.pos).toEqual(before[i]);
    });
  });

  it('engages: the tank closes to melee, the casters cast at Morthen', () => {
    const { sim, run } = shiftSim();
    engage(sim, run);
    const hp0 = sim.player.hp;
    runTicks(sim, 20 * 8);
    expect(run.engaged).toBe(true);
    const tank = bot(sim, run, 'tank');
    // The tank picks Morthen or one of his skeletons (adds first) and closes to melee.
    expect([sim.playerId, ...run.allyIds]).toContain(tank.targetId);
    const target = sim.entities.get(tank.targetId!)!;
    expect(Math.hypot(tank.pos.x - target.pos.x, tank.pos.z - target.pos.z)).toBeLessThan(6);
    expect(sim.player.hp).toBeLessThan(hp0);
  });

  it('the healer heals a wounded tank through the real cast path', () => {
    const { sim, run } = shiftSim();
    engage(sim, run);
    const tank = bot(sim, run, 'tank');
    tank.hp = Math.floor(tank.maxHp * 0.4);
    const healer = bot(sim, run, 'healer');
    const mana0 = healer.resource;
    runTicks(sim, 20 * 6);
    expect(healer.resource).toBeLessThan(mana0);
    expect(tank.hp).toBeGreaterThan(Math.floor(tank.maxHp * 0.4));
  });

  it('kicks Shadow Pulse, but never inside the reaction delay or the first 0.3 sec', () => {
    const { sim, run } = shiftSim();
    engage(sim, run);
    runTicks(sim, 40);
    // Shadow Pulse costs Dread: hand Morthen a full bar for the cast.
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('gshift_shadow_pulse');
    expect(sim.player.castingAbility).toBe('gshift_shadow_pulse');
    const castTick = sim.ctx.tickCount;
    let kickedAt = -1;
    for (let i = 0; i < 40 && kickedAt < 0; i++) {
      sim.tick();
      if (!sim.player.castingAbility) kickedAt = sim.ctx.tickCount;
    }
    expect(kickedAt).toBeGreaterThan(0);
    expect(kickedAt - castTick).toBeGreaterThanOrEqual(BOT_REACTION_MIN_TICKS);
    expect(kickedAt - castTick).toBeLessThan(40);
    expect(sim.player.auras.some((a) => a.kind === 'lockout')).toBe(true);
  });

  it('every interrupter waits out a reaction delay after it perceives the cast', () => {
    const { sim, run } = shiftSim();
    engage(sim, run);
    runTicks(sim, 40);
    // Shadow Pulse costs Dread: hand Morthen a full bar for the cast.
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('gshift_shadow_pulse');
    const seen = new Map<number, number>();
    for (let i = 0; i < 12; i++) {
      sim.tick();
      for (const b of run.bots) {
        if (b.brain.kickAt !== null && !seen.has(b.pid)) {
          seen.set(b.pid, b.brain.kickAt - sim.ctx.tickCount);
        }
      }
    }
    expect(seen.size).toBe(run.bots.length);
    for (const delay of seen.values()) {
      expect(delay).toBeGreaterThanOrEqual(BOT_REACTION_MIN_TICKS - BOT_THINK_INTERVAL_TICKS);
    }
    expect(Math.min(...seen.values())).toBeGreaterThan(0);
  });

  it('is deterministic: the same seed fights the same fight', () => {
    const trace = () => {
      const { sim, run } = shiftSim(99);
      engage(sim, run);
      runTicks(sim, 20 * 10);
      return run.bots
        .map((b) => {
          const e = sim.entities.get(b.pid)!;
          return [e.hp, Math.round(e.pos.x * 100), Math.round(e.pos.z * 100), e.resource];
        })
        .concat([[sim.player.hp]]);
    };
    expect(trace()).toEqual(trace());
  });

  it('a tank whose kick is down keeps its own target through a Morthen cast', () => {
    const { sim, run } = shiftSim();
    engage(sim, run);
    runTicks(sim, 60);
    const tankBot = run.bots.find((b) => b.role === 'tank')!;
    const tank = sim.entities.get(tankBot.pid)!;
    const [skeleton] = run.allyIds.map((id) => sim.entities.get(id)!);
    sim.targetEntity(skeleton.id, tank.id);
    tank.cooldowns.set('pummel', 30);
    sim.player.resource = sim.player.maxResource;
    sim.castAbility('gshift_shadow_pulse');
    const targets = new Set<number | null>();
    for (let i = 0; i < 30 && sim.player.castingAbility; i++) {
      sim.tick();
      targets.add(tank.targetId);
    }
    expect(targets.has(sim.playerId)).toBe(false);
  });

  it("never casts into a silence (no refused casts after Sexton's Chain)", () => {
    const { sim, run } = shiftSim();
    engage(sim, run);
    runTicks(sim, 40);
    const mage = bot(sim, run, 'dps');
    const p = sim.player;
    p.facing = Math.atan2(mage.pos.x - p.pos.x, mage.pos.z - p.pos.z);
    sim.targetEntity(mage.id);
    p.cooldowns.delete('gshift_sextons_chain');
    p.gcdRemaining = 0;
    sim.castAbility('gshift_sextons_chain');
    const events = runTicks(sim, 40);
    expect(mage.auras.some((a) => a.kind === 'silence') || events.length > 0).toBe(true);
    expect(
      events.some(
        (ev) => ev.type === 'error' && (ev as any).pid === mage.id && /silenced/i.test(ev.text),
      ),
    ).toBe(false);
  });

  it('adventurers earn no deeds, not even for falling', () => {
    const { sim, run } = shiftSim();
    const healer = bot(sim, run, 'healer');
    const earned = new Set((sim as any).players.get(healer.id).deedsEarned.keys());
    (sim as any).dealDamage(null, healer, healer.maxHp + 50, false, 'physical', null, 'hit', true);
    runTicks(sim, 40);
    const after = [...(sim as any).players.get(healer.id).deedsEarned.keys()];
    expect(after.filter((id: string) => !earned.has(id))).toEqual([]);
  });
});
