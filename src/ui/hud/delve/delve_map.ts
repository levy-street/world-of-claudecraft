// Pure helper for delve minimap/world-map rendering. No DOM or canvas deps:
// takes plain data in, returns draw primitives or strings.
// Imported by hud.ts; tested by tests/delve_map.test.ts.

import { delveModuleZOffset } from '../../../sim/data';
import {
  isLitanyModuleId,
  litanyModuleGeometry,
  litanyModuleMapPrimitives,
} from '../../../sim/delve_litany_layout';
import type { DungeonLayout } from '../../../sim/dungeon_layout';

export type DelveMapFit = 'rect' | 'circle';

/** Compose the area label shown on the minimap / world-map zone title. The
 * module name is passed in already localized (the caller resolves the
 * `delveUi.moduleName.*` key via t()), so this helper stays string-table-free. */
export function delveAreaLabel(delveName: string, moduleName: string): string {
  return moduleName ? `${delveName}: ${moduleName}` : delveName;
}

/** World origin of the active module. A delve run's origin is the instance slot,
 * while every module after the first is stacked farther along world Z. */
export function delveCurrentModuleOrigin(run: {
  origin: { x: number; z: number };
  modules: readonly string[];
  moduleIndex: number;
}): { x: number; z: number } {
  return {
    x: run.origin.x,
    z: run.origin.z + delveModuleZOffset(run.modules, run.moduleIndex),
  };
}

// ---------------------------------------------------------------------------
// Schematic draw primitives (all in canvas-pixel space, caller handles ctx).
// The helper returns plain data; hud.ts does the actual canvas.drawXxx calls.
// ---------------------------------------------------------------------------

/** A filled circle (pillar, dais, exit marker, player dot). `ry` makes it an
 * ellipse: the schematic maps x and z with different scales, so a world-space
 * circle (a Blackwater pool) is an ellipse in canvas space. Defaults to `r`. */
export interface SchematicCircle {
  kind: 'circle';
  cx: number;
  cy: number;
  r: number;
  ry?: number;
  /** Painted clipped to the module's outline polygon: authored pools bleed past
   * the walkable boundary in the world (under walls), so their true-scale
   * footprint can exceed the canvas; the outline bounds what actually paints. */
  clipToOutline?: boolean;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
}

/** A filled rectangle (tomb slab, floor). */
export interface SchematicRect {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  /** See SchematicCircle.clipToOutline. */
  clipToOutline?: boolean;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
}

/** A filled polygon (irregular Litany walkable islands and Blackwater). */
export interface SchematicPolygon {
  kind: 'polygon';
  points: Array<{ cx: number; cy: number }>;
  /** The module's walkable boundary: the clip shape for clipToOutline prims. */
  isOutline?: boolean;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
}

/** A text label (north exit marker). */
export interface SchematicText {
  kind: 'text';
  cx: number;
  cy: number;
  text: string;
  fill: string;
  font: string;
}

/** Player arrow (rotated triangle). */
export interface SchematicArrow {
  kind: 'arrow';
  cx: number;
  cy: number;
  /** canvas rotation in radians. Unlike the overworld map (-facing), this
   *  schematic's localZ-to-canvas-Y mapping is NOT flipped (see
   *  delveLocalToCanvas), so the arrow needs `facing + PI` to point the
   *  same way the player is actually walking. */
  angle: number;
  size: number;
  fill: string;
  stroke: string;
}

export type SchematicPrimitive =
  | SchematicCircle
  | SchematicRect
  | SchematicPolygon
  | SchematicText
  | SchematicArrow;

// Canvas coordinate space for the schematic:
// - localX / localZ are instance-local (relative to delveRun.origin)
// - +X is map-LEFT (matches the overworld convention "+X is map-left, east = -X")
// - +Z is map-DOWN (north = +Z = up on screen → we negate z for y)
//   ... but hud.ts world-map draws +Z downward, so we keep z → y positive.
// The room runs from zMin (-19) to zMax (61), width ±23 in localX.

/** Map instance-local (x, z) to canvas (cx, cy). canvasSize is the output square
 * in px. Exported so the delve_map painter positions live mob / party / player
 * markers in the SAME space as the static schematic: one source of truth, no
 * duplicated mapping math (and no stray magic numbers) on the painter side. */
export function delveLocalToCanvas(
  localX: number,
  localZ: number,
  layout: DungeonLayout,
  canvasSize: number,
  pad: number,
  fit: DelveMapFit = 'rect',
): { cx: number; cy: number } {
  const { sx, sz, halfWidth, left, top } = delveCanvasScales(layout, canvasSize, pad, fit);
  // Mirror X for map-left convention.
  const cx = left + (halfWidth - localX) * sx;
  // localZ: zMin → top, zMax → bottom
  const cy = top + (localZ - layout.zMin) * sz;
  return { cx, cy };
}

