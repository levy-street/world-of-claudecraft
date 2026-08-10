import { describe, expect, it } from 'vitest';
import { druidEngineOnLandedStrike } from '../src/sim/combat/druid_engines';
import { onCastCompleted } from '../src/sim/combat/talent_procs';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

function aura(entity: Entity, kind: Aura['kind']): Aura {
  return {
    id: kind,
    name: kind,
    kind,
    remaining: 3600,
    duration: 3600,
    value: 0,
    sourceId: entity.id,
    school: 'nature',
  };
}

describe("Nature's Echo", () => {
  it('starts the next Moongrove phase with one stage after a payoff', () => {
    const sim = new Sim({ seed: 7, playerClass: 'druid', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(
      sim.applyTalents({
        spec: 'balance',
        rows: { 20: 'dru_r20_improved_hurricane' },
      }),
    ).toBe(true);
    const player = sim.player;
    player.auras.push(aura(player, 'form_moonkin'));
    const engineCtx = (
      sim as unknown as {
        ctx: Parameters<typeof onCastCompleted>[0];
      }
    ).ctx;
    for (let cast = 0; cast < 3; cast++) {
      onCastCompleted(engineCtx, player, 'wrath');
    }
    onCastCompleted(engineCtx, player, 'moonlash');

    // One Moontide bank: the chosen payoff reseeds it with the capstone.
    expect(player.auras.find((entry) => entry.id === 'moontide')?.stacks).toBe(1);
  });

  it('starts the next Wildfang bank with one stage after Redharvest', () => {
    const sim = new Sim({ seed: 7, playerClass: 'druid', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(
      sim.applyTalents({
        spec: 'feral',
        rows: { 20: 'dru_r20_improved_hurricane' },
      }),
    ).toBe(true);
    const player = sim.player;
    const engineCtx = (
      sim as unknown as {
        ctx: Parameters<typeof druidEngineOnLandedStrike>[0];
      }
    ).ctx;
    for (let strike = 0; strike < 3; strike++) {
      druidEngineOnLandedStrike(engineCtx, player, 'claw');
    }
    onCastCompleted(engineCtx, player, 'redharvest');

    expect(player.auras.find((entry) => entry.id === 'old_blood')?.stacks).toBe(1);
  });

  it('keeps the trained Galeheart ability name', () => {
    const sim = new Sim({ seed: 7, playerClass: 'druid', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.resolvedAbility('hurricane')?.def.name).toBe('Galeheart');
  });
});
