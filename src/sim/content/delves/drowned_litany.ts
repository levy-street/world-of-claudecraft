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

// --- Crescent sluice: priority casters behind marsh skirmishers. ---
const SLUICE_SPAWNS = {
  id: 'sluice_trash',
  weight: 1,
  spawns: [
    { mobId: 'deepfen_spearjaw', x: -6, z: 26 },
    { mobId: 'drowned_cantor', x: 6, z: 28 },
    { mobId: 'deepfen_spearjaw', x: -5, z: 40 },
    { mobId: 'deepfen_spearjaw', x: 5, z: 42 },
    { mobId: 'drowned_cantor', x: -4, z: 54 },
    { mobId: 'grave_silt_bulwark', x: 4, z: 58 },
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
    { mobId: 'reedbound_acolyte', x: -4, z: 56 },
    { mobId: 'drowned_cantor', x: 4, z: 58 },
  ],
};

// --- Ring reliquary: cantors guard an elite sump troll. ---
const RING_SPAWNS = {
  id: 'ring_trash',
  weight: 1,
  spawns: [
    { mobId: 'drowned_cantor', x: -6, z: 26 },
    { mobId: 'reedbound_acolyte', x: 6, z: 28 },
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

// --- Fan choir loft: a wall of cantors backed by choir thralls. ---
const CHOIR_LOFT_SPAWNS = {
  id: 'choir_loft_trash',
  weight: 1,
  spawns: [
    { mobId: 'choir_thrall', x: -8, z: 26 },
    { mobId: 'choir_thrall', x: 8, z: 26 },
    { mobId: 'drowned_cantor', x: -6, z: 42 },
    { mobId: 'drowned_cantor', x: 0, z: 44 },
    { mobId: 'drowned_cantor', x: 6, z: 42 },
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
    interior: 'crypt',
    layout: 'litany_sluice',
    length: 110,
    spawnSets: [SLUICE_SPAWNS],
    interactableSlots: [],
  },
  litany_ledger: {
    id: 'litany_ledger',
    interior: 'crypt',
    layout: 'litany_ledger',
    length: 110,
    spawnSets: [LEDGER_SPAWNS],
    interactableSlots: [],
  },
  litany_ring: {
    id: 'litany_ring',
    interior: 'crypt',
    layout: 'litany_ring',
    length: 110,
    spawnSets: [RING_SPAWNS],
    interactableSlots: [],
  },
  litany_baptistry: {
    id: 'litany_baptistry',
    interior: 'crypt',
    layout: 'litany_baptistry',
    length: 110,
    spawnSets: [BAPTISTRY_SPAWNS],
    interactableSlots: [],
  },
  litany_choir_loft: {
    id: 'litany_choir_loft',
    interior: 'crypt',
    layout: 'litany_choir_loft',
    length: 110,
    spawnSets: [CHOIR_LOFT_SPAWNS],
    interactableSlots: [],
  },
  litany_causeway: {
    id: 'litany_causeway',
    interior: 'crypt',
    layout: 'litany_causeway',
    length: 110,
    spawnSets: [CAUSEWAY_SPAWNS],
    interactableSlots: [],
  },
  litany_apse: {
    id: 'litany_apse',
    interior: 'crypt',
    layout: 'litany_apse',
    length: 110,
    spawnSets: [APSE_SPAWNS],
    interactableSlots: [],
  },
};

export const DROWNED_LITANY_DELVE: DelveDef = {
  id: 'drowned_litany',
  name: 'The Drowned Litany',
  theme: 'ruin',
  index: 1,
  minLevel: 12,
  suggestedPlayers: 2,
  // North causeway just outside Fenbridge (hub at z=300; marsh zone z 180..540).
  doorPos: { x: 8, z: 268 },
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
  boardNpcId: 'brother_aldric_watch',
  autoCompanionId: 'companion_edda',
  enterText: 'You descend beneath Fenbridge into the drowned shrine.',
  leaveText: 'You climb back to Brother Aldric on the Fenbridge causeway.',
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
