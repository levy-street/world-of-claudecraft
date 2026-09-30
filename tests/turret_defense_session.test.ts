import { describe, expect, it } from 'vitest';
import { QuestWorldWireState } from '../src/net/quest_world_wire_state';
import {
  type CircleCollider,
  type Collider,
  queryOpenWorldColliders,
  supportHeightAt,
} from '../src/sim/colliders';
import { FIRE_AND_FLY_DUNGEON_ID } from '../src/sim/content/fire_and_fly_arena';
import { TURRET_DEFAULT_SCENARIO } from '../src/sim/content/fire_and_fly_scenarios';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import { DEFAULT_MOUNT } from '../src/sim/content/mounts';
import { TURRET_BOWLING, TURRET_SHOCKWAVE, TURRET_TIMING } from '../src/sim/content/turret_defense';
import { NORTH_WATCH_CANNON } from '../src/sim/content/vehicle_stations';
import {
  DUNGEONS,
  dungeonAt,
  getActiveWorldContent,
  instanceOrigin,
  MOBS,
  PLAYER_START,
  WORLD_QUESTS_BY_ID,
} from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  FIRE_AND_FLY_ROCKS,
  FIRE_AND_FLY_TOWER,
  FIRE_AND_FLY_TREES,
  fireAndFlyTrunkRadius,
} from '../src/sim/fire_and_fly_field';
import {
  enterDungeon,
  freeInstance,
  leaveDungeon,
  markInstanceClaimed,
} from '../src/sim/instances/dungeons';
import { positionAt } from '../src/sim/minigames/thrown_body';
import {
  createTurretDefense,
  fireTurret,
  type TurretEvent,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan, turretChargesLeft } from '../src/sim/minigames/turret_defense_plan';
import { turretSessionSeed } from '../src/sim/minigames/turret_defense_rng';
import {
  recordTurretFeedback,
  TURRET_FEEDBACK_LIMIT,
  type TurretFeedback,
  turretFeedbackSince,
} from '../src/sim/minigames/turret_feedback';
import {
  forceTrainingMount,
  MOUNT_OWNERSHIP_REVALIDATE_TICKS,
  mountItemId,
  summonMountItem,
  toggleMount,
} from '../src/sim/mounts';
import { summonPet } from '../src/sim/pet/pet_commands';
import { moveSpeedMult } from '../src/sim/player_motion';
import { RESURRECTION_SICKNESS_ID } from '../src/sim/resurrection';
import { resolveSavedPosExit } from '../src/sim/saved_pos_exit';
import { type InstanceSlot, type PlayerMeta, Sim } from '../src/sim/sim';
import { isArenaQueued } from '../src/sim/social/arena';
import { endBgMatch, startBgMatch } from '../src/sim/social/battleground';
import { RES_HP_FRACTION } from '../src/sim/spirit';
import { claimTurretArena } from '../src/sim/turret_arena_session';
import {
  seatTurret,
  type TurretDefenseView,
  turretWorldProbe,
} from '../src/sim/turret_defense_session';
import {
  type Entity,
  GATHER_CAST_ID,
  type PlayerClass,
  type SimEvent,
  type TurretSession,
  type Vec3,
  type VehicleSession,
} from '../src/sim/types';
import { groundHeight, terrainHeight, waterLevelAt } from '../src/sim/world';
import { worldQuestCycleOfferingQuest } from '../src/sim/world_quest_rotation';
import { WORLD_SEED } from '../src/sim/world_seed';
import type { IWorldVehicles } from '../src/world_api/vehicles';

/** A whole run plays thousands of ticks; under a loaded gate it can pass the default 20 s. */
const FULL_RUN_TIMEOUT_MS = 60_000;

// The best open-world spot of the site survey: real terrain, trees, no aggressive mob near.
// The world probe is host-agnostic, so its open-world contract is still pinned here.
const AMBERFALL = { x: -340, z: 1945 };
// A lake south-east of Amberfall (water surface above the lakebed).
const LAKE = { x: -282, z: 2016 };
const RUN_BOUND = 20 * 60 * 8;
const ARENA_INDEX = DUNGEONS[FIRE_AND_FLY_DUNGEON_ID].index;
const ground = { ground: (x: number, z: number) => groundHeight(x, z, WORLD_SEED) };

function rig(playerClass: PlayerClass = 'warrior') {
  const sim = new Sim({ seed: WORLD_SEED, playerClass, devCommands: true });
  const player = sim.player;
  const meta = sim.meta(player.id)!;
  return { sim, player, meta };
}

function seat(sim: Sim): void {
  sim.chat('/dev turret');
  expect(sim.turretSession).not.toBeNull();
}

/**
 * Moves the player to Amberfall and returns where they stand: far from the
 * Eastbrook arrival point the rig starts on, which is also the arena's own
 * fallback exit, so a return there cannot pass for a return home.
 */
function standAtAmberfall(sim: Sim): Vec3 {
  sim.chat(`/dev tp ${AMBERFALL.x} ${AMBERFALL.z}`);
  const at = { ...sim.player.pos };
  expect(Math.hypot(at.x - PLAYER_START.x, at.z - PLAYER_START.z)).toBeGreaterThan(100);
  expect(dungeonAt(at.x)).toBeNull();
  return at;
}

function turretSeat(sim: Sim): TurretSession {
  const seat = sim.meta(sim.playerId)?.vehicle;
  if (seat?.kind !== 'turret') throw new Error('expected a turret seat');
  return seat;
}

function cannonSeat(sim: Sim): VehicleSession {
  const seat = sim.meta(sim.playerId)?.vehicle;
  if (seat?.kind !== 'cannon') throw new Error('expected a cannon seat');
  return seat;
}

function arenaClaims(sim: Sim): InstanceSlot[] {
  return sim.ctx.instances.filter(
    (inst) => inst.dungeonId === FIRE_AND_FLY_DUNGEON_ID && inst.partyKey !== null,
  );
}

/** Runs `act` and returns the world rng values it drew, in draw order. */
function worldDraws(sim: Sim, act: () => void): number[] {
  const drawn: number[] = [];
  sim.rng.setObserver((value) => {
    drawn.push(value);
  });
  try {
    act();
  } finally {
    sim.rng.setObserver(null);
  }
  return drawn;
}

function turretEvents(events: readonly SimEvent[]) {
  return events.flatMap((e) => (e.type === 'turretDefense' ? [e] : []));
}

function logTexts(events: readonly SimEvent[]): string[] {
  return events.flatMap((e) => (e.type === 'log' && typeof e.text === 'string' ? [e.text] : []));
}

