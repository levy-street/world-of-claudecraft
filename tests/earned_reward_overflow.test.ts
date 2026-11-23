import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { spendHeroicMarks } from '../src/sim/heroic_marks';
import { heroicLockoutId } from '../src/sim/instances/dungeons';
import { MAIL_READ_EXPIRY_SECONDS } from '../src/sim/mail/post_office';
import { clearHoardRewardChest } from '../src/sim/rift/hoard_reward_chest';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import { expectDefined } from './helpers/defined';

const MAX = Number.MAX_SAFE_INTEGER;
const MARK = 'heroic_mark';

function markLetters(sim: Sim) {
  return sim.serializeMail().mail.filter((letter) => letter.letterId === 'heroic_marks_reward');
}

function redeem(sim: Sim, pid: number, count: number) {
  const previous = expectDefined(sim.meta(pid));
  const character = expectDefined(sim.serializeCharacter(pid));
  const mail = JSON.parse(JSON.stringify(sim.serializeMail()));
  const restored = new Sim({ seed: 52, noPlayer: true, playerClass: previous.cls });
  restored.loadMail(mail);
  const restoredPid = restored.addPlayer(previous.cls, previous.name, {
    characterId: previous.characterId,
    state: character,
  });
  expect(restored.meta(restoredPid)?.heroicMarks).toBe(MAX);
  expect(restored.meta(restoredPid)?.inventory).toEqual(character.inventory);
  expect(restored.meta(restoredPid)?.copper).toBe(character.copper);
  sim = restored;
  pid = restoredPid;
  const meta = expectDefined(sim.meta(pid));
  const player = expectDefined(sim.entities.get(pid));
  const letter = expectDefined(markLetters(sim).find((mail) => mail.recipientName === meta.name));
  expect(letter.items).toEqual([{ itemId: MARK, count }]);
  expect(letter.secondsLeft).toBe(-1);
  // A full mailbox cannot refuse this already-earned reward, nor may an
  // ordinary mail round trip or expiry sweep lose its attached currency.
  expect(markLetters(sim)).toHaveLength(1);
  const saved = expectDefined(markLetters(sim).find((mail) => mail.id === letter.id));
  expect(saved.items).toEqual(letter.items);
  expect(saved.secondsLeft).toBe(-1);
  sim.time += 60 * 24 * 3600;
  sim.tickCount += 20;
  sim.postOffice.update();
  expect(markLetters(sim).find((mail) => mail.id === letter.id)?.secondsLeft).toBe(-1);
  const box = expectDefined(sim.entities.get(sim.postOffice.mailboxIds[0]));
  player.pos = { ...box.pos };
  player.prevPos = { ...box.pos };
  sim.rebucket(player);
  const before = sim.serializeCharacter(pid);
  sim.drainEvents();
  expect(() => sim.mailTake(letter.id, pid)).toThrow(/overflow/);
  expect(sim.serializeCharacter(pid)).toEqual(before);
  expect(markLetters(sim).find((mail) => mail.id === letter.id)?.items).toEqual(letter.items);
  expect(sim.drainEvents()).toEqual([]);
  expect(meta.deedStats.itemsDiscovered.has(MARK)).toBe(false);
  expect(spendHeroicMarks(meta, count)).toBe(true);
  sim.mailTake(letter.id, pid);
  expect(meta.heroicMarks).toBe(MAX);
  expect(meta.deedStats.itemsDiscovered.has(MARK)).toBe(true);
  expect(markLetters(sim).find((mail) => mail.id === letter.id)?.items).toEqual([]);
  expect(markLetters(sim).find((mail) => mail.id === letter.id)?.secondsLeft).toBe(
    MAIL_READ_EXPIRY_SECONDS,
  );
  expect(sim.drainEvents().filter((event) => event.type === 'loot')).toEqual([
    {
      type: 'loot',
      pid,
      text: count === 1 ? 'You receive: Heroic Mark.' : `You receive: Heroic Mark x${count}.`,
    },
  ]);
  const paid = sim.serializeCharacter(pid);
  sim.mailTake(letter.id, pid);
  expect(sim.serializeCharacter(pid)).toEqual(paid);
  sim.time += MAIL_READ_EXPIRY_SECONDS + 1;
  sim.tickCount += 20;
  sim.postOffice.update();
  expect(markLetters(sim).some((mail) => mail.id === letter.id)).toBe(false);
  expect(meta.heroicMarks).toBe(MAX);
}

