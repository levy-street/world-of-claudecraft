import { describe, expect, it } from 'vitest';
import { updateCasting } from '../src/sim/combat/casting_lifecycle';
import {
  SPIRIT_BOMB_ID,
  SPIRIT_BOMB_PROGRESS_ID,
  spiritBombProgress,
} from '../src/sim/combat/priest/spirit_bomb';
import {
  beginSpiritBombRaidPull,
  spiritBombBlockedByRaidPull,
} from '../src/sim/combat/priest/spirit_bomb_raid';
import { MOBS } from '../src/sim/data';
import { resetIgnivarEncounter, updateIgnivarEncounter } from '../src/sim/encounters/ignivar';
import { updateNythraxisEncounter, wipeNythraxisEncounter } from '../src/sim/encounters/nythraxis';
import {
  resetVarkhulEncounter,
  updateVarkhulEncounter,
  VARKHUL_BOSS_ID,
} from '../src/sim/encounters/varkhul';
import { createMob } from '../src/sim/entity';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, IGNIVAR_BOSS_ID, NYTHRAXIS_BOSS_ID } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function bank(player: Entity, stacks: number) {
  player.auras = player.auras.filter((aura) => aura.id !== SPIRIT_BOMB_PROGRESS_ID);
  player.auras.push({
    id: SPIRIT_BOMB_PROGRESS_ID,
    name: 'Tithe Bomb',
    kind: 'spirit_bomb_charge',
    sourceId: player.id,
    stacks,
    remaining: 1,
    duration: 1,
    value: 0,
    school: 'shadow',
    undispellable: true,
  });
}

function move(sim: Sim, player: Entity, pos: Entity['pos']) {
  player.pos = { ...pos };
  player.prevPos = { ...pos };
  sim.ctx.rebucket(player);
}

