import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Document, type Node as GltfNode, getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  sourceFingerprint,
  WYRMWATCH_HARBOR_ASSET,
} from '../scripts/assets/wyrmwatch_harbor/build.mjs';
import {
  WYRMWATCH_LAYOUT_FILE,
  wyrmwatchHarborLayout,
} from '../scripts/assets/wyrmwatch_harbor/layout';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import {
  WYRMWATCH_HARBOR_CRITICAL_PARTS,
  WYRMWATCH_HARBOR_OPTIONAL_PARTS,
  WYRMWATCH_HARBOR_TRIM_PARTS,
  WYRMWATCH_PATH_STONE_PARTS,
  WYRMWATCH_PATH_STONE_TOP,
} from '../src/render/wyrmwatch_harbor_core';
import {
  WYRMWATCH_HARBOR_DECKS,
  WYRMWATCH_HARBOR_ORIGIN,
  WYRMWATCH_RAIL_HEIGHT,
  WYRMWATCH_TOP_ABOVE_WATER,
} from '../src/sim/content/wyrmwatch_harbor';
import {
  HARBOR_HOUSE,
  HARBOR_HOUSE_FLOOR_ABOVE_WATER,
} from '../src/sim/content/wyrmwatch_harbor_house';

// The shipped Wyrmwatch cliff harbor GLB (public/models/props/wyrmwatch_harbor.glb), built in
// Blender from the sim's own layout (scripts/assets/wyrmwatch_harbor/layout.json, exported from
// src/sim/content/wyrmwatch_harbor.ts with the terrain under it) and shipped by build.mjs. Pins
// the bytes, the source fingerprint, the layout's freshness against the sim and the terrain,
// the named tier parts the runtime keeps or sheds, the five texture-free materials, the
// triangle budget, and the model's stamped numbers against the sim. Re-pin the sha256 and size
// literals only with a re-export.

const ROOT = path.join(__dirname, '..');
const GLB = path.join(ROOT, WYRMWATCH_HARBOR_ASSET.target);
const SHIPPED_SHA256 = 'cf8f016ea98ecc42dd8cb97e38e410d4fc09881092ece79611215211f7423fe6';
const SHIPPED_BYTES = 463408;
/** Triangles per named part, from the Blender build report. */
const TRIANGLES: Record<string, number> = {
  QuayDecks: 2052,
  StairFlights: 1272,
  Landings: 804,
  Railings: 1728,
  HarborGate: 968,
  Lanterns: 1832,
  Cargo: 756,
  HarborTrim: 2236,
  HarborClutter: 1364,
  HouseFrame: 1956,
  HouseWallNorth: 3288,
  HouseWallSouth: 2316,
  HouseWallEast: 1948,
  HouseWallWest: 2212,
  HouseRoof: 2398,
  HouseFurnishings: 3052,
  HouseClutter: 840,
  PathStoneA: 44,
  PathStoneB: 38,
  PathStoneC: 50,
};
/** The Harbormaster's House parts (tests/wyrmwatch_harbor_house.test.ts pins its sim side). */
const HOUSE_PARTS = [
  'HouseFrame',
  'HouseWallNorth',
  'HouseWallSouth',
  'HouseWallEast',
  'HouseWallWest',
  'HouseRoof',
  'HouseFurnishings',
  'HouseClutter',
];
/** The player model, pivot to crown (HUMANOID_H in render/characters/manifest.ts). */
const PLAYER_H = 2.6;

let doc: Document;

function node(name: string): GltfNode {
  const found = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === name);
  if (!found) throw new Error(`no node ${name}`);
  return found;
}

function trianglesUnder(n: GltfNode): number {
  let total = 0;
  const walk = (m: GltfNode): void => {
    for (const prim of m.getMesh()?.listPrimitives() ?? []) {
      total += (prim.getIndices()?.getCount() ?? 0) / 3;
    }
    for (const child of m.listChildren()) walk(child);
  };
  walk(n);
  return total;
}

interface HarborExtras {
  origin: number[];
  tiers: Record<string, string[]>;
  pathStones: string[];
  stoneTop: number;
  decks: Record<string, number[]>;
  railHeight: number;
  gateTop: number;
  house: { floor: number; wallTop: number; ridge: number; door: number[] };
}

function extras(): HarborExtras {
  return (node('WyrmwatchHarbor_ROOT').getExtras() as { wyrmwatchHarbor: HarborExtras })
    .wyrmwatchHarbor;
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  doc = await io.read(GLB);
});

