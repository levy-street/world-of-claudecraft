// Parties, duels, trading, and the dungeon instances. The per-class kit tests
// and elite-mob scaling live in tests/social_classes.test.ts (sharded so
// neither file carries the whole bill); shared fixtures are in
// tests/social_shared.ts. Tests here run on the entity-stripped
// SOCIAL_TEST_WORLD via makeWorld() except the three that fight or loot a
// live camp wolf, which keep the full built-in world via makeFullWorld().
import { describe, expect, it } from 'vitest';
import {
  CRYPT_SPAWNS,
  DUNGEON_X_THRESHOLD,
  DUNGEONS,
  dungeonAt,
  instanceOrigin,
  MOBS,
} from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { type Party, Sim } from '../src/sim/sim';
import { dist2d, type Entity, INTERACT_RANGE, type LootSlot } from '../src/sim/types';
import type { PartyMemberInfo } from '../src/world_api';
import { face, makeFullWorld, makeWorld, mustEntity, nearestMob, teleport } from './social_shared';

function mustParty(sim: Sim, pid: number): Party {
  const party = sim.partyOf(pid);
  if (!party) throw new Error(`missing party for ${pid}`);
  return party;
}

function mustPartyMember(sim: Sim, pid: number): PartyMemberInfo {
  const member = sim.partyInfo?.members.find((m) => m.pid === pid);
  if (!member) throw new Error(`missing party member ${pid}`);
  return member;
}

function fillPartyToFive(sim: Sim, leader: number): number[] {
  const added: number[] = [];
  while ((sim.partyOf(leader)?.members.length ?? 1) < 5) {
    const pid = sim.addPlayer('priest', `RaidFill${added.length}`);
    sim.partyInvite(pid, leader);
    sim.partyAccept(pid);
    added.push(pid);
  }
  return added;
}

