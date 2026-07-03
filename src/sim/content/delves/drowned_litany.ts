import { litanyModuleHazards } from '../../delve_litany_layout';
import type { DelveDef, DelveModuleDef } from '../../types';

// =============================================================================
// The Drowned Litany - Mirefen Marsh delve beneath Fenbridge (delve index 1).
//
// Phase 1 (MVP skeleton): a fully enterable and completable second delve that
// reuses the existing delve loop (kill_boss + the finale lockpick chest) and the
// placeholder reliquary geometry. Later phases swap in irregular marsh-ruin
// layouts, Blackwater hazards, richer enemy/boss mechanics, and the Drowned
// Reliquary Rite finale that replaces the lockpick chest for this delve.
//
// Run picks 3 of the 6 trash modules (seeded) then appends the boss apse.
// =============================================================================

// --- Crescent sluice: marsh predators screening a lone cantor. ---
const SLUICE_SPAWNS = {
  id: 'sluice_trash',
  weight: 1,
  spawns: [
    { mobId: 'deepfen_spearjaw', x: 10, z: 24 },
    { mobId: 'mirefen_widowling', x: 10, z: 32 },
    { mobId: 'deepfen_spearjaw', x: 8, z: 40 },
    { mobId: 'deepfen_spearjaw', x: 5, z: 46 },
    { mobId: 'drowned_cantor', x: 11, z: 52 },
    { mobId: 'grave_silt_bulwark', x: 6, z: 58 },
  ],
};

// --- Island ledger: ranged debuffers and control adds. ---
const LEDGER_SPAWNS = {
  id: 'ledger_trash',
  weight: 1,
  spawns: [
    { mobId: 'reedbound_acolyte', x: -6, z: 26 },
    { mobId: 'mirefen_widowling', x: 6, z: 28 },
    { mobId: 'reedbound_acolyte', x: -5, z: 42 },
    { mobId: 'mirefen_widowling', x: 5, z: 44 },
    { mobId: 'mirefen_widowling', x: -4, z: 56 },
    { mobId: 'drowned_cantor', x: 4, z: 58 },
  ],
};

// --- Ring reliquary: a cantor and skirmishers guard an elite sump troll. ---
const RING_SPAWNS = {
  id: 'ring_trash',
  weight: 1,
  spawns: [
    { mobId: 'deepfen_spearjaw', x: -6, z: 26 },
    { mobId: 'reedbound_acolyte', x: 14, z: 28 },
    { mobId: 'drowned_cantor', x: -4, z: 42 },
    { mobId: 'reedbound_acolyte', x: 4, z: 44 },
    { mobId: 'sump_troll_devourer', x: 0, z: 58 },
  ],
};

// --- Sinkhole baptistry: widowling swarm with a bulwark anchor. ---
const BAPTISTRY_SPAWNS = {
  id: 'baptistry_trash',
  weight: 1,
  spawns: [
    { mobId: 'mirefen_widowling', x: -7, z: 26 },
    { mobId: 'mirefen_widowling', x: 7, z: 26 },
    { mobId: 'deepfen_spearjaw', x: -4, z: 40 },
    { mobId: 'deepfen_spearjaw', x: 4, z: 40 },
    { mobId: 'drowned_cantor', x: 0, z: 52 },
    { mobId: 'grave_silt_bulwark', x: 0, z: 60 },
  ],
};

// --- Fan gallery: ranked cantors backed by bog thralls. ---
const CHOIR_LOFT_SPAWNS = {
  id: 'choir_loft_trash',
  weight: 1,
  spawns: [
    { mobId: 'choir_thrall', x: -8, z: 26 },
    { mobId: 'choir_thrall', x: 8, z: 26 },
    { mobId: 'drowned_cantor', x: -6, z: 42 },
    { mobId: 'drowned_cantor', x: 0, z: 44 },
    { mobId: 'reedbound_acolyte', x: 6, z: 42 },
    { mobId: 'grave_silt_bulwark', x: 0, z: 58 },
  ],
};

// --- Y-split causeway: mobile skirmishers and an elite over the water. ---
const CAUSEWAY_SPAWNS = {
  id: 'causeway_trash',
  weight: 1,
  spawns: [
    { mobId: 'deepfen_spearjaw', x: -6, z: 26 },
    { mobId: 'deepfen_spearjaw', x: 6, z: 28 },
    { mobId: 'reedbound_acolyte', x: -5, z: 42 },
    { mobId: 'reedbound_acolyte', x: 5, z: 44 },
    { mobId: 'deepfen_spearjaw', x: -4, z: 56 },
    { mobId: 'sump_troll_devourer', x: 4, z: 58 },
  ],
};

// --- Boss apse: Sister Nhalia strides onto the altar island. ---
const APSE_SPAWNS = {
  id: 'boss',
  weight: 1,
  spawns: [{ mobId: 'sister_nhalia_drowned_canticle', x: 0, z: 72 }],
};

