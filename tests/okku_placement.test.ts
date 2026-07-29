// Okku (hermit_okku) camps at the Vinefall, next to the great banyan he
// "went in" to. His authored spot used to sit 6.3 yards from the banyan's
// center: inside the RENDERED trunk (render/jungle_features.ts scales the
// twisted banyan GLB to t.r * (2.5..3.0), far wider than the r * 1.45 sim
// collider), so players saw only his nameplate floating in the bark. A first
// pass moved him to 8.7 yards and he STILL clipped the trunk and its root
// flare in game, so the bar here is a measured-from-screenshots 12.
//
// These tests pin the placement contract that keeps him visible and
// clickable: clear of every great trunk, clear of the seeded palm scatter,
// on walkable dry land, and spawned exactly where the data says (findSafePos
// never had to relocate him).
import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { PALMREACH_NPCS, PALMREACH_PROPS } from '../src/sim/content/palmreach';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { reachDeckClear } from '../src/sim/reach_decks';
import { rideSteepnessAt } from '../src/sim/ride_height';
import { Sim } from '../src/sim/sim';
import { groundHeight, reachPalmSpots, waterLevelAt } from '../src/sim/world';

// The shipped world seed (src/main.ts WORLD_SEED, server/main.ts Sim cfg).
const SEED = 20061;

// A great trunk renders at up to 3x its data radius and its modeled roots
// flare wider still. The widest Palmreach banyan is r 3.2, and 8.7 yards was
// observed in game to still clip it, so 12 yards from center is the bar that
// puts an NPC fully in the open next to one.
const MIN_TRUNK_CLEARANCE = 12;

// The seeded palm scatter instances a ~9 yard tall trunk at each spot. Okku
// now stands OUTSIDE the guaranteed palm-free annulus (propClear only keeps
// palms greatTree.r + 6 = 9.2 yards off this banyan), so this clearance is a
// real constraint on the shipped seed, not a formality.
const MIN_PALM_CLEARANCE = 2;

// The body radius Sim.findSafePos probes NPC spawns with (sim.ts default).
const SPAWN_BODY_RADIUS = 0.6;

const okku = PALMREACH_NPCS.hermit_okku;

describe('Okku stands clear of the Vinefall banyan', () => {
  it('is at least 12 yards from every authored great tree center', () => {
    // Arrange
    const trees = PALMREACH_PROPS.greatTrees ?? [];
    expect(trees.length).toBeGreaterThan(0);

    // Act
    const distances = trees.map((t) => ({
      tree: t,
      d: Math.hypot(okku.pos.x - t.x, okku.pos.z - t.z),
    }));
    const nearest = distances.reduce((a, b) => (a.d <= b.d ? a : b));

    // Assert
    expect(
      nearest.d,
      `Okku at (${okku.pos.x}, ${okku.pos.z}) is ${nearest.d.toFixed(2)} yd from the great tree at (${nearest.tree.x}, ${nearest.tree.z})`,
    ).toBeGreaterThanOrEqual(MIN_TRUNK_CLEARANCE);
  });

  it('faces the great tree he went in to', () => {
    // Arrange
    const trees = PALMREACH_PROPS.greatTrees ?? [];
    const nearest = trees.reduce((a, b) =>
      Math.hypot(okku.pos.x - a.x, okku.pos.z - a.z) <=
      Math.hypot(okku.pos.x - b.x, okku.pos.z - b.z)
        ? a
        : b,
    );

    // Act: facing is atan2(dx, dz), the sim convention (types.ts angleTo).
    const toTree = Math.atan2(nearest.x - okku.pos.x, nearest.z - okku.pos.z);
    const off = Math.abs(
      Math.atan2(Math.sin(okku.facing - toTree), Math.cos(okku.facing - toTree)),
    );

    // Assert: within about 6 degrees of dead on.
    expect(off).toBeLessThan(0.1);
  });

  it('keeps 2 yards from every seeded Palmreach palm', () => {
    // Arrange
    const palms = reachPalmSpots(SEED);
    expect(palms.length).toBeGreaterThan(0);

    // Act
    const nearest = palms.reduce((best, p) => {
      const d = Math.hypot(okku.pos.x - p.x, okku.pos.z - p.z);
      return d < best ? d : best;
    }, Infinity);

    // Assert
    expect(
      nearest,
      `nearest seeded palm at seed ${SEED} is ${nearest.toFixed(2)} yd away`,
    ).toBeGreaterThanOrEqual(MIN_PALM_CLEARANCE);
  });

  it('stands on open, walkable, dry ground', () => {
    // Arrange / Act
    const { x, z } = okku.pos;
    const ground = groundHeight(x, z, SEED);
    const water = waterLevelAt(x, z);

    // Assert: clear at the player body radius AND at the 0.6 radius
    // findSafePos probes with, so neither a player nor the spawner is
    // squeezed out; on dry, walkable ground; and not on a plank deck.
    expect(isBlocked(SEED, x, z, PLAYER_BODY_RADIUS)).toBe(false);
    expect(isBlocked(SEED, x, z, SPAWN_BODY_RADIUS)).toBe(false);
    expect(water === -Infinity || ground > water).toBe(true);
    expect(rideSteepnessAt(x, z, SEED)).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
    expect(reachDeckClear(x, z, 1.5)).toBe(true);
  });

  it('spawns exactly at the authored spot in the shipped world', () => {
    // Arrange
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });

    // Act
    const spawned = [...sim.entities.values()].find(
      (e) => e.kind === 'npc' && e.templateId === 'hermit_okku',
    );

    // Assert: findSafePos relocates a spawn that lands in a collider or in
    // water, so an untouched position proves the authored spot is legal.
    if (!spawned) throw new Error('hermit_okku did not spawn in the shipped world');
    expect(spawned.pos.x).toBeCloseTo(okku.pos.x, 6);
    expect(spawned.pos.z).toBeCloseTo(okku.pos.z, 6);
    const water = waterLevelAt(spawned.pos.x, spawned.pos.z);
    expect(water === -Infinity || spawned.pos.y > water).toBe(true);
  });
});