/** Per-axis canvas scales (px per world unit) for the schematic space, the SAME
 * scales delveLocalToCanvas maps positions with: X from the authored outline's
 * max |x| (an irregular outline can bow wider than wallX, e.g. the ring's
 * root-wall flanks), Z from the room depth. Sizes drawn with these scales stay
 * consistent with positions; a single min() scale drew pools and islands at a
 * fraction of the width the walkable outline implied. */
export function delveCanvasScales(
  layout: DungeonLayout,
  canvasSize: number,
  pad: number,
  fit: DelveMapFit = 'rect',
): { sx: number; sz: number; halfWidth: number; left: number; top: number } {
  const rawModuleId = (layout as { litanyModuleId?: string }).litanyModuleId;
  const litany =
    rawModuleId && isLitanyModuleId(rawModuleId) ? litanyModuleGeometry(rawModuleId) : null;
  const polyPoints = litany?.walkable[0]?.points;
  const polyMaxAbsX = polyPoints?.length
    ? polyPoints.reduce((m, p) => Math.max(m, Math.abs(p.x)), 0)
    : null;
  const halfWidth = polyMaxAbsX ?? litany?.wallX ?? 23;
  const depth = layout.zMax - layout.zMin;
  if (fit === 'circle') {
    const radialExtent = Math.max(1, canvasSize / 2 - pad);
    const axisHalfExtent = radialExtent * Math.SQRT1_2;
    return {
      sx: axisHalfExtent / halfWidth,
      sz: (axisHalfExtent * 2) / depth,
      halfWidth,
      left: canvasSize / 2 - axisHalfExtent,
      top: canvasSize / 2 - axisHalfExtent,
    };
  }
  return {
    sx: (canvasSize - pad * 2) / (halfWidth * 2),
    sz: (canvasSize - pad * 2) / depth,
    halfWidth,
    left: pad,
    top: pad,
  };
}

/** Static room geometry for one module. Navigation is deliberately excluded: a
 * passage, reward, or surface exit is drawn only from its live entity/state. */
