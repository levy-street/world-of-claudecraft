import { describe, expect, it, vi } from 'vitest';
import { runMobSwingAffixes } from '../src/sim/mob/mob_swing';
import { tickHoardBossMechanics } from '../src/sim/rift/hoard_boss';
import { HOARD_RARITY_PRESSURE, HOARD_REFERENCE_HEALTH } from '../src/sim/rift/hoard_scaling';
import {
  HOARD_STATIC_DAMAGE_FRACTION,
  HOARD_STATIC_RADIUS,
  startHoardStormStatic,
  tickHoardStormStaticCue,
} from '../src/sim/rift/hoard_storm_static';
import type { HoardBossCue } from '../src/sim/rift/types';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';

function encounter() {
  const sim = new Sim({ seed: 9321, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.enterRift(makeVaultSeed(3, 183), 23, sim.player.id, undefined, {
    ...sim.player,
    id: -1,
    vaultOwnerPid: sim.player.id,
    vaultRarity: 'legendary',
  });
  const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
  if (!inst || inst.bossId === null) throw new Error('missing Hoard');
  const boss = sim.entities.get(inst.bossId);
  if (!boss) throw new Error('missing boss');
  boss.templateId = 'rift_boss_storm';
  boss.aiState = 'attack';
  sim.player.pos = { ...boss.pos, z: boss.pos.z + 5 };
  tickHoardBossMechanics(sim.ctx);
  const state = inst.hoardBoss;
  if (!state) throw new Error('missing boss state');
  return { sim, inst, boss, state };
}

describe('Hoard Tempest static', () => {
  it('resolves clustered low-health players simultaneously despite the first death', () => {
    const { sim, inst, state } = encounter();
    const allyId = sim.addPlayer('warrior', 'Static Ally');
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing ally');
    inst.memberIds.add(allyId);
    ally.pos = { ...sim.player.pos };
    sim.player.hp = 1;
    ally.hp = 1;
    state.markTimer = 0;
    state.sequenceStep = 1;
    tickHoardBossMechanics(sim.ctx);
    for (let tick = 0; tick < 61; tick++) tickHoardBossMechanics(sim.ctx);
    expect(sim.player.dead).toBe(true);
    expect(ally.dead).toBe(true);
  });

  it('schedules moving warnings and resolves one hit each for a clustered party', () => {
    const { sim, inst, boss, state } = encounter();
    const allyId = sim.addPlayer('warrior', 'Static Ally');
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing ally');
    inst.memberIds.add(allyId);
    ally.pos = { ...sim.player.pos };
    state.markTimer = 0;
    state.sequenceStep = 1;
    sim.drainEvents();
    const damage = vi.spyOn(sim.ctx, 'dealDamage').mockReturnValue(0);
    tickHoardBossMechanics(sim.ctx);
    expect(state.cues.map((cue) => cue.variant)).toEqual(['storm-static', 'storm-static']);
    const warning = sim.drainEvents().filter((event) => event.type === 'hoardBossCue');
    expect(warning).toHaveLength(4);
    for (let tick = 0; tick < 59; tick++) tickHoardBossMechanics(sim.ctx);
    expect(damage).not.toHaveBeenCalled();
    for (let tick = 0; tick < 3; tick++) tickHoardBossMechanics(sim.ctx);
    expect(damage).toHaveBeenCalledTimes(2);
    expect(new Set(damage.mock.calls.map((call) => call[1].id))).toEqual(
      new Set([sim.player.id, allyId]),
    );
    expect(state.cues).toHaveLength(0);
    expect(boss.templateId).toBe('rift_boss_storm');
  });

  it('replaces only the Hoard melee shove and still draws its chance roll', () => {
    const { sim, inst, boss } = encounter();
    const chance = vi.spyOn(sim.rng, 'chance').mockReturnValue(true);
    const shove = vi.spyOn(sim.ctx, 'applyKnockback').mockReturnValue(9);
    runMobSwingAffixes(sim.ctx, boss, sim.player, { dealt: 1, crit: false, rawDmg: 1 });
    expect(chance).toHaveBeenCalled();
    expect(shove).not.toHaveBeenCalled();
    inst.vault = null;
    runMobSwingAffixes(sim.ctx, boss, sim.player, { dealt: 1, crit: false, rawDmg: 1 });
    expect(shove).toHaveBeenCalledWith(boss, sim.player, 9);
  });

  it('follows the marked player, allows spreading, and is harmless solo', () => {
    const { sim, inst, boss, state } = encounter();
    const emit = vi.fn();
    startHoardStormStatic(sim.ctx, inst, state, [sim.player], emit);
    const cue = state.cues[0] as Extract<HoardBossCue, { kind: 'mark' }>;
    expect(cue).toMatchObject({ targetId: sim.player.id, radius: 6, remaining: 3 });
    sim.player.pos.x += 2;
    const damage = vi.spyOn(sim.ctx, 'dealDamage').mockReturnValue(0);
    tickHoardStormStaticCue(sim.ctx, inst, boss, cue, [sim.player]);
    expect(cue.x).toBe(sim.player.pos.x);
    cue.remaining = 0;
    tickHoardStormStaticCue(sim.ctx, inst, boss, cue, [sim.player]);
    expect(damage).not.toHaveBeenCalled();
    const ally = {
      ...sim.player,
      id: 888,
      pos: { ...sim.player.pos, x: sim.player.pos.x + HOARD_STATIC_RADIUS + 0.01 },
    };
    tickHoardStormStaticCue(sim.ctx, inst, boss, cue, [sim.player, ally]);
    expect(damage).not.toHaveBeenCalled();
    ally.pos.x = sim.player.pos.x + HOARD_STATIC_RADIUS;
    tickHoardStormStaticCue(sim.ctx, inst, boss, cue, [sim.player, ally]);
    expect(damage).toHaveBeenCalledTimes(1);
    // A legendary hoard: the authored share, pressed by the map's rarity.
    expect(damage.mock.calls[0][2]).toBe(
      Math.round(
        HOARD_REFERENCE_HEALTH *
          HOARD_STATIC_DAMAGE_FRACTION *
          HOARD_RARITY_PRESSURE.legendary.damage,
      ),
    );
    expect(damage.mock.calls[0][2]).toBeLessThan(sim.player.maxHp);
  });
});
