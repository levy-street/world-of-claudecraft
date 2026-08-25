// Pure, DOM-free core for the touch radial action ring: direction resolution,
// hotbar slot mapping, page arithmetic, edge-aware petal placement, and the
// bidirectional strip variant the consumables seat uses. No DOM, no timers, no
// Hud state, so a Vitest drives every decision directly; registered in
// tests/architecture.test.ts UI_PURE_CORES.
//
// Each of the ring's buttons carries 5 actions (a centre tap plus 4 flick
// directions), so one page reaches 5 times as many hotbar slots as the flat
// paged ring in mobile_action_page_view.ts. The gesture layer and the painter
// are thin consumers of this module; nothing here knows how a petal is drawn.

export type RadialDirection = 'center' | 'up' | 'right' | 'down' | 'left';

/** Fixed order. The index is load-bearing for slot mapping, so never reorder. */
export const RADIAL_DIRECTIONS: readonly RadialDirection[] = [
  'center',
  'up',
  'right',
  'down',
  'left',
];

/** Actions one ring button carries: the centre tap plus the 4 flicks. */
export const RADIAL_SLOTS_PER_BUTTON = RADIAL_DIRECTIONS.length;

/** Travel before a drag counts as directional rather than a tap. Deliberately
 *  small: the flick must resolve without waiting for any hold, because a hold
 *  plus a swipe plus a release does not fit inside a 1.5s global cooldown. */
export const FLICK_DEADZONE_PX = 22;

/** How long a stationary press waits before REVEALING the petals. A learning
 *  affordance only: it never gates casting, since a flick resolves at
 *  FLICK_DEADZONE_PX whether or not this has elapsed. Far below the tooltip-peek
 *  threshold so the two never feel like the same gesture. */
export const RADIAL_REVEAL_MS = 180;

/**
 * Which direction a drag resolves to, or 'center' while still inside the
 * deadzone. Axis-major: the larger absolute component wins, so a sloppy diagonal
 * still lands on the direction the player was mostly heading.
 */
