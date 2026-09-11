// Collision Master authored WALKABLE ramp decks: a placement of a ramp-locked
// asset raises the walkable ground along the deck (placementRampFloorAt), so
// the player walks up the ramp instead of being walled off.

import { describe, expect, it, vi } from 'vitest';
import type { WorldContent } from '../src/sim/types';

vi.mock('../src/sim/asset_collision', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/sim/asset_collision')>();
  return {
    ...mod,
    authoredRampsForPath: (path: string | undefined) =>
      path === '/models/props/test_ramp.glb'
        ? [{ x: 0, z: 0, hx: 2, hz: 1, y0: 0, y1: 1.5 }]
        : path === '/models/props/test_ramp_flipped.glb'
          ? [{ x: 0, z: 0, hx: 2, hz: 1, ry: Math.PI, y0: 0, y1: 1.5 }]
          : [],
  };
});

const { placementRampFloorAt } = await import('../src/sim/placement_ramps');

// Detached placements read their frozen groundY, so the test never touches the
// procedural terrain heightfield.
function contentWith(path: string, rotY = 0): WorldContent {
  return {
    placements: [
      {
        assetId: 'props/test_ramp',
        path,
        x: 100,
        z: 50,
        rotY,
        scale: 1,
        collide: true,
        collideRadius: 1,
        detached: true,
        groundY: 10,
      },
    ],
  } as unknown as WorldContent;
}

describe('authored ramp decks', () => {
  it('raises the walkable floor linearly along the deck', () => {
    const content = contentWith('/models/props/test_ramp.glb');
    // Deck rises along model +X: from 0 at x=98 to 1.5 at x=102, over base 10.
    expect(placementRampFloorAt(content, 1, 98, 50)).toBeCloseTo(10, 4);
    expect(placementRampFloorAt(content, 1, 100, 50)).toBeCloseTo(10.75, 4);
    expect(placementRampFloorAt(content, 1, 102, 50)).toBeCloseTo(11.5, 4);
    // Off the deck sideways: no ramp floor.
    expect(placementRampFloorAt(content, 1, 100, 51.5)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('honors the deck yaw (a half-turn deck rises the other way)', () => {
    const content = contentWith('/models/props/test_ramp_flipped.glb');
    expect(placementRampFloorAt(content, 1, 102, 50)).toBeCloseTo(10, 4);
    expect(placementRampFloorAt(content, 1, 98, 50)).toBeCloseTo(11.5, 4);
  });

  it('honors the placement yaw', () => {
    // rotY = pi/2: the model +X axis maps to world (cos, -sin) -> -Z, so the
    // deck's high end sits at world z = 48.
    const content = contentWith('/models/props/test_ramp.glb', Math.PI / 2);
    expect(placementRampFloorAt(content, 1, 100, 48)).toBeCloseTo(11.5, 4);
    expect(placementRampFloorAt(content, 1, 100, 52)).toBeCloseTo(10, 4);
  });

  it('assets with no authored decks contribute nothing', () => {
    const content = contentWith('/models/props/other.glb');
    expect(placementRampFloorAt(content, 1, 100, 50)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('hand-edited hitboxes do NOT strip the authored decks', () => {
    // A hitbox preset (auto-copied onto fresh placements) or a hand-edited
    // blocker box must never silently remove walkability: the deck and the
    // blockers are independent channels.
    const content = contentWith('/models/props/test_ramp.glb');
    const p = (content.placements as { hitboxes?: unknown }[])[0];
    p.hitboxes = [{ x: 0, y: 0.5, z: 0, hx: 0.5, hy: 0.5, hz: 0.5 }];
    expect(placementRampFloorAt(content, 1, 102, 50)).toBeCloseTo(11.5, 4);
  });

  // REGRESSION (Troy, 2026-07-26): "the ramp collision from Collision Master
  // is not letting me walk up, the player just gets stuck". A stairs placement
  // stamped with a SIMPLE footprint — 'basic' collision mode, which is what
  // applyDefaultCollision gives an asset before anyone authors a ramp for it —
  // was dropped by rampsFor's collideCustom gate. The placement kept its solid
  // circle/square and lost its deck, so the ramp became an invisible block.
  it('keeps the authored deck on a placement stamped with a simple footprint', () => {
    const content = contentWith('/models/props/test_ramp.glb');
    const p = (content.placements as { collideCustom?: boolean }[])[0];
    p.collideCustom = true; // effectiveCollisionMode === 'basic'
    expect(placementRampFloorAt(content, 1, 98, 50)).toBeCloseTo(10, 4);
    expect(placementRampFloorAt(content, 1, 102, 50)).toBeCloseTo(11.5, 4);
  });

  it('still contributes nothing when the placement does not collide at all', () => {
    // Collision off is a real choice: no blocker AND no raised floor.
    const content = contentWith('/models/props/test_ramp.glb');
    const p = (content.placements as { collideRadius?: number }[])[0];
    p.collideRadius = 0;
    expect(placementRampFloorAt(content, 1, 102, 50)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('per-placement ramp decks (Collision Master live sessions)', () => {
  it('walks decks carried on the placement itself, replacing the asset table', () => {
    // The placement carries its own deck (the CM scene pre-Lock-In): rising
    // along +X from 0 to 2 over the [-2, 2] span, seated at groundY 10.
    const content = contentWith('/models/props/other.glb');
    const p = (content.placements as { ramps?: unknown }[])[0];
    p.ramps = [{ x: 0, z: 0, hx: 2, hz: 1, y0: 0, y1: 2 }];
    expect(placementRampFloorAt(content, 1, 98, 50)).toBeCloseTo(10, 4);
    expect(placementRampFloorAt(content, 1, 102, 50)).toBeCloseTo(12, 4);
  });

  it('per-placement decks beat the authored table for the same asset', () => {
    // test_ramp's authored deck rises to 1.5; the live session deck rises to
    // 3 - the placement's own decks are the whole truth.
    const content = contentWith('/models/props/test_ramp.glb');
    const p = (content.placements as { ramps?: unknown }[])[0];
    p.ramps = [{ x: 0, z: 0, hx: 2, hz: 1, y0: 0, y1: 3 }];
    expect(placementRampFloorAt(content, 1, 102, 50)).toBeCloseTo(13, 4);
  });
});
