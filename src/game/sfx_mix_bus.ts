// Which volume bus a sampled SFX clip plays through. The Audio panel has two
// sliders for sampled sounds: Sound Effects (combat, spells, movement, mobs,
// mounts, interface cues, and every sound tied to a gameplay object) and
// Ambience (the environment beds: biome wind, birds, rain, snow, water, dungeon
// air, the arena crowd, and the campfire and forge stations). `sfx.ts` owns one
// GainNode per bus and asks this module which one a key connects to.
//
// Pure and DOM-free so it unit-tests without a WebAudio context.

/** The two sampled-SFX volume buses. */
export type SfxMixBus = 'effects' | 'ambient';

/** The manifest category every catalogued environment bed carries
 *  (`scripts/sfx/sfx_gain_map.json` categoryBaselineDb). */
const AMBIENCE_CATEGORY = 'ambience';

/** Environment beds with no manifest entry: the procedural crowd murmur is
 *  built in code. Point emitters that belong to a gameplay object (a rift
 *  portal's drone, a buried hoard's hum, the rift boulder and ice glide) are
 *  deliberately NOT here: players use them to find or dodge that object, so they
 *  stay on the effects bus. */
const AMBIENT_KEYS: ReadonlySet<string> = new Set(['amb_crowd']);

/** The bus `key` plays through, given its manifest category (undefined for a
 *  procedural or unknown clip). Everything that is not environment is an effect. */
export function sfxMixBus(key: string, category: string | undefined): SfxMixBus {
  return category === AMBIENCE_CATEGORY || AMBIENT_KEYS.has(key) ? 'ambient' : 'effects';
}
