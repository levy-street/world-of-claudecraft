// Heroic Marks DELIVERY and its gate (src/sim/instances/dungeons.ts:
// claimedInstanceForMob, awardHeroicMarks), plus the claim predicate the whole
// death-hub reward block now routes through.
//
// The subject is the pairing, not either half: a heroic final-boss kill hands
// an entered-but-absent participant DURABLE income (a Ravenpost parcel, which
// persists in the realm's mail book) and stamps the realm-reset lockout on
// their CHARACTER. Those two land in different stores, so the invariant that
// matters is that nothing can deliver the income while the gate is unreachable:
// a character whose leave snapshot is already captured would keep the marks and
// come back unlocked, and the same source would pay again.
//
// Phase 18 checked that pairing rather than assuming it, and the last arm below
// is why it matters: with the stamp in the persisted save the same source pays
// nothing a second time, and without it the source pays again.

import { describe, expect, it } from 'vitest';
import type { CharacterState } from '../src/sim/character_state';
import { HEROIC_MARK_ITEM_ID } from '../src/sim/content/dungeon_difficulty';
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  awardHeroicMarks,
  claimedInstanceForMob,
  enterDungeon,
  heroicLockoutId,
} from '../src/sim/instances/dungeons';
import type { PlayerMeta, Sim as SimType } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, WorldContent } from '../src/sim/types';

type AnySim = SimType & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

const DUNGEON = 'hollow_crypt';
const BOSS = 'morthen';
const LOCK_ID = heroicLockoutId(DUNGEON);
const MARK_LETTER = 'heroic_marks_reward';

// The camp-free world the dungeon suites use: nothing but the instances.
const DUNGEON_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeDungeonSim(seed = 99): AnySim {
  return new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    world: DUNGEON_TEST_WORLD,
  }) as AnySim;
}

