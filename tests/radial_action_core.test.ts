import { describe, expect, it } from 'vitest';
import {
  FLICK_DEADZONE_PX,
  placeConsumableStrip,
  placeRadial,
  RADIAL_DIRECTIONS,
  RADIAL_REVEAL_MS,
  RADIAL_SLOTS_PER_BUTTON,
  radialHasSourceSlot,
  radialPageCount,
  radialSourceSlot,
  resolveRadialDirection,
  resolveStripIndex,
  STRIP_DEADZONE_PX,
  stripDimSpan,
} from '../src/ui/hud/action_bar/radial_action_core';

// The shipping ring geometry: 4 buttons, 5 actions each, over the 33 reachable
// hotbar slots. Every slot-mapping expectation below is written out in full
// rather than recomputed, so a change to the formula fails here.
const BUTTONS = 4;
const TOTAL_SLOTS = 33;

describe('radial constants', () => {
  it('pins the direction order the slot mapping is indexed by', () => {
    expect(RADIAL_DIRECTIONS).toEqual(['center', 'up', 'right', 'down', 'left']);
    expect(RADIAL_SLOTS_PER_BUTTON).toBe(5);
  });

  it('pins the gesture thresholds the whole touch HUD shares', () => {
    expect(FLICK_DEADZONE_PX).toBe(22);
    expect(RADIAL_REVEAL_MS).toBe(180);
    // one gesture language: the strip commits at the same travel as the radial
    expect(STRIP_DEADZONE_PX).toBe(22);
  });
});

describe('resolveRadialDirection', () => {
  it('resolves each cardinal flick past the deadzone', () => {
    expect(resolveRadialDirection(0, -40)).toBe('up');
    expect(resolveRadialDirection(40, 0)).toBe('right');
    expect(resolveRadialDirection(0, 40)).toBe('down');
    expect(resolveRadialDirection(-40, 0)).toBe('left');
  });

  it('holds center inside the deadzone and commits at exactly 22px', () => {
    expect(resolveRadialDirection(0, 0)).toBe('center');
    expect(resolveRadialDirection(21, 0)).toBe('center');
    expect(resolveRadialDirection(22, 0)).toBe('right');
    expect(resolveRadialDirection(23, 0)).toBe('right');
    expect(resolveRadialDirection(-21, 0)).toBe('center');
    expect(resolveRadialDirection(-22, 0)).toBe('left');
    expect(resolveRadialDirection(0, -22)).toBe('up');
    expect(resolveRadialDirection(0, 22)).toBe('down');
    // the deadzone is radial, not per-axis: a diagonal of the same length counts
    expect(resolveRadialDirection(15, 15)).toBe('center');
    expect(resolveRadialDirection(16, 16)).toBe('right');
  });

  it('is axis-major, so a sloppy diagonal lands where the thumb was heading', () => {
    expect(resolveRadialDirection(40, 30)).toBe('right');
    expect(resolveRadialDirection(30, 40)).toBe('down');
    expect(resolveRadialDirection(-40, -30)).toBe('left');
    expect(resolveRadialDirection(-30, -40)).toBe('up');
    // an exact 45 degree tie goes horizontal (|dx| >= |dy|)
    expect(resolveRadialDirection(40, 40)).toBe('right');
    expect(resolveRadialDirection(-40, 40)).toBe('left');
  });

  it('accepts a caller deadzone', () => {
    expect(resolveRadialDirection(30, 0, 40)).toBe('center');
    expect(resolveRadialDirection(30, 0, 10)).toBe('right');
  });
});

