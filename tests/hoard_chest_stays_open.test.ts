// The Buried Hoard reward chest after its LAST share is taken (follows #4261).
// Live report: the moment the last eligible player claimed, the chest vanished
// from the room. The sim keeps the entity (it only stops being a target), but
// the renderer's object-visibility gate (delve_interactable_visibility_core.ts)
// hid every non-lootable object outside its delve_/rift_/bg_ families, so the
// spent chest read as gone. Classic behavior: it stays where it stood, open and
// empty, with no claim prompt, until the run itself is torn down.
//
// These cases walk the real path: a hoard map's room, the real kill, every
// entrant's own F press through the client's nearby scan, the renderer's
// visibility rule on the body the renderer actually builds, and the run's own
// empty-slot teardown.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { resolveNearbyInteractionCandidate } from '../src/game/nearby_interaction_core';
import { syncDelveInteractableVisibility } from '../src/render/delve_props';
import { hoardEntrance } from '../src/render/hoard_entrance';
import {
  confirmHoardRewardClaim,
  HOARD_REWARD_CHEST_OPEN_TEMPLATE,
} from '../src/sim/rift/hoard_reward_chest';
import { RIFT_LOOT_RECOVERY_GRACE } from '../src/sim/rift/portals';
import type { RiftInstance } from '../src/sim/rift/types';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass, SimEvent } from '../src/sim/types';

