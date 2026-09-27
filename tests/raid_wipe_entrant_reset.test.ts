// A raid boss whose every attempt participant has died must reset even when a
// fresh raider zoned into the room in the same tick (a member waiting on the
// inner portal steps through as the last raider drops). Before this pin the
// encounter counted "any living player in the room" as a live attempt, so the
// entrant kept the fight alive and the boss simply re-targeted them at his
// current health. The attempt roster is the authority: only a participant of
// THIS attempt can keep it alive.
import { describe, expect, it } from 'vitest';
import { attemptLost } from '../src/sim/encounters/attempt_wipe';
import { updateIgnivarEncounter } from '../src/sim/encounters/ignivar';
import { updateVarkhulEncounter, VARKHUL_BOSS_ID } from '../src/sim/encounters/varkhul';
import { IGNIVAR_SECOND_WING_ID } from '../src/sim/ignivar_raid_ids';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { revivePlayerAt } from '../src/sim/spirit';
import { type Entity, IGNIVAR_BOSS_ID, type PlayerClass } from '../src/sim/types';

function bossIn(sim: Sim, dungeonId: string, templateId: string): Entity {
  expect(enterDungeon(sim.ctx, dungeonId, sim.player.id, true)).toBe(true);
  const instance = sim.instances.find((entry) => entry.dungeonId === dungeonId);
  if (!instance) throw new Error(`${dungeonId} did not claim an instance`);
  const id = instance.mobIds.find((mobId) => sim.entities.get(mobId)?.templateId === templateId);
  const boss = id !== undefined ? sim.entities.get(id) : undefined;
  if (!boss) throw new Error(`${templateId} did not spawn`);
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = sim.player.id;
  boss.swingTimer = 999;
  sim.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z + 2 };
  sim.player.prevPos = { ...sim.player.pos };
  return boss;
}

function addRoomPlayer(sim: Sim, boss: Entity, name: string, cls: PlayerClass = 'priest'): Entity {
  const pid = sim.addPlayer(cls, name);
  const player = sim.entities.get(sim.players.get(pid)?.entityId ?? -1);
  if (!player) throw new Error(`${name} did not spawn`);
  player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z + 2 };
  player.prevPos = { ...player.pos };
  return player;
}

describe('attemptLost', () => {
  const alive = (id: number) => ({ id, dead: false }) as Entity;
  it('is lost when no living player is on the attempt roster', () => {
    expect(attemptLost([3, 4], [alive(9)])).toBe(true);
    expect(attemptLost([3, 4], [])).toBe(true);
  });
  it('stays alive while any roster member lives, whoever else is in the room', () => {
    expect(attemptLost([3, 4], [alive(9), alive(4)])).toBe(false);
  });
  it('never rules on an attempt without a roster (older snapshots)', () => {
    expect(attemptLost(undefined, [])).toBe(false);
    expect(attemptLost(undefined, [alive(9)])).toBe(false);
  });
});

describe('Ignivar wipe with a same-tick entrant', () => {
  it('resets to full health instead of re-targeting the entrant', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', devCommands: true });
    const boss = bossIn(sim, 'ignivar_raid_arena', IGNIVAR_BOSS_ID);
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.ignivar?.attemptParticipantIds).toEqual([sim.player.id]);
    boss.hp = Math.floor(boss.maxHp / 2);

    sim.ctx.handleDeath(sim.player, boss);
    const entrant = addRoomPlayer(sim, boss, 'Portal Waiter');
    updateIgnivarEncounter(sim.ctx, boss);

    expect(boss.ignivar).toBeUndefined();
    expect(boss.hp).toBe(boss.maxHp);
    expect(boss.inCombat).toBe(false);
    expect(boss.aggroTargetId).not.toBe(entrant.id);
  });

  it('keeps fighting a raider who joined before the last participant died', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', devCommands: true });
    const boss = bossIn(sim, 'ignivar_raid_arena', IGNIVAR_BOSS_ID);
    updateIgnivarEncounter(sim.ctx, boss);
    const joiner = addRoomPlayer(sim, boss, 'Late Joiner');
    updateIgnivarEncounter(sim.ctx, boss);
    expect(boss.ignivar?.attemptParticipantIds).toContain(joiner.id);
    boss.hp = Math.floor(boss.maxHp / 2);

    sim.ctx.handleDeath(sim.player, boss);
    updateIgnivarEncounter(sim.ctx, boss);

    expect(boss.ignivar).toBeDefined();
    expect(boss.hp).toBe(Math.floor(boss.maxHp / 2));
    expect(boss.aggroTargetId).toBe(joiner.id);
  });

  it('keeps fighting a participant raised mid-attempt', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', devCommands: true });
    const boss = bossIn(sim, 'ignivar_raid_arena', IGNIVAR_BOSS_ID);
    const ally = addRoomPlayer(sim, boss, 'Raised Healer');
    updateIgnivarEncounter(sim.ctx, boss);
    boss.hp = Math.floor(boss.maxHp / 2);

    sim.ctx.handleDeath(ally, boss);
    sim.ctx.handleDeath(sim.player, boss);
    revivePlayerAt(sim.ctx, ally.id, { ...ally.pos });
    updateIgnivarEncounter(sim.ctx, boss);

    expect(boss.ignivar).toBeDefined();
    expect(boss.hp).toBe(Math.floor(boss.maxHp / 2));
  });
});

describe('Varkhul wipe with a same-tick entrant', () => {
  it('resets to the anvil at full health instead of re-targeting the entrant', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', devCommands: true });
    const boss = bossIn(sim, IGNIVAR_SECOND_WING_ID, VARKHUL_BOSS_ID);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(boss.varkhul?.attemptParticipantIds).toEqual([sim.player.id]);
    boss.hp = Math.floor(boss.maxHp / 2);

    sim.ctx.handleDeath(sim.player, boss);
    const entrant = addRoomPlayer(sim, boss, 'Portal Waiter');
    updateVarkhulEncounter(sim.ctx, boss);

    expect(boss.varkhul).toBeUndefined();
    expect(boss.hp).toBe(boss.maxHp);
    expect(boss.inCombat).toBe(false);
    expect(boss.aggroTargetId).not.toBe(entrant.id);
    expect(boss.pos).toEqual(boss.spawnPos);
  });
});
