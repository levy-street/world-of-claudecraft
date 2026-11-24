// Moonwing Tidewheel (src/sim/combat/druid_tidewheel.ts and the balance arm of
// druidEngineOnCast / druidEngineOnBleedTick in druid_engines.ts): two banks
// instead of one. Wildbolt fills Suntide (Skyfall becomes Sunwake at 3),
// Skyfall and Moonseed fill Moontide (Moonseed becomes Moonsurge at 3). Each
// payoff spends only its own bank, refreshes its school's effect, and opens
// one of two exclusive windows: Sunrise (faster Skyfall, faster Lunar
// Tempest) or Moonrise (harder Wildbolt, faster Stinging Swarm).
import { describe, expect, it } from 'vitest';
import {
  druidEngineOnBleedTick,
  HIGHMOON_TITHE_PCT,
  MOONTIDE_ID,
  MOONTIDE_STAGES,
} from '../src/sim/combat/druid_engines';
import {
  LUNAR_TEMPEST_EXTEND_CAP,
  LUNAR_TEMPEST_ID,
  MOONRISE_ID,
  MOONRISE_WILDBOLT_DMG_MULT,
  openTidewheelWindow,
  SKYFALL_ID,
  STINGING_SWARM_EXTEND_CAP,
  STINGING_SWARM_ID,
  SUNRISE_ID,
  SUNRISE_SKYFALL_CAST_MULT,
  SUNTIDE_ID,
  SUNTIDE_STAGES,
  TIDE_CAST_EXTEND_SECONDS,
  TIDE_TICK_ICD,
  TIDEWHEEL_TICK_RATE,
  TIDEWHEEL_WINDOW_SECONDS,
  tidewheelCastTime,
  tidewheelDirectMult,
  tidewheelTickBank,
  tidewheelTickRate,
  WILDBOLT_ID,
} from '../src/sim/combat/druid_tidewheel';
import { onCastCompleted, tickProcState } from '../src/sim/combat/talent_procs';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

function rig(rows: Record<number, string> = {}) {
  const sim = new Sim({ seed: 41, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: 'balance', rows })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return { sim, player: sim.player };
}

function ctx(sim: Sim): Parameters<typeof onCastCompleted>[0] {
  return (sim as unknown as { ctx: Parameters<typeof onCastCompleted>[0] }).ctx;
}

function completed(sim: Sim, abilityId: string, target: Entity | null = null): void {
  onCastCompleted(ctx(sim), sim.player, abilityId, target);
}

function stacks(player: Entity, id: string): number {
  return player.auras.find((aura) => aura.id === id)?.stacks ?? 0;
}

function hasWindow(player: Entity, id: string): boolean {
  return player.auras.some((aura) => aura.id === id && aura.sourceId === player.id);
}

function formAura(player: Entity): Aura {
  return {
    id: 'form_moonkin',
    name: 'form_moonkin',
    kind: 'form_moonkin',
    remaining: 3600,
    duration: 3600,
    value: 0,
    sourceId: player.id,
    school: 'nature',
  };
}

function dot(owner: Entity, id: string): Aura {
  return {
    id,
    name: id,
    kind: 'dot',
    remaining: 12,
    duration: 12,
    value: 10,
    tickInterval: 3,
    tickTimer: 3,
    sourceId: owner.id,
    school: id === STINGING_SWARM_ID ? 'nature' : 'arcane',
    extendedBy: 0,
  };
}

