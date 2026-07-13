// Controlled fight environment for the balance simulator: a minimal world (no
// camps, npcs, or objects) with a flattened plateau, so ticks are cheap, no
// wandering mob interferes, and the arena terrain is identical under every rng
// seed. The one Sim seed drives both terrain and combat rolls, so without the
// flatten stamp every seed would also reshape the ground under the fighters.

import { talentPointsAtLevel } from '../../src/sim/content/talents';
import { MOBS, setActiveWorldContent } from '../../src/sim/data';
import { createMob } from '../../src/sim/entity';
import { Sim } from '../../src/sim/sim';
import { type Entity, emptyZoneProps, MAX_LEVEL, type WorldContent } from '../../src/sim/types';
import { groundHeight } from '../../src/sim/world';
import { bestGearFor, specBuild } from './builds';
import type { BalanceSpec } from './spec_catalog';

export const ARENA_CENTRE = { x: 0, z: -40 };
const ARENA_FLATTEN_RADIUS = 80;
const ARENA_HEIGHT = 6;

export function arenaWorld(): WorldContent {
  return {
    // world.ts derives its z-band from zones[0], so the minimal world still
    // needs exactly one zone; it spawns nothing because camps stay empty.
    zones: [
      {
        id: 'balance_arena',
        name: 'Balance Arena',
        zMin: -400,
        zMax: 400,
        levelRange: [1, 20],
        biome: 'vale',
        hub: { x: 300, z: 300, radius: 10, name: 'Balance Arena' },
        graveyard: { x: ARENA_CENTRE.x + 40, z: ARENA_CENTRE.z + 40 },
        lakes: [],
        pois: [],
        welcome: 'Balance Arena',
      },
    ],
    camps: [],
    npcs: {},
    groundObjects: [],
    roads: [],
    props: emptyZoneProps(),
    playerStart: { ...ARENA_CENTRE },
    terrainEdits: [
      {
        x: ARENA_CENTRE.x,
        z: ARENA_CENTRE.z,
        radius: ARENA_FLATTEN_RADIUS,
        delta: ARENA_HEIGHT,
        falloff: 'flat',
        mode: 'level',
      },
    ],
  };
}

// Terrain and colliders read the data.ts module global, not cfg.world, so the
// two must be swapped together (see the Sim ctor invariant) and restored after
// the bout so nothing leaks into other suites in the same worker.
export function makeArenaSim(seed: number): Sim {
  const world = arenaWorld();
  setActiveWorldContent(world);
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true, world });
}

export function releaseArenaWorld(): void {
  setActiveWorldContent(null);
}

export function teleport(sim: Sim, id: number, x: number, z: number): void {
  const e = sim.entities.get(id);
  if (!e) return;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as { rebucket(e: Entity): void }).rebucket(e);
}

export function face(source: Entity, target: Entity): void {
  source.facing = Math.atan2(target.pos.x - source.pos.x, target.pos.z - source.pos.z);
  source.prevFacing = source.facing;
}

export interface FighterOptions {
  level?: number;
  // Override the generated build (knockout runs pass one in).
  talents?: ReturnType<typeof specBuild>;
}

// A fully kitted combatant: leveled, talented, geared, pet summoned, prebuffed,
// and topped up. Ticks the sim a little (pet summon casts), so spawn every
// fighter before positioning any of them.
export function addFighter(
  sim: Sim,
  spec: BalanceSpec,
  name: string,
  opts: FighterOptions = {},
): number {
  const level = opts.level ?? MAX_LEVEL;
  const pid = sim.addPlayer(spec.cls, name);
  sim.setPlayerLevel(level, pid);
  const build = opts.talents ?? specBuild(spec.cls, spec.specId, talentPointsAtLevel(level));
  sim.applyTalents(build, pid);
  for (const itemId of Object.values(bestGearFor(spec, level))) {
    sim.addItem(itemId, 1, pid);
    sim.equipItem(itemId, pid);
  }
  if (spec.cls === 'hunter') tameArenaWolf(sim, pid, level);
  if (spec.cls === 'warlock') summonImp(sim, pid);
  topUp(sim, pid);
  return pid;
}

// Casts the fighter's prepull buffs once it stands at its mark, then refills
// hp and resource so the bout starts from a clean sheet.
export function runPrepull(sim: Sim, spec: BalanceSpec, pid: number): void {
  for (const ability of spec.prepull ?? []) {
    const p = sim.entities.get(pid);
    if (!p) return;
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.castAbility(ability, pid);
    for (let i = 0; i < 20 * 4 && sim.entities.get(pid)?.castingAbility; i++) sim.tick();
  }
  topUp(sim, pid);
}

export function topUp(sim: Sim, pid: number): void {
  const p = sim.entities.get(pid);
  if (!p) return;
  p.hp = p.maxHp;
  // Rage starts empty in a real fight; mana and energy start full.
  p.resource = p.resourceType === 'rage' ? 0 : p.maxResource;
  p.gcdRemaining = 0;
}

// Hunters need a live beast to tame; the minimal world spawns none, so place a
// wolf next to the hunter, tame it, and let the cast finish.
function tameArenaWolf(sim: Sim, pid: number, level: number): void {
  const hunter = sim.entities.get(pid);
  if (!hunter) return;
  const wolf = createMob((sim as unknown as { nextId: number }).nextId++, MOBS.forest_wolf, level, {
    x: hunter.pos.x + 4,
    y: hunter.pos.y,
    z: hunter.pos.z,
  });
  // Tame targeting requires a hostile beast; keep it pinned and idle while the
  // tame channels so it never lands a swing (the dummy_sim.mjs pattern).
  wolf.hostile = true;
  wolf.aiState = 'idle';
  sim.addEntity(wolf);
  sim.targetEntity(wolf.id, pid);
  face(hunter, wolf);
  sim.castAbility('tame_beast', pid);
  for (let i = 0; i < 20 * 12 && sim.entities.get(pid)?.castingAbility; i++) {
    wolf.aiState = 'idle';
    wolf.targetId = null;
    wolf.aggroTargetId = null;
    sim.tick();
  }
  // The tame resolves as a homing projectile: the pet only exists once the
  // bolt lands, a few ticks after the cast bar completes.
  drainProjectiles(sim);
}

function drainProjectiles(sim: Sim): void {
  const pending = (sim as unknown as { pendingProjectiles: unknown[] }).pendingProjectiles;
  for (let i = 0; i < 40 && pending.length > 0; i++) sim.tick();
}

function summonImp(sim: Sim, pid: number): void {
  if (sim.petOf(pid)) return;
  sim.castAbility('summon_imp', pid);
  for (let i = 0; i < 20 * 12 && sim.entities.get(pid)?.castingAbility; i++) sim.tick();
  drainProjectiles(sim);
}
