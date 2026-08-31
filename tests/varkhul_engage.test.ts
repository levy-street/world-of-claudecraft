import { describe, expect, it } from 'vitest';
import { updateVarkhulEncounter, VARKHUL_BOSS_ID } from '../src/sim/encounters/varkhul';
import { VARKHUL_DIALOGUE } from '../src/sim/encounters/varkhul_dialogue';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import {
  initVarkhulEngage,
  startVarkhulEngage,
  tickVarkhulEngage,
  VARKHUL_ENGAGE_RUN_TIMEOUT_SECONDS,
  VARKHUL_ENGAGE_TAUNT_SECONDS,
  varkhulForgingHammerTick,
} from '../src/sim/varkhul_engage';

const DT = 1 / 20;

describe('Varkhul engage staging (pure module)', () => {
  it('hammers the anvil on the assembly cadence while forging, and stops once engaged', () => {
    const st = initVarkhulEngage();
    let blows = 0;
    for (let tick = 0; tick < 20 * 10; tick++) if (varkhulForgingHammerTick(st, DT)) blows++;
    // first blow at 0.6s, then every 2s: 0.6, 2.6, 4.6, 6.6, 8.6 inside 10s
    expect(blows).toBe(5);
    startVarkhulEngage(st);
    expect(st.phase).toBe('running');
    expect(varkhulForgingHammerTick(st, DT)).toBe(false);
  });

  it('runs until arrival, roars exactly once at the handover, then completes', () => {
    const st = initVarkhulEngage();
    startVarkhulEngage(st);
    // still on the way: no roar, phase holds
    for (let tick = 0; tick < 30; tick++) {
      expect(tickVarkhulEngage(st, DT, false)).toEqual({ phase: 'running', roar: false });
    }
    // arrival: the single roar edge starts the taunt
    expect(tickVarkhulEngage(st, DT, true)).toEqual({ phase: 'taunting', roar: true });
    let roars = 0;
    let steps = 0;
    while (st.phase !== 'done' && steps < 100) {
      const step = tickVarkhulEngage(st, DT, true);
      if (step.roar) roars++;
      steps++;
    }
    expect(roars).toBe(0);
    // the handover tick starts the taunt at its full length
    expect(steps).toBe(Math.round(VARKHUL_ENGAGE_TAUNT_SECONDS / DT));
    // done state is stable and never roars again
    expect(tickVarkhulEngage(st, DT, true)).toEqual({ phase: 'done', roar: false });
    expect(tickVarkhulEngage(st, DT, false)).toEqual({ phase: 'done', roar: false });
  });

  it('falls back to roaring in place if the run never arrives (the timeout backstop)', () => {
    const st = initVarkhulEngage();
    startVarkhulEngage(st);
    const timeoutTicks = Math.round(VARKHUL_ENGAGE_RUN_TIMEOUT_SECONDS / DT);
    let handover: ReturnType<typeof tickVarkhulEngage> | null = null;
    for (let tick = 0; tick < timeoutTicks && !handover; tick++) {
      const step = tickVarkhulEngage(st, DT, false);
      if (step.phase !== 'running') handover = step;
    }
    expect(handover).toEqual({ phase: 'taunting', roar: true });
  });
});

