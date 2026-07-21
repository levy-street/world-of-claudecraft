import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  artisanRowPreloadInternalsForTest,
  buildArtisanRowProps,
} from '../src/render/artisan_row_props';
import { CRAFT_RING } from '../src/sim/content/professions';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { roadDistance } from '../src/sim/world';

const { assetUrl, targetHeight, placements } = artisanRowPreloadInternalsForTest;

const SEED = 20061;

describe('artisan row props', () => {
  it('every placement kind has a matching asset URL and target height', () => {
    for (const p of placements) {
      expect(assetUrl[p.kind]).toMatch(/^\/models\/props\/.+\.glb$/);
      expect(targetHeight[p.kind]).toBeGreaterThan(0);
    }
  });

  it('has exactly one placement per asset kind (no duplicates)', () => {
    const kinds = placements.map((p) => p.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds.length).toBe(Object.keys(assetUrl).length);
  });

  it('covers a crafting or gathering prop for every profession still missing world flavor', () => {
    // weaponcrafting/armorcrafting already get an anvil at Smith Haldren's stall
    // (props.ts); every other profession id should map to a placement kind here.
    const craftIds = CRAFT_RING.map((c) => c.id).filter(
      (id) => id !== 'weaponcrafting' && id !== 'armorcrafting',
    );
    const gatherIds = ['mining', 'herbalism'];
    for (const id of [...craftIds, ...gatherIds]) {
      const matches = placements.some((p) => p.kind.startsWith(id));
      expect(matches, `no artisan row prop for profession "${id}"`).toBe(true);
    }
  });

  it('places every prop within the zone1 town bounds, clear of the market stall/house footprints', () => {
    for (const p of placements) {
      // Stays inside a loose town radius around Smith Haldren's stall (9.5, 17.5).
      expect(Math.hypot(p.x - 9.5, p.z - 17.5)).toBeLessThan(14);
      // Clears the stall's own footprint (r=1.7) and the house at (10, 12).
      expect(Math.hypot(p.x - 9.5, p.z - 17.5)).toBeGreaterThan(1.7);
      expect(Math.hypot(p.x - 10, p.z - 12)).toBeGreaterThan(3.5);
    }
  });

  it('keeps every prop clear of the painted road surface (no walk-through furniture standing on a road)', () => {
    // The map paints a road out to 2.4 (map_terrain.ts); a prop with no
    // collider sitting inside that band would stand on bare road with
    // traffic passing through it. tailoring_loom and inscription_lectern
    // were previously at 2.36 and 1.25 and got nudged off-axis for exactly
    // this reason.
    for (const p of placements) {
      expect(
        roadDistance(p.x, p.z),
        `${p.kind} at (${p.x}, ${p.z}) is too close to a road`,
      ).toBeGreaterThan(2.4);
    }
  });

  afterEach(() => {
    setActiveWorldContent(null);
  });

  it('places all ten props on the builtin world', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    const { group } = buildArtisanRowProps(SEED);
    expect(group.children.length).toBe(placements.length);
  });

  it('places no props on a custom world (editor play-test), so a hand-authored zone1 landmark never leaks onto a custom map', () => {
    // A genuinely different WorldContent (not just a different object
    // identity referencing the same nested `zones`), so this exercises the
    // guard the way an editor play-test map actually would.
    setActiveWorldContent({ ...BUILTIN_WORLD, zones: [] });
    const { group } = buildArtisanRowProps(SEED);
    expect(group.children.length).toBe(0);
  });

  it('tilts each of the four steep-slope props to match the local ground instead of standing perfectly upright', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    const { group } = buildArtisanRowProps(SEED);
    // A prop with zero pitch leaves world-up unchanged when rotated by its
    // quaternion (the yaw component alone never touches the y axis). Pin the
    // specific placements the reviewer measured on 17-22 degree ground
    // (leatherworking_rack, tailoring_loom, inscription_lectern, cooking_spit)
    // rather than an "any prop tilted" check, so a regression that silently
    // drops the tilt for one of them cannot hide behind the others.
    const steepKinds = new Set([
      'leatherworking_rack',
      'tailoring_loom',
      'inscription_lectern',
      'cooking_spit',
    ]);
    const tiltOf = (obj: THREE.Object3D) => {
      const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(obj.quaternion);
      return Math.hypot(localUp.x, localUp.z);
    };
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      if (!steepKinds.has(p.kind)) continue;
      expect(tiltOf(group.children[i]), `${p.kind} did not tilt to the slope`).toBeGreaterThan(
        1e-3,
      );
    }
  });
});
