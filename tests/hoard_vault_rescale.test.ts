// A Buried Hoard scales UP when a player enters who had not entered before
// (src/sim/rift/hoard_rescale.ts): a lone reader can no longer open the door at
// solo strength and then invite a full party in. Never down, health share kept.
import { describe, expect, it } from 'vitest';
import { vaultDamageFactor, vaultHealthFactor } from '../src/sim/content/treasure_maps';
import {
  rescaleVaultForEntrants,
  rescaleVaultMob,
  vaultHeadCountFor,
} from '../src/sim/rift/hoard_rescale';
import { leaveRift } from '../src/sim/rift/runs';
import type { RiftInstance } from '../src/sim/rift/types';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const SEED = makeVaultSeed(3, 183);

function soloHoard(): {
  sim: Sim;
  owner: number;
  portal: Entity;
  inst: RiftInstance;
  boss: Entity;
} {
  const sim = new Sim({ seed: 9322, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const owner = sim.player.id;
  sim.chat('/dev level 20', owner);
  const portal = {
    ...sim.player,
    id: -1,
    vaultOwnerPid: owner,
    vaultRarity: 'epic' as const,
  } as Entity;
  sim.enterRift(SEED, 23, owner, undefined, portal);
  const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
  if (!inst?.vault || inst.bossId === null) throw new Error('missing hoard');
  const boss = sim.entities.get(inst.bossId);
  if (!boss) throw new Error('missing boss');
  sim.drainEvents();
  return { sim, owner, portal, inst, boss };
}

/** A new player joins the owner's party AFTER the door opened, then walks in. */
function joinLate(sim: Sim, owner: number, portal: Entity, name: string): number {
  const pid = sim.addPlayer('warrior', name);
  sim.setPlayerLevel(20, pid);
  if (!sim.partyOf(owner)) {
    sim.partyInvite(pid, owner);
    sim.partyAccept(pid);
  } else {
    sim.partyInvite(pid, owner);
    sim.partyAccept(pid);
  }
  sim.enterRift(SEED, 23, pid, undefined, portal);
  return pid;
}

function livingTrash(sim: Sim, inst: RiftInstance): Entity[] {
  return inst.mobIds
    .map((id) => sim.entities.get(id))
    .filter(
      (e): e is Entity =>
        e !== undefined && !e.dead && e.id !== inst.bossId && !e.templateId.startsWith('hoard_'),
    );
}

describe('hoard vault rescale', () => {
  it('reconnects owner and guest by character identity without counting phantom entrants', () => {
    const sim = new Sim({ seed: 9323, playerClass: 'warrior', noPlayer: true });
    sim.cfg.vaultRewardNeedsSave = true;
    const owner = sim.addPlayer('warrior', 'Owner', { characterId: 101 });
    const guest = sim.addPlayer('warrior', 'Guest', { characterId: 202 });
    sim.setPlayerLevel(20, owner);
    sim.setPlayerLevel(20, guest);
    sim.partyInvite(guest, owner);
    sim.partyAccept(guest);
    const ownerEntity = sim.entities.get(owner);
    if (!ownerEntity) throw new Error('owner missing');
    const portal = {
      ...ownerEntity,
      id: -1,
      vaultOwnerPid: owner,
      vaultOwnerCharacterId: 101,
      vaultRarity: 'epic' as const,
      vaultAttemptId: '101:1',
      riftSeed: SEED,
    } as Entity;
    sim.enterRift(SEED, 23, owner, undefined, portal);
    sim.enterRift(SEED, 23, guest, undefined, portal);
    const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
    if (!inst || inst.bossId === null) throw new Error('vault instance missing');
    expect(inst.memberIds.size).toBe(2);
    const boss = sim.entities.get(inst.bossId);
    if (!boss) throw new Error('vault boss missing');
    const scaledHp = boss.maxHp;

    sim.removePlayer(guest);
    const guestAgain = sim.addPlayer('warrior', 'Guest', { characterId: 202 });
    sim.setPlayerLevel(20, guestAgain);
    sim.enterRift(SEED, 23, guestAgain, undefined, portal);
    expect(inst.memberIds.has(guest)).toBe(false);
    expect(inst.memberIds.has(guestAgain)).toBe(true);
    expect(inst.memberIds.size).toBe(2);
    expect(boss.maxHp).toBe(scaledHp);

    sim.removePlayer(owner);
    const ownerAgain = sim.addPlayer('warrior', 'Owner', { characterId: 101 });
    sim.setPlayerLevel(20, ownerAgain);
    sim.enterRift(SEED, 23, ownerAgain, undefined, portal);
    expect(inst.memberIds.has(owner)).toBe(false);
    expect(inst.memberIds.has(ownerAgain)).toBe(true);
    expect(inst.vault?.ownerPid).toBe(ownerAgain);
    expect(inst.memberIds.size).toBe(2);
    expect(boss.maxHp).toBe(scaledHp);
    for (const id of inst.mobIds) {
      const mob = sim.entities.get(id);
      if (mob) {
        mob.hp = 0;
        mob.dead = true;
      }
    }
    const events: ReturnType<Sim['tick']> = [];
    for (let i = 0; i < 45; i++) events.push(...sim.tick());
    const outcomes = events.filter((event) => event.type === 'treasureVaultOutcomePending');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].claims.map((claim) => claim.characterId).sort()).toEqual([101, 202]);
  });

  it('scales to the players who have entered, never down, capped at five', () => {
    expect(vaultHeadCountFor(1, 1)).toBe(1);
    expect(vaultHeadCountFor(1, 2)).toBe(2);
    expect(vaultHeadCountFor(4, 2)).toBe(4);
    expect(vaultHeadCountFor(3, 9)).toBe(5);
  });

  it('a mob keeps its share of health and gains the factor ratio', () => {
    const mob = { maxHp: 1000, hp: 600, weapon: { min: 80, max: 125, speed: 2 } } as Entity;
    mob.mechanicDamageMult = 0.3;
    rescaleVaultMob(mob, 1, 2);
    const hp = vaultHealthFactor(2) / vaultHealthFactor(1);
    const dmg = vaultDamageFactor(2) / vaultDamageFactor(1);
    expect(mob.maxHp).toBe(Math.round(1000 * hp));
    expect(mob.hp / mob.maxHp).toBeCloseTo(0.6, 2);
    expect(mob.weapon.min).toBe(Math.round(80 * dmg));
    expect(mob.mechanicDamageMult).toBeCloseTo(0.3 * dmg);
  });

  it('a late joiner lifts the boss, keeping his health share, and his damage', () => {
    const { sim, owner, portal, inst, boss } = soloHoard();
    expect(inst.vault?.headCount).toBe(1);
    boss.hp = Math.round(boss.maxHp * 0.6);
    const before = { maxHp: boss.maxHp, max: boss.weapon.max };
    joinLate(sim, owner, portal, 'Latecomer');
    expect(inst.memberIds.size).toBe(2);
    expect(inst.vault?.headCount).toBe(2);
    expect(boss.maxHp).toBe(
      Math.round(before.maxHp * (vaultHealthFactor(2) / vaultHealthFactor(1))),
    );
    expect(boss.hp / boss.maxHp).toBeCloseTo(0.6, 2);
    expect(boss.weapon.max).toBeGreaterThan(before.max);
  });

  it('the dead stay dead and the living trash scales with the boss', () => {
    const { sim, owner, portal, inst } = soloHoard();
    const trash = livingTrash(sim, inst);
    expect(trash.length).toBeGreaterThan(1);
    const [dead, alive] = trash;
    dead.hp = 0;
    dead.dead = true;
    const aliveMax = alive.maxHp;
    joinLate(sim, owner, portal, 'Latecomer');
    expect(dead.dead).toBe(true);
    expect(dead.hp).toBe(0);
    expect(alive.maxHp).toBeGreaterThan(aliveMax);
  });

  it('never scales down when a member leaves or dies, nor twice for one re-entry', () => {
    const { sim, owner, portal, inst, boss } = soloHoard();
    const p2 = joinLate(sim, owner, portal, 'Latecomer');
    const scaled = boss.maxHp;
    leaveRift(sim.ctx, p2);
    expect(inst.vault?.headCount).toBe(2);
    expect(boss.maxHp).toBe(scaled);
    // Back in again: already counted, no second lift.
    sim.time += 10;
    sim.enterRift(SEED, 23, p2, undefined, portal);
    expect(inst.vault?.headCount).toBe(2);
    expect(boss.maxHp).toBe(scaled);
  });

  it('stops at five', () => {
    const { sim, owner, portal, inst, boss } = soloHoard();
    for (let i = 0; i < 4; i++) joinLate(sim, owner, portal, `Join${i}`);
    expect(inst.vault?.headCount).toBe(5);
    const atFive = boss.maxHp;
    rescaleVaultForEntrants(sim.ctx, inst);
    expect(boss.maxHp).toBe(atFive);
  });

  it('adds summoned mid-fight are born at the room scale, not a full party', () => {
    const { sim, inst, boss } = soloHoard();
    const summon = (): Entity => {
      const before = new Set(boss.summonedIds);
      sim.ctx.spawnBossAdds(boss, 'rift_bonewalker', 1);
      const add = boss.summonedIds
        .filter((id) => !before.has(id))
        .map((id) => sim.entities.get(id))
        .find((e): e is Entity => e !== undefined);
      if (!add) throw new Error('no add');
      return add;
    };
    const solo = summon();
    if (!inst.vault) throw new Error('no vault');
    inst.vault.headCount = 5;
    const party = summon();
    // Born at the room's live scale: a lone reader's add is the solo share of a party's.
    expect(solo.maxHp / party.maxHp).toBeCloseTo(vaultHealthFactor(1) / vaultHealthFactor(5), 2);
    expect(solo.weapon.max).toBeLessThan(party.weapon.max);
  });

  it('an ordinary rift is never touched', () => {
    const sim = new Sim({
      seed: 9323,
      playerClass: 'warrior',
      autoEquip: false,
      devCommands: true,
    });
    sim.chat('/dev level 20', sim.player.id);
    sim.enterRift(12345, 22, sim.player.id);
    const inst = sim.riftInstances.find((candidate) => candidate.memberIds.has(sim.player.id));
    if (!inst) throw new Error('missing rift');
    expect(inst.vault).toBeNull();
    expect(rescaleVaultForEntrants(sim.ctx, inst)).toBeNull();
  });
});