describe('radialSourceSlot (direction-major, the default)', () => {
  const slot = (page: number, buttonIndex: number, direction: 'center' | 'up' | 'down') =>
    radialSourceSlot({ page, buttonIndex, direction, buttonsPerPage: BUTTONS });

  it('gives the resting centre row the desktop 1 to 4 keys', () => {
    const centers = [0, 1, 2, 3].map((buttonIndex) => slot(0, buttonIndex, 'center'));
    expect(centers).toEqual([1, 2, 3, 4]);
  });

  it('lays every direction of page 0 over contiguous slot bands', () => {
    const page0 = RADIAL_DIRECTIONS.map((direction) =>
      [0, 1, 2, 3].map((buttonIndex) =>
        radialSourceSlot({ page: 0, buttonIndex, direction, buttonsPerPage: BUTTONS }),
      ),
    );
    expect(page0).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16],
      [17, 18, 19, 20],
    ]);
  });

  it('offsets page 1 by a whole page of 20 slots', () => {
    const page1 = RADIAL_DIRECTIONS.map((direction) =>
      [0, 1, 2, 3].map((buttonIndex) =>
        radialSourceSlot({ page: 1, buttonIndex, direction, buttonsPerPage: BUTTONS }),
      ),
    );
    expect(page1).toEqual([
      [21, 22, 23, 24],
      [25, 26, 27, 28],
      [29, 30, 31, 32],
      [33, 34, 35, 36],
      [37, 38, 39, 40],
    ]);
  });

  it('maps a direction-major query at a non-4 buttonsPerPage width', () => {
    expect(
      radialSourceSlot({ page: 1, buttonIndex: 2, direction: 'right', buttonsPerPage: 3 }),
    ).toBe(24);
  });

  it('honours a caller start slot (slot 0 is the fixed attack toggle)', () => {
    expect(
      radialSourceSlot({
        page: 0,
        buttonIndex: 0,
        direction: 'center',
        buttonsPerPage: BUTTONS,
        startSlot: 7,
      }),
    ).toBe(7);
    expect(
      radialSourceSlot({
        page: 1,
        buttonIndex: 3,
        direction: 'left',
        buttonsPerPage: BUTTONS,
        startSlot: 7,
      }),
    ).toBe(46);
  });
});

describe('radialSourceSlot (button-major)', () => {
  it('gives each button 5 consecutive slots on page 0', () => {
    const page0 = [0, 1, 2, 3].map((buttonIndex) =>
      RADIAL_DIRECTIONS.map((direction) =>
        radialSourceSlot({
          page: 0,
          buttonIndex,
          direction,
          buttonsPerPage: BUTTONS,
          order: 'button-major',
        }),
      ),
    );
    expect(page0).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
      [11, 12, 13, 14, 15],
      [16, 17, 18, 19, 20],
    ]);
  });

  it('offsets page 1 by the same whole page of 20 slots', () => {
    const page1 = [0, 1, 2, 3].map((buttonIndex) =>
      RADIAL_DIRECTIONS.map((direction) =>
        radialSourceSlot({
          page: 1,
          buttonIndex,
          direction,
          buttonsPerPage: BUTTONS,
          order: 'button-major',
        }),
      ),
    );
    expect(page1).toEqual([
      [21, 22, 23, 24, 25],
      [26, 27, 28, 29, 30],
      [31, 32, 33, 34, 35],
      [36, 37, 38, 39, 40],
    ]);
  });

  it('covers the same 40 slots as direction-major, only permuted', () => {
    const collect = (order: 'direction-major' | 'button-major') => {
      const out: number[] = [];
      for (const page of [0, 1]) {
        for (let buttonIndex = 0; buttonIndex < BUTTONS; buttonIndex++) {
          for (const direction of RADIAL_DIRECTIONS) {
            out.push(
              radialSourceSlot({ page, buttonIndex, direction, buttonsPerPage: BUTTONS, order }),
            );
          }
        }
      }
      return out.sort((a, b) => a - b);
    };
    const expected = Array.from({ length: 40 }, (_, i) => i + 1);
    expect(collect('direction-major')).toEqual(expected);
    expect(collect('button-major')).toEqual(expected);
  });
});

describe('radialPageCount', () => {
  it('covers the full 33-slot span in 2 pages at 4 buttons', () => {
    expect(radialPageCount(TOTAL_SLOTS, BUTTONS)).toBe(2);
    expect(radialPageCount(20, BUTTONS)).toBe(1);
    expect(radialPageCount(21, BUTTONS)).toBe(2);
    expect(radialPageCount(40, BUTTONS)).toBe(2);
    expect(radialPageCount(41, BUTTONS)).toBe(3);
  });

  it('never reports fewer than one page, even for a degenerate span', () => {
    expect(radialPageCount(0, BUTTONS)).toBe(1);
    expect(radialPageCount(TOTAL_SLOTS, 0)).toBe(33);
  });
});

