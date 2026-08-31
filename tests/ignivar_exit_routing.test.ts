// Ignivar raid exit routing: the rooms past the Halls route their exit portal
// BACK a floor (arena to approach, assembly to arena, crucible to assembly)
// instead of outside, the lift and the Halls set players down beside the keep
// entrance, no leave path ever lands anyone near the retired Eastbrook door,
// and a live boss fight seals every portal out of its room (throttled denial,
// the entry-denial idiom).
import { describe, expect, it } from 'vitest';
import { DUNGEON_X_THRESHOLD, DUNGEONS } from '../src/sim/data';
import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_LIFT_ROOM_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_RAID_ROOM_IDS,
  IGNIVAR_SECOND_WING_ID,
  VARKHUL_BOSS_ID,
} from '../src/sim/ignivar_raid_ids';
import {
  detachFromDungeon,
  enterDungeon,
  instanceOriginOf,
  leaveDungeon,
  updateDoorTriggers,
} from '../src/sim/instances/dungeons';
import {
  ignivarExitRoom,
  ignivarExitSealBossId,
  ignivarExitSealed,
} from '../src/sim/instances/ignivar_exit';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, IGNIVAR_BOSS_ID } from '../src/sim/types';
import { localizeSimText } from '../src/ui/sim_i18n';

const KEEP_DOOR_POS = { x: 503.05, z: 2243.7 };
const APPROACH_LEAVE_Z = KEEP_DOOR_POS.z - 6.5;
const EASTBROOK_POS = { x: -24, z: -114 };
const SEAL_DENIAL = 'The forge doors hold fast while the battle rages.';

function makeSim(): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', devCommands: true });
}

function claimChain(sim: Sim, rooms: readonly string[]): void {
  for (const roomId of rooms) {
    if (!enterDungeon(sim.ctx, roomId, sim.player.id, true)) {
      throw new Error(`${roomId} entry failed`);
    }
  }
}

function claimOf(sim: Sim, dungeonId: string): InstanceSlot {
  const claim = sim.instances.find(
    (inst) => inst.dungeonId === dungeonId && inst.partyKey !== null,
  );
  if (!claim) throw new Error(`no live claim for ${dungeonId}`);
  return claim;
}

function bossIn(sim: Sim, claim: InstanceSlot, templateId: string): Entity {
  const boss = claim.mobIds
    .map((id) => sim.entities.get(id))
    .find((mob): mob is Entity => mob !== undefined && mob.templateId === templateId);
  if (!boss) throw new Error(`no ${templateId} in ${claim.dungeonId}`);
  return boss;
}

function entryPosOf(sim: Sim, dungeonId: string): { x: number; z: number } {
  const claim = claimOf(sim, dungeonId);
  const origin = instanceOriginOf(claim);
  const entry = DUNGEONS[dungeonId].entry;
  return { x: origin.x + entry.x, z: origin.z + entry.z };
}

function distToEastbrook(pos: { x: number; z: number }): number {
  return Math.hypot(pos.x - EASTBROOK_POS.x, pos.z - EASTBROOK_POS.z);
}

describe('ignivar exit routing: pure helpers', () => {
  it('routes the rooms past the Halls back a floor and the front rooms outside', () => {
    expect(ignivarExitRoom(IGNIVAR_LIFT_ROOM_ID)).toBeNull();
    expect(ignivarExitRoom(IGNIVAR_FORGE_APPROACH_ID)).toBeNull();
    expect(ignivarExitRoom(IGNIVAR_RAID_ARENA_ID)).toBe(IGNIVAR_FORGE_APPROACH_ID);
    expect(ignivarExitRoom(IGNIVAR_MOLTEN_ASSEMBLY_ID)).toBe(IGNIVAR_RAID_ARENA_ID);
    expect(ignivarExitRoom(IGNIVAR_SECOND_WING_ID)).toBe(IGNIVAR_MOLTEN_ASSEMBLY_ID);
    expect(ignivarExitRoom('hollow_crypt')).toBeNull();
  });

  it('names the sealing boss for exactly the two boss rooms', () => {
    expect(ignivarExitSealBossId(IGNIVAR_RAID_ARENA_ID)).toBe(IGNIVAR_BOSS_ID);
    expect(ignivarExitSealBossId(IGNIVAR_SECOND_WING_ID)).toBe(VARKHUL_BOSS_ID);
    expect(ignivarExitSealBossId(IGNIVAR_LIFT_ROOM_ID)).toBeNull();
    expect(ignivarExitSealBossId(IGNIVAR_FORGE_APPROACH_ID)).toBeNull();
    expect(ignivarExitSealBossId(IGNIVAR_MOLTEN_ASSEMBLY_ID)).toBeNull();
  });

  it('seals only while the room boss is alive AND engaged', () => {
    const boss = { templateId: IGNIVAR_BOSS_ID, dead: false, inCombat: false } as Entity;
    const trash = { templateId: 'ignivar_ember_sentinel', dead: false, inCombat: true } as Entity;
    const entities = new Map<number, Entity>([
      [1, boss],
      [2, trash],
    ]);
    const claim = { mobIds: [1, 2, 3] } as InstanceSlot;
    // A calm living boss and an engaged trash mob never seal.
    expect(ignivarExitSealed(IGNIVAR_RAID_ARENA_ID, claim.mobIds, entities)).toBe(false);
    boss.inCombat = true;
    expect(ignivarExitSealed(IGNIVAR_RAID_ARENA_ID, claim.mobIds, entities)).toBe(true);
    // A fresh boss corpse still flagged inCombat never seals.
    boss.dead = true;
    expect(ignivarExitSealed(IGNIVAR_RAID_ARENA_ID, claim.mobIds, entities)).toBe(false);
    // A sealless room ignores its engaged mobs entirely.
    boss.dead = false;
    expect(ignivarExitSealed(IGNIVAR_MOLTEN_ASSEMBLY_ID, claim.mobIds, entities)).toBe(false);
  });
});