function heroicRig(dungeon: string, bossId: string, full: boolean) {
  const sim = new Sim({
    seed: 9,
    noPlayer: true,
    playerClass: 'warrior',
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  });
  const leader = sim.addPlayer('warrior', 'Lead', { characterId: 201 });
  const partner = sim.addPlayer('mage', 'Mate', { characterId: 202 });
  for (const pid of [leader, partner])
    sim.removeItem('baked_bread', sim.countItem('baked_bread', pid), pid);
  sim.partyInvite(partner, leader);
  sim.partyAccept(partner);
  if (dungeon === 'nythraxis_boss_arena') {
    for (const pid of [leader, partner])
      expectDefined(sim.meta(pid)).questsDone.add('q_nythraxis_bound_guardian');
    for (let i = 0; i < 3; i++) {
      const anchor = sim.addPlayer('mage', `Anchor${i}`);
      sim.partyInvite(anchor, leader);
      sim.partyAccept(anchor);
    }
    sim.convertPartyToRaid(leader);
  }
  sim.setDungeonDifficulty('heroic', leader);
  if (dungeon === 'nythraxis_boss_arena') {
    sim.enterDungeon('nythraxis_crypt', leader);
    sim.enterDungeon('nythraxis_crypt', partner);
  }
  sim.enterDungeon(dungeon, leader);
  sim.enterDungeon(dungeon, partner);
  const inst = expectDefined(
    sim.instances.find((slot) => slot.dungeonId === dungeon && slot.partyKey !== null),
  );
  const boss = expectDefined(
    inst.mobIds.map((id) => sim.entities.get(id)).find((mob) => mob?.templateId === bossId),
  );
  for (const pid of [leader, partner]) {
    const player = expectDefined(sim.entities.get(pid));
    player.pos = { ...boss.pos, x: boss.pos.x + (pid === leader ? 1 : -1) };
    player.prevPos = { ...player.pos };
    sim.rebucket(player);
  }
  if (full) expectDefined(sim.meta(leader)).heroicMarks = MAX;
  sim.drainEvents();
  return { sim, leader, partner, inst, boss };
}

