// Ignivar raid entry rules (the Rift door rules applied to the four-room raid):
// an entrant from OUTSIDE the raid is barred while any of the group's raid rooms
// still has a living mob engaged (the anti-zerg combat lockout), and an allowed
// outside entrant through the Eastbrook door lands in the deepest room the group
// has already claimed (the checkpoint redirect), not back at the approach.
// Members moving BETWEEN rooms inside the raid are exempt from both rules.
import { describe, expect, it } from 'vitest';
import { DUNGEON_X_THRESHOLD, DUNGEONS } from '../src/sim/data';
import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_SECOND_WING_ID,
  IGNIVAR_TRASH_AUTOMATON_IDS,
} from '../src/sim/ignivar_raid_ids';
import { enterDungeon, instanceOriginOf, leaveDungeon } from '../src/sim/instances/dungeons';
import {
  furthestIgnivarRaidRoom,
  ignivarRaidInCombat,
  resolveIgnivarEntryRoom,
} from '../src/sim/instances/ignivar_entry';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { localizeSimText } from '../src/ui/sim_i18n';

const DOOR_POS = { x: -24, z: -114 };
const COMBAT_DENIAL = 'Your raid is still in combat. You may enter once the fighting stops.';

function placeAt(sim: Sim, pid: number, x: number, z: number): void {
  const p = sim.entities.get(pid);
  if (!p) throw new Error(`missing player ${pid}`);
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

function formTestRaid(sim: Sim, pids: number[]): void {
  const raid = sim.ctx.formDungeonFinderGroup(
    pids.map((pid) => ({ partyId: null, leaderPid: pid, members: [pid] })),
    { raid: true },
  );
  if (!raid) throw new Error('test raid did not form');
}

function makeGhost(e: Entity): void {
  e.hp = 0;
  e.dead = true;
  e.ghost = true;
}

function claimOf(sim: Sim, dungeonId: string): InstanceSlot {
  const claim = sim.instances.find(
    (inst) => inst.dungeonId === dungeonId && inst.partyKey !== null,
  );
  if (!claim) throw new Error(`no live claim for ${dungeonId}`);
  return claim;
}

function livingMobIn(sim: Sim, claim: InstanceSlot): Entity {
  const mob = claim.mobIds
    .map((id) => sim.entities.get(id))
    .find((m): m is Entity => !!m && !m.dead);
  if (!mob) throw new Error(`no living mob in ${claim.dungeonId}`);
  return mob;
}

function entryPosOf(sim: Sim, dungeonId: string): { x: number; z: number } {
  const claim = claimOf(sim, dungeonId);
  const origin = instanceOriginOf(claim);
  const entry = DUNGEONS[dungeonId].entry;
  return { x: origin.x + entry.x, z: origin.z + entry.z };
}

describe('ignivar raid entry: pure helpers', () => {
  const fakeClaim = (dungeonId: string): InstanceSlot => ({ dungeonId }) as InstanceSlot;

  it('picks the deepest claimed room of the chain', () => {
    expect(furthestIgnivarRaidRoom([])).toBeNull();
    expect(furthestIgnivarRaidRoom([fakeClaim(IGNIVAR_FORGE_APPROACH_ID)])).toBe(
      IGNIVAR_FORGE_APPROACH_ID,
    );
    expect(
      furthestIgnivarRaidRoom([
        fakeClaim(IGNIVAR_MOLTEN_ASSEMBLY_ID),
        fakeClaim(IGNIVAR_FORGE_APPROACH_ID),
        fakeClaim(IGNIVAR_RAID_ARENA_ID),
      ]),
    ).toBe(IGNIVAR_MOLTEN_ASSEMBLY_ID);
  });

  it('redirects only the overworld approach entry, never an interior gate', () => {
    const claims = [fakeClaim(IGNIVAR_FORGE_APPROACH_ID), fakeClaim(IGNIVAR_RAID_ARENA_ID)];
    expect(resolveIgnivarEntryRoom(IGNIVAR_FORGE_APPROACH_ID, claims)).toBe(IGNIVAR_RAID_ARENA_ID);
    expect(resolveIgnivarEntryRoom(IGNIVAR_RAID_ARENA_ID, claims)).toBe(IGNIVAR_RAID_ARENA_ID);
    expect(resolveIgnivarEntryRoom(IGNIVAR_FORGE_APPROACH_ID, [])).toBe(IGNIVAR_FORGE_APPROACH_ID);
  });

  it('counts only living engaged mobs toward the lockout', () => {
    const mobs = new Map<number, Entity>([
      [1, { dead: false, inCombat: false } as Entity],
      [2, { dead: true, inCombat: true } as Entity],
    ]);
    const ctx = { entities: mobs } as unknown as SimContext;
    const claim = { mobIds: [1, 2, 3] } as InstanceSlot;
    // A dead mob still flagged inCombat (a fresh corpse) and a missing entity
    // id never seal the door; a calm living mob does not either.
    expect(ignivarRaidInCombat(ctx, [claim])).toBe(false);
    mobs.set(1, { dead: false, inCombat: true } as Entity);
    expect(ignivarRaidInCombat(ctx, [claim])).toBe(true);
    expect(ignivarRaidInCombat(ctx, [])).toBe(false);
  });
});

describe('ignivar raid entry: checkpoint redirect', () => {
  it('walks a returning member through the Eastbrook door into the deepest claimed room', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', devCommands: true });
    const ally = sim.addPlayer('paladin', 'Checkpoint Ally');
    formTestRaid(sim, [sim.player.id, ally]);
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, sim.player.id)).toBe(true);
    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, sim.player.id, true)).toBe(true);
    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);
    const claimsBefore = sim.instances.filter((inst) => inst.partyKey !== null).length;
    placeAt(sim, sim.player.id, DOOR_POS.x, DOOR_POS.z - 1);
    sim.tick();
    const arenaEntry = entryPosOf(sim, IGNIVAR_RAID_ARENA_ID);
    expect(sim.player.pos.x, 'landed at the arena entry, not the approach').toBeCloseTo(
      arenaEntry.x,
      0,
    );
    expect(sim.player.pos.z).toBeCloseTo(arenaEntry.z, 0);
    expect(
      sim.instances.filter((inst) => inst.partyKey !== null).length,
      'rejoined the live claim, no fresh claim minted',
    ).toBe(claimsBefore);
  });

  it('redirects all the way to the deepest room of the chain', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', devCommands: true });
    const ally = sim.addPlayer('paladin', 'Crucible Ally');
    formTestRaid(sim, [sim.player.id, ally]);
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, sim.player.id)).toBe(true);
    for (const roomId of [
      IGNIVAR_RAID_ARENA_ID,
      IGNIVAR_MOLTEN_ASSEMBLY_ID,
      IGNIVAR_SECOND_WING_ID,
    ]) {
      expect(enterDungeon(sim.ctx, roomId, sim.player.id, true), roomId).toBe(true);
    }
    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);
    placeAt(sim, sim.player.id, DOOR_POS.x, DOOR_POS.z - 1);
    sim.tick();
    const crucibleEntry = entryPosOf(sim, IGNIVAR_SECOND_WING_ID);
    expect(sim.player.pos.x).toBeCloseTo(crucibleEntry.x, 0);
    expect(sim.player.pos.z).toBeCloseTo(crucibleEntry.z, 0);
  });

  it('keeps unclaimed deeper rooms sealed: the own-claim exemption never invents entry', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const ally = sim.addPlayer('paladin', 'Sealed Ally');
    formTestRaid(sim, [sim.player.id, ally]);
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, sim.player.id)).toBe(true);
    // A member inside the approach with the herald gate still closed: sealed.
    sim.drainEvents();
    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, sim.player.id)).toBe(false);
    expect(JSON.stringify(sim.drainEvents())).toContain('The forge gate is sealed to you.');
    // A member standing outside requesting an unclaimed deeper room: sealed.
    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, ally)).toBe(false);
    expect(JSON.stringify(sim.drainEvents())).toContain('The forge gate is sealed to you.');
    expect(
      sim.instances.find(
        (inst) => inst.dungeonId === IGNIVAR_RAID_ARENA_ID && inst.partyKey !== null,
      ),
    ).toBeUndefined();
  });

  it('a group with no deeper claim still enters at the approach', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const ally = sim.addPlayer('paladin', 'Fresh Ally');
    formTestRaid(sim, [sim.player.id, ally]);
    placeAt(sim, sim.player.id, DOOR_POS.x, DOOR_POS.z - 1);
    sim.tick();
    expect(sim.player.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    expect(claimOf(sim, IGNIVAR_FORGE_APPROACH_ID)).toBeDefined();
    expect(
      sim.instances.find(
        (inst) => inst.dungeonId === IGNIVAR_RAID_ARENA_ID && inst.partyKey !== null,
      ),
      'no deeper claim invented',
    ).toBeUndefined();
  });
});

