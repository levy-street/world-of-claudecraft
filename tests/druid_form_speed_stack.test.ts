import { describe, expect, it } from 'vitest';
import { LOPING_STRIDE_SPEED } from '../src/sim/combat/druid_engines';
import { ABILITIES } from '../src/sim/data';
import { moveSpeedMult } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import { CAT_FORM_MOVE_MULT, type Entity } from '../src/sim/types';

// Player report (v0.44.0): "Dash and Loping Stride SET the movement speed
// instead of increasing it". Cat Form is a passive +15% (CAT_FORM_MOVE_MULT)
// and Dash is a Cat-only +50% sprint, so the two must multiply: a Cat that
// Dashes runs at 1.15 x 1.5, not 1.5. Temporary speed BUFFS still follow the
// classic-era rule among themselves: the strongest applies, they never stack.

const DASH_MULT = (ABILITIES.dash.effects[0] as { value: number }).value;

function rig() {
  const sim = new Sim({ seed: 29, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: 'feral', rows: {} })).toBe(true);
  const player = sim.player;
  player.resource = player.maxResource;
  return { sim, player };
}

function cast(sim: Sim, abilityId: string): void {
  sim.player.gcdRemaining = 0;
  sim.castAbility(abilityId);
  sim.tick();
}

function dropAura(entity: Entity, id: string): void {
  entity.auras = entity.auras.filter((a) => a.id !== id);
}

describe('Cat Form passive speed stacks with the strongest speed buff', () => {
  it('Loping Stride on the Cat Form shift multiplies the form passive (+60% on +15%)', () => {
    const { sim, player } = rig();
    cast(sim, 'cat_form');
    expect(player.auras.some((a) => a.id === 'loping_stride')).toBe(true);
    expect(moveSpeedMult(player)).toBeCloseTo(CAT_FORM_MOVE_MULT * LOPING_STRIDE_SPEED); // 1.84
  });

  it('Dash in Cat Form multiplies the form passive (+50% on +15%)', () => {
    const { sim, player } = rig();
    cast(sim, 'cat_form');
    dropAura(player, 'loping_stride');
    expect(moveSpeedMult(player)).toBeCloseTo(CAT_FORM_MOVE_MULT);
    cast(sim, 'dash');
    expect(player.auras.some((a) => a.id === 'dash')).toBe(true);
    expect(moveSpeedMult(player)).toBeCloseTo(CAT_FORM_MOVE_MULT * DASH_MULT); // 1.725
  });

  it('Dash and Loping Stride do not stack with each other: the strongest buff wins', () => {
    const { sim, player } = rig();
    cast(sim, 'cat_form');
    cast(sim, 'dash');
    expect(player.auras.some((a) => a.id === 'loping_stride')).toBe(true);
    expect(player.auras.some((a) => a.id === 'dash')).toBe(true);
    const strongest = Math.max(LOPING_STRIDE_SPEED, DASH_MULT);
    expect(moveSpeedMult(player)).toBeCloseTo(CAT_FORM_MOVE_MULT * strongest); // 1.84
    // The stride expires; Dash carries on at its own rate over the passive.
    dropAura(player, 'loping_stride');
    expect(moveSpeedMult(player)).toBeCloseTo(CAT_FORM_MOVE_MULT * DASH_MULT);
  });

  it('a slow still bites the whole stacked speed multiplicatively', () => {
    const { sim, player } = rig();
    cast(sim, 'cat_form');
    dropAura(player, 'loping_stride');
    cast(sim, 'dash');
    player.auras.push({
      id: 'test_slow',
      name: 'Slow',
      kind: 'slow',
      remaining: 5,
      duration: 5,
      value: 0.5,
      sourceId: 0,
      school: 'frost',
    } as Entity['auras'][number]);
    expect(moveSpeedMult(player)).toBeCloseTo(0.5 * CAT_FORM_MOVE_MULT * DASH_MULT);
  });

  it('Fleet Form is its own form speed and is unchanged by the Cat rule', () => {
    const { sim, player } = rig();
    cast(sim, 'travel_form');
    dropAura(player, 'loping_stride');
    expect(player.auras.some((a) => a.kind === 'form_cat')).toBe(false);
    expect(moveSpeedMult(player)).toBeCloseTo(1.4);
  });
});
