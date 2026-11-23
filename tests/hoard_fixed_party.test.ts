import { describe, expect, it } from 'vitest';
import { canObserveEntity } from '../server/entity_observation';
import { RIFT_RANK_BASE_LEVEL } from '../src/sim/rift/ranks';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import { mayEnterVaultPortal } from '../src/sim/treasure_vault';
import type { Entity } from '../src/sim/types';

function encounter() {
  const sim = new Sim({ seed: 9323, playerClass: 'warrior', noPlayer: true });
  sim.cfg.vaultRewardNeedsSave = true;
  const owner = sim.addPlayer('warrior', 'Owner', { characterId: 101 });
  sim.setPlayerLevel(20, owner);
  const seed = makeVaultSeed(3, 183);
  const portal = {
    ...sim.entities.get(owner)!,
    id: -1,
    vaultOwnerPid: owner,
    vaultOwnerCharacterId: 101,
    vaultRarity: 'legendary',
    vaultAttemptId: '101:1',
    riftSeed: seed,
    riftBaseLevel: RIFT_RANK_BASE_LEVEL.S,
  } as Entity;
  const enter = (pid: number) =>
    sim.enterRift(seed, RIFT_RANK_BASE_LEVEL.S, pid, undefined, portal);
  enter(owner);
  const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null)!;
  const boss = sim.entities.get(inst.bossId!)!;
  const join = (id: number) => {
    const pid = sim.addPlayer('mage', `Guest${id}`, { characterId: id });
    sim.setPlayerLevel(20, pid);
    sim.partyInvite(pid, owner);
    sim.partyAccept(pid);
    enter(pid);
    return pid;
  };
  const clear = () => {
    for (const id of inst.mobIds) {
      const mob = sim.entities.get(id);
      if (mob) {
        mob.hp = 0;
        mob.dead = true;
      }
    }
    return Array.from({ length: 45 }, () => sim.tick()).flat();
  };
  return { sim, owner, portal, inst, boss, enter, join, clear };
}