function makeHoard(partySize: number) {
  const sim = new Sim({ seed: 6120, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const owner = sim.player.id;
  sim.setPlayerLevel(20, owner);
  const members = [owner];
  const classes: PlayerClass[] = ['priest', 'mage'];
  for (let i = 1; i < partySize; i++) {
    const pid = sim.addPlayer(classes[i - 1], `Member${i}`);
    sim.setPlayerLevel(20, pid);
    sim.partyInvite(pid, owner);
    sim.partyAccept(pid);
    members.push(pid);
  }
  for (const pid of members) sim.chat('/dev god', pid);
  const portal = { ...sim.player, id: -1, vaultOwnerPid: owner, vaultRarity: 'epic' as const };
  for (const pid of members) sim.enterRift(makeVaultSeed(2, 77), 22, pid, undefined, portal);
  const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
  if (!inst || inst.bossId === null) throw new Error('missing hoard');
  for (const pid of members) expect(inst.memberIds.has(pid)).toBe(true);
  sim.drainEvents();
  return { sim, inst, owner, members };
}

function killBoss(sim: Sim, inst: RiftInstance, killer: number): Entity {
  const boss = inst.bossId === null ? undefined : sim.entities.get(inst.bossId);
  if (!boss) throw new Error('missing boss');
  const player = sim.entities.get(killer);
  if (!player) throw new Error('missing killer');
  player.pos = { ...boss.pos, z: boss.pos.z - 2 };
  boss.hp = 1;
  sim.ctx.dealDamage(player, boss, 9999, false, 'physical', 'Test Blow', 'hit', true);
  for (let step = 0; step < 40; step++) sim.tick();
  sim.drainEvents();
  const chestId = inst.vault?.chest?.entityId;
  const chest = chestId === undefined ? undefined : sim.entities.get(chestId);
  if (!chest) throw new Error('no chest');
  return chest;
}

const paidTo = (events: readonly SimEvent[], pid: number): number =>
  events.filter(
    (event) => event.type === 'treasureVaultLooted' && !event.capped && event.pid === pid,
  ).length;

/** What one entrant's client shows and does at the chest: whether the body the
 *  renderer builds for it is visible, whether the F prompt resolves to it, and
 *  (if it does) the press itself. */
function pressF(sim: Sim, pid: number, chest: Entity) {
  const player = sim.entities.get(pid);
  if (!player) throw new Error('missing player');
  player.pos = { x: chest.pos.x, y: chest.pos.y, z: chest.pos.z - 2 };
  const body = hoardEntrance(
    chest,
    () => 0,
    () => true,
  )?.body;
  if (!body) throw new Error('the chest has no body');
  const questLog = sim.meta(pid)?.questLog;
  if (!questLog) throw new Error('missing quest log');
  const group = new THREE.Group();
  group.add(body);
  const visible = syncDelveInteractableVisibility(group, chest, questLog, false);
  const candidate = resolveNearbyInteractionCandidate({
    player,
    playerId: pid,
    entities: sim.entities,
    questLog,
    farmPatches: [],
  });
  const prompt = candidate?.kind === 'object' && candidate.id === chest.id;
  const opened = prompt ? sim.pickUpObject(chest.id, pid) : false;
  return { visible, prompt, opened, paid: paidTo(sim.drainEvents(), pid) };
}

/** The spent chest, as everyone in the room sees it. */
function expectSpentButStanding(sim: Sim, inst: RiftInstance, chest: Entity, pids: number[]) {
  expect(sim.entities.get(chest.id)).toBe(chest);
  expect(inst.vault?.chest?.entityId).toBe(chest.id);
  expect(chest.templateId).toBe(HOARD_REWARD_CHEST_OPEN_TEMPLATE);
  expect(chest.lootable).toBe(false);
  for (const pid of pids) {
    // Still in the room, open, with no prompt and nothing more to give.
    expect(pressF(sim, pid, chest)).toEqual({
      visible: true,
      prompt: false,
      opened: false,
      paid: 0,
    });
    // A direct press (a stale click) is refused and pays nothing either.
    expect(sim.pickUpObject(chest.id, pid)).toBe(false);
    expect(paidTo(sim.drainEvents(), pid)).toBe(0);
  }
}

/** Every entrant walks away and the run's empty-slot clock runs out. */
function tearDown(sim: Sim, inst: RiftInstance, pids: number[]): void {
  for (const pid of pids) sim.leaveRift(pid);
  sim.drainEvents();
  inst.emptyFor = RIFT_LOOT_RECOVERY_GRACE - 1;
  for (let step = 0; step < 60; step++) sim.tick();
}

describe('the claimed Buried Hoard chest stays in the room, opened', () => {
  it('solo: after the only share is taken it stays, open and empty, until the run ends', () => {
    const { sim, inst, owner } = makeHoard(1);
    const chest = killBoss(sim, inst, owner);
    expect(pressF(sim, owner, chest)).toEqual({
      visible: true,
      prompt: true,
      opened: true,
      paid: 1,
    });
    expectSpentButStanding(sim, inst, chest, [owner]);
    // A few seconds on, nothing has cleared it away.
    for (let step = 0; step < 200; step++) sim.tick();
    sim.drainEvents();
    expectSpentButStanding(sim, inst, chest, [owner]);

    tearDown(sim, inst, [owner]);
    expect(sim.entities.has(chest.id)).toBe(false);
    expect(inst.vault?.chest).toBeUndefined();
  });

  it('a party of three: each opens it once, and the last claim leaves it standing open', () => {
    const { sim, inst, owner, members } = makeHoard(3);
    const chest = killBoss(sim, inst, owner);
    expect(inst.vault?.chest?.eligible).toEqual(members);
    for (const [index, pid] of members.entries()) {
      expect(pressF(sim, pid, chest)).toEqual({
        visible: true,
        prompt: true,
        opened: true,
        paid: 1,
      });
      const last = index === members.length - 1;
      expect(chest.lootable).toBe(!last);
      expect(sim.entities.has(chest.id)).toBe(true);
    }
    expectSpentButStanding(sim, inst, chest, members);

    tearDown(sim, inst, members);
    expect(sim.entities.has(chest.id)).toBe(false);
    expect(inst.vault?.chest).toBeUndefined();
  });

  it('the online claim confirmation leaves the spent chest standing too', () => {
    // Online, the host commits each claim before confirmHoardRewardClaim marks
    // it (server/vault_reward_service.ts); the last confirmation closes the
    // chest through the same spent rule as the offline press.
    const { sim, inst, owner } = makeHoard(1);
    const chest = killBoss(sim, inst, owner);
    if (!inst.vault) throw new Error('no vault');
    inst.vault.attemptId = 'attempt-stays-open';
    confirmHoardRewardClaim(sim.ctx, 'attempt-stays-open', owner);
    expect(inst.vault.chest?.claimed).toEqual([owner]);
    expectSpentButStanding(sim, inst, chest, [owner]);
  });
});