function nearestLive(
  defense: Pick<TurretDefenseView, 'cx' | 'cz' | 'monsters'>,
  tick: number,
): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const m of defense.monsters) {
    if (m.hp <= 0) continue;
    const p = positionAt(m.seg, tick, ground);
    const d = Math.hypot(p.x - defense.cx, p.z - defense.cz);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** The scripted aimer: one shot at the monster nearest the tower whenever the cannon is ready. */
function aimOnce(sim: Sim): void {
  const world: IWorldVehicles = sim;
  const view = world.turretSession;
  if (!view || sim.tickCount < view.defense.readyTick) return;
  const target = nearestLive(view.defense, sim.tickCount);
  if (target) world.useVehicleAction('turret_fire', target);
}

interface RunOutcome {
  phase: string;
  ticks: number;
  events: TurretEvent[];
  pids: Set<number | undefined>;
}

/** Drives a seat to its end through the IWorld surface only; `aim` fires at the monster nearest the tower. */
function playOut(sim: Sim, aim: boolean): RunOutcome {
  const world: IWorldVehicles = sim;
  const events: TurretEvent[] = [];
  const pids = new Set<number | undefined>();
  let ticks = 0;
  const phase = () => world.turretSession?.defense.phase ?? 'gone';
  while (ticks < RUN_BOUND && phase() !== 'won' && phase() !== 'lost') {
    for (const e of turretEvents(sim.tick())) {
      events.push(e.event);
      pids.add(e.pid);
    }
    ticks++;
    if (aim) aimOnce(sim);
  }
  return { phase: phase(), ticks, events, pids };
}

function cannonRig() {
  const { sim, player, meta } = rig('mage');
  const station = NORTH_WATCH_CANNON;
  sim.setPlayerLevel(WORLD_QUESTS_BY_ID[station.questId].minLevel);
  meta.devWorldQuestCycle = worldQuestCycleOfferingQuest('wq3_0', station.questId);
  player.pos = {
    x: station.x,
    z: station.z + 2,
    y: terrainHeight(station.x, station.z + 2, WORLD_SEED),
  };
  player.prevPos = { ...player.pos };
  sim.tick();
  return { sim, player, meta, station };
}

/** Every mount path refuses while seated, the lesson steed's included. */
function expectMountPathsRefused(sim: Sim, player: Entity, meta: PlayerMeta): void {
  const mount = { key: player.mountKey, cast: player.mountCastRemaining ?? 0 };
  expect(summonMountItem(sim.ctx, player.id, DEFAULT_MOUNT)).toBe(false);
  expect(toggleMount(sim.ctx, player.id)).toBe(false);
  meta.mountTraining = {
    sessionId: 'lesson',
    ownerId: player.id,
    anchor: { x: player.pos.x, z: player.pos.z },
    state: 'IN_PROGRESS',
    phase: 'mount',
  };
  expect(toggleMount(sim.ctx, player.id)).toBe(false);
  expect(forceTrainingMount(sim.ctx, player)).toBe(false);
  meta.mountTraining = null;
  expect({ key: player.mountKey, cast: player.mountCastRemaining ?? 0 }).toEqual(mount);
}

/** The player can ride the horse: trained, the reins in the bags, still on foot. */
function ownReins(sim: Sim): void {
  sim.meta(sim.playerId)!.ridingTrained = true;
  sim.addItem(mountItemId(DEFAULT_MOUNT)!, 1);
}

/** The player owns the horse and rides it, summoned the normal way. */
function ownHorse(sim: Sim): void {
  ownReins(sim);
  expect(summonMountItem(sim.ctx, sim.playerId, DEFAULT_MOUNT)).toBe(true);
  for (let i = 0; i < 40 && sim.player.mountKey === ''; i++) sim.tick();
  expect(sim.player.mountKey).toBe(DEFAULT_MOUNT);
}

function addDummy(sim: Sim, dx: number, dz: number): Entity {
  const p = sim.player.pos;
  const dummy = createMob((sim as unknown as { nextId: number }).nextId++, MOBS.training_dummy, 1, {
    x: p.x + dx,
    y: p.y,
    z: p.z + dz,
  });
  sim.addEntity(dummy);
  return dummy;
}

describe('the turret seat', () => {
  it('freezes movement on the roof and refuses casting, auto-attack, items, pets and mount changes', () => {
    const { sim, player, meta } = rig('warlock');
    ownHorse(sim);
    summonPet(sim.ctx, player, 'emberkin');
    const pet = [...sim.entities.values()].find((e) => e.ownerId === player.id)!;
    // Where the character starts: a clear line of sight to the dummy ahead, which
    // stays in the open world while the seat takes its owner to the arena.
    const dummy = addDummy(sim, 0, 10);
    sim.chat('/dev turret');
    expect(player.mountKey).toBe('');
    player.targetId = dummy.id;
    const origin = { ...player.pos };
    meta.moveInput.forward = true;
    meta.moveInput.jump = true;
    for (let i = 0; i < 10; i++) sim.tick();
    meta.moveInput.forward = false;
    meta.moveInput.jump = false;
    expect(player.pos).toEqual(origin);

    const quiet = (fn: () => void): SimEvent[] => {
      fn();
      return sim.tick().filter((e) => e.type === 'error' && e.pid === player.id);
    };
    expect(quiet(() => sim.castAbility('shadow_bolt'))).toEqual([]);
    expect(player.castingAbility).toBeNull();
    expect(quiet(() => sim.startAutoAttack())).toEqual([]);
    expect(player.autoAttack).toBe(false);
    expect(quiet(() => sim.petAttack())).toEqual([]);
    expect(pet.aggroTargetId).not.toBe(dummy.id);
    sim.useItem(mountItemId(DEFAULT_MOUNT)!);
    sim.toggleMounted();
    sim.tick();
    expect(player.mountKey).toBe('');
    expect(player.mountCastRemaining ?? 0).toBe(0);
    expectMountPathsRefused(sim, player, meta);

    sim.leaveVehicle();
    expect(player.mountKey).toBe(DEFAULT_MOUNT);
    expect(sim.turretSession).toBeNull();
    // Back beside the dummy, the same calls act again: the refusals above were the seat's.
    player.targetId = dummy.id;
    sim.castAbility('shadow_bolt');
    expect(player.castingAbility).toBe('shadow_bolt');
    sim.startAutoAttack();
    expect(player.autoAttack).toBe(true);
    sim.petAttack();
    const back = [...sim.entities.values()].find((e) => e.ownerId === player.id)!;
    expect(back.aggroTargetId).toBe(dummy.id);
    expect(summonMountItem(sim.ctx, player.id, DEFAULT_MOUNT)).toBe(true);
    expect(player.mountKey).toBe('');
  });

  it('cancels a real cast in progress and stops auto-attack when seating', () => {
    const outcome = (seated: boolean) => {
      const { sim, player } = rig('warlock');
      const dummy = addDummy(sim, 0, 10);
      player.targetId = dummy.id;
      const hp = dummy.hp;
      sim.startAutoAttack();
      sim.castAbility('shadow_bolt');
      expect(player.castingAbility).toBe('shadow_bolt');
      expect(player.autoAttack).toBe(true);
      if (seated) sim.chat('/dev turret');
      expect(sim.turretSession !== null).toBe(seated);
      const casting = player.castingAbility;
      const autoAttack = player.autoAttack;
      for (let i = 0; i < 20 * 4; i++) sim.tick();
      return { casting, autoAttack, damage: hp - dummy.hp };
    };
    // The control: left alone, the same cast lands on the dummy.
    expect(outcome(false).damage).toBeGreaterThan(0);
    expect(outcome(true)).toEqual({ casting: null, autoAttack: false, damage: 0 });
  });

  it('refuses a starting-bag food item while seated, and eats it off the seat', () => {
    const { sim, player } = rig();
    expect(sim.countItem('baked_bread')).toBe(5);
    seat(sim);
    const auras = player.auras.map((a) => a.id);
    sim.useItem('baked_bread');
    sim.tick();
    expect(sim.countItem('baked_bread')).toBe(5);
    expect(player.auras.map((a) => a.id)).toEqual(auras);
    expect(player.eating ?? null).toBeNull();
    sim.leaveVehicle();
    sim.useItem('baked_bread');
    expect(sim.countItem('baked_bread')).toBe(4);
  });

  it('parks the pet off the field for the seat, and hands it back beside its owner', () => {
    for (const [cls, template] of [
      ['warlock', 'emberkin'],
      ['hunter', 'forest_wolf'],
    ] as const) {
      const { sim, player, meta } = rig(cls);
      standAtAmberfall(sim);
      summonPet(sim.ctx, player, template);
      const pets = () => [...sim.entities.values()].filter((e) => e.ownerId === player.id);
      const dummy = addDummy(sim, 3, 3);
      pets()[0].targetId = dummy.id;
      pets()[0].autoAttack = true;
      sim.chat('/dev turret');
      // Not left frozen at the gate, where a mob pulling it would pull its owner into combat.
      expect(pets(), cls).toEqual([]);
      expect(turretSeat(sim).petParked, cls).toBe(true);
      // A save taken on the roof still carries a hunter's beast (a demon is never saved).
      expect(sim.serializeCharacter(player.id)?.pet?.templateId ?? null, cls).toBe(
        cls === 'hunter' ? template : null,
      );
      for (let i = 0; i < 20; i++) sim.tick();
      expect(pets(), cls).toEqual([]);
      sim.leaveVehicle();
      const [back] = pets();
      expect(back?.templateId, cls).toBe(template);
      expect(Math.hypot(back.pos.x - player.pos.x, back.pos.z - player.pos.z), cls).toBeLessThan(6);
      expect(sim.ctx.delvePetStash.has(meta.entityId), cls).toBe(false);
    }
  });

  it('keeps the pet parked across a Replay, and seats a pet-less owner with nothing parked', () => {
    const { sim, player } = rig('warlock');
    summonPet(sim.ctx, player, 'emberkin');
    sim.chat('/dev turret');
    const pets = () => [...sim.entities.values()].filter((e) => e.ownerId === player.id);
    turretSeat(sim).defense.phase = 'lost';
    expect(sim.useVehicleAction('turret_replay', { x: 0, z: 0 })).toBe(true);
    expect(turretSeat(sim).petParked).toBe(true);
    expect(pets()).toEqual([]);
    sim.leaveVehicle();
    expect(pets().map((p) => p.templateId)).toEqual(['emberkin']);
    const lone = rig('warrior');
    lone.sim.chat('/dev turret');
    expect(turretSeat(lone.sim).petParked).toBeUndefined();
  });

  it('lends no mount: a rider is set on foot for the whole seat, a walker stays on foot', () => {
    const walker = rig();
    seat(walker.sim);
    expect(turretSeat(walker.sim)).not.toHaveProperty('lentMountKey');
    for (let i = 0; i < 40; i++) walker.sim.tick();
    expect(walker.player.mountKey).toBe('');
    walker.sim.leaveVehicle();
    expect(walker.player.mountKey).toBe('');

    const { sim, player } = rig();
    ownHorse(sim);
    seat(sim);
    expect(turretSeat(sim).priorMountKey).toBe(DEFAULT_MOUNT);
    for (let i = 0; i < MOUNT_OWNERSHIP_REVALIDATE_TICKS + 20; i++) sim.tick();
    expect(player.mountKey).toBe('');
    expect(sim.turretSession).not.toBeNull();
  });

  it('restores the horse with the same derived speed as a normally mounted rider', () => {
    const control = rig();
    ownHorse(control.sim);
    const { sim, player } = rig();
    ownHorse(sim);
    seat(sim);
    expect(moveSpeedMult(player)).not.toBe(moveSpeedMult(control.player));
    sim.leaveVehicle();
    const derived = (e: Entity) => ({
      mount: e.mountKey,
      speed: moveSpeedMult(e),
      moveSpeed: e.moveSpeed,
      maxHp: e.maxHp,
      stats: e.stats,
    });
    expect(derived(player)).toEqual(derived(control.player));
    expect(moveSpeedMult(player)).toBeGreaterThan(1);
  });

  it('restores nothing when the prior reins left the bags during the seat', () => {
    const { sim, player } = rig();
    ownHorse(sim);
    seat(sim);
    sim.removeItem(mountItemId(DEFAULT_MOUNT)!, 1);
    for (let i = 0; i < 20; i++) sim.tick();
    sim.leaveVehicle();
    expect(player.mountKey).toBe('');
  });

  it('bumps the owner wire revision when seating', () => {
    const { sim, meta } = rig();
    const before = meta.wireRev;
    sim.chat('/dev turret');
    expect(meta.vehicle?.kind).toBe('turret');
    expect(meta.wireRev).toBeGreaterThan(before);
  });

  it('seeds each seat from one world rng draw, and a refused seat draws nothing', () => {
    const { sim } = rig();
    const first = worldDraws(sim, () => seat(sim));
    expect(first).toHaveLength(1);
    const seed = turretSeat(sim).defense.seed;
    expect(seed).toBe(turretSessionSeed(first[0]));
    expect(
      worldDraws(sim, () => {
        expect(seatTurret(sim.ctx, sim.playerId)).toBe('seated');
      }),
    ).toEqual([]);
    sim.leaveVehicle();
    for (let i = 0; i < 3; i++) sim.tick();
    const second = worldDraws(sim, () => seat(sim));
    expect(second).toHaveLength(1);
    expect(turretSeat(sim).defense.seed).toBe(turretSessionSeed(second[0]));
    expect(turretSeat(sim).defense.seed).not.toBe(seed);

    const full = rig();
    for (const inst of full.sim.ctx.instances) {
      if (inst.dungeonId === FIRE_AND_FLY_DUNGEON_ID) inst.partyKey = `taken:${inst.slot}`;
    }
    expect(
      worldDraws(full.sim, () => {
        expect(seatTurret(full.sim.ctx, full.player.id)).toBe('full');
      }),
    ).toEqual([]);
    expect(full.meta.vehicle ?? null).toBeNull();
  });

  it('derives no seed from what a client sees: the same pid at the same tick seeds apart only when the world rng differs', () => {
    const seatIn = (skew: number) => {
      const { sim, player } = rig();
      for (let i = 0; i < skew; i++) sim.rng.next();
      seat(sim);
      return { pid: player.id, tick: sim.tickCount, seed: turretSeat(sim).defense.seed };
    };
    const first = seatIn(0);
    const skewed = seatIn(1);
    expect(seatIn(0)).toEqual(first);
    expect({ pid: skewed.pid, tick: skewed.tick }).toEqual({ pid: first.pid, tick: first.tick });
    expect(skewed.seed).not.toBe(first.seed);
  });

  it('never saves the seat or its return point', () => {
    const { sim, player } = rig();
    seat(sim);
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    const save = sim.serializeCharacter(player.id);
    expect(save).not.toHaveProperty('vehicle');
    const json = JSON.stringify(save);
    expect(json).not.toContain('"turret');
    expect(json).not.toContain('returnTo');
    expect(turretSeat(sim).kind).toBe('turret');
  });

  it('refuses outside the open world: an instanced band, or a delve run', () => {
    const { sim, player, meta } = rig();
    player.pos.x = 1e6;
    sim.chat('/dev turret');
    expect(meta.vehicle ?? null).toBeNull();
    const open = rig();
    const delve = { id: 'stub' } as unknown as ReturnType<Sim['ctx']['delveRunForPlayer']>;
    open.sim.ctx.delveRunForPlayer = () => delve;
    open.sim.chat('/dev turret');
    expect(open.meta.vehicle ?? null).toBeNull();
    expect(arenaClaims(open.sim)).toEqual([]);
    open.sim.ctx.delveRunForPlayer = () => null;
    open.sim.chat('/dev turret');
    expect(open.meta.vehicle?.kind).toBe('turret');
  });
});

describe('the arena', () => {
  it('claims a solo slot and sets the player on the roof, the tower center under their feet', () => {
    const { sim, player } = rig();
    sim.drainEvents();
    sim.chat('/dev turret');
    const logs = logTexts(sim.drainEvents());
    const claims = arenaClaims(sim);
    expect(claims).toHaveLength(1);
    expect(claims[0].partyKey).toBe(`solo:${player.id}`);
    expect(claims[0].exitId).toBeNull();
    expect(claims[0].mobIds).toEqual([]);
    const center = instanceOrigin(ARENA_INDEX, claims[0].slot);
    expect(dungeonAt(player.pos.x)?.id).toBe(FIRE_AND_FLY_DUNGEON_ID);
    expect(player.pos).toEqual({
      x: center.x,
      y: groundHeight(center.x, center.z, WORLD_SEED) + FIRE_AND_FLY_TOWER.roofY,
      z: center.z,
    });
    const session = turretSeat(sim);
    expect(session.origin).toEqual(player.pos);
    expect([session.defense.cx, session.defense.cz]).toEqual([center.x, center.z]);
    expect(logs).toContain(DUNGEONS[FIRE_AND_FLY_DUNGEON_ID].enterText);
  });

  it('keeps the seated player standing on the roof, the collider top under the feet', () => {
    const { sim, player } = rig();
    seat(sim);
    const roof = { ...player.pos };
    expect(supportHeightAt(WORLD_SEED, roof.x, roof.z, 0.5, roof.y)).toBeCloseTo(roof.y, 9);
    expect(supportHeightAt(WORLD_SEED, roof.x, roof.z, 0.5, roof.y - 0.5)).toBe(
      Number.NEGATIVE_INFINITY,
    );
    for (let i = 0; i < 20 * 20; i++) {
      sim.tick();
      aimOnce(sim);
    }
    expect(sim.turretSession).not.toBeNull();
    expect(player.pos).toEqual(roof);
  });

  it('leaves back exactly where the player stood and frees the slot', () => {
    const { sim, player } = rig();
    const before = standAtAmberfall(sim);
    player.facing = 1.25;
    seat(sim);
    for (let i = 0; i < TURRET_TIMING.introTicks + 60; i++) sim.tick();
    sim.drainEvents();
    sim.leaveVehicle();
    expect(player.pos).toEqual(before);
    expect(player.prevPos).toEqual(before);
    expect(player.facing).toBe(1.25);
    expect(arenaClaims(sim)).toEqual([]);
    expect(logTexts(sim.drainEvents())).toContain(DUNGEONS[FIRE_AND_FLY_DUNGEON_ID].leaveText);
  });

  it('still takes the player home when the slot was freed under them', () => {
    const { sim, player } = rig();
    const before = standAtAmberfall(sim);
    seat(sim);
    freeInstance(sim.ctx, arenaClaims(sim)[0]);
    sim.leaveVehicle();
    expect(player.pos).toEqual(before);
    expect(arenaClaims(sim)).toEqual([]);
  });

  it('reuses a clean slot on a second entry', () => {
    const { sim, player } = rig();
    seat(sim);
    const first = arenaClaims(sim)[0];
    for (let i = 0; i < TURRET_TIMING.introTicks + 60; i++) {
      sim.tick();
      aimOnce(sim);
    }
    sim.leaveVehicle();
    for (let i = 0; i < 5; i++) sim.tick();
    seat(sim);
    const again = arenaClaims(sim);
    expect(again).toEqual([first]);
    expect(again[0]).toMatchObject({
      slot: 0,
      partyKey: `solo:${player.id}`,
      enteredBy: new Set([player.id]),
      mobIds: [],
      exitId: null,
    });
    expect(again[0].claimedAt).toBe(sim.ctx.time);
    expect(turretSeat(sim).defense.monsters).toEqual([]);
    expect(turretSeat(sim).defense.stats.shots).toBe(0);
  });

  it('releases a stale claim of the same key before claiming, so entry always starts clean', () => {
    const { sim, player } = rig();
    const stale = sim.ctx.instances.find(
      (inst) => inst.dungeonId === FIRE_AND_FLY_DUNGEON_ID && inst.slot === 3,
    )!;
    markInstanceClaimed(sim.ctx, stale, `solo:${player.id}`, 'normal');
    seat(sim);
    expect(stale.partyKey).toBeNull();
    expect(arenaClaims(sim).map((inst) => inst.slot)).toEqual([0]);
  });

  it('claims under the solo key even in a party, and the durable key for a server character', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
    const b = sim.addPlayer('mage', 'Partner');
    sim.partyInvite(b, sim.playerId);
    sim.partyAccept(b);
    expect(sim.ctx.partyOf(sim.playerId)).not.toBeNull();
    seat(sim);
    expect(arenaClaims(sim).map((inst) => inst.partyKey)).toEqual([`solo:${sim.playerId}`]);

    const server = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    const pid = server.addPlayer('warrior', 'Durable', { characterId: 7 });
    expect(claimTurretArena(server.ctx, pid)?.partyKey).toBe('solo:char:7');
  });

  it('refuses when every arena is taken, without moving the player', () => {
    const { sim, player, meta } = rig();
    for (const inst of sim.ctx.instances) {
      if (inst.dungeonId === FIRE_AND_FLY_DUNGEON_ID) inst.partyKey = `taken:${inst.slot}`;
    }
    const before = { ...player.pos };
    sim.chat('/dev turret');
    expect(meta.vehicle ?? null).toBeNull();
    expect(player.pos).toEqual(before);
  });

  it('checks the trial before claiming: a plan that cannot resolve leaves the player untouched', () => {
    const { sim, player, meta } = rig();
    const before = { ...player.pos };
    const broken = { ...TURRET_DEFAULT_SCENARIO, waves: [] };
    expect(() => seatTurret(sim.ctx, player.id, broken)).toThrow(/bad wave count/);
    expect(meta.vehicle ?? null).toBeNull();
    expect(player.pos).toEqual(before);
    expect(arenaClaims(sim)).toEqual([]);
  });

  it('drops an arena queue on entry, so no match pops for a player inside an instance', () => {
    // Read before any tick: the 1v1 matchmaker's own in-instance prune would hide a missed leave.
    const queuedAfter = (seated: boolean): boolean => {
      const { sim, player } = rig();
      sim.setPlayerLevel(20);
      sim.arenaQueueJoin(player.id);
      expect(isArenaQueued(sim.ctx, player.id)).toBe(true);
      if (seated) seat(sim);
      else sim.tick();
      return isArenaQueued(sim.ctx, player.id);
    };
    expect(queuedAfter(false)).toBe(true);
    expect(queuedAfter(true)).toBe(false);
  });

  it('resets what a teleport resets: one entry count, a gather cast, the target and swing', () => {
    const { sim, player } = rig();
    const node = GATHER_NODES[0];
    // No tick at the node before seating: a mob there pulls within one.
    sim.chat(`/dev tp ${node.pos.x} ${node.pos.z}`);
    sim.addItem('copper_mining_pick', 1);
    expect(sim.harvestNode(node.id)).toBe(true);
    expect(player.castingAbility).toBe(GATHER_CAST_ID);
    const entries = player.dungeonEntrySeq ?? 0;
    seat(sim);
    expect(player.dungeonEntrySeq).toBe(entries + 1);
    expect(player.castingAbility).toBeNull();
    player.targetId = player.id;
    player.autoAttack = true;
    player.queuedCastAbility = 'heroic_strike';
    sim.leaveVehicle();
    expect(player.targetId).toBeNull();
    expect(player.autoAttack).toBe(false);
    expect(player.queuedCastAbility).toBeNull();
    expect(player.dungeonEntrySeq).toBe(entries + 1);
  });

  it('rejoins a save taken inside the arena at the Eastbrook arrival point', () => {
    const center = instanceOrigin(ARENA_INDEX, 5);
    expect(resolveSavedPosExit({ x: center.x, z: center.z })).toEqual({
      pos: PLAYER_START,
      instanceExit: true,
    });
  });
});

