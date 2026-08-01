// Station ambience routing config (issue #2208): the five Professions 2.0
// crafting-station point-ambience beds beyond the original campfire/forge
// pair. Pure data behind sfx.ts's pointAmbient (no WebAudio, no DOM) so a
// plain Vitest can pin that every station kind resolves to a registered
// amb_* cue with sane spatial tuning (tests/station_ambience.test.ts), and
// so the render-side AmbientPointSource union (src/render/audio_sink.ts,
// which must not import src/game/) can be parity-checked against it.

/** The station point-ambience kinds beyond campfire/forge. Matches the
 *  non-forge half of StationType (src/sim/professions/stations.ts): the
 *  forge-type station shares the smithy's existing amb_forge sources. */
export type StationAmbienceKind = 'kitchens' | 'apothecary' | 'tannery' | 'loom' | 'toolworks';

/** How one station kind reaches the ear: which bed, how loud. */
export interface StationAmbienceConfig {
  /** The amb_* cue key (registered in scripts/sfx/sfx_prompts.mjs). */
  readonly key: string;
  /** Mix gain into loop(): all beds conform near the generated-content LUFS
   *  target, so these sit near POINT_AMBIENCE_GAIN (0.18, campfire), never
   *  near FORGE_AMBIENCE_GAIN (0.625, which compensates a quiet custom
   *  recording, see the sfx.ts comment). */
  readonly gain: number;
}

/** Stations are small localized point sources exactly like the forge, and
 *  the audio listener is the CAMERA (which trails 3 to 22 units behind the
 *  player), so the narrow-radius gotcha documented on FORGE_MAX_DISTANCE in
 *  sfx.ts applies unchanged: 38 is the value tuned live there, reused for
 *  every station bed rather than re-derived per kind. */
export const STATION_MAX_DISTANCE = 38;

/** Per-kind bed routing. Tannery sits a bit above the others: its scrape
 *  bed conforms peak-limited about 2 dB under the LUFS target (the
 *  documented peakLimited case in scripts/sfx/conform_audio.mjs). */
export const STATION_AMBIENCE: Readonly<Record<StationAmbienceKind, StationAmbienceConfig>> = {
  kitchens: { key: 'amb_kitchens', gain: 0.2 },
  apothecary: { key: 'amb_apothecary', gain: 0.2 },
  tannery: { key: 'amb_tannery', gain: 0.24 },
  loom: { key: 'amb_loom', gain: 0.2 },
  toolworks: { key: 'amb_toolworks', gain: 0.2 },
};
