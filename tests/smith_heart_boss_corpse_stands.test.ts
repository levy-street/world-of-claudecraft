import { describe, expect, it } from 'vitest';
import { isVisuallyDead } from '../src/render/anim_state';
import { entityViewIsAdmitted, entityViewShouldDrop } from '../src/render/entity_view_policy_core';
import type { QuestObjectGate } from '../src/render/quest_object_gate_core';
import { SMITH_HEART_DUNGEON, SMITH_HEART_FINAL_BOSS } from '../src/sim/content/smith_heart';
import { SMITH_HEART_BOSS_SPOTS } from '../src/sim/content/smith_heart_layout';
import { corpseCanInteract } from '../src/sim/corpse_interaction';
import {
  DUNGEON_X_THRESHOLD,
  DUNGEONS,
  instanceOrigin,
  MOBS,
  riftInstanceOrigin,
} from '../src/sim/data';
import { deadTargetSelectable } from '../src/sim/dead_target';
import { createMob } from '../src/sim/entity';
import { corpseStandsUntilTeardown } from '../src/sim/mob/boss_corpse_hold';
import { corpseHasDecayed } from '../src/sim/respawn_policy';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type QuestProgress } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

// A slain Smith's Heart boss is part of the room, not a loot bag (Jose,
// 2026-11-20): the Masterless Strength dies kneeling as a broken stone husk and
// the guardians in their own death poses, and the body must stay standing after
// it is looted, until the instance itself is torn down. The bug this pins:
// pruneCorpseLoot collapsed an emptied boss corpse on the four-second fast arm,
// the corpse then read as decayed, and the view policy dropped the body on every
// client, so the husk vanished the moment its loot was taken.

type SimInternals = {
  entities: Map<number, Entity>;
  players: Map<number, PlayerMeta>;
  addEntity(e: Entity): void;
};

const RAID = DUNGEONS[SMITH_HEART_DUNGEON];
const RAID_ORIGIN = instanceOrigin(RAID.index, 0);
const FINAL_POS = {
  x: RAID_ORIGIN.x + SMITH_HEART_BOSS_SPOTS.final.x,
  y: 0,
  z: RAID_ORIGIN.z + SMITH_HEART_BOSS_SPOTS.final.z,
};
const RIFT_POS = { ...riftInstanceOrigin(0, 0), y: 0 };
const RAID_BOSSES = [
  'heart_hammer_guardian',
  'heart_seam_singer',
  'heart_breath_guardian',
  'heart_quench_guardian',
  'heart_heat_guardian',
  SMITH_HEART_FINAL_BOSS,
];
const questLog = new Map<string, QuestProgress>();
const showAll: QuestObjectGate = () => false;

function setup(seed = 17) {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: EMPTY_TEST_WORLD });
  const internals = sim as unknown as SimInternals;
  const pid = sim.addPlayer('warrior', 'Husk');
  sim.tick();
  return { sim, internals, pid };
}

function spawnKillAt(
  sim: Sim,
  internals: SimInternals,
  pid: number,
  templateId: string,
  pos: { x: number; y: number; z: number },
): Entity {
  const player = internals.entities.get(pid);
  if (!player) throw new Error('player entity missing');
  player.pos = { ...pos, x: pos.x + 1 };
  player.prevPos = { ...player.pos };
  const template = MOBS[templateId];
  const mob = createMob(9000 + internals.entities.size, template, template.maxLevel, { ...pos });
  internals.addEntity(mob);
  sim.dealDamage(player, mob, 9_999_999, false, 'physical', null, 'hit');
  expect(mob.dead).toBe(true);
  // A plain shared drop the killer can take in one loot.
  mob.loot = { copper: 1234, items: [] };
  mob.lootable = true;
  return mob;
}

function tickSeconds(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.ceil(seconds / DT) + 1; i++) sim.tick();
}

