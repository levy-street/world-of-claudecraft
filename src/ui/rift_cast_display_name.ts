import { type TranslationKey, t } from './i18n';

// Rift boss one-shot mechanic cast IDs: keyed by their authored mechanic name.
// These appear in the target cast bar when the boss winds up a lethal zone.
// The lookup prevents falling back to the raw castId string on the HUD.
const RIFT_CAST_DISPLAY_KEYS: Partial<Record<TranslationKey, true>> = {
  'abilityUi.cast.rift_frost_execution': true,
  'abilityUi.cast.rift_frost_strike': true,
  'abilityUi.cast.rift_ember_execution': true,
  'abilityUi.cast.rift_ember_strike': true,
  'abilityUi.cast.rift_venom_execution': true,
  'abilityUi.cast.rift_venom_strike': true,
  'abilityUi.cast.rift_necro_execution': true,
  'abilityUi.cast.rift_necro_strike': true,
  'abilityUi.cast.rift_brute_execution': true,
  'abilityUi.cast.rift_brute_strike': true,
  'abilityUi.cast.rift_arcane_execution': true,
  'abilityUi.cast.rift_arcane_strike': true,
  'abilityUi.cast.rift_storm_execution': true,
  'abilityUi.cast.rift_storm_strike': true,
  'abilityUi.cast.rift_tide_execution': true,
  'abilityUi.cast.rift_tide_strike': true,
};

const ROACH_CAST_KEYS: Readonly<Record<string, TranslationKey>> = {
  rift_asmon_coronation: 'sim.rift.roachKing.coronation',
  rift_asmon_tribute: 'sim.rift.roachKing.tributeFeast',
  rift_asmon_desk_slam: 'sim.rift.roachKing.deskSlam',
  rift_asmon_filth: 'sim.rift.roachKing.mountainOfFilth',
  rift_asmon_swarm: 'sim.rift.roachKing.royalSwarm',
};

/** Resolve encounter casts without leaking a template id into the target frame. */
export function riftCastDisplayName(id: string): string | null {
  const roachKey = ROACH_CAST_KEYS[id];
  if (roachKey) return t(roachKey);
  const key = `abilityUi.cast.${id}` as TranslationKey;
  return key in RIFT_CAST_DISPLAY_KEYS ? t(key) : null;
}