function teleport(sim: AnySim, e: AnyEntity, x: number, z: number): void {
  e.pos = { x, y: e.pos.y, z };
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

function claimedDungeon(sim: AnySim, difficulty = 'heroic'): any {
  return (sim.instances as any[]).find(
    (i) => i.dungeonId === DUNGEON && i.difficulty === difficulty && i.partyKey !== null,
  );
}

function mobInInstance(sim: AnySim, inst: any, templateId: string): AnyEntity {
  const mob = inst.mobIds
    .map((id: number) => sim.entities.get(id))
    .find((e: AnyEntity | undefined) => e?.templateId === templateId);
  if (!mob) throw new Error(`missing ${templateId} in ${inst.dungeonId}`);
  return mob as AnyEntity;
}

/** Every Heroic Marks parcel addressed to this name. Filtered by letterId:
 *  every fresh character also holds the Ravenpost welcome letter. */
function markLetters(sim: AnySim, name: string): any[] {
  return ((sim.postOffice as any).mail as any[]).filter(
    (m) => m.recipientName === name && m.letterId === MARK_LETTER,
  );
}

function metaOf(sim: AnySim, pid: number): PlayerMeta {
  const meta = sim.players.get(pid);
  if (!meta) throw new Error(`no meta for ${pid}`);
  return meta as PlayerMeta;
}

/**
 * A heroic hollow_crypt run with three party members:
 *  - `leader` stands at Morthen and lands the killing blow,
 *  - `away` walked in and then walked off (still on the claim, absent from the
 *    corpse): the mail arm's own case,
 *  - `anchor` keeps the party alive across the away member's logout, so the
 *    claim's `party:<id>` key survives the relog arms below.
 */
function heroicRig(seed = 9) {
  const sim = makeDungeonSim(seed);
  const leader = sim.addPlayer('warrior', 'Lead');
  const away = sim.addPlayer('mage', 'Mate');
  const anchor = sim.addPlayer('priest', 'Anchor');
  for (const pid of [away, anchor]) {
    sim.partyInvite(pid, leader);
    sim.partyAccept(pid);
  }
  sim.setDungeonDifficulty('heroic', leader);
  for (const pid of [leader, away, anchor]) enterDungeon(sim.ctx, DUNGEON, pid);
  const inst = claimedDungeon(sim);
  if (!inst) throw new Error('no heroic claim');
  const boss = mobInInstance(sim, inst, BOSS);
  teleport(sim, sim.entities.get(leader) as AnyEntity, boss.pos.x + 1, boss.pos.z);
  teleport(sim, sim.entities.get(anchor) as AnyEntity, boss.pos.x - 1, boss.pos.z);
  // Out past PARTY_XP_RANGE, so the death-time participation snapshot leaves
  // them out and the mail arm owns their share.
  teleport(sim, sim.entities.get(away) as AnyEntity, boss.pos.x + 300, boss.pos.z);
  return { sim, leader, away, anchor, inst, boss };
}

function killBoss(sim: AnySim, killerPid: number, boss: AnyEntity): void {
  const killer = sim.entities.get(killerPid) as AnyEntity;
  sim.dealDamage(killer, boss, boss.hp + 10, false, 'physical', null, 'hit');
}

// ---------------------------------------------------------------------------
// claimedInstanceForMob: the ONE claim predicate the death hub, both award
// arms, the exit portal, the normal-reset lock and the Nythraxis sweep read.
// ---------------------------------------------------------------------------

/** The slice the predicate actually reads. */
function ctxWithInstances(instances: unknown[]): SimContext {
  return { instances } as unknown as SimContext;
}

describe('claimedInstanceForMob', () => {
  it('returns the CLAIMED slot holding the mob', () => {
    const claimed = { partyKey: 'party:1', mobIds: [4, 5, 6] };
    const other = { partyKey: 'party:2', mobIds: [7] };
    const ctx = ctxWithInstances([other, claimed]);
    expect(claimedInstanceForMob(ctx, 5)).toBe(claimed);
  });

  it('returns null, never undefined, for a mob no slot holds', () => {
    const ctx = ctxWithInstances([{ partyKey: 'party:1', mobIds: [4] }]);
    const found = claimedInstanceForMob(ctx, 999);
    // The undefined-to-null conversion is load-bearing, not cosmetic: the two
    // award arms take `claimed?: InstanceSlot | null` and treat UNDEFINED as
    // "no answer, resolve it yourself". A find() result handed straight
    // through would make every miss re-scan.
    expect(found).toBeNull();
    expect(found).not.toBeUndefined();
  });

  it('ignores an UNCLAIMED slot that still lists the mob', () => {
    // A freed slot keeps its mob ids until the pool re-claims it; a kill in
    // one is nobody's run and must never resolve to a reward instance.
    const ctx = ctxWithInstances([{ partyKey: null, mobIds: [4, 5] }]);
    expect(claimedInstanceForMob(ctx, 5)).toBeNull();
  });

  it('agrees with a live claim in a real Sim', () => {
    const { sim, inst, boss } = heroicRig();
    expect(claimedInstanceForMob(sim.ctx, boss.id)).toBe(inst);
    expect(claimedInstanceForMob(sim.ctx, boss.id + 100000)).toBeNull();
  });

  it('a hub-resolved null is honoured; only undefined re-scans', () => {
    // The contract the death hub's single-scan dedupe rests on. Same world,
    // same boss, same recipients: passing the hub's null pays nobody, while
    // omitting the argument resolves the claim and pays.
    const { sim, leader, away, boss } = heroicRig();
    const leaderMeta = metaOf(sim, leader);

    awardHeroicMarks(sim.ctx, boss, [leaderMeta], null);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, leader)).toBe(0);
    expect(markLetters(sim, 'Mate')).toHaveLength(0);
    expect(metaOf(sim, away).raidLockouts.has(LOCK_ID)).toBe(false);

    awardHeroicMarks(sim.ctx, boss, [leaderMeta]);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, leader)).toBeGreaterThan(0);
    expect(markLetters(sim, 'Mate')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The mail arm and its gate.
// ---------------------------------------------------------------------------

describe('the Heroic Marks mail arm pairs durable income with a durable gate', () => {
  it('an entered participant away from the corpse is mailed marks AND locked in the save', () => {
    const { sim, leader, away, boss } = heroicRig();
    killBoss(sim, leader, boss);

    // Present at the corpse: straight to bags. Absent but entered: by raven.
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, leader)).toBeGreaterThan(0);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, away)).toBe(0);
    expect(markLetters(sim, 'Mate')).toHaveLength(1);

    // The gate that gives that income its price reaches the PERSISTED
    // character, not just the live meta: this is the pairing.
    const saved = sim.serializeCharacter(away) as CharacterState;
    expect(saved.raidLockouts?.[LOCK_ID]).toBeGreaterThan(0);
  });

  it('a character frozen for leave is paid nothing the leave snapshot cannot gate', () => {
    // The server's own ordering: preparePlayerLeave freezes reward eligibility,
    // THEN the character is serialized, and the world keeps ticking through the
    // persistence await. A kill inside that window must not post a parcel: the
    // parcel would persist in the mail book while the lockout stamp died with
    // the discarded live meta, and the same source could pay again on relog.
    const { sim, leader, away, boss } = heroicRig();
    sim.preparePlayerLeave(away);
    const leaveSnapshot = sim.serializeCharacter(away) as CharacterState;

    killBoss(sim, leader, boss);

    expect(markLetters(sim, 'Mate')).toHaveLength(0);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, away)).toBe(0);
    expect(leaveSnapshot.raidLockouts?.[LOCK_ID]).toBeUndefined();
    // The freeze is scoped to the leaver: everyone still here is paid and
    // locked exactly as before, so this is not a silently dead kill.
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, leader)).toBeGreaterThan(0);
    const anchorSave = sim.serializeCharacter(leader) as CharacterState;
    expect(anchorSave.raidLockouts?.[LOCK_ID]).toBeGreaterThan(0);
  });

  it('the gate stamp lands BEFORE the parcel that answers to it', () => {
    // Ordering inside the payout loop. The parcel is the durable half and the
    // stamp is its price, so the stamp goes first: nothing between them can
    // throw and leave income standing without its gate.
    const { sim, leader, away, boss } = heroicRig();
    const awayMeta = metaOf(sim, away);
    const post = sim.postOffice as { mailHeroicMarks(pid: number, id: string, n: number): void };
    const original = post.mailHeroicMarks.bind(post);
    let lockedWhenMailed: boolean | null = null;
    post.mailHeroicMarks = (pid: number, id: string, n: number) => {
      if (pid === away) lockedWhenMailed = awayMeta.raidLockouts.has(LOCK_ID);
      original(pid, id, n);
    };

    killBoss(sim, leader, boss);

    expect(markLetters(sim, 'Mate')).toHaveLength(1);
    expect(lockedWhenMailed, 'the mail arm ran before its own gate stamp').toBe(true);
  });
});