function fixture(room = 'ignivar_raid_arena', bossId = IGNIVAR_BOSS_ID) {
  const sim = new Sim({
    seed: 42,
    playerClass: 'priest',
    devCommands: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(20);
  sim.setSpec('shadow');
  expect(enterDungeon(sim.ctx, room, sim.player.id, true)).toBe(true);
  const slot = sim.instances.find((entry) => entry.dungeonId === room && entry.partyKey !== null)!;
  const boss = sim.entities.get(
    slot.mobIds.find((id) => sim.entities.get(id)?.templateId === bossId)!,
  )!;
  move(sim, sim.player, { ...boss.pos, z: boss.pos.z + 2 });
  return { sim, boss, slot };
}

function bystander(sim: Sim, boss: Entity, stacks: number) {
  const player = sim.entities.get(sim.addPlayer('priest', `Bystander ${stacks}`))!;
  move(sim, player, { ...boss.pos, x: boss.pos.x + 35 });
  bank(player, stacks);
  return player;
}

describe('Spirit Bomb raid pull banks', () => {
  it('resets untouched 19/20 and ready bystanders synchronously on the real aggro path', () => {
    const { sim, boss } = fixture();
    const partial = bystander(sim, boss, 19);
    const ready = bystander(sim, boss, 20);
    ready.castingAbility = SPIRIT_BOMB_ID;
    ready.castRemaining = ready.castTotal = 2;
    expect(sim.aggroMob(boss, sim.player, false)).toBe(true);
    expect(spiritBombProgress(partial)).toBe(0);
    expect(spiritBombProgress(ready)).toBe(0);
    expect(ready.castingAbility).toBeNull();
    bank(partial, 5);
    expect(sim.aggroMob(boss, sim.player, false)).toBe(false);
    beginSpiritBombRaidPull(sim.ctx, boss);
    updateIgnivarEncounter(sim.ctx, boss);
    expect(spiritBombProgress(partial)).toBe(5);
  });

  it('isolates concurrent raid copies and unrelated remote players', () => {
    const { sim, boss, slot } = fixture();
    const remote = sim.entities.get(sim.addPlayer('priest', 'Remote'))!;
    bank(remote, 20);
    const other = sim.entities.get(sim.addPlayer('priest', 'Other copy'))!;
    expect(enterDungeon(sim.ctx, slot.dungeonId, other.id, true)).toBe(true);
    const second = sim.instances.find(
      (entry) => entry.dungeonId === slot.dungeonId && entry !== slot && entry.partyKey !== null,
    )!;
    const secondBoss = sim.entities.get(
      second.mobIds.find((id) => sim.entities.get(id)?.templateId === IGNIVAR_BOSS_ID)!,
    )!;
    move(sim, other, secondBoss.pos);
    bank(other, 19);
    bank(sim.player, 20);
    sim.aggroMob(boss, sim.player, false);
    expect(spiritBombProgress(sim.player)).toBe(0);
    expect(spiritBombProgress(other)).toBe(19);
    expect(spiritBombProgress(remote)).toBe(20);
    expect(secondBoss.spiritBombRaidPullStarted).toBeUndefined();
  });

  it('preserves progress on ordinary dungeon pulls', () => {
    const sim = new Sim({ seed: 42, playerClass: 'priest', devCommands: true });
    expect(enterDungeon(sim.ctx, 'hollow_crypt', sim.player.id, true)).toBe(true);
    bank(sim.player, 19);
    const slot = sim.instances.find(
      (entry) => entry.dungeonId === 'hollow_crypt' && entry.partyKey !== null,
    )!;
    const boss = slot.mobIds
      .map((id) => sim.entities.get(id)!)
      .find((mob) => MOBS[mob.templateId]?.boss)!;
    expect(sim.aggroMob(boss, sim.player, false)).toBe(true);
    expect(spiritBombProgress(sim.player)).toBe(19);
    expect(spiritBombBlockedByRaidPull(sim.ctx, sim.player, boss, 8)).toBe(false);
  });

  it('keeps idle Varkhul staging banked, and resets on his scripted actual pull', () => {
    const { sim, boss, slot } = fixture('ignivar_inner_crucible', VARKHUL_BOSS_ID);
    move(sim, sim.player, { ...boss.pos, z: boss.pos.z + 40 });
    bank(sim.player, 20);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(boss.varkhul?.engage.phase).toBe('forging');
    expect(spiritBombProgress(sim.player)).toBe(20);
    expect(boss.spiritBombRaidPullStarted).toBeUndefined();
    expect(slot.mobIds).toContain(boss.id);
    // A ranged threat-only pull can still be rejected by his forging gate.
    expect(sim.aggroMob(boss, sim.player, false)).toBe(true);
    expect(spiritBombProgress(sim.player)).toBe(20);
    expect(boss.spiritBombRaidPullStarted).toBeUndefined();
    updateVarkhulEncounter(sim.ctx, boss);
    expect(boss.aiState).toBe('idle');
    expect(boss.spiritBombRaidPullStarted).toBeUndefined();
    bank(sim.player, 19);
    move(sim, sim.player, { ...boss.pos, z: boss.pos.z + 2 });
    updateVarkhulEncounter(sim.ctx, boss);
    expect(spiritBombProgress(sim.player)).toBe(0);
    expect(boss.spiritBombRaidPullStarted).toBe(true);
  });

  it('rearms active Varkhul attempts and resets again on a real damage repull', () => {
    const { sim, boss } = fixture('ignivar_inner_crucible', VARKHUL_BOSS_ID);
    bank(sim.player, 20);
    expect(sim.aggroMob(boss, sim.player, false)).toBe(true);
    expect(spiritBombProgress(sim.player)).toBe(0);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(boss.varkhul?.engage.phase).not.toBe('forging');
    resetVarkhulEncounter(sim.ctx, boss);
    expect(boss.spiritBombRaidPullStarted).toBeUndefined();
    sim.ctx.resetEvadingMob(boss);
    expect(boss.spiritBombRaidPullStarted).toBeUndefined();
    move(sim, sim.player, { ...boss.pos, z: boss.pos.z + 40 });
    bank(sim.player, 19);
    sim.ctx.dealDamage(sim.player, boss, 100, false, 'shadow', 'Raid reset test', 'hit');
    expect(boss.hp).toBeLessThan(boss.maxHp);
    expect(spiritBombProgress(sim.player)).toBe(0);
    expect(boss.spiritBombRaidPullStarted).toBe(true);
    bank(sim.player, 5);
    updateVarkhulEncounter(sim.ctx, boss);
    expect(spiritBombProgress(sim.player)).toBe(5);
  });

  it('rearms Nythraxis after wipe and clears a freshly prepared bank on repull', () => {
    const { sim, boss } = fixture('nythraxis_boss_arena', NYTHRAXIS_BOSS_ID);
    bank(sim.player, 19);
    updateNythraxisEncounter(sim.ctx, boss);
    expect(spiritBombProgress(sim.player)).toBe(0);
    wipeNythraxisEncounter(sim.ctx, boss);
    expect(boss.spiritBombRaidPullStarted).toBeUndefined();
    bank(sim.player, 20);
    expect(sim.aggroMob(boss, sim.player, false)).toBe(true);
    expect(spiritBombProgress(sim.player)).toBe(0);
  });

  it('resets banks on pet and taunt pulls', () => {
    const { sim, boss } = fixture();
    const pet = createMob(990001, MOBS.training_dummy, 20, sim.player.pos);
    pet.ownerId = sim.player.id;
    sim.ctx.addEntity(pet);
    bank(sim.player, 20);
    expect(sim.aggroMob(boss, pet, false)).toBe(true);
    expect(spiritBombProgress(sim.player)).toBe(0);
    resetIgnivarEncounter(sim.ctx, boss);
    sim.ctx.resetEvadingMob(boss);
    bank(sim.player, 19);
    sim.ctx.applyTaunt(sim.player, boss);
    expect(spiritBombProgress(sim.player)).toBe(0);
  });

  it('blocks a preloaded boss opener, splash opener and pending scripted reset', () => {
    const { sim, boss } = fixture();
    const add = createMob(990002, MOBS.training_dummy, 20, { ...boss.pos, x: boss.pos.x + 4 });
    add.hostile = true;
    sim.ctx.addEntity(add);
    expect(spiritBombBlockedByRaidPull(sim.ctx, sim.player, boss, 8)).toBe(true);
    expect(spiritBombBlockedByRaidPull(sim.ctx, sim.player, add, 8)).toBe(true);
    move(sim, add, { ...boss.pos, x: boss.pos.x + 20 });
    expect(spiritBombBlockedByRaidPull(sim.ctx, sim.player, add, 8)).toBe(false);
    boss.inCombat = true;
    expect(spiritBombBlockedByRaidPull(sim.ctx, sim.player, add, 8)).toBe(true);
    beginSpiritBombRaidPull(sim.ctx, boss);
    expect(spiritBombBlockedByRaidPull(sim.ctx, sim.player, add, 8)).toBe(false);
  });

  it('rejects real boss and splash cast admission, preserving the ready bank', () => {
    const { sim, boss } = fixture();
    sim.ctx.lineOfSightBlocked = () => false;
    bank(sim.player, 20);
    sim.targetEntity(boss.id);
    sim.castAbility(SPIRIT_BOMB_ID);
    expect(sim.player.castingAbility).toBeNull();
    expect(boss.inCombat).toBe(false);
    const add = createMob(990003, MOBS.training_dummy, 20, { ...boss.pos, x: boss.pos.x + 4 });
    add.hostile = true;
    sim.ctx.addEntity(add);
    sim.targetEntity(add.id);
    sim.castAbility(SPIRIT_BOMB_ID);
    expect(sim.player.castingAbility).toBeNull();
    expect(spiritBombProgress(sim.player)).toBe(20);
  });

  it('rejects real completion before a scripted pull reset even outside boss splash', () => {
    const { sim, boss } = fixture();
    sim.ctx.lineOfSightBlocked = () => false;
    const add = createMob(990004, MOBS.training_dummy, 20, { ...boss.pos, x: boss.pos.x + 20 });
    add.hostile = true;
    add.maxHp = add.hp = 100000;
    sim.ctx.addEntity(add);
    bank(sim.player, 20);
    sim.targetEntity(add.id);
    sim.castAbility(SPIRIT_BOMB_ID);
    expect(sim.player.castingAbility).toBe(SPIRIT_BOMB_ID);
    boss.inCombat = true;
    sim.player.castRemaining = DT;
    updateCasting(sim.ctx, sim.player, sim.players.get(sim.player.id)!);
    expect(sim.player.castingAbility).toBeNull();
    expect(add.hp).toBe(100000);
    beginSpiritBombRaidPull(sim.ctx, boss);
    expect(spiritBombProgress(sim.player)).toBe(0);
  });

  it('clears the owning raid roster outside the arena without touching other groups', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'priest',
      devCommands: true,
      world: EMPTY_TEST_WORLD,
    });
    const member = sim.entities.get(sim.addPlayer('priest', 'Raid member in town'))!;
    const stranger = sim.entities.get(sim.addPlayer('priest', 'Stranger in town'))!;
    sim.partyInvite(member.id, sim.player.id);
    sim.partyAccept(member.id);
    sim.convertPartyToRaid(sim.player.id);
    bank(member, 19);
    bank(stranger, 20);
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', sim.player.id, true)).toBe(true);
    const slot = sim.instances.find(
      (entry) => entry.dungeonId === 'ignivar_raid_arena' && entry.partyKey !== null,
    )!;
    const boss = sim.entities.get(
      slot.mobIds.find((id) => sim.entities.get(id)?.templateId === IGNIVAR_BOSS_ID)!,
    )!;
    expect(sim.aggroMob(boss, sim.player, false)).toBe(true);
    expect(spiritBombProgress(member)).toBe(0);
    expect(spiritBombProgress(stranger)).toBe(20);
  });
});
