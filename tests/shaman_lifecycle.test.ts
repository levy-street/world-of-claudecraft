import { describe, expect, it } from 'vitest';
import { depositMendingCurrent, mendingCurrent } from '../src/sim/combat/shaman_spiritmend';
import {
  FLOW_STATE_PROGRESS_ID,
  FLOW_STATE_READY_ID,
  SHAMAN_TALENT_STATE_DURATION,
} from '../src/sim/combat/shaman_talents';
import { addThunderCharges, THUNDER_CHARGES_ID } from '../src/sim/combat/shaman_thundercall';
import {
  applyStoneboundWardSmoothing,
  applyWarspiritPosture,
  GALEHEART_WEAPON_ID,
  STONEBOUND_WARD_SMOOTH_ID,
  STORMCAST_ID,
} from '../src/sim/combat/shaman_warspirit';
import type { TalentAllocation } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function allocation(spec: 'elemental' | 'enhancement' | 'restoration'): TalentAllocation {
  return { spec, rows: {} };
}

function player(sim: Sim, pid: number): Entity {
  const entity = sim.entities.get(pid);
  if (!entity) throw new Error('missing player');
  return entity;
}

function effectiveArmor(sim: Sim, entity: Entity): number {
  return (sim as unknown as { effectiveArmor(target: Entity): number }).effectiveArmor(entity);
}

describe('Shaman v0.29 state lifecycle', () => {
  it('clears Flow State progress and ready state when changing specialization', () => {
    const sim = new Sim({ seed: 2840, playerClass: 'shaman' });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('elemental')).toBe(true);
    for (const id of [FLOW_STATE_PROGRESS_ID, FLOW_STATE_READY_ID]) {
      sim.player.auras.push({
        id,
        name: 'Flow State',
        kind: 'internal_cd',
        value: id === FLOW_STATE_PROGRESS_ID ? 80 : 0,
        remaining: SHAMAN_TALENT_STATE_DURATION,
        duration: SHAMAN_TALENT_STATE_DURATION,
        sourceId: sim.player.id,
        school: 'nature',
      });
    }

    expect(sim.setSpec('restoration')).toBe(true);

    expect(
      sim.player.auras.some(
        (aura) => aura.id === FLOW_STATE_PROGRESS_ID || aura.id === FLOW_STATE_READY_ID,
      ),
    ).toBe(false);
  });

  it('clears every foreign spec engine on authoritative spec changes', () => {
    const sim = new Sim({ seed: 2841, playerClass: 'shaman' });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('elemental')).toBe(true);
    addThunderCharges(sim.ctx, sim.player, 4);
    expect(sim.player.auras.some((aura) => aura.id === THUNDER_CHARGES_ID)).toBe(true);

    expect(sim.setSpec('enhancement')).toBe(true);
    expect(sim.player.auras.some((aura) => aura.id === THUNDER_CHARGES_ID)).toBe(false);
    applyWarspiritPosture(sim.ctx, sim.player, 'galeheart');
    sim.player.auras.push({
      id: STORMCAST_ID,
      name: 'Stormcast',
      kind: 'next_cast_instant',
      value: 1,
      remaining: 12,
      duration: 12,
      sourceId: sim.player.id,
      school: 'nature',
      empowerAbilities: ['lightning_bolt'],
    });

    expect(sim.setSpec('restoration')).toBe(true);
    expect(sim.player.auras.some((aura) => aura.id === GALEHEART_WEAPON_ID)).toBe(false);
    expect(sim.player.auras.some((aura) => aura.id === STORMCAST_ID)).toBe(false);
  });

  it('removes baked armor, posture riders, and Pyrebrand before recomputing a new spec', () => {
    const sim = new Sim({ seed: 2845, playerClass: 'shaman', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('enhancement')).toBe(true);
    const baseArmor = effectiveArmor(sim, sim.player);
    applyWarspiritPosture(sim.ctx, sim.player, 'stonebound');
    applyStoneboundWardSmoothing(sim.ctx, sim.player, 'lightning_shield');
    sim.player.auras.push({
      id: 'flametongue_weapon',
      name: 'Pyrebrand Weapon',
      kind: 'imbue',
      value: 8,
      remaining: 300,
      duration: 300,
      sourceId: sim.player.id,
      school: 'fire',
    });
    expect(effectiveArmor(sim, sim.player)).toBeCloseTo(Math.round(baseArmor * 1.3), 5);
    expect(sim.player.auras.some((aura) => aura.id === STONEBOUND_WARD_SMOOTH_ID)).toBe(true);

    expect(sim.setSpec('restoration')).toBe(true);
    expect(effectiveArmor(sim, sim.player)).toBeCloseTo(baseArmor, 5);
    expect(sim.player.auras.some((aura) => aura.id === STONEBOUND_WARD_SMOOTH_ID)).toBe(false);
    expect(sim.player.auras.some((aura) => aura.id === 'flametongue_weapon')).toBe(false);
  });

  it('uses the same cleanup choke point for saved loadout switches', () => {
    const sim = new Sim({ seed: 2842, playerClass: 'shaman' });
    sim.setPlayerLevel(20);
    expect(sim.saveLoadout('Storm', [], allocation('elemental'))).toBe(0);
    addThunderCharges(sim.ctx, sim.player, 3);
    expect(sim.saveLoadout('Mend', [], allocation('restoration'))).toBe(1);
    expect(sim.player.auras.some((aura) => aura.id === THUNDER_CHARGES_ID)).toBe(false);

    const allyId = sim.addPlayer('warrior', 'Prepared');
    const ally = player(sim, allyId);
    depositMendingCurrent(sim.ctx, sim.player, ally, 200, 'tidecall');
    expect(mendingCurrent(ally, sim.player.id)).not.toBeNull();

    expect(sim.switchLoadout(0)).toBe(true);
    expect(mendingCurrent(ally, sim.player.id)).toBeNull();
    expect(sim.talents.spec).toBe('elemental');
  });

  it('removes remote currents on logout and restores no transient wrong-spec state', () => {
    const source = new Sim({ seed: 2843, playerClass: 'shaman', noPlayer: true });
    const healerId = source.addPlayer('shaman', 'Leaving');
    const allyId = source.addPlayer('warrior', 'Remaining');
    for (const pid of [healerId, allyId]) source.setPlayerLevel(20, pid);
    expect(source.setSpec('restoration', healerId)).toBe(true);
    const healer = player(source, healerId);
    const ally = player(source, allyId);
    depositMendingCurrent(source.ctx, healer, ally, 200, 'tidecall');
    const saved = source.serializeCharacter(healerId);
    expect(saved).not.toBeNull();

    source.removePlayer(healerId);
    expect(mendingCurrent(ally, healerId)).toBeNull();

    const restored = new Sim({ seed: 2844, playerClass: 'shaman', noPlayer: true });
    const restoredId = restored.addPlayer('shaman', 'Returning', { state: saved ?? undefined });
    expect(restored.meta(restoredId)?.talents.spec).toBe('restoration');
    expect(player(restored, restoredId).auras.some((aura) => aura.id.startsWith('shaman_'))).toBe(
      false,
    );
  });
});