export function delveSchematicStatic(
  layout: DungeonLayout,
  canvasSize: number,
  pad: number,
  _northLabel = 'N',
  fit: DelveMapFit = 'rect',
): SchematicPrimitive[] {
  const prims: SchematicPrimitive[] = [];

  const litanyModuleIdRaw = (layout as { litanyModuleId?: string }).litanyModuleId;
  const litanyModuleId =
    litanyModuleIdRaw && isLitanyModuleId(litanyModuleIdRaw) ? litanyModuleIdRaw : undefined;
  const litanyPrims =
    litanyModuleId !== undefined ? litanyModuleMapPrimitives(litanyModuleId) : undefined;
  if (litanyPrims && litanyModuleId !== undefined) {
    // Size primitives with the SAME per-axis scales positions map through, so a
    // pool or island is exactly as wide on the map as the outline implies.
    const { sx, sz } = delveCanvasScales(layout, canvasSize, pad, fit);
    // Islands paint AFTER the blackwater fills, like the 3D scene: the dry
    // stepping stones must read on top of the pools they sit in.
    const isIslandPrim = (pr: (typeof litanyPrims)[number]) =>
      pr.kind === 'rect' && pr.role === 'island';
    const paintOrder = [
      ...litanyPrims.filter((pr) => !isIslandPrim(pr)),
      ...litanyPrims.filter(isIslandPrim),
    ];
    for (const prim of paintOrder) {
      if (prim.kind === 'polygon') {
        const points = prim.points.map((pt) => {
          const { cx, cy } = delveLocalToCanvas(pt.x, pt.z, layout, canvasSize, pad, fit);
          return { cx, cy };
        });
        prims.push({
          kind: 'polygon',
          points,
          isOutline: true,
          fill: '#203026',
          stroke: '#58704c',
          strokeWidth: 1,
        });
      } else if (prim.kind === 'circle') {
        const { cx, cy } = delveLocalToCanvas(prim.x, prim.z, layout, canvasSize, pad, fit);
        if (prim.role !== 'exit') {
          // Authored layout exits describe topology, not live availability.
          // The entity overlay owns sealed/open/finale truth.
          // World-space rx/rz (an authored ellipse, e.g. the apse moat) win over
          // the uniform r on each axis independently, before the canvas's own
          // per-axis scale (sx/sz) is applied.
          prims.push({
            kind: 'circle',
            cx,
            cy,
            r: Math.max(2, (prim.rx ?? prim.r) * sx),
            ry: Math.max(2, (prim.rz ?? prim.r) * sz),
            // Only pools bleed past the walkable outline by design; everything
            // else is authored inside it.
            clipToOutline: prim.role === 'blackwater',
            fill:
              prim.role === 'blackwater' ? '#071512' : prim.role === 'dais' ? '#2a2016' : '#2e2820',
            stroke: prim.role === 'blackwater' ? '#65a765' : '#4a4030',
            strokeWidth: prim.role === 'blackwater' ? 1.4 : 0.8,
          });
        }
      } else {
        const { cx, cy } = delveLocalToCanvas(prim.x, prim.z, layout, canvasSize, pad, fit);
        const sw = prim.hw * 2 * sx;
        const sh = prim.hd * 2 * sz;
        const isIsland = prim.role === 'island';
        prims.push({
          kind: 'rect',
          x: cx - sw / 2,
          y: cy - sh / 2,
          w: sw,
          h: sh,
          clipToOutline: isIsland,
          fill: isIsland ? '#203026' : '#2e2820',
          stroke: isIsland ? '#58704c' : '#4a4030',
          strokeWidth: isIsland ? 1 : 0.5,
        });
      }
    }
    return prims;
  }

  // Floor background rect (the full room footprint)
  const topLeft = delveLocalToCanvas(-23, layout.zMin, layout, canvasSize, pad, fit);
  const botRight = delveLocalToCanvas(23, layout.zMax, layout, canvasSize, pad, fit);
  prims.push({
    kind: 'rect',
    x: Math.min(topLeft.cx, botRight.cx),
    y: Math.min(topLeft.cy, botRight.cy),
    w: Math.abs(botRight.cx - topLeft.cx),
    h: Math.abs(botRight.cy - topLeft.cy),
    fill: '#1c1714',
    stroke: '#5a4e3c',
    strokeWidth: 1.5,
  });

  // Pillars: small dark dots
  for (const p of layout.pillars) {
    const { cx, cy } = delveLocalToCanvas(p.x, p.z, layout, canvasSize, pad, fit);
    prims.push({
      kind: 'circle',
      cx,
      cy,
      r: Math.max(2, canvasSize * 0.024),
      fill: '#3a2f22',
      stroke: '#5a4e3c',
      strokeWidth: 1,
    });
  }

  // Tombs: small rects along the walls
  for (const t of layout.tombs) {
    const { cx, cy } = delveLocalToCanvas(t.x, t.z, layout, canvasSize, pad, fit);
    const tw = Math.max(3, canvasSize * 0.035);
    const th = Math.max(2, canvasSize * 0.02);
    prims.push({
      kind: 'rect',
      x: cx - tw / 2,
      y: cy - th / 2,
      w: tw,
      h: th,
      fill: '#2e2820',
      stroke: '#4a4030',
      strokeWidth: 0.5,
    });
  }

  // Wall stubs
  for (const s of layout.stubs) {
    const { cx, cy } = delveLocalToCanvas(s.x, s.z, layout, canvasSize, pad, fit);
    const sw = ((s.hw * 2) / 46) * (canvasSize - pad * 2);
    const sh = ((s.hd * 2) / (layout.zMax - layout.zMin)) * (canvasSize - pad * 2);
    prims.push({
      kind: 'rect',
      x: cx - sw / 2,
      y: cy - sh / 2,
      w: sw,
      h: sh,
      fill: '#2e2820',
      stroke: '#4a4030',
      strokeWidth: 0.5,
    });
  }

  // Dais: larger circle near the back; radius expressed as fraction of canvas size
  // (not world units) to keep it from overflowing into the text area.
  const dais = layout.dais;
  const { cx: dcx, cy: dcy } = delveLocalToCanvas(dais.x, dais.z, layout, canvasSize, pad, fit);
  const dr = Math.max(
    4,
    Math.min(canvasSize * 0.12, (dais.r / (layout.zMax - layout.zMin)) * (canvasSize - pad * 2)),
  );
  prims.push({
    kind: 'circle',
    cx: dcx,
    cy: dcy,
    r: dr,
    fill: '#2a2016',
    stroke: '#7a6840',
    strokeWidth: 1,
  });

  return prims;
}

/** The dynamic player arrow primitive for the current frame. */
export function delveSchematicPlayer(
  localX: number,
  localZ: number,
  facing: number,
  layout: DungeonLayout,
  canvasSize: number,
  pad: number,
  fit: DelveMapFit = 'rect',
): SchematicArrow {
  const { cx, cy } = delveLocalToCanvas(localX, localZ, layout, canvasSize, pad, fit);
  return {
    kind: 'arrow',
    cx,
    cy,
    // The overworld map (map_window_view.ts toMap) flips world Z onto canvas Y,
    // so its arrow uses -facing. This schematic's delveLocalToCanvas maps
    // localZ to canvas Y WITHOUT flipping it (localZ - zMin, not maxZ - localZ),
    // so the same -facing formula pointed the arrow backwards at north/south;
    // facing + PI is the correct rotation for this unflipped mapping.
    angle: facing + Math.PI,
    size: Math.max(5, canvasSize * 0.045),
    fill: '#fff',
    stroke: '#000',
  };
}

/** Compute instance-local player coords from world pos and delveRun.origin. */
export function playerDelveLocal(
  worldX: number,
  worldZ: number,
  origin: { x: number; z: number },
): { localX: number; localZ: number } {
  return { localX: worldX - origin.x, localZ: worldZ - origin.z };
}
