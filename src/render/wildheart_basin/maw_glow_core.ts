// Pure plan for the glow in the stone jaguar's maw (maw_glow.ts): once Zulgar
// falls, the way out opens in the jaws (the boss exit portal, sim/content/
// wildheart.ts `bossExitPortal` at JAGUAR_MAW.portal), and spirit light wells
// up out of the throat over the jaw and the teeth. Which world object is that
// portal (the basin's other dungeon_exit is the entrance's, at the Idol Maw),
// how bright the glow burns as it opens, and where its cards stand in the
// basin frame. Three-free, DOM-free, deterministic.

import { JAGUAR_MAW, WILDHEART_BASIN_FIELD } from '../../sim/content/wildheart_basin_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import { authoredFieldHeight } from '../../sim/instances/authored_field';

const BASIN = 'wildheart_basin';

/** Is this world object the exit portal standing in the jaguar's maw? */
export function isBasinMawPortal(e: {
  kind: string;
  templateId: string;
  dungeonId?: string | null;
  pos: { x: number; z: number };
}): boolean {
  if (e.kind !== 'object' || e.templateId !== 'dungeon_exit' || e.dungeonId !== BASIN) return false;
  const def = DUNGEONS[BASIN];
  if (!def) return false;
  const o = instanceOrigin(def.index, instanceSlotForZ(e.pos.z));
  return Math.hypot(e.pos.x - o.x - JAGUAR_MAW.portal.x, e.pos.z - o.z - JAGUAR_MAW.portal.z) < 3;
}

/** Seconds the glow takes to well up once the portal opens (and to sink). */
export const MAW_GLOW_RISE = 2.4;

/** Step the glow's level toward open (1) or shut (0) over `dt` seconds. */
export function stepMawGlow(level: number, open: boolean, dt: number): number {
  const step = dt / MAW_GLOW_RISE;
  return open ? Math.min(1, level + step) : Math.max(0, level - step);
}

/** The glow's drawn strength at `level` (0 to 1) and clock `t`: a slow
 *  breathing swell, as if the stone jaguar exhaled the light. */
export function mawGlowStrength(level: number, t: number): number {
  if (level <= 0) return 0;
  const ease = level * level * (3 - 2 * level);
  return ease * (0.82 + 0.18 * Math.sin(t * 1.7) * Math.sin(t * 0.63 + 1.1));
}

export interface MawGlowCard {
  /** 'halo' a camera-facing glow card; 'pool' a light pool on the jaw. */
  kind: 'halo' | 'pool';
  /** Jade spirit light from the throat, or the portal's warm gold. */
  tone: 'jade' | 'gold';
  x: number;
  y: number;
  z: number;
  /** Halo width and height, or the pool's radius (both yards). */
  w: number;
  h: number;
  /** Full opacity at strength 1. */
  opacity: number;
}

export const MAW_GLOW_COLORS = { jade: 0x6ff0b0, gold: 0xffcf7a } as const;

/** The glow's cards, in the basin frame: the throat's deep jade well behind
 *  the tongue, a gold bloom round the portal on the jaw, a softer halo under
 *  the roof of the mouth, and the light pooled on the jaw and the lip. */
export function planMawGlow(): MawGlowCard[] {
  const m = JAGUAR_MAW;
  const portalFloor = authoredFieldHeight(WILDHEART_BASIN_FIELD, m.portal.x, m.portal.z);
  const lip = m.floor[1];
  const mid = (m.minZ + m.maxZ) / 2;
  return [
    { kind: 'halo', tone: 'jade', x: m.x, y: m.jawY + 4.5, z: mid + 4, w: 20, h: 13, opacity: 0.9 },
    {
      kind: 'halo',
      tone: 'jade',
      x: m.x,
      y: m.roofY - 3,
      z: m.portal.z + 3,
      w: 16,
      h: 7,
      opacity: 0.45,
    },
    {
      kind: 'halo',
      tone: 'gold',
      x: m.portal.x,
      y: portalFloor + 2.4,
      z: m.portal.z + 0.6,
      w: 9,
      h: 8,
      opacity: 0.7,
    },
    {
      kind: 'pool',
      tone: 'jade',
      x: m.x,
      y: portalFloor + 0.08,
      z: m.portal.z,
      w: 7,
      h: 7,
      opacity: 0.5,
    },
    {
      kind: 'pool',
      tone: 'gold',
      x: m.x,
      y: lip[1] + 0.06,
      z: lip[0] + 0.5,
      w: 6,
      h: 6,
      opacity: 0.32,
    },
  ];
}
