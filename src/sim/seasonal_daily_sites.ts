// Where Gourdlight Eve's daily errands lay their world pieces, resolved against the LIVE
// world (the city dressing's rule, seasonal_decor_layout.ts: never a coordinate beside
// today's buildings, so a rework moves the pieces with it):
//   - the stray PATCH PUMPKINS lie on a ring round Old Thatchgrin's resolved field
//     (seasonal/scarecrow_field.ts), past his dressed straw and past the farthest he
//     ever notices a passer-by, on dry, open, gentle ground off the roads;
//   - the CURSED CANDLES stand at the feet of each event town's own lamp posts (the sim's
//     lamp plan), on the side away from the road, clear of the street dressing, the
//     keeper's stall, every NPC's spot, the chapels and every collider.
// A candidate that fails is nudged round a small spiral; one that never passes is
// dropped, never forced. Pure and deterministic: no rng (variety hashes the anchor), no
// clock. Memoized per (world content, seed). Pinned by tests/gourdlight_dailies.test.ts.
import { isBlocked, streetlampPlacements } from './colliders';
import { CURSED_CANDLES_PER_TOWN, PATCH_PUMPKIN_SITES } from './content/gourdlight_eve_dailies';
import { GOURDLIGHT_DECOR_CITIES } from './content/gourdlight_eve_decor';
import { GOURDLIGHT_PUMPKINS } from './content/gourdlight_pumpkins';
import { getActiveWorldContent, NPCS } from './data';
import { hash2 } from './rng';
import { resolveScarecrowField } from './seasonal/scarecrow_field';
import { chapelAt } from './seasonal_decor_exclusions';
import { seasonalDecorLayout } from './seasonal_decor_layout';
import { insideStall } from './seasonal_decor_stall';
import { groundHeight, isCliffFace, roadDistance, WATER_LEVEL } from './world';

export interface DailySite {
  x: number;
  z: number;
  /** Which way the piece turns (radians). */
  yaw: number;
  /** What it was resolved from ('patch:<i>', 'candle:<zone>:<lamp index>'). */
  anchor: string;
}

/** Off the painted track by at least this much (yards). */
export const DAILY_SITE_ROAD_CLEARANCE = 3.2;
/** Two pieces of one errand keep this far apart (yards). */
export const DAILY_SITE_SPACING = 2.5;
/** A candle keeps this far from every piece of the street dressing and every NPC. */
export const CANDLE_DECOR_CLEARANCE = 1.1;

const NUDGES: readonly { dx: number; dz: number }[] = (() => {
  const out = [{ dx: 0, dz: 0 }];
  for (const r of [0.5, 1, 1.6, 2.3, 3.2, 4.4]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + r;
      out.push({ dx: Math.sin(a) * r, dz: Math.cos(a) * r });
    }
  }
  return out;
})();

function anchorHash(anchor: string, salt: number): number {
  let h = 0;
  for (let i = 0; i < anchor.length; i++) h = (h * 31 + anchor.charCodeAt(i)) | 0;
  return hash2(h, salt, 0x51d7);
}

function openGround(seed: number, x: number, z: number, radius: number): boolean {
  if (groundHeight(x, z, seed) < WATER_LEVEL + 0.5) return false;
  if (roadDistance(x, z) < DAILY_SITE_ROAD_CLEARANCE) return false;
  if (chapelAt(x, z) !== null) return false;
  if (isCliffFace(x, z, seed)) return false;
  if (GOURDLIGHT_PUMPKINS.some((p) => Math.hypot(p.x - x, p.z - z) < 3)) return false;
  return !isBlocked(seed, x, z, radius);
}

