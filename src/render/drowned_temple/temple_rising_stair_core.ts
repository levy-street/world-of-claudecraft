// Pure plan for the Drowned Temple's rising stairs and the Moonbridge (drawn by
// temple_gates.ts): the Prism Stair that rises out of the lagoon when the
// Hydra's pool drains is drawn by the field's OWN ground painter (the same wet
// flagstones, cliff faces and balustrades as every other stair), so the drawn
// ramp is the walked ramp; the Moonbridge's planks span only the open water
// between the Prism Terrace's rim and the Altar Landing, so no plank lies on
// either floor.
//
// Three-free, DOM-free, deterministic.

import {
  DROWNED_TEMPLE_FIELD,
  HYDRA_POOL,
  MOONBRIDGE,
  PRISM_TERRACE,
} from '../../sim/content/drowned_temple_layout';
import type { AuthoredFieldDef, FieldPathSurface } from '../../sim/instances/authored_field/types';
import { planFieldEdgePieces } from '../authored_field/field_edge_plan_core';
import { TEMPLE_BALUSTRADE, type TempleKitPlacement } from './temple_kit_plan_core';

export const RISING_STAIR_ID = 'prism_stair_sunken';

function risingPath(): FieldPathSurface {
  const s = DROWNED_TEMPLE_FIELD.surfaces.find((x) => x.id === RISING_STAIR_ID);
  if (s?.kind !== 'path') throw new Error(`no path ${RISING_STAIR_ID}`);
  return s;
}

/** The landing the stair climbs to (its flat run ends on its rim). */
function landingLow(): { x: number; z: number; r: number } {
  const s = DROWNED_TEMPLE_FIELD.surfaces.find((x) => x.id === 'prism_landing_low');
  if (s?.kind !== 'circle') throw new Error('no prism_landing_low');
  return s;
}

/**
 * The rising stair as a one-surface field for the ground painter: the ramp
 * itself, visible, trimmed so it stops at the pool rim's floor below and at
 * the landing's rim above (those floors are drawn by the main terrain; a
 * second coplanar top there would fight it).
 */
export function risingStairField(): AuthoredFieldDef {
  const path = risingPath();
  const pts = path.points;
  const bottom = pts[1];
  const top = pts[pts.length - 2];
  const land = landingLow();
  // Step along the last flat run until the landing's rim.
  const end = pts[pts.length - 1];
  const dx = end[0] - top[0];
  const dz = end[1] - top[1];
  const len = Math.hypot(dx, dz);
  let k = 0;
  while (k < 1 && Math.hypot(top[0] + dx * k - land.x, top[1] + dz * k - land.z) > land.r)
    k += 0.02;
  const edge: [number, number, number] = [top[0] + dx * k, top[1] + dz * k, top[2]];
  const surface: FieldPathSurface = {
    ...path,
    hidden: false,
    points: len > 0 ? [bottom, top, edge] : [bottom, top],
  };
  return { ...DROWNED_TEMPLE_FIELD, surfaces: [surface], props: [], walls: [], lightZones: [] };
}

/** The balustrades along the rising stair's two sides (never across its ends,
 *  which open onto the pool rim and the landing). */
export function planRisingStairEdges(): TempleKitPlacement[] {
  const land = landingLow();
  return planFieldEdgePieces(risingStairField(), {
    minDrop: 1.5,
    kindFor: () => TEMPLE_BALUSTRADE,
  })
    .filter(
      (e) =>
        Math.hypot(e.x - HYDRA_POOL.x, e.z - HYDRA_POOL.z) > HYDRA_POOL.r + 0.6 &&
        Math.hypot(e.x - land.x, e.z - land.z) > land.r + 0.6,
    )
    .map((e) => ({
      piece: e.piece,
      x: e.x,
      z: e.z,
      rot: e.rot,
      scale: 1,
      y: e.y,
      stretch: e.stretch,
      shear: e.shear,
    }));
}

/** The Moonbridge's drawn span: from the Prism Terrace's rim to the Altar
 *  Landing's east edge (x runs west), with the deck height along it. */
export function moonbridgeSpan(): { fromX: number; toX: number; deckAt(x: number): number } {
  const fromX =
    PRISM_TERRACE.x - Math.sqrt(PRISM_TERRACE.r ** 2 - (MOONBRIDGE.z - PRISM_TERRACE.z) ** 2);
  const landing = DROWNED_TEMPLE_FIELD.surfaces.find((s) => s.id === 'altar_landing');
  const toX =
    landing && landing.kind === 'poly'
      ? Math.max(...landing.points.map((p) => p[0]))
      : MOONBRIDGE.toX;
  const deckAt = (x: number): number =>
    x >= MOONBRIDGE.fromX
      ? MOONBRIDGE.fromH
      : x <= MOONBRIDGE.toX
        ? MOONBRIDGE.toH
        : MOONBRIDGE.fromH +
          ((MOONBRIDGE.toH - MOONBRIDGE.fromH) * (MOONBRIDGE.fromX - x)) /
            (MOONBRIDGE.fromX - MOONBRIDGE.toX);
  return { fromX, toX, deckAt };
}

/** The Moonbridge's two balustrades (the temple's own kit rail), along both
 *  sides of the drawn span and sheared to its slope; never across its ends. */
export function planMoonbridgeEdges(): TempleKitPlacement[] {
  const span = moonbridgeSpan();
  const s = DROWNED_TEMPLE_FIELD.surfaces.find((x) => x.id === 'moonbridge');
  if (s?.kind !== 'path') throw new Error('no moonbridge');
  const surface: FieldPathSurface = {
    ...s,
    hidden: false,
    points: [
      [span.fromX, MOONBRIDGE.z, span.deckAt(span.fromX)],
      [span.toX, MOONBRIDGE.z, span.deckAt(span.toX)],
    ],
  };
  const field: AuthoredFieldDef = {
    ...DROWNED_TEMPLE_FIELD,
    surfaces: [surface],
    props: [],
    walls: [],
    lightZones: [],
  };
  return planFieldEdgePieces(field, { minDrop: 1.5, kindFor: () => TEMPLE_BALUSTRADE })
    .filter((e) => Math.abs(e.z - MOONBRIDGE.z) > s.halfWidth - 1.2)
    .map((e) => ({
      piece: e.piece,
      x: e.x,
      z: e.z,
      rot: e.rot,
      scale: 1,
      y: e.y,
      stretch: e.stretch,
      shear: e.shear,
    }));
}