describe('parties', () => {
  // Pass makeFullWorld() for the tests that hunt a live camp wolf; the default
  // entity-stripped world covers everything else.
  function makeDuo(sim: Sim = makeWorld()): { sim: Sim; a: number; b: number } {
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    return { sim, a, b };
  }

  // Direct corpse construction (mirroring tests/loot_roll.test.ts's `deadCorpse`)
  // so the kill-time eligible set (`lootRecipientIds`) is controlled deterministically,
  // independent of live positions at loot time. Shared by the round-robin and
  // walk-by autoloot describe blocks below.
  function deadCorpse(
    sim: Sim,
    tapper: number,
    recipients: number[],
    loot: { copper: number; items: LootSlot[] },
  ): Entity {
    const mob = createMob(sim.nextId++, MOBS.forest_wolf, 2, { x: 0, y: 0, z: 0 });
    mob.dead = true;
    mob.lootable = true;
    mob.tappedById = tapper;
    mob.lootRecipientIds = recipients;
    mob.loot = loot;
    sim.entities.set(mob.id, mob);
    return mob;
  }

  it('invite/accept forms a party; leave disbands at 1', () => {
    const { sim, a, b } = makeDuo();
    expect(sim.partyOf(a)?.members).toEqual([a, b]);
    expect(sim.partyOf(a)?.leader).toBe(a);
    sim.partyLeave(b);
    expect(sim.partyOf(a)).toBe(null);
    expect(sim.partyOf(b)).toBe(null);
  });

  it('does not replace a pending party invite', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    sim.partyInvite(b, a);
    sim.partyInvite(b, c);
    sim.partyAccept(b);
    expect(sim.partyOf(a)?.members).toEqual([a, b]);
    expect(sim.partyOf(c)).toBe(null);
  });

  it('allows a new party invite after decline or expiry', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    sim.partyInvite(b, a);
    sim.partyDecline(b);
    sim.partyInvite(b, c);
    sim.partyAccept(b);
    expect(sim.partyOf(c)?.members).toEqual([c, b]);
    expect(sim.partyOf(a)).toBe(null);

    const d = sim.addPlayer('mage', 'Dalet');
    const e = sim.addPlayer('warrior', 'Heh');
    sim.partyInvite(d, a);
    for (let i = 0; i < 20 * 31; i++) sim.tick();
    sim.partyInvite(d, e);
    sim.partyAccept(d);
    expect(sim.partyOf(e)?.members).toEqual([e, d]);
    expect(sim.partyOf(a)).toBe(null);
  });

  it('refuses to accept an invite while already in a party', () => {
    // A player can become a party leader (by inviting someone who accepts)
    // while still holding an unconsumed incoming invite — inviting someone
    // never consumes the inviter's own pending invite. Accepting that stale
    // invite must NOT leave the player a member of two parties at once.
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const c = sim.addPlayer('rogue', 'Gimel');
    const d = sim.addPlayer('mage', 'Dalet');
    // C invites A while A is solo (stored, unaccepted).
    sim.partyInvite(a, c);
    // A forms a party of its own by inviting D, who accepts. A is now leader.
    sim.partyInvite(d, a);
    sim.partyAccept(d);
    expect(sim.partyOf(a)?.leader).toBe(a);
    const ownParty = sim.partyOf(a)?.id;
    // A now accepts C's stale invite — this must be rejected.
    sim.partyAccept(a);
    // A stays in its own party only; no second membership is created.
    expect(sim.partyOf(a)?.id).toBe(ownParty);
    expect(sim.partyOf(c)?.members.includes(a) ?? false).toBe(false);
    expect(sim.partyOf(a)?.members).toEqual([a, d]);
  });

  it('partyInfo reports per-member combat state for the UI badges', () => {
    const { sim, b } = makeDuo();
    // out of combat by default
    const before = mustPartyMember(sim, b);
    expect(before.inCombat).toBe(0);
    // engaging a member flips its flag in the next info read
    mustEntity(sim, b).inCombat = true;
    const after = mustPartyMember(sim, b);
    expect(after.inCombat).toBe(1);
    // and the dead flag stays independent of combat
    expect(after.dead).toBe(0);
  });

  it('partyInfo carries member position so the minimap can place them', () => {
    const { sim, b } = makeDuo();
    teleport(sim, b, 17, -23);
    const info = mustPartyMember(sim, b);
    expect(info.x).toBeCloseTo(17, 3);
    expect(info.z).toBeCloseTo(-23, 3);
  });

  it('partyInfo produces tactical frame data and filters auras before the cap', () => {
    const { sim, a, b } = makeDuo();
    const member = mustEntity(sim, b);
    const meta = sim.meta(b);
    if (!meta) throw new Error('missing party member metadata');
    meta.talentMods.role = 'healer';
    for (let i = 0; i < 8; i++) {
      member.auras.push({
        id: `maintenance_${i}`,
        name: `Maintenance ${i}`,
        kind: 'buff_ap',
        remaining: 60,
        duration: 60,
        value: 5,
        sourceId: b,
        school: 'physical',
      });
    }
    member.auras.push({
      id: 'power_word_shield',
      name: 'Psalm of Warding',
      kind: 'absorb',
      remaining: 4.2,
      duration: 12,
      value: 75,
      sourceId: b,
      school: 'holy',
    });
    const hostile = createMob(sim.nextId++, MOBS.forest_wolf, 2, { x: 0, y: 0, z: 0 });
    hostile.aggroTargetId = b;
    sim.entities.set(hostile.id, hostile);
    member.castingAbility = 'lesser_heal';
    member.castTargetId = a;

    const memberInfo = mustPartyMember(sim, b);
    expect(memberInfo).toMatchObject({
      absorb: 75,
      role: 'healer',
      connected: 1,
      hasAggro: 1,
    });
    expect(memberInfo.auras).toEqual([{ id: 'power_word_shield', kind: 'absorb', remaining: 5 }]);
    expect(mustPartyMember(sim, a).incomingHeal).toBe(52.5);
  });

  it('converts a party to a two-group raid with a ten player cap', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    const pids = Array.from({ length: 10 }, (_, i) => sim.addPlayer('priest', `Raid${i}`));
    for (const pid of pids.slice(0, 3)) {
      sim.partyInvite(pid, leader);
      sim.partyAccept(pid);
    }
    sim.convertPartyToRaid(leader);
    expect(sim.partyOf(leader)?.raid).toBe(false);
    sim.partyInvite(pids[3], leader);
    sim.partyAccept(pids[3]);
    sim.convertPartyToRaid(leader);
    for (const pid of pids.slice(4, 9)) {
      sim.partyInvite(pid, leader);
      sim.partyAccept(pid);
    }
    const party = mustParty(sim, leader);
    expect(party.raid).toBe(true);
    expect(party.members).toHaveLength(10);
    expect(party.members.filter((pid) => party.raidGroups.get(pid) === 1)).toHaveLength(5);
    expect(party.members.filter((pid) => party.raidGroups.get(pid) === 2)).toHaveLength(5);

    sim.partyInvite(pids[9], leader);
    sim.partyAccept(pids[9]);
    expect(sim.partyOf(pids[9])).toBeNull();
    expect(party.members).toHaveLength(10);
  });

  it('only the raid leader can move members between raid groups', () => {
    const { sim, a, b } = makeDuo();
    const [c] = fillPartyToFive(sim, a);
    sim.convertPartyToRaid(a);
    sim.moveRaidMember(c, 2, b);
    expect(sim.partyOf(a)?.raidGroups.get(c)).toBe(1);
    sim.moveRaidMember(c, 2, a);
    expect(sim.partyOf(a)?.raidGroups.get(c)).toBe(2);
    expect(sim.partyInfo?.raid).toBe(true);
    expect(sim.partyInfo?.members.find((m) => m.pid === c)?.group).toBe(2);
  });

  it('lets the raid leader convert a small raid (<= 5) back to a party', () => {
    const { sim, a, b } = makeDuo();
    const members = fillPartyToFive(sim, a);
    sim.convertPartyToRaid(a);
    expect(sim.partyOf(a)?.raid).toBe(true);

    // only the leader may demote
    sim.convertRaidToParty(b);
    expect(sim.partyOf(a)?.raid).toBe(true);

    sim.convertRaidToParty(a);
    const party = mustParty(sim, a);
    expect(party.raid).toBe(false);
    expect(party.raidGroups.size).toBe(0);
    // membership is preserved; the group is intact, just no longer a raid
    expect(party.members).toHaveLength(5);
    expect(sim.partyInfo?.raid).toBe(false);

    // converting again when it is no longer a raid is a no-op (already a party)
    sim.convertRaidToParty(a);
    expect(sim.partyOf(a)?.raid).toBe(false);
    void members;
  });

  it('refuses to demote a raid larger than one party (> 5 members)', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'BigLeader');
    const pids = Array.from({ length: 9 }, (_, i) => sim.addPlayer('priest', `Big${i}`));
    fillPartyToFive(sim, leader);
    sim.convertPartyToRaid(leader);
    for (const pid of pids.slice(0, 5)) {
      sim.partyInvite(pid, leader);
      sim.partyAccept(pid);
    }
    const party = mustParty(sim, leader);
    expect(party.members.length).toBeGreaterThan(5);
    sim.convertRaidToParty(leader);
    expect(party.raid).toBe(true);
  });

  it('blocks raid groups from standard dungeons while requiring raid groups for Nythraxis entry', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    sim.players.get(leader)?.questsDone.add('q_nythraxis_bound_guardian');
    sim.enterDungeon('nythraxis_boss_arena', leader);
    expect(sim.entities.get(leader)?.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);

    fillPartyToFive(sim, leader);
    sim.convertPartyToRaid(leader);
    sim.enterDungeon('sunken_bastion', leader);
    expect(sim.entities.get(leader)?.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
    sim.enterDungeon('nythraxis_boss_arena', leader);
    expect(dungeonAt(mustEntity(sim, leader).pos.x)?.id).toBe('nythraxis_boss_arena');
  });

  it('party members share kill xp with the group bonus and quest credit', () => {
    const { sim, a, b } = makeDuo(makeFullWorld()); // hunts a live camp wolf
    // both accept the wolf quest
    teleport(sim, a, 4, 4);
    teleport(sim, b, 4, 5);
    sim.acceptQuest('q_wolves', a);
    sim.acceptQuest('q_wolves', b);
    const wolf = nearestMob(sim, 'forest_wolf');
    wolf.hp = 1;
    teleport(sim, a, wolf.pos.x + 2, wolf.pos.z);
    teleport(sim, b, wolf.pos.x - 2, wolf.pos.z);
    sim.targetEntity(wolf.id, a);
    face(sim, a, wolf.id);
    sim.startAutoAttack(a);
    for (let i = 0; i < 20 * 20 && !wolf.dead; i++) {
      face(sim, a, wolf.id);
      sim.tick();
    }
    expect(wolf.dead).toBe(true);
    const metaA = sim.meta(a)!;
    const metaB = sim.meta(b)!;
    // both got xp (half of solo, with 1.166 duo bonus applied)
    expect(metaA.xp).toBeGreaterThan(0);
    expect(metaB.xp).toBeGreaterThan(0);
    expect(metaA.xp).toBe(Math.round((50 * 1.166) / 2));
    // both got quest credit
    expect(metaA.questLog.get('q_wolves')?.counts[0]).toBe(1);
    expect(metaB.questLog.get('q_wolves')?.counts[0]).toBe(1);
  });

  it("party members may loot each other's tapped kills and split copper", () => {
    const { sim, a, b } = makeDuo(makeFullWorld()); // hunts a live camp wolf
    const wolf = nearestMob(sim, 'forest_wolf');
    wolf.hp = 1;
    teleport(sim, a, wolf.pos.x + 2, wolf.pos.z);
    teleport(sim, b, wolf.pos.x - 2, wolf.pos.z);
    sim.targetEntity(wolf.id, a);
    face(sim, a, wolf.id);
    sim.startAutoAttack(a);
    for (let i = 0; i < 20 * 20 && !wolf.dead; i++) {
      face(sim, a, wolf.id);
      sim.tick();
    }
    expect(wolf.lootable).toBe(true);
    const copper = wolf.loot?.copper;
    const aBefore = sim.meta(a)?.copper ?? 0;
    const bBefore = sim.meta(b)?.copper ?? 0;
    sim.lootCorpse(wolf.id, b);
    const aGain = (sim.meta(a)?.copper ?? 0) - aBefore;
    const bGain = (sim.meta(b)?.copper ?? 0) - bBefore;
    expect(aGain + bGain).toBe(copper);
    expect(Math.abs(aGain - bGain)).toBeLessThanOrEqual(1);
  });

  it('non-party members cannot loot tapped kills', () => {
    const sim = makeFullWorld(); // hunts a live camp wolf
    const a = sim.addPlayer('warrior', 'Aleph');
    const c = sim.addPlayer('rogue', 'Gimel');
    const wolf = nearestMob(sim, 'forest_wolf');
    wolf.hp = 1;
    teleport(sim, a, wolf.pos.x + 2, wolf.pos.z);
    teleport(sim, c, wolf.pos.x - 2, wolf.pos.z);
    sim.targetEntity(wolf.id, a);
    face(sim, a, wolf.id);
    sim.startAutoAttack(a);
    for (let i = 0; i < 20 * 20 && !wolf.dead; i++) {
      face(sim, a, wolf.id);
      sim.tick();
    }
    sim.lootCorpse(wolf.id, c);
    expect(sim.meta(c)?.copper).toBe(0);
    expect(wolf.lootable).toBe(true);
  });

  describe('round-robin common-item distribution', () => {
    it('rotates a common drop over the kill-time eligible members, not just who is close enough to loot', () => {
      const { sim, a, b } = makeDuo();
      // A stays on the corpse and does the actual looting each time. B is well
      // outside INTERACT_RANGE, but was within PARTY_XP_RANGE at kill time, so B
      // is still a kill-time loot recipient (`lootRecipientIds`). Round-robin must
      // rotate over that kill-time set, not the loot-time in-range set: that is the
      // whole fairness point.
      teleport(sim, a, 0, 1);
      teleport(sim, b, 60, 60);

      const mob1 = deadCorpse(sim, a, [a, b], {
        copper: 0,
        items: [{ itemId: 'worn_sword', count: 1 }],
      });
      sim.lootCorpse(mob1.id, a);
      expect(sim.countItem('worn_sword', a)).toBe(1);
      expect(sim.countItem('worn_sword', b)).toBe(0);

      const mob2 = deadCorpse(sim, a, [a, b], {
        copper: 0,
        items: [{ itemId: 'worn_sword', count: 1 }],
      });
      sim.lootCorpse(mob2.id, a);
      // The second kill's drop rotates to B even though B never came near either
      // corpse: across the two kills, both A's and B's bags gain the item.
      expect(sim.countItem('worn_sword', a)).toBe(1);
      expect(sim.countItem('worn_sword', b)).toBe(1);
    });

    it('spreads multiple common drops on one corpse across members (per-item cursor advance)', () => {
      const { sim, a, b } = makeDuo();
      teleport(sim, a, 0, 1);
      const mob = deadCorpse(sim, a, [a, b], {
        copper: 0,
        items: [
          { itemId: 'worn_sword', count: 1 },
          { itemId: 'rusty_dagger', count: 1 },
        ],
      });
      sim.lootCorpse(mob.id, a);
      const aCount = sim.countItem('worn_sword', a) + sim.countItem('rusty_dagger', a);
      const bCount = sim.countItem('worn_sword', b) + sim.countItem('rusty_dagger', b);
      expect(aCount + bCount).toBe(2);
      // Both drops must not land on the single looter: the cursor advances once
      // per awarded item, so a single kill with two common drops still spreads.
      expect(aCount).toBe(1);
      expect(bCount).toBe(1);
    });

    it('declines round-robin with a single kill-time candidate; the looter gets the item', () => {
      const { sim, a, b } = makeDuo();
      teleport(sim, a, 0, 1);
      // B was not a kill-time recipient (e.g. too far at the moment of the kill),
      // so the eligible set for this corpse is just A.
      const mob = deadCorpse(sim, a, [a], {
        copper: 0,
        items: [{ itemId: 'worn_sword', count: 1 }],
      });
      sim.lootCorpse(mob.id, a);
      expect(sim.countItem('worn_sword', a)).toBe(1);
      expect(sim.countItem('worn_sword', b)).toBe(0);
    });

    it('never round-robins a premium drop; it still opens a need/greed roll', () => {
      const { sim, a, b } = makeDuo();
      teleport(sim, a, 0, 1);
      const mob = deadCorpse(sim, a, [a, b], {
        copper: 0,
        items: [{ itemId: 'greyjaw_hide_boots', count: 1 }],
      });
      sim.lootCorpse(mob.id, a);
      // Not instantly awarded to anyone: it is a pending need/greed roll.
      expect(sim.countItem('greyjaw_hide_boots', a)).toBe(0);
      expect(sim.countItem('greyjaw_hide_boots', b)).toBe(0);
      expect(sim.events.some((e) => e.type === 'lootRoll')).toBe(true);
    });
  });

  describe('walk-by autoloot (autoLootForParty)', () => {
    it('an eligible triggerer in range clears the corpse: fair-split copper plus round-robin common item', () => {
      const { sim, a, b } = makeDuo();
      teleport(sim, a, 0, 1);
      const mob = deadCorpse(sim, a, [a, b], {
        copper: 10,
        items: [{ itemId: 'worn_sword', count: 1 }],
      });
      const aBefore = sim.meta(a)?.copper ?? 0;
      const bBefore = sim.meta(b)?.copper ?? 0;
      sim.autoLoot(mob.id, a);
      const aGain = (sim.meta(a)?.copper ?? 0) - aBefore;
      const bGain = (sim.meta(b)?.copper ?? 0) - bBefore;
      // copper fair-splits across the two kill-time recipients, same as manual loot.
      expect(aGain + bGain).toBe(10);
      expect(Math.abs(aGain - bGain)).toBeLessThanOrEqual(1);
      // the common item round-robins to exactly one recipient.
      expect(sim.countItem('worn_sword', a) + sim.countItem('worn_sword', b)).toBe(1);
      // the corpse is fully cleared by the delegated lootCorpse distribution.
      // the emptied wolf corpse stays lootable through its
      // unclaimed-harvest grace window instead of collapsing immediately.
      expect(mob.lootable).toBe(true);
      expect(mob.loot).toBeNull();
      expect(sim.events.some((e) => e.type === 'error')).toBe(false);
    });

    it("a stranger's corpse yields no loot and the silent pass emits no error event", () => {
      const { sim, a, b } = makeDuo();
      const stranger = sim.addPlayer('rogue', 'Gimel');
      teleport(sim, a, 0, 1);
      teleport(sim, stranger, 0, 1);
      const mob = deadCorpse(sim, a, [a, b], {
        copper: 10,
        items: [{ itemId: 'worn_sword', count: 1 }],
      });
      sim.autoLoot(mob.id, stranger);
      expect(sim.meta(stranger)?.copper ?? 0).toBe(0);
      expect(sim.countItem('worn_sword', stranger)).toBe(0);
      expect(mob.lootable).toBe(true);
      expect(mob.loot?.copper).toBe(10);
      // the whole point of the walk-by pass: ineligibility never surfaces an error toast,
      // unlike a manual lootCorpse attempt on the same corpse.
      expect(sim.events.some((e) => e.type === 'error')).toBe(false);
    });

    it('an out-of-INTERACT_RANGE triggerer loots nothing, silently', () => {
      const { sim, a, b } = makeDuo();
      teleport(sim, a, 60, 60);
      const mob = deadCorpse(sim, a, [a, b], {
        copper: 10,
        items: [{ itemId: 'worn_sword', count: 1 }],
      });
      expect(dist2d(mustEntity(sim, a).pos, mob.pos)).toBeGreaterThan(INTERACT_RANGE);
      sim.autoLoot(mob.id, a);
      expect(sim.meta(a)?.copper ?? 0).toBe(0);
      expect(sim.countItem('worn_sword', a)).toBe(0);
      expect(mob.lootable).toBe(true);
      expect(sim.events.some((e) => e.type === 'error')).toBe(false);
    });

    it('a triggerer physically inside a raid instance loots nothing, silently; the same player back in the open world still loots as a control', () => {
      const { sim, a, b } = makeDuo();
      const origin = instanceOrigin(DUNGEONS.nythraxis_boss_arena.index, 0);
      teleport(sim, a, origin.x, origin.z + 1);
      const raidMob = deadCorpse(sim, a, [a, b], {
        copper: 10,
        items: [{ itemId: 'worn_sword', count: 1 }],
      });
      raidMob.pos = { x: origin.x, y: 0, z: origin.z };
      sim.autoLoot(raidMob.id, a);
      expect(sim.meta(a)?.copper ?? 0).toBe(0);
      expect(sim.countItem('worn_sword', a)).toBe(0);
      expect(raidMob.lootable).toBe(true);
      expect(raidMob.loot?.copper).toBe(10);
      expect(sim.events.some((e) => e.type === 'error')).toBe(false);

      // control: same player, back in the open world, loots normally.
      teleport(sim, a, 0, 1);
      const openMob = deadCorpse(sim, a, [a, b], {
        copper: 10,
        items: [{ itemId: 'worn_sword', count: 1 }],
      });
      sim.autoLoot(openMob.id, a);
      expect(sim.meta(a)?.copper ?? 0).toBeGreaterThan(0);
      // Grace window: emptied but still owed its unclaimed harvest.
      expect(openMob.lootable).toBe(true);
      expect(openMob.loot).toBeNull();
    });

    it("does not auto-loot a stranger's corpse after it goes FFA, though a deliberate manual loot still can", () => {
      const { sim, a } = makeDuo();
      const stranger = sim.addPlayer('rogue', 'Gimel');
      teleport(sim, a, 0, 1);
      // A stranger (not in a's party) tapped this corpse, and its owner-lock has lapsed to FFA.
      const mob = deadCorpse(sim, stranger, [stranger], {
        copper: 10,
        items: [{ itemId: 'worn_sword', count: 1 }],
      });
      mob.lootFfaTimer = 0; // FFA unlocked (owner-lock lapsed)
      // Walk-by refuses even though the corpse is now free-for-all: auto-grabbing
      // another player's aged-out loot reads as hostile. Silent, corpse untouched.
      sim.autoLoot(mob.id, a);
      expect(sim.meta(a)?.copper ?? 0).toBe(0);
      expect(sim.countItem('worn_sword', a)).toBe(0);
      expect(mob.lootable).toBe(true);
      expect(sim.events.some((e) => e.type === 'error')).toBe(false);
      // A deliberate manual loot on the same FFA corpse still works (manual honors FFA).
      sim.lootCorpse(mob.id, a);
      expect(sim.countItem('worn_sword', a)).toBe(1);
      // Grace window: emptied but still owed its unclaimed harvest.
      expect(mob.lootable).toBe(true);
      expect(mob.loot).toBeNull();
    });
  });
});

