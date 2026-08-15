import { describe, expect, it } from 'vitest';
import { anchorProbeInOpenField } from '../scripts/probe_anchor';
import { BLOODHOOK_BLEED_ID, HUNTING_MOMENTUM_ID } from '../src/sim/combat/hunter_fieldcraft';
import { PACK_FEROCITY_AURA_ID } from '../src/sim/combat/hunter_packlord';
import { spawnFrostjawTrap } from '../src/sim/combat/hunter_trap';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type TestSim = Sim & {
  addEntity(entity: Entity): void;
  nextId: number;
};

function setup(): { sim: TestSim; hunter: Entity; target: Entity } {
  const sim = new Sim({ seed: 2960, playerClass: 'hunter', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec('survival')).toBe(true);
  // The v0.31 Eastbrook rebuild walled the spawn in: a 35-yard ranged cast from there is
  // rejected for want of line of sight. Anchor the fixture in the open field instead.
  anchorProbeInOpenField(sim);
  const target = createMob(sim.nextId++, MOBS.training_dummy, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 8,
  });
  target.hostile = true;
  target.maxHp = target.hp = 100_000;
  sim.addEntity(target);
  sim.targetEntity(target.id);
  return { sim, hunter: sim.player, target };
}

function seedTransientState(sim: TestSim, hunter: Entity, target: Entity): void {
  hunter.auras.push(
    {
      id: HUNTING_MOMENTUM_ID,
      name: 'Hunting Momentum',
      kind: 'hunter_momentum',
      remaining: 8,
      duration: 8,
      value: 3,
      stacks: 3,
      sourceId: hunter.id,
      school: 'physical',
    },
    {
      id: PACK_FEROCITY_AURA_ID,
      name: 'Pack Ferocity',
      kind: 'hunter_ferocity',
      remaining: 30,
      duration: 30,
      value: 3,
      stacks: 3,
      sourceId: hunter.id,
      school: 'physical',
    },
    {
      id: 'hunter_overdraw_counter',
      name: 'Overdraw',
      kind: 'internal_cd',
      remaining: 86_400,
      duration: 86_400,
      value: 2,
      stacks: 2,
      sourceId: hunter.id,
      school: 'physical',
    },
  );
  target.auras.push(
    {
      id: BLOODHOOK_BLEED_ID,
      name: 'Bloodhook Wound',
      kind: 'dot',
      remaining: 12,
      duration: 12,
      value: 12,
      tickInterval: 3,
      tickTimer: 3,
      sourceId: hunter.id,
      school: 'physical',
    },
    {
      id: `hunter_chain_mark_${hunter.id}`,
      name: 'Chain Reaction',
      kind: 'internal_cd',
      remaining: 8,
      duration: 8,
      value: 1,
      sourceId: hunter.id,
      school: 'physical',
    },
  );
  spawnFrostjawTrap(
    sim.ctx,
    hunter,
    {
      radius: 4,
      armTime: 1,
      lifetime: 30,
      rootDuration: 4,
      slowMult: 0.5,
      slowDuration: 4,
    },
    'Frostjaw Trap',
    'frostjaw_trap',
    25,
  );
}

function expectTransientStateCleared(sim: TestSim, hunter: Entity, target: Entity): void {
  expect(hunter.auras.some((aura) => aura.id === HUNTING_MOMENTUM_ID)).toBe(false);
  expect(hunter.auras.some((aura) => aura.id === PACK_FEROCITY_AURA_ID)).toBe(false);
  expect(hunter.auras.some((aura) => aura.id === 'hunter_overdraw_counter')).toBe(false);
  expect(target.auras.some((aura) => aura.sourceId === hunter.id)).toBe(false);
  expect(
    sim.ctx.groundAoEs.some((effect) => effect.hunterTrap && effect.sourceId === hunter.id),
  ).toBe(false);
}

describe('Hunter v0.29 state lifecycle', () => {
  it('cancels in-flight old-spec projectiles before a specialization change', () => {
    const { sim, hunter, target } = setup();
    expect(sim.setSpec('marksmanship')).toBe(true);
    target.pos.z = hunter.pos.z + 35;
    sim.rebucket(target);
    sim.targetEntity(target.id);
    hunter.resource = hunter.maxResource;
    const hpBefore = target.hp;

    sim.castAbility('measured_shot');
    for (let tick = 0; tick < 40 && sim.ctx.pendingProjectiles.length === 0; tick++) sim.tick();
    expect(sim.ctx.pendingProjectiles).toHaveLength(1);

    expect(sim.setSpec('survival')).toBe(true);
    expect(sim.ctx.pendingProjectiles).toHaveLength(0);
    for (let tick = 0; tick < 100; tick++) sim.tick();
    expect(target.hp).toBe(hpBefore);
  });

  it('uses the same cleanup path for saved loadout switches', () => {
    const { sim, hunter, target } = setup();
    expect(sim.saveLoadout('Fieldcraft', [], { spec: 'survival', rows: {} })).toBe(0);
    seedTransientState(sim, hunter, target);

    expect(sim.saveLoadout('Coldsight', [], { spec: 'marksmanship', rows: {} })).toBe(1);

    expect(sim.talents.spec).toBe('marksmanship');
    expectTransientStateCleared(sim, hunter, target);
  });

  it('clears local state, remote marks, wounds, and traps on death', () => {
    const { sim, hunter, target } = setup();
    seedTransientState(sim, hunter, target);

    (
      sim as unknown as {
        dealDamage(
          source: Entity | null,
          target: Entity,
          amount: number,
          crit: boolean,
          school: string,
          ability: string,
          kind: 'hit',
        ): void;
      }
    ).dealDamage(target, hunter, hunter.maxHp * 2, false, 'physical', 'Lifecycle Test', 'hit');

    expect(hunter.dead).toBe(true);
    expectTransientStateCleared(sim, hunter, target);
  });

  it('clears the same state before the disconnect save and reconnects cleanly', () => {
    const { sim, hunter, target } = setup();
    seedTransientState(sim, hunter, target);

    sim.preparePlayerLeave(hunter.id);
    expectTransientStateCleared(sim, hunter, target);
    const state = sim.serializeCharacter(hunter.id);
    if (!state) throw new Error('hunter state missing');

    const reconnected = new Sim({ seed: 2961, playerClass: 'hunter', noPlayer: true });
    const hunterId = reconnected.addPlayer('hunter', 'Returning Hunter', { state });
    const loaded = reconnected.entities.get(hunterId);
    if (!loaded) throw new Error('reconnected hunter missing');
    expect(reconnected.meta(hunterId)?.talents.spec).toBe('survival');
    expect(loaded.auras.some((aura) => aura.id.startsWith('hunter_'))).toBe(false);
  });
});
