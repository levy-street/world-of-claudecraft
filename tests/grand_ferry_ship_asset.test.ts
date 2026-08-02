// The grand ferry's art-and-collision contract.
//
// The ferry's walkable plan is not authored, it is MEASURED off the shipped
// mesh by scripts/assets/grand_ferry_ship. That buys good-looking art and
// correct collision at the same time, but only while the two still agree, and
// the first version of this boat proved they can silently stop agreeing.
//
// So this suite does not re-list the plan's numbers (that would only check the
// generator against itself). It re-derives them from the geometry the game
// actually loads and fails on any disagreement, then proves the whole artifact
// rebuilds from source byte for byte.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GRAND_FERRY_SHIP_SOURCE_FILES,
  grandFerryShipSourceFingerprint,
} from '../scripts/assets/grand_ferry_ship/source_fingerprint.mjs';
import { verifyPlanAgainstMesh } from '../scripts/assets/grand_ferry_ship/verify.mjs';
import { documentTriangles, glbIO } from '../scripts/assets/lib/glb_geometry.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { type Collider, queryOpenWorldColliders } from '../src/sim/colliders';
import { GRAND_FERRY_SHIP_PLAN } from '../src/sim/grand_ferry_ship_plan.generated';
import { HARBORS } from '../src/sim/harbor_layout';

const REPO_ROOT = path.join(__dirname, '..');
const ASSET_PATH = path.join(REPO_ROOT, 'public/models/props/grand_ferry_ship.glb');
const ART_SOURCE = path.join(
  REPO_ROOT,
  'scripts/assets/grand_ferry_ship/source/grand_ferry_ship_art.glb',
);
const EXPORTER = path.join(
  REPO_ROOT,
  'scripts/assets/grand_ferry_ship/export_grand_ferry_ship.mjs',
);

// Re-mint deliberately (run the exporter, take the reported values) whenever
// the art or the build intent changes. A surprise diff here means the shipped
// boat is not the one this repo builds.
const ASSET_BYTES = 224640;
const ASSET_SHA256 = '1995439f005c88ea9b120b2c1458c8df20dcfd65c0e5d01d6e8df3d717748817';
const ART_SHA256 = '9bfe1c2d385ce636488f01e0b4c31691e3aacbc5ef5b11e25e65e54d5fcf08d6';

async function shippedTriangles(): Promise<number[][][]> {
  const document = await glbIO().read(ASSET_PATH);
  return documentTriangles(document);
}

describe('grand ferry art and collision agree', () => {
  it('measures the shipped mesh and finds the committed plan still describes it', async () => {
    const triangles = await shippedTriangles();
    const { problems, stats } = verifyPlanAgainstMesh(triangles, GRAND_FERRY_SHIP_PLAN, {
      boundsEpsilon: GRAND_FERRY_SHIP_PLAN.measurementEpsilons.optimized,
      surfaceTolerance: 0.25 + GRAND_FERRY_SHIP_PLAN.measurementEpsilons.optimized,
    });
    expect(problems).toEqual([]);
    // Decisive rather than incidental: a plan whose deck had quietly slid off
    // the mesh would report holes, and one that had shrunk to nothing would
    // report almost no supported probes at all.
    expect(stats.holes).toBe(0);
    expect(stats.supported).toBeGreaterThan(1500);
    expect(stats.blocked).toBeGreaterThan(0);
  });

  it('fails the same check when the plan is nudged off the mesh', async () => {
    const triangles = await shippedTriangles();
    // Small enough to look like rounding, large enough to drop a player
    // through the deck: exactly the drift this whole approach exists to catch.
    const drifted = {
      ...GRAND_FERRY_SHIP_PLAN,
      decks: GRAND_FERRY_SHIP_PLAN.decks.map((deck) => ({ ...deck, y: deck.y + 0.6 })),
    };
    const { problems } = verifyPlanAgainstMesh(triangles, drifted);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).toContain('no deck at the planned height');
  });

  it('fails the same check when a deck section is widened past the hull', async () => {
    const triangles = await shippedTriangles();
    const widened = {
      ...GRAND_FERRY_SHIP_PLAN,
      decks: GRAND_FERRY_SHIP_PLAN.decks.map((deck) => ({ ...deck, hd: deck.hd + 0.8 })),
    };
    const { problems } = verifyPlanAgainstMesh(triangles, widened);
    expect(problems.length).toBeGreaterThan(0);
  });

  it('keeps the gangway opening clear so the plank can mate', async () => {
    const triangles = await shippedTriangles();
    const { problems } = verifyPlanAgainstMesh(triangles, GRAND_FERRY_SHIP_PLAN);
    expect(problems.filter((problem: string) => problem.includes('gangway'))).toEqual([]);
    // The cut is an EDIT to the artist's bulwark; if the edit stopped being
    // applied the opening would silently close and boarding would break.
    expect(GRAND_FERRY_SHIP_PLAN.rampMatingEdge.halfWidth).toBeGreaterThan(0.5);
  });
});

