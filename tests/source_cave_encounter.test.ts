import { describe, expect, it } from 'vitest';
import { runWeaponProcs } from '../src/sim/combat/equip_procs';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import {
  buildSourceCaveWaveLogins,
  SOURCE_CAVE_CONFIRM_TEXT,
  SOURCE_CAVE_CORPSE_DESPAWN_SECONDS,
  SOURCE_CAVE_DUNGEON_ID,
  SOURCE_CAVE_ENCIRCLE_RADIUS,
  SOURCE_CAVE_INITIAL_DELAY,
  SOURCE_CAVE_INTERMISSION_DELAY,
  SOURCE_CAVE_PLACEHOLDER_ROSTER,
  SOURCE_CAVE_REBOOT_SAFE_RADIUS,
  SOURCE_CAVE_REBOOT_TEMPLATE,
  SOURCE_CAVE_SEAL_RADIUS,
  SOURCE_CAVE_WIPE_RESET_DELAY,
} from '../src/sim/source_cave';
import type {
  SourceCaveEncounterState,
  SourceCaveMobSpec,
  SourceCaveRosterEntry,
} from '../src/sim/source_cave/types';
import type { Entity, SimEvent } from '../src/sim/types';
import type { SourceCaveInfo } from '../src/world_api';

// biome-ignore lint/suspicious/noExplicitAny: encounter tests reach Sim's internal context helpers.
type AnySim = Sim & Record<string, any>;
type EncounterInstance = InstanceSlot & { sourceCaveEncounter: SourceCaveEncounterState };

const ROSTER: SourceCaveRosterEntry[] = [
  { login: 'boss', mergedPrs: 90, rank: 1 },
  { login: 'architect', mergedPrs: 40, rank: 2 },
  { login: 'runesmith', mergedPrs: 20, rank: 3 },
  { login: 'artificer-a', mergedPrs: 10, rank: 4 },
  { login: 'artificer-b', mergedPrs: 8, rank: 5 },
  { login: 'tinkerer-a', mergedPrs: 3, rank: 6 },
  { login: 'tinkerer-b', mergedPrs: 2, rank: 7 },
  { login: 'tinkerer-c', mergedPrs: 1, rank: 8 },
];

function makeSim(roster = ROSTER): AnySim {
  return new Sim({
    seed: 42,
    noPlayer: true,
    playerClass: 'warrior',
    sourceCaveRoster: roster,
  }) as AnySim;
}

function teleport(sim: AnySim, entity: Entity, x: number, z: number): void {
  entity.pos = { x, y: entity.pos.y, z };
  entity.prevPos = { ...entity.pos };
  sim.rebucket(entity);
}

function setupRaid(sim: AnySim): {
  leader: number;
  member: number;
  inst: EncounterInstance;
  button: Entity;
  exit: Entity;
} {
  const leader = sim.addPlayer('warrior', 'Leader');
  const member = sim.addPlayer('priest', 'Healer');
  sim.setPlayerLevel(20, leader);
  sim.setPlayerLevel(20, member);
  sim.partyInvite(member, leader);
  sim.partyAccept(member);
  sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, leader);
  sim.enterDungeon(SOURCE_CAVE_DUNGEON_ID, member);
  const inst = sim.instances.find(
    (candidate: { dungeonId: string; partyKey: string | null }) =>
      candidate.dungeonId === SOURCE_CAVE_DUNGEON_ID && candidate.partyKey !== null,
  );
  if (!inst?.sourceCaveEncounter || inst.exitId === null) {
    throw new Error('source cave instance missing');
  }
  const button = inst.objectIds
    .map((id: number) => sim.entities.get(id))
    .find((entity: Entity | undefined) => entity?.templateId === SOURCE_CAVE_REBOOT_TEMPLATE);
  const exit = sim.entities.get(inst.exitId);
  if (!button || !exit) throw new Error('source cave encounter fixtures missing');
  return { leader, member, inst: inst as EncounterInstance, button, exit };
}

function eventText(events: SimEvent[]): string[] {
  return events.flatMap((event) =>
    'text' in event && typeof event.text === 'string' ? [event.text] : [],
  );
}

function tickFor(sim: AnySim, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < Math.ceil(seconds * 20); i++) events.push(...sim.tick());
  return events;
}

