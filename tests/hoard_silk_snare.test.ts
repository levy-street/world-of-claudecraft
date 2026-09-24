// Broodmother Vysska's Silk Snare (src/sim/rift/hoard_silk_snare.ts): a thread to
// every player that reels them in and hurts them until they get far enough away.
import { describe, expect, it } from 'vitest';
import { hoardMechanicBeats } from '../src/game/hoard_mechanic_audio_core';
import { hoardCueAppearance } from '../src/render/hoard_boss_fx_core';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import { HOARD_CAST_SILK_SNARE } from '../src/sim/rift/hoard_control_cast_ids';
import {
  SILK_SNARE,
  silkReel,
  silkSnared,
  tickHoardSilkSnare,
} from '../src/sim/rift/hoard_silk_snare';
import type { HoardBossCue, HoardBossState, RiftInstance } from '../src/sim/rift/types';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';

function vysskaRoom(): { sim: Sim; inst: RiftInstance; boss: Entity; state: HoardBossState } {
  const sim = new Sim({ seed: 9102, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat('/dev hoard spider', sim.player.id);
  const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
  if (!inst) throw new Error('missing hoard');
  const boss = inst.bossId === null ? undefined : sim.ctx.entities.get(inst.bossId);
  if (!boss) throw new Error('missing boss');
  expect(boss.templateId).toBe('rift_boss_venom');
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

const emit = (_ctx: unknown, _inst: RiftInstance, _cue: HoardBossCue) => {};

function tick(sim: Sim, inst: RiftInstance, boss: Entity, state: HoardBossState, seconds: number) {
  for (let elapsed = 0; elapsed < seconds - DT * 0.5; elapsed += DT) {
    boss.aiState = 'attack';
    tickHoardSilkSnare(sim.ctx, inst, boss, state, [sim.player], emit);
    sim.drainEvents();
  }
}

describe('Vysska silk snare', () => {
  it('is a kickable bar, drawn as a thread, with a voice', () => {
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[HOARD_CAST_SILK_SNARE]?.school).toBe('nature');
    expect(hoardCueAppearance({ variant: 'venom-silk', kind: 'sweep' } as never).shape).toBe(
      'tether',
    );
    expect(hoardMechanicBeats('venom-silk')?.length ?? 0).toBeGreaterThan(0);
    expect(SILK_SNARE.castSec).toBeGreaterThanOrEqual(2);
    expect(silkReel(10, 1)).toBeCloseTo(10 - SILK_SNARE.reelSpeed);
    expect(silkReel(1, 5)).toBe(SILK_SNARE.stopYards);
  });

  it('threads every player when the cast completes, reels them in and hurts them', () => {
    const { sim, inst, boss, state } = vysskaRoom();
    sim.player.pos = { ...boss.pos, z: boss.pos.z - 10 };
    tick(sim, inst, boss, state, SILK_SNARE.firstSec + DT);
    expect(boss.castingAbility).toBe(HOARD_CAST_SILK_SNARE);
    tick(sim, inst, boss, state, SILK_SNARE.castSec + DT);
    expect(boss.castingAbility).toBeNull();
    expect(silkSnared(state, sim.player.id)).toBe(true);
    const thread = state.cues.find((c) => c.variant === 'venom-silk');
    if (!thread || thread.kind !== 'sweep') throw new Error('no thread');
    expect(thread.radius).toBeCloseTo(10, 0);
    const hp = sim.player.hp;
    tick(sim, inst, boss, state, 1);
    const now = Math.hypot(sim.player.pos.x - boss.pos.x, sim.player.pos.z - boss.pos.z);
    expect(now).toBeLessThan(10 - SILK_SNARE.reelSpeed * 0.8);
    expect(sim.player.hp).toBeLessThan(hp);
    expect(thread.radius).toBeCloseTo(now, 0);
  });

  it('snaps when the player gets far enough from her, and comes round again', () => {
    const { sim, inst, boss, state } = vysskaRoom();
    sim.player.pos = { ...boss.pos, z: boss.pos.z - 8 };
    tick(sim, inst, boss, state, SILK_SNARE.firstSec + SILK_SNARE.castSec + 2 * DT);
    expect(silkSnared(state, sim.player.id)).toBe(true);
    sim.player.pos = { ...boss.pos, z: boss.pos.z - SILK_SNARE.breakYards - 2 };
    tick(sim, inst, boss, state, DT * 2);
    expect(silkSnared(state, sim.player.id)).toBe(false);
    expect(state.cues.some((c) => c.variant === 'venom-silk')).toBe(false);
    expect(state.silkSnare?.phase).toBe('idle');
  });

  it('a kick loses the snare for good', () => {
    const { sim, inst, boss, state } = vysskaRoom();
    sim.player.pos = { ...boss.pos, z: boss.pos.z - 8 };
    tick(sim, inst, boss, state, SILK_SNARE.firstSec + DT);
    sim.ctx.cancelCast(boss);
    tick(sim, inst, boss, state, SILK_SNARE.castSec + 1);
    expect(silkSnared(state, sim.player.id)).toBe(false);
    expect(state.silkSnare?.timer).toBeGreaterThan(SILK_SNARE.everySec - SILK_SNARE.castSec - 2);
  });
});