describe('duels', () => {
  it('full duel flow: challenge, countdown, fight to 1hp, winner declared', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    sim.duelRequest(b, a);
    sim.duelAccept(b);
    expect(sim.duelFor(a)?.state).toBe('countdown');
    // players can't hit each other during countdown
    sim.targetEntity(b, a);
    face(sim, a, b);
    sim.startAutoAttack(a);
    expect(sim.entities.get(a)?.autoAttack).toBe(false); // rejected: not hostile yet
    for (let i = 0; i < 20 * 4; i++) sim.tick();
    expect(sim.duelFor(a)?.state).toBe('active');
    // now combat works
    const eb = sim.entities.get(b)!;
    eb.hp = 10; // hasten the end
    sim.startAutoAttack(a);
    expect(sim.entities.get(a)?.autoAttack).toBe(true);
    let ended = false;
    let winnerEvent: any = null;
    for (let i = 0; i < 20 * 30 && !ended; i++) {
      face(sim, a, b);
      const events = sim.tick();
      const end = events.find((e) => e.type === 'duelEnd');
      if (end) {
        ended = true;
        winnerEvent = end;
      }
    }
    expect(ended).toBe(true);
    expect(winnerEvent.winnerName).toBe('Aleph');
    expect(eb.hp).toBeGreaterThanOrEqual(1); // nobody dies in a duel
    expect(eb.dead).toBe(false);
    expect(sim.duelFor(a)).toBe(null);
  });

  it('does not replace a pending duel challenge', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    teleport(sim, c, 6, -40);
    sim.duelRequest(b, a);
    sim.duelRequest(b, c);
    sim.duelAccept(b);
    expect(sim.duelFor(a)?.a).toBe(a);
    expect(sim.duelFor(a)?.b).toBe(b);
    expect(sim.duelFor(c)).toBe(null);
  });

  it('blocks other social invites until a pending duel is answered or expires', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    teleport(sim, c, 6, -40);
    sim.duelRequest(b, a);
    sim.partyInvite(b, c);
    sim.duelDecline(b);
    sim.partyInvite(b, c);
    sim.partyAccept(b);
    expect(sim.partyOf(c)?.members).toEqual([c, b]);
    expect(sim.duelFor(a)).toBe(null);

    const d = sim.addPlayer('priest', 'Dalet');
    teleport(sim, d, 9, -40);
    sim.duelRequest(d, a);
    for (let i = 0; i < 20 * 31; i++) sim.tick();
    sim.partyInvite(d, c);
    sim.partyAccept(d);
    expect(sim.partyOf(c)?.members).toContain(d);
  });
});

