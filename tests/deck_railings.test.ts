// The shared plank-walkway builder (src/render/deck_render.ts) rails every
// deck edge over the deck's whole length. Where two decks JOIN (the Palmreach
// lagoon boardwalk meeting its pier at a T, the jungle-pool stair running into
// its platform, the harbor stairs landing on the boardwalk) that laid a fence
// straight across the walkway the player is meant to walk: at world
// (-309, 947) the boardwalk's rails ran across the mouth of the pier.
//
// The rule pinned here: a rail post never stands on ANOTHER deck of the same
// build batch, and dropping one breaks the rail run rather than stretching a
// bar across the junction. Every other rail is untouched.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildDeckWood, deckRailRuns } from '../src/render/deck_render';
import { GALE_HARBOR_DECKS, type GaleDeckDef } from '../src/sim/gale_harbor';
import { REACH_DECKS } from '../src/sim/reach_decks';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';

const SEED = 20061;
// the lagoon sits on level shore: a flat world keeps the decks level, so the
// rails under test are the railAll runs, not stair handrails
const FLAT_GROUND = 2;
const flat = (): number => FLAT_GROUND;

interface RailPost {
  x: number;
  z: number;
}

/** Rail posts are the only 0.14 x 1.06 x 0.14 boxes the builder emits. */
function railPosts(geoms: readonly THREE.BufferGeometry[]): RailPost[] {
  const found: RailPost[] = [];
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  for (const g of geoms) {
    g.computeBoundingBox();
    const bb = g.boundingBox;
    if (!bb) continue;
    bb.getSize(size);
    if (Math.abs(size.x - 0.14) > 1e-3) continue;
    if (Math.abs(size.z - 0.14) > 1e-3) continue;
    if (Math.abs(size.y - 1.06) > 1e-3) continue;
    bb.getCenter(center);
    found.push({ x: center.x, z: center.z });
  }
  return found;
}

/** Point in a deck's walkable rectangle (rotated rect, the groundHeight one). */
function onDeck(deck: GaleDeckDef, x: number, z: number): boolean {
  const dx = x - deck.x;
  const dz = z - deck.z;
  const dirx = Math.sin(deck.rot);
  const dirz = Math.cos(deck.rot);
  const along = dx * dirx + dz * dirz;
  const across = dx * dirz - dz * dirx;
  return Math.abs(along) <= deck.hl && Math.abs(across) <= deck.hw;
}

function straddling(decks: readonly GaleDeckDef[], posts: readonly RailPost[]): string[] {
  return posts
    .filter((p) => decks.filter((d) => onDeck(d, p.x, p.z)).length > 1)
    .map((p) => `rail post@${p.x.toFixed(2)},${p.z.toFixed(2)}`);
}

const key = (p: RailPost): string => `${p.x.toFixed(4)},${p.z.toFixed(4)}`;

describe('deck railings at walkway junctions', () => {
  it('stands no rail post on a neighbouring deck of the same batch', () => {
    const { posts } = buildDeckWood(REACH_DECKS, flat, 0, { railAll: true });
    expect(straddling(REACH_DECKS, railPosts(posts))).toEqual([]);
  });

  it('leaves the lagoon pier railed on both long edges out over the water', () => {
    const pier = REACH_DECKS[3];
    const { posts } = buildDeckWood(REACH_DECKS, flat, 0, { railAll: true });
    const seaward = railPosts(posts).filter((p) => p.x > -300 && onDeck(pier, p.x, p.z));
    const north = seaward.filter((p) => p.z > pier.z);
    const south = seaward.filter((p) => p.z < pier.z);
    expect(north.length, 'north edge rail posts').toBeGreaterThanOrEqual(8);
    expect(south.length, 'south edge rail posts').toBeGreaterThanOrEqual(8);
  });

  it('rails a lone deck exactly as it rails it inside the batch', () => {
    // the Emerald Run bridge touches no other deck: batch or alone, same rails
    const bridge = REACH_DECKS[0];
    const alone = railPosts(buildDeckWood([bridge], flat, 0, { railAll: true }).posts);
    const inBatch = railPosts(buildDeckWood(REACH_DECKS, flat, 0, { railAll: true }).posts).filter(
      (p) => onDeck(bridge, p.x, p.z),
    );
    expect(alone.length, 'the lone bridge is fully railed').toBeGreaterThanOrEqual(20);
    expect(inBatch.map(key).sort()).toEqual(alone.map(key).sort());
  });

  it('ends the rail run at the junction instead of spanning it', () => {
    const boardwalk = REACH_DECKS[2];
    const pier = REACH_DECKS[3];
    for (const side of [1, -1]) {
      const runs = deckRailRuns(boardwalk, side, REACH_DECKS);
      expect(runs.length, `edge ${side} splits at the pier mouth`).toBeGreaterThanOrEqual(2);
      expect(runs.flat().filter((p) => onDeck(pier, p.x, p.z))).toEqual([]);
      for (const run of runs) {
        for (let i = 0; i + 1 < run.length; i++) {
          const gap = run[i + 1].along - run[i].along;
          expect(gap, `gap inside a rail run on edge ${side}`).toBeLessThan(1.5);
        }
      }
    }
  });

  it('draws no rail bar stretched across the junction gap', () => {
    // the lagoon pair is axis aligned, so a rail bar's bounding box IS its span
    const { posts } = buildDeckWood([REACH_DECKS[2], REACH_DECKS[3]], flat, 0, { railAll: true });
    const size = new THREE.Vector3();
    const spans: number[] = [];
    for (const g of posts) {
      g.computeBoundingBox();
      const bb = g.boundingBox;
      if (!bb) continue;
      bb.getSize(size);
      if (Math.abs(size.y - 0.1) > 1e-6) continue; // the two flat rail bars
      spans.push(Math.max(size.x, size.z));
    }
    expect(spans.length, 'the lagoon decks keep their rail bars').toBeGreaterThanOrEqual(20);
    expect(Math.max(...spans), 'longest rail bar').toBeLessThan(1.5);
  });

  it('keeps the harbor stair handrails, none of them on the boardwalk', () => {
    const terrain = (x: number, z: number): number => terrainHeight(x, z, SEED);
    const { posts } = buildDeckWood(GALE_HARBOR_DECKS, terrain, WATER_LEVEL, { bollards: true });
    const rails = railPosts(posts);
    expect(rails.length, 'the bluff stairs keep their handrails').toBeGreaterThanOrEqual(12);
    expect(straddling(GALE_HARBOR_DECKS, rails)).toEqual([]);
  });
});