describe('ignivar raid entry: combat lockout', () => {
  it('bars an outside member while a raid room fights, and admits them once it settles', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const ally = sim.addPlayer('paladin', 'Locked Ally');
    formTestRaid(sim, [sim.player.id, ally]);
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, sim.player.id)).toBe(true);
    const mob = livingMobIn(sim, claimOf(sim, IGNIVAR_FORGE_APPROACH_ID));
    mob.inCombat = true;
    sim.drainEvents();
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, ally)).toBe(false);
    expect(JSON.stringify(sim.drainEvents()), 'the denial explains itself').toContain(
      COMBAT_DENIAL,
    );
    const allyEntity = sim.entities.get(ally);
    expect(allyEntity && allyEntity.pos.x < DUNGEON_X_THRESHOLD, 'ally stays outside').toBe(true);
    mob.inCombat = false;
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, ally)).toBe(true);
  });

  it("ignores another raid's fights: the lockout is scoped to your own group", () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const allyA = sim.addPlayer('paladin', 'Raid A Member');
    formTestRaid(sim, [sim.player.id, allyA]);
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, sim.player.id)).toBe(true);
    const mobA = livingMobIn(sim, claimOf(sim, IGNIVAR_FORGE_APPROACH_ID));
    mobA.inCombat = true;
    const b1 = sim.addPlayer('mage', 'Raid B One');
    const b2 = sim.addPlayer('priest', 'Raid B Two');
    formTestRaid(sim, [b1, b2]);
    expect(
      enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, b1),
      "raid A's combat never bars raid B",
    ).toBe(true);
  });

  it('bars a ghost during combat and corpse-runs them back in once it settles', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const ally = sim.addPlayer('paladin', 'Ghost Ally');
    formTestRaid(sim, [sim.player.id, ally]);
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, sim.player.id)).toBe(true);
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, ally)).toBe(true);
    const allyEntity = sim.entities.get(ally);
    if (!allyEntity) throw new Error('missing ally');
    makeGhost(allyEntity);
    // The body lies where they fell inside the approach claim: re-entry is the
    // corpse run (resurrectOnInstanceReentry requires a corpse bound inside).
    allyEntity.corpsePos = { ...allyEntity.pos };
    allyEntity.corpseInstanceId = claimOf(sim, IGNIVAR_FORGE_APPROACH_ID).exitId;
    placeAt(sim, ally, DOOR_POS.x, DOOR_POS.z - 1);
    const mob = livingMobIn(sim, claimOf(sim, IGNIVAR_FORGE_APPROACH_ID));
    mob.inCombat = true;
    sim.drainEvents();
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, ally), 'combat bars the ghost').toBe(
      false,
    );
    expect(JSON.stringify(sim.drainEvents())).toContain(COMBAT_DENIAL);
    mob.inCombat = false;
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, ally)).toBe(true);
    expect(allyEntity.dead, 'instance re-entry is the corpse run: the ghost resurrects').toBe(
      false,
    );
  });

  it('never blocks movement between rooms for a member already inside the raid', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const ally = sim.addPlayer('paladin', 'Inside Ally');
    formTestRaid(sim, [sim.player.id, ally]);
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, sim.player.id)).toBe(true);
    const approachClaim = claimOf(sim, IGNIVAR_FORGE_APPROACH_ID);
    // Clear the approach guardians so the progression pass opens the herald
    // gate to the arena (the real gate-open path, no dev bypass).
    for (const id of approachClaim.mobIds) {
      const e = sim.entities.get(id);
      if (e && (IGNIVAR_TRASH_AUTOMATON_IDS as readonly string[]).includes(e.templateId ?? '')) {
        e.hp = 0;
        e.dead = true;
      }
    }
    for (let i = 0; i < 25; i++) sim.tick();
    // Another pack of the approach is now mid-fight: a member standing inside
    // the raid still walks through the open gate.
    const mob = livingMobIn(sim, approachClaim);
    mob.inCombat = true;
    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, sim.player.id)).toBe(true);
    const arenaEntry = entryPosOf(sim, IGNIVAR_RAID_ARENA_ID);
    expect(sim.player.pos.x).toBeCloseTo(arenaEntry.x, 0);
    expect(sim.player.pos.z).toBeCloseTo(arenaEntry.z, 0);
  });

  it('throttles the walk-in denial to one notice per window', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const ally = sim.addPlayer('paladin', 'Patient Ally');
    formTestRaid(sim, [sim.player.id, ally]);
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, sim.player.id)).toBe(true);
    const mob = livingMobIn(sim, claimOf(sim, IGNIVAR_FORGE_APPROACH_ID));
    placeAt(sim, ally, DOOR_POS.x, DOOR_POS.z - 1);
    sim.drainEvents();
    let notices = 0;
    // 40 ticks = 2s, inside the 4s denial window: exactly one notice.
    for (let i = 0; i < 40; i++) {
      mob.inCombat = true;
      for (const ev of sim.tick()) {
        if (JSON.stringify(ev).includes(COMBAT_DENIAL)) notices++;
      }
    }
    expect(notices, 'denial throttled to one notice per window').toBe(1);
    // 50 more ticks crosses the 4s boundary: exactly one more notice.
    for (let i = 0; i < 50; i++) {
      mob.inCombat = true;
      for (const ev of sim.tick()) {
        if (JSON.stringify(ev).includes(COMBAT_DENIAL)) notices++;
      }
    }
    expect(notices).toBe(2);
    const allyEntity = sim.entities.get(ally);
    expect(allyEntity && allyEntity.pos.x < DUNGEON_X_THRESHOLD, 'ally never zoned in').toBe(true);
  });
});

describe('ignivar raid entry: localization', () => {
  it('registers the combat denial with the client matcher', () => {
    expect(localizeSimText(COMBAT_DENIAL)).not.toBeNull();
  });
});
