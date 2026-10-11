// Fair crowd control inside a Buried Hoard (src/sim/rift/hoard_control_casts.ts):
// a fear, stun, silence or hex a hoard mob would land instantly becomes a real,
// interruptible cast, and lands only if the bar completes. Outside a hoard the
// same procs land at once, exactly as before.
import { describe, expect, it } from 'vitest';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import {
  buriedHoardOf,
  deferHoardControlAura,
  deferHoardTerrify,
  HOARD_CAST_FEAR,
  HOARD_CAST_HEX,
  HOARD_CAST_SILENCE,
  HOARD_CAST_STUN,
  HOARD_CONTROL_AOE_CAST_SEC,
  HOARD_CONTROL_CAST_SEC,
  HOARD_CONTROL_FEAR_CAST_SEC,
  HOARD_DROPPED_CONTROLS,
  tickHoardControlCasts,
} from '../src/sim/rift/hoard_control_casts';
import type { RiftInstance } from '../src/sim/rift/types';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import { type Aura, DT, type Entity } from '../src/sim/types';

function makeHoard(): { sim: Sim; inst: RiftInstance; boss: Entity; trash: Entity } {
  const sim = new Sim({ seed: 9321, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  const portal = {
    ...sim.player,
    id: -1,
    vaultOwnerPid: sim.player.id,
    vaultRarity: 'epic' as const,
  };
  sim.enterRift(makeVaultSeed(2, 77), 22, sim.player.id, undefined, portal);
  const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
  if (!inst || inst.bossId === null) throw new Error('missing hoard');
  const boss = sim.entities.get(inst.bossId);
  const trashId = inst.mobIds.find((id) => id !== inst.bossId);
  const trash = trashId === undefined ? undefined : sim.entities.get(trashId);
  if (!boss || !trash) throw new Error('missing hoard mobs');
  sim.drainEvents();
  return { sim, inst, boss, trash };
}

const STUN: Aura = {
  id: 'concuss_test',
  name: 'Thunderclap',
  kind: 'stun',
  remaining: 1.5,
  duration: 1.5,
  value: 0,
  sourceId: 0,
  school: 'physical',
};

function tickCasts(sim: Sim, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds + DT * 0.5; elapsed += DT) tickHoardControlCasts(sim.ctx);
}

describe('hoard control casts', () => {
  it('registers every control cast as interruptible by a school lockout', () => {
    for (const castId of [HOARD_CAST_FEAR, HOARD_CAST_STUN, HOARD_CAST_SILENCE, HOARD_CAST_HEX]) {
      const entry = SCRIPTED_INTERRUPTIBLE_CHANNELS[castId];
      expect(entry, castId).toBeDefined();
      // A physical school would read as immune to the interrupt effect.
      expect(entry.school, castId).not.toBe('physical');
    }
  });

  it('turns an on-hit stun into a cast bar that lands only on completion', () => {
    const { sim, inst, trash } = makeHoard();
    expect(buriedHoardOf(sim.ctx, trash)).toBe(inst);
    expect(deferHoardControlAura(sim.ctx, trash, sim.player, { ...STUN, sourceId: trash.id })).toBe(
      true,
    );
    expect(trash.castingAbility).toBe(HOARD_CAST_STUN);
    expect(trash.castTotal).toBe(HOARD_CONTROL_CAST_SEC);
    expect(trash.castTargetId).toBe(sim.player.id);
    expect(sim.player.auras.some((aura) => aura.kind === 'stun')).toBe(false);

    tickCasts(sim, HOARD_CONTROL_CAST_SEC - 0.2);
    expect(sim.player.auras.some((aura) => aura.kind === 'stun')).toBe(false);
    tickCasts(sim, 0.3);
    expect(trash.castingAbility).toBeNull();
    expect(trash.hoardControlCast).toBeUndefined();
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ kind: 'stun', name: 'Thunderclap' }),
    );
  });

  it('gives a fear the slowest bar: more time to kick what takes a player out', () => {
    const { sim, trash } = makeHoard();
    deferHoardControlAura(sim.ctx, trash, sim.player, {
      ...STUN,
      kind: 'incapacitate',
      sourceId: trash.id,
    });
    expect(trash.castingAbility).toBe(HOARD_CAST_FEAR);
    expect(trash.castTotal).toBe(HOARD_CONTROL_FEAR_CAST_SEC);
    expect(HOARD_CONTROL_FEAR_CAST_SEC).toBeGreaterThan(HOARD_CONTROL_CAST_SEC);
    expect(HOARD_CONTROL_AOE_CAST_SEC).toBeGreaterThan(HOARD_CONTROL_FEAR_CAST_SEC);
    expect(HOARD_CONTROL_AOE_CAST_SEC).toBeGreaterThanOrEqual(3);
  });

  it('never gives a hoard caster a bar shorter than two seconds', () => {
    expect(HOARD_CONTROL_CAST_SEC).toBeGreaterThanOrEqual(2);
  });

  it('drops the stun of Tempest Vharok outright inside a hoard', () => {
    const { sim, boss } = makeHoard();
    boss.templateId = 'rift_boss_storm';
    expect(deferHoardControlAura(sim.ctx, boss, sim.player, { ...STUN, sourceId: boss.id })).toBe(
      true,
    );
    expect(boss.castingAbility).toBeNull();
    expect(boss.hoardControlCast).toBeUndefined();
    tickCasts(sim, 4);
    expect(sim.player.auras.some((aura) => aura.kind === 'stun')).toBe(false);
    // His other controls, and everyone else's stun, are untouched.
    expect(HOARD_DROPPED_CONTROLS.rift_boss_storm).toEqual(['stun']);
    expect(HOARD_DROPPED_CONTROLS.rift_storm_caller).toBeUndefined();
  });

  it('an interrupt drops the control for good', () => {
    const { sim, trash } = makeHoard();
    deferHoardControlAura(sim.ctx, trash, sim.player, { ...STUN, sourceId: trash.id });
    tickCasts(sim, 0.5);
    // What every interrupt effect does to a scripted cast (effect_dispatch.ts).
    sim.ctx.cancelCast(trash);
    expect(trash.castingAbility).toBeNull();
    tickCasts(sim, HOARD_CONTROL_CAST_SEC + 0.5);
    expect(trash.hoardControlCast).toBeUndefined();
    expect(sim.player.auras.some((aura) => aura.kind === 'stun')).toBe(false);
  });

  it('a mob already mid-cast loses a second proc instead of stacking bars', () => {
    const { sim, trash } = makeHoard();
    deferHoardControlAura(sim.ctx, trash, sim.player, { ...STUN, sourceId: trash.id });
    const pending = trash.hoardControlCast;
    expect(
      deferHoardControlAura(sim.ctx, trash, sim.player, {
        ...STUN,
        kind: 'silence',
        sourceId: trash.id,
      }),
    ).toBe(true);
    expect(trash.hoardControlCast).toBe(pending);
    expect(trash.castingAbility).toBe(HOARD_CAST_STUN);
  });

  it('casts the room-wide terrify, sparing the tank, and lands it as a fear', () => {
    const { sim, boss } = makeHoard();
    boss.aggroTargetId = null;
    sim.player.pos = { ...boss.pos, z: boss.pos.z + 4 };
    expect(
      deferHoardTerrify(sim.ctx, boss, { radius: 12, duration: 2, name: "Warlord's Bellow" }),
    ).toBe(true);
    expect(boss.castingAbility).toBe(HOARD_CAST_FEAR);
    expect(boss.castTotal).toBe(HOARD_CONTROL_AOE_CAST_SEC);
    tickCasts(sim, HOARD_CONTROL_AOE_CAST_SEC + 0.1);
    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({ id: 'fear_incap', name: "Warlord's Bellow" }),
    );

    // The boss's own target holds their ground, as in the instant version.
    const tanked = makeHoard();
    tanked.boss.aggroTargetId = tanked.sim.player.id;
    tanked.sim.player.pos = { ...tanked.boss.pos, z: tanked.boss.pos.z + 4 };
    deferHoardTerrify(tanked.sim.ctx, tanked.boss, { radius: 12, duration: 2, name: 'Bellow' });
    tickCasts(tanked.sim, HOARD_CONTROL_AOE_CAST_SEC + 0.1);
    expect(tanked.sim.player.auras.some((aura) => aura.id === 'fear_incap')).toBe(false);
  });

  it('a mob killed mid-cast never lands its control', () => {
    const { sim, trash } = makeHoard();
    deferHoardControlAura(sim.ctx, trash, sim.player, { ...STUN, sourceId: trash.id });
    trash.hp = 0;
    trash.dead = true;
    tickCasts(sim, HOARD_CONTROL_CAST_SEC + 0.5);
    expect(trash.hoardControlCast).toBeUndefined();
    expect(sim.player.auras.some((aura) => aura.kind === 'stun')).toBe(false);
  });

  it('leaves mobs outside a Buried Hoard exactly as they were: instant', () => {
    const sim = new Sim({ seed: 5, playerClass: 'warrior', devCommands: true });
    sim.chat('/dev level 20', sim.player.id);
    sim.enterRift(424242, 20, sim.player.id);
    const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
    const mob = inst ? sim.entities.get(inst.mobIds[0]) : undefined;
    if (!mob) throw new Error('missing rift mob');
    expect(inst?.vault).toBeNull();
    expect(buriedHoardOf(sim.ctx, mob)).toBeNull();
    expect(deferHoardControlAura(sim.ctx, mob, sim.player, { ...STUN, sourceId: mob.id })).toBe(
      false,
    );
    expect(deferHoardTerrify(sim.ctx, mob, { radius: 12, duration: 2, name: 'Wail' })).toBe(false);
    expect(mob.castingAbility).toBeNull();
  });
});