describe('ending the seat', () => {
  const cases: {
    name: string;
    mount: string;
    dies?: boolean;
    /** False: the player holds the reins but seats on foot. */
    rides?: boolean;
    end: (sim: Sim) => void;
  }[] = [
    { name: 'leave', mount: DEFAULT_MOUNT, end: (sim) => sim.leaveVehicle() },
    {
      name: 'death',
      mount: '',
      dies: true,
      end: (sim) => {
        sim.player.dead = true;
        sim.tick();
      },
    },
    {
      name: 'a real death through the damage path',
      mount: '',
      dies: true,
      end: (sim) => {
        const p = sim.player;
        sim.ctx.dealDamage(null, p, p.maxHp * 10, false, 'physical', null, 'hit', true);
        expect(p.dead).toBe(true);
        sim.tick();
      },
    },
    {
      name: 'a spirit released before the seat saw the death',
      mount: '',
      dies: true,
      end: (sim) => {
        const p = sim.player;
        sim.ctx.dealDamage(null, p, p.maxHp * 10, false, 'physical', null, 'hit', true);
        sim.releaseSpirit();
        expect(p.ghost).toBe(true);
        sim.tick();
      },
    },
    {
      name: 'displacement from the roof',
      mount: DEFAULT_MOUNT,
      end: (sim) => {
        sim.player.pos.x += 1;
        sim.tick();
      },
    },
    {
      name: 'logout',
      mount: DEFAULT_MOUNT,
      end: (sim) => {
        sim.meta(sim.playerId)!.leaving = true;
        sim.tick();
      },
    },
    {
      name: 'world combat, not remounted while fighting',
      mount: '',
      end: (sim) => {
        sim.player.inCombat = true;
        sim.tick();
      },
    },
    {
      name: 'a mount another path put a walker on, left alone',
      mount: DEFAULT_MOUNT,
      rides: false,
      end: (sim) => {
        sim.player.mountKey = DEFAULT_MOUNT;
        sim.tick();
      },
    },
    { name: 'removal', mount: '', end: (sim) => sim.removePlayer(sim.playerId) },
  ];

  it.each(cases)(
    'ends on $name: back where the player stood, alive, slot freed',
    ({ end, mount, dies, rides = true }) => {
      const { sim, player, meta } = rig();
      sim.setPlayerLevel(20);
      standAtAmberfall(sim);
      if (rides) ownHorse(sim);
      else ownReins(sim);
      player.facing = -0.5;
      const before = { ...player.pos };
      seat(sim);
      expect(turretSeat(sim).priorMountKey).toBe(rides ? DEFAULT_MOUNT : '');
      for (let i = 0; i < TURRET_TIMING.introTicks + 40; i++) sim.tick();
      expect(turretSeat(sim).defense.monsters.length).toBeGreaterThan(0);
      end(sim);
      expect(meta.vehicle).toBeNull();
      expect(sim.turretSession).toBeNull();
      expect(arenaClaims(sim)).toEqual([]);
      if (sim.entities.has(sim.playerId)) {
        expect(player.pos).toEqual(before);
        expect(player.facing).toBe(-0.5);
        expect(player.dead || player.ghost).toBe(false);
        if (dies) {
          expect(player.hp).toBe(Math.max(1, Math.round(player.maxHp * RES_HP_FRACTION)));
          expect(player.auras.map((a) => a.id)).not.toContain(RESURRECTION_SICKNESS_ID);
        }
        expect(player.mountKey).toBe(mount);
        const after: SimEvent[] = [];
        for (let i = 0; i < 40; i++) after.push(...sim.tick());
        expect(turretEvents(after)).toEqual([]);
      }
    },
  );

  it('ends when a real mob pulls the seated player into combat, alive and back where they stood', () => {
    const { sim, player } = rig();
    standAtAmberfall(sim);
    ownHorse(sim);
    const before = { ...player.pos };
    seat(sim);
    sim.chat('/dev spawn thornpeak_ogre 1 20');
    const ogre = [...sim.entities.values()].find(
      (e) =>
        e.kind === 'mob' && e.templateId === 'thornpeak_ogre' && e.devSpawnOwnerId === player.id,
    );
    expect(ogre).toBeDefined();
    let combatTick = -1;
    for (let i = 0; i < 20 * 10 && sim.turretSession; i++) {
      sim.tick();
      if (player.inCombat && combatTick < 0) combatTick = sim.tickCount;
      if (combatTick >= 0 && sim.tickCount > combatTick + 2) break;
    }
    expect(combatTick).toBeGreaterThan(0);
    expect(sim.turretSession).toBeNull();
    expect(player.dead).toBe(false);
    expect(player.hp).toBeGreaterThan(0);
    expect(player.pos).toEqual(before);
    expect(player.mountKey).toBe('');
  });

  it('leaves a player some other path took out of the arena where it put them, on foot', () => {
    const { sim, player } = rig();
    ownHorse(sim);
    seat(sim);
    sim.chat('/dev tp -340 1945');
    const moved = { ...player.pos };
    sim.tick();
    expect(sim.turretSession).toBeNull();
    expect(player.pos).toEqual(moved);
    expect(player.mountKey).toBe('');
    expect(arenaClaims(sim)).toEqual([]);
  });

  it('sends a battleground pop home after the match, never remounted on the field', () => {
    const { sim, player } = rig();
    standAtAmberfall(sim);
    ownHorse(sim);
    const before = { ...player.pos };
    seat(sim);
    const foe = sim.addPlayer('mage', 'Foe');
    startBgMatch(sim.ctx, [player.id], [foe]);
    const match = sim.bgMatchFor(player.id);
    if (!match) throw new Error('expected a battleground match');
    expect(match.returns.get(player.id)).toMatchObject({ x: before.x, z: before.z });
    sim.tick();
    expect(sim.turretSession).toBeNull();
    expect(arenaClaims(sim)).toEqual([]);
    expect(player.mountKey).toBe('');
    endBgMatch(sim.ctx, match, null, 'forfeit');
    expect([player.pos.x, player.pos.z]).toEqual([before.x, before.z]);
  });

  it('keeps a lost seat open until the player leaves', () => {
    const { sim, meta } = rig();
    seat(sim);
    turretSeat(sim).defense.integrity = 1;
    const run = playOut(sim, false);
    expect(run.phase).toBe('lost');
    for (let i = 0; i < 40; i++) sim.tick();
    expect(sim.turretSession?.defense.phase).toBe('lost');
    expect(meta.vehicle?.kind).toBe('turret');
    sim.leaveVehicle();
    expect(sim.turretSession).toBeNull();
  });
});

