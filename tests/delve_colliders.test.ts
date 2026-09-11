// Delve module layout collision smoke tests (spatial band PR 4 partial).
import { describe, expect, it } from 'vitest';
import { isBlocked, lineOfSightClear, resolvePosition } from '../src/sim/colliders';
import { DELVE_MODULE_Z_START, delveModuleZOffset, delveOrigin } from '../src/sim/data';
import {
  DELVE_MODULE_LAYOUTS,
  type DelveModuleId,
  delveModuleEntry,
} from '../src/sim/delve_layout';
import { DUNGEON_WALK_HALF_X } from '../src/sim/dungeon_layout';

const SEED = 42;

const ENTRY_MODULES: DelveModuleId[] = ['reliquary_sunken_ossuary', 'reliquary_bell_niche'];

describe('delve module colliders', () => {
  for (const moduleId of ENTRY_MODULES) {
    it(`${moduleId} entry is walkable at delve origin`, () => {
      const origin = delveOrigin(0, 0);
      const entry = delveModuleEntry(DELVE_MODULE_LAYOUTS[moduleId]);
      expect(isBlocked(SEED, origin.x + entry.x, origin.z + 8 + entry.z, 0.5)).toBe(false);
    });
  }

  it('side walls block movement at module perimeter', () => {
    const origin = delveOrigin(0, 0);
    const layout = DELVE_MODULE_LAYOUTS.reliquary_saintless_hall;
    const midZ = (layout.zMin + layout.zMax) / 2;
    expect(isBlocked(SEED, origin.x + 25, origin.z + DELVE_MODULE_Z_START + midZ, 0.5)).toBe(true);
  });

  it('module 0 right aisle is walkable; wall face is blocked', () => {
    const origin = delveOrigin(0, 0);
    const modules: DelveModuleId[] = ['reliquary_sunken_ossuary'];
    const zBase = delveModuleZOffset(modules, 0);
    const midZ =
      (DELVE_MODULE_LAYOUTS.reliquary_sunken_ossuary.zMin +
        DELVE_MODULE_LAYOUTS.reliquary_sunken_ossuary.zMax) /
      2;
    const aisleX = 19;
    const wx = origin.x + aisleX;
    const wz = origin.z + zBase + midZ;
    const res = resolvePosition(SEED, wx, wz, 0.5, false, modules);
    expect(Math.abs(res.x - wx)).toBeLessThan(0.05);
    expect(isBlocked(SEED, origin.x + 25, wz, 0.5)).toBe(true);
  });

  it('finale boss dais center is walkable at module 3 z offset', () => {
    const origin = delveOrigin(0, 0);
    const modules: DelveModuleId[] = [
      'reliquary_sunken_ossuary',
      'reliquary_bell_niche',
      'reliquary_saintless_hall',
      'reliquary_finale',
    ];
    const layout = DELVE_MODULE_LAYOUTS.reliquary_finale;
    const zBase = delveModuleZOffset(modules, 3);
    const wx = origin.x;
    const wz = origin.z + zBase + layout.dais.z;
    const res = resolvePosition(SEED, wx, wz, 0.5, false, modules);
    expect(Math.abs(res.x - wx)).toBeLessThan(0.05);
    expect(Math.abs(res.z - wz)).toBeLessThan(0.05);
  });

  it('exit area of module 0 is bounded: back wall blocks entry from inside', () => {
    // The back wall OBB sits at zMax with hd=1 (DUNGEON_WALL_HW).  A player
    // at zMax - 0.3 (inside the wall thickness) is pushed back inside the room.
    // resolvePosition is push-out: it recovers overlap, not teleportation past a wall.
    const origin = delveOrigin(0, 0);
    const modules: DelveModuleId[] = ['reliquary_sunken_ossuary'];
    const layout = DELVE_MODULE_LAYOUTS.reliquary_sunken_ossuary;
    const zBase = delveModuleZOffset(modules, 0);
    const oz = origin.z + zBase;
    // Position the player overlapping the back wall from the interior side.
    const tryX = origin.x;
    const tryZ = oz + layout.zMax - 0.3; // inside the OBB (zMax ± hd=1)
    const res = resolvePosition(SEED, tryX, tryZ, 0.5, false, modules);
    // Must be pushed to at most zMax - (hd + r) = zMax - 1.5 from the OBB centre,
    // i.e. inside the room.
    expect(res.z).toBeLessThan(oz + layout.zMax);
  });

  it('exit area of module 0 is bounded: player cannot walk through side walls near exit', () => {
    // At the exit area (near zMax), side walls at |x|=DUNGEON_WALL_X still block.
    const origin = delveOrigin(0, 0);
    const modules: DelveModuleId[] = ['reliquary_sunken_ossuary'];
    const layout = DELVE_MODULE_LAYOUTS.reliquary_sunken_ossuary;
    const zBase = delveModuleZOffset(modules, 0);
    const oz = origin.z + zBase;
    const exitZ = oz + layout.zMax - 6; // near the exit object position
    // Standing just inside the walk half-width is fine
    const insideX = origin.x + DUNGEON_WALK_HALF_X - 1;
    expect(isBlocked(SEED, insideX, exitZ, 0.5)).toBe(false);
    // Standing on the wall itself is blocked (delve wall at wallX=25)
    expect(isBlocked(SEED, origin.x + 25, exitZ, 0.5)).toBe(true);
  });

  describe('The Saintless Hall: casting over floor clutter', () => {
    // Reproduces a reported bug entering The Collapsed Reliquary: a caster
    // standing on open floor got "Line of sight." refused against a mob a
    // few yards away with nothing visible between them. Root cause: aisle
    // floor-clutter circles carried no cameraTopY, and the delve branch of
    // lineOfSightClear used a movement-style resolveAgainst push-out with no
    // height concept at all, so every scatter point blocked a cast like a
    // full wall regardless of how short the debris actually is.
    const modules: DelveModuleId[] = ['reliquary_saintless_hall'];
    const layout = DELVE_MODULE_LAYOUTS.reliquary_saintless_hall;
    const clutter = layout.clutter?.[0];
    if (!clutter) throw new Error('expected reliquary_saintless_hall to carry aisle clutter');
    const origin = delveOrigin(0, 0);
    const zBase = delveModuleZOffset(modules, 0);
    const clutterWorldZ = origin.z + zBase + clutter.z;

    it('does not block a cast whose ray only crosses a clutter scatter point', () => {
      // Caster and target straddle the clutter point on a dead-straight ray
      // (same local x as the clutter), well clear of every pillar/tomb row.
      const from = { x: origin.x + clutter.x, z: clutterWorldZ - 3 };
      const to = { x: origin.x + clutter.x, z: clutterWorldZ + 3 };
      expect(lineOfSightClear(SEED, from, to, 0.05, modules)).toBe(true);
    });

    it('still blocks movement through the same clutter point', () => {
      // The fix is a LOS-only skip: floor clutter keeps colliding for
      // movement (no moveTopY was ever set on it, and none was added here).
      expect(isBlocked(SEED, origin.x + clutter.x, clutterWorldZ, 0.4)).toBe(true);
    });
  });
});