function killMob(sim: AnySim, mob: Entity, killer: Entity): void {
  (sim as unknown as { handleDeath(target: Entity, source: Entity): void }).handleDeath(
    mob,
    killer,
  );
}

function putAtButton(sim: AnySim, pid: number, button: Entity, radius = 0): void {
  const player = sim.entities.get(pid) as Entity;
  teleport(sim, player, button.pos.x + radius, button.pos.z);
  player.targetId = button.id;
}

describe('source cave deterministic waves', () => {
  it('breaks duplicate-rank ties by login for a total deterministic order', () => {
    const tied = [
      {
        login: 'zeta',
        mergedPrs: 1,
        rank: 7,
        boss: false,
        combatant: true,
        combatTier: 'tinkerer',
      },
      {
        login: 'alpha',
        mergedPrs: 1,
        rank: 7,
        boss: false,
        combatant: true,
        combatTier: 'tinkerer',
      },
    ] as SourceCaveMobSpec[];

    expect(buildSourceCaveWaveLogins(tied)).toEqual([['alpha', 'zeta']]);
  });

  it('partitions the live 37-contributor roster into the intended six waves', () => {
    const sim = makeSim(SOURCE_CAVE_PLACEHOLDER_ROSTER);
    if (!sim.sourceCave) throw new Error('source cave runtime missing');
    // 16 tinkerers chunk at the raid-tier wave cap of 10 (10 + 6), then the 8
    // artificers, 6 runesmiths, and the architect tier (5 architects + the
    // non-boss worldwright) split at the 3-cleaver cap (3 + 3), then the boss.
    expect(buildSourceCaveWaveLogins(sim.sourceCave.spec.mobs).map((wave) => wave.length)).toEqual([
      10, 6, 8, 6, 3, 3, 1,
    ]);
  });

  it('keeps the exact wave budget after every non-boss contributor gains 100 PRs', () => {
    const promoted = SOURCE_CAVE_PLACEHOLDER_ROSTER.map((entry) => ({
      ...entry,
      mergedPrs: entry.rank === 1 ? entry.mergedPrs : entry.mergedPrs + 100,
    }));
    const sim = makeSim(promoted);
    if (!sim.sourceCave) throw new Error('source cave runtime missing');
    expect(buildSourceCaveWaveLogins(sim.sourceCave.spec.mobs).map((wave) => wave.length)).toEqual([
      10, 6, 8, 6, 3, 3, 1,
    ]);
  });

  it('keeps overflow contributors hostile on the ring, retires them with waves, and wakes them on breach', () => {
    const roster: SourceCaveRosterEntry[] = [
      ...SOURCE_CAVE_PLACEHOLDER_ROSTER,
      ...Array.from({ length: 23 }, (_, i) => ({
        login: `newcomer-${i}`,
        mergedPrs: 1,
        rank: 38 + i,
      })),
    ];
    const sim = makeSim(roster);
    const { leader, member, inst, button } = setupRaid(sim);
    putAtButton(sim, leader, button);
    putAtButton(sim, member, button, 2);

    sim.interact(leader);

    const combatIds = new Set(inst.sourceCaveEncounter.waves.flat());
    const spectatorIds = inst.mobIds.filter((id: number) => !combatIds.has(id));
    expect(inst.mobIds.length).toBe(60);
    expect(combatIds.size).toBe(37);
    expect(spectatorIds.length).toBe(23);
    expect([...combatIds].every((id) => sim.entities.get(id)?.hostile === true)).toBe(true);
    expect(spectatorIds.every((id: number) => sim.entities.get(id)?.hostile === true)).toBe(true);
    tickFor(sim, SOURCE_CAVE_INITIAL_DELAY + 0.1);

    const awakenedGuardian = sim.entities.get(spectatorIds[0]) as Entity;
    const leaderEntity = sim.entities.get(leader) as Entity;
    const guardianHp = awakenedGuardian.hp;
    sim.aggroMob(awakenedGuardian, leaderEntity, true);
    sim.dealDamage(
      leaderEntity,
      awakenedGuardian,
      1,
      false,
      'physical',
      'Test Strike',
      'hit',
      true,
    );
    expect(awakenedGuardian.hp).toBe(guardianHp - 1);
    expect(['chase', 'attack']).toContain(awakenedGuardian.aiState);
    expect(inst.sourceCaveEncounter.activeMobIds.has(awakenedGuardian.id)).toBe(true);
    expect(inst.sourceCaveEncounter.awakenedGuardianMobIds).toEqual(new Set([awakenedGuardian.id]));
    expect(inst.sourceCaveEncounter.breached).toBe(false);

    for (const id of inst.sourceCaveEncounter.waves[0]) {
      const mob = sim.entities.get(id) as Entity;
      mob.dead = true;
      mob.hp = 0;
    }
    sim.tick();
    expect(spectatorIds.filter((id: number) => !sim.entities.has(id)).length).toBeGreaterThan(0);
    expect(sim.entities.has(awakenedGuardian.id)).toBe(true);

    putAtButton(sim, member, button, SOURCE_CAVE_REBOOT_SAFE_RADIUS + 0.5);
    sim.tick();
    expect(inst.sourceCaveEncounter.breached).toBe(true);
    const remainingSpectators = spectatorIds.filter((id: number) => sim.entities.has(id));
    expect(remainingSpectators.length).toBeGreaterThan(0);
    expect(
      remainingSpectators.every((id: number) => inst.sourceCaveEncounter.activeMobIds.has(id)),
    ).toBe(true);

    for (const id of combatIds) (sim.entities.get(id) as Entity).dead = true;
    sim.tick();
    expect(inst.sourceCaveEncounter.cleared).toBe(false);
    for (const id of remainingSpectators) (sim.entities.get(id) as Entity).dead = true;
    sim.tick();
    expect(inst.sourceCaveEncounter.cleared).toBe(true);
  });

  it('requires a deliberately pulled overflow guardian for a normal clear', () => {
    const roster: SourceCaveRosterEntry[] = [
      ...SOURCE_CAVE_PLACEHOLDER_ROSTER,
      ...Array.from({ length: 23 }, (_, i) => ({
        login: `newcomer-${i}`,
        mergedPrs: 1,
        rank: 38 + i,
      })),
    ];
    const sim = makeSim(roster);
    const { leader, member, inst, button } = setupRaid(sim);
    putAtButton(sim, leader, button);
    putAtButton(sim, member, button, 2);
    sim.interact(leader);
    const guardianId = inst.sourceCaveEncounter.spectatorMobIdsByWave[0][0];
    sim.aggroMob(sim.entities.get(guardianId) as Entity, sim.entities.get(leader) as Entity, true);
    for (const id of inst.sourceCaveEncounter.combatMobIds) {
      const mob = sim.entities.get(id) as Entity;
      mob.dead = true;
      mob.hp = 0;
    }
    sim.tick();
    expect(inst.sourceCaveEncounter.cleared).toBe(false);
    expect(sim.sourceCaveInfoWire(leader)).toMatchObject({ totalMobs: 38, killed: 37 });

    const guardian = sim.entities.get(guardianId) as Entity;
    guardian.dead = true;
    guardian.hp = 0;
    sim.tick();
    expect(inst.sourceCaveEncounter.cleared).toBe(true);
  });

  it('wakes only the overflow guardians actually hit by a capped chain proc', () => {
    const roster: SourceCaveRosterEntry[] = [
      ...SOURCE_CAVE_PLACEHOLDER_ROSTER,
      ...Array.from({ length: 23 }, (_, i) => ({
        login: `newcomer-${i}`,
        mergedPrs: 1,
        rank: 38 + i,
      })),
    ];
    const sim = makeSim(roster);
    const { leader, member, inst, button } = setupRaid(sim);
    putAtButton(sim, leader, button);
    putAtButton(sim, member, button, 2);
    sim.interact(leader);
    const guardianIds = new Set(inst.sourceCaveEncounter.spectatorMobIdsByWave.flat());
    [...guardianIds].forEach((id, index) => {
      teleport(
        sim,
        sim.entities.get(id) as Entity,
        button.pos.x + SOURCE_CAVE_ENCIRCLE_RADIUS + (index % 5) * 0.5,
        button.pos.z + Math.floor(index / 5) * 0.5,
      );
    });
    const primary = sim.entities.get([...guardianIds][0]) as Entity;
    const wielder = sim.entities.get(leader) as Entity;
    const nearby = (
      sim as unknown as {
        hostilesInRadius(source: Entity, pos: Entity['pos'], radius: number): Entity[];
      }
    )
      .hostilesInRadius(wielder, primary.pos, 8)
      .filter((mob) => guardianIds.has(mob.id));
    expect(nearby.length).toBeGreaterThan(4);
    expect(inst.sourceCaveEncounter.awakenedGuardianMobIds.size).toBe(0);

    wielder.mainhandItemId = 'kingsbane_last_oath';
    (sim.ctx.rng as unknown as { chance(probability: number): boolean }).chance = () => true;
    runWeaponProcs(sim.ctx, wielder, primary, 'weaponHit');

    expect(inst.sourceCaveEncounter.awakenedGuardianMobIds.size).toBeGreaterThan(0);
    expect(inst.sourceCaveEncounter.awakenedGuardianMobIds.size).toBeLessThanOrEqual(4);
    expect(inst.sourceCaveEncounter.awakenedGuardianMobIds.size).toBeLessThan(nearby.length);
  });

  it('retires exactly the overflow guardian group assigned to each completed wave', () => {
    const roster: SourceCaveRosterEntry[] = [
      ...SOURCE_CAVE_PLACEHOLDER_ROSTER,
      ...Array.from({ length: 23 }, (_, i) => ({
        login: `newcomer-${i}`,
        mergedPrs: 1,
        rank: 38 + i,
      })),
    ];
    const sim = makeSim(roster);
    const { leader, member, inst, button } = setupRaid(sim);
    putAtButton(sim, leader, button);
    putAtButton(sim, member, button, 2);
    sim.interact(leader);
    const combatIds = new Set(inst.sourceCaveEncounter.combatMobIds);
    const spectatorIds = inst.mobIds.filter((id) => !combatIds.has(id));
    const guardianGroups = inst.sourceCaveEncounter.spectatorMobIdsByWave.map((group) => [
      ...group,
    ]);
    const killer = sim.entities.get(leader) as Entity;

    for (let waveIndex = 0; waveIndex < inst.sourceCaveEncounter.waves.length; waveIndex++) {
      for (let ticks = 0; ticks < 200; ticks++) {
        if (inst.sourceCaveEncounter.activatedWaves.has(waveIndex)) break;
        sim.tick();
      }
      expect(inst.sourceCaveEncounter.activatedWaves.has(waveIndex)).toBe(true);
      for (const id of inst.sourceCaveEncounter.waves[waveIndex]) {
        killMob(sim, sim.entities.get(id) as Entity, killer);
      }
      sim.tick();
      expect(inst.sourceCaveEncounter.retiredSpectatorWaves).toEqual(
        new Set(Array.from({ length: waveIndex + 1 }, (_, index) => index)),
      );
      for (let groupIndex = 0; groupIndex < guardianGroups.length; groupIndex++) {
        expect(guardianGroups[groupIndex].every((id) => sim.entities.has(id))).toBe(
          groupIndex > waveIndex,
        );
      }
    }

    expect(inst.sourceCaveEncounter.cleared).toBe(true);
    expect(spectatorIds.every((id) => !sim.entities.has(id))).toBe(true);
  });

  it('keeps combatant and breached-guardian corpses for exactly 10 seconds', () => {
    const roster: SourceCaveRosterEntry[] = [
      ...SOURCE_CAVE_PLACEHOLDER_ROSTER,
      ...Array.from({ length: 23 }, (_, i) => ({
        login: `newcomer-${i}`,
        mergedPrs: 1,
        rank: 38 + i,
      })),
    ];

    const combatSim = makeSim(roster);
    const combatRaid = setupRaid(combatSim);
    putAtButton(combatSim, combatRaid.leader, combatRaid.button);
    putAtButton(combatSim, combatRaid.member, combatRaid.button, 2);
    combatSim.interact(combatRaid.leader);
    tickFor(combatSim, SOURCE_CAVE_INITIAL_DELAY + 0.1);
    const combatantId = combatRaid.inst.sourceCaveEncounter.waves[0][0];
    killMob(
      combatSim,
      combatSim.entities.get(combatantId) as Entity,
      combatSim.entities.get(combatRaid.leader) as Entity,
    );
    tickFor(combatSim, SOURCE_CAVE_CORPSE_DESPAWN_SECONDS - 0.2);
    expect(combatSim.entities.has(combatantId)).toBe(true);
    tickFor(combatSim, 0.3);
    expect(combatSim.entities.has(combatantId)).toBe(false);

    const breachSim = makeSim(roster);
    const breachRaid = setupRaid(breachSim);
    putAtButton(breachSim, breachRaid.leader, breachRaid.button);
    putAtButton(breachSim, breachRaid.member, breachRaid.button, 2);
    (breachSim.entities.get(breachRaid.leader) as Entity).gm = true;
    (breachSim.entities.get(breachRaid.member) as Entity).gm = true;
    breachSim.interact(breachRaid.leader);
    putAtButton(
      breachSim,
      breachRaid.member,
      breachRaid.button,
      SOURCE_CAVE_REBOOT_SAFE_RADIUS + 0.5,
    );
    breachSim.tick();
    const guardianId = breachRaid.inst.sourceCaveEncounter.spectatorMobIdsByWave.flat()[0];
    killMob(
      breachSim,
      breachSim.entities.get(guardianId) as Entity,
      breachSim.entities.get(breachRaid.leader) as Entity,
    );
    tickFor(breachSim, SOURCE_CAVE_CORPSE_DESPAWN_SECONDS - 0.2);
    expect(breachSim.entities.has(guardianId)).toBe(true);
    tickFor(breachSim, 0.3);
    expect(breachSim.entities.has(guardianId)).toBe(false);
  });

  it('starts immediately when every living occupant is on the central seal', () => {
    const sim = makeSim();
    const { leader, member, inst, button, exit } = setupRaid(sim);
    putAtButton(sim, leader, button);
    putAtButton(sim, member, button, 2);

    sim.interact(leader);

    expect(inst.sourceCaveEncounter.started).toBe(true);
    expect(inst.sourceCaveEncounter.breached).toBe(false);
    expect(button.lootable).toBe(false);
    expect(exit.lootable).toBe(false);
    expect(inst.mobIds.every((id: number) => sim.entities.get(id)?.hostile)).toBe(true);
    tickFor(sim, SOURCE_CAVE_INITIAL_DELAY + 0.1);
    expect(inst.sourceCaveEncounter.activeMobIds.size).toBe(
      inst.sourceCaveEncounter.waves[0].length,
    );
    expect(inst.sourceCaveEncounter.activatedWaves).toEqual(new Set([0]));
  });

  it('opens the first paced wave on the player who rebooted the cave', () => {
    const sim = makeSim();
    const { leader, member, inst, button } = setupRaid(sim);
    putAtButton(sim, leader, button);
    putAtButton(sim, member, button, 2);
    for (const id of inst.mobIds) (sim.entities.get(id) as Entity).moveSpeed = 40;
    sim.interact(leader);

    tickFor(sim, SOURCE_CAVE_INITIAL_DELAY - 0.1);
    const firstMob = sim.entities.get(inst.sourceCaveEncounter.waves[0][0]) as Entity;
    const dx = firstMob.pos.x - button.pos.x;
    const dz = firstMob.pos.z - button.pos.z;
    const distance = Math.hypot(dx, dz);
    teleport(
      sim,
      sim.entities.get(member) as Entity,
      button.pos.x + (dx / distance) * 9,
      button.pos.z + (dz / distance) * 9,
    );

    tickFor(sim, 0.2);

    expect(firstMob.aggroTargetId).toBe(leader);
  });

  it('opens later paced waves on the player who rebooted the cave', () => {
    const sim = makeSim();
    const { leader, member, inst, button } = setupRaid(sim);
    putAtButton(sim, leader, button);
    putAtButton(sim, member, button, 2);
    sim.interact(leader);
    tickFor(sim, SOURCE_CAVE_INITIAL_DELAY + 0.1);

    for (const id of inst.sourceCaveEncounter.waves[0])
      (sim.entities.get(id) as Entity).dead = true;
    tickFor(sim, SOURCE_CAVE_INTERMISSION_DELAY + 0.2);

    for (const id of inst.sourceCaveEncounter.waves[1]) {
      expect((sim.entities.get(id) as Entity).aggroTargetId).toBe(leader);
    }
  });

  it('falls back to a living raider when the rebooting player is dead', () => {
    const sim = makeSim();
    const { leader, member, inst, button } = setupRaid(sim);
    putAtButton(sim, leader, button);
    putAtButton(sim, member, button, 2);
    sim.interact(leader);
    tickFor(sim, SOURCE_CAVE_INITIAL_DELAY + 0.1);

    (sim.entities.get(leader) as Entity).dead = true;
    for (const id of inst.sourceCaveEncounter.waves[0])
      (sim.entities.get(id) as Entity).dead = true;
    tickFor(sim, SOURCE_CAVE_INTERMISSION_DELAY + 0.2);

    for (const id of inst.sourceCaveEncounter.waves[1]) {
      expect((sim.entities.get(id) as Entity).aggroTargetId).toBe(member);
    }
  });

  it('projects gradual seal occupancy and the latched breach state through IWorld', () => {
    const sim = makeSim();
    const { leader, member, button } = setupRaid(sim);
    putAtButton(sim, leader, button);
    let info = sim.sourceCaveInfoWire(leader) as SourceCaveInfo;
    expect(info).toMatchObject({
      sealState: 'idle',
      playersInsideSeal: 1,
      playersInInstance: 2,
      activeWave: 0,
      totalWaves: 5,
    });

    putAtButton(sim, member, button, 2);
    info = sim.sourceCaveInfoWire(leader) as SourceCaveInfo;
    expect(info.playersInsideSeal).toBe(2);
    sim.interact(leader);
    expect((sim.sourceCaveInfoWire(leader) as SourceCaveInfo).sealState).toBe('active');

    putAtButton(sim, member, button, SOURCE_CAVE_REBOOT_SAFE_RADIUS + 0.5);
    sim.tick();
    info = sim.sourceCaveInfoWire(leader) as SourceCaveInfo;
    expect(info.sealState).toBe('breached');
    expect(info.activeWave).toBe(info.totalWaves);
  });

  it('includes every remaining overflow guardian in breached HUD progress', () => {
    const roster: SourceCaveRosterEntry[] = [
      ...SOURCE_CAVE_PLACEHOLDER_ROSTER,
      ...Array.from({ length: 23 }, (_, i) => ({
        login: `newcomer-${i}`,
        mergedPrs: 1,
        rank: 38 + i,
      })),
    ];
    const sim = makeSim(roster);
    const { leader, member, inst, button } = setupRaid(sim);
    putAtButton(sim, leader, button);
    putAtButton(sim, member, button, 2);
    sim.interact(leader);
    putAtButton(sim, member, button, SOURCE_CAVE_REBOOT_SAFE_RADIUS + 0.5);
    sim.tick();
    for (const id of inst.sourceCaveEncounter.combatMobIds) {
      const mob = sim.entities.get(id) as Entity;
      mob.dead = true;
      mob.hp = 0;
    }

    expect(sim.sourceCaveInfoWire(leader)).toMatchObject({
      sealState: 'breached',
      totalMobs: 60,
      killed: 37,
    });
  });

  it('warns once, then lets the same player force a catastrophic pull', () => {
    const sim = makeSim();
    const { leader, member, inst, button } = setupRaid(sim);
    putAtButton(sim, leader, button);
    putAtButton(sim, member, button, SOURCE_CAVE_REBOOT_SAFE_RADIUS + 12);

    sim.interact(leader);
    const warningEvents = sim.tick();
    expect(eventText(warningEvents)).toContain(SOURCE_CAVE_CONFIRM_TEXT);
    expect(inst.sourceCaveEncounter.started).toBe(false);
    expect(button.lootable).toBe(true);

    sim.interact(leader);
    sim.tick();
    expect(inst.sourceCaveEncounter.started).toBe(true);
    expect(inst.sourceCaveEncounter.breached).toBe(true);
    expect(inst.sourceCaveEncounter.activeMobIds.size).toBe(inst.mobIds.length);
    expect(
      inst.mobIds.every((id: number) => {
        const mob = sim.entities.get(id) as Entity;
        return mob.aiState === 'chase' || mob.aiState === 'attack';
      }),
    ).toBe(true);
  });

  it('wakes an entire future wave when one dormant contributor is attacked', () => {
    const sim = makeSim();
    const { leader, member, inst, button } = setupRaid(sim);
    putAtButton(sim, leader, button);
    putAtButton(sim, member, button, 2);
    sim.interact(leader);
    tickFor(sim, SOURCE_CAVE_INITIAL_DELAY + 0.1);
    const futureWave = inst.sourceCaveEncounter.waves[1];
    const target = sim.entities.get(futureWave[0]) as Entity;
    const player = sim.entities.get(leader) as Entity;

    sim.dealDamage(player, target, 1, false, 'physical', 'Test Strike', 'hit');

    expect(inst.sourceCaveEncounter.activatedWaves.has(1)).toBe(true);
    expect(
      futureWave.every((id: number) => {
        const mob = sim.entities.get(id) as Entity;
        return mob.aiState === 'chase' || mob.aiState === 'attack';
      }),
    ).toBe(true);
  });

  it('awakens every remaining contributor when a living player leaves the seal', () => {
    const sim = makeSim();
    const { leader, member, inst, button } = setupRaid(sim);
    putAtButton(sim, leader, button);
    putAtButton(sim, member, button, 2);
    sim.interact(leader);
    tickFor(sim, SOURCE_CAVE_INITIAL_DELAY + 0.1);
    putAtButton(sim, member, button, SOURCE_CAVE_REBOOT_SAFE_RADIUS + 0.5);

    sim.tick();

    expect(inst.sourceCaveEncounter.breached).toBe(true);
    expect(inst.sourceCaveEncounter.activeMobIds.size).toBe(inst.mobIds.length);
  });

  it('marches every dormant contributor onto the encirclement ring, facing the group', () => {
    const sim = makeSim();
    const { leader, member, inst, button } = setupRaid(sim);
    putAtButton(sim, leader, button);
    putAtButton(sim, member, button, 2);
    // Speed the march up so the whole roster arrives inside the countdown window.
    for (const id of inst.mobIds) (sim.entities.get(id) as Entity).moveSpeed = 40;
    sim.interact(leader);

    tickFor(sim, SOURCE_CAVE_INITIAL_DELAY - 0.3);
    expect(inst.sourceCaveEncounter.activeMobIds.size).toBe(0);
    for (const id of inst.mobIds) {
      const mob = sim.entities.get(id) as Entity;
      if (mob.dead) continue;
      const dx = mob.pos.x - button.pos.x;
      const dz = mob.pos.z - button.pos.z;
      const d = Math.hypot(dx, dz);
      // On the ring: outside the seal, with the small intimidation gap.
      expect(d).toBeGreaterThan(SOURCE_CAVE_SEAL_RADIUS + 1);
      expect(Math.abs(d - SOURCE_CAVE_ENCIRCLE_RADIUS)).toBeLessThan(1);
      // Facing the mustered group at the centre.
      const toCentre = Math.atan2(-dx, -dz);
      const facingError = Math.abs(
        Math.atan2(Math.sin(mob.facing - toCentre), Math.cos(mob.facing - toCentre)),
      );
      expect(facingError).toBeLessThan(0.15);
    }
  });

  it('keeps the dormant cohorts on the ring while an activated wave leaves it', () => {
    const sim = makeSim();
    const { leader, member, inst, button } = setupRaid(sim);
    putAtButton(sim, leader, button);
    putAtButton(sim, member, button, 2);
    for (const id of inst.mobIds) (sim.entities.get(id) as Entity).moveSpeed = 40;
    sim.interact(leader);

    // Past the first activation, plus time for the remaining cohorts to close
    // ranks into their re-spaced ring slots.
    tickFor(sim, SOURCE_CAVE_INITIAL_DELAY + 1.5);
    const state = inst.sourceCaveEncounter;
    expect(state.activeMobIds.size).toBe(state.waves[0].length);
    for (const id of inst.mobIds) {
      const mob = sim.entities.get(id) as Entity;
      if (mob.dead || state.activeMobIds.has(id)) continue;
      const d = Math.hypot(mob.pos.x - button.pos.x, mob.pos.z - button.pos.z);
      expect(Math.abs(d - SOURCE_CAVE_ENCIRCLE_RADIUS)).toBeLessThan(1);
      expect(mob.aiState).toBe('idle');
      expect(mob.inCombat).toBe(false);
    }
  });

  it('seals the exit until clear and restores the whole encounter after a wipe', () => {
    const sim = makeSim();
    const { leader, member, inst, button, exit } = setupRaid(sim);
    putAtButton(sim, leader, button);
    putAtButton(sim, member, button, 2);
    sim.interact(leader);
    const leaderEntity = sim.entities.get(leader) as Entity;
    const memberEntity = sim.entities.get(member) as Entity;
    const beforeLeave = { ...leaderEntity.pos };

    sim.leaveDungeon(leader);
    expect(leaderEntity.pos).toEqual(beforeLeave);

    leaderEntity.dead = true;
    memberEntity.dead = true;
    tickFor(sim, SOURCE_CAVE_WIPE_RESET_DELAY + 0.1);

    expect(inst.sourceCaveEncounter.started).toBe(false);
    expect(button.lootable).toBe(true);
    expect(exit.lootable).toBe(true);
    expect(
      inst.mobIds.every((id: number) => {
        const mob = sim.entities.get(id) as Entity;
        return !mob.dead && !mob.hostile && mob.aiState === 'idle' && mob.hp === mob.maxHp;
      }),
    ).toBe(true);
  });

  it('rebuilds retired spectators and despawned corpses on wipe reset', () => {
    const roster: SourceCaveRosterEntry[] = [
      ...SOURCE_CAVE_PLACEHOLDER_ROSTER,
      ...Array.from({ length: 23 }, (_, i) => ({
        login: `newcomer-${i}`,
        mergedPrs: 1,
        rank: 38 + i,
      })),
    ];
    const sim = makeSim(roster);
    const { leader, member, inst, button } = setupRaid(sim);
    putAtButton(sim, leader, button);
    putAtButton(sim, member, button, 2);
    sim.interact(leader);
    const originalIds = [...inst.mobIds];
    tickFor(sim, SOURCE_CAVE_INITIAL_DELAY + 0.1);
    const corpseId = inst.sourceCaveEncounter.waves[0][0];
    const corpse = sim.entities.get(corpseId) as Entity;
    const killer = sim.entities.get(leader) as Entity;
    killMob(sim, corpse, killer);
    tickFor(sim, SOURCE_CAVE_CORPSE_DESPAWN_SECONDS + 0.1);
    expect(sim.entities.has(corpseId)).toBe(false);

    for (const id of inst.sourceCaveEncounter.waves[0].slice(1)) {
      const mob = sim.entities.get(id) as Entity;
      mob.dead = true;
      mob.hp = 0;
    }
    sim.tick();
    expect(inst.mobIds.some((id: number) => !sim.entities.has(id))).toBe(true);

    const retiredGuardianId = inst.sourceCaveEncounter.spectatorMobIdsByWave[0][0];
    const survivingOldMobId = inst.sourceCaveEncounter.waves[1][0];
    (sim.entities.get(leader) as Entity).targetId = retiredGuardianId;
    (sim.entities.get(member) as Entity).targetId = survivingOldMobId;

    (sim.entities.get(leader) as Entity).dead = true;
    (sim.entities.get(member) as Entity).dead = true;
    tickFor(sim, SOURCE_CAVE_WIPE_RESET_DELAY + 0.1);

    expect(inst.mobIds).toHaveLength(60);
    expect(inst.mobIds.every((id: number) => sim.entities.has(id))).toBe(true);
    expect(inst.mobIds.every((id: number) => !originalIds.includes(id))).toBe(true);
    expect(
      new Set([
        ...inst.sourceCaveEncounter.waves.flat(),
        ...inst.sourceCaveEncounter.spectatorMobIdsByWave.flat(),
      ]),
    ).toEqual(new Set(inst.mobIds));
    expect(inst.sourceCaveEncounter.combatMobIds).toHaveLength(37);
    expect(inst.sourceCaveEncounter.started).toBe(false);
    expect((sim.entities.get(leader) as Entity).targetId).toBeNull();
    expect((sim.entities.get(member) as Entity).targetId).toBeNull();
    expect(
      inst.mobIds.every((id: number) => {
        const mob = sim.entities.get(id) as Entity;
        return !mob.dead && !mob.hostile && mob.hp === mob.maxHp;
      }),
    ).toBe(true);
  });
});