describe('ignivar exit routing: the portal walks back a floor', () => {
  it('exits the arena to the approach entry, no fresh claim minted', () => {
    const sim = makeSim();
    claimChain(sim, [IGNIVAR_LIFT_ROOM_ID, IGNIVAR_FORGE_APPROACH_ID, IGNIVAR_RAID_ARENA_ID]);
    const claimsBefore = sim.instances.filter((inst) => inst.partyKey !== null).length;
    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);
    const approachEntry = entryPosOf(sim, IGNIVAR_FORGE_APPROACH_ID);
    expect(sim.player.pos.x).toBeCloseTo(approachEntry.x, 0);
    expect(sim.player.pos.z).toBeCloseTo(approachEntry.z, 0);
    expect(
      sim.instances.filter((inst) => inst.partyKey !== null).length,
      'rejoined the live approach claim, no fresh claim minted',
    ).toBe(claimsBefore);
  });

  it('exits the assembly to the arena entry and the crucible to the assembly entry', () => {
    const sim = makeSim();
    claimChain(sim, [
      IGNIVAR_LIFT_ROOM_ID,
      IGNIVAR_FORGE_APPROACH_ID,
      IGNIVAR_RAID_ARENA_ID,
      IGNIVAR_MOLTEN_ASSEMBLY_ID,
      IGNIVAR_SECOND_WING_ID,
    ]);
    // From the crucible (floor 4): back to the assembly.
    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);
    const assemblyEntry = entryPosOf(sim, IGNIVAR_MOLTEN_ASSEMBLY_ID);
    expect(sim.player.pos.x).toBeCloseTo(assemblyEntry.x, 0);
    expect(sim.player.pos.z).toBeCloseTo(assemblyEntry.z, 0);
    // From the assembly (floor 3): back to the arena.
    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);
    const arenaEntry = entryPosOf(sim, IGNIVAR_RAID_ARENA_ID);
    expect(sim.player.pos.x).toBeCloseTo(arenaEntry.x, 0);
    expect(sim.player.pos.z).toBeCloseTo(arenaEntry.z, 0);
  });

  it('exits the approach and the lift OUTSIDE, beside the keep entrance', () => {
    const sim = makeSim();
    claimChain(sim, [IGNIVAR_LIFT_ROOM_ID, IGNIVAR_FORGE_APPROACH_ID]);
    // From the Halls (floor 1): outside beside the keep door.
    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);
    expect(sim.player.pos.x).toBeCloseTo(KEEP_DOOR_POS.x);
    expect(sim.player.pos.z).toBeCloseTo(APPROACH_LEAVE_Z);
    // Back into the lift, then out: same keep-side drop.
    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, sim.player.id, true)).toBe(true);
    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);
    expect(sim.player.pos.x).toBeCloseTo(KEEP_DOOR_POS.x);
    expect(sim.player.pos.z).toBeCloseTo(KEEP_DOOR_POS.z - 4);
  });

  it('a full walk out from the crucible steps floor by floor and ends at the keep', () => {
    const sim = makeSim();
    claimChain(sim, [
      IGNIVAR_LIFT_ROOM_ID,
      IGNIVAR_FORGE_APPROACH_ID,
      IGNIVAR_RAID_ARENA_ID,
      IGNIVAR_MOLTEN_ASSEMBLY_ID,
      IGNIVAR_SECOND_WING_ID,
    ]);
    let hops = 0;
    while (sim.player.pos.x > DUNGEON_X_THRESHOLD) {
      expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);
      hops++;
      if (hops > 6) throw new Error('exit chain never reached the open world');
    }
    // crucible -> assembly -> arena -> approach -> outside.
    expect(hops).toBe(4);
    expect(sim.player.pos.x).toBeCloseTo(KEEP_DOOR_POS.x);
    expect(sim.player.pos.z).toBeCloseTo(APPROACH_LEAVE_Z);
    sim.player.facing = Math.PI;
    sim.player.prevFacing = Math.PI;
    const meta = sim.players.get(sim.player.id);
    if (!meta) throw new Error('missing player metadata');
    meta.moveInput.forward = true;
    for (let tick = 0; tick < 20; tick++) sim.tick();
    expect(
      sim.instanceInfoAt(sim.player.pos),
      'the keep door does not pull the leaver back in',
    ).toBe(null);
  });

  it('refuses every backward exit when the previous floor claim is missing', () => {
    for (const roomId of [
      IGNIVAR_RAID_ARENA_ID,
      IGNIVAR_MOLTEN_ASSEMBLY_ID,
      IGNIVAR_SECOND_WING_ID,
    ]) {
      const sim = makeSim();
      expect(enterDungeon(sim.ctx, roomId, sim.player.id, true), roomId).toBe(true);
      const before = { ...sim.player.pos };

      expect(leaveDungeon(sim.ctx, sim.player.id), roomId).toBe(false);
      expect(sim.player.pos, roomId).toEqual(before);
      expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId, roomId).toBe(roomId);
      expect(distToEastbrook(sim.player.pos), roomId).toBeGreaterThan(50);
    }
  });

  it('routes targeted and proximity exit clicks through the floor rule', () => {
    const sim = makeSim();
    claimChain(sim, [IGNIVAR_LIFT_ROOM_ID, IGNIVAR_FORGE_APPROACH_ID, IGNIVAR_RAID_ARENA_ID]);

    const clickArenaExit = (targeted: boolean) => {
      const arenaClaim = claimOf(sim, IGNIVAR_RAID_ARENA_ID);
      const exit = arenaClaim.exitId !== null ? sim.entities.get(arenaClaim.exitId) : undefined;
      if (!exit) throw new Error('no arena exit portal');
      sim.player.pos.x = exit.pos.x;
      sim.player.pos.z = exit.pos.z;
      sim.player.prevPos = { ...sim.player.pos };
      sim.player.targetId = targeted ? exit.id : null;
      sim.interact(sim.player.id);
      expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId).toBe(IGNIVAR_FORGE_APPROACH_ID);
    };

    clickArenaExit(true);
    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, sim.player.id, true)).toBe(true);
    clickArenaExit(false);
  });

  it('no leave path from any raid room lands within 50 yards of Eastbrook', () => {
    const sim = makeSim();
    claimChain(sim, [...IGNIVAR_RAID_ROOM_IDS]);
    for (const roomId of [...IGNIVAR_RAID_ROOM_IDS].reverse()) {
      const entry = entryPosOf(sim, roomId);
      sim.player.pos.x = entry.x;
      sim.player.pos.z = entry.z;
      sim.player.prevPos = { ...sim.player.pos };
      // The battleground-pop displacement path reports the same keep-side door.
      const door = detachFromDungeon(sim.ctx, sim.player);
      expect(door, roomId).not.toBeNull();
      if (door) expect(distToEastbrook(door), `detach door for ${roomId}`).toBeGreaterThan(50);
      expect(leaveDungeon(sim.ctx, sim.player.id), roomId).toBe(true);
      expect(distToEastbrook(sim.player.pos), `leave drop for ${roomId}`).toBeGreaterThan(50);
    }
  });

  it('a trash-only fight never seals a sealless room: the assembly exit still routes', () => {
    const sim = makeSim();
    claimChain(sim, [
      IGNIVAR_LIFT_ROOM_ID,
      IGNIVAR_FORGE_APPROACH_ID,
      IGNIVAR_RAID_ARENA_ID,
      IGNIVAR_MOLTEN_ASSEMBLY_ID,
    ]);
    const assemblyClaim = claimOf(sim, IGNIVAR_MOLTEN_ASSEMBLY_ID);
    const trash = assemblyClaim.mobIds
      .map((id) => sim.entities.get(id))
      .find((mob): mob is Entity => mob !== undefined && !mob.dead);
    if (!trash) throw new Error('no assembly trash');
    trash.inCombat = true;
    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);
    const arenaEntry = entryPosOf(sim, IGNIVAR_RAID_ARENA_ID);
    expect(sim.player.pos.x).toBeCloseTo(arenaEntry.x, 0);
    expect(sim.player.pos.z).toBeCloseTo(arenaEntry.z, 0);
  });
});