describe('the cannon and the turret', () => {
  it('cannot enter the cannon from the turret', () => {
    const { sim, meta, station } = cannonRig();
    sim.chat('/dev turret');
    expect(meta.vehicle?.kind).toBe('turret');
    expect(sim.enterVehicle(station.id)).toBe(false);
    expect(meta.vehicle?.kind).toBe('turret');
  });

  it('cannot seat the turret from the cannon, and the cannon refuses mount changes too', () => {
    const { sim, player, meta, station } = cannonRig();
    ownHorse(sim);
    expect(sim.enterVehicle(station.id)).toBe(true);
    expect(player.mountKey).toBe('');
    sim.chat('/dev turret');
    expect(meta.vehicle?.kind).toBe('cannon');
    expect(sim.turretSession).toBeNull();
    expect(arenaClaims(sim)).toEqual([]);
    sim.useItem(mountItemId(DEFAULT_MOUNT)!);
    sim.toggleMounted();
    for (let i = 0; i < 40; i++) sim.tick();
    expect(player.mountKey).toBe('');
    expect(player.mountCastRemaining ?? 0).toBe(0);
    expectMountPathsRefused(sim, player, meta);
    sim.leaveVehicle();
    // The control arm: off the seat the same reins summon.
    expect(summonMountItem(sim.ctx, player.id, DEFAULT_MOUNT)).toBe(true);
    expect(player.mountCastKey).toBe(DEFAULT_MOUNT);
  });
});