describe('radialHasSourceSlot', () => {
  it('hides only the tail positions past the last real slot', () => {
    const has = (page: number, buttonIndex: number, direction: 'down' | 'left' | 'center') =>
      radialHasSourceSlot({ page, buttonIndex, direction, buttonsPerPage: BUTTONS }, TOTAL_SLOTS);
    // page 1 down-b0 is slot 33, the last real one; everything after is tail
    expect(has(1, 0, 'down')).toBe(true);
    expect(has(1, 1, 'down')).toBe(false);
    expect(has(1, 3, 'left')).toBe(false);
    expect(has(0, 0, 'center')).toBe(true);
    expect(has(1, 3, 'center')).toBe(true);
  });

  it('shifts the boundary with the start slot', () => {
    const q = {
      page: 0,
      buttonIndex: 0,
      direction: 'center' as const,
      buttonsPerPage: BUTTONS,
      startSlot: 5,
    };
    expect(radialHasSourceSlot(q, 1)).toBe(true);
    expect(radialHasSourceSlot({ ...q, buttonIndex: 1 }, 1)).toBe(false);
  });
});

describe('placeRadial', () => {
  const base = {
    viewportWidth: 874,
    viewportHeight: 402,
    radius: 64,
    petalHalf: 23,
    margin: 8,
  };
  // reach = radius + petalHalf + margin = 95

  it('emits the four cardinal petals at the ring radius', () => {
    const placed = placeRadial({ ...base, buttonCx: 400, buttonCy: 200 });
    expect(placed.petals).toEqual([
      { direction: 'center', dx: 0, dy: 0 },
      { direction: 'up', dx: 0, dy: -64 },
      { direction: 'right', dx: 64, dy: 0 },
      { direction: 'down', dx: 0, dy: 64 },
      { direction: 'left', dx: -64, dy: 0 },
    ]);
  });

  it('leaves a button with room on every side alone', () => {
    const placed = placeRadial({ ...base, buttonCx: 400, buttonCy: 200 });
    expect(placed.originX).toBe(400);
    expect(placed.originY).toBe(200);
  });

  it('clamps at the right and bottom edges (where the ring actually sits)', () => {
    const placed = placeRadial({ ...base, buttonCx: 860, buttonCy: 380 });
    expect(placed.originX).toBe(779);
    expect(placed.originY).toBe(307);
  });

  it('clamps at the left and top edges', () => {
    const placed = placeRadial({ ...base, buttonCx: 10, buttonCy: 8 });
    expect(placed.originX).toBe(95);
    expect(placed.originY).toBe(95);
  });

  it('clamps each axis independently', () => {
    const rightOnly = placeRadial({ ...base, buttonCx: 870, buttonCy: 200 });
    expect(rightOnly.originX).toBe(779);
    expect(rightOnly.originY).toBe(200);
    const bottomOnly = placeRadial({ ...base, buttonCx: 400, buttonCy: 400 });
    expect(bottomOnly.originX).toBe(400);
    expect(bottomOnly.originY).toBe(307);
  });

  it('centres on an axis too narrow to satisfy both clamps', () => {
    const narrow = placeRadial({ ...base, viewportWidth: 100, buttonCx: 90, buttonCy: 200 });
    expect(narrow.originX).toBe(50);
    expect(narrow.originY).toBe(200);
    const short = placeRadial({ ...base, viewportHeight: 120, buttonCx: 400, buttonCy: 10 });
    expect(short.originX).toBe(400);
    expect(short.originY).toBe(60);
  });

  it('treats the margin as extra edge clearance', () => {
    const noMargin = placeRadial({ ...base, margin: undefined, buttonCx: 870, buttonCy: 380 });
    expect(noMargin.originX).toBe(787);
    expect(noMargin.originY).toBe(315);
  });

  it('takes the clamp arm at exactly viewportWidth = reach * 2 (the tie boundary)', () => {
    const placed = placeRadial({ ...base, viewportWidth: 190, buttonCx: 170, buttonCy: 200 });
    expect(placed.originX).toBe(95);
  });
});

