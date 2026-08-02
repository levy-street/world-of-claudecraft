// Pure geometry for the boarding-junction woodwork (J4): the berth-head
// corridor, its two flanking rects, and the boarding bridge meet at the one
// spot every rider crosses, and drawing each rect as its own independent
// plank field made the junction read as patchwork (crossing board directions,
// misaligned rows, water showing through the seams) with the bridge ending a
// visible slice short of the hull. This core computes ONE aligned plank field
// over all the junction rects plus the visual-only fixes around it; the
// harbor builder feeds the boxes to its wood buckets. No Three.js, no world
// reads: a Vitest drives it directly.

import type { HarborDeck, HarborDef, HarborRail } from '../sim/harbor_layout';

export interface JunctionWoodBox {
  tone: number;
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
}

export interface JunctionPlankStyle {
  /** Board row pitch (width + groove). */
  pitch: number;
  /** Board thickness below the walkable surface. */
  thickness: number;
  /** Staggered butt-joint length. */
  maxLength: number;
  /** Groove between board rows; kept hairline so no water shows through. */
  groove: number;
  /** End gap at a butt joint inside a rect (never at a rect boundary). */
  jointGap: number;
  /** Alternating board tones. */
  tones: readonly number[];
  /** Underslab and trim tone. */
  trimTone: number;
}

/** How far the bridge's VISUAL planking runs past the measured hull skin so
 * the brow seats into the hull instead of ending over a slice of water. The
 * walkable rect in harbor_layout is untouched: collision still ends at the
 * measured skin line. */
export const BRIDGE_HULL_VISUAL_OVERLAP_YARDS = 0.6;

/** Rail caps normally overhang their post run at both ends; at the bridge's
 * hull end that overhang floats in mid-air, so it is cut flush there. */
export const RAIL_CAP_OVERHANG_YARDS = 0.12;

export interface RailCapOverhang {
  negative: number;
  positive: number;
}

interface JunctionFrame {
  /** The crossing runs along this axis at both shipped harbors. */
  axis: 'x' | 'z';
  /** +1 when the hull lies on the positive side of the bridge along `axis`. */
  hullward: 1 | -1;
  rects: readonly HarborDeck[];
}

function junctionFrame(harbor: HarborDef): JunctionFrame {
  const alongX =
    Math.abs(harbor.berth.x - harbor.bridge.x) >= Math.abs(harbor.berth.z - harbor.bridge.z);
  const axis = alongX ? 'x' : 'z';
  const hullward =
    (axis === 'x' ? harbor.berth.x - harbor.bridge.x : harbor.berth.z - harbor.bridge.z) >= 0
      ? 1
      : -1;
  return {
    axis,
    hullward,
    rects: harbor.decks.filter((deck) => deck.y === harbor.bridge.y),
  };
}

/** Every deck rect the aligned junction field replaces (the berth-head rects
 * and the bridge share one authored height, which is what makes them one
 * visual surface). */
export function boardingJunctionRects(harbor: HarborDef): readonly HarborDeck[] {
  return junctionFrame(harbor).rects;
}

/** The bridge rect extended toward the hull for VISUAL seating (skirts and
 * underslab wrap the same footprint the boards cover). */
export function bridgeVisualRect(harbor: HarborDef): HarborDeck {
  const frame = junctionFrame(harbor);
  const grow = BRIDGE_HULL_VISUAL_OVERLAP_YARDS / 2;
  const bridge = harbor.bridge;
  if (frame.axis === 'x') {
    return { ...bridge, x: bridge.x + frame.hullward * grow, hw: bridge.hw + grow };
  }
  return { ...bridge, z: bridge.z + frame.hullward * grow, hd: bridge.hd + grow };
}

/** Cap overhangs for a rail run: bridge rails are flush at the hull end and
 * keep the standard overhang everywhere else. Returns null for rails that are
 * not part of the boarding bridge. */
export function bridgeRailCapOverhang(harbor: HarborDef, rail: HarborRail): RailCapOverhang | null {
  if (!harbor.bridgeRails.includes(rail)) return null;
  const frame = junctionFrame(harbor);
  // Bridge rails run along the crossing axis; the hull sits past one end.
  return frame.hullward > 0
    ? { negative: RAIL_CAP_OVERHANG_YARDS, positive: 0 }
    : { negative: 0, positive: RAIL_CAP_OVERHANG_YARDS };
}