describe('trading', () => {
  it('atomic trade of items and copper', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    sim.addItem('wolf_fang', 3, a);
    sim.meta(a)!.copper = 100;
    sim.meta(b)!.copper = 50;
    sim.addItem('baked_bread', 1, b);
    const breadA = sim.countItem('baked_bread', a);
    const breadB = sim.countItem('baked_bread', b);

    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    expect(sim.tradeFor(a)).toBeTruthy();
    sim.tradeSetOffer([{ itemId: 'wolf_fang', count: 2 }], 30, a);
    sim.tradeSetOffer([{ itemId: 'baked_bread', count: 1 }], 10, b);
    sim.tradeConfirm(a);
    expect(sim.tradeFor(a)).toBeTruthy(); // not done until both confirm
    sim.tradeConfirm(b);
    expect(sim.tradeFor(a)).toBe(null);
    expect(sim.countItem('wolf_fang', a)).toBe(1);
    expect(sim.countItem('wolf_fang', b)).toBe(2);
    expect(sim.countItem('baked_bread', a)).toBe(breadA + 1);
    expect(sim.countItem('baked_bread', b)).toBe(breadB - 1);
    expect(sim.meta(a)?.copper).toBe(100 - 30 + 10);
    expect(sim.meta(b)?.copper).toBe(50 - 10 + 30);
  });

  it('trades counted same-payload instanced stacks on the REAL Sim, merging on receive (12d QA)', () => {
    // Every other instanced-trade pin drives the stub ctx in tests/trade.test.ts
    // (a hand-copied removeItem walk); this one drives the real Sim end to end
    // so stub drift can never hide a real-path regression: partial-stack legs
    // both directions, BOTH sides offering the same payload in one confirm
    // (merge-on-receive on both ends), and per-payload unit conservation.
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    for (let i = 0; i < 4; i++) sim.addItemInstance('wolf_fang', { signer: 'Cyn' }, a);
    for (let i = 0; i < 3; i++) sim.addItemInstance('wolf_fang', { signer: 'Cyn' }, b);
    const fangsOf = (pid: number) =>
      sim.meta(pid)!.inventory.filter((s) => s.itemId === 'wolf_fang');
    expect(fangsOf(a)).toEqual([{ itemId: 'wolf_fang', count: 4, instance: { signer: 'Cyn' } }]);
    expect(fangsOf(b)).toEqual([{ itemId: 'wolf_fang', count: 3, instance: { signer: 'Cyn' } }]);

    sim.drainEvents();
    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    sim.tradeSetOffer([{ itemId: 'wolf_fang', count: 2 }], 0, a); // partial stack A -> B
    sim.tradeSetOffer([{ itemId: 'wolf_fang', count: 3 }], 0, b); // whole stack B -> A
    sim.tradeConfirm(a);
    sim.tradeConfirm(b);
    expect(sim.tradeFor(a)).toBe(null);
    // Merge-on-receive on both ends: one counted slot each, 7 units conserved.
    expect(fangsOf(a)).toEqual([{ itemId: 'wolf_fang', count: 5, instance: { signer: 'Cyn' } }]);
    expect(fangsOf(b)).toEqual([{ itemId: 'wolf_fang', count: 2, instance: { signer: 'Cyn' } }]);

    // Second leg back: B returns its remainder; A reunites the full seven.
    sim.tradeRequest(a, b);
    sim.tradeAccept(a);
    sim.tradeSetOffer([{ itemId: 'wolf_fang', count: 2 }], 0, b);
    sim.tradeSetOffer([], 0, a);
    sim.tradeConfirm(b);
    sim.tradeConfirm(a);
    expect(fangsOf(a)).toEqual([{ itemId: 'wolf_fang', count: 7, instance: { signer: 'Cyn' } }]);
    expect(fangsOf(b)).toEqual([]);
    expect(sim.drainEvents().some((e) => e.type === 'error')).toBe(false);
  });

  it('does not replace a pending trade request', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    teleport(sim, c, 6, -40);
    sim.tradeRequest(b, a);
    sim.tradeRequest(b, c);
    sim.tradeAccept(b);
    expect(sim.tradeFor(a)).toBeTruthy();
    expect(sim.tradeFor(c)).toBe(null);
  });

  it('trade cancels when players walk apart', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    expect(sim.tradeFor(a)).toBeTruthy();
    teleport(sim, b, 40, -40);
    sim.tick();
    expect(sim.tradeFor(a)).toBe(null);
  });

  it('duplicate offer slots cannot duplicate items', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    sim.addItem('wolf_fang', 5, a);
    sim.meta(a)!.copper = 100;
    sim.meta(b)!.copper = 50;
    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    // exploit attempt: 6 duplicate slots, each individually covered by the bags
    const dup = Array.from({ length: 6 }, () => ({ itemId: 'wolf_fang', count: 5 }));
    sim.tradeSetOffer(dup, 0, a);
    // the merged total (30) exceeds the bags (5), so the offer must be rejected
    expect(sim.tradeFor(a)?.offerA.items.length).toBe(0);
    sim.tradeConfirm(a);
    sim.tradeConfirm(b);
    expect(sim.tradeFor(a)).toBe(null);
    expect(sim.countItem('wolf_fang', a)).toBe(5);
    expect(sim.countItem('wolf_fang', b)).toBe(0);
    expect(sim.countItem('wolf_fang', a) + sim.countItem('wolf_fang', b)).toBe(5);
    expect(sim.meta(a)?.copper).toBe(100);
    expect(sim.meta(b)?.copper).toBe(50);
  });

  it('malformed offer slots are rejected, not crashed or duplicated', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    sim.addItem('wolf_fang', 5, a);
    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    // garbage straight off the wire: null slot, non-numeric and non-finite counts
    const junk = [
      null,
      { itemId: 'wolf_fang', count: 'lots' },
      { itemId: 'wolf_fang', count: NaN },
      { itemId: 'wolf_fang', count: Infinity },
      { count: 3 },
      { itemId: 'wolf_fang', count: 2 },
    ] as any;
    // must not throw, and only the one valid slot survives
    expect(() => sim.tradeSetOffer(junk, 0, a)).not.toThrow();
    expect(sim.tradeFor(a)?.offerA.items).toEqual([{ itemId: 'wolf_fang', count: 2 }]);
    sim.tradeConfirm(a);
    sim.tradeConfirm(b);
    expect(sim.tradeFor(a)).toBe(null);
    // no NaN corruption: totals are conserved
    expect(sim.countItem('wolf_fang', a)).toBe(3);
    expect(sim.countItem('wolf_fang', b)).toBe(2);
  });

  it('duplicate slots within the bags merge and trade normally', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    sim.addItem('wolf_fang', 5, a);
    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    // two slots of 2 totals 4, within the 5 held — merged into one slot of 4
    sim.tradeSetOffer(
      [
        { itemId: 'wolf_fang', count: 2 },
        { itemId: 'wolf_fang', count: 2 },
      ],
      0,
      a,
    );
    expect(sim.tradeFor(a)?.offerA.items).toEqual([{ itemId: 'wolf_fang', count: 4 }]);
    sim.tradeConfirm(a);
    sim.tradeConfirm(b);
    expect(sim.tradeFor(a)).toBe(null);
    expect(sim.countItem('wolf_fang', a)).toBe(1);
    expect(sim.countItem('wolf_fang', b)).toBe(4);
  });

  it('quest items cannot be traded', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    sim.addItem('boar_hide', 2, a);
    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    sim.tradeSetOffer([{ itemId: 'boar_hide', count: 2 }], 0, a);
    expect(sim.tradeFor(a)?.offerA.items.length).toBe(0);
  });

  it('mech chroma plates can be traded directly', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    sim.addItem('vanguard_chrome_armor_plate', 1, a);

    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    sim.tradeSetOffer([{ itemId: 'vanguard_chrome_armor_plate', count: 1 }], 0, a);
    sim.tradeConfirm(a);
    sim.tradeConfirm(b);

    expect(sim.tradeFor(a)).toBe(null);
    expect(sim.countItem('vanguard_chrome_armor_plate', a)).toBe(0);
    expect(sim.countItem('vanguard_chrome_armor_plate', b)).toBe(1);
  });
});