export const DROWNED_LITANY_MODULES: Record<string, DelveModuleDef> = {
  litany_sluice: {
    id: 'litany_sluice',
    interior: 'cave',
    layout: 'litany_sluice',
    length: 110,
    spawnSets: [SLUICE_SPAWNS],
    // Puzzle: turn 2 sluice valves (Primitive A, Click Objects). Both sit on the
    // open arc, clear of the stub bank, the hazard pools, and the entry aisle.
    interactableSlots: [
      { x: -12, z: 8, variants: ['sluice_valve'] },
      { x: 12, z: 54, variants: ['sluice_valve'] },
    ],
    hazards: litanyModuleHazards('litany_sluice'),
  },
  litany_ledger: {
    id: 'litany_ledger',
    interior: 'cave',
    layout: 'litany_ledger',
    length: 110,
    spawnSets: [LEDGER_SPAWNS],
    // Puzzle: activate 4 grave tablets in any order (Primitive A). The center pool
    // spans nearly the full room width, so all four sit in the dry south/north
    // bands clear of the flood and the wall/island/pillar obstacles.
    interactableSlots: [
      { x: -18, z: 14, variants: ['grave_tablet'] },
      { x: 16, z: 12, variants: ['grave_tablet'] },
      { x: -16, z: 68, variants: ['grave_tablet'] },
      { x: 10, z: 76, variants: ['grave_tablet'] },
    ],
    hazards: litanyModuleHazards('litany_ledger'),
  },
  litany_ring: {
    id: 'litany_ring',
    interior: 'cave',
    layout: 'litany_ring',
    length: 110,
    spawnSets: [RING_SPAWNS],
    // Puzzle: light 2 corpse-candles (Primitive A). One on each side lane of the
    // loop, outside the sealed central mass and clear of the two hazard pools.
    interactableSlots: [
      { x: 20, z: 42, variants: ['corpse_candle'] },
      { x: -20, z: 42, variants: ['corpse_candle'] },
    ],
    hazards: litanyModuleHazards('litany_ring'),
  },
  litany_baptistry: {
    id: 'litany_baptistry',
    interior: 'cave',
    layout: 'litany_baptistry',
    length: 110,
    spawnSets: [BAPTISTRY_SPAWNS],
    // Spider egg-sacs (destroyable, spawns spiders on death) are spawned as mobs
    // by drowned_litany_rooms.ts once all trash waves clear; see
    // BAPTISTRY_EGG_SAC_SPOTS there, not an interactable slot.
    interactableSlots: [],
    hazards: litanyModuleHazards('litany_baptistry'),
  },
  litany_choir_loft: {
    id: 'litany_choir_loft',
    interior: 'cave',
    layout: 'litany_choir_loft',
    length: 110,
    spawnSets: [CHOIR_LOFT_SPAWNS],
    // Puzzle: pull 2 bell ropes (Primitive A). One at each wide flank of the fan,
    // outside the fanning ranks and clear of the three seepage pools.
    interactableSlots: [
      { x: -18, z: 44, variants: ['bell_rope'] },
      { x: 18, z: 44, variants: ['bell_rope'] },
    ],
    hazards: litanyModuleHazards('litany_choir_loft'),
  },
  litany_causeway: {
    id: 'litany_causeway',
    interior: 'cave',
    layout: 'litany_causeway',
    length: 110,
    spawnSets: [CAUSEWAY_SPAWNS],
    interactableSlots: [],
    hazards: litanyModuleHazards('litany_causeway'),
  },
  litany_apse: {
    id: 'litany_apse',
    interior: 'cave',
    layout: 'litany_apse',
    length: 110,
    spawnSets: [APSE_SPAWNS],
    interactableSlots: [],
    hazards: litanyModuleHazards('litany_apse'),
  },
};

export const DROWNED_LITANY_DELVE: DelveDef = {
  id: 'drowned_litany',
  name: 'The Drowned Litany',
  theme: 'ruin',
  index: 1,
  minLevel: 12,
  suggestedPlayers: 2,
  maxPlayers: 2,
  // Northern edge of Mirefen Marsh (zone z 180..540; hub at z=300), north of
  // the Troll Mounds and clear of their camps, short of the steep rise toward
  // Thornpeak Heights. Matches Brother Halven's marsh camp.
  doorPos: { x: -95, z: 505 },
  modules: [
    'litany_sluice',
    'litany_ledger',
    'litany_ring',
    'litany_baptistry',
    'litany_choir_loft',
    'litany_causeway',
  ],
  moduleCount: [3, 3],
  finaleModuleId: 'litany_apse',
  bosses: ['sister_nhalia_drowned_canticle'],
  objective: 'kill_boss',
  boardNpcId: 'brother_halven_marsh',
  autoCompanionId: 'companion_edda',
  enterText: "You descend into the drowned shrine at the marsh's edge.",
  leaveText: "You climb back to Brother Halven at the marsh's edge.",
  tiers: [
    {
      id: 'normal',
      label: 'Normal',
      enemyLevelBonus: 0,
      affixCount: 0,
      rewardMult: 1,
    },
    {
      id: 'heroic',
      label: 'Heroic',
      enemyLevelBonus: 3,
      affixCount: 1,
      rewardMult: 1.3,
      minPlayerLevel: 14,
      firstClearXp: 1850,
      repeatClearXp: 1140,
      copperMin: 32,
      copperMax: 48,
    },
  ],
  baseRewards: {
    copperMin: 18,
    copperMax: 30,
    firstClearXp: 1250,
    repeatClearXp: 760,
  },
};