/** The stray pumpkins round the patch (none when the world has no field). */
export function resolvePatchPumpkinSites(seed: number): DailySite[] {
  const field = resolveScarecrowField(seed);
  if (!field) return [];
  const out: DailySite[] = [];
  const [inner, outer] = PATCH_PUMPKIN_SITES.ring;
  for (let i = 0; i < PATCH_PUMPKIN_SITES.count; i++) {
    const anchor = `patch:${i}`;
    const a = (i / PATCH_PUMPKIN_SITES.count) * Math.PI * 2 + (anchorHash(anchor, 1) - 0.5) * 0.4;
    const r = inner + (outer - inner) * anchorHash(anchor, 2);
    for (const n of NUDGES) {
      const x = field.x + Math.sin(a) * r + n.dx;
      const z = field.z + Math.cos(a) * r + n.dz;
      const d = Math.hypot(x - field.x, z - field.z);
      if (d < inner || d > outer) continue;
      if (!openGround(seed, x, z, 0.6)) continue;
      if (out.some((s) => Math.hypot(s.x - x, s.z - z) < DAILY_SITE_SPACING * 2)) continue;
      out.push({ x, z, yaw: anchorHash(anchor, 3) * Math.PI * 2, anchor });
      break;
    }
  }
  return out;
}

/** The cursed candles at the feet of each event town's lamp posts. */
export function resolveCursedCandleSites(seed: number): DailySite[] {
  const zones = getActiveWorldContent().zones;
  const lamps = streetlampPlacements(seed);
  const decor = seasonalDecorLayout(seed);
  const npcSpots = Object.values(NPCS).map((n) => n.pos);
  const out: DailySite[] = [];
  for (const rule of GOURDLIGHT_DECOR_CITIES) {
    const hub = zones.find((z) => z.id === rule.zoneId)?.hub;
    if (!hub) continue;
    const town = lamps
      .map((lamp, index) => ({
        lamp,
        index,
        distance: Math.hypot(lamp.x - hub.x, lamp.z - hub.z),
      }))
      // Rebuilt towns may have fewer than five posts inside the dressing ring.
      // Try those first, then nearby approach posts, preserving all clearance checks.
      .filter(({ distance }) => distance <= rule.radius + 12)
      .sort(
        (a, b) =>
          Number(a.distance > rule.radius) - Number(b.distance > rule.radius) ||
          anchorHash(`candle:${rule.zoneId}:${a.index}`, 4) -
            anchorHash(`candle:${rule.zoneId}:${b.index}`, 4) ||
          a.index - b.index,
      );
    let placed = 0;
    for (const { lamp, index } of town) {
      if (placed >= CURSED_CANDLES_PER_TOWN) break;
      const anchor = `candle:${rule.zoneId}:${index}`;
      // the post's far side from the road, a step along the verge from its own pumpkin
      const back = lamp.roadYaw + Math.PI;
      const along = lamp.roadYaw + Math.PI / 2;
      const side = anchorHash(anchor, 5) < 0.5 ? 1 : -1;
      const bx = lamp.x + Math.sin(back) * 0.9 + Math.sin(along) * 2 * side;
      const bz = lamp.z + Math.cos(back) * 0.9 + Math.cos(along) * 2 * side;
      for (const n of NUDGES) {
        const x = bx + n.dx;
        const z = bz + n.dz;
        if (!openGround(seed, x, z, 0.35)) continue;
        if (decor.ground.some((p) => Math.hypot(p.x - x, p.z - z) < CANDLE_DECOR_CLEARANCE + 0.6))
          continue;
        if (decor.stalls.some((st) => insideStall(st, x, z, 1))) continue;
        if (npcSpots.some((p) => Math.hypot(p.x - x, p.z - z) < CANDLE_DECOR_CLEARANCE + 0.4))
          continue;
        if (out.some((s) => Math.hypot(s.x - x, s.z - z) < DAILY_SITE_SPACING * 3)) continue;
        out.push({ x, z, yaw: lamp.roadYaw, anchor });
        placed++;
        break;
      }
    }
  }
  return out;
}

const memo = new WeakMap<object, Map<number, { patch: DailySite[]; candles: DailySite[] }>>();

/** Both errands' sites, memoized per active world and seed. */
export function gourdlightDailySites(seed: number): {
  patch: readonly DailySite[];
  candles: readonly DailySite[];
} {
  const content = getActiveWorldContent();
  let bySeed = memo.get(content);
  if (!bySeed) {
    bySeed = new Map();
    memo.set(content, bySeed);
  }
  let sites = bySeed.get(seed);
  if (!sites) {
    sites = { patch: resolvePatchPumpkinSites(seed), candles: resolveCursedCandleSites(seed) };
    bySeed.set(seed, sites);
  }
  return sites;
}