describe('the persisted stamp is the whole gate against a second payout', () => {
  /** Log the away member out and bring them back on `state`. */
  function relog(sim: AnySim, away: number, leader: number, state: CharacterState): number {
    sim.removePlayer(away);
    const returned = sim.addPlayer('mage', 'Mate', { state });
    sim.partyInvite(returned, leader);
    sim.partyAccept(returned);
    return returned;
  }

  it('a save that CARRIES the stamp is refused at the door and paid nothing', () => {
    const { sim, leader, away, boss } = heroicRig();
    killBoss(sim, leader, boss);
    expect(markLetters(sim, 'Mate')).toHaveLength(1);

    const afterKill = sim.serializeCharacter(away) as CharacterState;
    expect(afterKill.raidLockouts?.[LOCK_ID]).toBeGreaterThan(0);
    const returned = relog(sim, away, leader, afterKill);

    // The locked returner cannot walk back into the claim...
    expect(enterDungeon(sim.ctx, DUNGEON, returned)).toBe(false);
    // ...and the award arm refuses them anyway.
    awardHeroicMarks(sim.ctx, boss, [metaOf(sim, leader)]);
    expect(markLetters(sim, 'Mate')).toHaveLength(1);
    expect(sim.countItem(HEROIC_MARK_ITEM_ID, returned)).toBe(0);
  });

  it('a save that LOST the stamp walks back in and the same source pays again', () => {
    // The consequence half, and the reason the leave-window arm above matters:
    // everything here is identical except which snapshot came back. A parcel
    // delivered to a character whose stamp never reached the database is
    // therefore duplicate income, not a rounding error.
    const { sim, leader, away, boss } = heroicRig();
    const beforeKill = sim.serializeCharacter(away) as CharacterState;
    killBoss(sim, leader, boss);
    expect(markLetters(sim, 'Mate')).toHaveLength(1);

    expect(beforeKill.raidLockouts?.[LOCK_ID]).toBeUndefined();
    const returned = relog(sim, away, leader, beforeKill);

    expect(enterDungeon(sim.ctx, DUNGEON, returned)).toBe(true);
    teleport(sim, sim.entities.get(returned) as AnyEntity, boss.pos.x + 300, boss.pos.z);
    awardHeroicMarks(sim.ctx, boss, [metaOf(sim, leader)]);
    expect(markLetters(sim, 'Mate')).toHaveLength(2);
  });
});
