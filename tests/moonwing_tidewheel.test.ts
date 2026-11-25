// Moonwing Tidewheel (src/sim/combat/druid_tidewheel.ts and the balance arm of
// druidEngineOnCast / druidEngineOnBleedTick in druid_engines.ts): two banks
// instead of one. Wildbolt fills Suntide and Skyfall fills Moontide; each
// payoff is its own button, usable in Moonwing Form once its bank holds 3 of
// its 5 points (Sunwake spends Suntide, Moonsurge spends Moontide; the retired
// Moonseed's slot went to Moonsurge). Each payoff spends all of its own bank
// (each point past 3 adds 20% to its strike), refreshes its
// school's effect, and opens one of two exclusive windows: Sunrise (faster
// Skyfall, faster Lunar Tempest) or Moonrise (harder Wildbolt, faster Stinging
// Swarm). Tidecross: a payoff cast inside the OTHER payoff's window strikes
// harder.
import { describe, expect, it } from 'vitest';
import {
  druidEngineOnBleedTick,
  HIGHMOON_TITHE_PCT,
  MOONTIDE_ID,
  MOONTIDE_STAGES,
} from '../src/sim/combat/druid_engines';
import {
  isTidewheelPayoff,
  LUNAR_TEMPEST_EXTEND_CAP,
  LUNAR_TEMPEST_ID,
  MOONRISE_ID,
  MOONRISE_WILDBOLT_DMG_MULT,
  MOONSURGE_ID,
  openTidewheelWindow,
  SKYFALL_ID,
  STINGING_SWARM_EXTEND_CAP,
  STINGING_SWARM_ID,
  SUNRISE_ID,
  SUNRISE_SKYFALL_CAST_MULT,
  SUNTIDE_ID,
  SUNTIDE_STAGES,
  SUNWAKE_ID,
  TIDE_CAST_EXTEND_SECONDS,
  TIDE_PAYOFF_MIN_STACKS,
  TIDE_SURPLUS_DMG_PER_STACK,
  TIDE_TICK_ICD,
  TIDECROSS_PAYOFF_DMG_MULT,
  TIDEWHEEL_TICK_RATE,
  TIDEWHEEL_WINDOW_SECONDS,
  tidewheelCastTime,
  tidewheelCrossed,
  tidewheelDirectMult,
  tidewheelPayoffBankStacks,
  tidewheelPayoffBlocked,
  tidewheelPayoffCrossPending,
  tidewheelPayoffMult,
  tidewheelSurplusMult,
  tidewheelTickBank,
  tidewheelTickRate,
  WILDBOLT_ID,
} from '../src/sim/combat/druid_tidewheel';
import { onCastCompleted, tickProcState } from '../src/sim/combat/talent_procs';
import { ABILITIES, CLASSES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, SimEvent } from '../src/sim/types';

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

