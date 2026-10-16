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
  FRACTURE_ROUNDS,
  HYDRA_COMBO_TUNING,
  HYDRA_CRUSHING_TORRENT,
  HYDRA_TIDE_BREATH,
  HYDRA_TUNING,
  MOON_TEAR_TEMPLATE,
  MOONGLOW_TEMPLATE,
  RIME_CRYSTAL_TEMPLATE,
  RIPTIDE_TEMPLATE,
  SELTHE_CHORUS_MARK,
  SELTHE_DROWNING_ARIA,
  SELTHE_MERE_SURGE,
  SELTHE_MOONWATER_BOLT,
  SELTHE_SEA_SONG,
  SELTHE_SOLO_MARK,
  SELTHE_TUNING,
  SOLO_ECHO_TEMPLATE,
  VENOM_CURRENT_TEMPLATE,
  VENOM_POOL_TEMPLATE,
  YSOLEI_BECKONING_MOON,
  YSOLEI_FALLING_MOON,
  YSOLEI_LUNAR_TIDE,
  YSOLEI_TUNING,
  YSOLEI_UNDERTOW,
} from '../../sim/encounters/drowned_temple/ids';
import {
  TEMPLE_ARCING_SPARK,
  TEMPLE_CALL_THE_TIDE,
  TEMPLE_GLIMMER_VENOM,
  TEMPLE_LIGHTNING_SPIT,
  TEMPLE_LULLABY,
  TEMPLE_PALE_MENDING,
  TEMPLE_PEARL_SLAM,
  TEMPLE_PRISM_GLARE,
  TEMPLE_SKEWERING_TRIDENT,
  TEMPLE_SNAP,
  TEMPLE_STATIC_COIL,
  TEMPLE_TRIDENT_SWEEP,
} from '../../sim/mob/trash_kit/temple_cast_ids';
import { TEMPLE_CARAPACE_AURA } from '../../sim/mob/trash_kit/temple_kit';
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

/** The Ice Wraith's reach over the floor (yards from its centre,
 *  at its template scale): it hangs its talons out to this, so a glyph under
 *  it must reach past them or its own body hides it.
 *  Measured off the live rig's skinned vertices under 1.5 yd across its hover
 *  (99th percentile 2.4 to 2.8, the widest vertex 2.86). */
