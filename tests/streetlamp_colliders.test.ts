import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  isBlocked,
  MANTLE_REACH,
  queryOpenWorldColliders,
  resolveMovement,
  resolvePosition,
  streetlampPlacements,
  supportHeightAt,
} from '../src/sim/colliders';
import { BUILTIN_WORLD, getActiveWorldContent } from '../src/sim/data';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import type { PlacedStreetlamp } from '../src/sim/streetlamp_layout';
import {
  STREETLAMP_COLLIDER_BAND,
  STREETLAMP_COLLIDER_RADIUS,
  STREETLAMP_FIXTURE_HEIGHT,
  STREETLAMP_STYLE_BY_ZONE,
  type StreetlampStyleId,
} from '../src/sim/streetlamp_style';
import { roadDistance } from '../src/sim/world';

// A streetlamp is a solid post, not a decal painted on the road: you cannot
// walk into one, through one, or over one. These cases drive the SHIPPED world
// (src/sim/colliders.ts plants a post on every site src/sim/streetlamp_layout.ts
// lays out) rather than a hand-built fixture, because the defect this guards
// against is the two halves disagreeing about where a lamp is.

const SEED = 0;
const ROOT = path.join(__dirname, '..');
const MOVED = 1e-3;

/** Did resolvePosition have to push a body standing at (x, z) somewhere else? */
function pushedOut(x: number, z: number, r = PLAYER_BODY_RADIUS): boolean {
  const resolved = resolvePosition(SEED, x, z, r);
  return Math.abs(resolved.x - x) > MOVED || Math.abs(resolved.z - z) > MOVED;
}

/** A point `d` yards from a lamp along `angle`. */
function around(lamp: PlacedStreetlamp, angle: number, d: number): { x: number; z: number } {
  return { x: lamp.x + Math.sin(angle) * d, z: lamp.z + Math.cos(angle) * d };
}

/**
 * The lamps that share their spot with an authored NPC (or a graveyard anchor,
 * where a Spirit Healer is spawned at runtime) and therefore keep their mesh
 * and lose their post.
 *
 * Derived from the CONTENT, never from whether a collider turned out to be
 * there: the point of the cases below is to decide that question, so a skip
 * predicate that asked the collider would make every one of them tautological.
 */
function sceneryLamps(): PlacedStreetlamp[] {
  const content = getActiveWorldContent();
  const spots: { x: number; z: number }[] = [];
  for (const npc of Object.values(content.npcs)) {
    const pos = (npc as { pos?: { x: number; z: number } }).pos;
    if (pos) spots.push(pos);
  }
  for (const g of content.services?.graveyards ?? []) spots.push({ x: g.x, z: g.z });
  return streetlampPlacements(SEED).filter((lamp) =>
    spots.some(
      (spot) =>
        Math.hypot(spot.x - lamp.x, spot.z - lamp.z) < STREETLAMP_COLLIDER_RADIUS[lamp.style] + 0.4,
    ),
  );
}

/** Every lamp that should carry a post, i.e. all of them but the scenery few. */
function solidLamps(): PlacedStreetlamp[] {
  const scenery = new Set(sceneryLamps());
  return streetlampPlacements(SEED).filter((lamp) => !scenery.has(lamp));
}