/** Completes the builder until its bank holds this many points. */
function fillBank(sim: Sim, builder: string, bank: string, points: number): void {
  for (let cast = 0; stacks(sim.player, bank) < points && cast < 10; cast++) {
    completed(sim, builder);
  }
  expect(stacks(sim.player, bank)).toBe(points);
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

/** A real Moonsurge cast through the projectile path, spent at this many
 *  Moontide points, optionally inside Sunrise (crossed); returns its damage. */
function moonsurgeDamage(crossed: boolean, points: number): number {
  const { sim, player } = rig();
  const mob = targetMob(sim);
  player.autoAttack = false;
  player.auras.push(formAura(player));
  fillBank(sim, SKYFALL_ID, MOONTIDE_ID, points);
  if (crossed) openTidewheelWindow(ctx(sim), player, SUNRISE_ID);
  // Identical, non-critical, unresisted rolls in every arm, so the only
  // difference between them is the Tidecross and bank surplus multiplier.
  sim.rng.next = () => 0.5;
  sim.rng.chance = (chance) => chance > 0.5;
  player.resource = player.maxResource;
  player.gcdRemaining = 0;
  sim.drainEvents();
  sim.castAbility(MOONSURGE_ID);
  // Launched: the strike is still in flight, armed through the swap whenever
  // it carries a bonus (crossed, or spent past 3 points).
  expect(ctx(sim).pendingProjectiles.length).toBeGreaterThan(0);
  expect(hasWindow(player, MOONRISE_ID)).toBe(true);
  expect(stacks(player, MOONTIDE_ID)).toBe(0);
  expect(tidewheelPayoffCrossPending(player, MOONSURGE_ID, mob)).toBe(
    crossed || points > TIDE_PAYOFF_MIN_STACKS,
  );
  const events: SimEvent[] = sim.drainEvents();
  for (let tick = 0; tick < 60 && ctx(sim).pendingProjectiles.length > 0; tick++) {
    events.push(...sim.tick());
  }
  expect(ctx(sim).pendingProjectiles).toHaveLength(0);
  // Landed: the arm is spent.
  expect(tidewheelPayoffCrossPending(player, MOONSURGE_ID, mob)).toBe(false);
  let damage = 0;
  for (const event of events) {
    if (event.type === 'damage' && event.targetId === mob.id && event.ability === 'Moonsurge') {
      damage += event.amount;
    }
  }
  return damage;
}

describe('Tidewheel banks', () => {
  it('fills Suntide from Wildbolt and Moontide from Skyfall alone, only in Moonwing', () => {
    const { sim, player } = rig();
    completed(sim, WILDBOLT_ID);
    completed(sim, SKYFALL_ID);
    expect(stacks(player, SUNTIDE_ID)).toBe(0);
    expect(stacks(player, MOONTIDE_ID)).toBe(0);

    player.auras.push(formAura(player));
    completed(sim, WILDBOLT_ID);
    expect(stacks(player, SUNTIDE_ID)).toBe(1);
    expect(stacks(player, MOONTIDE_ID)).toBe(0);
    completed(sim, SKYFALL_ID);
    // The retired Moonseed no longer builds Moontide.
    completed(sim, 'moonseed');
    expect(stacks(player, SUNTIDE_ID)).toBe(1);
    expect(stacks(player, MOONTIDE_ID)).toBe(1);

    // Each bank caps at 5 points, past the payoffs' 3.
    expect(SUNTIDE_STAGES).toBe(5);
    expect(MOONTIDE_STAGES).toBe(5);
    expect(TIDE_PAYOFF_MIN_STACKS).toBe(3);
    for (let cast = 0; cast < 8; cast++) {
      completed(sim, WILDBOLT_ID);
      completed(sim, SKYFALL_ID);
    }
    expect(stacks(player, SUNTIDE_ID)).toBe(SUNTIDE_STAGES);
    expect(stacks(player, MOONTIDE_ID)).toBe(MOONTIDE_STAGES);
  });

  it('never turns a cast button into a payoff: Skyfall stays Skyfall at full banks', () => {
    const { sim, player } = rig();
    player.auras.push(formAura(player));
    for (let cast = 0; cast < SUNTIDE_STAGES; cast++) completed(sim, WILDBOLT_ID);
    for (let cast = 0; cast < MOONTIDE_STAGES; cast++) completed(sim, SKYFALL_ID);
    expect(stacks(player, SUNTIDE_ID)).toBe(SUNTIDE_STAGES);
    expect(stacks(player, MOONTIDE_ID)).toBe(MOONTIDE_STAGES);
    expect(sim.resolvedAbility(SKYFALL_ID)?.def.id).toBe(SKYFALL_ID);
    expect(sim.resolvedAbility(WILDBOLT_ID)?.def.id).toBe(WILDBOLT_ID);
  });
});

describe('Tidewheel payoff buttons', () => {
  it('gates Sunwake and Moonsurge on 3 points of their own bank, with no action replacement', () => {
    expect(ABILITIES[SKYFALL_ID].actionReplacement).toBeUndefined();
    for (const [payoff, bank] of [
      [SUNWAKE_ID, 'suntide'],
      [MOONSURGE_ID, 'moontide'],
    ] as const) {
      const def = ABILITIES[payoff];
      expect(isTidewheelPayoff(payoff)).toBe(true);
      expect(def.requiresAuraKind, payoff).toBe(bank);
      expect(def.requiresAuraStacks, payoff).toBe(TIDE_PAYOFF_MIN_STACKS);
      expect(def.requiresOwnAura, payoff).toBe(true);
      // The engine spends the bank with the window swap, never the cast gate.
      expect(def.consumesRequiredAura, payoff).toBe(false);
    }
    expect(isTidewheelPayoff(SKYFALL_ID)).toBe(false);
    expect(isTidewheelPayoff('moonseed')).toBe(false);
  });

  it('blocks only the payoffs, and only outside Moonwing Form', () => {
    const { player } = rig();
    expect(tidewheelPayoffBlocked(player, SUNWAKE_ID)).toBe(true);
    expect(tidewheelPayoffBlocked(player, MOONSURGE_ID)).toBe(true);
    expect(tidewheelPayoffBlocked(player, SKYFALL_ID)).toBe(false);
    player.auras.push(formAura(player));
    expect(tidewheelPayoffBlocked(player, SUNWAKE_ID)).toBe(false);
    expect(tidewheelPayoffBlocked(player, MOONSURGE_ID)).toBe(false);
  });

  it('refuses each payoff below 3 stacks and outside the form, and casts it at 3 in form', () => {
    const { sim, player } = rig();
    const mob = targetMob(sim);
    const form = formAura(player);
    player.auras.push(form);
    /** Presses the button; true when the cast gate refused it as not ready. */
    const refused = (abilityId: string): boolean => {
      player.resource = player.maxResource;
      player.gcdRemaining = 0;
      sim.drainEvents();
      sim.castAbility(abilityId);
      return sim
        .drainEvents()
        .some((e) => e.type === 'error' && e.text === 'That ability is not ready yet.');
    };
    for (const [payoff, builder, bank] of [
      [SUNWAKE_ID, WILDBOLT_ID, SUNTIDE_ID],
      [MOONSURGE_ID, SKYFALL_ID, MOONTIDE_ID],
    ] as const) {
      for (let cast = 0; cast < 2; cast++) completed(sim, builder);
      expect(stacks(player, bank), payoff).toBe(2);
      expect(refused(payoff), `${payoff} at 2`).toBe(true);
      expect(stacks(player, bank), payoff).toBe(2);

      completed(sim, builder);
      expect(stacks(player, bank), payoff).toBe(3);
      // A usable bank outlives the form, but the payoff does not fire outside it.
      player.auras = player.auras.filter((aura) => aura !== form);
      expect(refused(payoff), `${payoff} out of form`).toBe(true);
      expect(stacks(player, bank), payoff).toBe(3);

      player.auras.push(form);
      expect(refused(payoff), `${payoff} at 3 in form`).toBe(false);
      // The completed cast spent the bank (the strike itself is in flight).
      expect(stacks(player, bank), payoff).toBe(0);
      for (let tick = 0; tick < 10; tick++) sim.tick();
    }
    expect(mob.hp).toBeLessThan(mob.maxHp);
  });

  it('casts each payoff at 4 and 5 points too, and every cast spends the whole bank', () => {
    const { sim, player } = rig();
    targetMob(sim);
    player.auras.push(formAura(player));
    for (const [payoff, builder, bank] of [
      [SUNWAKE_ID, WILDBOLT_ID, SUNTIDE_ID],
      [MOONSURGE_ID, SKYFALL_ID, MOONTIDE_ID],
    ] as const) {
      for (const points of [4, 5]) {
        fillBank(sim, builder, bank, points);
        player.resource = player.maxResource;
        player.gcdRemaining = 0;
        sim.drainEvents();
        sim.castAbility(payoff);
        const refused = sim
          .drainEvents()
          .some((e) => e.type === 'error' && e.text === 'That ability is not ready yet.');
        expect(refused, `${payoff} at ${points}`).toBe(false);
        expect(stacks(player, bank), `${payoff} at ${points}`).toBe(0);
        for (let tick = 0; tick < 10; tick++) sim.tick();
      }
    }
  });
});

describe('Moonseed retirement', () => {
  it('keeps the def hidden and out of the druid kit, with both payoffs learned instead', () => {
    expect(ABILITIES.moonseed.hiddenFromPlayer).toBe(true);
    expect(ABILITIES.moonseed.actionReplacement).toBeUndefined();
    const kit = CLASSES.druid.abilities;
    expect(kit).not.toContain('moonseed');
    expect(kit).toContain(SUNWAKE_ID);
    expect(kit).toContain(MOONSURGE_ID);
    for (const payoff of [SUNWAKE_ID, MOONSURGE_ID]) {
      expect(ABILITIES[payoff].learnLevel, payoff).toBe(10);
      expect(ABILITIES[payoff].specs, payoff).toEqual(['balance']);
    }
    // A committed Moongrove knows both payoffs and not Moonseed.
    const { sim } = rig();
    expect(sim.resolvedAbility('moonseed')).toBeNull();
    expect(sim.resolvedAbility(SUNWAKE_ID)?.def.id).toBe(SUNWAKE_ID);
    expect(sim.resolvedAbility(MOONSURGE_ID)?.def.id).toBe(MOONSURGE_ID);
  });
});

describe('Tidecross', () => {
  it('crosses a payoff only inside the OTHER payoff window', () => {
    expect(TIDECROSS_PAYOFF_DMG_MULT).toBe(1.3);
    const { sim, player } = rig();
    expect(tidewheelCrossed(player, MOONSURGE_ID)).toBe(false);
    expect(tidewheelCrossed(player, SUNWAKE_ID)).toBe(false);
    openTidewheelWindow(ctx(sim), player, SUNRISE_ID);
    expect(tidewheelCrossed(player, MOONSURGE_ID)).toBe(true);
    expect(tidewheelCrossed(player, SUNWAKE_ID)).toBe(false);
    openTidewheelWindow(ctx(sim), player, MOONRISE_ID);
    expect(tidewheelCrossed(player, SUNWAKE_ID)).toBe(true);
    expect(tidewheelCrossed(player, MOONSURGE_ID)).toBe(false);
    // Only the payoffs cross: Skyfall in Moonrise is just Skyfall.
    expect(tidewheelCrossed(player, SKYFALL_ID)).toBe(false);
  });

  it('arms the in-flight strike before the cast swaps the window, and the impact spends it', () => {
    const { sim, player } = rig();
    const mob = targetMob(sim);
    player.auras.push(formAura(player));
    // Exactly 3 points: no bank surplus, so Tidecross is the whole bonus.
    fillBank(sim, SKYFALL_ID, MOONTIDE_ID, TIDE_PAYOFF_MIN_STACKS);
    openTidewheelWindow(ctx(sim), player, SUNRISE_ID);

    // The cast-completed hook arms Tidecross, then opens Moonrise (closing
    // Sunrise): the arm must outlive the swap its own cast caused.
    completed(sim, MOONSURGE_ID, mob);
    expect(hasWindow(player, MOONRISE_ID)).toBe(true);
    expect(hasWindow(player, SUNRISE_ID)).toBe(false);
    expect(tidewheelCrossed(player, MOONSURGE_ID)).toBe(false);
    expect(tidewheelPayoffCrossPending(player, MOONSURGE_ID, mob)).toBe(true);
    // Keyed to the strike's own target and payoff.
    expect(tidewheelPayoffCrossPending(player, SUNWAKE_ID, mob)).toBe(false);

    // The impact takes the bonus exactly once.
    expect(tidewheelPayoffMult(player, MOONSURGE_ID, mob)).toBe(TIDECROSS_PAYOFF_DMG_MULT);
    expect(tidewheelPayoffCrossPending(player, MOONSURGE_ID, mob)).toBe(false);
    expect(tidewheelPayoffMult(player, MOONSURGE_ID, mob)).toBe(1);
  });

  it('leaves an uncrossed payoff at 3 points at 1, including one cast inside its own window', () => {
    const { sim, player } = rig();
    const mob = targetMob(sim);
    player.auras.push(formAura(player));
    fillBank(sim, SKYFALL_ID, MOONTIDE_ID, TIDE_PAYOFF_MIN_STACKS);
    completed(sim, MOONSURGE_ID, mob);
    expect(tidewheelPayoffCrossPending(player, MOONSURGE_ID, mob)).toBe(false);
    expect(tidewheelPayoffMult(player, MOONSURGE_ID, mob)).toBe(1);
    // Moonrise is open now: a second Moonsurge is inside its OWN window.
    fillBank(sim, SKYFALL_ID, MOONTIDE_ID, TIDE_PAYOFF_MIN_STACKS);
    completed(sim, MOONSURGE_ID, mob);
    expect(tidewheelPayoffCrossPending(player, MOONSURGE_ID, mob)).toBe(false);
    expect(tidewheelPayoffMult(player, MOONSURGE_ID, mob)).toBe(1);
  });

  it('a Moonsurge cast during Sunrise lands 30 percent harder than the same strike uncrossed', () => {
    const plain = moonsurgeDamage(false, TIDE_PAYOFF_MIN_STACKS);
    const crossed = moonsurgeDamage(true, TIDE_PAYOFF_MIN_STACKS);
    expect(plain).toBeGreaterThan(0);
    // Rounded once per arm, so allow the two roundings' slack.
    expect(Math.abs(crossed - plain * TIDECROSS_PAYOFF_DMG_MULT)).toBeLessThanOrEqual(2);
  });
});

describe('Tidewheel bank surplus', () => {
  it('adds 20 percent per point past 3, up to the 5-point bank', () => {
    expect(TIDE_SURPLUS_DMG_PER_STACK).toBe(0.2);
    for (const points of [0, 1, 2, 3]) expect(tidewheelSurplusMult(points), `${points}`).toBe(1);
    expect(tidewheelSurplusMult(4)).toBeCloseTo(1.2, 10);
    expect(tidewheelSurplusMult(5)).toBeCloseTo(1.4, 10);
    // Capped at the bank size.
    expect(tidewheelSurplusMult(6)).toBeCloseTo(1.4, 10);
  });

  it('reads the bank each payoff spends, and only the druid own bank', () => {
    const { sim, player } = rig();
    player.auras.push(formAura(player));
    fillBank(sim, WILDBOLT_ID, SUNTIDE_ID, 4);
    fillBank(sim, SKYFALL_ID, MOONTIDE_ID, 2);
    expect(tidewheelPayoffBankStacks(player, SUNWAKE_ID)).toBe(4);
    expect(tidewheelPayoffBankStacks(player, MOONSURGE_ID)).toBe(2);
    expect(tidewheelPayoffBankStacks(player, SKYFALL_ID)).toBe(0);
    for (const aura of player.auras) {
      if (aura.id === SUNTIDE_ID) aura.sourceId = player.id + 1;
    }
    expect(tidewheelPayoffBankStacks(player, SUNWAKE_ID)).toBe(0);
  });

  it('arms the surplus through the cast-completed hook, so a strike landing after the spend keeps it', () => {
    for (const [payoff, builder, bank] of [
      [SUNWAKE_ID, WILDBOLT_ID, SUNTIDE_ID],
      [MOONSURGE_ID, SKYFALL_ID, MOONTIDE_ID],
    ] as const) {
      for (const [points, expected] of [
        [4, 1.2],
        [5, 1.4],
      ] as const) {
        const { sim, player } = rig();
        const mob = targetMob(sim);
        player.auras.push(formAura(player));
        fillBank(sim, builder, bank, points);
        completed(sim, payoff, mob);
        // The hook spent every point, then armed the in-flight strike.
        expect(stacks(player, bank), `${payoff} at ${points}`).toBe(0);
        expect(tidewheelPayoffCrossPending(player, payoff, mob), `${payoff} at ${points}`).toBe(
          true,
        );
        expect(tidewheelPayoffMult(player, payoff, mob), `${payoff} at ${points}`).toBeCloseTo(
          expected,
          10,
        );
        // Taken once.
        expect(tidewheelPayoffMult(player, payoff, mob), `${payoff} at ${points}`).toBe(1);
      }
    }
  });

  it('multiplies the surplus with Tidecross when the payoff is crossed', () => {
    for (const [payoff, builder, bank, crossWindow] of [
      [SUNWAKE_ID, WILDBOLT_ID, SUNTIDE_ID, MOONRISE_ID],
      [MOONSURGE_ID, SKYFALL_ID, MOONTIDE_ID, SUNRISE_ID],
    ] as const) {
      for (const points of [3, 4, 5]) {
        const { sim, player } = rig();
        const mob = targetMob(sim);
        player.auras.push(formAura(player));
        fillBank(sim, builder, bank, points);
        openTidewheelWindow(ctx(sim), player, crossWindow);
        completed(sim, payoff, mob);
        expect(tidewheelPayoffMult(player, payoff, mob), `${payoff} at ${points}`).toBeCloseTo(
          TIDECROSS_PAYOFF_DMG_MULT * tidewheelSurplusMult(points),
          10,
        );
      }
    }
  });

  it('teaches the 5-point banks and the from-3 payoffs in the player copy', () => {
    expect(ABILITIES[WILDBOLT_ID].specNotes?.balance).toContain(
      `adds 1 Suntide (max ${SUNTIDE_STAGES})`,
    );
    expect(ABILITIES[SKYFALL_ID].specNotes?.balance).toContain(
      `adds 1 Moontide (max ${MOONTIDE_STAGES})`,
    );
    for (const [payoff, bank] of [
      [MOONSURGE_ID, 'Moontide'],
      [SUNWAKE_ID, 'Suntide'],
    ] as const) {
      const text = ABILITIES[payoff].description;
      expect(text, payoff).toContain(`usable at ${TIDE_PAYOFF_MIN_STACKS} or more ${bank}`);
      expect(text, payoff).toContain(`Spends all your ${bank}`);
      expect(text, payoff).toContain(
        `${Math.round(TIDE_SURPLUS_DMG_PER_STACK * 100)}% more for each ${bank} past ${TIDE_PAYOFF_MIN_STACKS}`,
      );
    }
  });

  it('gives a strike with no travel the live surplus, and the hook then arms nothing more', () => {
    const { sim, player } = rig();
    const mob = targetMob(sim);
    player.auras.push(formAura(player));
    fillBank(sim, SKYFALL_ID, MOONTIDE_ID, 5);
    // The strike lands before the hook: it reads the live bank.
    expect(tidewheelPayoffMult(player, MOONSURGE_ID, mob)).toBeCloseTo(1.4, 10);
    completed(sim, MOONSURGE_ID, mob);
    expect(stacks(player, MOONTIDE_ID)).toBe(0);
    expect(tidewheelPayoffCrossPending(player, MOONSURGE_ID, mob)).toBe(false);
    expect(tidewheelPayoffMult(player, MOONSURGE_ID, mob)).toBe(1);
  });

  it('a real Moonsurge spent at 4 and 5 points lands 20 and 40 percent harder than at 3', () => {
    const atThree = moonsurgeDamage(false, 3);
    const atFour = moonsurgeDamage(false, 4);
    const atFive = moonsurgeDamage(false, 5);
    const crossedFive = moonsurgeDamage(true, 5);
    expect(atThree).toBeGreaterThan(0);
    // Rounded once per arm, so allow the two roundings' slack.
    expect(Math.abs(atFour - atThree * 1.2)).toBeLessThanOrEqual(2);
    expect(Math.abs(atFive - atThree * 1.4)).toBeLessThanOrEqual(2);
    expect(Math.abs(crossedFive - atThree * 1.4 * TIDECROSS_PAYOFF_DMG_MULT)).toBeLessThanOrEqual(
      2,
    );
  });
});

describe('Tidewheel payoffs', () => {
  function armedBoth() {
    const r = rig();
    const mob = targetMob(r.sim);
    r.player.auras.push(formAura(r.player));
    fillBank(r.sim, WILDBOLT_ID, SUNTIDE_ID, TIDE_PAYOFF_MIN_STACKS);
    fillBank(r.sim, SKYFALL_ID, MOONTIDE_ID, TIDE_PAYOFF_MIN_STACKS);
    return { ...r, mob };
  }

  it('Sunwake spends only Suntide, replants Stinging Swarm, and opens Sunrise', () => {
    const { sim, player, mob } = armedBoth();
    expect(ownDot(mob, player, STINGING_SWARM_ID)).toBeUndefined();

    completed(sim, 'sunlance', mob);

    expect(stacks(player, SUNTIDE_ID)).toBe(0);
    expect(stacks(player, MOONTIDE_ID)).toBe(TIDE_PAYOFF_MIN_STACKS);
    expect(ownDot(mob, player, STINGING_SWARM_ID)).toBeDefined();
    expect(hasWindow(player, SUNRISE_ID)).toBe(true);
    expect(hasWindow(player, MOONRISE_ID)).toBe(false);
    expect(player.auras.find((aura) => aura.id === SUNRISE_ID)?.remaining).toBe(
      TIDEWHEEL_WINDOW_SECONDS,
    );
    // Moonsurge stays usable: its own bank is untouched.
    expect(tidewheelPayoffBlocked(player, MOONSURGE_ID)).toBe(false);
  });

  it('Moonsurge spends only Moontide, replants Lunar Tempest, and opens Moonrise', () => {
    const { sim, player, mob } = armedBoth();
    expect(ownDot(mob, player, LUNAR_TEMPEST_ID)).toBeUndefined();

    completed(sim, 'moonlash', mob);

    expect(stacks(player, MOONTIDE_ID)).toBe(0);
    expect(stacks(player, SUNTIDE_ID)).toBe(TIDE_PAYOFF_MIN_STACKS);
    expect(ownDot(mob, player, LUNAR_TEMPEST_ID)).toBeDefined();
    expect(hasWindow(player, MOONRISE_ID)).toBe(true);
    expect(hasWindow(player, SUNRISE_ID)).toBe(false);
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