describe('wyrmwatch cliff harbor GLB', () => {
  it('ships the pinned bytes, in the media manifest', () => {
    const bytes = readFileSync(GLB);
    expect(bytes.length).toBe(SHIPPED_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(SHIPPED_SHA256);
    expect(bytes.toString('latin1')).toContain('EXT_meshopt_compression');
    expect(MEDIA_ASSETS['models/props/wyrmwatch_harbor.glb']).toMatch(
      /^\/media\/models\/props\/wyrmwatch_harbor\.[0-9a-f]{12}\.glb$/,
    );
  });

  it('is credited as original project art', () => {
    const credits = readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');
    expect(credits).toContain('Wyrmwatch cliff harbor (`public/models/props/wyrmwatch_harbor.glb`');
  });

  it('carries the live source fingerprint', () => {
    expect(doc.getRoot().getExtras()).toMatchObject({
      authoring: 'Blender',
      sourceFingerprint: sourceFingerprint(),
    });
  });

  it('was built from the live layout: the sim content and the terrain under it', () => {
    const committed = JSON.parse(readFileSync(path.join(ROOT, WYRMWATCH_LAYOUT_FILE), 'utf8'));
    // the same decks, rails, props, path and ground heights the sim has today (a moved
    // deck or a reshaped cliff means re-exporting the model so no pile floats)
    expect(committed).toEqual(JSON.parse(JSON.stringify(wyrmwatchHarborLayout())));
  });

  it('keeps every named part the runtime keeps or sheds, under one root', () => {
    const names = new Set(
      doc
        .getRoot()
        .listNodes()
        .map((n) => n.getName()),
    );
    for (const name of WYRMWATCH_HARBOR_ASSET.requiredNodes)
      expect(names.has(name), name).toBe(true);
    const root = doc.getRoot().listScenes()[0].listChildren();
    expect(root.map((n) => n.getName())).toEqual(['WyrmwatchHarbor_ROOT']);
    for (const part of [
      ...WYRMWATCH_HARBOR_CRITICAL_PARTS,
      ...WYRMWATCH_HARBOR_TRIM_PARTS,
      ...WYRMWATCH_HARBOR_OPTIONAL_PARTS,
      ...WYRMWATCH_PATH_STONE_PARTS,
    ]) {
      expect(node(part).getParentNode()?.getName(), part).toBe('WyrmwatchHarbor_ROOT');
      expect(trianglesUnder(node(part)), part).toBeGreaterThan(0);
    }
    expect(extras().tiers).toEqual({
      low: [...WYRMWATCH_HARBOR_CRITICAL_PARTS],
      medium: [...WYRMWATCH_HARBOR_TRIM_PARTS],
      high: [...WYRMWATCH_HARBOR_OPTIONAL_PARTS],
    });
    expect(extras().pathStones).toEqual([...WYRMWATCH_PATH_STONE_PARTS]);
  });

  it('shares five texture-free, vertex-coloured materials, and nothing animates', () => {
    const materials = doc.getRoot().listMaterials();
    expect(materials.map((m) => m.getName()).sort()).toEqual(WYRMWATCH_HARBOR_ASSET.materials);
    expect(doc.getRoot().listTextures()).toHaveLength(0);
    expect(doc.getRoot().listSkins()).toHaveLength(0);
    expect(doc.getRoot().listAnimations()).toHaveLength(0);
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        expect(prim.getAttribute('COLOR_0'), mesh.getName()).not.toBeNull();
      }
    }
  });

  it('holds each part to its triangle budget, the low tier well inside it', () => {
    let total = 0;
    for (const [name, count] of Object.entries(TRIANGLES)) {
      expect(trianglesUnder(node(name)), name).toBe(count);
      total += count;
    }
    expect(trianglesUnder(node('WyrmwatchHarbor_ROOT'))).toBe(total);
    // a whole harbor (two quays, a switchback, a gate) and its walk-in house: under 32k in
    // all, the house under 19k of it, the low tier under 28k
    expect(total).toBeLessThan(32000);
    const house = HOUSE_PARTS.reduce((n, p) => n + TRIANGLES[p], 0);
    expect(house).toBeLessThan(19000);
    const low = WYRMWATCH_HARBOR_CRITICAL_PARTS.reduce((n, p) => n + TRIANGLES[p], 0);
    expect(low).toBeLessThan(28000);
  });

  it("stamps the sim's numbers: the origin, the deck heights, the rail and the stones", () => {
    const e = extras();
    expect(e.origin).toEqual([WYRMWATCH_HARBOR_ORIGIN.x, WYRMWATCH_HARBOR_ORIGIN.z]);
    for (const d of WYRMWATCH_HARBOR_DECKS) {
      expect(e.decks[d.id], d.id).toEqual([d.nearAboveWater, d.farAboveWater]);
    }
    expect(e.railHeight).toBe(WYRMWATCH_RAIL_HEIGHT);
    expect(e.stoneTop).toBe(WYRMWATCH_PATH_STONE_TOP);
    // the gate stands generously over the player: more than twice a player's height
    expect(e.gateTop - WYRMWATCH_TOP_ABOVE_WATER).toBeGreaterThan(2 * PLAYER_H);
    // the house: its floor at the quays height, a room more than twice a player tall to
    // the wall plate, a door a player walks through with a yard to spare over the head
    expect(e.house.floor).toBe(HARBOR_HOUSE_FLOOR_ABOVE_WATER);
    expect(e.house.wallTop).toBe(HARBOR_HOUSE.wallTop);
    expect(e.house.ridge).toBe(HARBOR_HOUSE.ridge);
    expect(e.house.door).toEqual([HARBOR_HOUSE.door.width, HARBOR_HOUSE.door.height]);
    expect(e.house.wallTop).toBeGreaterThan(2 * PLAYER_H);
    expect(e.house.door[1]).toBeGreaterThan(PLAYER_H + 1);
  });

  it('sits on the waterline at its origin, its piles running down into the sea bed', () => {
    const scene = doc.getRoot().listScenes()[0];
    expect(scene.listChildren()[0].getTranslation()).toEqual([0, 0, 0]);
    const { min, max } = getBounds(scene);
    // the piles reach below the waterline; the tallest thing is the house's pennant over its
    // ridge (the chimney pots just under it), higher than the gate's crest over the cliff top
    expect(min[1]).toBeLessThan(-1.5);
    expect(min[1]).toBeGreaterThan(-4);
    expect(max[1]).toBeGreaterThan(HARBOR_HOUSE_FLOOR_ABOVE_WATER + HARBOR_HOUSE.ridge + 1.5);
    expect(max[1]).toBeLessThan(HARBOR_HOUSE_FLOOR_ABOVE_WATER + HARBOR_HOUSE.ridge + 3);
    // no timetable, clock or ship state is modelled: no node names one
    for (const n of doc.getRoot().listNodes()) {
      expect(n.getName(), n.getName()).not.toMatch(/timer|clock|schedule|status|depart/i);
    }
  });
});