describe('the IWorld read', () => {
  it('keeps vehicleSession cannon-only and caches the turret view per revision', () => {
    const { sim } = rig();
    seat(sim);
    const world: IWorldVehicles = sim;
    expect(world.vehicleSession).toBeNull();
    const first = world.turretSession!;
    expect(first).not.toHaveProperty('defense.tick');
    expect(first).not.toHaveProperty('defense.seed');
    expect(first.defense.plan).toBe(turretSeat(sim).defense.plan);
    sim.tick();
    expect(turretSeat(sim).defense.rev).toBe(first.defense.rev);
    expect(world.turretSession).toBe(first);
    for (let i = 0; i < 20 * 10 && turretSeat(sim).defense.rev === first.defense.rev; i++) {
      sim.tick();
    }
    const second = world.turretSession!;
    expect(second).not.toBe(first);
    expect(second.defense.rev).toBeGreaterThan(first.defense.rev);
    expect(second.defense.plan).toBe(first.defense.plan);
    expect(world.turretSession).toBe(second);
  });

  it('rebuilds the view when only the feedback ring moves', () => {
    const { sim } = rig();
    seat(sim);
    const session = turretSeat(sim);
    const before = sim.turretSession!;
    session.nextFeedbackSeq = recordTurretFeedback(
      session.feedback,
      session.nextFeedbackSeq,
      sim.tickCount,
      [{ type: 'waveCleared', wave: 0 }],
    );
    expect(session.defense.rev).toBe(before.defense.rev);
    const after = sim.turretSession!;
    expect(after).not.toBe(before);
    expect(after.feedback.at(-1)?.seq).toBe(session.nextFeedbackSeq - 1);
  });

  it('shares one deep-frozen plan and drops the seed', () => {
    const { sim } = rig();
    seat(sim);
    const plan = sim.turretSession!.defense.plan;
    for (const part of [plan, plan.kinds, plan.kinds[0], plan.waves, plan.waves[0]]) {
      expect(Object.isFrozen(part)).toBe(true);
    }
    expect(Object.isFrozen(plan.waves[0].spawns)).toBe(true);
    expect(() => {
      (plan.waves[0].spawns as number[]).push(0);
    }).toThrow(TypeError);
    expect(() => {
      (plan.kinds[0] as { maxHp: number }).maxHp = 1;
    }).toThrow(TypeError);
    expect(Object.isFrozen(resolveTurretPlan())).toBe(true);
  });

  it('clones the live state, so the view never aliases the authority', () => {
    const { sim } = rig();
    seat(sim);
    for (let i = 0; i < TURRET_TIMING.introTicks + 5; i++) sim.tick();
    const center = turretSeat(sim).origin;
    expect(sim.useVehicleAction('turret_fire', { x: center.x + 12, z: center.z })).toBe(true);
    const view = sim.turretSession!;
    const live = turretSeat(sim).defense;
    const shown = live.monsters.map(
      ({ airSince: _air, throwX: _x, throwZ: _z, throwOpen: _open, knocked: _knocked, ...m }) => m,
    );
    expect(view.defense.monsters).toEqual(shown);
    expect(view.defense.monsters).not.toBe(live.monsters);
    expect(view.defense.monsters[0].seg).not.toBe(live.monsters[0].seg);
    expect(live.shots).toHaveLength(1);
    expect(view.defense.shots).toEqual(live.shots);
    expect(view.defense.shots).not.toBe(live.shots);
    expect(view.defense.shots[0]).not.toBe(live.shots[0]);
    expect(view.defense.stats).not.toBe(live.stats);
    expect(live.barrels.length).toBeGreaterThan(0);
    expect(view.defense.barrels).toEqual(live.barrels);
    expect(view.defense.barrels).not.toBe(live.barrels);
    expect(view.defense.barrels[0]).not.toBe(live.barrels[0]);
    expect(view.origin).not.toBe(turretSeat(sim).origin);
    expect(view.feedback).not.toBe(turretSeat(sim).feedback);
    expect(Object.isFrozen(view.feedback[0])).toBe(true);
    expect(Object.isFrozen(view.feedback[0].event)).toBe(true);
  });

  it('leaves the engine bookkeeping out of the view, and keeps each maxHp', () => {
    const { sim } = rig();
    seat(sim);
    for (let i = 0; i < TURRET_TIMING.introTicks + 5; i++) sim.tick();
    const view = sim.turretSession!;
    const live = turretSeat(sim).defense;
    expect(live.monsters.length).toBeGreaterThan(0);
    const cursors = ['spawnCursor', 'nextSpawnTick', 'nextShotId', 'nextMonsterId', 'nextBarrelId'];
    for (const key of ['tick', 'seed', ...cursors]) {
      expect(live).toHaveProperty(key);
      expect(view.defense).not.toHaveProperty(key);
    }
    for (const [i, m] of view.defense.monsters.entries()) {
      for (const key of ['airSince', 'throwX', 'throwZ', 'throwOpen', 'knocked']) {
        expect(live.monsters[i]).toHaveProperty(key);
        expect(m).not.toHaveProperty(key);
      }
      expect(m.maxHp).toBe(live.monsters[i].maxHp);
    }
  });

  it('exposes what the HUD needs: cooldown, phase and end, wave and count, monsters left, integrity, stats', () => {
    const { sim } = rig();
    seat(sim);
    const plan = resolveTurretPlan();
    const intro = sim.turretSession!;
    const live = () => turretSeat(sim).defense;
    expect(intro.waveCount).toBe(plan.waves.length);
    expect(intro.defense).toMatchObject({
      phase: 'intro',
      phaseEndTick: live().startTick + TURRET_TIMING.introTicks,
      wave: 0,
      readyTick: live().readyTick,
      integrity: plan.integrity,
      stats: live().stats,
    });
    expect(intro.monstersLeft).toBe(0);
    for (let i = 0; i < 20 * 10 && live().phase === 'intro'; i++) sim.tick();
    expect(sim.turretSession!.defense.phase).toBe('wave');
    expect(sim.turretSession!.monstersLeft).toBe(plan.waves[0].spawns.length);
    let kills = 0;
    let breaches = 0;
    for (let i = 0; i < 20 * 60 && live().phase === 'wave'; i++) {
      for (const e of turretEvents(sim.tick())) {
        if (e.event.type === 'killed') kills++;
        if (e.event.type === 'breach') breaches++;
      }
      const view = sim.turretSession!;
      if (view.defense.phase === 'wave') {
        expect(view.monstersLeft).toBe(plan.waves[0].spawns.length - kills - breaches);
      }
      aimOnce(sim);
      const after = sim.turretSession!;
      expect(after.defense.readyTick).toBe(live().readyTick);
    }
    expect(kills).toBeGreaterThan(0);
    expect(kills + breaches).toBe(plan.waves[0].spawns.length);
    expect(sim.turretSession!.defense.phase).toBe('between');
    expect(sim.turretSession!.monstersLeft).toBe(0);
    expect(sim.turretSession!.defense.stats.kills).toBe(kills);
  });

  it('reads the turret clock: null off the seat, the sim tick while seated', () => {
    const { sim } = rig();
    const world: IWorldVehicles = sim;
    expect(world.turretClock).toBeNull();
    seat(sim);
    expect(world.turretClock).toBe(sim.tickCount);
    for (let i = 0; i < 7; i++) sim.tick();
    expect(world.turretClock).toBe(sim.tickCount);
    expect(world.turretClock).toBe(turretSeat(sim).defense.tick);
    sim.leaveVehicle();
    expect(world.turretClock).toBeNull();
    const cannon = cannonRig();
    expect(cannon.sim.enterVehicle(cannon.station.id)).toBe(true);
    expect(cannon.sim.turretClock).toBeNull();
  });

  it('starts the online mirror empty; the wire round trip lives in turret_online_round_trip', () => {
    const client = new QuestWorldWireState();
    expect(client.turretSession).toBeNull();
    expect(client.turretClock).toBeNull();
    client.resetQuestWorldWireState();
    expect(client.turretSession).toBeNull();
    expect(client.turretClock).toBeNull();
  });
});

