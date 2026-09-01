import { describe, expect, it } from 'vitest';
import { resetIgnivarEncounter } from '../src/sim/encounters/ignivar';
import { IGNIVAR_DIALOGUE } from '../src/sim/encounters/ignivar_dialogue';
import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_SECOND_WING_ID,
} from '../src/sim/ignivar_raid_ids';
import { enterDungeon, leaveDungeon, updateInstances } from '../src/sim/instances/dungeons';
import { raidBossRoomWelcomeFor } from '../src/sim/instances/raid_boss_room_welcome';
import { Sim } from '../src/sim/sim';
import {
  type Entity,
  IGNIVAR_BOSS_ID,
  INSTANCE_EMPTY_TIMEOUT,
  type SimEvent,
} from '../src/sim/types';

function welcomeEvents(events: SimEvent[], text: string) {
  return events.filter(
    (event) => event.type === 'chat' && event.channel === 'yell' && event.text === text,
  );
}

describe('raid boss room welcome catalog', () => {
  it('maps only Ignivar room to its definitive speaker and line', () => {
    expect(raidBossRoomWelcomeFor(IGNIVAR_RAID_ARENA_ID)).toEqual({
      bossTemplateId: IGNIVAR_BOSS_ID,
      text: IGNIVAR_DIALOGUE.roomEntry,
    });
    expect(raidBossRoomWelcomeFor(IGNIVAR_SECOND_WING_ID)).toBeNull();
    expect(raidBossRoomWelcomeFor('ignivar_molten_assembly')).toBeNull();
  });
});

describe('Ignivar room welcome', () => {
  it('plays personally for each first entrant without replaying after a wipe', () => {
    const sim = new Sim({
      seed: 4271,
      noPlayer: true,
      playerClass: 'warrior',
      devCommands: true,
    });
    const leaderId = sim.addPlayer('warrior', 'Firstember');
    const laterId = sim.addPlayer('mage', 'Laterember');
    sim.partyInvite(laterId, leaderId);
    sim.partyAccept(laterId);
    // Claim the Halls first: the arena's exit portal routes back to them (the
    // floor-chain exit rule), so the wipe walk-out below needs the claim live.
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, leaderId, true)).toBe(true);
    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, leaderId, true)).toBe(true);

    const claim = sim.instances.find(
      (instance) => instance.dungeonId === IGNIVAR_RAID_ARENA_ID && instance.partyKey !== null,
    );
    const boss = claim?.mobIds
      .map((id) => sim.entities.get(id))
      .find((entity): entity is Entity => entity?.templateId === IGNIVAR_BOSS_ID);
    if (!claim || !boss) throw new Error('Missing claimed Ignivar boss room');

    expect(welcomeEvents(sim.drainEvents(), IGNIVAR_DIALOGUE.roomEntry)).toEqual([
      expect.objectContaining({
        fromPid: boss.id,
        entityId: boss.id,
        pid: leaderId,
      }),
    ]);
    expect(claim.enteredBy.has(leaderId)).toBe(true);

    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, laterId, true)).toBe(true);
    expect(welcomeEvents(sim.drainEvents(), IGNIVAR_DIALOGUE.roomEntry)).toEqual([
      expect.objectContaining({
        fromPid: boss.id,
        entityId: boss.id,
        pid: laterId,
      }),
    ]);

    resetIgnivarEncounter(sim.ctx, boss);
    expect(leaveDungeon(sim.ctx, leaderId)).toBe(true);
    sim.drainEvents();
    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, leaderId, true)).toBe(true);
    expect(welcomeEvents(sim.drainEvents(), IGNIVAR_DIALOGUE.roomEntry)).toEqual([]);
  });

  it('does not replay after the same durable character relogs into the live claim', () => {
    const sim = new Sim({
      seed: 4273,
      noPlayer: true,
      playerClass: 'warrior',
      devCommands: true,
    });
    const firstPid = sim.addPlayer('warrior', 'Relogember', { characterId: 4273 });
    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, firstPid, true)).toBe(true);

    const claim = sim.instances.find(
      (instance) => instance.dungeonId === IGNIVAR_RAID_ARENA_ID && instance.partyKey !== null,
    );
    if (!claim) throw new Error('Missing claimed Ignivar boss room');
    expect(welcomeEvents(sim.drainEvents(), IGNIVAR_DIALOGUE.roomEntry)).toHaveLength(1);

    sim.removePlayer(firstPid);
    const secondPid = sim.addPlayer('warrior', 'Relogember', { characterId: 4273 });
    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, secondPid, true)).toBe(true);

    expect(
      sim.instances.find(
        (instance) => instance.dungeonId === IGNIVAR_RAID_ARENA_ID && instance.partyKey !== null,
      ),
    ).toBe(claim);
    expect(welcomeEvents(sim.drainEvents(), IGNIVAR_DIALOGUE.roomEntry)).toEqual([]);
  });

  it('welcomes the same durable character again after the old claim is freed', () => {
    const sim = new Sim({
      seed: 4274,
      noPlayer: true,
      playerClass: 'warrior',
      devCommands: true,
    });
    const pid = sim.addPlayer('warrior', 'Freshclaim', { characterId: 4274 });
    // The Halls claim keeps the arena's floor-chain exit routable below.
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, pid, true)).toBe(true);
    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, pid, true)).toBe(true);
    const claim = sim.instances.find(
      (instance) => instance.dungeonId === IGNIVAR_RAID_ARENA_ID && instance.partyKey !== null,
    );
    if (!claim) throw new Error('Missing claimed Ignivar boss room');
    expect(welcomeEvents(sim.drainEvents(), IGNIVAR_DIALOGUE.roomEntry)).toHaveLength(1);

    // Two hops out: arena to the Halls (the floor-chain exit), then outside.
    expect(leaveDungeon(sim.ctx, pid)).toBe(true);
    expect(leaveDungeon(sim.ctx, pid)).toBe(true);
    claim.emptyFor = INSTANCE_EMPTY_TIMEOUT - 1;
    updateInstances(sim.ctx);
    expect(claim.partyKey).toBeNull();

    sim.drainEvents();
    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, pid, true)).toBe(true);
    expect(welcomeEvents(sim.drainEvents(), IGNIVAR_DIALOGUE.roomEntry)).toHaveLength(1);
  });
});