describe('the Hollow Crypt', () => {
  it('party members enter the same instance; strangers get their own', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    for (const pid of [a, b, c]) teleport(sim, pid, 80, 88);
    sim.enterCrypt(a);
    sim.enterCrypt(b);
    sim.enterCrypt(c);
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    const ec = sim.entities.get(c)!;
    expect(sim.instanceSlotAt(ea.pos)).toBe(sim.instanceSlotAt(eb.pos));
    expect(sim.instanceSlotAt(ec.pos)).not.toBe(sim.instanceSlotAt(ea.pos));
    // elites spawned in each claimed instance
    const slotA = sim.instanceSlotAt(ea.pos)!;
    const originA = instanceOrigin(0, slotA);
    const bossA = nearestMob(sim, 'morthen', originA);
    expect(bossA).toBeTruthy();
    expect(Math.abs(bossA.pos.x - originA.x)).toBeLessThan(50);
    expect(sim.instances.filter((i) => i.partyKey !== null).length).toBe(2);
    // exit returns to the chapel door
    sim.leaveCrypt(a);
    expect(ea.pos.x).toBeLessThan(200);
  });

  it('crypt has the full spawn set and Morthen pulses in combat', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, 80, 88);
    sim.enterCrypt(a);
    const slot = sim.instanceSlotAt(mustEntity(sim, a).pos) ?? 0;
    const origin = instanceOrigin(0, slot);
    const cryptMobs = [...sim.entities.values()].filter(
      (e) =>
        e.kind === 'mob' &&
        Math.abs(e.pos.x - origin.x) < 120 &&
        Math.abs(e.pos.z - origin.z) < 250,
    );
    expect(cryptMobs.length).toBe(CRYPT_SPAWNS.length);
    // walk the player onto the boss: pulse should hit within ~12s
    const boss = nearestMob(sim, 'morthen', origin);
    const ea = sim.entities.get(a)!;
    sim.setPlayerLevel(10, a);
    ea.hp = ea.maxHp;
    teleport(sim, a, boss.pos.x + 2, boss.pos.z);
    sim.targetEntity(boss.id, a);
    face(sim, a, boss.id);
    sim.startAutoAttack(a);
    let pulsed = false;
    for (let i = 0; i < 20 * 25 && !pulsed; i++) {
      face(sim, a, boss.id);
      const events = sim.tick();
      if (
        events.some((e) => e.type === 'damage' && e.ability === 'Shadow Pulse' && e.targetId === a)
      )
        pulsed = true;
      if (ea.dead) break;
    }
    expect(pulsed).toBe(true);
  });

  it('the storyline chain gates the dungeon quest', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    expect(sim.questState('q_whispers')).toBe('unavailable'); // needs q_bones
    expect(sim.questState('q_rite')).toBe('unavailable');
    expect(sim.questState('q_hollow')).toBe('unavailable');
    sim.questsDone.add('q_bones');
    expect(sim.questState('q_whispers')).toBe('available');
    sim.questsDone.add('q_whispers');
    expect(sim.questState('q_rite')).toBe('available');
    sim.questsDone.add('q_rite');
    expect(sim.questState('q_hollow')).toBe('available');
  });
});

