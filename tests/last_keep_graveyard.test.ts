// The Last Keep churchyard (Drakelands) is a functional graveyard: the placed
// headstone cluster south of the keep chapel carries an OVERWORLD_GRAVEYARDS
// record, so a death at the keep releases into its own yard instead of walking
// the ghost back from the Wyrmwatch cairns nearly 300 yd north (the "we rez
// far away" report).

import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { DRAKELANDS_PROPS } from '../src/sim/content/drakelands';
import {
  BUILTIN_WORLD,
  DUNGEONS,
  OVERWORLD_GRAVEYARDS,
  SPIRIT_HEALER_NPC_ID,
} from '../src/sim/data';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import { nearestOverworldGraveyard } from '../src/sim/spirit';
import type { Entity, WorldContent } from '../src/sim/types';

const KEEP_YARD = { x: 451, z: 2134 };
const SEED = 42;

// Camps, world NPCs, and ground objects stripped: Spirit Healers are
// system-owned (spawned per OVERWORLD_GRAVEYARDS record in the ctor pass), and
// the death loop is all this file exercises (the tests/spirit.test.ts pattern).
const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const makeSim = () =>
  new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true, world: WORLD });

const yards = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe('the Last Keep churchyard is a functional graveyard', () => {
  it('carries a graveyard record on the placed headstone cluster', () => {
    const stones = DRAKELANDS_PROPS.graveyards.find(
      (g) => g.x === KEEP_YARD.x && g.z === KEEP_YARD.z,
    );
    expect(stones).toBeDefined();
    const gy = OVERWORLD_GRAVEYARDS.find((g) => g.id === 'gy_last_keep');
    expect(gy).toBeDefined();
    expect({ x: gy?.x, z: gy?.z }).toEqual(KEEP_YARD);
  });

  it('was appended after every record that shipped before it (healer ids are array-ordered)', () => {
    const ids = OVERWORLD_GRAVEYARDS.map((g) => g.id);
    expect(ids.indexOf('gy_last_keep')).toBeGreaterThan(ids.indexOf('gy_proving_shore'));
  });

  it('is the release point for a death at the keep door', () => {
    const door = DUNGEONS.the_last_keep.doorPos;
    const gy = nearestOverworldGraveyard(door.x, door.z);
    expect(gy).toEqual(KEEP_YARD);
    expect(yards(gy, door)).toBeLessThan(60);
    // The Wyrmwatch cairns (the zone's hub yard) no longer catch keep deaths.
    const hub = OVERWORLD_GRAVEYARDS.find((g) => g.id === 'gy_drakelands');
    expect(hub).toBeDefined();
    if (hub) expect(yards(hub, door)).toBeGreaterThan(250);
  });

  it('spawns a Pale Keeper on the yard in a real Sim, and a keep death releases there', () => {
    const sim = makeSim();
    const healer = [...sim.entities.values()].find(
      (e: Entity) =>
        e.kind === 'npc' && e.templateId === SPIRIT_HEALER_NPC_ID && yards(e.pos, KEEP_YARD) <= 2,
    );
    expect(healer).toBeDefined();
    // Die on the keep terrace, 3 yd short of the dungeon door, then release.
    const door = DUNGEONS.the_last_keep.doorPos;
    const p = sim.player;
    p.pos.x = door.x - 3;
    p.pos.z = door.z;
    p.prevPos.x = p.pos.x;
    p.prevPos.z = p.pos.z;
    p.hp = 1;
    p.dead = true;
    sim.releaseSpirit();
    expect(p.ghost).toBe(true);
    expect({ x: p.pos.x, z: p.pos.z }).toEqual(KEEP_YARD);
  });

  it('keeps the anchor stone walkable so the ghost can reach the Pale Keeper', () => {
    // The graveyard-record carve-out in colliders.ts: the stone drawn at the
    // anchor is scenery, the rest of the cluster stays solid.
    expect(isBlocked(SEED, KEEP_YARD.x, KEEP_YARD.z, PLAYER_BODY_RADIUS)).toBe(false);
  });
});
