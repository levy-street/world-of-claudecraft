// Warlord Grask's Charge (src/sim/rift/hoard_charge.ts): he fixes on whoever holds
// him, turns after them through the aim, then runs the lane; a wall stuns him.
import { describe, expect, it } from 'vitest';
import { hoardMechanicBeats } from '../src/game/hoard_mechanic_audio_core';
import { hoardCueAppearance } from '../src/render/hoard_boss_fx_core';
import { devHoardDestination } from '../src/sim/dev/hoard_travel';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import { HOARD_BOULDER_STAGGER_AURA_ID } from '../src/sim/rift/hoard_boulder_core';
import {
  CHARGE,
  chargeEndsInWall,
  chargeReach,
  pointInChargeLane,
  tickHoardCharge,
} from '../src/sim/rift/hoard_charge';
import { HOARD_CAST_CHARGE } from '../src/sim/rift/hoard_control_cast_ids';
import type { HoardBossCue, HoardBossState, RiftInstance } from '../src/sim/rift/types';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';

function graskRoom(): { sim: Sim; inst: RiftInstance; boss: Entity; state: HoardBossState } {
  const sim = new Sim({ seed: 9101, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat('/dev god', sim.player.id);
  sim.chat('/dev hoard grask', sim.player.id);
  const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
  if (!inst) throw new Error('missing hoard');
  const boss = inst.bossId === null ? undefined : sim.ctx.entities.get(inst.bossId);
  if (!boss) throw new Error('missing boss');
  expect(boss.templateId).toBe('rift_boss_brute');
  for (const id of inst.mobIds) {
    const mob = sim.ctx.entities.get(id);
    if (mob && id !== boss.id) {
      mob.hp = 0;
      mob.dead = true;
    }
  }
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  inst.hoardBoss ??= {
    cues: [],
    nextCueId: 1,
    sequenceStep: 0,
  } as unknown as HoardBossState;
  const state = inst.hoardBoss;
  sim.drainEvents();
  return { sim, inst, boss, state };
}

const emitted: HoardBossCue[] = [];
const emit = (_ctx: unknown, _inst: RiftInstance, cue: HoardBossCue) => {
  emitted.push({ ...cue });
};

function tick(sim: Sim, inst: RiftInstance, boss: Entity, state: HoardBossState, seconds: number) {
  for (let elapsed = 0; elapsed < seconds - DT * 0.5; elapsed += DT) {
    boss.aiState = 'attack';
    tickHoardCharge(sim.ctx, inst, boss, state, [sim.player], emit);
    sim.drainEvents();
  }
}

describe('Grask charge', () => {
  it('is read, never kicked, drawn as a lane, and has a voice', () => {
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[HOARD_CAST_CHARGE]).toBeUndefined();
    expect(hoardCueAppearance({ variant: 'brute-charge', kind: 'sweep' } as never).shape).toBe(
      'sector',
    );
    expect(hoardMechanicBeats('brute-charge')?.length ?? 0).toBeGreaterThan(0);
    expect(devHoardDestination('grask')).not.toBeNull();
  });

  it('aims at whoever holds him and keeps turning after them, the lane ending at the wall', () => {
    const { sim, inst, boss, state } = graskRoom();
    sim.player.pos = { ...boss.pos, z: boss.pos.z - 12 };
    tick(sim, inst, boss, state, CHARGE.firstSec + DT);
    expect(boss.castingAbility).toBe(HOARD_CAST_CHARGE);
    expect(boss.castTargetId).toBe(sim.player.id);
    const cue = state.cues.find((c) => c.variant === 'brute-charge');
    if (!cue || cue.kind !== 'sweep') throw new Error('no charge lane');
    expect(Math.abs(cue.facing - Math.PI)).toBeLessThan(0.05);
    expect(cue.radius).toBeGreaterThan(5);
    // The tank walks round to his side: the lane follows.
    sim.player.pos = { ...boss.pos, x: boss.pos.x - 12 };
    tick(sim, inst, boss, state, 0.5);
    expect(Math.abs(cue.facing + Math.PI / 2)).toBeLessThan(0.05);
    expect(pointInChargeLane(boss.pos, cue.facing, cue.radius, sim.player.pos)).toBe(true);
  });

  it('runs the lane, bowls over whoever is in it, and reels when it ends in a wall', () => {
    const { sim, inst, boss, state } = graskRoom();
    // Down the room toward the entrance: a long lane that dies out on open floor first.
    sim.player.pos = { ...boss.pos, z: boss.pos.z - 10 };
    const reachOpen = chargeReach(inst, boss.pos, Math.PI);
    // Straight at the side wall: a short lane that ends in rock.
    const reachWall = chargeReach(inst, boss.pos, Math.PI / 2);
    expect(reachWall).toBeLessThan(reachOpen);
    expect(chargeEndsInWall(reachWall)).toBe(true);
    // The tank stands between him and the side wall.
    sim.player.pos = { ...boss.pos, x: boss.pos.x + Math.min(6, reachWall - 2) };
    // God mode got us in; it would also swallow the hit.
    sim.chat('/dev god', sim.player.id);
    const start = { ...boss.pos };
    tick(sim, inst, boss, state, CHARGE.firstSec + CHARGE.aimSec + DT);
    expect(boss.castingAbility).toBeNull();
    const hpBefore = sim.player.hp;
    tick(sim, inst, boss, state, reachWall / CHARGE.speed + 0.3);
    expect(boss.pos.x - start.x).toBeGreaterThan(reachWall - 1);
    expect(sim.player.hp).toBeLessThan(hpBefore);
    expect(boss.auras.some((aura) => aura.id === HOARD_BOULDER_STAGGER_AURA_ID)).toBe(true);
    expect(state.cues.some((c) => c.variant === 'brute-charge')).toBe(false);
  });

  it('dies out on open floor with no stun, and comes round again', () => {
    const { sim, inst, boss, state } = graskRoom();
    sim.player.pos = { ...boss.pos, z: boss.pos.z - 30 };
    tick(
      sim,
      inst,
      boss,
      state,
      CHARGE.firstSec + CHARGE.aimSec + CHARGE.maxYards / CHARGE.speed + 0.5,
    );
    expect(boss.auras.some((aura) => aura.id === HOARD_BOULDER_STAGGER_AURA_ID)).toBe(false);
    expect(state.charge?.phase).toBe('idle');
    expect(state.charge?.timer).toBeGreaterThan(CHARGE.everySec - 1);
  });
});
