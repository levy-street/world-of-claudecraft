// The Last Bell squad: the five named defenders as ENCOUNTER ACTORS, the
// private per-instance combat copies the campaign spawns inside story
// spaces. Their persistent shared "home form" NPCs (fixed posts in
// Gullhaven) are the existing FARSHORE_NPCS; these templates are what
// fights beside the party. Kits follow the campaign doc's combat lines:
// Coalfast shield front line, Ollun rift interruption (arcane), Edda heavy
// ranged demolitions (fire), Saul healing, Tam wards and the counter-note
// (frost control). Templates are data only; behavior is src/sim/squad/.

import type { MobTemplate } from '../types';

export type SquadActorRole = 'tank' | 'healer' | 'ranged' | 'melee';

export interface SquadActorDef {
  id: string;
  mobTemplateId: string;
  role: SquadActorRole;
  /** Ranged actors cast this bolt through the shared ranged-attack entry
   * (updateRangedPetAttack's spell shape: range in yards, every in seconds). */
  bolt?: {
    name: string;
    school: 'physical' | 'fire' | 'frost' | 'arcane' | 'shadow' | 'holy' | 'nature';
    min: number;
    max: number;
    range: number;
    every: number;
  };
}

// Actor mob templates. Spawned at a FIXED level (minLevel === maxLevel) so
// squad spawning draws no rng and the parity draw order never moves. The
// squad must read as elite at all times (campaign guardrail): elite flag,
// deep health pools, real damage. moveSpeed 0 and aggroRadius 0 follow the
// escortee contract: the squad brain drives all movement and targeting, the
// generic mob AI never touches them (the inert arm keys on squadActorId).
export const LAST_BELL_SQUAD_MOBS: Record<string, MobTemplate> = {
  lb_actor_coalfast: {
    id: 'lb_actor_coalfast',
    name: 'Warden Coalfast',
    minLevel: 9,
    maxLevel: 9,
    family: 'humanoid',
    hpBase: 420,
    hpPerLevel: 30,
    dmgBase: 16,
    dmgPerLevel: 2.2,
    attackSpeed: 2.2,
    armorPerLevel: 22,
    moveSpeed: 0,
    aggroRadius: 0,
    elite: true,
    loot: [],
    scale: 1.12,
    color: 0x8a4b2b,
  },
  lb_actor_ollun: {
    id: 'lb_actor_ollun',
    name: 'Riftwatch Ollun',
    minLevel: 9,
    maxLevel: 9,
    family: 'humanoid',
    hpBase: 260,
    hpPerLevel: 22,
    dmgBase: 12,
    dmgPerLevel: 1.8,
    attackSpeed: 2.0,
    armorPerLevel: 14,
    moveSpeed: 0,
    aggroRadius: 0,
    elite: true,
    loot: [],
    scale: 1.0,
    color: 0x3f5f8a,
  },
  lb_actor_edda: {
    id: 'lb_actor_edda',
    name: 'Quartermaster Edda',
    minLevel: 9,
    maxLevel: 9,
    family: 'humanoid',
    hpBase: 280,
    hpPerLevel: 24,
    dmgBase: 15,
    dmgPerLevel: 2.4,
    attackSpeed: 2.0,
    armorPerLevel: 16,
    moveSpeed: 0,
    aggroRadius: 0,
    elite: true,
    loot: [],
    scale: 1.0,
    color: 0x6b6b3a,
  },
  lb_actor_saul: {
    id: 'lb_actor_saul',
    name: 'Mender Saul',
    minLevel: 9,
    maxLevel: 9,
    family: 'humanoid',
    hpBase: 300,
    hpPerLevel: 24,
    dmgBase: 9,
    dmgPerLevel: 1.4,
    attackSpeed: 2.4,
    armorPerLevel: 15,
    moveSpeed: 0,
    aggroRadius: 0,
    elite: true,
    loot: [],
    scale: 1.0,
    color: 0x9a3b3b,
  },
  lb_actor_tam: {
    id: 'lb_actor_tam',
    name: 'Bellkeeper Tam',
    minLevel: 9,
    maxLevel: 9,
    family: 'humanoid',
    hpBase: 320,
    hpPerLevel: 26,
    dmgBase: 13,
    dmgPerLevel: 2.0,
    attackSpeed: 2.1,
    armorPerLevel: 18,
    moveSpeed: 0,
    aggroRadius: 0,
    elite: true,
    loot: [],
    scale: 1.02,
    color: 0x4a7b6b,
  },
};

export const LAST_BELL_SQUAD_ACTORS: Record<string, SquadActorDef> = {
  coalfast: { id: 'coalfast', mobTemplateId: 'lb_actor_coalfast', role: 'tank' },
  ollun: {
    id: 'ollun',
    mobTemplateId: 'lb_actor_ollun',
    role: 'ranged',
    bolt: { name: 'Counter-Reading', school: 'arcane', min: 11, max: 17, range: 30, every: 2.0 },
  },
  edda: {
    id: 'edda',
    mobTemplateId: 'lb_actor_edda',
    role: 'ranged',
    bolt: { name: 'Demolition Charge', school: 'fire', min: 14, max: 22, range: 30, every: 2.0 },
  },
  saul: { id: 'saul', mobTemplateId: 'lb_actor_saul', role: 'healer' },
  tam: {
    id: 'tam',
    mobTemplateId: 'lb_actor_tam',
    role: 'melee',
  },
};

/** The full five, in the campaign's standing order. */
export const LAST_BELL_SQUAD_ALL = ['coalfast', 'ollun', 'edda', 'saul', 'tam'] as const;