describe('the feedback ring', { timeout: FULL_RUN_TIMEOUT_MS }, () => {
  it('records every engine event of a won run in order, bounded, consumed once across waves', () => {
    const { sim } = rig();
    seat(sim);
    const world: IWorldVehicles = sim;
    const emitted: TurretEvent[] = [];
    const stamps: [number, number][] = [];
    const consumed: TurretFeedback[] = [];
    let cursor = 0;
    let longest = 0;
    for (let i = 0; i < RUN_BOUND && world.turretSession?.defense.phase !== 'won'; i++) {
      for (const e of turretEvents(sim.tick())) {
        emitted.push(e.event);
        stamps.push([e.seq, e.tick]);
      }
      const view = world.turretSession!;
      const fresh = turretFeedbackSince(view.feedback, cursor);
      longest = Math.max(longest, fresh.length);
      for (const f of fresh) {
        expect(f.seq).toBe(cursor + 1);
        cursor = f.seq;
        consumed.push(f);
      }
      expect(turretFeedbackSince(view.feedback, cursor)).toEqual([]);
      aimOnce(sim);
    }
    expect(world.turretSession?.defense.phase).toBe('won');
    for (const e of turretEvents(sim.drainEvents())) {
      emitted.push(e.event);
      stamps.push([e.seq, e.tick]);
    }
    const tail = turretFeedbackSince(world.turretSession!.feedback, cursor);
    consumed.push(...tail);
    expect(consumed.map((f) => f.seq)).toEqual(consumed.map((_, i) => i + 1));
    expect(consumed.map((f) => f.event)).toEqual(emitted);
    // Each event carries the ring entry it was recorded as: the online mirror's whole input.
    expect(stamps).toEqual(consumed.map((f) => [f.seq, f.tick]));
    for (let i = 0; i < emitted.length; i++) expect(consumed[i].event).toBe(emitted[i]);
    expect(emitted.filter((e) => e.type === 'waveCleared')).toHaveLength(6);
    expect(longest).toBeLessThanOrEqual(TURRET_FEEDBACK_LIMIT);
    expect(world.turretSession!.feedback).toHaveLength(TURRET_FEEDBACK_LIMIT);
    expect(world.turretSession!.feedback.at(-1)?.seq).toBe(emitted.length);
  });
});

describe('the world probe', () => {
  const probe = turretWorldProbe(WORLD_SEED);
  const around: Collider[] = [];
  queryOpenWorldColliders(
    WORLD_SEED,
    AMBERFALL.x - 60,
    AMBERFALL.z - 60,
    AMBERFALL.x + 60,
    AMBERFALL.z + 60,
    around,
  );
  const reach = (c: Collider) => (c.type === 'circle' ? c.r : Math.hypot(c.hw, c.hd));
  /** The collider nearest Amberfall matching `pick`, with no other collider near its sweep corridor. */
  const isolated = (pick: (c: CircleCollider) => boolean): CircleCollider => {
    const found = around
      .filter((c): c is CircleCollider => c.type === 'circle' && pick(c))
      .filter((c) =>
        around.every((o) => o === c || Math.hypot(o.x - c.x, o.z - c.z) > 6 + reach(o)),
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - AMBERFALL.x, a.z - AMBERFALL.z) -
          Math.hypot(b.x - AMBERFALL.x, b.z - AMBERFALL.z),
      )[0];
    expect(found).toBeDefined();
    return found;
  };
  const sweepAcross = (c: CircleCollider, feet: number) =>
    probe.sweep!(c.x - 4, c.z, c.x + 4, c.z, 0.5, feet, feet);

  it('reads the ground mobs stand on and the water surface', () => {
    for (const [x, z] of [
      [-338.37, 1947.21],
      [-351.9, 1960.4],
      [-329.6, 1931.8],
    ]) {
      expect(probe.ground(x, z)).toBe(groundHeight(x, z, WORLD_SEED));
      expect(Math.abs(probe.ground(x, z))).toBeGreaterThan(0.1);
    }
    expect(probe.water(AMBERFALL.x, AMBERFALL.z)).toBeNull();
    const lake = probe.water(LAKE.x, LAKE.z);
    expect(lake).toBe(waterLevelAt(LAKE.x, LAKE.z, WORLD_SEED));
    expect(Number.isFinite(lake)).toBe(true);
    expect(lake!).toBeGreaterThan(probe.ground(LAKE.x, LAKE.z));
  });

  it('blocks a sweep through a tree trunk at any height, stopping short of it', () => {
    const tree = isolated((c) => c.moveTopY === undefined);
    const g = probe.ground(tree.x, tree.z);
    for (const feet of [g, g + 40]) {
      const hit = sweepAcross(tree, feet);
      expect(hit.blocked).toBe(true);
      expect(hit.x).toBeLessThan(tree.x);
      expect(Math.hypot(hit.x - tree.x, hit.z - tree.z)).toBeGreaterThanOrEqual(
        tree.r + 0.5 - 1e-6,
      );
    }
  });

  it('blocks a low rock at the ground and passes a body flying over its top', () => {
    const rock = isolated((c) => c.moveTopY !== undefined);
    const g = probe.ground(rock.x, rock.z);
    expect(sweepAcross(rock, g).blocked).toBe(true);
    const over = sweepAcross(rock, rock.moveTopY! + 0.3);
    expect(over.blocked).toBe(false);
    expect(over.x).toBeCloseTo(rock.x + 4, 6);
  });

  it('leaves a free sweep unblocked', () => {
    const rock = isolated((c) => c.moveTopY !== undefined);
    const clear = probe.sweep!(rock.x - 4, rock.z + 6, rock.x + 4, rock.z + 6, 0.5, 0, 0);
    expect(clear).toEqual({ x: rock.x + 4, z: rock.z + 6, blocked: false });
  });

  it('lets a body high over a fence clear it, and walls one at rail height', () => {
    const fence = getActiveWorldContent().props.fences.find(
      (f) => f.kind === undefined && f.width === undefined && f.height === undefined,
    )!;
    const mx = (fence.x1 + fence.x2) / 2;
    const mz = (fence.z1 + fence.z2) / 2;
    const len = Math.hypot(fence.x2 - fence.x1, fence.z2 - fence.z1);
    const nx = -(fence.z2 - fence.z1) / len;
    const nz = (fence.x2 - fence.x1) / len;
    const from = { x: mx - nx * 1.5, z: mz - nz * 1.5 };
    const to = { x: mx + nx * 1.5, z: mz + nz * 1.5 };
    const g = Math.max(probe.ground(from.x, from.z), probe.ground(to.x, to.z));
    const cross = (feet: number) => probe.sweep!(from.x, from.z, to.x, to.z, 0.5, feet, feet);
    expect(cross(g).blocked).toBe(true);
    expect(cross(g + 1.5).blocked).toBe(true);
    expect(cross(g + 2.5)).toEqual({ x: to.x, z: to.z, blocked: false });
  });

  it('binds the arena: its field ground, the tower up to its roof, the rocks and the trunks', () => {
    const center = instanceOrigin(ARENA_INDEX, 2);
    expect(probe.ground(center.x + 30, center.z - 12)).toBe(
      groundHeight(center.x + 30, center.z - 12, WORLD_SEED),
    );
    expect(probe.water(center.x + 30, center.z - 12)).toBeNull();
    const reach = FIRE_AND_FLY_TOWER.radius + 0.5;
    const across = (feet: number) =>
      probe.sweep!(center.x - 6, center.z, center.x + 6, center.z, 0.5, feet, feet);
    const low = across(1);
    expect(low.blocked).toBe(true);
    expect(low.x).toBeLessThanOrEqual(center.x - reach + 1e-6);
    expect(across(FIRE_AND_FLY_TOWER.roofY + 0.2)).toEqual({
      x: center.x + 6,
      z: center.z,
      blocked: false,
    });
    const tree = FIRE_AND_FLY_TREES[0];
    const tx = center.x + tree.x;
    const tz = center.z + tree.z;
    for (const feet of [probe.ground(tx, tz), probe.ground(tx, tz) + 40]) {
      const hit = probe.sweep!(tx - 4, tz, tx + 4, tz, 0.5, feet, feet);
      expect(hit.blocked).toBe(true);
      expect(Math.hypot(hit.x - tx, hit.z - tz)).toBeGreaterThanOrEqual(
        fireAndFlyTrunkRadius(tree) + 0.5 - 1e-6,
      );
    }
    // A body thrown out past the spawn ring meets a rock low and clears it high.
    for (const rock of FIRE_AND_FLY_ROCKS) {
      const d = Math.hypot(rock.x, rock.z);
      const at = (r: number) => ({
        x: center.x + (rock.x / d) * r,
        z: center.z + (rock.z / d) * r,
      });
      const from = at(d - 6);
      const to = at(d + 2);
      const g = probe.ground(center.x + rock.x, center.z + rock.z);
      const outward = (feet: number) => probe.sweep!(from.x, from.z, to.x, to.z, 0.5, feet, feet);
      const low = outward(g);
      expect(low.blocked).toBe(true);
      expect(Math.hypot(low.x - from.x, low.z - from.z)).toBeCloseTo(6 - rock.radius - 0.5, 6);
      expect(outward(g + rock.height + 0.3)).toEqual({ x: to.x, z: to.z, blocked: false });
    }
  });
});

