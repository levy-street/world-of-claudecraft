// The player-selectable alert sounds for the Auras panel: one cue can be attached
// to any proc so it announces itself by ear, alongside its visual overlay or
// instead of it.
//
// Pure and host-agnostic: an ordered list of ids plus their label keys, with no
// AudioContext, no DOM, and no i18n runtime (the panel resolves labelKey itself).
// The AUDIO for each id is a sampled clip like every other cue in this engine:
// the same id is the sfx catalog key, authored as a deterministic FFmpeg recipe in
// scripts/sfx/ui_sfx.mjs, baked by scripts/gen_ui_sfx.mjs and shipped under
// public/audio/sfx/. Playback is the ordinary sfx.playUi path; nothing here
// synthesizes at runtime.
//
// Adding a cue is three edits kept in lockstep, which tests/aura_cue_catalog.test.ts
// pins in both directions: the recipe in ui_sfx.mjs, the row here, and the label in
// the i18n catalog.

import type { TranslationKey } from '../ui/i18n.catalog';

/** A cue id, which is also its sfx catalog key. */
export type AuraCueId = string;

export interface AuraCueDef {
  /** The sfx catalog key (`ui_aura_*`), used verbatim by sfx.playUi. */
  id: AuraCueId;
  /** The localized display name shown in the picker. */
  labelKey: TranslationKey;
}

/** The sentinel for "no sound", the default for every proc. Never an sfx key. */
export const AURA_CUE_NONE = 'none';

/**
 * The palette, in picker order. Grouped by character rather than alphabetically,
 * because the player is choosing by feel: gentle cues first, then bright and
 * metallic, then loud and mechanical, then the natural/animal set, then textures.
 * A wide spread is the point: several procs firing at once have to be tellable
 * apart by ear, which a set of tasteful chimes cannot do.
 */
export const AURA_CUES: readonly AuraCueDef[] = [
  // Gentle
  { id: 'ui_aura_soft_chime', labelKey: 'hudChrome.auraOverlay.cues.softChime' },
  { id: 'ui_aura_music_box', labelKey: 'hudChrome.auraOverlay.cues.musicBox' },
  { id: 'ui_aura_glass_ping', labelKey: 'hudChrome.auraOverlay.cues.glassPing' },
  { id: 'ui_aura_water_drop', labelKey: 'hudChrome.auraOverlay.cues.waterDrop' },
  { id: 'ui_aura_bubble_pop', labelKey: 'hudChrome.auraOverlay.cues.bubblePop' },
  // Bright and metallic
  { id: 'ui_aura_hard_bell', labelKey: 'hudChrome.auraOverlay.cues.hardBell' },
  { id: 'ui_aura_temple_gong', labelKey: 'hudChrome.auraOverlay.cues.templeGong' },
  { id: 'ui_aura_anvil_strike', labelKey: 'hudChrome.auraOverlay.cues.anvilStrike' },
  { id: 'ui_aura_coin_drop', labelKey: 'hudChrome.auraOverlay.cues.coinDrop' },
  { id: 'ui_aura_sword_draw', labelKey: 'hudChrome.auraOverlay.cues.swordDraw' },
  // Loud and mechanical
  { id: 'ui_aura_blaring_horn', labelKey: 'hudChrome.auraOverlay.cues.blaringHorn' },
  { id: 'ui_aura_car_klaxon', labelKey: 'hudChrome.auraOverlay.cues.carKlaxon' },
  { id: 'ui_aura_sonar_ping', labelKey: 'hudChrome.auraOverlay.cues.sonarPing' },
  { id: 'ui_aura_electric_zap', labelKey: 'hudChrome.auraOverlay.cues.electricZap' },
  // Animal
  { id: 'ui_aura_cat_meow', labelKey: 'hudChrome.auraOverlay.cues.catMeow' },
  { id: 'ui_aura_owl_hoot', labelKey: 'hudChrome.auraOverlay.cues.owlHoot' },
  { id: 'ui_aura_wolf_howl', labelKey: 'hudChrome.auraOverlay.cues.wolfHowl' },
  { id: 'ui_aura_frog_croak', labelKey: 'hudChrome.auraOverlay.cues.frogCroak' },
  // Texture
  { id: 'ui_aura_wind_whoosh', labelKey: 'hudChrome.auraOverlay.cues.windWhoosh' },
  { id: 'ui_aura_steam_hiss', labelKey: 'hudChrome.auraOverlay.cues.steamHiss' },
];

const CUE_IDS: ReadonlySet<string> = new Set(AURA_CUES.map((cue) => cue.id));

/** Whether an id names a real cue. `AURA_CUE_NONE` is deliberately NOT a cue. */
export function isAuraCueId(id: string): boolean {
  return CUE_IDS.has(id);
}

/** Read a persisted cue selection back. Anything unknown (a removed cue, junk in
 *  storage) degrades to silence rather than throwing or playing something else. */
export function sanitizeAuraCueId(raw: unknown): string {
  return typeof raw === 'string' && isAuraCueId(raw) ? raw : AURA_CUE_NONE;
}

/** The cue's label key, or undefined when the id names no cue. */
export function auraCueLabelKey(id: string): TranslationKey | undefined {
  return AURA_CUES.find((cue) => cue.id === id)?.labelKey;
}