export function resolveRadialDirection(
  dx: number,
  dy: number,
  deadzone: number = FLICK_DEADZONE_PX,
): RadialDirection {
  if (Math.hypot(dx, dy) < deadzone) return 'center';
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** How the 5 directions of B buttons lie over the flat hotbar slot list.
 *  - 'direction-major': centre takes the first B slots, then up, right, down,
 *    left. Keeps the resting row contiguous and equal to the desktop 1 to B
 *    keys, which is where a player already puts their core rotation.
 *  - 'button-major': each button owns 5 consecutive slots. */
export type RadialSlotOrder = 'direction-major' | 'button-major';

export interface RadialSlotQuery {
  page: number;
  buttonIndex: number;
  direction: RadialDirection;
  buttonsPerPage: number;
  order?: RadialSlotOrder;
  /** First reachable hotbar slot (1-based). Slot 0 is the fixed attack toggle. */
  startSlot?: number;
}

/** The hotbar source slot (1-indexed, matching Hud.castSlot's barSlot numbering)
 *  a given button plus direction maps to on a given page. */
export function radialSourceSlot(q: RadialSlotQuery): number {
  const order = q.order ?? 'direction-major';
  const start = q.startSlot ?? 1;
  const dirIndex = RADIAL_DIRECTIONS.indexOf(q.direction);
  const perPage = q.buttonsPerPage * RADIAL_SLOTS_PER_BUTTON;
  const withinPage =
    order === 'direction-major'
      ? dirIndex * q.buttonsPerPage + q.buttonIndex
      : q.buttonIndex * RADIAL_SLOTS_PER_BUTTON + dirIndex;
  return start + q.page * perPage + withinPage;
}

/** Pages needed to cover `totalSlots`. At 4 buttons this is 2 pages for the full
 *  33-slot span, against the 7 the flat paged ring needs. */
export function radialPageCount(totalSlots: number, buttonsPerPage: number): number {
  const perPage = Math.max(1, buttonsPerPage * RADIAL_SLOTS_PER_BUTTON);
  return Math.max(1, Math.ceil(totalSlots / perPage));
}

/** Whether a button plus direction maps to a real slot, so the tail positions on
 *  the last page stay hidden and non-interactive (the same contract the flat
 *  paged ring holds for its empty tail). */
export function radialHasSourceSlot(q: RadialSlotQuery, totalSlots: number): boolean {
  const start = q.startSlot ?? 1;
  return radialSourceSlot(q) < start + totalSlots;
}

export interface PetalPlacement {
  direction: RadialDirection;
  /** Offset from the radial origin, in px. */
  dx: number;
  dy: number;
}

export interface RadialPlacement {
  /** The radial's centre, already nudged so every petal stays on screen. */
  originX: number;
  originY: number;
  petals: PetalPlacement[];
}

export interface RadialPlacementInput {
  buttonCx: number;
  buttonCy: number;
  viewportWidth: number;
  viewportHeight: number;
  radius: number;
  /** Half-size of a petal, so the clamp keeps the whole petal on screen. */
  petalHalf: number;
  /** Extra clearance from the viewport edge (safe areas, rounded corners). */
  margin?: number;
}

/**
 * Place a radial so no petal lands off-screen. The ring buttons sit close to the
 * bottom-right corner, so an unclamped radial would push its right and down
 * petals past the edge. The origin is nudged inward instead of shrinking or
 * dropping petals, which keeps every direction reachable and the geometry
 * identical for every button (muscle memory depends on that being stable).
 */
export function placeRadial(input: RadialPlacementInput): RadialPlacement {
  const margin = input.margin ?? 0;
  const reach = input.radius + input.petalHalf + margin;
  const clampedX = Math.min(Math.max(input.buttonCx, reach), input.viewportWidth - reach);
  const clampedY = Math.min(Math.max(input.buttonCy, reach), input.viewportHeight - reach);
  const r = input.radius;
  return {
    // A viewport narrower than two reaches cannot satisfy both clamps; the
    // centre is the least-bad answer and keeps the radial symmetric.
    originX: input.viewportWidth >= reach * 2 ? clampedX : input.viewportWidth / 2,
    originY: input.viewportHeight >= reach * 2 ? clampedY : input.viewportHeight / 2,
    petals: [
      { direction: 'center', dx: 0, dy: 0 },
      { direction: 'up', dx: 0, dy: -r },
      { direction: 'right', dx: r, dy: 0 },
      { direction: 'down', dx: 0, dy: r },
      { direction: 'left', dx: -r, dy: 0 },
    ],
  };
}

// The linear strip variant. Consumables are a homogeneous list of six rather
// than four distinct choices, so a row that extends from the button is the
// better shape. It must be able to grow either way: the consumables seat sits at
// the right end of the ring and has to grow LEFT, while a menu control at the
// left edge grows RIGHT. Same maths, mirrored, so there is one tested
// implementation rather than two.

/** Travel before the strip commits to an item rather than the tap action.
 *  Matches the radial deadzone so the whole HUD speaks one gesture language. */
export const STRIP_DEADZONE_PX = FLICK_DEADZONE_PX;

export type StripDirection = 'left' | 'right';

/** Travel between adjacent items as the FINGER sees it, shared by every strip
 *  menu. Deliberately smaller than the visual pitch: at the drawn spacing the
 *  far item of a six- or nine-item row would need 300 to 500px of drag, past a
 *  comfortable thumb arc, while 34px traverses the whole row in roughly 200px
 *  without the items looking cramped. ONE constant rather than one per menu, so
 *  the swipe distance a player learns on one row is the distance on the next. */
export const STRIP_PITCH_PX = 34;

/**
 * Whether the cancel target is the live choice. It is a PLACE, not a direction:
 * the X sits on the anchoring control itself, so the band the finger started in
 * is the way out and the Y a thumb arc wanders to never matters.
 */
export function stripCancelIsLive(index: number, revealed: boolean): boolean {
  return revealed && index < 0;
}

/**
 * Whether a drag that just moved onto an item should pull the row up early.
 * Passing the deadzone is itself intent, so the player never waits out the
 * reveal timer to see what they already committed to.
 */
export function shouldRevealStrip(index: number, revealed: boolean): boolean {
  return !revealed && index >= 0;
}

export interface StripPlacementInput {
  /** Centre of the anchoring button. */
  anchorX: number;
  anchorY: number;
  count: number;
  itemSize: number;
  gap: number;
  viewportWidth: number;
  margin?: number;
  direction?: StripDirection;
}

export interface StripPlacement {
  /** Centre-x per item, index 0 nearest the anchor. */
  centers: number[];
  /** Distance between adjacent item centres. */
  pitch: number;
  /** True when the row had to be shifted to stay on screen, which means the far
   *  item no longer sits under its natural swipe distance. */
  clamped: boolean;
}

/**
 * Lay the strip out from the anchor, clamped so the far end stays on screen. The
 * pitch is preserved under clamping (the whole row shifts rather than
 * compressing), because the swipe distance to item N has to stay predictable or
 * the muscle memory the design depends on never forms.
 */
export function placeConsumableStrip(input: StripPlacementInput): StripPlacement {
  const margin = input.margin ?? 0;
  const direction = input.direction ?? 'left';
  const sign = direction === 'left' ? -1 : 1;
  const pitch = input.itemSize + input.gap;
  if (input.count <= 0) return { centers: [], pitch, clamped: false };
  const half = input.itemSize / 2;
  const centers: number[] = [];
  for (let i = 0; i < input.count; i++) centers.push(input.anchorX + sign * pitch * (i + 1));
  const last = centers[centers.length - 1] ?? input.anchorX;
  const shortfall =
    direction === 'left' ? margin - (last - half) : last + half - (input.viewportWidth - margin);
  const clamped = shortfall > 0;
  if (clamped) {
    const shift = direction === 'left' ? shortfall : -shortfall;
    for (let i = 0; i < centers.length; i++) centers[i] += shift;
  }
  return { centers, pitch, clamped };
}

export interface StripDimInput {
  /** Centre of the anchoring button. */
  anchorX: number;
  /** Item centres from placeConsumableStrip, index 0 nearest the anchor. */
  centers: readonly number[];
  /** How many of those positions are actually open; the tail stays hidden. */
  count: number;
  itemSize: number;
}

export interface StripDimSpan {
  /** Left edge of the dim band, in the anchor's own space. */
  left: number;
  /** Length of the band along the row axis. Zero closes the dim entirely. */
  width: number;
  /** True when the anchor is at the band's RIGHT edge, i.e. the row grew
   *  leftward. It is what the fade has to start from, so the painter reports it
   *  rather than the direction: the row's own centres already carry the mirror. */
  anchorAtRight: boolean;
}

/**
 * The band the local dim covers: a line from the anchor along the row, ending
 * one item size past the LAST OPEN item's centre so the fade lands clear of it.
 * A circle cannot do this job. The row is many items long and its anchor sits at
 * one end of the bottom band, so any circle wide enough to reach the far item
 * also washes half the screen on the side the row never reaches, which reads as
 * a dim anchored on the screen edge rather than on the control.
 */
export function stripDimSpan(input: StripDimInput): StripDimSpan {
  const open = Math.min(input.count, input.centers.length);
  if (open <= 0) return { left: input.anchorX, width: 0, anchorAtRight: false };
  const last = input.centers[open - 1];
  if (!Number.isFinite(last)) return { left: input.anchorX, width: 0, anchorAtRight: false };
  const anchorAtRight = last < input.anchorX;
  const width = Math.abs(last - input.anchorX) + input.itemSize;
  return { left: anchorAtRight ? input.anchorX - width : input.anchorX, width, anchorAtRight };
}

/**
 * Which strip item a horizontal drag is over, or -1 while still inside the
 * deadzone (meaning the gesture is still a tap). Travel along the direction the
 * row grows selects increasing indices. Vertical travel is ignored on purpose: a
 * thumb arc is a curve, not a straight line, so demanding a horizontal path
 * would reject perfectly clear gestures.
 */
export function resolveStripIndex(
  dx: number,
  pitch: number,
  count: number,
  deadzone: number = STRIP_DEADZONE_PX,
  direction: StripDirection = 'left',
): number {
  if (count <= 0) return -1;
  const travel = direction === 'left' ? -dx : dx;
  if (travel < deadzone) return -1;
  const index = Math.floor(travel / pitch);
  return Math.min(Math.max(index, 0), count - 1);
}

/** Nominal half-width of a strip menu's live caption box, used to clamp its
 *  centre on screen without measuring it (a painter may take no forced layout
 *  read). Wider than the longest caption either row shows at the compact tier's
 *  text size, so the clamp errs toward keeping the box fully visible. */
export const STRIP_CAPTION_HALF_PX = 56;

export interface StripCaptionInput {
  /** Item centres from placeConsumableStrip, index 0 nearest the anchor. */
  centers: readonly number[];
  /** The item the finger is over, or -1 for none. */
  live: number;
  viewportWidth: number;
  margin: number;
  halfWidth?: number;
}

/**
 * Where a strip menu's caption centre parks: over the live item, clamped so the
 * box stays on screen. Returns null when nothing is live, which is what hides
 * it: ONE caption for the item being chosen, never a permanent label per item
 * (labels at this pitch collide and clip, and they name things the player is
 * not choosing). Shared by both strip menus, like the geometry above.
 */
export function stripCaptionCenterX(input: StripCaptionInput): number | null {
  const center = input.live >= 0 ? input.centers[input.live] : undefined;
  if (center === undefined || !Number.isFinite(center)) return null;
  const half = input.halfWidth ?? STRIP_CAPTION_HALF_PX;
  const min = input.margin + half;
  const max = input.viewportWidth - input.margin - half;
  // A viewport narrower than the caption itself cannot satisfy both bounds; the
  // centre is the least-bad answer and keeps the box symmetric.
  if (max < min) return input.viewportWidth / 2;
  return Math.min(Math.max(center, min), max);
}
