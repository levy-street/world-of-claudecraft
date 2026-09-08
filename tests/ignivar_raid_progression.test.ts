import { describe, expect, it } from 'vitest';
import {
  IGNIVAR_MAELIN_NPC_ID,
  IGNIVAR_MAELIN_PROJECTION_NPC_ID,
} from '../src/sim/content/ignivar_raid_lore';
import { DUNGEONS, MOBS } from '../src/sim/data';
import { INTERIOR_LAYOUTS } from '../src/sim/dungeon_floor';
import {
  IGNIVAR_FORGE_APPROACH_LAYOUT,
  IGNIVAR_SECOND_WING_LAYOUT,
} from '../src/sim/dungeon_layout';
import {
  IGNIVAR_APPROACH_GUARDIAN_IDS,
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_GATE_LOCKED_TEMPLATE,
  IGNIVAR_LIFT_ROOM_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_RAID_ROOM_IDS,
  IGNIVAR_SECOND_WING_ID,
  ignivarPreviousRaidRoom,
} from '../src/sim/ignivar_raid_ids';
import { enterDungeon, updateDoorTriggers, updateInstances } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { IGNIVAR_BOSS_ID } from '../src/sim/types';

function claimedRaid(difficulty: 'normal' | 'heroic' = 'normal') {
  const sim = new Sim({ seed: 3410, playerClass: 'warrior', devCommands: true });
  sim.chat(`/dev dungeon ignivar_raid_arena ${difficulty}`);
  sim.chat('/dev ignivarraid');
  const boss = [...sim.entities.values()].find((entity) => entity.templateId === IGNIVAR_BOSS_ID);
  const gate = [...sim.entities.values()].find(
    (entity) =>
      entity.templateId === IGNIVAR_GATE_LOCKED_TEMPLATE &&
      entity.dungeonId === IGNIVAR_MOLTEN_ASSEMBLY_ID,
  );
  if (!boss || !gate) throw new Error('Ignivar raid progression fixtures did not spawn');
  return { sim, boss, gate };
}

function teleport(sim: Sim, entityId: number, pos: { x: number; z: number }): void {
  const entity = sim.entities.get(entityId);
  if (!entity) throw new Error(`Missing entity ${entityId}`);
  entity.pos = sim.groundPos(pos.x, pos.z);
  entity.prevPos = { ...entity.pos };
  sim.rebucket(entity);
}

function reapEmptyInstances(sim: Sim): void {
  sim.tickCount = 20;
  for (let second = 0; second <= 300; second++) {
    updateInstances(sim.ctx);
  }
}

function guardianMobs(sim: Sim) {
  return [...sim.entities.values()].filter((entity) =>
    IGNIVAR_APPROACH_GUARDIAN_IDS.some((templateId) => templateId === entity.templateId),
  );
}

