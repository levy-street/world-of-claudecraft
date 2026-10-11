import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildFerryPiers } from '../src/render/ferry_piers';
import { WICKHARBOR_WHARF_DECKS } from '../src/sim/content/wickharbor_wharf';
import { WYRMWATCH_HARBOR_DECKS } from '../src/sim/content/wyrmwatch_harbor';
import {
  FERRY_PIER_DECK_ABOVE_WATER,
  FERRY_PIER_DECKS,
  FERRY_PIERS,
  ferryPierSurface,
  onFerryPier,
} from '../src/sim/ferry_piers';
import { groundHeight, terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The ferry piers at the far berths (src/sim/ferry_piers.ts): walkable plank
// decks standing in the water at Eastbrook's ferry-pier height, folded into
// the ground height, and drawn (src/render/ferry_piers.ts) as one small local
// mesh set per pier, never one mesh spanning the world between them.

const terrain = (x: number, z: number) => terrainHeight(x, z, WORLD_SEED);

describe('ferry piers', () => {
  it('stand level at the ferry pier height, and are walkable ground', () => {
    for (const pier of FERRY_PIERS) {
      const deck = pier[0];
      const top = ferryPierSurface(deck.x, deck.z, terrain, WATER_LEVEL);
      expect(top - WATER_LEVEL).toBeCloseTo(FERRY_PIER_DECK_ABOVE_WATER, 6);
      expect(groundHeight(deck.x, deck.z, WORLD_SEED)).toBeCloseTo(top, 6);
      // its outer half stands in the water, over the sea bed
      const out = {
        x: deck.x + Math.sin(deck.rot) * deck.hl * 0.9,
        z: deck.z + Math.cos(deck.rot) * deck.hl * 0.9,
      };
      expect(terrain(out.x, out.z)).toBeLessThan(WATER_LEVEL - 1);
      expect(onFerryPier(out.x, out.z, terrain)).toBe(true);
    }
    // the surface list is the plank-built piers, then the Wyrmwatch cliff harbor's
    // own decks (drawn by its Blender model, render/wyrmwatch_harbor.ts), then the
    // Wickharbor ferry wharf's (render/wickharbor_wharf.ts)
    expect(FERRY_PIER_DECKS).toEqual([
      ...FERRY_PIERS.flat(),
      ...WYRMWATCH_HARBOR_DECKS,
      ...WICKHARBOR_WHARF_DECKS,
    ]);
    // nowhere else
    expect(ferryPierSurface(0, 0, terrain, WATER_LEVEL)).toBe(Number.NEGATIVE_INFINITY);
    expect(ferryPierSurface(-501, 1600, terrain, WATER_LEVEL)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('draws each pier as its own local meshes, pier-sized bounds', () => {
    const group = buildFerryPiers(WORLD_SEED);
    expect(group.children).toHaveLength(FERRY_PIERS.length);
    group.children.forEach((pier, i) => {
      const meshes = pier.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
      expect(meshes.length).toBeGreaterThan(0);
      const deck = FERRY_PIERS[i][0];
      for (const mesh of meshes) {
        // the mesh origin sits on its pier, and its bounds hug it
        expect(Math.hypot(mesh.position.x - deck.x, mesh.position.z - deck.z)).toBeLessThan(15);
        expect(mesh.geometry.boundingSphere?.radius ?? Infinity).toBeLessThan(30);
      }
    });
  });
});