describe('ignivar exit routing: the boss-fight seal', () => {
  it('refuses the arena portal while Ignivar fights and admits it after he falls', () => {
    const sim = makeSim();
    claimChain(sim, [IGNIVAR_LIFT_ROOM_ID, IGNIVAR_FORGE_APPROACH_ID, IGNIVAR_RAID_ARENA_ID]);
    const boss = bossIn(sim, claimOf(sim, IGNIVAR_RAID_ARENA_ID), IGNIVAR_BOSS_ID);
    boss.inCombat = true;
    sim.drainEvents();
    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(false);
    expect(JSON.stringify(sim.drainEvents())).toContain(SEAL_DENIAL);
    const arenaEntry = entryPosOf(sim, IGNIVAR_RAID_ARENA_ID);
    expect(sim.player.pos.x, 'the player never moved').toBeCloseTo(arenaEntry.x, 0);
    // The boss falls: the portal opens even while the corpse still reads inCombat.
    boss.hp = 0;
    boss.dead = true;
    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);
    const approachEntry = entryPosOf(sim, IGNIVAR_FORGE_APPROACH_ID);
    expect(sim.player.pos.x).toBeCloseTo(approachEntry.x, 0);
    expect(sim.player.pos.z).toBeCloseTo(approachEntry.z, 0);
  });

  it('refuses the crucible portal while Varkhul fights and admits it after he falls', () => {
    const sim = makeSim();
    claimChain(sim, [
      IGNIVAR_LIFT_ROOM_ID,
      IGNIVAR_FORGE_APPROACH_ID,
      IGNIVAR_RAID_ARENA_ID,
      IGNIVAR_MOLTEN_ASSEMBLY_ID,
      IGNIVAR_SECOND_WING_ID,
    ]);
    const boss = bossIn(sim, claimOf(sim, IGNIVAR_SECOND_WING_ID), VARKHUL_BOSS_ID);
    boss.inCombat = true;
    sim.drainEvents();
    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(false);
    expect(JSON.stringify(sim.drainEvents())).toContain(SEAL_DENIAL);
    boss.hp = 0;
    boss.dead = true;
    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);
    const assemblyEntry = entryPosOf(sim, IGNIVAR_MOLTEN_ASSEMBLY_ID);
    expect(sim.player.pos.x).toBeCloseTo(assemblyEntry.x, 0);
    expect(sim.player.pos.z).toBeCloseTo(assemblyEntry.z, 0);
  });

  it('a calm living boss never seals: the arena portal works pre-pull', () => {
    const sim = makeSim();
    claimChain(sim, [IGNIVAR_LIFT_ROOM_ID, IGNIVAR_FORGE_APPROACH_ID, IGNIVAR_RAID_ARENA_ID]);
    const boss = bossIn(sim, claimOf(sim, IGNIVAR_RAID_ARENA_ID), IGNIVAR_BOSS_ID);
    expect(boss.dead).toBe(false);
    expect(boss.inCombat).toBe(false);
    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);
  });

  it('throttles both boss denials to exactly one notice per 4s window', () => {
    const cases = [
      {
        roomId: IGNIVAR_RAID_ARENA_ID,
        bossId: IGNIVAR_BOSS_ID,
        rooms: [IGNIVAR_LIFT_ROOM_ID, IGNIVAR_FORGE_APPROACH_ID, IGNIVAR_RAID_ARENA_ID],
      },
      {
        roomId: IGNIVAR_SECOND_WING_ID,
        bossId: VARKHUL_BOSS_ID,
        rooms: IGNIVAR_RAID_ROOM_IDS,
      },
    ] as const;

    for (const { roomId, bossId, rooms } of cases) {
      const sim = makeSim();
      claimChain(sim, rooms);
      const claim = claimOf(sim, roomId);
      bossIn(sim, claim, bossId).inCombat = true;
      const exit = claim.exitId !== null ? sim.entities.get(claim.exitId) : undefined;
      if (!exit) throw new Error(`no ${roomId} exit portal`);
      sim.player.pos.x = exit.pos.x;
      sim.player.pos.z = exit.pos.z;
      sim.player.prevPos = { ...sim.player.pos };
      sim.drainEvents();

      let notices = 0;
      const walkInAt = (time: number) => {
        sim.time = time;
        updateDoorTriggers(sim.ctx, sim.player);
        for (const event of sim.drainEvents()) {
          if (JSON.stringify(event).includes(SEAL_DENIAL)) notices++;
        }
      };

      for (let tick = 0; tick < 4 / DT; tick++) walkInAt(tick * DT);
      expect(notices, `${roomId} remains quiet before 4s`).toBe(1);
      walkInAt(4);
      expect(notices, `${roomId} reports again at 4s`).toBe(2);
      expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId, roomId).toBe(roomId);
    }
  });
});

describe('ignivar exit routing: localization', () => {
  it('registers the seal denial with the client matcher', () => {
    expect(localizeSimText(SEAL_DENIAL)).not.toBeNull();
  });
});