export const TEMPLE_EEL_COIL_RADIUS = 2.9;

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
  const coil = MOBS.ice_wraith?.trashKit?.screech;
  const spit = MOBS.ice_wraith?.trashKit?.line;
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
    // The trash mechanics pass: a kick glyph under the Eel's Arcing Spark,
    // and a glyph under the Lurker's Prism Glare (a gaze, never a kick: the
    // eye over it and its reach rim are temple_trash_fx.ts's). The spark's
    // glyph rings the eel's coil: drawn inside it, the body covered it whole.
    [TEMPLE_ARCING_SPARK]: {
      shape: 'sigil',
      range: TEMPLE_EEL_COIL_RADIUS + 0.5,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.interrupt,
      accent: TEMPLE_ACCENTS.storm,
    },
    [TEMPLE_PRISM_GLARE]: {
      shape: 'sigil',
      range: 3,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.control,
      accent: TEMPLE_ACCENTS.prism,
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
    // Selthe the caster: the Mere Surge's wedge (step out sideways), and a
    // kick glyph under her bolt and her aria (both can be interrupted).
    [SELTHE_MERE_SURGE]: {
      shape: 'cone',
      range: SELTHE_TUNING.surgeRange,
      arcDeg: SELTHE_TUNING.surgeArcDeg,
      color: TELEGRAPH_THREAT_COLORS.danger,
      accent: TEMPLE_ACCENTS.tide,
    },
    [SELTHE_MOONWATER_BOLT]: {
      shape: 'sigil',
      range: 2.4,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.interrupt,
      accent: TEMPLE_ACCENTS.tide,
    },
    [SELTHE_DROWNING_ARIA]: {
      shape: 'sigil',
      range: 3,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.interrupt,
      accent: TEMPLE_ACCENTS.moon,
    },
    // Ysolei calling the moon: neither bar can be kicked; a glyph under her
    // says the moon is coming (the tears, and the ward to break).
    [YSOLEI_BECKONING_MOON]: {
      shape: 'sigil',
      range: 4,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.danger,
      accent: TEMPLE_ACCENTS.moon,
    },
    [YSOLEI_FALLING_MOON]: {
      shape: 'sigil',
      range: 5,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.lethal,
      accent: TEMPLE_ACCENTS.moon,
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
  // The Combined Breath (hydra_combo.ts): a Venom Current pool sliding down
  // its current (a standing hazard, its arrow is temple_hydra_combo_fx.ts's),
  // and a Toxic Rime crystal filling to its wider burst.
  [VENOM_CURRENT_TEMPLATE]: {
    color: 0x7fd64a,
    accent: TEMPLE_ACCENTS.venom,
    fillSeconds: 0,
  },
  [RIME_CRYSTAL_TEMPLATE]: {
    color: TELEGRAPH_THREAT_COLORS.danger,
    accent: TELEGRAPH_ACCENTS.frost,
    fillSeconds: HYDRA_COMBO_TUNING.rimeSeconds,
  },
  // Ysolei's moon (ysolei_moon.ts): a Moonlight Tear's catch circle is
  // SILVER, the one ring in the fight to step INTO; the heroic moonlight it
  // leaves is a hazard.
  [MOON_TEAR_TEMPLATE]: {
    color: 0xe8f0ff,
    accent: TEMPLE_ACCENTS.moon,
    fillSeconds: 0,
  },
  [MOONGLOW_TEMPLATE]: {
    color: TELEGRAPH_THREAT_COLORS.danger,
    accent: TEMPLE_ACCENTS.moon,
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

/** The Tide Pilgrim's frenzy gesture (the manifest maps it to its `Frenzy` clip). */
export const TEMPLE_PILGRIM_FRENZY_GESTURE = 'temple_pilgrim_frenzy';

/** True for the pilgrim's frenzy cue: the classic trash enrage
 *  (sim/mob/boss_mechanics.ts) marks itself with a self-aimed, ability-less
 *  fire 'nova' spellfx (the pilgrim, in game the Drowned Pilgrim, has no other
 *  fire nova). The temple claims it: the snail rears and its shrine blazes
 *  violet in place of the generic fire burst. */
export function isTemplePilgrimFrenzyCue(
  ev: {
    type: string;
    fx?: string;
    school?: string;
    sourceId?: number;
    targetId?: number;
    ability?: string;
  },
  sourceTemplateId: string | undefined,
): boolean {
  return (
    ev.type === 'spellfx' &&
    ev.fx === 'nova' &&
    ev.school === 'fire' &&
    ev.sourceId === ev.targetId &&
    !ev.ability &&
    sourceTemplateId === 'drowned_pilgrim'
  );
}

/** The Pearlguard Sentinel's shell stances (the manifest maps each to a phase
 *  vocabulary, VisualDef.phaseClips): shut while its Pearl Carapace ward holds,
 *  open again once the ward is gone. */
export const TEMPLE_SENTINEL_SHELL_CLOSED = 'temple_sentinel_shell_closed';
export const TEMPLE_SENTINEL_SHELL_OPEN = 'temple_sentinel_shell_open';

/** The shell stance a Pearlguard Sentinel should hold, read off its auras:
 *  closed while the Pearl Carapace absorb ward rides it (the sim's own aura id,
 *  so the shell opens the moment the ward breaks or runs out), open otherwise.
 *  Null for every other body, and for a dead one (its death clip owns it). */
export function templeSentinelShellGesture(
  templateId: string | undefined,
  auras: readonly { id: string }[] | undefined,
  dead: boolean,
): string | null {
  if (templateId !== 'pearlguard_sentinel' || dead) return null;
  for (const a of auras ?? []) {
    if (a.id === TEMPLE_CARAPACE_AURA) return TEMPLE_SENTINEL_SHELL_CLOSED;
  }
  return TEMPLE_SENTINEL_SHELL_OPEN;
}

/** How long a newly wanted shell stance is re-offered (seconds): a rig built a
 *  frame or two after the change, or a pooled rig still holding another
 *  Sentinel's shut shell, still receives it. */
export const TEMPLE_SENTINEL_STANCE_RESEND = 1;

/** A Sentinel's tracked shell stance: what it was told, and when it changed. */
export interface TempleShellTrack {
  stance: string;
  since: number;
}

/** One scan's step of a Sentinel's shell stance. `want` is
 *  templeSentinelShellGesture's answer (null: dead, or not a Sentinel).
 *  - null forgets the track, so a revived Sentinel (the same id) or a new one
 *    on a pooled rig is told its stance afresh;
 *  - a new or changed stance is sent at once and tracked;
 *  - the shut stance is re-sent every scan (a late viewer still sees the
 *    shell), and any stance is re-sent for TEMPLE_SENTINEL_STANCE_RESEND after
 *    it changed (an open stance must reach a rig that was shut).
 *  The rig's phase swap is idempotent, so a repeat costs nothing. */
export function stepTempleShellStance(
  prev: TempleShellTrack | undefined,
  want: string | null,
  now: number,
): { next: TempleShellTrack | undefined; send: string | null } {
  if (want === null) return { next: undefined, send: null };
  if (!prev || prev.stance !== want) return { next: { stance: want, since: now }, send: want };
  const resend =
    want === TEMPLE_SENTINEL_SHELL_CLOSED || now - prev.since <= TEMPLE_SENTINEL_STANCE_RESEND;
  return { next: prev, send: resend ? want : null };
}

/** The Moonspawn's entrance gesture: it climbs out of the flooded shore when
 *  Ysolei calls it (the manifest plays its Rise clip, once per entity). */
export const TEMPLE_MOONSPAWN_RISE = 'temple_moonspawn_rise';
/** How long after a Moonspawn is first seen its Rise is still offered (the
 *  view is often built a frame or two after the entity appears). */
export const TEMPLE_MOONSPAWN_RISE_WINDOW = 1;

/** True while a freshly seen Moonspawn should be offered its Rise: alive, and
 *  within the window since it was first seen (the rig plays it once per
 *  entity; a Moonspawn first seen mid-fight, or one whose body loads later
 *  than the window, simply appears). */
export function templeMoonspawnRises(
  templateId: string | undefined,
  dead: boolean,
  sinceFirstSeen: number,
): boolean {
  return templateId === 'moonspawn' && !dead && sinceFirstSeen <= TEMPLE_MOONSPAWN_RISE_WINDOW;
}

/** Where a Tideglass Fracture stands, read off the Colossus's own channel bar
 *  (so heroic's shorter rounds read right with no difficulty on the wire):
 *  round -1 while the floor cracks, else the round (0 based) and how far its
 *  red slices have charged toward their detonation (0 to 1). */
export function fractureClock(
  castTotal: number,
  castRemaining: number,
  crackSeconds: number,
  out: { round: number; charge: number } = { round: -1, charge: 0 },
): { round: number; charge: number } {
  const elapsed = Math.max(0, castTotal - castRemaining);
  out.round = -1;
  out.charge = 0;
  if (elapsed < crackSeconds || castTotal <= crackSeconds) return out;
  const warn = (castTotal - crackSeconds) / FRACTURE_ROUNDS;
  const into = elapsed - crackSeconds;
  out.round = Math.min(FRACTURE_ROUNDS - 1, Math.floor(into / warn));
  out.charge = Math.min(1, Math.max(0, (into - out.round * warn) / warn));
  return out;
}

export interface FractureSliceLook {
  heat: number;
  clear: number;
  crack: number;
  pulse: number;
}

/** The warning pulse's ceiling (Hz) for a player who asked for reduced motion. */
export const FRACTURE_CALM_PULSE = 1.5;

/** A fracture slice's paint: the red heat (0 safe, up to 1 at detonation),
 *  the clear glass (1 safe), and the crack glow while the floor splits. The
 *  heat ramps with the charge so the last half second blazes; the warning
 *  pulse quickens from 2 to 8 Hz, held to FRACTURE_CALM_PULSE for reduced
 *  motion (the heat, the actionable part, is the same). */
export function fractureSliceLook(
  state: 'crack' | 'red' | 'safe',
  charge: number,
  calm = false,
  out: FractureSliceLook = { heat: 0, clear: 0, crack: 0, pulse: 0 },
): FractureSliceLook {
  out.heat = 0;
  out.clear = 0;
  out.pulse = 0;
  if (state === 'crack') {
    out.crack = 1;
    return out;
  }
  if (state === 'safe') {
    out.clear = 1;
    out.crack = 0.25;
    return out;
  }
  const c = Math.min(1, Math.max(0, charge));
  out.heat = 0.45 + 0.55 * c * c;
  out.crack = 0.5;
  out.pulse = calm ? Math.min(FRACTURE_CALM_PULSE, 2 + 6 * c) : 2 + 6 * c;
  return out;
}
