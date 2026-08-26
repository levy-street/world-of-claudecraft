// Every town guild board's placement, probed against the REAL terrain and
// colliders: the board and its reading spot sit on dry, near-level ground,
// and the reading spot is genuinely walkable (a mover resolved there stays
// put instead of being pushed out of a building, lamp post, or the board's
// own collider). A red here means the def's coordinates need a nudge, not
// that the probe should loosen.

import { describe, expect, it } from 'vitest';
import { moverHeight, resolvePosition } from '../src/sim/colliders';
import { NOTICEBOARDS } from '../src/sim/content/noticeboards';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import { STATIC_WORLD_SERVICE_ENTITY_ID_MIN } from '../src/sim/types';
import { groundHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

describe('town guild board placements', () => {
  // One Sim so the static colliders (buildings, props, the boards themselves)
  // are registered for the resolvePosition probes below.
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });

  it('keeps ids and reserved entity ids unique and in the static-service range', () => {
    const ids = NOTICEBOARDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    const entityIds = NOTICEBOARDS.map((b) => b.entityId);
    expect(new Set(entityIds).size).toBe(entityIds.length);
    for (const id of entityIds) {
      expect(id).toBeGreaterThanOrEqual(STATIC_WORLD_SERVICE_ENTITY_ID_MIN);
    }
  });

  it('spawns one interactable board entity per def', () => {
    const boards = [...sim.entities.values()].filter(
      (e) => e.kind === 'object' && e.templateId === 'noticeboard_eastbrook',
    );
    expect(boards).toHaveLength(NOTICEBOARDS.length);
  });

  for (const board of NOTICEBOARDS) {
    it(`${board.id}: dry, near-level ground and a walkable reading spot`, () => {
      const boardGround = groundHeight(board.x, board.z, WORLD_SEED);
      const standGround = groundHeight(
        board.frontStandingPoint.x,
        board.frontStandingPoint.z,
        WORLD_SEED,
      );
      // Dry: the board and its reader stand above the waterline.
      expect(boardGround, `${board.id} board ground`).toBeGreaterThan(WATER_LEVEL + 0.2);
      expect(standGround, `${board.id} reading spot ground`).toBeGreaterThan(WATER_LEVEL + 0.2);
      // Near-level: no cliff between the board and its reading spot.
      expect(Math.abs(boardGround - standGround), `${board.id} step`).toBeLessThan(1.5);

      // Walkable: a mover resolved AT the reading spot stays put (not pushed
      // out of a wall, a lamp post, or the board's own collider).
      const spot = board.frontStandingPoint;
      const m = moverHeight({ pos: { y: standGround }, onGround: true });
      const resolved = resolvePosition(
        WORLD_SEED,
        spot.x,
        spot.z,
        PLAYER_BODY_RADIUS,
        false,
        undefined,
        m,
        0,
      );
      const displaced = Math.hypot(resolved.x - spot.x, resolved.z - spot.z);
      expect(
        displaced,
        `${board.id} reading spot displaced ${displaced.toFixed(2)}yd`,
      ).toBeLessThan(0.75);
    });
  }
});