describe('firing', () => {
  it('fires through useVehicleAction, turns the tank toward its shot and emits owner-scoped events', () => {
    const { sim, player } = rig();
    seat(sim);
    const center = turretSeat(sim).origin;
    const aim = { x: center.x - 20, z: center.z + 20 };
    const world: IWorldVehicles = sim;
    world.useVehicleAction('turret_fire', aim);
    expect(player.facing).toBeCloseTo(Math.atan2(-20, 20), 6);
    expect(turretSeat(sim).defense.stats.shots).toBe(1);
    world.useVehicleAction('turret_fire', { x: center.x + 20, z: center.z });
    expect(turretSeat(sim).defense.stats.shots).toBe(1);
    expect(player.facing).toBeCloseTo(Math.atan2(-20, 20), 6);
    const events: SimEvent[] = [];
    for (let i = 0; i < 30; i++) events.push(...sim.tick());
    const own = turretEvents(events);
    expect(own.some((e) => e.event.type === 'impact')).toBe(true);
    expect(own.every((e) => e.pid === player.id)).toBe(true);
  });

  it('refuses a cannon action while the turret is ready, then fires the turret at that tick', () => {
    const { sim } = rig();
    seat(sim);
    const defense = turretSeat(sim).defense;
    expect(sim.tickCount).toBeGreaterThanOrEqual(defense.readyTick);
    const aim = { x: defense.cx + 15, z: defense.cz };
    expect(sim.useVehicleAction('cannonball', aim)).toBe(false);
    expect(defense.stats.shots).toBe(0);
    expect(sim.useVehicleAction('turret_fire', aim)).toBe(true);
    expect(defense.stats.shots).toBe(1);
  });

  // Defense in depth: fireCannon refuses a non-cannon id too, so this pins the
  // pair, not the vehicles.ts arm alone.
  it('refuses the turret action in a ready cannon, which then fires a cannonball', () => {
    const { sim, meta, station } = cannonRig();
    expect(sim.enterVehicle(station.id)).toBe(true);
    cannonSeat(sim).encounter.phase = 'wave';
    const point = { x: station.x, z: station.field.minZ + 10 };
    expect(sim.useVehicleAction('turret_fire', point)).toBe(false);
    expect(cannonSeat(sim).encounter.shotsFired).toBe(0);
    expect(sim.useVehicleAction('cannonball', point)).toBe(true);
    expect(cannonSeat(sim).encounter.shotsFired).toBe(1);
    expect(meta.vehicle?.kind).toBe('cannon');
  });
});

describe('the limited weapons', () => {
  /** Seats the player and plays the intro out: the weapons fire only during a wave. */
  function seatInWave(sim: Sim): void {
    seat(sim);
    for (let i = 0; i <= TURRET_TIMING.introTicks; i++) sim.tick();
    expect(turretSeat(sim).defense.phase).toBe('wave');
  }

  it('fires a frag shell through useVehicleAction, turned toward it, spending a charge', () => {
    const { sim, player } = rig();
    seatInWave(sim);
    const defense = turretSeat(sim).defense;
    expect(turretChargesLeft(defense)).toEqual({ shockwave: 2, fragmentation: 3 });
    const aim = { x: defense.cx + 18, z: defense.cz - 18 };
    const drawn = worldDraws(sim, () => {
      expect(sim.useVehicleAction('turret_frag', aim)).toBe(true);
    });
    expect(drawn).toEqual([]);
    expect(player.facing).toBeCloseTo(Math.atan2(18, -18), 6);
    expect(defense.stats).toMatchObject({ shots: 1, frags: 1 });
    expect(turretChargesLeft(defense).fragmentation).toBe(2);
    expect(sim.useVehicleAction('turret_frag', aim)).toBe(false);
    const events: SimEvent[] = [];
    for (let i = 0; i < 40; i++) events.push(...sim.tick());
    const own = turretEvents(events);
    expect(own.every((e) => e.pid === player.id)).toBe(true);
    const kinds = own.map((e) => e.event.type);
    expect(kinds).toContain('fragBurst');
    expect(kinds.filter((k) => k === 'bomblet')).toHaveLength(6);
    expect(kinds).not.toContain('impact');
  });

  it('slams the Shockwave at the tower whatever the point, rearms, then runs dry', () => {
    const { sim, player } = rig();
    seatInWave(sim);
    const defense = turretSeat(sim).defense;
    const facing = player.facing;
    const seq = turretSeat(sim).nextFeedbackSeq;
    expect(sim.useVehicleAction('turret_shockwave', { x: 1e6, z: -1e6 })).toBe(true);
    expect(player.facing).toBe(facing);
    expect(turretSeat(sim).feedback.at(-1)).toMatchObject({
      seq,
      event: { type: 'shockwave', x: defense.cx, z: defense.cz, startTick: sim.tickCount },
    });
    expect(sim.useVehicleAction('turret_shockwave', { x: 0, z: 0 })).toBe(false);
    for (let i = 0; i < TURRET_SHOCKWAVE.rearmTicks; i++) sim.tick();
    expect(sim.useVehicleAction('turret_shockwave', { x: 0, z: 0 })).toBe(true);
    for (let i = 0; i < TURRET_SHOCKWAVE.rearmTicks; i++) sim.tick();
    expect(sim.useVehicleAction('turret_shockwave', { x: 0, z: 0 })).toBe(false);
    expect(defense.stats).toMatchObject({ shockwaves: 2, shots: 0 });
    expect(turretChargesLeft(defense)).toEqual({ shockwave: 0, fragmentation: 3 });
  });

  it('refuses both weapons in the intro, spending nothing and recording no entry', () => {
    const { sim } = rig();
    seat(sim);
    const session = turretSeat(sim);
    const defense = session.defense;
    expect(defense.phase).toBe('intro');
    const seq = session.nextFeedbackSeq;
    const aim = { x: defense.cx + 18, z: defense.cz - 18 };
    expect(sim.useVehicleAction('turret_shockwave', aim)).toBe(false);
    expect(sim.useVehicleAction('turret_frag', aim)).toBe(false);
    expect(defense.stats).toMatchObject({ shockwaves: 0, frags: 0, shots: 0 });
    expect(turretChargesLeft(defense)).toEqual({ shockwave: 2, fragmentation: 3 });
    expect(session.nextFeedbackSeq).toBe(seq);
    expect(sim.useVehicleAction('turret_fire', aim)).toBe(true);
  });

  it('refuses off the seat, for another player, once the run has ended and in the cannon', () => {
    const { sim } = rig();
    expect(sim.useVehicleAction('turret_shockwave', { x: 0, z: 0 })).toBe(false);
    expect(sim.useVehicleAction('turret_frag', { x: 0, z: 0 })).toBe(false);
    seat(sim);
    const defense = turretSeat(sim).defense;
    const other = sim.addPlayer('mage', 'Onlooker');
    const aim = { x: defense.cx + 15, z: defense.cz };
    expect(sim.useVehicleAction('turret_shockwave', aim, other)).toBe(false);
    expect(sim.useVehicleAction('turret_frag', aim, other)).toBe(false);
    expect(defense.stats).toMatchObject({ shockwaves: 0, frags: 0, shots: 0 });
    defense.phase = 'lost';
    expect(sim.useVehicleAction('turret_shockwave', aim)).toBe(false);
    expect(sim.useVehicleAction('turret_frag', aim)).toBe(false);
    expect(defense.stats).toMatchObject({ shockwaves: 0, frags: 0, shots: 0 });
    sim.leaveVehicle();
    const { sim: cannon, station } = cannonRig();
    expect(cannon.enterVehicle(station.id)).toBe(true);
    cannonSeat(cannon).encounter.phase = 'wave';
    const point = { x: station.x, z: station.field.minZ + 10 };
    expect(cannon.useVehicleAction('turret_shockwave', point)).toBe(false);
    expect(cannon.useVehicleAction('turret_frag', point)).toBe(false);
    expect(cannonSeat(cannon).encounter.shotsFired).toBe(0);
  });

  it('shows the charges through the plan and stats and the rearm, never the ring or the bomblets', () => {
    const { sim } = rig();
    seatInWave(sim);
    const live = turretSeat(sim).defense;
    sim.useVehicleAction('turret_shockwave', { x: 0, z: 0 });
    sim.useVehicleAction('turret_frag', { x: live.cx + 3, z: live.cz + 4 });
    for (let i = 0; i < 5; i++) sim.tick();
    expect(live.shockwave).not.toBeNull();
    expect(live.frags).toHaveLength(1);
    const view = sim.turretSession!;
    expect(turretChargesLeft(view.defense)).toEqual({ shockwave: 1, fragmentation: 2 });
    expect(view.defense.shockReadyTick).toBe(live.shockReadyTick);
    expect(view.defense).not.toHaveProperty('shockwave');
    expect(view.defense).not.toHaveProperty('frags');
  });
});

