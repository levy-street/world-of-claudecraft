// The heart seal crystal opens the way to the last boss ONLY once all four
// other bosses are defeated (the team's doc of 2026-11-17: "could explode on
// interact, revealing the TP to the last boss, once all 4 other bosses are
// defeated"; the owner's call of 2026-11-18 made the raid arriving on the dais
// the trigger, no press). Over a REAL Sim claim: with the Ring cleared, a
// living raider standing on the dais beside the crystal, every press a player
// has (the interact key, the pickup command), and the portal's own trigger
// tried, for EVERY boss left standing in turn (the Hammer Council counts only
// with BOTH its members down, so each half alone is tried too): the crystal
// stays whole, no portal bit, nobody reaches the Heart; the last kill bursts
// it that very tick with the raider still there.
// (tests/smith_heart_seal_crystal.test.ts pins the crystal itself: the wall,
// the circle, the bit's stickiness, the forced dev burst.)

import { afterEach, describe, expect, it } from 'vitest';
import {
  SMITH_HEART_COUNCIL,
  SMITH_HEART_DUNGEON,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_GUARDIANS,
  SMITH_HEART_PACKS,
} from '../src/sim/content/smith_heart';
import { HEART_ROOM, SEAL_CRYSTAL, SEAL_DAIS } from '../src/sim/content/smith_heart_layout';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { displacePlayerForDev } from '../src/sim/dev/dev_displace';
import {
  sealCrystalOf,
  smithHeartPortalBitSet,
  smithHeartProgress,
} from '../src/sim/encounters/smith_heart';
import { clearCombatWallStateForTest } from '../src/sim/instances/combat_wall_state';
import { clearDungeonGateStateForTest } from '../src/sim/instances/dungeon_gate_state';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const DUNGEON = DUNGEONS[SMITH_HEART_DUNGEON];
const SPAWNS = DUNGEON.spawns;
/** On the dais, just outside the crystal's wall. */
const DAIS_Z = -(SEAL_CRYSTAL.r + PLAYER_BODY_RADIUS + 1.5);

/** Every boss before the last, one template each (the council's two apart). */
const BOSSES: readonly string[] = [
  ...SMITH_HEART_COUNCIL,
  SMITH_HEART_GUARDIANS.breath,
  SMITH_HEART_GUARDIANS.quench,
  SMITH_HEART_GUARDIANS.heat,
];

function setup(): { sim: Sim; pid: number; inst: InstanceSlot } {
  const sim = new Sim({
    seed: 17,
    playerClass: 'warrior',
    noPlayer: true,
    world: WORLD,
    devCommands: true,
  });
  const pid = sim.addPlayer('warrior', 'Sealwalker');
  expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(true);
  const inst = sim.ctx.instances.find(
    (i) => i.dungeonId === SMITH_HEART_DUNGEON && i.partyKey !== null,
  ) as InstanceSlot;
  sim.tick();
  return { sim, pid, inst };
}

function kill(sim: Sim, inst: InstanceSlot, ids: readonly string[]): void {
  SPAWNS.forEach((s, i) => {
    if (!ids.includes(s.packId ?? '') && !ids.includes(s.mobId)) return;
    const mob = sim.ctx.entities.get(inst.mobIds[i]) as Entity;
    mob.hp = 0;
    mob.dead = true;
    mob.aiState = 'dead';
    mob.inCombat = false;
  });
}

function onDais(sim: Sim, pid: number, inst: InstanceSlot): Entity {
  const o = instanceOrigin(DUNGEON.index, inst.slot);
  const p = sim.ctx.entities.get(pid) as Entity;
  displacePlayerForDev(sim.ctx, p, o.x, o.z + DAIS_Z);
  return p;
}

/** How far the raider stands from the Heart's room (it never gets there
 *  while the crystal stands). */
function fromHeart(inst: InstanceSlot, p: Entity): number {
  const o = instanceOrigin(DUNGEON.index, inst.slot);
  return Math.hypot(p.pos.x - o.x - HEART_ROOM.x, p.pos.z - o.z - HEART_ROOM.z);
}

afterEach(() => {
  clearDungeonGateStateForTest();
  clearCombatWallStateForTest();
});

describe('the heart seal crystal: only all four bosses open the way to the last', () => {
  it('the dais trigger sits inside the dais, round the crystal', () => {
    expect(Math.abs(DAIS_Z)).toBeLessThan(SEAL_DAIS.r);
    expect(Math.abs(DAIS_Z)).toBeGreaterThan(SEAL_CRYSTAL.r);
    // The last boss is never one of the four.
    expect(BOSSES).not.toContain(SMITH_HEART_FINAL_BOSS);
  });

  for (const standing of BOSSES) {
    it(`with ${standing} still standing nothing opens, whatever the raider tries`, () => {
      const { sim, pid, inst } = setup();
      // The Ring cleared (its packs are no part of this question) and every
      // boss down but one.
      kill(sim, inst, [...SMITH_HEART_PACKS.ring, ...BOSSES.filter((b) => b !== standing)]);
      const p = onDais(sim, pid, inst);
      for (let i = 0; i < 60; i++) {
        // Every press a player has, every tick.
        sim.interact(pid);
        sim.pickUpObject(sealCrystalOf(sim.ctx, inst)?.id ?? -1, pid);
        sim.tick();
      }
      const prog = smithHeartProgress(sim.ctx, inst);
      expect(prog.sealLit, standing).toBe(false);
      expect(prog.ready, standing).toBe(false);
      expect(prog.portalOpen, standing).toBe(false);
      expect(sealCrystalOf(sim.ctx, inst), standing).not.toBeNull();
      // Into the crystal's middle (where the portal waits): pushed out, never
      // walked to the Heart.
      const o = instanceOrigin(DUNGEON.index, inst.slot);
      displacePlayerForDev(sim.ctx, p, o.x + 0.5, o.z);
      for (let i = 0; i < 20; i++) sim.tick();
      expect(fromHeart(inst, p), standing).toBeGreaterThan(60);
      // The last one falls: the raider on the dais bursts it that tick.
      onDais(sim, pid, inst);
      kill(sim, inst, [standing]);
      sim.tick();
      expect(smithHeartProgress(sim.ctx, inst).portalOpen, standing).toBe(true);
      expect(sealCrystalOf(sim.ctx, inst), standing).toBeNull();
    });
  }

  it('the bit stays off while any one of the four is alive, in every order of their falls', () => {
    const { sim, inst } = setup();
    kill(sim, inst, [...SMITH_HEART_PACKS.ring]);
    for (let n = 0; n < BOSSES.length; n++) {
      kill(sim, inst, [BOSSES[n]]);
      sim.tick();
      const prog = smithHeartProgress(sim.ctx, inst);
      expect(prog.ready, `${n + 1} down`).toBe(n === BOSSES.length - 1);
      // Nobody on the dais: charged at the last, still shut.
      expect(prog.portalOpen).toBe(false);
      expect(smithHeartPortalBitSet(0)).toBe(false);
    }
  });
});