/** Independent distance from a point to the shipped raw authored road chords. */
function rawAuthoredRoadDistance(x: number, z: number): number {
  let nearest = Infinity;
  for (const road of BUILTIN_WORLD.roads) {
    for (let i = 0; i + 1 < road.length; i++) {
      const a = road[i];
      const b = road[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lengthSq = dx * dx + dz * dz;
      const projection = lengthSq > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / lengthSq : 0;
      if (projection <= 0) nearest = Math.min(nearest, Math.hypot(x - a.x, z - a.z));
      else if (projection >= 1) nearest = Math.min(nearest, Math.hypot(x - b.x, z - b.z));
      else {
        const cross = Math.abs(dx * (a.z - z) - (a.x - x) * dz);
        nearest = Math.min(nearest, cross / Math.sqrt(lengthSq));
      }
    }
  }
  return nearest;
}

describe('streetlamp colliders (you cannot walk into a lamp post)', () => {
  const lamps = () => streetlampPlacements(SEED);

  it('plants a post on every lamp the world draws', () => {
    const placements = lamps();
    expect(placements.length).toBeGreaterThan(200);
    // Every placement carries the fixture identity its collider was sized from,
    // and every style in the table is a real style with a measured radius.
    for (const lamp of placements) {
      expect(STREETLAMP_COLLIDER_RADIUS[lamp.style], lamp.style).toBeGreaterThan(0);
    }
  });

  it('blocks a body standing where the post stands, at EVERY lamp on the network', () => {
    // Whole network, no sampling and no skipping: the one lamp the NPC rule
    // exempts is named by content, so "every other lamp is solid" is a claim
    // this can actually fail. Before the posts existed, all 200-plus of these
    // were walk-through.
    const solid = solidLamps();
    const walkThrough = solid.filter((lamp) => !pushedOut(lamp.x, lamp.z));
    expect(walkThrough.map((l) => `${l.style} @ ${l.x},${l.z}`)).toEqual([]);
    expect(solid.length).toBeGreaterThan(200);
    // and the exempt set is small and deliberate, not half the world quietly
    // falling out of the check above
    expect(sceneryLamps().length).toBeLessThan(5);
  });

  it('stops a body short of the post, from every bearing', () => {
    // Eight approaches per lamp over a sample of the network: a circle collider
    // has to hold from any bearing, not just the one a single case picks. Two
    // claims per walk, and both are ones a missing post fails:
    //  - the body never ends up PAST the axis (it did not walk through), and
    //  - it never ends up nearer the axis than contact (it did not get inside).
    const sample = solidLamps().filter((_, i) => i % 17 === 0);
    expect(sample.length).toBeGreaterThan(10);
    let approaches = 0;
    for (const lamp of sample) {
      const r = STREETLAMP_COLLIDER_RADIUS[lamp.style];
      const contact = r + PLAYER_BODY_RADIUS;
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const start = around(lamp, angle, contact + 4);
        // Aim at the far side, so nothing but the post can stop the walk.
        const target = around(lamp, angle + Math.PI, contact + 4);
        const end = resolveMovement(SEED, start.x, start.z, target.x, target.z, PLAYER_BODY_RADIUS);
        const where = `${lamp.style} at ${lamp.x},${lamp.z} bearing ${i}`;
        // Signed distance along the direction of travel, from the lamp axis.
        const along =
          (end.x - lamp.x) * Math.sin(angle + Math.PI) +
          (end.z - lamp.z) * Math.cos(angle + Math.PI);
        expect(along, `walked through the lamp: ${where}`).toBeLessThan(MOVED);
        expect(
          Math.hypot(end.x - lamp.x, end.z - lamp.z),
          `ended up inside the lamp: ${where}`,
          // A hair of slack: the sweep stops on a 0.2 yd step boundary, and a
          // slide along a neighbouring collider can shave the contact circle.
        ).toBeGreaterThan(contact - 0.25);
        approaches++;
      }
    }
    expect(approaches).toBeGreaterThan(80);
  });

  it('cannot be tunnelled by a long fast move straight across it', () => {
    // The distinct failure from walking into one: a single big step over the
    // post, the shape a mount charge or a lag catch-up takes. resolveMovement
    // sweeps in 0.2 yd substeps, and this is what pins that it still does.
    const sample = solidLamps().filter((_, i) => i % 31 === 0);
    let crossings = 0;
    for (const lamp of sample) {
      const contact = STREETLAMP_COLLIDER_RADIUS[lamp.style] + PLAYER_BODY_RADIUS;
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        const start = around(lamp, angle, 40);
        const target = around(lamp, angle + Math.PI, 40);
        const end = resolveMovement(SEED, start.x, start.z, target.x, target.z, PLAYER_BODY_RADIUS);
        const along =
          (end.x - lamp.x) * Math.sin(angle + Math.PI) +
          (end.z - lamp.z) * Math.cos(angle + Math.PI);
        expect(along, `tunnelled the lamp at ${lamp.x},${lamp.z} bearing ${i}`).toBeLessThan(
          contact,
        );
        crossings++;
      }
    }
    expect(crossings).toBeGreaterThan(20);
  });

  it('is full height: a jump does not clear a lamp and nothing stands on one', () => {
    // A five-and-a-half yard post is not a crate. It carries no moveTopY, so an
    // airborne body is walled exactly like a grounded one, and supportHeightAt
    // never offers its top as a surface to land on.
    const sample = solidLamps().filter((_, i) => i % 29 === 0);
    let checked = 0;
    for (const lamp of sample) {
      const airborne = { y: lamp.y + 2.5, lift: MANTLE_REACH };
      const resolved = resolvePosition(
        SEED,
        lamp.x,
        lamp.z,
        PLAYER_BODY_RADIUS,
        false,
        undefined,
        airborne,
      );
      expect(
        Math.abs(resolved.x - lamp.x) > MOVED || Math.abs(resolved.z - lamp.z) > MOVED,
        `jumping into the lamp at ${lamp.x},${lamp.z}`,
      ).toBe(true);
      expect(isBlocked(SEED, lamp.x, lamp.z, PLAYER_BODY_RADIUS)).toBe(true);
      const support = supportHeightAt(
        SEED,
        lamp.x,
        lamp.z,
        PLAYER_BODY_RADIUS,
        lamp.y + STREETLAMP_FIXTURE_HEIGHT + MANTLE_REACH,
      );
      // -Infinity, or whatever the ground furniture beside it offers; never the
      // lamp's own head.
      expect(support).toBeLessThan(lamp.y + STREETLAMP_COLLIDER_BAND);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('sizes each post from its own fixture, and registers it in the grid', () => {
    // The collider actually reaching the broadphase is the thing the physics
    // solver sees; a post only in the layout list is a lamp you walk through.
    const sample = solidLamps().filter((_, i) => i % 23 === 0);
    let matched = 0;
    for (const lamp of sample) {
      const r = STREETLAMP_COLLIDER_RADIUS[lamp.style];
      const found = queryOpenWorldColliders(
        SEED,
        lamp.x - 0.01,
        lamp.z - 0.01,
        lamp.x + 0.01,
        lamp.z + 0.01,
        [],
      ).filter(
        (c) =>
          c.type === 'circle' &&
          Math.abs(c.x - lamp.x) < MOVED &&
          Math.abs(c.z - lamp.z) < MOVED &&
          Math.abs(c.r - r) < MOVED,
      );
      expect(found, `post for the ${lamp.style} at ${lamp.x},${lamp.z}`).toHaveLength(1);
      const post = found[0];
      // Full height for movement, real silhouette for sight.
      expect(post.moveTopY).toBeUndefined();
      expect(post.standable).toBeUndefined();
      expect(post.cameraTopY).toBeCloseTo(lamp.y + STREETLAMP_FIXTURE_HEIGHT, 5);
      matched++;
    }
    expect(matched).toBeGreaterThan(5);
  });

  it('keeps every lamp collider clear of the painted road', () => {
    // The posts stand in a 3.0 to 5.6 yard clearance band beside the painted
    // track, and the widest of them is ~1.08. If a collider ever grew enough to
    // reach the road centre, every lamp on the network would narrow the road it
    // is supposed to light, which is the regression this pins.
    const widest = Math.max(...Object.values(STREETLAMP_COLLIDER_RADIUS));
    expect(widest + PLAYER_BODY_RADIUS).toBeLessThan(3.0);
    // Bind that arithmetic to every shipped site without conflating a nearby
    // building or prop collider with the lamp this test owns.
    for (const lamp of solidLamps()) {
      const clear = roadDistance(lamp.x, lamp.z);
      expect(
        clear,
        `painted-road clearance for the ${lamp.style} at ${lamp.x},${lamp.z}`,
      ).toBeGreaterThan(STREETLAMP_COLLIDER_RADIUS[lamp.style] + PLAYER_BODY_RADIUS);
    }
  });

  it('keeps every shipped lamp collider clear of every raw authored road chord', () => {
    const collisions: string[] = [];
    for (const lamp of solidLamps()) {
      const required = STREETLAMP_COLLIDER_RADIUS[lamp.style] + PLAYER_BODY_RADIUS;
      const clear = rawAuthoredRoadDistance(lamp.x, lamp.z);
      if (clear <= required) {
        collisions.push(`${lamp.style} @ ${lamp.x},${lamp.z}: ${clear} <= ${required}`);
      }
    }
    expect(collisions).toEqual([]);
  });

  it('keeps a lamp sharing an NPC spot as scenery, mesh and all', () => {
    // Same rule as the graveyard headstones: town furniture never walls off
    // someone you have to walk up to and talk to. The lamp is still drawn, so
    // the network does not go dark at the spot; only the post is skipped.
    const shared = sceneryLamps();
    // The world really does have such a lamp (a gate captain's post), so this
    // is not a vacuous pass.
    expect(shared.length).toBeGreaterThan(0);
    for (const lamp of shared) {
      // still drawn: it is in the list the renderer instances from
      expect(streetlampPlacements(SEED)).toContain(lamp);
      // ...and genuinely walk-through, which is what makes the "every OTHER
      // lamp is solid" case above a real partition rather than a filter.
      expect(pushedOut(lamp.x, lamp.z), `${lamp.style} at ${lamp.x},${lamp.z}`).toBe(false);
      const found = queryOpenWorldColliders(
        SEED,
        lamp.x - 0.01,
        lamp.z - 0.01,
        lamp.x + 0.01,
        lamp.z + 0.01,
        [],
      ).filter(
        (c) =>
          c.type === 'circle' &&
          Math.abs(c.x - lamp.x) < MOVED &&
          Math.abs(c.z - lamp.z) < MOVED &&
          Math.abs(c.r - STREETLAMP_COLLIDER_RADIUS[lamp.style]) < MOVED,
      );
      expect(found, `${lamp.style} at ${lamp.x},${lamp.z} stays scenery`).toHaveLength(0);
    }
  });
});

describe('streetlamp collider radii match the shipped fixtures', () => {
  it('covers every style the world can place', () => {
    for (const style of Object.values(STREETLAMP_STYLE_BY_ZONE)) {
      expect(STREETLAMP_COLLIDER_RADIUS[style], style).toBeGreaterThan(0);
    }
    // and the world exercises the whole table, so no row is dead weight nobody
    // would notice going stale
    const used = new Set(streetlampPlacements(SEED).map((lamp) => lamp.style));
    expect([...used].sort()).toEqual(Object.keys(STREETLAMP_COLLIDER_RADIUS).sort());
  });

  it('measures each radius off its own GLB, at the scale the renderer places it', async () => {
    // The pin behind the table in streetlamp_style.ts. A hand-guessed radius
    // drifts from the silhouette and the lamp becomes a ghost (too small: you
    // clip into the post) or an invisible wall (too large: you stop a yard
    // short of a thin pole). Re-measured from the shipped bytes here, so a
    // re-exported fixture cannot quietly leave its collider behind.
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    // The normalization src/render/streetlamp_assets.ts applies when it places
    // a fixture, read from that file rather than copied, so a retune there
    // cannot leave these numbers silently stale.
    const assets = readFileSync(path.join(ROOT, 'src/render/streetlamp_assets.ts'), 'utf8');
    const maxFootprint = Number(/const MAX_FOOTPRINT = ([\d.]+)/.exec(assets)?.[1]);
    expect(maxFootprint, 'streetlamp_assets MAX_FOOTPRINT').toBeGreaterThan(0);

    for (const style of Object.keys(STREETLAMP_COLLIDER_RADIUS) as StreetlampStyleId[]) {
      const document = await io.read(
        path.join(ROOT, 'public', `models/props/streetlamp_${style}.glb`),
      );
      const points = worldPositions(document);
      expect(points.length, style).toBeGreaterThan(0);
      const bounds = boundsOf(points);
      // uniform scale to the shipped height, then the radial squeeze that keeps
      // a fixture's footprint inside MAX_FOOTPRINT
      const uniform = STREETLAMP_FIXTURE_HEIGHT / (bounds.maxY - bounds.minY);
      const radial = Math.min(
        1,
        maxFootprint /
          Math.max(
            (bounds.maxX - bounds.minX) * uniform,
            (bounds.maxZ - bounds.minZ) * uniform,
            1e-4,
          ),
      );
      const centreX = (bounds.minX + bounds.maxX) * 0.5;
      const centreZ = (bounds.minZ + bounds.maxZ) * 0.5;
      let measured = 0;
      for (const [x, y, z] of points) {
        if ((y - bounds.minY) * uniform > STREETLAMP_COLLIDER_BAND) continue;
        measured = Math.max(
          measured,
          Math.hypot((x - centreX) * uniform * radial, (z - centreZ) * uniform * radial),
        );
      }
      const declared = STREETLAMP_COLLIDER_RADIUS[style];
      // Covers the fixture...
      expect(declared, `${style} collider covers its post`).toBeGreaterThanOrEqual(measured);
      // ...without an invisible skirt around it (one centimetre of rounding).
      expect(declared, `${style} collider is not oversized`).toBeLessThan(measured + 0.01);
    }
  });
});

/** Every mesh vertex of a GLB in scene space. */
function worldPositions(document: Awaited<ReturnType<NodeIO['read']>>): [number, number, number][] {
  const out: [number, number, number][] = [];
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  const walk = (node: ReturnType<typeof scene.listChildren>[number], parent: number[]): void => {
    const local = multiply(parent, node.getMatrix() as number[]);
    const mesh = node.getMesh();
    if (mesh) {
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION');
        if (!position) continue;
        for (let i = 0; i < position.getCount(); i++) {
          out.push(transform(local, position.getElement(i, [0, 0, 0]) as number[]));
        }
      }
    }
    for (const child of node.listChildren()) walk(child, local);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const node of scene.listChildren()) walk(node, identity);
  return out;
}

/** Column-major 4x4 multiply, matching glTF's node matrices. */
function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

function transform(m: number[], v: number[]): [number, number, number] {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];
}

function boundsOf(points: readonly [number, number, number][]) {
  const b = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };
  for (const [x, y, z] of points) {
    b.minX = Math.min(b.minX, x);
    b.maxX = Math.max(b.maxX, x);
    b.minY = Math.min(b.minY, y);
    b.maxY = Math.max(b.maxY, y);
    b.minZ = Math.min(b.minZ, z);
    b.maxZ = Math.max(b.maxZ, z);
  }
  return b;
}