describe('grand ferry shipped artifact', () => {
  it('pins the shipped bytes, the art it was built from, and the source inventory', () => {
    const bytes = readFileSync(ASSET_PATH);
    expect(statSync(ASSET_PATH).size).toBe(ASSET_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(ASSET_SHA256);
    expect(createHash('sha256').update(readFileSync(ART_SOURCE)).digest('hex')).toBe(ART_SHA256);
    // The plan records which art it came from, so a swapped hull is traceable
    // from the generated file alone.
    expect(GRAND_FERRY_SHIP_PLAN.source.sha256).toBe(ART_SHA256);
    // The ART itself is part of the fingerprint: swapping the hull without
    // rebuilding has to be detectable, not merely unlikely.
    expect(GRAND_FERRY_SHIP_SOURCE_FILES).toContain(
      'scripts/assets/grand_ferry_ship/source/grand_ferry_ship_art.glb',
    );
    expect(GRAND_FERRY_SHIP_SOURCE_FILES).toContain('scripts/assets/lib/mesh_collision.mjs');
    expect(grandFerryShipSourceFingerprint(REPO_ROOT)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is registered in the media manifest at the stable prop url', () => {
    expect(Object.keys(MEDIA_ASSETS)).toContain('models/props/grand_ferry_ship.glb');
  });

  it('rebuilds the staged asset and plan byte for byte from the art source', () => {
    const result = spawnSync(process.execPath, [EXPORTER, '--verify-staged', '--no-preview'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    expect(result.status, result.stderr ?? '').toBe(0);
    expect(result.stdout).toContain('staged artifact verified');
  }, 240_000);
});

describe('grand ferry plan reaches both berths', () => {
  it('transforms every measured deck section and blocker into each harbor', () => {
    for (const harbor of HARBORS) {
      // Sections plus the gangway landing.
      expect(harbor.shipDecks).toHaveLength(GRAND_FERRY_SHIP_PLAN.decks.length + 1);
      expect(harbor.shipRails).toHaveLength(GRAND_FERRY_SHIP_PLAN.rails.length);
      expect(harbor.shipBlockers).toHaveLength(GRAND_FERRY_SHIP_PLAN.blockingVolumes.length);
      // Both anchors are aboard, which is the property the hand-typed
      // coordinates lost the moment the deck was re-measured.
      for (const anchor of [harbor.boarding, harbor.keeperPost, harbor.deckArrival]) {
        const aboard = harbor.shipDecks.some(
          (deck) =>
            Math.abs(anchor.x - deck.x) <= deck.hw && Math.abs(anchor.z - deck.z) <= deck.hd,
        );
        expect(aboard, `${harbor.id} anchor ${anchor.x},${anchor.z}`).toBe(true);
      }
    }
  });

  it('emits one open-world collider per generated blocker', () => {
    // The harbours sit far apart, so query a box that spans both berths.
    const colliders: Collider[] = queryOpenWorldColliders(20061, 150, -250, 850, 250, []);
    for (const harbor of HARBORS) {
      for (const blocker of harbor.shipBlockers) {
        const match = colliders.some(
          (collider) =>
            collider.type === 'obb' &&
            Math.abs(collider.x - blocker.x) < 1e-6 &&
            Math.abs(collider.z - blocker.z) < 1e-6 &&
            Math.abs(collider.hw - blocker.hw) < 1e-6,
        );
        expect(match, `${harbor.id} ${blocker.id} collider`).toBe(true);
      }
    }
  });
});
