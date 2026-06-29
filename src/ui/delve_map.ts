// Pure helper for delve minimap/world-map rendering. No DOM or canvas deps:
// takes plain data in, returns draw primitives or strings.
// Imported by hud.ts; tested by tests/delve_map.test.ts.

import type { DungeonLayout } from '../sim/dungeon_layout';

/** Compose the area label shown on the minimap / world-map zone title. The
 * module name is passed in already localized (the caller resolves the
 * `delveUi.moduleName.*` key via t()), so this helper stays string-table-free. */
export function delveAreaLabel(delveName: string, moduleName: string): string {
  return moduleName ? `${delveName}: ${moduleName}` : delveName;
}

// ---------------------------------------------------------------------------
// Schematic draw primitives (all in canvas-pixel space, caller handles ctx).
// The helper returns plain data; hud.ts does the actual canvas.drawXxx calls.
// ---------------------------------------------------------------------------

/** A filled circle (pillar, dais, exit marker, player dot). */
export interface SchematicCircle {
  kind: 'circle';
  cx: number;
  cy: number;
  r: number;
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
  /** canvas rotation in radians (matches -p.facing convention in hud.ts) */
  angle: number;
  size: number;
  fill: string;
  stroke: string;
}

export type SchematicPrimitive = SchematicCircle | SchematicRect | SchematicText | SchematicArrow;

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
): { cx: number; cy: number } {
  const roomW = 46; // ±23
  const roomD = layout.zMax - layout.zMin;
  const drawW = canvasSize - pad * 2;
  const drawH = canvasSize - pad * 2;
  // localX: -23 → right edge, +23 → left edge (mirror X for map-left convention)
  const cx = pad + ((23 - localX) / roomW) * drawW;
  // localZ: zMin → top, zMax → bottom
  const cy = pad + ((localZ - layout.zMin) / roomD) * drawH;
  return { cx, cy };
}

/** The static schematic primitives for a module (floor + walls + pillars + tombs + dais + exit).
 *  `northLabel` is the localized compass-north glyph drawn at the exit (the caller
 *  injects t('hudChrome.compass.N'); it is locale-dependent, e.g. ru С, zh/ja 北, ko 북).
 *  Defaults to the cartographic 'N' for non-rendering callers (tests / direct use). */
export function delveSchematicStatic(
  layout: DungeonLayout,
  canvasSize: number,
  pad: number,
  northLabel = 'N',
): SchematicPrimitive[] {
  const prims: SchematicPrimitive[] = [];

  // Floor background rect (the full room footprint)
  const topLeft = delveLocalToCanvas(-23, layout.zMin, layout, canvasSize, pad);
  const botRight = delveLocalToCanvas(23, layout.zMax, layout, canvasSize, pad);
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
    const { cx, cy } = delveLocalToCanvas(p.x, p.z, layout, canvasSize, pad);
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
    const { cx, cy } = delveLocalToCanvas(t.x, t.z, layout, canvasSize, pad);
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
    const { cx, cy } = delveLocalToCanvas(s.x, s.z, layout, canvasSize, pad);
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
  const { cx: dcx, cy: dcy } = delveLocalToCanvas(dais.x, dais.z, layout, canvasSize, pad);
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

  // Exit marker at zMax (north passage, top of canvas since zMin is north entrance)
  // The tombstone passage is at the top, zMin end is the ENTRANCE (south), zMax is boss end (north).
  // Actually: zMin = entrance side (-19), zMax = boss end (61). The exit to next module is
  // at zMax (the "sealed passage north"). We draw a small arch glyph there.
  const { cx: exCx, cy: exCy } = delveLocalToCanvas(0, layout.zMax - 2, layout, canvasSize, pad);
  prims.push({
    kind: 'circle',
    cx: exCx,
    cy: exCy,
    r: Math.max(3, canvasSize * 0.025),
    fill: '#7a50c8',
    stroke: '#b090e8',
    strokeWidth: 1,
  });
  prims.push({
    kind: 'text',
    cx: exCx,
    cy: exCy - Math.max(5, canvasSize * 0.05),
    text: northLabel,
    fill: '#b090e8',
    font: `bold ${Math.max(8, Math.round(canvasSize * 0.08))}px Georgia`,
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
): SchematicArrow {
  const { cx, cy } = delveLocalToCanvas(localX, localZ, layout, canvasSize, pad);
  return {
    kind: 'arrow',
    cx,
    cy,
    angle: -facing, // matches the convention in updateMinimap / updateMapWindow
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