describe('the new dungeons', () => {
  it('the Sunken Bastion and Gravewyrm Sanctum are enterable with full spawn sets', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, 45, 511);
    sim.enterDungeon('sunken_bastion', a);
    const ea = sim.entities.get(a)!;
    expect(ea.pos.x).toBeGreaterThan(1400); // index-1 band
    const slot = sim.instanceSlotAt(ea.pos)!;
    const origin = instanceOrigin(1, slot);
    const vael = nearestMob(sim, 'vael_the_mistcaller', origin);
    expect(vael).toBeTruthy();
    sim.leaveDungeon(a);
    expect(dist2d(ea.pos, { x: 45, y: 0, z: 515 })).toBeLessThan(10);

    teleport(sim, a, 0, 858);
    sim.enterDungeon('gravewyrm_sanctum', a);
    expect(ea.pos.x).toBeGreaterThan(2000); // index-2 band
    const slot2 = sim.instanceSlotAt(ea.pos)!;
    const origin2 = instanceOrigin(2, slot2);
    const korzul = nearestMob(sim, 'korzul_the_gravewyrm', origin2);
    expect(korzul).toBeTruthy();
    expect(korzul.level).toBe(20);
    sim.leaveDungeon(a);
    expect(dist2d(ea.pos, { x: 0, y: 0, z: 858 })).toBeLessThan(10);
  });

  it('Velkhar summons add waves at hp thresholds and Korgath enrages below 30%', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, 0, 876);
    sim.enterDungeon('gravewyrm_sanctum', a);
    const ea = sim.entities.get(a)!;
    const origin = instanceOrigin(2, sim.instanceSlotAt(ea.pos)!);

    // Velkhar: drop below 66% then 33% -> two waves of 3 raised_bonewalker
    const velkhar = nearestMob(sim, 'grand_necromancer_velkhar', origin);
    expect(velkhar).toBeTruthy();
    const addsNear = () =>
      [...sim.entities.values()].filter(
        (e) =>
          e.kind === 'mob' &&
          !e.dead &&
          e.templateId === 'raised_bonewalker' &&
          Math.abs(e.pos.x - origin.x) < 120,
      ).length;
    expect(addsNear()).toBe(0);
    velkhar.inCombat = true;
    velkhar.hp = Math.floor(velkhar.maxHp * 0.6);
    sim.tick();
    expect(addsNear()).toBe(3);
    velkhar.hp = Math.floor(velkhar.maxHp * 0.3);
    sim.tick();
    expect(addsNear()).toBe(6);

    // Korgath: enrage flag flips once below 30% and boosts swing damage
    const korgath = nearestMob(sim, 'korgath_the_bound', origin);
    expect(korgath).toBeTruthy();
    expect(korgath.enraged).toBe(false);
    korgath.inCombat = true;
    korgath.hp = Math.floor(korgath.maxHp * 0.25);
    sim.tick();
    expect(korgath.enraged).toBe(true);
  });
});