describe('placeConsumableStrip', () => {
  const item = { itemSize: 46, gap: 8, viewportWidth: 874, margin: 8 };

  it('grows leftward from the anchor at a constant pitch', () => {
    const strip = placeConsumableStrip({ ...item, anchorX: 800, anchorY: 340, count: 6 });
    expect(strip.pitch).toBe(54);
    expect(strip.clamped).toBe(false);
    expect(strip.centers).toEqual([746, 692, 638, 584, 530, 476]);
  });

  it('shifts the whole row rather than compressing it when it runs off the left', () => {
    const strip = placeConsumableStrip({ ...item, anchorX: 200, anchorY: 340, count: 6 });
    expect(strip.clamped).toBe(true);
    expect(strip.pitch).toBe(54);
    expect(strip.centers).toEqual([301, 247, 193, 139, 85, 31]);
    // the far item now sits exactly on the margin, and the pitch is untouched
    expect(strip.centers[5] - 23).toBe(8);
    expect(strip.centers[0] - strip.centers[1]).toBe(54);
  });

  it('mirrors for a rightward strip (the menu control seat)', () => {
    const strip = placeConsumableStrip({
      ...item,
      anchorX: 60,
      anchorY: 340,
      count: 9,
      direction: 'right',
    });
    expect(strip.clamped).toBe(false);
    expect(strip.centers).toEqual([114, 168, 222, 276, 330, 384, 438, 492, 546]);
  });

  it('shifts a rightward strip back on screen at the right margin', () => {
    const strip = placeConsumableStrip({
      ...item,
      viewportWidth: 400,
      anchorX: 60,
      anchorY: 340,
      count: 9,
      direction: 'right',
    });
    expect(strip.clamped).toBe(true);
    expect(strip.centers[8]).toBe(369);
    expect(strip.centers[8] + 23).toBe(392);
    expect(strip.centers[1] - strip.centers[0]).toBe(54);
  });

  it('returns an empty, unclamped row for an empty consumable list', () => {
    const strip = placeConsumableStrip({ ...item, anchorX: 800, anchorY: 340, count: 0 });
    expect(strip.centers).toEqual([]);
    expect(strip.clamped).toBe(false);
    expect(strip.pitch).toBe(54);
  });

  it('stays unclamped for an empty list anchored near the right edge', () => {
    const strip = placeConsumableStrip({
      ...item,
      anchorX: 870,
      anchorY: 340,
      direction: 'right',
      count: 0,
    });
    expect(strip.centers).toEqual([]);
    expect(strip.clamped).toBe(false);
  });

  it('stays unclamped for an empty list anchored near the left edge', () => {
    const strip = placeConsumableStrip({
      ...item,
      anchorX: 10,
      anchorY: 340,
      direction: 'left',
      count: 0,
    });
    expect(strip.centers).toEqual([]);
    expect(strip.clamped).toBe(false);
  });

  it('treats an exact fit at the margin as unclamped (shortfall = 0)', () => {
    const strip = placeConsumableStrip({ ...item, anchorX: 355, anchorY: 340, count: 6 });
    expect(strip.clamped).toBe(false);
    expect(strip.centers[5]).toBe(31);
  });
});

describe('resolveStripIndex', () => {
  const PITCH = 54;

  it('stays a tap inside the deadzone and commits at exactly 22px', () => {
    expect(resolveStripIndex(0, PITCH, 6)).toBe(-1);
    expect(resolveStripIndex(-21, PITCH, 6)).toBe(-1);
    expect(resolveStripIndex(-22, PITCH, 6)).toBe(0);
    expect(resolveStripIndex(-23, PITCH, 6)).toBe(0);
  });

  it('selects increasing indices with leftward travel', () => {
    expect(resolveStripIndex(-53, PITCH, 6)).toBe(0);
    expect(resolveStripIndex(-54, PITCH, 6)).toBe(1);
    expect(resolveStripIndex(-108, PITCH, 6)).toBe(2);
    expect(resolveStripIndex(-270, PITCH, 6)).toBe(5);
  });

  it('clamps travel past the far item to the last index', () => {
    expect(resolveStripIndex(-400, PITCH, 6)).toBe(5);
    expect(resolveStripIndex(-4000, PITCH, 6)).toBe(5);
    expect(resolveStripIndex(-400, PITCH, 1)).toBe(0);
  });

  it('ignores travel against the direction the row grows', () => {
    expect(resolveStripIndex(100, PITCH, 6)).toBe(-1);
    expect(resolveStripIndex(-100, PITCH, 6, 22, 'right')).toBe(-1);
  });

  it('mirrors for a rightward strip', () => {
    expect(resolveStripIndex(22, PITCH, 9, 22, 'right')).toBe(0);
    expect(resolveStripIndex(21, PITCH, 9, 22, 'right')).toBe(-1);
    expect(resolveStripIndex(120, PITCH, 9, 22, 'right')).toBe(2);
    expect(resolveStripIndex(900, PITCH, 9, 22, 'right')).toBe(8);
  });

  it('resolves nothing for an empty strip', () => {
    expect(resolveStripIndex(-400, PITCH, 0)).toBe(-1);
    expect(resolveStripIndex(-400, PITCH, 0, 22, 'right')).toBe(-1);
  });

  it('accepts a caller deadzone', () => {
    expect(resolveStripIndex(-30, PITCH, 6, 40)).toBe(-1);
    expect(resolveStripIndex(-30, PITCH, 6, 10)).toBe(0);
  });
});