describe("Smith's Heart boss bodies stand until the instance goes", () => {
  it("every Smith's Heart boss opts in, and nothing else in the game does", () => {
    for (const id of RAID_BOSSES) expect(MOBS[id]?.corpseStandsInInstance, id).toBe(true);
    const others = Object.values(MOBS)
      .filter((t) => t.corpseStandsInInstance)
      .map((t) => t.id)
      .sort();
    expect(others).toEqual([...RAID_BOSSES].sort());
  });

  it('the looted Masterless Strength stays standing, inert, in its death pose', () => {
    const { sim, internals, pid } = setup();
    const boss = spawnKillAt(sim, internals, pid, SMITH_HEART_FINAL_BOSS, FINAL_POS);
    expect(boss.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    expect(sim.lootCorpse(boss.id, pid)).toBe(true);

    // Well past the old four-second collapse, and past the 60s trash window.
    tickSeconds(sim, 90);

    expect(internals.entities.get(boss.id)).toBe(boss);
    expect(boss.dead).toBe(true);
    expect(isVisuallyDead(boss)).toBe(true);
    // Drawn: the view policy admits it and does not retire it at arm's length.
    expect(entityViewIsAdmitted(boss, questLog, showAll)).toBe(true);
    const viewer = internals.entities.get(pid) as Entity;
    expect(entityViewShouldDrop(boss, viewer, questLog, showAll, 120 * 120)).toBe(false);
    // Purely a body: no second loot, no loot cursor or harvest, no target frame.
    expect(boss.lootable).toBe(false);
    expect(boss.loot).toBeNull();
    expect(corpseHasDecayed(boss.dead, boss.corpseTimer)).toBe(true);
    expect(sim.lootCorpse(boss.id, pid)).toBe(false);
    expect(corpseCanInteract(boss)).toBe(false);
    expect(deadTargetSelectable(boss, pid)).toBe(false);
  });

  it('every raid boss body stands after looting, not only the final one', () => {
    for (const id of RAID_BOSSES) {
      const { sim, internals, pid } = setup();
      const boss = spawnKillAt(sim, internals, pid, id, FINAL_POS);
      expect(sim.lootCorpse(boss.id, pid), id).toBe(true);
      tickSeconds(sim, 10);
      expect(internals.entities.has(boss.id), id).toBe(true);
      expect(entityViewIsAdmitted(boss, questLog, showAll), id).toBe(true);
      expect(boss.lootable, id).toBe(false);
    }
  });

  it('a hold that runs out unlooted lands in the same standing husk state', () => {
    const { sim, internals, pid } = setup();
    const boss = spawnKillAt(sim, internals, pid, SMITH_HEART_FINAL_BOSS, FINAL_POS);
    boss.corpseTimer = 1;
    tickSeconds(sim, 2);
    expect(corpseHasDecayed(boss.dead, boss.corpseTimer)).toBe(true);
    expect(boss.lootable).toBe(false);
    expect(sim.lootCorpse(boss.id, pid)).toBe(false);
    expect(entityViewIsAdmitted(boss, questLog, showAll)).toBe(true);
  });

  it('the online mirror keeps the body too: `cd` decayed, templateId and pos are enough', () => {
    // ClientWorld derives corpseTimer 0 from the wire's `cd` flag (net/online.ts).
    const mirrored = {
      id: 77,
      kind: 'mob',
      templateId: SMITH_HEART_FINAL_BOSS,
      dead: true,
      corpseTimer: 0,
      lootable: false,
      hostile: true,
      targetId: null,
      pos: { ...FINAL_POS },
    } as unknown as Entity;
    expect(entityViewIsAdmitted(mirrored, questLog, showAll)).toBe(true);
    // A decayed ordinary corpse beside it still goes.
    const trash = { ...mirrored, templateId: 'heart_hammer_warder' } as Entity;
    expect(entityViewIsAdmitted(trash, questLog, showAll)).toBe(false);
  });

  it('other instance bosses keep the old collapse once emptied', () => {
    const { sim, internals, pid } = setup();
    const boss = spawnKillAt(sim, internals, pid, 'rift_boss_frost', RIFT_POS);
    expect(MOBS.rift_boss_frost.corpseStandsInInstance).toBeUndefined();
    expect(sim.lootCorpse(boss.id, pid)).toBe(true);
    expect(boss.corpseTimer).toBeLessThanOrEqual(4);
    tickSeconds(sim, 5);
    expect(corpseHasDecayed(boss.dead, boss.corpseTimer)).toBe(true);
    expect(entityViewIsAdmitted(boss, questLog, showAll)).toBe(false);
  });

  it('is an instance-only rule: an open-world placement keeps the classic decay', () => {
    const template = MOBS[SMITH_HEART_FINAL_BOSS];
    const at = (x: number) => ({ kind: 'mob' as const, pos: { x, y: 0, z: 0 } });
    expect(corpseStandsUntilTeardown(template, at(FINAL_POS.x))).toBe(true);
    expect(corpseStandsUntilTeardown(template, at(0))).toBe(false);
    expect(corpseStandsUntilTeardown(template, at(DUNGEON_X_THRESHOLD))).toBe(false);
    expect(corpseStandsUntilTeardown(MOBS.rift_boss_frost, at(FINAL_POS.x))).toBe(false);
    expect(corpseStandsUntilTeardown(undefined, at(FINAL_POS.x))).toBe(false);
    expect(corpseStandsUntilTeardown(template, { kind: 'player', pos: FINAL_POS })).toBe(false);
  });
});