describe('dungeon difficulty slash command', () => {
  it('routes /dungeon reset to the owned-instance reset', () => {
    const sim = makeWorld();
    const p = sim.addPlayer('warrior', 'Solo');
    sim.enterDungeon('hollow_crypt', p);
    sim.leaveDungeon(p);
    sim.setDungeonDifficulty('heroic', p);

    sim.drainEvents();
    sim.chat('/dungeon reset', p);

    expect(
      (sim.drainEvents() as any[]).some(
        (event) =>
          event.type === 'error' &&
          event.pid === p &&
          event.text === 'All instances have been reset.',
      ),
    ).toBe(true);
  });

  it('routes the /dungeons and /instances reset aliases', () => {
    const sim = makeWorld();
    const p = sim.addPlayer('warrior', 'Aliases');
    for (const cmd of ['/dungeons reset', '/instances reset']) {
      sim.drainEvents();
      sim.chat(cmd, p);
      expect(
        (sim.drainEvents() as any[]).some(
          (event) =>
            event.type === 'error' &&
            event.pid === p &&
            event.text === 'You have no instances to reset.',
        ),
      ).toBe(true);
    }
  });

  it('lets a leader switch normal and heroic without using dev commands', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Lead');
    const member = sim.addPlayer('mage', 'Mage');
    sim.partyInvite(member, leader);
    sim.partyAccept(member);

    sim.drainEvents();
    sim.chat('/dungeon heroic', member);
    expect(sim.dungeonDifficulty(leader)).toBe('normal');
    expect(
      (sim.drainEvents() as any[]).some(
        (e) => e.type === 'error' && e.pid === member && e.text === 'You are not the party leader.',
      ),
    ).toBe(true);

    sim.chat('/dungeon heroic', leader);
    expect(sim.dungeonDifficulty(member)).toBe('heroic');
    expect(
      (sim.drainEvents() as any[]).some(
        (e) =>
          e.type === 'error' && e.pid === leader && e.text === 'Dungeon difficulty set to Heroic.',
      ),
    ).toBe(true);

    sim.chat('/dungeon normal', leader);
    expect(sim.dungeonDifficulty(member)).toBe('normal');
  });

  it('routes the /instances and /dungeons aliases, case-insensitively', () => {
    const sim = makeWorld();
    const p = sim.addPlayer('warrior', 'Solo');

    sim.chat('/instances heroic', p);
    expect(sim.dungeonDifficulty(p)).toBe('heroic');
    sim.chat('/dungeons normal', p);
    expect(sim.dungeonDifficulty(p)).toBe('normal');
    sim.chat('/DUNGEON HEROIC', p);
    expect(sim.dungeonDifficulty(p)).toBe('heroic');
  });

  it('the /dungeon readout reports the current selection and how to change it', () => {
    const sim = makeWorld();
    const p = sim.addPlayer('warrior', 'Solo');

    sim.drainEvents();
    sim.chat('/dungeon', p);
    let texts = (sim.drainEvents() as any[])
      .filter((e) => e.type === 'error' && e.pid === p)
      .map((e) => e.text);
    expect(texts).toContain('Dungeon difficulty: Normal. Use /dungeon heroic to change it.');

    sim.chat('/dungeon heroic', p);
    sim.drainEvents();
    sim.chat('/dungeon', p);
    texts = (sim.drainEvents() as any[])
      .filter((e) => e.type === 'error' && e.pid === p)
      .map((e) => e.text);
    expect(texts).toContain('Dungeon difficulty: Heroic. Use /dungeon normal to change it.');
  });
});
