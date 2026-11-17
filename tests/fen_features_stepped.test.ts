// The Willowfen dressing as a stepped build (src/render/fen_features.ts,
// driven across idle slices by src/render/zone_feature_builds.ts): the same
// view and the same spots in one call or in pieces, and pieces small enough
// that no one of them is the old one-frame build.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildFenFeatures,
  buildFenFeaturesSteps,
  FEN_XMAX,
  FEN_XMIN,
  FEN_ZMAX,
  FEN_ZMIN,
  fenFeaturesInternalsForTest,
  fenFloraSpots,
  fenFloraSpotsSteps,
  fenRocksSteps,
} from '../src/render/fen_features';
import { ZONE_FEATURE_CELL_SIZE } from '../src/render/gfx';
import { drainBuild } from '../src/render/stepped_build_core';
import { generateDecorationsInBounds } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

/** Drain a stepped build, counting its pieces. */
function stepped<T>(build: Generator<void, T, void>): { value: T; pieces: number } {
  let pieces = 0;
  for (;;) {
    const next = build.next();
    if (next.done) return { value: next.value, pieces };
    pieces++;
  }
}

type Node = { name: string; type: string; children: unknown[] };
function shape(object: Node): unknown {
  return {
    name: object.name,
    type: object.type,
    count: (object as unknown as { count?: number }).count,
    children: (object.children as Node[]).map(shape),
  };
}

const byPosition = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  a.x - b.x || a.z - b.z;

describe('the Willowfen dressing as a stepped build', () => {
  afterEach(() => fenFeaturesInternalsForTest.resetPropScenes());

  it('gathers exactly the one-call rock set in strips', () => {
    for (const seed of [WORLD_SEED, 1, 1337]) {
      const { value, pieces } = stepped(fenRocksSteps(seed));
      const whole = generateDecorationsInBounds(seed, {
        minX: FEN_XMIN,
        maxX: FEN_XMAX,
        minZ: FEN_ZMIN,
        maxZ: FEN_ZMAX,
      }).filter((d) => d.kind === 'rock');
      expect(pieces).toBeGreaterThan(1);
      expect(whole.length).toBeGreaterThan(0);
      expect([...value].sort(byPosition)).toEqual([...whole].sort(byPosition));
    }
  });

  it('places the flora in many small pieces, the wrapper returning the drained spots', () => {
    const { value, pieces } = stepped(fenFloraSpotsSteps(WORLD_SEED));
    expect(value).toEqual(fenFloraSpots(WORLD_SEED));
    // the rock strips plus one piece per patch grid column
    expect(pieces).toBeGreaterThanOrEqual(25);
  });

  it('builds the same cells stepped as in one call, one piece per family cell', () => {
    for (const key of fenFeaturesInternalsForTest.familyKeys) {
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshLambertMaterial()));
      fenFeaturesInternalsForTest.seedPropScene(key, scene);
    }
    const options = { cellSize: ZONE_FEATURE_CELL_SIZE };
    const whole = buildFenFeatures(WORLD_SEED, options);
    const { value, pieces } = stepped(buildFenFeaturesSteps(WORLD_SEED, options));
    expect(value.cullGroups.length).toBeGreaterThan(4);
    expect(shape(value.group as unknown as Node)).toEqual(shape(whole.group as unknown as Node));
    expect(value.cullGroups.map((g) => g.name)).toEqual(whole.cullGroups.map((g) => g.name));
    // every placement piece, then at least one more per family cell
    const placement = stepped(fenFloraSpotsSteps(WORLD_SEED)).pieces;
    expect(pieces).toBeGreaterThanOrEqual(placement + value.cullGroups.length);
    expect(drainBuild(buildFenFeaturesSteps(WORLD_SEED, options)).group.name).toBe('fen-features');
  });
});