describe('hoard current-party admission', () => {
  it.each(['owner offline', 'left after clear'] as const)(
    'shows the entrance and lets a ghost walk back to its corpse when %s',
    (scenario) => {
      const { sim, owner, portal, join, inst, clear } = encounter();
      portal.kind = 'object';
      portal.templateId = 'hoard_entrance';
      sim.ctx.addEntity(portal);
      const guest = join(202);
      if (scenario === 'left after clear') clear();
      const player = sim.entities.get(guest)!;
      player.hp = 0;
      player.dead = true;
      sim.releaseSpirit(guest);
      if (scenario === 'owner offline') sim.removePlayer(owner);
      else sim.partyLeave(guest);
      const corpse = { ...player.corpsePos! };
      player.pos = { ...portal.pos };
      player.riftReentryGraceUntil = 0;
      expect(canObserveEntity(sim, player, portal, 0)).toBe(true);
      sim.tick();
      expect(player.pos.x).toBeCloseTo(corpse.x);
      expect(player.pos.z).toBeCloseTo(corpse.z);
      expect(player.dead).toBe(true);
      expect(inst.memberIds.has(guest)).toBe(true);
      // Prior admission grants no visibility once alive and outside the party.
      player.dead = false;
      expect(canObserveEntity(sim, player, portal, 0)).toBe(false);
    },
  );

  it('rebinds a reconnecting ghost to its own run while the owner is offline', () => {
    const { sim, owner, join, enter, inst } = encounter();
    const guest = join(202);
    const corpse = { ...sim.entities.get(guest)!.pos };
    sim.removePlayer(guest);
    sim.removePlayer(owner);
    const returned = sim.addPlayer('mage', 'Guest202', { characterId: 202 });
    sim.setPlayerLevel(20, returned);
    const player = sim.entities.get(returned)!;
    player.pos = corpse;
    player.hp = 0;
    player.dead = true;
    sim.releaseSpirit(returned);
    const outside = { ...player.pos };
    enter(returned);
    expect(player.pos).not.toEqual(outside);
    expect(inst.memberIds.has(returned)).toBe(true);
    expect(inst.memberIds.has(guest)).toBe(false);
    expect(inst.vault!.entrantSnapshots!.size).toBe(2);
  });

  it('does not grant a stranger or a different attempt corpse-return access', () => {
    const { sim, owner, portal, join } = encounter();
    const guest = join(202);
    const stranger = sim.addPlayer('mage', 'Stranger', { characterId: 999 });
    sim.entities.get(stranger)!.dead = true;
    sim.entities.get(guest)!.dead = true;
    sim.removePlayer(owner);
    expect(mayEnterVaultPortal(sim.ctx, portal, stranger)).toBe(false);
    expect(mayEnterVaultPortal(sim.ctx, { ...portal, vaultAttemptId: '101:2' }, guest)).toBe(false);
    expect(mayEnterVaultPortal(sim.ctx, { ...portal, id: -2 }, guest)).toBe(false);
    expect(canObserveEntity(sim, sim.entities.get(stranger)!, portal, 0)).toBe(false);
    expect(
      canObserveEntity(sim, sim.entities.get(guest)!, { ...portal, vaultAttemptId: '101:2' }, 0),
    ).toBe(false);
    expect(canObserveEntity(sim, sim.entities.get(guest)!, { ...portal, id: -2 }, 0)).toBe(false);
  });

  it('still blocks a bound ghost while the room is in combat', () => {
    const { sim, owner, join, enter, boss } = encounter();
    const guest = join(202);
    const player = sim.entities.get(guest)!;
    player.hp = 0;
    player.dead = true;
    sim.releaseSpirit(guest);
    sim.removePlayer(owner);
    boss.aiState = 'attack';
    boss.inCombat = true;
    boss.aggroTargetId = guest;
    const outside = { ...player.pos };
    sim.drainEvents();
    enter(guest);
    expect(player.pos).toEqual(outside);
    expect(sim.drainEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          text: 'Your party is still in combat. The dead may re-enter once the fighting stops.',
        }),
      ]),
    );
  });

  it('preserves an offline guest claim at clear and on existing member reentry', () => {
    const { sim, owner, join, enter, clear } = encounter();
    const guest = join(202);
    sim.removePlayer(guest);
    enter(owner);
    const outcomes = clear().filter((e) => e.type === 'treasureVaultOutcomePending');
    expect(outcomes[0].claims.map((c) => c.characterId).sort()).toEqual([101, 202]);
  });

  it('returns a displaced ghost corpse outside so replacement does not strand recovery', () => {
    const { sim, owner, join, enter, inst } = encounter();
    const guest = join(202);
    const player = sim.entities.get(guest)!;
    player.hp = 0;
    player.dead = true;
    sim.releaseSpirit(guest);
    sim.partyKick(guest, owner);
    enter(owner);
    expect(inst.memberIds.has(guest)).toBe(false);
    expect(player.corpsePos!.x).toBeCloseTo(inst.returnPos.x);
    expect(player.corpsePos!.z).toBeCloseTo(inst.returnPos.z);
    player.pos = { ...player.corpsePos! };
    sim.resurrectAtCorpse(guest);
    expect(player.dead).toBe(false);
  });

  it('reclaims only the offline slot needed by a replacement', () => {
    const { sim, join, clear } = encounter();
    const guests = [201, 202, 203, 204].map(join);
    sim.removePlayer(guests[0]);
    sim.removePlayer(guests[1]);
    join(301);
    const outcomes = clear().filter((e) => e.type === 'treasureVaultOutcomePending');
    expect(outcomes[0].claims.map((c) => c.characterId).sort()).toEqual([101, 202, 203, 204, 301]);
  });

  it.each(['offline', 'decided', 'regrouped'] as const)(
    'allows an admitted ghost corpse recovery when %s',
    (scenario) => {
      const { sim, owner, join, enter, inst, clear } = encounter();
      const guest = join(202);
      if (scenario === 'decided') clear();
      if (scenario === 'offline') sim.removePlayer(owner);
      else sim.partyLeave(guest);
      const player = sim.entities.get(guest)!;
      sim.ctx.dealDamage(null, player, player.maxHp * 100, false, 'shadow', null, 'hit', true);
      sim.releaseSpirit(guest);
      for (const id of inst.mobIds) {
        const mob = sim.entities.get(id);
        if (mob) {
          mob.aiState = 'idle';
          mob.aggroTargetId = null;
          mob.threat.clear();
        }
      }
      const outside = { ...player.pos };
      enter(guest);
      expect(player.pos).not.toEqual(outside);
      expect(player.dead).toBe(true);
      expect(inst.memberIds.has(guest)).toBe(true);
      expect(sim.riftInstances.filter((run) => run.partyKey !== null)).toHaveLength(1);
    },
  );

  it('replaces guests repeatedly in the same progressed room without rescaling or extra claims', () => {
    const { sim, owner, portal, inst, boss, enter, join, clear } = encounter();
    const hp = boss.maxHp;
    const weapon = { ...boss.weapon };
    const guests = [201, 202, 203, 204].map(join);
    inst.progressed = true;
    boss.hp = Math.floor(hp / 2);
    const injured = boss.hp;
    for (let id = 301; id <= 304; id++) {
      const departed = guests.shift()!;
      sim.partyKick(departed, owner);
      const next = join(id);
      guests.push(next);
      expect(inst.memberIds.has(next)).toBe(true);
      expect(inst.memberIds.has(departed)).toBe(false);
      expect(mayEnterVaultPortal(sim.ctx, portal, departed)).toBe(false);
      enter(departed);
      expect(inst.memberIds.has(departed)).toBe(false);
      expect(inst.vault!.entrantSnapshots!.size).toBe(5);
      expect(inst.memberIds.size).toBe(5);
      expect(boss.maxHp).toBe(hp);
      expect(boss.hp).toBe(injured);
      expect(boss.weapon).toEqual(weapon);
    }
    expect(sim.riftInstances.filter((candidate) => candidate.partyKey !== null)).toHaveLength(1);
    const events = clear();
    const outcomes = events.filter((e) => e.type === 'treasureVaultOutcomePending');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].claims.map((c) => c.characterId).sort()).toEqual([101, 301, 302, 303, 304]);
    expect(inst.vault!.chest!.eligible.sort()).toEqual([owner, ...guests].sort());
    const claims = [...inst.vault!.rewardClaims!];
    const snapshots = [...inst.vault!.entrantSnapshots!];
    sim.partyKick(guests[0], owner);
    enter(owner);
    expect([...inst.vault!.rewardClaims!]).toEqual(claims);
    expect([...inst.vault!.entrantSnapshots!]).toEqual(snapshots);
  });

  it('rejects old invitations and old entrants unless currently grouped with the owner', () => {
    const { sim, owner, portal, enter, join, inst } = encounter();
    const guest = join(202);
    portal.vaultInitialPartyCharacterIds = [101, 202];
    sim.partyLeave(guest);
    expect(mayEnterVaultPortal(sim.ctx, portal, guest)).toBe(false);
    sim.partyInvite(guest, owner);
    sim.partyAccept(guest);
    expect(mayEnterVaultPortal(sim.ctx, portal, guest)).toBe(true);
    sim.removePlayer(guest);
    const again = sim.addPlayer('mage', 'Guest202', { characterId: 202 });
    sim.setPlayerLevel(20, again);
    expect(mayEnterVaultPortal(sim.ctx, portal, again)).toBe(false);
    sim.partyInvite(again, owner);
    sim.partyAccept(again);
    enter(again);
    expect(inst.memberIds.has(guest)).toBe(false);
    expect(inst.memberIds.has(again)).toBe(true);
    expect(inst.vault!.entrantSnapshots!.size).toBe(2);
  });

  it('keeps a disconnected owner entitled but admits nobody until their group is available', () => {
    const { sim, owner, portal, join, clear } = encounter();
    const guest = join(202);
    sim.removePlayer(owner);
    expect(mayEnterVaultPortal(sim.ctx, portal, guest)).toBe(false);
    const outcomes = clear().filter((e) => e.type === 'treasureVaultOutcomePending');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].claims.map((c) => c.characterId).sort()).toEqual([101, 202]);
  });

  it('does not turn a raid into more than five reward slots', () => {
    const { sim, owner, join, inst } = encounter();
    [201, 202, 203, 204].forEach(join);
    sim.convertPartyToRaid(owner);
    const sixth = join(205);
    expect(inst.memberIds.has(sixth)).toBe(false);
    expect(inst.vault!.entrantSnapshots!.size).toBe(5);
  });

  it('prunes a departed guest at clear even without a replacement', () => {
    const { sim, owner, join, clear } = encounter();
    const guest = join(202);
    sim.partyKick(guest, owner);
    const outcomes = clear().filter((e) => e.type === 'treasureVaultOutcomePending');
    expect(outcomes[0].claims.map((c) => c.characterId)).toEqual([101]);
  });

  it('reuses the run when a guest enters the reconnected summoner’s new party first', () => {
    const { sim, owner, join, enter, inst, clear } = encounter();
    const guest = join(202);
    sim.removePlayer(owner);
    const returningOwner = sim.addPlayer('warrior', 'Owner', { characterId: 101 });
    sim.setPlayerLevel(20, returningOwner);
    sim.partyInvite(guest, returningOwner);
    sim.partyAccept(guest);
    enter(guest);
    expect(inst.memberIds.has(guest)).toBe(true);
    expect(inst.vault!.ownerPid).toBe(returningOwner);
    expect(sim.riftInstances.filter((candidate) => candidate.partyKey !== null)).toHaveLength(1);
    const outcomes = clear().filter((e) => e.type === 'treasureVaultOutcomePending');
    expect(outcomes[0].claims.map((c) => c.characterId).sort()).toEqual([101, 202]);
  });

  it('announces five-player content at legendary zone-in', () => {
    const { sim, owner } = encounter();
    expect(sim.drainEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'log',
          pid: owner,
          text: expect.stringContaining('is meant for a full party of 5. Tread carefully.'),
        }),
      ]),
    );
  });
});