// The local dim's band. The whole point is that it FOLLOWS the row: the extent is
// a function of how many items are actually open, so a ten-item menu and a
// one-item consumables row never darken the same amount of screen.
describe('stripDimSpan', () => {
  const ITEM = 46;
  const leftRow = (n: number) => Array.from({ length: n }, (_, i) => 400 - 54 * (i + 1));
  const rightRow = (n: number) => Array.from({ length: n }, (_, i) => 200 + 54 * (i + 1));

  it('runs from the anchor to one item past the last centre, rightward', () => {
    const span = stripDimSpan({ anchorX: 200, centers: rightRow(9), count: 9, itemSize: ITEM });
    expect(span.anchorAtRight).toBe(false);
    expect(span.left).toBe(200);
    // Last centre is 200 + 54 * 9 = 686, so the band ends at 686 + 46 = 732.
    expect(span.width).toBe(532);
    expect(span.left + span.width).toBe(732);
  });

  it('mirrors when the row grew leftward, putting the anchor at the right edge', () => {
    const span = stripDimSpan({ anchorX: 400, centers: leftRow(6), count: 6, itemSize: ITEM });
    expect(span.anchorAtRight).toBe(true);
    // Last centre is 400 - 54 * 6 = 76, so the band starts at 76 - 46 = 30.
    expect(span.width).toBe(370);
    expect(span.left).toBe(30);
    expect(span.left + span.width).toBe(400);
  });

  it('scales the extent with the number of OPEN items, not the row capacity', () => {
    const centers = leftRow(6);
    const two = stripDimSpan({ anchorX: 400, centers, count: 2, itemSize: ITEM });
    const six = stripDimSpan({ anchorX: 400, centers, count: 6, itemSize: ITEM });
    expect(two.width).toBe(154);
    expect(six.width).toBe(370);
    expect(two.width).toBeLessThan(six.width);
    // The band always ends AT the anchor on a leftward row, whatever the count.
    expect(two.left + two.width).toBe(400);
  });

  it('closes to nothing when the row carries no items', () => {
    expect(stripDimSpan({ anchorX: 400, centers: [], count: 0, itemSize: ITEM })).toEqual({
      left: 400,
      width: 0,
      anchorAtRight: false,
    });
    expect(
      stripDimSpan({ anchorX: 400, centers: leftRow(6), count: 0, itemSize: ITEM }).width,
    ).toBe(0);
  });

  it('never reads past the centres the placement actually produced', () => {
    const span = stripDimSpan({ anchorX: 400, centers: leftRow(2), count: 6, itemSize: ITEM });
    expect(span.width).toBe(154);
    expect(Number.isFinite(span.left)).toBe(true);
  });

  it('takes the CLAMPED centres as given, so a shifted row dims where it renders', () => {
    // placeConsumableStrip shifts the whole row when the far item would run off
    // screen; the band has to follow the shift, not the unclamped ideal.
    const clamped = placeConsumableStrip({
      anchorX: 120,
      anchorY: 300,
      count: 6,
      itemSize: ITEM,
      gap: 8,
      viewportWidth: 844,
      margin: 6,
      direction: 'left',
    });
    expect(clamped.clamped).toBe(true);
    const span = stripDimSpan({
      anchorX: 120,
      centers: clamped.centers,
      count: 6,
      itemSize: ITEM,
    });
    expect(span.left).toBeCloseTo(clamped.centers[5] - ITEM, 5);
    expect(span.left + span.width).toBeCloseTo(120, 5);
  });
});