describe('Varkhul engage staging (encounter integration)', () => {
  function raidSim(): { sim: Sim; boss: Entity } {
    const sim = new Sim({ seed: 6112, playerClass: 'warrior', autoEquip: true, devCommands: true });
    sim.setPlayerLevel(20);
    sim.chat('/dev varkhulraid normal');
    const boss = [...sim.entities.values()].find((e) => e.templateId === VARKHUL_BOSS_ID);
    if (!boss) throw new Error('no Varkhul in the practice room');
    // The practice allies spawn inside his 30u aggro ring, which would engage
    // him on tick one. Park everyone at the far wall so the walk-in staging is
    // observable, the way a real first pull sees it.
    for (const e of sim.entities.values()) {
      if (e.kind === 'player' && e.id !== boss.id) e.pos = { ...e.pos, z: boss.pos.z - 50 };
    }
    sim.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z - 50 };
    return { sim, boss };
  }

  it('works the anvil pre-pull, runs to the arena center on the ground, then roars once', () => {
    const { sim, boss } = raidSim();
    const spawn = { ...boss.pos };
    const events: SimEvent[] = [];
    const origEmit = sim.ctx.emit.bind(sim.ctx);
    sim.ctx.emit = (ev: SimEvent) => {
      events.push(ev);
      origEmit(ev);
    };

    // pre-pull: nobody within aggro range; he stays put and hammers the anvil
    for (let tick = 0; tick < 20 * 5; tick++) updateVarkhulEncounter(sim.ctx, boss, true);
    const hammerBlows = events.filter(
      (ev) => ev.type === 'spellfxAt' && ev.ability === "Forgefather's Hammer",
    );
    expect(hammerBlows.length).toBeGreaterThanOrEqual(2);
    expect(boss.pos).toEqual(spawn);
    expect(boss.varkhul?.engage.phase).toBe('forging');

    // pull: the player steps into aggro range; the run starts, the roar waits
    sim.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z - 8 };
    updateVarkhulEncounter(sim.ctx, boss, true);
    expect(boss.varkhul?.engage.phase).toBe('running');
    expect(events.filter((ev) => ev.type === 'spellfx' && ev.fx === 'shout')).toHaveLength(0);

    // he RUNS to the middle: grounded the whole way (the old leap is gone),
    // covering real distance, then hands over to the roar at the center
    let peakY = boss.pos.y;
    let runTicks = 0;
    while (boss.varkhul?.engage.phase === 'running' && runTicks < 20 * 8) {
      updateVarkhulEncounter(sim.ctx, boss, true);
      peakY = Math.max(peakY, boss.pos.y);
      runTicks++;
    }
    expect(boss.varkhul?.engage.phase).toBe('taunting');
    // grounded run: no leap arc ever lifts him meaningfully off the floor
    expect(peakY).toBeLessThan(spawn.y + 1);
    // he ran to the middle of the arena, well away from the anvil
    const movedFromSpawn = Math.hypot(boss.pos.x - spawn.x, boss.pos.z - spawn.z);
    expect(movedFromSpawn).toBeGreaterThan(10);
    const shouts = events.filter((ev) => ev.type === 'spellfx' && ev.fx === 'shout');
    expect(shouts).toHaveLength(1);
    expect(shouts[0]).toMatchObject({ sourceId: boss.id });
    const engageYells = events.filter(
      (ev) => ev.type === 'chat' && ev.channel === 'yell' && ev.text === VARKHUL_DIALOGUE.engage,
    );
    expect(engageYells.length).toBeGreaterThan(0);
    expect(new Set(engageYells.map((event) => event.pid)).size).toBe(engageYells.length);

    // he stands through the roar (no drift), then the staging completes and
    // only THEN does the chase move him again
    const roarPos = { ...boss.pos };
    const tauntTicks = Math.ceil(VARKHUL_ENGAGE_TAUNT_SECONDS / DT);
    for (let tick = 0; tick < tauntTicks - 1; tick++) updateVarkhulEncounter(sim.ctx, boss, true);
    expect(boss.varkhul?.engage.phase).toBe('taunting');
    expect(boss.pos).toEqual(roarPos);
    for (let tick = 0; tick < 3; tick++) updateVarkhulEncounter(sim.ctx, boss, true);
    expect(boss.varkhul?.engage.phase).toBe('done');
    // one roar total: the cue must never re-fire after the staging completes
    for (let tick = 0; tick < 20; tick++) updateVarkhulEncounter(sim.ctx, boss, true);
    expect(events.filter((ev) => ev.type === 'spellfx' && ev.fx === 'shout')).toHaveLength(1);
    expect(
      events.filter(
        (ev) => ev.type === 'chat' && ev.channel === 'yell' && ev.text === VARKHUL_DIALOGUE.engage,
      ),
    ).toHaveLength(engageYells.length);
  });

  it('keeps the ability schedule identical: the first Cinder Orbs still lands 8s after combat starts', () => {
    const { sim, boss } = raidSim();
    sim.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z - 8 };
    let ticks = 0;
    while (boss.castingAbility !== 'Cinder Orbs' && ticks < 20 * 12) {
      updateVarkhulEncounter(sim.ctx, boss, true);
      ticks++;
    }
    // the staging must not have paused the timer: first orbs at 8s, +-1 tick
    expect(ticks).toBeGreaterThanOrEqual(8 * 20 - 1);
    expect(ticks).toBeLessThanOrEqual(8 * 20 + 1);
  });
});
