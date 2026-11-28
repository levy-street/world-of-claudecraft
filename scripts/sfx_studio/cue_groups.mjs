// The SFX Studio's cue groups: named slices of the catalog the cue list can be
// filtered to (a raid, one of its fights, the party pings), so a sound pass
// over one piece of content does not mean hunting for keys or knowing which
// category each cue was filed under. Pure: the catalog tags every clip with
// cueGroupsFor(key) and lists the groups with cueGroupSummary; the page only
// renders the dropdown and filters by id.

/** The cues the Smith's Heart's audio cores play that are not `heart_` cues
 *  (src/game/smith_heart_*.ts). They are shared with the rest of the game, so
 *  an edit to one is heard everywhere, not only in the raid. Pinned against
 *  those modules by tests/sfx_studio_cue_groups.test.ts. */
export const SMITH_HEART_SHARED_CUES = Object.freeze([
  'flamestrike',
  'impact_arcane',
  'impact_fire',
  'impact_frost',
  'melee_swing_heavy',
  'proj_frost',
  'rift_lava_tick',
  'ui_aura_anvil_strike',
  'ui_aura_blaring_horn',
  'ui_aura_soft_chime',
  'ui_aura_steam_hiss',
  'ui_aura_temple_gong',
]);

/** The party ping sounds, one per ping kind (PING_SOUNDS in
 *  src/ui/hud/pings/ping_feed_core.ts); pinned by the same test. */
export const PING_CUES = Object.freeze([
  'ui_ping_look',
  'ui_ping_attack',
  'ui_ping_warning',
  'ui_ping_on_my_way',
  'ui_ping_assist',
]);

const shared = new Set(SMITH_HEART_SHARED_CUES);
const pings = new Set(PING_CUES);
const prefixed = (prefix) => (key) => key.startsWith(prefix);

/** In dropdown order: the whole raid, its fights in raid order, the marks
 *  every fight shares, the shared game cues, then the pings. */
export const CUE_GROUPS = Object.freeze(
  [
    {
      id: 'smith_heart',
      label: "Smith's Heart: whole raid",
      matches: (key) => key.startsWith('heart_') || shared.has(key),
    },
    {
      id: 'smith_heart_council',
      label: "Smith's Heart: Hammer Council",
      matches: prefixed('heart_council_'),
    },
    {
      id: 'smith_heart_breath',
      label: "Smith's Heart: Breath",
      matches: prefixed('heart_breath_'),
    },
    {
      id: 'smith_heart_quench',
      label: "Smith's Heart: Quench",
      matches: prefixed('heart_quench_'),
    },
    { id: 'smith_heart_heat', label: "Smith's Heart: Heat", matches: prefixed('heart_heat_') },
    {
      id: 'smith_heart_final',
      label: "Smith's Heart: Masterless Strength",
      matches: prefixed('heart_final_'),
    },
    {
      id: 'smith_heart_marks',
      label: "Smith's Heart: personal marks",
      matches: prefixed('heart_mark_'),
    },
    {
      id: 'smith_heart_shared',
      label: "Smith's Heart: shared game cues",
      matches: (key) => shared.has(key),
    },
    { id: 'party_pings', label: 'Party pings', matches: (key) => pings.has(key) },
  ].map((group) => Object.freeze(group)),
);

/** Every group id a cue belongs to, in dropdown order (a cue may sit in
 *  several: a fight and the whole raid, or a raid cue that also sits in the shared set). */
export function cueGroupsFor(key) {
  return CUE_GROUPS.filter((group) => group.matches(key)).map((group) => group.id);
}

/** The dropdown's entries for a catalog: each group's id, label and how many
 *  of `keys` it holds. Groups with no cue in the catalog are left out. */
export function cueGroupSummary(keys) {
  return CUE_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    count: keys.filter((key) => group.matches(key)).length,
  })).filter((group) => group.count > 0);
}
