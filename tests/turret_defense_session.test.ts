import { describe, expect, it } from 'vitest';
import { QuestWorldWireState } from '../src/net/quest_world_wire_state';
import { type CircleCollider, type Collider, queryOpenWorldColliders } from '../src/sim/colliders';
import { DEFAULT_MOUNT } from '../src/sim/content/mounts';
import { TURRET_TANK_MOUNT, TURRET_TIMING } from '../src/sim/content/turret_defense';
import { NORTH_WATCH_CANNON } from '../src/sim/content/vehicle_stations';
import { getActiveWorldContent, ITEMS, MOBS, WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { positionAt } from '../src/sim/minigames/thrown_body';
import type { TurretEvent } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { turretSessionSeed } from '../src/sim/minigames/turret_defense_rng';
import {
  recordTurretFeedback,
  TURRET_FEEDBACK_LIMIT,
  type TurretFeedback,
  turretFeedbackSince,
} from '../src/sim/minigames/turret_feedback';
import {
  forceDismount,
  forceTrainingMount,
  MOUNT_OWNERSHIP_REVALIDATE_TICKS,
  mountItemId,
  mountOwned,
  summonMountItem,
  toggleMount,
} from '../src/sim/mounts';
import { summonPet } from '../src/sim/pet/pet_commands';
import { jumpMult, moveSpeedMult } from '../src/sim/player_motion';
import { isSalvageable } from '../src/sim/professions/salvage';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import { turretWorldProbe } from '../src/sim/turret_defense_session';
import type {
  Entity,
  PlayerClass,
  SimEvent,
  TurretSession,
  VehicleSession,
} from '../src/sim/types';
import { groundHeight, terrainHeight, waterLevelAt } from '../src/sim/world';
import { worldQuestCycleOfferingQuest } from '../src/sim/world_quest_rotation';
import { WORLD_SEED } from '../src/sim/world_seed';
import type { IWorldVehicles } from '../src/world_api/vehicles';

// The best open-world spot of the site survey: real terrain, trees, no aggressive mob near.
const AMBERFALL = { x: -340, z: 1945 };
// A lake south-east of Amberfall (water surface above the lakebed).
const LAKE = { x: -282, z: 2016 };
const RUN_BOUND = 20 * 60 * 8;
const ground = { ground: (x: number, z: number) => groundHeight(x, z, WORLD_SEED) };

function rig(playerClass: PlayerClass = 'warrior') {
  const sim = new Sim({ seed: WORLD_SEED, playerClass, devCommands: true });
  const player = sim.player;
  const meta = sim.meta(player.id)!;
  return { sim, player, meta };
}

function seat(sim: Sim, at = AMBERFALL): void {
  sim.chat(`/dev turret ${at.x} ${at.z}`);
  expect(sim.turretSession).not.toBeNull();
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

function turretEvents(events: readonly SimEvent[]) {
  return events.flatMap((e) => (e.type === 'turretDefense' ? [e] : []));
}

function nearestLive(world: IWorldVehicles, tick: number): { x: number; z: number } | null {
  const view = world.turretSession;
  if (!view) return null;
  let best: { x: number; z: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const m of view.defense.monsters) {
    if (m.hp <= 0) continue;
    const p = positionAt(m.seg, tick, ground);
    const d = Math.hypot(p.x - view.defense.cx, p.z - view.defense.cz);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** The scripted aimer: one shot at the monster nearest the tank whenever the cannon is ready. */
function aimOnce(sim: Sim): void {
  const world: IWorldVehicles = sim;
  const view = world.turretSession;
  if (!view || sim.tickCount < view.defense.readyTick) return;
  const target = nearestLive(world, sim.tickCount);
  if (target) world.useVehicleAction('turret_fire', target);
}

interface RunOutcome {
  phase: string;
  ticks: number;
  events: TurretEvent[];
  pids: Set<number | undefined>;
}

/** Drives a seat to its end through the IWorld surface only; `aim` fires at the monster nearest the tank. */
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

/** The player owns the horse and rides it, summoned the normal way. */
function ownHorse(sim: Sim): void {
  const meta = sim.meta(sim.playerId)!;
  meta.ridingTrained = true;
  sim.addItem(mountItemId(DEFAULT_MOUNT)!, 1);
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
  it('freezes movement and refuses casting, auto-attack, items, pets and mount changes', () => {
    const { sim, player, meta } = rig('warlock');
    ownHorse(sim);
    summonPet(sim.ctx, player, 'emberkin');
    const pet = [...sim.entities.values()].find((e) => e.ownerId === player.id)!;
    // Where the character starts: a clear line of sight to the dummy ahead.
    sim.chat('/dev turret');
    expect(player.mountKey).toBe(TURRET_TANK_MOUNT);
    const dummy = addDummy(sim, 0, 10);
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
    expect(player.mountKey).toBe(TURRET_TANK_MOUNT);
    expect(player.mountCastRemaining ?? 0).toBe(0);
    expectMountPathsRefused(sim, player, meta);

    sim.leaveVehicle();
    expect(player.mountKey).toBe(DEFAULT_MOUNT);
    expect(sim.turretSession).toBeNull();
    // Outside the seat the same calls act again: the refusals above were the seat's.
    sim.castAbility('shadow_bolt');
    expect(player.castingAbility).toBe('shadow_bolt');
    sim.startAutoAttack();
    expect(player.autoAttack).toBe(true);
    sim.petAttack();
    expect(pet.aggroTargetId).toBe(dummy.id);
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

  it('stops a pet that has a target and auto-attack when its owner sits', () => {
    const outcome = (seated: boolean) => {
      const { sim, player } = rig('warlock');
      summonPet(sim.ctx, player, 'emberkin');
      const pet = [...sim.entities.values()].find((e) => e.ownerId === player.id)!;
      const dummy = addDummy(sim, 3, 3);
      pet.targetId = dummy.id;
      pet.autoAttack = true;
      if (seated) sim.chat('/dev turret');
      sim.tick();
      return { targetId: pet.targetId, autoAttack: pet.autoAttack, dummy: dummy.id };
    };
    const control = outcome(false);
    expect(control).toEqual({ targetId: control.dummy, autoAttack: true, dummy: control.dummy });
    expect(outcome(true)).toMatchObject({ targetId: null, autoAttack: false });
  });

  it('lends the tank over a player on foot and restores them on foot', () => {
    const { sim, player } = rig();
    expect(player.mountKey).toBe('');
    seat(sim);
    expect(player.mountKey).toBe(TURRET_TANK_MOUNT);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(player.mountKey).toBe(TURRET_TANK_MOUNT);
    sim.leaveVehicle();
    expect(player.mountKey).toBe('');
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
      jump: jumpMult(e),
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
    expect(player.mountKey).toBe(TURRET_TANK_MOUNT);
    sim.leaveVehicle();
    expect(player.mountKey).toBe('');
  });

  it('strips Ghost Wolf before lending the tank, like a real summon', () => {
    const { sim, player } = rig('shaman');
    sim.setPlayerLevel(10);
    sim.castAbility('ghost_wolf');
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(player.auras.some((a) => a.id === 'ghost_wolf')).toBe(true);
    sim.chat('/dev turret');
    expect(player.mountKey).toBe(TURRET_TANK_MOUNT);
    expect(player.auras.some((a) => a.id === 'ghost_wolf')).toBe(false);
    sim.leaveVehicle();
    expect(player.auras.some((a) => a.id === 'ghost_wolf')).toBe(false);
    expect(moveSpeedMult(player)).toBe(1);
  });

  it('bumps the owner wire revision when seating', () => {
    const { sim, meta } = rig();
    const before = meta.wireRev;
    sim.chat('/dev turret');
    expect(meta.vehicle?.kind).toBe('turret');
    expect(meta.wireRev).toBeGreaterThan(before);
  });

  it('seeds the session from the world seed, the owner and the seat tick', () => {
    const { sim, player } = rig();
    const first = sim.tickCount;
    sim.chat('/dev turret');
    expect(turretSeat(sim).defense.seed).toBe(turretSessionSeed(WORLD_SEED, player.id, first));
    sim.leaveVehicle();
    for (let i = 0; i < 3; i++) sim.tick();
    const second = sim.tickCount;
    sim.chat('/dev turret');
    expect(turretSeat(sim).defense.seed).toBe(turretSessionSeed(WORLD_SEED, player.id, second));
    expect(turretSessionSeed(WORLD_SEED, player.id, second)).not.toBe(
      turretSessionSeed(WORLD_SEED, player.id, first),
    );
  });

  it('never owns or saves the lent tank, nor the seat', () => {
    const { sim, player, meta } = rig();
    seat(sim);
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    expect(mountOwned(meta, TURRET_TANK_MOUNT)).toBe(false);
    expect(sim.ownedMounts()).not.toContain(TURRET_TANK_MOUNT);
    const save = sim.serializeCharacter(player.id);
    expect(save).not.toHaveProperty('vehicle');
    const json = JSON.stringify(save);
    expect(json).not.toContain(TURRET_TANK_MOUNT);
    expect(json).not.toContain('"turret');
    expect(turretSeat(sim).kind).toBe('turret');
    // The scan's control: an owned tank does reach the save.
    sim.addItem(mountItemId(TURRET_TANK_MOUNT)!, 1);
    expect(JSON.stringify(sim.serializeCharacter(player.id))).toContain(TURRET_TANK_MOUNT);
  });

  it('revalidates the tank away when ridden with no turret seat, or from the cannon', () => {
    const bare = rig();
    bare.player.mountKey = TURRET_TANK_MOUNT;
    for (let i = 0; i < MOUNT_OWNERSHIP_REVALIDATE_TICKS; i++) bare.sim.tick();
    expect(bare.player.mountKey).toBe('');

    const { sim, player, station } = cannonRig();
    expect(sim.enterVehicle(station.id)).toBe(true);
    player.mountKey = TURRET_TANK_MOUNT;
    for (let i = 0; i < MOUNT_OWNERSHIP_REVALIDATE_TICKS; i++) sim.tick();
    expect(cannonSeat(sim).kind).toBe('cannon');
    expect(player.mountKey).toBe('');
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
    open.sim.ctx.delveRunForPlayer = () => null;
    open.sim.chat('/dev turret');
    expect(open.meta.vehicle?.kind).toBe('turret');
  });
});

describe('ending the seat', () => {
  const cases: { name: string; mount: string; end: (sim: Sim) => void }[] = [
    { name: 'leave', mount: DEFAULT_MOUNT, end: (sim) => sim.leaveVehicle() },
    {
      name: 'death',
      mount: '',
      end: (sim) => {
        sim.player.dead = true;
        sim.tick();
      },
    },
    {
      name: 'a real death through the damage path',
      mount: '',
      end: (sim) => {
        const p = sim.player;
        sim.ctx.dealDamage(null, p, p.maxHp * 10, false, 'physical', null, 'hit', true);
        expect(p.dead).toBe(true);
        sim.tick();
      },
    },
    {
      name: 'displacement from the origin',
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
      name: 'world combat',
      mount: DEFAULT_MOUNT,
      end: (sim) => {
        sim.player.inCombat = true;
        sim.tick();
      },
    },
    {
      name: 'losing the tank while alive',
      mount: DEFAULT_MOUNT,
      end: (sim) => {
        forceDismount(sim.ctx, sim.player);
        sim.tick();
      },
    },
    { name: 'removal', mount: '', end: (sim) => sim.removePlayer(sim.playerId) },
  ];

  it.each(cases)('ends on $name with no monsters and the right mount', ({ end, mount }) => {
    const { sim, meta } = rig();
    ownHorse(sim);
    seat(sim);
    for (let i = 0; i < TURRET_TIMING.introTicks + 40; i++) sim.tick();
    expect(turretSeat(sim).defense.monsters.length).toBeGreaterThan(0);
    end(sim);
    expect(meta.vehicle).toBeNull();
    expect(sim.turretSession).toBeNull();
    if (sim.entities.has(sim.playerId)) {
      expect(sim.player.mountKey).toBe(mount);
      const after: SimEvent[] = [];
      for (let i = 0; i < 40; i++) after.push(...sim.tick());
      expect(turretEvents(after)).toEqual([]);
    }
  });

  it('ends on a profession action that takes the tank, and gives the horse back', () => {
    const { sim, player } = rig();
    ownHorse(sim);
    seat(sim);
    const item = Object.values(ITEMS).find((d) => isSalvageable(d))!;
    sim.addItem(item.id, 1);
    sim.salvageItem(item.id);
    expect(player.mountKey).toBe('');
    sim.tick();
    expect(sim.turretSession).toBeNull();
    expect(player.mountKey).toBe(DEFAULT_MOUNT);
  });

  it('ends when a real world mob pulls the seated player into combat, alive', () => {
    const { sim, player } = rig();
    ownHorse(sim);
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
    expect(player.mountKey).toBe(DEFAULT_MOUNT);
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
    sim.chat(`/dev turret ${station.x} ${station.z + 2}`);
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
    expect(view.defense.monsters).toEqual(live.monsters);
    expect(view.defense.monsters).not.toBe(live.monsters);
    expect(view.defense.monsters[0].seg).not.toBe(live.monsters[0].seg);
    expect(live.shots).toHaveLength(1);
    expect(view.defense.shots).toEqual(live.shots);
    expect(view.defense.shots).not.toBe(live.shots);
    expect(view.defense.shots[0]).not.toBe(live.shots[0]);
    expect(view.defense.stats).not.toBe(live.stats);
    expect(view.origin).not.toBe(turretSeat(sim).origin);
    expect(view.feedback).not.toBe(turretSeat(sim).feedback);
    expect(Object.isFrozen(view.feedback[0])).toBe(true);
    expect(Object.isFrozen(view.feedback[0].event)).toBe(true);
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
      integrity: TURRET_TIMING.integrity,
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

  it('leaves the online mirror empty until the turret goes online', () => {
    const client = new QuestWorldWireState();
    expect(client.turretSession).toBeNull();
    expect(client.turretClock).toBeNull();
    client.resetQuestWorldWireState();
    expect(client.turretSession).toBeNull();
  });
});

describe('the feedback ring', () => {
  it('records every engine event of a won run in order, bounded, consumed once across waves', () => {
    const { sim } = rig();
    seat(sim);
    const world: IWorldVehicles = sim;
    const emitted: TurretEvent[] = [];
    const consumed: TurretFeedback[] = [];
    let cursor = 0;
    let longest = 0;
    for (let i = 0; i < RUN_BOUND && world.turretSession?.defense.phase !== 'won'; i++) {
      for (const e of turretEvents(sim.tick())) emitted.push(e.event);
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
    for (const e of turretEvents(sim.drainEvents())) emitted.push(e.event);
    const tail = turretFeedbackSince(world.turretSession!.feedback, cursor);
    consumed.push(...tail);
    expect(consumed.map((f) => f.seq)).toEqual(consumed.map((_, i) => i + 1));
    expect(consumed.map((f) => f.event)).toEqual(emitted);
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

describe('determinism', () => {
  it('draws nothing from the world rng: a seated, firing run leaves it where a control run does', () => {
    const draws = (seated: boolean): { count: number; next: number[] } => {
      const { sim } = rig();
      let count = 0;
      sim.rng.setObserver(() => {
        count++;
      });
      sim.chat(
        seated
          ? `/dev turret ${AMBERFALL.x} ${AMBERFALL.z}`
          : `/dev tp ${AMBERFALL.x} ${AMBERFALL.z}`,
      );
      for (let i = 0; i < 20 * 40; i++) {
        sim.tick();
        aimOnce(sim);
      }
      if (seated) expect(turretSeat(sim).defense.stats.hits).toBeGreaterThan(0);
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
});

describe('a headless run on real terrain', () => {
  it('a scripted aimer on the IWorld surface wins at Amberfall, bounded, and stays seated after', () => {
    const { sim, player, meta } = rig();
    ownHorse(sim);
    seat(sim);
    const run = playOut(sim, true);
    expect(run.phase).toBe('won');
    expect(run.ticks).toBeLessThan(RUN_BOUND);
    expect([...run.pids]).toEqual([player.id]);
    const waves = run.events.filter((e) => e.type === 'waveCleared').length;
    expect(waves).toBe(resolveTurretPlan().waves.length);
    expect(sim.turretSession?.defense.integrity).toBeGreaterThan(0);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(meta.vehicle?.kind).toBe('turret');
    expect(sim.turretSession?.defense.phase).toBe('won');
    expect(player.mountKey).toBe(TURRET_TANK_MOUNT);
    sim.leaveVehicle();
    expect(sim.turretSession).toBeNull();
    expect(player.mountKey).toBe(DEFAULT_MOUNT);
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
