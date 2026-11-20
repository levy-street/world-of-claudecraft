// The raid atlas's boss pins as data: whose faces a boss medallion carries
// (the Hammer Council is one encounter of two, so one pin with both faces),
// where each baked portrait lives, the boss tooltip's model (name, encounter
// subtitle, state line, lore) and the hit test that finds the pin under a
// point of the atlas canvas at the camera's current zoom and pan.
//
// The portraits are head-and-shoulders busts of each boss's REAL in-game model,
// rendered by scripts/raid_atlas/render_boss_portraits.mjs into
// public/ui/raid-atlas/<mobId>.webp. Names come from the mob catalog
// (mobDisplayName, injected so this stays a pure core); every other line is a
// hudChrome.raidAtlas.boss.* key.
//
// DOM-free, deterministic.

import type { TranslationKey } from '../../i18n';
import type { RaidAtlasBoss, RaidAtlasFloorId } from './raid_atlas_plan_core';
import type { RaidAtlasBossMark, RaidAtlasBossState } from './raid_atlas_view';

/** Where the committed busts are served from. */
export const RAID_ATLAS_PORTRAIT_DIR = '/ui/raid-atlas';

/** The bust of a boss body (any of the plan's `mobId` / `bodyIds`). */
export function raidAtlasPortraitUrl(mobId: string): string {
  return `${RAID_ATLAS_PORTRAIT_DIR}/${mobId}.webp`;
}

/** The faces a boss medallion shows: the lead first, then any partner (a
 *  council's other member, drawn as a smaller medallion beside the lead). */
export function raidAtlasBossFaces(boss: RaidAtlasBoss): readonly string[] {
  const rest = boss.bodyIds.filter((id) => id !== boss.mobId);
  return [boss.mobId, ...rest];
}

/** The state the tooltip and the medallion read: a boss nobody can see yet
 *  (neither its body nor the seal in interest) still stands. */
export type RaidAtlasBossShownState = 'alive' | 'engaged' | 'dead';

export function raidAtlasShownState(state: RaidAtlasBossState): RaidAtlasBossShownState {
  return state === 'unknown' ? 'alive' : state;
}

const BOSS_KEY = 'hudChrome.raidAtlas.boss';

/** The tooltip's content, resolved to keys and the names it is built from. */
export interface RaidAtlasBossTooltipModel {
  /** Encounter id (its vein, or 'final'): the tooltip's identity. */
  id: RaidAtlasBoss['id'];
  /** Portrait URLs, lead first. */
  portraits: readonly string[];
  /** The title: an encounter name key (a council), else null (use `names[0]`). */
  titleKey: TranslationKey | null;
  /** The bodies' display names, lead first. */
  names: readonly string[];
  subtitleKey: TranslationKey;
  state: RaidAtlasBossShownState;
  stateKey: TranslationKey;
  loreKey: TranslationKey;
}

/** The encounter title for bosses that are more than one body. */
function titleKeyOf(boss: RaidAtlasBoss): TranslationKey | null {
  return boss.bodyIds.length > 1 ? (`${BOSS_KEY}.${boss.id}.title` as TranslationKey) : null;
}

export function raidAtlasBossTooltip(
  mark: RaidAtlasBossMark,
  nameOf: (mobId: string) => string,
): RaidAtlasBossTooltipModel {
  const { boss } = mark;
  const faces = raidAtlasBossFaces(boss);
  const state = raidAtlasShownState(mark.state);
  return {
    id: boss.id,
    portraits: faces.map(raidAtlasPortraitUrl),
    titleKey: titleKeyOf(boss),
    names: faces.map(nameOf),
    subtitleKey: `${BOSS_KEY}.${boss.id}.subtitle` as TranslationKey,
    state,
    stateKey: `${BOSS_KEY}.state.${state}` as TranslationKey,
    loreKey: `${BOSS_KEY}.${boss.id}.lore` as TranslationKey,
  };
}

/** A partner medallion's offset from the lead's centre and its radius, as
 *  shares of the lead's radius (lower right, overlapping the rim). */