function targetMob(sim: Sim): Entity {
  const player = sim.player;
  const mob = createMob(9821, MOBS.forest_wolf, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + 2,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 1_000_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  player.facing = 0;
  return mob;
}

function ownDot(target: Entity, owner: Entity, id: string): Aura | undefined {
  return target.auras.find(
    (aura) => aura.kind === 'dot' && aura.id === id && aura.sourceId === owner.id,
  );
}

describe('Tidewheel banks', () => {
  it('fills Suntide from Wildbolt and Moontide from Skyfall and Moonseed, only in Moonwing', () => {
    const { sim, player } = rig();
    completed(sim, WILDBOLT_ID);
    completed(sim, SKYFALL_ID);
    completed(sim, 'moonseed');
    expect(stacks(player, SUNTIDE_ID)).toBe(0);
    expect(stacks(player, MOONTIDE_ID)).toBe(0);

    player.auras.push(formAura(player));
    completed(sim, WILDBOLT_ID);
    expect(stacks(player, SUNTIDE_ID)).toBe(1);
    expect(stacks(player, MOONTIDE_ID)).toBe(0);
    completed(sim, SKYFALL_ID);
    completed(sim, 'moonseed');
    expect(stacks(player, SUNTIDE_ID)).toBe(1);
    expect(stacks(player, MOONTIDE_ID)).toBe(2);

    // Each bank caps at its own stage count.
    for (let cast = 0; cast < 5; cast++) {
      completed(sim, WILDBOLT_ID);
      completed(sim, SKYFALL_ID);
    }
    expect(stacks(player, SUNTIDE_ID)).toBe(SUNTIDE_STAGES);
    expect(stacks(player, MOONTIDE_ID)).toBe(MOONTIDE_STAGES);
  });

  it('turns Skyfall into Sunwake at 3 Suntide and Moonseed into Moonsurge at 3 Moontide', () => {
    const { sim, player } = rig();
    player.auras.push(formAura(player));
    for (let cast = 0; cast < SUNTIDE_STAGES; cast++) {
      expect(sim.resolvedAbility(SKYFALL_ID)?.def.id).toBe(SKYFALL_ID);
      completed(sim, WILDBOLT_ID);
    }
    expect(sim.resolvedAbility(SKYFALL_ID)?.def.id).toBe('sunlance');
    expect(sim.resolvedAbility('moonseed')?.def.id).toBe('moonseed');

    for (let cast = 0; cast < MOONTIDE_STAGES; cast++) {
      expect(sim.resolvedAbility('moonseed')?.def.id).toBe('moonseed');
      completed(sim, 'moonseed');
    }
    expect(sim.resolvedAbility('moonseed')?.def.id).toBe('moonlash');
    expect(sim.resolvedAbility(WILDBOLT_ID)?.def.id).toBe(WILDBOLT_ID);
  });
});

describe('Tidewheel payoffs', () => {
  function armedBoth() {
    const r = rig();
    const mob = targetMob(r.sim);
    r.player.auras.push(formAura(r.player));
    for (let cast = 0; cast < 3; cast++) {
      completed(r.sim, WILDBOLT_ID);
      completed(r.sim, SKYFALL_ID);
    }
    expect(stacks(r.player, SUNTIDE_ID)).toBe(SUNTIDE_STAGES);
    expect(stacks(r.player, MOONTIDE_ID)).toBe(MOONTIDE_STAGES);
    return { ...r, mob };
  }

  it('Sunwake spends only Suntide, replants Stinging Swarm, and opens Sunrise', () => {
    const { sim, player, mob } = armedBoth();
    expect(ownDot(mob, player, STINGING_SWARM_ID)).toBeUndefined();

    completed(sim, 'sunlance', mob);

    expect(stacks(player, SUNTIDE_ID)).toBe(0);
    expect(stacks(player, MOONTIDE_ID)).toBe(MOONTIDE_STAGES);
    expect(ownDot(mob, player, STINGING_SWARM_ID)).toBeDefined();
    expect(hasWindow(player, SUNRISE_ID)).toBe(true);
    expect(hasWindow(player, MOONRISE_ID)).toBe(false);
    expect(player.auras.find((aura) => aura.id === SUNRISE_ID)?.remaining).toBe(
      TIDEWHEEL_WINDOW_SECONDS,
    );
    expect(sim.resolvedAbility(SKYFALL_ID)?.def.id).toBe(SKYFALL_ID);
    expect(sim.resolvedAbility('moonseed')?.def.id).toBe('moonlash');
  });

  it('Moonsurge spends only Moontide, replants Lunar Tempest, and opens Moonrise', () => {
    const { sim, player, mob } = armedBoth();
    expect(ownDot(mob, player, LUNAR_TEMPEST_ID)).toBeUndefined();

    completed(sim, 'moonlash', mob);

    expect(stacks(player, MOONTIDE_ID)).toBe(0);
    expect(stacks(player, SUNTIDE_ID)).toBe(SUNTIDE_STAGES);
    expect(ownDot(mob, player, LUNAR_TEMPEST_ID)).toBeDefined();
    expect(hasWindow(player, MOONRISE_ID)).toBe(true);
    expect(hasWindow(player, SUNRISE_ID)).toBe(false);
    expect(sim.resolvedAbility('moonseed')?.def.id).toBe('moonseed');
    expect(sim.resolvedAbility(SKYFALL_ID)?.def.id).toBe('sunlance');
  });

  it('keeps the windows exclusive: opening one closes the other', () => {
    const { sim, player, mob } = armedBoth();
    completed(sim, 'sunlance', mob);
    expect(hasWindow(player, SUNRISE_ID)).toBe(true);
    completed(sim, 'moonlash', mob);
    expect(hasWindow(player, MOONRISE_ID)).toBe(true);
    expect(hasWindow(player, SUNRISE_ID)).toBe(false);

    openTidewheelWindow(ctx(sim), player, SUNRISE_ID);
    expect(hasWindow(player, SUNRISE_ID)).toBe(true);
    expect(hasWindow(player, MOONRISE_ID)).toBe(false);
    expect(player.auras.filter((aura) => aura.id === SUNRISE_ID)).toHaveLength(1);
  });

  it('Highmoon Tithe refunds its share of max mana on either payoff', () => {
    const { sim, player } = rig({ 14: 'dru_r14_moonfury' });
    player.auras.push(formAura(player));
    expect(HIGHMOON_TITHE_PCT).toBe(0.1);
    const refund = Math.round(player.maxResource * HIGHMOON_TITHE_PCT);
    for (const payoff of ['sunlance', 'moonlash']) {
      player.resource = 0;
      completed(sim, payoff);
      expect(player.resource, payoff).toBe(refund);
    }
  });
});

describe('Tidewheel casts extend the matching effect', () => {
  it('Wildbolt extends Stinging Swarm up to its cap', () => {
    const { sim, player } = rig();
    const mob = targetMob(sim);
    player.auras.push(formAura(player));
    mob.auras.push(dot(player, STINGING_SWARM_ID));
    completed(sim, WILDBOLT_ID, mob);
    expect(ownDot(mob, player, STINGING_SWARM_ID)?.extendedBy).toBe(TIDE_CAST_EXTEND_SECONDS);
    for (let cast = 0; cast < 6; cast++) completed(sim, WILDBOLT_ID, mob);
    const swarm = ownDot(mob, player, STINGING_SWARM_ID);
    expect(swarm?.extendedBy).toBe(STINGING_SWARM_EXTEND_CAP);
    expect(swarm?.duration).toBe(12 + STINGING_SWARM_EXTEND_CAP);
  });

  it('Skyfall extends Lunar Tempest up to its cap', () => {
    const { sim, player } = rig();
    const mob = targetMob(sim);
    player.auras.push(formAura(player));
    mob.auras.push(dot(player, LUNAR_TEMPEST_ID));
    completed(sim, SKYFALL_ID, mob);
    expect(ownDot(mob, player, LUNAR_TEMPEST_ID)?.extendedBy).toBe(TIDE_CAST_EXTEND_SECONDS);
    for (let cast = 0; cast < 10; cast++) completed(sim, SKYFALL_ID, mob);
    expect(ownDot(mob, player, LUNAR_TEMPEST_ID)?.extendedBy).toBe(LUNAR_TEMPEST_EXTEND_CAP);
  });
});

describe('Tidewheel dot ticks', () => {
  it('maps each dot to its bank', () => {
    const { player } = rig();
    expect(tidewheelTickBank(dot(player, STINGING_SWARM_ID))).toBe('suntide');
    expect(tidewheelTickBank(dot(player, LUNAR_TEMPEST_ID))).toBe('moontide');
    expect(tidewheelTickBank(dot(player, 'rake'))).toBeNull();
    expect(tidewheelTickBank({ ...dot(player, STINGING_SWARM_ID), kind: 'hot' })).toBeNull();
  });

  it('banks a tick once per bank per TIDE_TICK_ICD', () => {
    const { sim, player } = rig();
    const swarm = dot(player, STINGING_SWARM_ID);
    const tempest = dot(player, LUNAR_TEMPEST_ID);

    // Out of Moonwing the banks stay frozen.
    druidEngineOnBleedTick(ctx(sim), player, swarm);
    expect(stacks(player, SUNTIDE_ID)).toBe(0);

    player.auras.push(formAura(player));
    druidEngineOnBleedTick(ctx(sim), player, swarm);
    expect(stacks(player, SUNTIDE_ID)).toBe(1);
    // A second tick inside the internal cooldown does not bank.
    druidEngineOnBleedTick(ctx(sim), player, swarm);
    expect(stacks(player, SUNTIDE_ID)).toBe(1);
    // Each bank has its own internal cooldown.
    druidEngineOnBleedTick(ctx(sim), player, tempest);
    expect(stacks(player, MOONTIDE_ID)).toBe(1);
    druidEngineOnBleedTick(ctx(sim), player, tempest);
    expect(stacks(player, MOONTIDE_ID)).toBe(1);

    // Just short of the cooldown: still locked.
    tickProcState(player, TIDE_TICK_ICD - 0.5);
    druidEngineOnBleedTick(ctx(sim), player, swarm);
    expect(stacks(player, SUNTIDE_ID)).toBe(1);
    // Past it: the next tick banks again.
    tickProcState(player, 0.5);
    druidEngineOnBleedTick(ctx(sim), player, swarm);
    druidEngineOnBleedTick(ctx(sim), player, tempest);
    expect(stacks(player, SUNTIDE_ID)).toBe(2);
    expect(stacks(player, MOONTIDE_ID)).toBe(2);
  });

  it('banks from a real Stinging Swarm tick on a live target', () => {
    const { sim, player } = rig();
    const mob = targetMob(sim);
    player.auras.push(formAura(player));
    mob.auras.push({ ...dot(player, STINGING_SWARM_ID), tickTimer: 0.1 });
    for (let tick = 0; tick < 10; tick++) sim.tick();
    expect(stacks(player, SUNTIDE_ID)).toBe(1);
    // The next tick lands 3 sec later, inside the 8 sec cooldown.
    for (let tick = 0; tick < 4 * 20; tick++) sim.tick();
    expect(stacks(player, SUNTIDE_ID)).toBe(1);
  });
});

describe('Tidewheel window helpers', () => {
  it('Sunrise speeds only Skyfall casts', () => {
    const { sim, player } = rig();
    expect(tidewheelCastTime(player, SKYFALL_ID, 2.5)).toBe(2.5);
    openTidewheelWindow(ctx(sim), player, SUNRISE_ID);
    expect(tidewheelCastTime(player, SKYFALL_ID, 2.5)).toBeCloseTo(
      2.5 * SUNRISE_SKYFALL_CAST_MULT,
      10,
    );
    expect(tidewheelCastTime(player, WILDBOLT_ID, 1.6)).toBe(1.6);
    expect(tidewheelCastTime(player, SKYFALL_ID, 0)).toBe(0);
    openTidewheelWindow(ctx(sim), player, MOONRISE_ID);
    expect(tidewheelCastTime(player, SKYFALL_ID, 2.5)).toBe(2.5);
  });

  it('Sunrise shortens the resolved Skyfall cast time', () => {
    const { sim, player } = rig();
    player.auras.push(formAura(player));
    const before = sim.resolvedAbility(SKYFALL_ID)?.castTime ?? 0;
    expect(before).toBeGreaterThan(0);
    openTidewheelWindow(ctx(sim), player, SUNRISE_ID);
    const after = sim.resolvedAbility(SKYFALL_ID)?.castTime ?? 0;
    expect(after / before).toBeCloseTo(SUNRISE_SKYFALL_CAST_MULT, 10);
  });

  it('Moonrise makes only Wildbolt hit harder', () => {
    const { sim, player } = rig();
    expect(tidewheelDirectMult(player, WILDBOLT_ID)).toBe(1);
    openTidewheelWindow(ctx(sim), player, MOONRISE_ID);
    expect(tidewheelDirectMult(player, WILDBOLT_ID)).toBe(MOONRISE_WILDBOLT_DMG_MULT);
    expect(tidewheelDirectMult(player, SKYFALL_ID)).toBe(1);
    openTidewheelWindow(ctx(sim), player, SUNRISE_ID);
    expect(tidewheelDirectMult(player, WILDBOLT_ID)).toBe(1);
  });

  it('each window speeds the other school dot', () => {
    const { sim, player } = rig();
    const swarm = dot(player, STINGING_SWARM_ID);
    const tempest = dot(player, LUNAR_TEMPEST_ID);
    expect(tidewheelTickRate(ctx(sim), swarm)).toBe(1);
    expect(tidewheelTickRate(ctx(sim), tempest)).toBe(1);

    openTidewheelWindow(ctx(sim), player, SUNRISE_ID);
    expect(tidewheelTickRate(ctx(sim), tempest)).toBe(TIDEWHEEL_TICK_RATE);
    expect(tidewheelTickRate(ctx(sim), swarm)).toBe(1);

    openTidewheelWindow(ctx(sim), player, MOONRISE_ID);
    expect(tidewheelTickRate(ctx(sim), swarm)).toBe(TIDEWHEEL_TICK_RATE);
    expect(tidewheelTickRate(ctx(sim), tempest)).toBe(1);
    // A dot the window does not name keeps its clock.
    expect(tidewheelTickRate(ctx(sim), dot(player, 'rake'))).toBe(1);
  });
});