describe('Ignivar raid progression', () => {
  it('authors an ordered raid family behind the keep forge-lift door', () => {
    expect(IGNIVAR_RAID_ROOM_IDS).toEqual([
      IGNIVAR_LIFT_ROOM_ID,
      IGNIVAR_FORGE_APPROACH_ID,
      IGNIVAR_RAID_ARENA_ID,
      IGNIVAR_MOLTEN_ASSEMBLY_ID,
      IGNIVAR_SECOND_WING_ID,
    ]);
    expect(ignivarPreviousRaidRoom(IGNIVAR_LIFT_ROOM_ID)).toBeNull();
    expect(ignivarPreviousRaidRoom(IGNIVAR_FORGE_APPROACH_ID)).toBe(IGNIVAR_LIFT_ROOM_ID);
    expect(ignivarPreviousRaidRoom(IGNIVAR_RAID_ARENA_ID)).toBe(IGNIVAR_FORGE_APPROACH_ID);
    expect(ignivarPreviousRaidRoom(IGNIVAR_MOLTEN_ASSEMBLY_ID)).toBe(IGNIVAR_RAID_ARENA_ID);
    expect(ignivarPreviousRaidRoom(IGNIVAR_SECOND_WING_ID)).toBe(IGNIVAR_MOLTEN_ASSEMBLY_ID);
    // The Halls are reached through the lift and stay interior-only. The raid
    // family remains off the Guide.
    expect(DUNGEONS[IGNIVAR_FORGE_APPROACH_ID]).toMatchObject({
      id: IGNIVAR_FORGE_APPROACH_ID,
      guideVisible: false,
      interior: 'ignivar_approach',
      suggestedPlayers: 10,
    });
    expect(DUNGEONS[IGNIVAR_FORGE_APPROACH_ID].overworldDoor).toBe(false);
    expect(INTERIOR_LAYOUTS.ignivar_approach).toBe(IGNIVAR_FORGE_APPROACH_LAYOUT);
    expect(IGNIVAR_FORGE_APPROACH_LAYOUT.zMin).toBe(-58);
    expect(IGNIVAR_FORGE_APPROACH_LAYOUT.zMax).toBe(58);
    expect(IGNIVAR_FORGE_APPROACH_LAYOUT.pillars).toHaveLength(6);
    expect(DUNGEONS[IGNIVAR_MOLTEN_ASSEMBLY_ID]).toMatchObject({
      id: IGNIVAR_MOLTEN_ASSEMBLY_ID,
      overworldDoor: false,
      guideVisible: false,
      interior: 'ignivar_approach',
      suggestedPlayers: 10,
    });
    expect(DUNGEONS[IGNIVAR_MOLTEN_ASSEMBLY_ID].spawns).toHaveLength(9);
    // The raid chain's only front door stands in the overworld, on the
    // Forge-Lift: the keep facade's portal boards the lift first. Every room
    // past it stays interior-only.
    expect(DUNGEONS[IGNIVAR_LIFT_ROOM_ID].overworldDoor).toBeUndefined();
    expect(DUNGEONS[IGNIVAR_LIFT_ROOM_ID].doorPos).toMatchObject({ x: 503.05, z: 2243.7 });
    expect(DUNGEONS[IGNIVAR_RAID_ARENA_ID].overworldDoor).toBe(false);
    expect(DUNGEONS[IGNIVAR_SECOND_WING_ID].overworldDoor).toBe(false);
    expect(DUNGEONS[IGNIVAR_SECOND_WING_ID]).toMatchObject({
      id: IGNIVAR_SECOND_WING_ID,
      overworldDoor: false,
      guideVisible: false,
      interior: 'ignivar_depths',
      suggestedPlayers: 10,
    });
    expect(INTERIOR_LAYOUTS.ignivar_depths).toBe(IGNIVAR_SECOND_WING_LAYOUT);
    expect(IGNIVAR_SECOND_WING_LAYOUT.shellPolygon).toHaveLength(12);
    expect(IGNIVAR_SECOND_WING_LAYOUT.floorHalfX).toBe(40);
    expect(IGNIVAR_SECOND_WING_LAYOUT.pillars).toEqual([]);
  });

  it('spawns five guardian packs and opens the Herald gate only after all guardians die', () => {
    const sim = new Sim({ seed: 3412, playerClass: 'warrior', devCommands: true });
    const allyPid = sim.addPlayer('paladin', 'Approach Ally');
    const raid = sim.ctx.formDungeonFinderGroup(
      [sim.player.id, allyPid].map((pid) => ({
        partyId: null,
        leaderPid: pid,
        members: [pid],
      })),
      { raid: true },
    );
    if (!raid) throw new Error('Approach test raid did not form');
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, sim.player.id, true)).toBe(true);
    const claim = sim.instances.find(
      (instance) => instance.dungeonId === IGNIVAR_FORGE_APPROACH_ID && instance.partyKey !== null,
    );
    if (!claim) throw new Error('Forge approach did not form a claim');
    expect(claim.npcIds.map((id) => sim.entities.get(id)?.templateId)).toEqual([
      IGNIVAR_MAELIN_NPC_ID,
      IGNIVAR_MAELIN_PROJECTION_NPC_ID,
    ]);
    const gate = claim.objectIds
      .map((id) => sim.entities.get(id))
      .find((entity) => entity?.dungeonId === IGNIVAR_RAID_ARENA_ID);
    if (!gate) throw new Error('Forge approach gate did not spawn');

    const guardians = guardianMobs(sim);
    // The five packs carry 3 Ember Sentinels and 5 Crucible Wardens. Derelict
    // mech crawlers are not gate guardians and are excluded by guardianMobs.
    expect(guardians).toHaveLength(8);
    const expectedGuardianCounts = [3, 5];
    IGNIVAR_APPROACH_GUARDIAN_IDS.forEach((templateId, index) => {
      expect(guardians.filter((guardian) => guardian.templateId === templateId)).toHaveLength(
        expectedGuardianCounts[index],
      );
    });
    expect(MOBS[IGNIVAR_APPROACH_GUARDIAN_IDS[0]].arcCleave?.name).toBe('Tempered Sweep');
    expect(MOBS[IGNIVAR_APPROACH_GUARDIAN_IDS[1]].bigCast?.castId).toBe('crucible_quake');
    expect(gate.templateId).toBe(IGNIVAR_GATE_LOCKED_TEMPLATE);

    for (const guardian of guardians.slice(0, -1)) {
      guardian.dead = true;
      guardian.hp = 0;
    }
    sim.tickCount = 20;
    updateInstances(sim.ctx);
    expect(gate.templateId).toBe(IGNIVAR_GATE_LOCKED_TEMPLATE);

    const lastGuardian = guardians.at(-1);
    if (!lastGuardian) throw new Error('Approach guardian roster is empty');
    lastGuardian.dead = true;
    lastGuardian.hp = 0;
    updateInstances(sim.ctx);
    expect(gate.templateId).toBe('dungeon_door');
    teleport(sim, sim.player.id, gate.pos);
    updateDoorTriggers(sim.ctx, sim.player);
    expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId).toBe(IGNIVAR_RAID_ARENA_ID);
  });

  it.each(['normal', 'heroic'] as const)(
    'keeps the gate locked, then walks into the %s wing with source difficulty',
    (difficulty) => {
      const { sim, boss, gate } = claimedRaid(difficulty);
      const opposite = difficulty === 'normal' ? 'heroic' : 'normal';
      sim.setDungeonDifficulty(opposite);
      expect(sim.dungeonDifficulty()).toBe(opposite);
      const source = sim.instances.find(
        (instance) => instance.dungeonId === IGNIVAR_RAID_ARENA_ID && instance.partyKey !== null,
      );
      expect(source?.difficulty).toBe(difficulty);
      expect(gate.templateId).toBe(IGNIVAR_GATE_LOCKED_TEMPLATE);

      teleport(sim, sim.player.id, gate.pos);
      updateDoorTriggers(sim.ctx, sim.player);
      expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId).toBe(IGNIVAR_RAID_ARENA_ID);

      boss.dead = true;
      boss.hp = 0;
      sim.tick();

      expect(gate.templateId).toBe('dungeon_door');
      updateDoorTriggers(sim.ctx, sim.player);
      expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId).toBe(IGNIVAR_MOLTEN_ASSEMBLY_ID);
      expect(
        sim.instances.find(
          (instance) =>
            instance.dungeonId === IGNIVAR_MOLTEN_ASSEMBLY_ID && instance.partyKey !== null,
        )?.difficulty,
      ).toBe(difficulty);

      const assembly = sim.instances.find(
        (instance) =>
          instance.dungeonId === IGNIVAR_MOLTEN_ASSEMBLY_ID && instance.partyKey !== null,
      );
      if (!assembly) throw new Error('Molten Assembly claim did not form');
      const assemblyGate = assembly.objectIds
        .map((id) => sim.entities.get(id))
        .find((entity) => entity?.dungeonId === IGNIVAR_SECOND_WING_ID);
      if (!assemblyGate) throw new Error('Molten Assembly gate did not spawn');
      for (const mobId of assembly.mobIds) {
        const mob = sim.entities.get(mobId);
        if (!mob) continue;
        mob.dead = true;
        mob.hp = 0;
      }
      sim.tickCount = 20;
      updateInstances(sim.ctx);
      expect(assemblyGate.templateId).toBe('dungeon_door');
      teleport(sim, sim.player.id, assemblyGate.pos);
      updateDoorTriggers(sim.ctx, sim.player);
      expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId).toBe(IGNIVAR_SECOND_WING_ID);
      expect(
        sim.instances.find(
          (instance) => instance.dungeonId === IGNIVAR_SECOND_WING_ID && instance.partyKey !== null,
        )?.difficulty,
      ).toBe(difficulty);
    },
  );

  it('denies Assembly entry independently for a foreign claim and an outside player', () => {
    const { sim, boss } = claimedRaid();
    const source = sim.instances.find(
      (instance) => instance.dungeonId === IGNIVAR_RAID_ARENA_ID && instance.partyKey !== null,
    );
    if (!source?.partyKey) throw new Error('Ignivar source claim did not form');
    boss.dead = true;
    boss.hp = 0;
    sim.tick();

    const ownerKey = source.partyKey;
    source.partyKey = 'party:foreign';
    expect(enterDungeon(sim.ctx, IGNIVAR_MOLTEN_ASSEMBLY_ID, sim.player.id)).toBe(false);
    source.partyKey = ownerKey;

    teleport(sim, sim.player.id, { x: 0, z: 0 });
    expect(enterDungeon(sim.ctx, IGNIVAR_MOLTEN_ASSEMBLY_ID, sim.player.id)).toBe(false);
  });

  it('lets a solo dev tester walk the raid family end to end (maintainer walk-through)', () => {
    // The owner-directed contract since the fortress entrance shipped: a
    // dev-commands sim skips the raid-group refusal (the warning still
    // fires) so the maintainer can experience the whole walk-through solo.
    // Live sims never carry devCommands (ALLOW_DEV_COMMANDS is a root
    // invariant), and the non-dev refusals stay pinned by the foreign-claim
    // and outside-player cases above.
    const sim = new Sim({ seed: 3411, playerClass: 'warrior', devCommands: true });
    sim.chat(`/dev dungeon ${IGNIVAR_RAID_ARENA_ID} normal`);
    const boss = [...sim.entities.values()].find((entity) => entity.templateId === IGNIVAR_BOSS_ID);
    if (!boss) throw new Error('Solo Ignivar did not spawn');
    boss.dead = true;
    boss.hp = 0;
    sim.tick();

    // On the merged tree the entrance arm's dev-skip contract carries the
    // walk-through forward: with the arena boss down, the dev tester steps
    // into the raid arm's next room in the chain.
    expect(enterDungeon(sim.ctx, IGNIVAR_MOLTEN_ASSEMBLY_ID, sim.player.id)).toBe(true);
    expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId).toBe(IGNIVAR_MOLTEN_ASSEMBLY_ID);
  });

  it('keeps every claimed raid room alive while the raid occupies any sibling', () => {
    const { sim, boss } = claimedRaid();
    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, sim.player.id, true)).toBe(true);
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, sim.player.id, true)).toBe(true);
    boss.dead = true;
    boss.hp = 0;
    sim.tick();

    const party = sim.partyOf(sim.player.id);
    if (!party) throw new Error('Practice raid did not form');
    for (const pid of party.members) {
      expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, pid, true)).toBe(true);
      expect(enterDungeon(sim.ctx, IGNIVAR_MOLTEN_ASSEMBLY_ID, pid, true)).toBe(true);
      expect(enterDungeon(sim.ctx, IGNIVAR_SECOND_WING_ID, pid, true)).toBe(true);
    }

    reapEmptyInstances(sim);

    const family = sim.instances.filter(
      (instance) =>
        IGNIVAR_RAID_ROOM_IDS.some((dungeonId) => dungeonId === instance.dungeonId) &&
        instance.partyKey !== null,
    );
    expect(family.map((instance) => instance.dungeonId).sort()).toEqual(
      [...IGNIVAR_RAID_ROOM_IDS].sort(),
    );
    const npcTemplatesByRoom = new Map(
      family.map((instance) => [
        instance.dungeonId,
        instance.npcIds.map((id) => sim.entities.get(id)?.templateId),
      ]),
    );
    expect(npcTemplatesByRoom.get(IGNIVAR_FORGE_APPROACH_ID)).toEqual([
      IGNIVAR_MAELIN_NPC_ID,
      IGNIVAR_MAELIN_PROJECTION_NPC_ID,
    ]);
    expect(npcTemplatesByRoom.get(IGNIVAR_RAID_ARENA_ID)).toEqual([
      IGNIVAR_MAELIN_PROJECTION_NPC_ID,
    ]);
    expect(npcTemplatesByRoom.get(IGNIVAR_MOLTEN_ASSEMBLY_ID)).toEqual([
      IGNIVAR_MAELIN_PROJECTION_NPC_ID,
    ]);
    expect(npcTemplatesByRoom.get(IGNIVAR_SECOND_WING_ID)).toEqual([
      IGNIVAR_MAELIN_PROJECTION_NPC_ID,
    ]);
    expect(sim.entities.get(boss.id)?.dead).toBe(true);

    for (const pid of party.members) {
      expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, pid, true)).toBe(true);
    }
    reapEmptyInstances(sim);
    for (const roomId of IGNIVAR_RAID_ROOM_IDS) {
      expect(
        sim.instances.find(
          (instance) => instance.dungeonId === roomId && instance.partyKey !== null,
        ),
      ).toBeDefined();
    }
  });

  it('frees all empty rooms atomically and reclaims a fresh locked approach', () => {
    const { sim, boss } = claimedRaid();
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, sim.player.id, true)).toBe(true);
    boss.dead = true;
    boss.hp = 0;
    sim.tick();
    const party = sim.partyOf(sim.player.id);
    if (!party) throw new Error('Practice raid did not form');
    for (const pid of party.members) {
      expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, pid, true)).toBe(true);
      expect(enterDungeon(sim.ctx, IGNIVAR_MOLTEN_ASSEMBLY_ID, pid, true)).toBe(true);
      expect(enterDungeon(sim.ctx, IGNIVAR_SECOND_WING_ID, pid, true)).toBe(true);
      teleport(sim, pid, { x: 0, z: 0 });
    }
    const familyNpcIds = sim.instances
      .filter(
        (instance) =>
          IGNIVAR_RAID_ROOM_IDS.some((dungeonId) => dungeonId === instance.dungeonId) &&
          instance.partyKey !== null,
      )
      .flatMap((instance) => instance.npcIds);

    reapEmptyInstances(sim);
    expect(
      sim.instances.filter(
        (instance) =>
          IGNIVAR_RAID_ROOM_IDS.some((dungeonId) => dungeonId === instance.dungeonId) &&
          instance.partyKey !== null,
      ),
    ).toEqual([]);
    for (const npcId of familyNpcIds) expect(sim.entities.has(npcId)).toBe(false);

    sim.chat(`/dev dungeon ${IGNIVAR_FORGE_APPROACH_ID} normal`);
    const freshGate = [...sim.entities.values()].find(
      (entity) =>
        entity.templateId === IGNIVAR_GATE_LOCKED_TEMPLATE &&
        entity.dungeonId === IGNIVAR_RAID_ARENA_ID,
    );
    expect(freshGate).toBeDefined();
    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, sim.player.id)).toBe(false);
  });
});