interface FieldRect {
  along0: number;
  along1: number;
  across0: number;
  across1: number;
  y: number;
}

function toFieldRect(rect: HarborDeck, axis: 'x' | 'z'): FieldRect {
  return axis === 'x'
    ? {
        along0: rect.x - rect.hw,
        along1: rect.x + rect.hw,
        across0: rect.z - rect.hd,
        across1: rect.z + rect.hd,
        y: rect.y,
      }
    : {
        along0: rect.z - rect.hd,
        along1: rect.z + rect.hd,
        across0: rect.x - rect.hw,
        across1: rect.x + rect.hw,
        y: rect.y,
      };
}

function fieldBox(
  axis: 'x' | 'z',
  tone: number,
  along0: number,
  along1: number,
  across0: number,
  across1: number,
  yCenter: number,
  height: number,
): JunctionWoodBox {
  const along = (along0 + along1) / 2;
  const across = (across0 + across1) / 2;
  return {
    tone,
    w: axis === 'x' ? along1 - along0 : across1 - across0,
    h: height,
    d: axis === 'x' ? across1 - across0 : along1 - along0,
    x: axis === 'x' ? along : across,
    y: yCenter,
    z: axis === 'x' ? across : along,
  };
}

/**
 * The aligned plank field. Boards run along the crossing axis in rows laid on
 * ONE world-anchored grid (anchored at the bridge's own centerline), with the
 * butt-joint stagger and the tone cycle phased in world coordinates, so a
 * board reaching a rect boundary continues in the neighbouring rect at the
 * same row, joint phase, and tone: the junction reads as one deck. Each rect
 * also gets a solid trim-tone underslab so the hairline grooves read as dark
 * seams instead of open water below.
 */
export function junctionPlankBoxes(
  harbor: HarborDef,
  style: JunctionPlankStyle,
): JunctionWoodBox[] {
  const frame = junctionFrame(harbor);
  const anchor = frame.axis === 'x' ? harbor.bridge.z : harbor.bridge.x;
  const boxes: JunctionWoodBox[] = [];
  const rects = frame.rects.map((rect) =>
    toFieldRect(rect === harbor.bridge ? bridgeVisualRect(harbor) : rect, frame.axis),
  );
  for (const rect of rects) {
    // Solid underslab flush under the boards: covers the grooves from above.
    boxes.push(
      fieldBox(
        frame.axis,
        style.trimTone,
        rect.along0,
        rect.along1,
        rect.across0,
        rect.across1,
        rect.y - style.thickness - 0.06,
        0.12,
      ),
    );
    const firstRow = Math.floor((rect.across0 - anchor) / style.pitch);
    const lastRow = Math.ceil((rect.across1 - anchor) / style.pitch);
    for (let row = firstRow; row <= lastRow; row++) {
      const rowLo = Math.max(anchor + row * style.pitch + style.groove / 2, rect.across0);
      const rowHi = Math.min(anchor + (row + 1) * style.pitch - style.groove / 2, rect.across1);
      if (rowHi - rowLo < style.groove) continue;
      // World-phased butt joints: ((row % 3) + 3) % 3 keeps the stagger cycle
      // stable for negative rows.
      const stagger = (((row % 3) + 3) % 3) * (style.maxLength / 3);
      const firstJoint =
        Math.floor((rect.along0 - stagger) / style.maxLength) * style.maxLength + stagger;
      for (let start = firstJoint; start < rect.along1; start += style.maxLength) {
        const from = Math.max(start, rect.along0);
        const to = Math.min(start + style.maxLength - style.jointGap, rect.along1);
        if (to - from < style.pitch * 0.5) continue;
        const board = Math.round(start / style.maxLength);
        const tone = style.tones[(((row + board) % 3) + 3) % 3];
        boxes.push(
          fieldBox(
            frame.axis,
            tone,
            from,
            to,
            rowLo,
            rowHi,
            rect.y - style.thickness / 2,
            style.thickness,
          ),
        );
      }
    }
  }
  return boxes;
}
