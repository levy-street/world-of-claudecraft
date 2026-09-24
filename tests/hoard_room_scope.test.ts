// Playtest fixes that belong to the Buried Hoard rooms ALONE: the shared rift
// mob records keep their authored kits, so ordinary Rifts are untouched.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { tickHoardBossMechanics } from '../src/sim/rift/hoard_boss';
import {
  HOARD_EVENT_HORIZON_EYE_RADIUS,
  HOARD_EVENT_HORIZON_RADIUS,
  hoardMarkSpec,
} from '../src/sim/rift/hoard_boss_kits';
import { suppressHoardStormShove } from '../src/sim/rift/hoard_storm_static';
import type { RiftInstance } from '../src/sim/rift/types';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, RUN_SPEED } from '../src/sim/types';

function hoardWith(bossTemplate: string): { sim: Sim; inst: RiftInstance; boss: Entity } {
  const sim = new Sim({ seed: 9324, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat('/dev god', sim.player.id);
  const portal = {
    ...sim.player,
    id: -1,
    vaultOwnerPid: sim.player.id,
    vaultRarity: 'epic' as const,
  };
  sim.enterRift(makeVaultSeed(3, 183), 23, sim.player.id, undefined, portal);
  const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
  if (!inst || inst.bossId === null) throw new Error('missing hoard');
  const boss = sim.entities.get(inst.bossId);
  if (!boss) throw new Error('missing boss');
  boss.templateId = bossTemplate;
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  sim.player.pos = { ...boss.pos, z: boss.pos.z - 6 };
  sim.drainEvents();
  return { sim, inst, boss };
}

describe('hoard-only playtest fixes', () => {
  it('Vysska and Xarreth lay no generic red marks in their rooms', () => {
    for (const template of ['rift_boss_venom', 'rift_boss_necro']) {
      const { sim, inst, boss } = hoardWith(template);
      for (let t = 0; t < 40 / DT; t++) {
        boss.aiState = 'attack';
        tickHoardBossMechanics(sim.ctx);
        expect(
          inst.hoardBoss?.cues.some((cue) => cue.variant === 'buried-mark'),
          template,
        ).toBe(false);
      }
    }
  });

  it('their shared records keep the death zones ordinary Rifts use', () => {
    expect(MOBS.rift_boss_venom.deathZoneCast).toBeDefined();
    expect(MOBS.rift_boss_necro.deathZoneCast).toBeDefined();
    expect(MOBS.rift_boss_necro.deathZoneStrike).toBeDefined();
    expect(MOBS.rift_stormscale.knockback).toBeDefined();
  });

  it("the storm drakes shove nobody in Vharok's room, and still do in a Rift", () => {
    const { sim, inst } = hoardWith('rift_boss_storm');
    const drake = createMob(sim.ctx.nextId++, MOBS.rift_stormscale, 20, { ...sim.player.pos });
    sim.ctx.addEntity(drake);
    expect(suppressHoardStormShove(sim.ctx, drake)).toBe(false);
    inst.mobIds.push(drake.id);
    expect(suppressHoardStormShove(sim.ctx, drake)).toBe(true);
  });

  it('Event Horizon can be left in its windup from anywhere inside it', () => {
    const spec = hoardMarkSpec('arcane-horizon');
    expect(spec.radius).toBe(HOARD_EVENT_HORIZON_RADIUS);
    // The worst spot is halfway between the eye's rim and the outer edge.
    const worst = (HOARD_EVENT_HORIZON_RADIUS - HOARD_EVENT_HORIZON_EYE_RADIUS) / 2;
    expect(worst / RUN_SPEED).toBeLessThan(spec.windup * 0.6);
    // And the Collapse that follows is still wider than the eye.
    expect(hoardMarkSpec('arcane-collapse').radius).toBeGreaterThan(HOARD_EVENT_HORIZON_EYE_RADIUS);
  });
});
