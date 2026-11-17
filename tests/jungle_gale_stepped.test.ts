// Palm Reach and Galecrest dressing as stepped builds (jungle_features.ts,
// gale_features.ts, driven across idle slices by zone_feature_builds.ts): the
// same view in one call or in pieces, cut at every model, part and family.
// The GLB loader is replaced by one-box stand-ins (the jungle cells pattern),
// so the palms, props, banyans and tower drums all take part.
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildDeckWood, buildDeckWoodSteps } from '../src/render/deck_render';
import { buildGaleFeatures, buildGaleFeaturesSteps } from '../src/render/gale_features';
import {
  buildJungleFeatures,
  buildJungleFeaturesSteps,
  reachCoconutSpots,
  reachCoconutSpotsSteps,
} from '../src/render/jungle_features';
import { PALMREACH_PROPS } from '../src/sim/content/palmreach';
import { REACH_DECKS } from '../src/sim/reach_decks';
import { reachPalmSpots, terrainHeight, WATER_LEVEL } from '../src/sim/world';

const preload = vi.hoisted(() => ({ tasks: [] as (() => Promise<unknown>)[] }));
vi.mock('../src/render/assets/preload', () => ({
  registerDeferredPreload: (task: () => Promise<unknown>) => preload.tasks.push(task),
}));
vi.mock('../src/render/assets/loader', () => ({
  loadGltf: async (url: string) => {
    const scene = new THREE.Group();
    const material = new THREE.MeshStandardMaterial();
    material.name = url;
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    return { scene };
  },
}));
beforeAll(async () => {
  await Promise.all(preload.tasks.map((task) => task()));
});

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
const meshesUnder = (group: THREE.Object3D): number => {
  let n = 0;
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  return n;
};

describe('zone dressing as stepped builds', () => {
  it('builds the same Palm Reach stepped as in one call, in many pieces', () => {
    const whole = buildJungleFeatures(42);
    const { value, pieces } = stepped(buildJungleFeaturesSteps(42));
    expect(meshesUnder(value.group)).toBeGreaterThan(5);
    expect(shape(value.group as unknown as Node)).toEqual(shape(whole.group as unknown as Node));
    // With one-part stand-ins: a piece per palm variant (three) and per baked
    // part (three), per palm of the coconut placement, per prop part
    // (coconuts, lilies, reeds), per walkway deck, per banyan, and at the
    // walkways, the banyans and the geometry LOD.
    const banyans = PALMREACH_PROPS.greatTrees?.length ?? 0;
    const palms = reachPalmSpots(42).length;
    expect(banyans).toBeGreaterThan(0);
    expect(palms).toBeGreaterThan(0);
    expect(pieces).toBe(3 + 3 + palms + 3 + REACH_DECKS.length + banyans + 3);
    whole.dispose();
    value.dispose();
  });

  it('builds the same Galecrest stepped as in one call, one piece per tower drum at least', () => {
    const whole = buildGaleFeatures(42);
    const { value, pieces } = stepped(buildGaleFeaturesSteps(42));
    expect(meshesUnder(value.group)).toBeGreaterThan(5);
    expect(shape(value.group as unknown as Node)).toEqual(shape(whole.group as unknown as Node));
    expect(value.glowLights.length).toBe(whole.glowLights.length);
    // five drums, the stair in runs of treads, the beam, the wrecks and the
    // pier with one piece per wharf deck
    expect(pieces).toBeGreaterThanOrEqual(5 + 9 + 3);
  });

  it('lays the walkway decks one per piece, the same wood as in one call', () => {
    const height = (x: number, z: number) => terrainHeight(x, z, 42);
    const whole = buildDeckWood(REACH_DECKS, height, WATER_LEVEL, { railAll: true });
    const { value, pieces } = stepped(
      buildDeckWoodSteps(REACH_DECKS, height, WATER_LEVEL, { railAll: true }),
    );
    expect(pieces).toBe(REACH_DECKS.length);
    expect(value.planks.length).toBe(whole.planks.length);
    expect(value.posts.length).toBe(whole.posts.length);
    expect(Array.from(value.planks[0].getAttribute('position').array)).toEqual(
      Array.from(whole.planks[0].getAttribute('position').array),
    );
  });

  it('places the coconuts one palm per piece, the same spots as in one call', () => {
    const { value, pieces } = stepped(reachCoconutSpotsSteps(42));
    expect(value).toEqual(reachCoconutSpots(42));
    expect(value.length).toBeGreaterThan(0);
    expect(pieces).toBe(reachPalmSpots(42).length);
  });
});
