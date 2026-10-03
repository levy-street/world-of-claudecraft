// Pure plan for the Sunken Bastion's floor telegraphs (bastion_fx.ts): which
// cast draws which floor shape, how big, in what colour, and how it fills,
// all derived from the sim's own templates and encounter constants so the
// edge a player dodges is the edge the sim tests.
//
// Three-free, DOM-free, deterministic.

import { MOBS } from '../../sim/data';
import {
  BASTION_BRINE_MEND,
  BASTION_CLAW_SWEEP,
  BASTION_FOG_WARD,
  BASTION_HALBERD_SWEEP,
  BASTION_PIERCING_BOLT,
  BASTION_SHELL_SLAM,
} from '../../sim/mob/trash_kit/bastion_cast_ids';
import { TELEGRAPH_ACCENTS, TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';

export type BastionTelegraphShape = 'cone' | 'ring' | 'lane' | 'sigil';

export interface BastionTelegraphSpec {
  shape: BastionTelegraphShape;
  /** Yards: the cone's reach, the ring's radius, the lane's length. */
  range: number;
  /** Degrees of the cone's arc (360 for a ring). */
  arcDeg: number;
  /** A lane's half width (yards). */
  halfWidth?: number;
  /** The threat colour (floor_telegraph TELEGRAPH_THREAT_COLORS). */
  color: number;
  /** The element accent of the motes and the fill front. */
  accent?: number;
}

/** The Bastion's telegraphs in the shared threat palette: the colour says
 *  what standing in it costs, the accent carries the element. `frost` stays
 *  the Mist Surge flood's own element hue for the boss dressing. */
export const BASTION_TELEGRAPH_COLORS = {
  physical: TELEGRAPH_THREAT_COLORS.danger,
  lethal: TELEGRAPH_THREAT_COLORS.lethal,
  frost: 0x6fd8ff,
  brine: TELEGRAPH_THREAT_COLORS.danger,
  heal: TELEGRAPH_THREAT_COLORS.interrupt,
  ward: TELEGRAPH_THREAT_COLORS.interrupt,
} as const;

export { TELEGRAPH_ACCENTS, TELEGRAPH_THREAT_COLORS };

function cone(templateId: string): { range: number; arcDeg: number } {
  const b = MOBS[templateId]?.breathCone;
  return { range: b?.range ?? 0, arcDeg: b?.arcDeg ?? 0 };
}

/** Every trash cast that paints the floor while its bar runs. */
export function bastionTelegraphSpecs(): Readonly<Record<string, BastionTelegraphSpec>> {
  const slam = MOBS.turretback_hermit?.trashKit?.wingGust;
  const bolt = MOBS.fogbound_arbalest?.trashKit?.line;
  return {
    [BASTION_HALBERD_SWEEP]: {
      shape: 'cone',
      ...cone('drowned_watchman'),
      color: BASTION_TELEGRAPH_COLORS.physical,
    },
    [BASTION_CLAW_SWEEP]: {
      shape: 'cone',
      ...cone('turretback_hermit'),
      color: BASTION_TELEGRAPH_COLORS.physical,
    },
    [BASTION_SHELL_SLAM]: {
      shape: 'ring',
      range: slam?.radius ?? 0,
      arcDeg: 360,
      color: BASTION_TELEGRAPH_COLORS.lethal,
      accent: TELEGRAPH_ACCENTS.physical,
    },
    [BASTION_PIERCING_BOLT]: {
      shape: 'lane',
      range: bolt?.length ?? 0,
      arcDeg: 0,
      halfWidth: bolt?.halfWidth ?? 1,
      color: BASTION_TELEGRAPH_COLORS.physical,
    },
    // The kickable casts mark their caster (a glyph turning under its feet).
    [BASTION_BRINE_MEND]: {
      shape: 'sigil',
      range: 1.8,
      arcDeg: 360,
      color: BASTION_TELEGRAPH_COLORS.heal,
      accent: TELEGRAPH_ACCENTS.brine,
    },
    [BASTION_FOG_WARD]: {
      shape: 'sigil',
      range: 1.8,
      arcDeg: 360,
      color: BASTION_TELEGRAPH_COLORS.ward,
      accent: TELEGRAPH_ACCENTS.frost,
    },
  };
}

/** Fill of a telegraph in [0, 1]: 0 as the bar opens, 1 as it lands. */
export function bastionTelegraphFill(castRemaining: number, castTotal: number): number {
  if (castTotal <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - castRemaining / castTotal));
}

/**
 * Local (x, z) points of a cone fan about +z, `segments` wedges: the apex
 * first, then the arc from one edge to the other. A ring is the full circle.
 */
export function bastionConeFan(
  range: number,
  arcDeg: number,
  segments: number,
): [number, number][] {
  const half = (Math.min(360, arcDeg) * Math.PI) / 180 / 2;
  const out: [number, number][] = [[0, 0]];
  for (let i = 0; i <= segments; i++) {
    const a = -half + (2 * half * i) / segments;
    out.push([Math.sin(a) * range, Math.cos(a) * range]);
  }
  return out;
}

/** The Barnacle Crawler's Brine Burst: its radius and fuse, from the template. */
export function brineBurstSpec(): { radius: number; delay: number } {
  const d = MOBS.barnacle_crawler?.deathThroes;
  return { radius: d?.radius ?? 0, delay: d?.delay ?? 0 };
}

/** Seconds the burst flash lingers after the fuse. */
export const BRINE_BURST_FLASH = 0.45;

/** The burst's phase `elapsed` seconds after the crawler fell. */
export function brineBurstPhase(
  elapsed: number,
  delay: number,
): { stage: 'fuse' | 'flash' | 'done'; fill: number } {
  if (elapsed < delay) return { stage: 'fuse', fill: delay > 0 ? elapsed / delay : 1 };
  if (elapsed < delay + BRINE_BURST_FLASH)
    return { stage: 'flash', fill: (elapsed - delay) / BRINE_BURST_FLASH };
  return { stage: 'done', fill: 1 };
}