export const RAID_ATLAS_PARTNER = { dx: 0.78, dy: 0.62, r: 0.56 } as const;

/** Extra CSS px round a medallion that still counts as on it (a finger is
 *  wider than a cursor, so touch passes more). */
export const RAID_ATLAS_BOSS_HIT_SLOP = { mouse: 3, touch: 9 } as const;

/**
 * The boss pin under canvas point (x, y) on page `floor`, or null. `project`
 * is the camera's current projection (instance-local yards to canvas px), so
 * the test follows every zoom and pan; `r` the medallion radius as painted.
 * A council's partner medallion counts as its pin. The nearest pin wins.
 */
export function raidAtlasBossAt(
  marks: readonly RaidAtlasBossMark[],
  floor: RaidAtlasFloorId,
  project: (x: number, z: number) => { sx: number; sy: number },
  x: number,
  y: number,
  r: number,
  slop: number,
): RaidAtlasBossMark | null {
  let best: RaidAtlasBossMark | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const mark of marks) {
    if (mark.boss.floor !== floor) continue;
    const p = project(mark.boss.x, mark.boss.z);
    let d = Math.hypot(x - p.sx, y - p.sy) - r;
    if (mark.boss.bodyIds.length > 1) {
      const px = p.sx + r * RAID_ATLAS_PARTNER.dx;
      const py = p.sy + r * RAID_ATLAS_PARTNER.dy;
      d = Math.min(d, Math.hypot(x - px, y - py) - r * RAID_ATLAS_PARTNER.r);
    }
    if (d <= slop && d < bestD) {
      best = mark;
      bestD = d;
    }
  }
  return best;
}

/** Where the tooltip card sits beside a pin, in canvas CSS px (top-left
 *  out): to its right, else its left (vertically centred on it), else below,
 *  else above it (horizontally centred), always kept `gap` px inside the map
 *  face and never over the pin itself while any side leaves room; when none
 *  does, the clamped side that covers the least of the pin. */
export function raidAtlasTooltipPlacement(
  pin: { sx: number; sy: number },
  r: number,
  card: { w: number; h: number },
  side: number,
  gap = 10,
): { left: number; top: number } {
  const clampX = (x: number) => Math.min(Math.max(gap, x), Math.max(gap, side - gap - card.w));
  const clampY = (y: number) => Math.min(Math.max(gap, y), Math.max(gap, side - gap - card.h));
  const fitsX = (x: number) => x >= gap && x + card.w <= side - gap;
  const fitsY = (y: number) => y >= gap && y + card.h <= side - gap;
  const right = pin.sx + r + gap;
  if (fitsX(right)) return { left: right, top: clampY(pin.sy - card.h / 2) };
  const left = pin.sx - r - gap - card.w;
  if (fitsX(left)) return { left, top: clampY(pin.sy - card.h / 2) };
  const below = pin.sy + r + gap;
  if (fitsY(below)) return { left: clampX(pin.sx - card.w / 2), top: below };
  const above = pin.sy - r - gap - card.h;
  if (fitsY(above)) return { left: clampX(pin.sx - card.w / 2), top: above };
  // No side leaves room: of the four sides, clamped onto the face, the one
  // that covers the least of the pin.
  const candidates = [
    { left: clampX(right), top: clampY(pin.sy - card.h / 2) },
    { left: clampX(left), top: clampY(pin.sy - card.h / 2) },
    { left: clampX(pin.sx - card.w / 2), top: clampY(below) },
    { left: clampX(pin.sx - card.w / 2), top: clampY(above) },
  ];
  const covered = (at: { left: number; top: number }) =>
    Math.max(0, Math.min(at.left + card.w, pin.sx + r) - Math.max(at.left, pin.sx - r)) *
    Math.max(0, Math.min(at.top + card.h, pin.sy + r) - Math.max(at.top, pin.sy - r));
  let best = candidates[0];
  for (const at of candidates) if (covered(at) < covered(best)) best = at;
  return best;
}
