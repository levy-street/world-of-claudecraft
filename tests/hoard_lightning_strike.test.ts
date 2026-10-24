// Lightning Strike (src/sim/rift/hoard_lightning_strike.ts): the Storm Caller
// locks a player's position, warns for about a second, then hits whoever stands
// in the circle. One test per acceptance criterion of the owner's brief.
import { describe, expect, it } from 'vitest';
import { hoardCueAppearance } from '../src/render/hoard_boss_fx_core';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import { hoardBossCueViews } from '../src/sim/rift/hoard_boss';
import {
  HOARD_CAST_LIGHTNING_STRIKE,
  HOARD_LIGHTNING_STRIKE,
  hoardLightningStrikeCues,
  pointInLightningStrike,
  tickHoardLightningStrikes,
} from '../src/sim/rift/hoard_lightning_strike';
import { HOARD_RARITY_PRESSURE, HOARD_REFERENCE_HEALTH } from '../src/sim/rift/hoard_scaling';
import { riftStateEventFor } from '../src/sim/rift/runs';
import type { RiftInstance } from '../src/sim/rift/types';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent } from '../src/sim/types';

function makeRoom(): { sim: Sim; inst: RiftInstance; caller: Entity } {
  const sim = new Sim({ seed: 4411, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat('/dev god', sim.player.id);
  const portal = {
    ...sim.player,
    id: -1,
    vaultOwnerPid: sim.player.id,
    vaultRarity: 'epic' as const,
  };
  sim.enterRift(makeVaultSeed(2, 77), 22, sim.player.id, undefined, portal);
  const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
  if (!inst) throw new Error('missing hoard');
  // A Storm Caller of our own, so the test does not depend on the rolled theme.
  const caller = createMob(sim.ctx.nextId++, MOBS.rift_storm_caller, 20, {
    ...sim.player.pos,
    x: sim.player.pos.x + 8,
  });
  sim.ctx.addEntity(caller);
  inst.mobIds.push(caller.id);
  caller.aiState = 'attack';
  caller.aggroTargetId = sim.player.id;
  sim.drainEvents();
  return { sim, inst, caller };
}

function tick(sim: Sim, caller: Entity, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let elapsed = 0; elapsed < seconds - DT * 0.5; elapsed += DT) {
    caller.aiState = 'attack';
    tickHoardLightningStrikes(sim.ctx);
    events.push(...sim.drainEvents());
  }
  return events;
}

function openStrike(sim: Sim, inst: RiftInstance, caller: Entity) {
  tick(sim, caller, HOARD_LIGHTNING_STRIKE.firstDelaySec + DT);
  const [cue] = hoardLightningStrikeCues(inst);
  if (!cue || cue.kind !== 'mark') throw new Error('no strike placed');
  return cue;
}

describe('Storm Caller Lightning Strike', () => {
  it('exposes its tunables in one place and is a kickable cast', () => {
    // Never shorter than two seconds: there is always time to kick it or walk out.
    expect(HOARD_LIGHTNING_STRIKE.telegraphSec).toBeGreaterThanOrEqual(2);
    expect(HOARD_LIGHTNING_STRIKE.telegraphSec).toBeLessThanOrEqual(2.5);
    expect(HOARD_LIGHTNING_STRIKE.radius).toBeGreaterThan(2);
    expect(HOARD_LIGHTNING_STRIKE.damageFraction).toBeGreaterThan(0);
    expect(HOARD_LIGHTNING_STRIKE.cooldownSec).toBeGreaterThan(HOARD_LIGHTNING_STRIKE.telegraphSec);
    expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[HOARD_CAST_LIGHTNING_STRIKE]?.school).toBe('nature');
  });

  it('targets a living player and locks the circle on their position at once', () => {
    const { sim, inst, caller } = makeRoom();
    const before = tick(sim, caller, HOARD_LIGHTNING_STRIKE.firstDelaySec - 0.2);
    expect(before.some((event) => event.type === 'hoardBossCue')).toBe(false);
    const placedAt = { x: sim.player.pos.x, z: sim.player.pos.z };
    const placed = tick(sim, caller, 0.3);
    expect(placed).toContainEqual(
      expect.objectContaining({
        type: 'hoardBossCue',
        kind: 'mark',
        variant: 'storm-strike',
        x: placedAt.x,
        z: placedAt.z,
        radius: HOARD_LIGHTNING_STRIKE.radius,
        durationSecs: HOARD_LIGHTNING_STRIKE.telegraphSec,
      }),
    );
    expect(caller.castingAbility).toBe(HOARD_CAST_LIGHTNING_STRIKE);
    expect(caller.castTotal).toBe(HOARD_LIGHTNING_STRIKE.telegraphSec);
    // The painter draws it as a storm disc with a countdown: telegraph == hitbox.
    const [view] = hoardBossCueViews(inst);
    expect(view).toMatchObject({ variant: 'storm-strike', radius: HOARD_LIGHTNING_STRIKE.radius });
    expect(hoardCueAppearance(view)).toMatchObject({ shape: 'disc', countdown: 'disc' });
    // A reconnecting client gets the live circle back.
    expect(riftStateEventFor(sim.ctx, sim.player.id)?.hoardCues).toHaveLength(1);
  });

  it('never follows the player: walking out dodges it, and no damage lands early', () => {
    const { sim, inst, caller } = makeRoom();
    sim.chat('/dev god', sim.player.id);
    const cue = openStrike(sim, inst, caller);
    const locked = { x: cue.x, z: cue.z };
    const hpBefore = sim.player.hp;
    sim.player.pos = { ...sim.player.pos, x: sim.player.pos.x - 9 };
    tick(sim, caller, HOARD_LIGHTNING_STRIKE.telegraphSec * 0.6);
    expect({ x: cue.x, z: cue.z }).toEqual(locked);
    expect(sim.player.hp).toBe(hpBefore);
    const landed = tick(sim, caller, HOARD_LIGHTNING_STRIKE.telegraphSec * 0.5);
    expect(hoardLightningStrikeCues(inst)).toHaveLength(0);
    expect(sim.player.hp).toBe(hpBefore);
    // The bolt still lands on the stored spot.
    expect(landed).toContainEqual(
      expect.objectContaining({ type: 'spellfxAt', x: locked.x, z: locked.z }),
    );
    expect(caller.castingAbility).toBeNull();
  });

  it('hurts whoever is inside at impact, by the circle and nothing else', () => {
    const { sim, inst, caller } = makeRoom();
    sim.chat('/dev god', sim.player.id);
    const cue = openStrike(sim, inst, caller);
    // Step out, then back in just before it lands: position at impact decides.
    sim.player.pos = { ...sim.player.pos, x: cue.x + HOARD_LIGHTNING_STRIKE.radius + 2 };
    tick(sim, caller, HOARD_LIGHTNING_STRIKE.telegraphSec * 0.5);
    sim.player.pos = { ...sim.player.pos, x: cue.x + HOARD_LIGHTNING_STRIKE.radius - 0.2 };
    expect(pointInLightningStrike(cue, sim.player.pos)).toBe(true);
    const hpBefore = sim.player.hp;
    tick(sim, caller, HOARD_LIGHTNING_STRIKE.telegraphSec * 0.6);
    // Through the ordinary combat path, so armour-free nature damage near the
    // authored share of the reference health.
    const lost = hpBefore - sim.player.hp;
    expect(lost).toBeGreaterThan(
      HOARD_REFERENCE_HEALTH * HOARD_LIGHTNING_STRIKE.damageFraction * 0.5,
    );
    // An epic hoard: the authored share, pressed by the map's rarity.
    expect(lost).toBeLessThanOrEqual(
      Math.round(
        HOARD_REFERENCE_HEALTH *
          HOARD_LIGHTNING_STRIKE.damageFraction *
          HOARD_RARITY_PRESSURE.epic.damage,
      ),
    );
    expect(
      pointInLightningStrike(cue, { x: cue.x + HOARD_LIGHTNING_STRIKE.radius + 0.1, z: cue.z }),
    ).toBe(false);
  });

  it('respects its cooldown between strikes', () => {
    const { sim, inst, caller } = makeRoom();
    openStrike(sim, inst, caller);
    tick(sim, caller, HOARD_LIGHTNING_STRIKE.telegraphSec + 0.1);
    // The cooldown runs from the moment the circle was placed.
    const quiet = tick(
      sim,
      caller,
      HOARD_LIGHTNING_STRIKE.cooldownSec - HOARD_LIGHTNING_STRIKE.telegraphSec - 1.5,
    );
    expect(quiet.some((event) => event.type === 'hoardBossCue')).toBe(false);
    const again = tick(sim, caller, 2);
    expect(again.some((event) => event.type === 'hoardBossCue')).toBe(true);
  });

  for (const [label, cancel] of [
    ['an interrupt', (sim: Sim, caller: Entity) => sim.ctx.cancelCast(caller)],
    [
      'the caller dying',
      (_sim: Sim, caller: Entity) => {
        caller.hp = 0;
        caller.dead = true;
      },
    ],
    ['the caller despawning', (sim: Sim, caller: Entity) => sim.ctx.dropEntity(caller.id)],
  ] as const) {
    it(`withdraws the circle and deals nothing on ${label}`, () => {
      const { sim, inst, caller } = makeRoom();
      const cue = openStrike(sim, inst, caller);
      const hpBefore = sim.player.hp;
      cancel(sim, caller);
      tickHoardLightningStrikes(sim.ctx);
      const events = sim.drainEvents();
      expect(hoardLightningStrikeCues(inst)).toHaveLength(0);
      // The withdrawal reaches online clients as a zero-length replacement.
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'hoardBossCue', cueId: cue.id, durationSecs: 0 }),
      );
      for (let step = 0; step < 40; step++) tickHoardLightningStrikes(sim.ctx);
      expect(sim.player.hp).toBe(hpBefore);
      expect(sim.drainEvents().some((event) => event.type === 'spellfxAt')).toBe(false);
    });
  }

  it('withdraws the circle when the encounter resets', () => {
    const { sim, inst, caller } = makeRoom();
    openStrike(sim, inst, caller);
    caller.aiState = 'idle';
    tickHoardLightningStrikes(sim.ctx);
    expect(hoardLightningStrikeCues(inst)).toHaveLength(0);
    expect(caller.castingAbility).toBeNull();
  });

  it('stays silent outside a Buried Hoard', () => {
    const { sim, inst, caller } = makeRoom();
    inst.vault = null;
    const events = tick(sim, caller, 10);
    expect(events.some((event) => event.type === 'hoardBossCue')).toBe(false);
    expect(caller.castingAbility).toBeNull();
  });
});
