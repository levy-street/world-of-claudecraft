// Render-side pure core for the Ignivar raid dressing plan. The placement
// TABLES live sim-side in src/sim/ignivar_props.ts (one table drives both
// the dressing meshes here and the interior colliders, so a prop's physical
// footprint is its visible silhouette); this module re-exports them for the
// render consumers and keeps the render-only beam-course machinery. No
// three.js: plain transform records the dressing builder turns into
// instanced meshes and clones.
import { DUNGEON_WALL_HW, type DungeonLayout } from '../sim/dungeon_layout';
import {
  IGNIVAR_PROP_NATIVE,
  IGNIVAR_WALL_TOP,
  type IgnivarEnvPropKey,
  type IgnivarPropPlacement,
  ignivarApproachPropPlacements,
  ignivarArenaPropPlacements,
  ignivarCruciblePropPlacements,
  ignivarLiftPropPlacements,
} from '../sim/ignivar_props';

export { IGNIVAR_PROP_NATIVE, IGNIVAR_WALL_TOP, type IgnivarEnvPropKey, type IgnivarPropPlacement };

const BEAM_SKIRT_SCALE = 4;
const BEAM_CROWN_SCALE = 8;

interface Doorway {
  x: number;
  z: number;
  halfWidth: number;
}

type Polygon = readonly { x: number; z: number }[];

function rectanglePolygon(layout: DungeonLayout): Polygon {
  const hx = layout.floorHalfX ?? layout.wallX ?? 18;
  return [
    { x: -hx, z: layout.zMin },
    { x: hx, z: layout.zMin },
    { x: hx, z: layout.zMax },
    { x: -hx, z: layout.zMax },
  ];
}

function shellPolygon(layout: DungeonLayout): Polygon {
  const poly = layout.shellPolygon;
  return poly && poly.length >= 3 ? poly : rectanglePolygon(layout);
}

/** Beam courses along every wall edge: a skirt course at the floor and a
 *  crown course at the wall top, inset off the wall's inner face. Skirt
 *  segments skip doorways (the crown runs through as a lintel), and
 *  alternate skirt segments are density-only so the low tier keeps the
 *  outline at half the instances. Kept for the room-dressing bake passes;
 *  cosmetic trim only, so these never grow colliders. */
export function ignivarBeamCourses(
  layout: DungeonLayout,
  doorways: readonly Doorway[],
): IgnivarPropPlacement[] {
  const polygon = shellPolygon(layout);
  const native = IGNIVAR_PROP_NATIVE.beam;
  const placements: IgnivarPropPlacement[] = [];
  for (let index = 0; index < polygon.length; index++) {
    const { x: x0, z: z0 } = polygon[index];
    const { x: x1, z: z1 } = polygon[(index + 1) % polygon.length];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const length = Math.hypot(dx, dz);
    if (length < BEAM_SKIRT_SCALE) continue;
    const dirX = dx / length;
    const dirZ = dz / length;
    const inX = -dz / length;
    const inZ = dx / length;
    const ry = Math.atan2(inX, inZ);
    const courses: { scale: number; y: number; skirt: boolean }[] = [
      { scale: BEAM_SKIRT_SCALE, y: 0, skirt: true },
      {
        scale: BEAM_CROWN_SCALE,
        y: IGNIVAR_WALL_TOP - native.hei * BEAM_CROWN_SCALE,
        skirt: false,
      },
    ];
    for (const course of courses) {
      const count = Math.floor(length / course.scale);
      if (count < 1) continue;
      const margin = (length - count * course.scale) / 2;
      for (let seg = 0; seg < count; seg++) {
        const t = margin + course.scale * (seg + 0.5);
        const inset = DUNGEON_WALL_HW + (native.dep * course.scale) / 2;
        const x = x0 + dirX * t + inX * inset;
        const z = z0 + dirZ * t + inZ * inset;
        if (
          course.skirt &&
          doorways.some((door) => Math.hypot(x - door.x, z - door.z) < door.halfWidth)
        )
          continue;
        placements.push({
          key: 'beam',
          x,
          y: course.y,
          z,
          ry,
          scale: course.scale,
          highOnly: course.skirt && seg % 2 === 1 ? true : undefined,
        });
      }
    }
  }
  return placements;
}

/** The per-room dressing plans (the sim placement tables, verbatim). */
export function ignivarApproachPropPlan(layout: DungeonLayout): IgnivarPropPlacement[] {
  return ignivarApproachPropPlacements(layout);
}

export function ignivarLiftPropPlan(layout: DungeonLayout): IgnivarPropPlacement[] {
  return ignivarLiftPropPlacements(layout);
}

export function ignivarArenaPropPlan(layout: DungeonLayout): IgnivarPropPlacement[] {
  return ignivarArenaPropPlacements(layout);
}

export function ignivarCruciblePropPlan(layout: DungeonLayout): IgnivarPropPlacement[] {
  return ignivarCruciblePropPlacements(layout);
}

export function filterIgnivarPropPlacements(
  placements: readonly IgnivarPropPlacement[],
  lowGfx: boolean,
): IgnivarPropPlacement[] {
  return placements.filter((placement) => !lowGfx || !placement.highOnly);
}