describe('determinism', { timeout: FULL_RUN_TIMEOUT_MS }, () => {
  it('draws one world value at the seat and none after: a seated, firing run leaves the world rng where a control run does', () => {
    const draws = (seated: boolean): { count: number; next: number[] } => {
      const { sim } = rig();
      let count = 0;
      sim.rng.setObserver(() => {
        count++;
      });
      // The control stands in an arena slot too (the plain dungeon path), so both
      // runs take the player equally far from the world's mobs, and both leave it;
      // its own draw stands in for the seat's seed.
      if (seated) {
        sim.chat('/dev turret');
        expect(count).toBe(1);
      } else {
        expect(enterDungeon(sim.ctx, FIRE_AND_FLY_DUNGEON_ID, sim.playerId)).toBe(true);
        sim.rng.next();
      }
      for (let i = 0; i < 20 * 40; i++) {
        sim.tick();
        aimOnce(sim);
      }
      if (seated) expect(turretSeat(sim).defense.stats.hits).toBeGreaterThan(0);
      if (seated) sim.leaveVehicle();
      else expect(leaveDungeon(sim.ctx, sim.playerId)).toBe(true);
      expect(dungeonAt(sim.player.pos.x)).toBeNull();
      sim.rng.setObserver(null);
      return { count, next: [sim.rng.next(), sim.rng.next(), sim.rng.next()] };
    };
    expect(draws(true)).toEqual(draws(false));
  });

  it('replays a seated, firing run identically: state, ring and events', () => {
    const run = () => {
      const { sim } = rig();
      seat(sim);
      const events: string[] = [];
      for (let i = 0; i < 20 * 40; i++) {
        for (const e of turretEvents(sim.tick())) events.push(JSON.stringify(e));
        aimOnce(sim);
      }
      expect(turretSeat(sim).defense.stats.hits).toBeGreaterThan(0);
      return { session: JSON.stringify(turretSeat(sim)), events };
    };
    expect(run()).toEqual(run());
  });

  it('replays a run from its seed alone, in a world whose rng differs, drawing nothing', () => {
    const run = (skew: number, seed?: number) => {
      const { sim, player } = rig();
      for (let i = 0; i < skew; i++) sim.rng.next();
      const drawn = worldDraws(sim, () => {
        expect(seatTurret(sim.ctx, player.id, TURRET_DEFAULT_SCENARIO, seed)).toBeNull();
      });
      const events: string[] = [];
      for (let i = 0; i < 20 * 40; i++) {
        for (const e of turretEvents(sim.tick())) events.push(JSON.stringify(e));
        aimOnce(sim);
      }
      expect(turretSeat(sim).defense.stats.hits).toBeGreaterThan(0);
      return {
        drawn: drawn.length,
        seed: turretSeat(sim).defense.seed,
        session: JSON.stringify(turretSeat(sim)),
        events,
      };
    };
    const original = run(0);
    expect(original.drawn).toBe(1);
    const replay = run(3, original.seed);
    expect(replay).toEqual({ ...original, drawn: 0 });
    expect(run(3).session).not.toBe(original.session);
  });
});

describe('a headless run in the arena', { timeout: FULL_RUN_TIMEOUT_MS }, () => {
  it('a scripted aimer on the IWorld surface wins, bounded, stays seated after, then leaves home', () => {
    const { sim, player, meta } = rig();
    standAtAmberfall(sim);
    ownHorse(sim);
    const before = { ...player.pos };
    seat(sim);
    const run = playOut(sim, true);
    expect(run.phase).toBe('won');
    expect(run.ticks).toBeLessThan(RUN_BOUND);
    expect([...run.pids]).toEqual([player.id]);
    const waves = run.events.filter((e) => e.type === 'waveCleared').length;
    expect(waves).toBe(resolveTurretPlan().waves.length);
    expect(sim.turretSession?.defense.integrity).toBeGreaterThan(0);
    expect(sim.turretSession?.defense.plan.bowling).toEqual(TURRET_BOWLING);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(meta.vehicle?.kind).toBe('turret');
    expect(sim.turretSession?.defense.phase).toBe('won');
    expect(player.mountKey).toBe('');
    sim.leaveVehicle();
    expect(sim.turretSession).toBeNull();
    expect(player.pos).toEqual(before);
    expect(player.mountKey).toBe(DEFAULT_MOUNT);
    expect(arenaClaims(sim)).toEqual([]);
  });

  // playOut's nearest-first aimer rarely knocks a body over here (0 or 1 a run),
  // so the knock rate on the arena's real ground, tower, rocks and trunks is
  // pinned on a looser aimer that throws bodies into the crowd.
  it('a looser aimer throws bodies into others on the arena ground, run after run', () => {
    const probe = turretWorldProbe(WORLD_SEED);
    const center = instanceOrigin(ARENA_INDEX, 0);
    for (const seed of [42, 21, 99]) {
      const state = createTurretDefense(resolveTurretPlan(), center, seed, 0);
      let launches = 0;
      for (let t = 1; t <= RUN_BOUND && state.phase !== 'won' && state.phase !== 'lost'; t++) {
        for (const e of tickTurretDefense(state, t, probe)) if (e.type === 'launched') launches++;
        const target = t >= state.readyTick + 16 ? nearestLive(state, t) : null;
        if (!target) continue;
        const off = (k: number) => ((t * k) % 400) / 100 - 2;
        fireTurret(state, t, target.x + off(7919), target.z + off(104729), probe);
      }
      expect(state.phase).toBe('won');
      expect(state.stats.bowled).toBeGreaterThanOrEqual(10);
      expect(state.stats.bowled).toBeLessThanOrEqual(0.15 * launches);
    }
  });

  it('a run that never fires loses, bounded', () => {
    const { sim } = rig();
    seat(sim);
    const run = playOut(sim, false);
    expect(run.phase).toBe('lost');
    expect(run.ticks).toBeLessThan(RUN_BOUND);
    expect(sim.turretSession?.defense.integrity).toBe(0);
  });
});
