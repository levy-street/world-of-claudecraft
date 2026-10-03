// Pure plan for the Drowned Temple's floor telegraphs (temple_fx.ts): which
// cast, aura or encounter object draws which floor shape, how big, in what
// colour, and how it fills, all derived from the sim's own templates and
// encounter constants so the edge a player dodges is the edge the sim tests.
//
// Three-free, DOM-free, deterministic.

import { MOBS } from '../../sim/data';
import {
  BRINE_SPIT_TEMPLATE,
  CHORUS_ECHO_TEMPLATE,
  COLOSSUS_MOONLIGHT_LANCE,
  COLOSSUS_RESONANT_SLAM,
  COLOSSUS_TUNING,
  HYDRA_CRUSHING_TORRENT,
  HYDRA_TIDE_BREATH,
  HYDRA_TUNING,
  RIPTIDE_TEMPLATE,
  SELTHE_CHORUS_MARK,
  SELTHE_SEA_SONG,
  SELTHE_SOLO_MARK,
  SELTHE_TUNING,
  SOLO_ECHO_TEMPLATE,
  VENOM_POOL_TEMPLATE,
  YSOLEI_LUNAR_TIDE,
  YSOLEI_TUNING,
  YSOLEI_UNDERTOW,
} from '../../sim/encounters/drowned_temple/ids';
import {
  TEMPLE_CALL_THE_TIDE,
  TEMPLE_GLIMMER_VENOM,
  TEMPLE_LIGHTNING_SPIT,
  TEMPLE_LULLABY,
  TEMPLE_PALE_MENDING,
  TEMPLE_PEARL_SLAM,
  TEMPLE_SKEWERING_TRIDENT,
  TEMPLE_SNAP,
  TEMPLE_STATIC_COIL,
  TEMPLE_TRIDENT_SWEEP,
} from '../../sim/mob/trash_kit/temple_cast_ids';
import { TELEGRAPH_ACCENTS, TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';

export type TempleTelegraphShape = 'cone' | 'ring' | 'lane' | 'sigil';

export interface TempleTelegraphSpec {
  shape: TempleTelegraphShape;
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

/** The temple's own element accents: moonlight, the choir's gold, the prism's
 *  violet, the eel's lightning. */
export const TEMPLE_ACCENTS = {
  moon: 0xdde8f5,
  choir: 0xe3c06a,
  prism: 0xb9a6ff,
  storm: 0x9fdcff,
  tide: 0x6fe3e0,
  venom: 0x9cf06a,
} as const;

function cone(templateId: string): { range: number; arcDeg: number } {
  const b = MOBS[templateId]?.breathCone;
  return { range: b?.range ?? 0, arcDeg: b?.arcDeg ?? 0 };
}

/** Every cast that paints the floor while its bar runs, trash and bosses. */
export function templeTelegraphSpecs(): Readonly<Record<string, TempleTelegraphSpec>> {
  const coil = MOBS.lagoon_eel?.trashKit?.screech;
  const spit = MOBS.lagoon_eel?.trashKit?.line;
  const hurl = MOBS.drowned_templeguard?.trashKit?.line;
  const slam = MOBS.pearlguard_sentinel?.trashKit?.wingGust;
  return {
    // The sixth pass: the trash's second jobs and the Hydra's water lane.
    [TEMPLE_SKEWERING_TRIDENT]: {
      shape: 'lane',
      range: hurl?.length ?? 0,
      arcDeg: 0,
      halfWidth: hurl?.halfWidth ?? 1,
      color: TELEGRAPH_THREAT_COLORS.danger,
      accent: TELEGRAPH_ACCENTS.physical,
    },
    [TEMPLE_LIGHTNING_SPIT]: {
      shape: 'lane',
      range: spit?.length ?? 0,
      arcDeg: 0,
      halfWidth: spit?.halfWidth ?? 1,
      color: TELEGRAPH_THREAT_COLORS.danger,
      accent: TEMPLE_ACCENTS.storm,
    },
    [TEMPLE_PEARL_SLAM]: {
      shape: 'ring',
      range: slam?.radius ?? 0,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.danger,
      accent: TEMPLE_ACCENTS.moon,
    },
    [TEMPLE_PALE_MENDING]: {
      shape: 'sigil',
      range: 1.8,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.interrupt,
      accent: TEMPLE_ACCENTS.moon,
    },
    [TEMPLE_GLIMMER_VENOM]: {
      shape: 'sigil',
      range: 1.6,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.interrupt,
      accent: TEMPLE_ACCENTS.venom,
    },
    [HYDRA_CRUSHING_TORRENT]: {
      shape: 'lane',
      range: HYDRA_TUNING.torrentLength,
      arcDeg: 0,
      halfWidth: HYDRA_TUNING.torrentHalfWidth,
      color: TELEGRAPH_THREAT_COLORS.lethal,
      accent: TEMPLE_ACCENTS.tide,
    },
    [TEMPLE_TRIDENT_SWEEP]: {
      shape: 'cone',
      ...cone('drowned_templeguard'),
      color: TELEGRAPH_THREAT_COLORS.danger,
    },
    [TEMPLE_SNAP]: {
      shape: 'cone',
      ...cone('lagoon_snapper'),
      color: TELEGRAPH_THREAT_COLORS.danger,
    },
    [TEMPLE_STATIC_COIL]: {
      shape: 'ring',
      range: coil?.radius ?? 0,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.control,
      accent: TEMPLE_ACCENTS.storm,
    },
    [TEMPLE_LULLABY]: {
      shape: 'sigil',
      range: 1.8,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.interrupt,
      accent: TEMPLE_ACCENTS.moon,
    },
    [TEMPLE_CALL_THE_TIDE]: {
      shape: 'sigil',
      range: 2.2,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.interrupt,
      accent: TEMPLE_ACCENTS.tide,
    },
    [HYDRA_TIDE_BREATH]: {
      shape: 'cone',
      range: HYDRA_TUNING.breathRange,
      arcDeg: HYDRA_TUNING.breathArcDeg,
      color: TELEGRAPH_THREAT_COLORS.lethal,
      accent: TELEGRAPH_ACCENTS.frost,
    },
    [COLOSSUS_MOONLIGHT_LANCE]: {
      shape: 'lane',
      range: COLOSSUS_TUNING.lanceLength,
      arcDeg: 0,
      halfWidth: COLOSSUS_TUNING.lanceHalfWidth,
      color: TELEGRAPH_THREAT_COLORS.lethal,
      accent: TEMPLE_ACCENTS.prism,
    },
    [COLOSSUS_RESONANT_SLAM]: {
      shape: 'ring',
      range: COLOSSUS_TUNING.slamRadius,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.lethal,
      accent: TEMPLE_ACCENTS.prism,
    },
    [YSOLEI_LUNAR_TIDE]: {
      shape: 'ring',
      range: YSOLEI_TUNING.lunarRadius,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.danger,
      accent: TEMPLE_ACCENTS.moon,
    },
    // The Undertow's bar shows where the Tidal Crash will land.
    [YSOLEI_UNDERTOW]: {
      shape: 'ring',
      range: YSOLEI_TUNING.crashRadius,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.lethal,
      accent: TEMPLE_ACCENTS.tide,
    },
    // Selthe's Sea-Song hits the whole court: a glyph under her, not a zone.
    [SELTHE_SEA_SONG]: {
      shape: 'sigil',
      range: 3,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.danger,
      accent: TEMPLE_ACCENTS.choir,
    },
  };
}

/** A floor circle an encounter OBJECT stands for: its colour, and how long it
 *  takes to fill (0: a standing hazard that pulses instead). The radius is the
 *  object's own scale. */
export interface TempleObjectSpec {
  color: number;
  accent: number;
  fillSeconds: number;
}

export const TEMPLE_OBJECT_SPECS: Readonly<Record<string, TempleObjectSpec>> = {
  [BRINE_SPIT_TEMPLATE]: {
    color: TELEGRAPH_THREAT_COLORS.danger,
    accent: TEMPLE_ACCENTS.venom,
    fillSeconds: HYDRA_TUNING.spitWarn,
  },
  // The venom a Venom Spit leaves: a standing hazard, sickly green.
  [VENOM_POOL_TEMPLATE]: {
    color: 0x7fd64a,
    accent: TEMPLE_ACCENTS.venom,
    fillSeconds: 0,
  },
  [CHORUS_ECHO_TEMPLATE]: {
    color: TELEGRAPH_THREAT_COLORS.danger,
    accent: TEMPLE_ACCENTS.choir,
    fillSeconds: SELTHE_TUNING.echoAfter,
  },
  [SOLO_ECHO_TEMPLATE]: {
    color: TELEGRAPH_THREAT_COLORS.danger,
    accent: TEMPLE_ACCENTS.moon,
    fillSeconds: SELTHE_TUNING.echoAfter,
  },
  [RIPTIDE_TEMPLATE]: {
    color: TELEGRAPH_THREAT_COLORS.danger,
    accent: TEMPLE_ACCENTS.tide,
    fillSeconds: 0,
  },
};

/** A player's mark (an aura on them): the ring it draws round them. Chorus
 *  is GOLD and gathers (stack in it), Solo is COLD BLUE and flies apart (get
 *  out of everyone's way): the pair is read from colour and motion. */
export interface TempleMarkSpec {
  radius: number;
  color: number;
  accent: number;
  seconds: number;
  /** The motes stream inward (gather) or outward (scatter). */
  gather: boolean;
}

export const TEMPLE_MARK_SPECS: Readonly<Record<string, TempleMarkSpec>> = {
  [SELTHE_CHORUS_MARK]: {
    radius: SELTHE_TUNING.chorusRadius,
    color: 0xffc94a,
    accent: TEMPLE_ACCENTS.choir,
    seconds: SELTHE_TUNING.markSeconds,
    gather: true,
  },
  [SELTHE_SOLO_MARK]: {
    radius: SELTHE_TUNING.soloRadius,
    color: 0x4aa8ff,
    accent: TEMPLE_ACCENTS.moon,
    seconds: SELTHE_TUNING.markSeconds,
    gather: false,
  },
};

/** Fill of a telegraph in [0, 1]: 0 as the bar opens, 1 as it lands. */
export function templeTelegraphFill(castRemaining: number, castTotal: number): number {
  if (castTotal <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - castRemaining / castTotal));
}

/** Fill of a timed object or mark `age` seconds in (1 at its moment). */
export function templeTimedFill(age: number, seconds: number): number {
  if (seconds <= 0) return 1;
  return Math.min(1, Math.max(0, age / seconds));
}

/** The flood's look for a tide half's state (the half-disc over the island). */
export function tideLook(
  state: 'dry' | 'warn' | 'flood',
  clock: number,
): {
  visible: boolean;
  fill: number;
  fade: number;
} {
  if (state === 'dry') return { visible: false, fill: 0, fade: 0 };
  if (state === 'warn') {
    // A shimmer that swells: the half about to flood.
    return { visible: true, fill: 0.25 + 0.2 * Math.sin(clock * 5), fade: 0.7 };
  }
  return { visible: true, fill: 1, fade: 1 };
}
