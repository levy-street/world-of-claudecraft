import type { Collider } from './colliders';
import { TRANSPORT_SHIP_HULLS } from './content/transport_ships';
import { decorSeat } from './decor_seat';
import { shipHullColliders } from './transport_ship';
import type { WorldContent } from './types';
import { groundHeight, terrainHeight, WATER_LEVEL } from './world';

type DecorProp = NonNullable<WorldContent['props']['decorProps']>[number];

function topY(seed: number, x: number, z: number, height: number): number {
  return groundHeight(x, z, seed) + height;
}

/**
 * Hand-placed GLB decor colliders (`PROPS.decorProps`). r 0/absent entries
 * are walk-through dressing and add no collider. An entry carrying hw AND hd
 * collides as the model's real BOX, oriented by its own rot; everything else
 * keeps the circle. `standableTop`, when set, makes the top a landable
 * platform (the crate/rock standable family) instead of a full-height wall;
 * it REQUIRES a footprint (r, or hw+hd), and a `standableTop` with none warns
 * and drops the entry back to walk-through dressing rather than throwing:
 * this builder runs from `colliders.ts` `gridFor`, which only caches ON
 * SUCCESS, so a throw here would re-fire every tick against a custom map's
 * bad content (`setActiveWorldContent`, the world editor's play-test entry)
 * instead of failing once at load. `tests/decor_prop_colliders.test.ts` pins
 * every SHIPPED `standableTop` entry has a footprint, the hard gate for the
 * mistake this module exists to catch (see evergarden.ts's hexCannonballs).
 * A row whose key names a transport ship hull (content/transport_ships.ts)
 * moors that ship instead: its walkable decks, stairs, rails and gangways
 * (transport_ship.ts), seated on the same waterline the renderer floats it
 * on; the row's own footprint fields are ignored for it.
 * Extracted from colliders.ts (shared logic, not per-zone) to stay under its
 * monolith ceiling.
 */
export function buildDecorPropColliders(seed: number, decorProps: DecorProp[]): Collider[] {
  const out: Collider[] = [];
  const heightAt = (x: number, z: number): number => terrainHeight(x, z, seed);
  for (const d of decorProps) {
    // a `seat: 'footprint'` row is drawn sunk onto its footprint (decor_seat.ts); its
    // collider top and standable top sink with it, so neither stands above the art
    const sink = d.seat === 'footprint' ? decorSeat(d, heightAt).sink : 0;
    const cameraTopY = topY(seed, d.x, d.z, d.h ?? 4) - sink;
    const supportBaseY =
      d.float === undefined
        ? groundHeight(d.x, d.z, seed) - sink
        : Math.max(groundHeight(d.x, d.z, seed), WATER_LEVEL - d.float);
    // own keys only: a key like 'constructor' must never reach the hull path
    const hull = Object.hasOwn(TRANSPORT_SHIP_HULLS, d.key)
      ? TRANSPORT_SHIP_HULLS[d.key]
      : undefined;
    if (hull) {
      out.push(
        ...shipHullColliders(hull, { x: d.x, z: d.z, rot: d.rot ?? 0, baseY: supportBaseY }),
      );
      continue;
    }
    // standable: a top to land on; clearAbove: a finite height with nothing to stand on (the
    // campfire's semantic, a body above it passes over)
    const stand =
      d.standableTop !== undefined
        ? { moveTopY: supportBaseY + d.standableTop, standable: true as const }
        : d.clearAbove !== undefined
          ? { moveTopY: supportBaseY + d.clearAbove }
          : {};
    if (d.hw !== undefined && d.hd !== undefined) {
      out.push({
        type: 'obb',
        x: d.x,
        z: d.z,
        hw: d.hw,
        hd: d.hd,
        rot: d.rot ?? 0,
        cameraTopY,
        ...stand,
      });
      continue;
    }
    if (!d.r) {
      if (d.standableTop !== undefined) {
        console.warn(
          `decorProps '${d.key}' at (${d.x}, ${d.z}) sets standableTop with no r (or hw/hd) ` +
            'footprint, so it collides as nothing at all: give it a radius or a box.',
        );
      }
      continue;
    }
    out.push({ type: 'circle', x: d.x, z: d.z, r: d.r, cameraTopY, ...stand });
  }
  return out;
}