function hoardRig(full: boolean) {
  const sim = new Sim({ seed: 6120, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const pid = sim.player.id;
  expectDefined(sim.meta(pid)).characterId = 7;
  sim.chat('/dev level 20', pid);
  sim.chat('/dev god', pid);
  sim.removeItem('baked_bread', sim.countItem('baked_bread', pid), pid);
  const portal = { ...sim.player, id: -1, vaultOwnerPid: pid, vaultRarity: 'legendary' as const };
  sim.enterRift(makeVaultSeed(2, 77), 22, pid, undefined, portal);
  const inst = expectDefined(sim.riftInstances.find((slot) => slot.partyKey !== null));
  const boss = expectDefined(sim.entities.get(expectDefined(inst.bossId)));
  sim.player.pos = { ...boss.pos, z: boss.pos.z - 2 };
  boss.hp = 1;
  sim.ctx.dealDamage(sim.player, boss, 9999, false, 'physical', null, 'hit', true);
  for (let step = 0; step < 40; step++) sim.tick();
  const chest = expectDefined(sim.entities.get(expectDefined(inst.vault?.chest).entityId));
  sim.player.pos = { ...chest.pos, z: chest.pos.z - 2 };
  if (full) expectDefined(sim.meta(pid)).heroicMarks = MAX;
  sim.drainEvents();
  return { sim, pid, inst, chest };
}

describe('earned rewards conserve overflow through complete operations', () => {
  it.each([
    ['hollow_crypt', 'morthen', 1],
    ['wildheart_basin', 'wildheart_high_priest', 1],
    ['nythraxis_boss_arena', 'nythraxis_scourge_of_thornpeak', 3],
  ] as const)(
    'completes a lethal %s hit, pays partners and retains overflow',
    (dungeon, bossId, marks) => {
      const normal = heroicRig(dungeon, bossId, false);
      const full = heroicRig(dungeon, bossId, true);
      const draws: number[][] = [[], []];
      for (const [index, rig] of [normal, full].entries()) {
        rig.sim.rng.setObserver((value) => draws[index].push(value));
        const killer = expectDefined(rig.sim.entities.get(rig.leader));
        expect(() =>
          rig.sim.ctx.dealDamage(
            killer,
            rig.boss,
            rig.boss.hp + 10,
            false,
            'physical',
            null,
            'hit',
          ),
        ).not.toThrow();
        expect(rig.boss.dead).toBe(true);
        expect(rig.boss.corpseHarvestState?.priorityMemberKeys).toHaveLength(2);
        for (const pid of [rig.leader, rig.partner]) {
          const meta = expectDefined(rig.sim.meta(pid));
          expect(meta.raidLockouts.get(heroicLockoutId(dungeon))).toBeGreaterThan(0);
          expect(meta.heroicDaily.marked.has(dungeon)).toBe(true);
          expect(rig.inst.clearedBy.has(pid)).toBe(true);
          expect(rig.sim.countItem('wyrmfall_core', pid)).toBeGreaterThan(0);
          expect(meta.counters.xpGained).toBeGreaterThan(0);
          expect(meta.deedStats.dungeonClears[`${dungeon}:heroic`]).toBe(1);
        }
        expect(rig.sim.meta(rig.partner)?.heroicMarks).toBe(marks);
        if (dungeon === 'wildheart_basin') {
          expect(rig.inst.bossExitId).not.toBeNull();
          expect(rig.sim.entities.has(expectDefined(rig.inst.bossExitId))).toBe(true);
        }
      }
      expect(draws[1]).toEqual(draws[0]);
      expect(full.boss.loot).toEqual(normal.boss.loot);
      expect(full.sim.serializeCharacter(full.partner)).toEqual(
        normal.sim.serializeCharacter(normal.partner),
      );
      expect(full.sim.meta(full.leader)?.heroicMarks).toBe(MAX);
      expect(markLetters(full.sim)).toHaveLength(1);
      full.sim.ctx.awardHeroicMarks(
        full.boss,
        [expectDefined(full.sim.meta(full.leader))],
        full.inst,
      );
      expect(markLetters(full.sim)).toHaveLength(1);
      redeem(full.sim, full.leader, marks);
    },
  );

  it.each(['click', 'leave', 'clear'] as const)(
    'conserves one immutable hoard share on %s, then redeems marks once',
    (action) => {
      const normal = hoardRig(false);
      const full = hoardRig(true);
      const draws: number[][] = [[], []];
      for (const [index, rig] of [normal, full].entries()) {
        rig.sim.rng.setObserver((value) => draws[index].push(value));
        // Authored rewards must retain the same full-mailbox exemption.
        for (let i = 0; i < 101; i++)
          rig.sim.postOffice.sendWelcome(expectDefined(rig.sim.meta(rig.pid)));
        expect(() => {
          if (action === 'click') expect(rig.sim.pickUpObject(rig.chest.id, rig.pid)).toBe(true);
          else if (action === 'leave') rig.sim.leaveRift(rig.pid);
          else clearHoardRewardChest(rig.sim.ctx, rig.inst);
        }).not.toThrow();
        expect(
          rig.sim.drainEvents().filter((event) => event.type === 'treasureVaultLooted'),
        ).toHaveLength(1);
        if (action !== 'clear') expect(rig.inst.vault?.chest?.claimed).toEqual([rig.pid]);
        if (action === 'leave') {
          expect(rig.sim.player.pos.x).toBe(rig.inst.returnPos.x);
          expect(rig.sim.player.pos.z).toBe(rig.inst.returnPos.z);
        }
        const afterDraws = [...draws[index]];
        rig.sim.pickUpObject(rig.chest.id, rig.pid);
        clearHoardRewardChest(rig.sim.ctx, rig.inst);
        expect(draws[index]).toEqual(afterDraws);
        expect(
          rig.sim.drainEvents().filter((event) => event.type === 'treasureVaultLooted'),
        ).toEqual([]);
        expect(rig.sim.entities.has(rig.chest.id)).toBe(false);
      }
      expect(draws[1]).toEqual(draws[0]);
      expect(draws[1].length).toBeGreaterThan(0);
      const normalMeta = expectDefined(normal.sim.meta(normal.pid));
      const fullMeta = expectDefined(full.sim.meta(full.pid));
      expect(normalMeta.heroicMarks).toBe(5);
      expect(fullMeta.heroicMarks).toBe(MAX);
      expect(fullMeta.inventory).toEqual(normalMeta.inventory);
      expect(fullMeta.copper).toBe(normalMeta.copper);
      expect(fullMeta.clueCasketsOpened).toBe(normalMeta.clueCasketsOpened);
      expect(fullMeta.counters).toEqual(normalMeta.counters);
      expect(markLetters(full.sim)).toHaveLength(1);
      redeem(full.sim, full.pid, 5);
    },
  );
});
