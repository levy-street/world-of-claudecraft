import { DELVE_COMPANIONS } from '../../src/sim/content/delves/companions';
import { MAGE_PET_MOBS } from '../../src/sim/content/mage_pets';
import { WARLOCK_PET_MOBS } from '../../src/sim/content/warlock_pets';
import { YUMI_TEMPLATE_ID } from '../../src/sim/content/yumi';
import { ABILITIES, CLASSES, MOBS } from '../../src/sim/data';
import { ESCORT_NPC_TEMPLATE_IDS } from '../../src/sim/escort';
import { companionByCreature } from './companion_sources';

// Who a creature page is about. Only 'enemy' belongs in the Enemies catalog; the rest are
// on the player's side, practice targets, scenery or objectives, and the wiki files them
// with the friendly characters instead.
export type CreatureRole =
  | 'enemy'
  | 'companion'
  | 'pet'
  | 'delve companion'
  | 'practice target'
  | 'wildlife'
  | 'escort'
  | 'ally'
  | 'objective';

// Every creature a player class ability summons (summonDemon, summonUndead, ...). Boss
// abilities are excluded so a summoned add never reads as someone's pet.
const summonedTemplates = new Set<string>();
const collectSummons = (node: unknown): void => {
  if (!node || typeof node !== 'object') return;
  const effect = node as { type?: unknown; mobId?: unknown; templateId?: unknown };
  if (typeof effect.type === 'string' && effect.type.startsWith('summon'))
    for (const id of [effect.mobId, effect.templateId])
      if (typeof id === 'string') summonedTemplates.add(id);
  for (const value of Object.values(node)) collectSummons(value);
};
collectSummons(Object.values(ABILITIES).filter((a) => Object.hasOwn(CLASSES, a.class)));
const petTemplates = new Set([
  ...Object.keys(MAGE_PET_MOBS),
  ...Object.keys(WARLOCK_PET_MOBS),
  ...[...summonedTemplates].filter((id) => MOBS[id]),
]);
// The friendly ghosts summonQuestVision (src/sim/encounters/nythraxis.ts) raises for a
// quest: spawned non-hostile, never fought.
const QUEST_VISIONS = new Set([
  'vision_aldren_warrior',
  'vision_malric_mage',
  'vision_deathstalker_voss',
]);
const delveCompanions = new Set(Object.values(DELVE_COMPANIONS).map((c) => c.mobTemplateId));

// Bodies the game spawns as part of a fight but never as something that fights you: a
// "usable" prop you channel on (Hunting Spear, Remembrance Candle, Soul Brazier), the Tolling
// Bell projectile (spawned non-hostile, src/sim/content/delves/mobs.ts tolling_bell) and the
// Brood Clutch egg (spawned non-hostile and damage immune, src/sim/rift/hoard_boss.ts).
const INERT_ENCOUNTER_BODIES = new Set(['tolling_bell', 'hoard_brood_egg']);
export function isEncounterProp(id: string): boolean {
  const m = MOBS[id];
  return !!m && (INERT_ENCOUNTER_BODIES.has(id) || !!m.trashKit?.usable);
}

export function creatureRole(id: string): CreatureRole {
  const m = MOBS[id];
  if (companionByCreature.has(id)) return 'companion';
  if (delveCompanions.has(id)) return 'delve companion';
  if (m?.petRole || petTemplates.has(id)) return 'pet';
  if (m?.dummy || m?.friendlyPracticeTarget) return 'practice target';
  if (m?.ambient) return 'wildlife';
  if (ESCORT_NPC_TEMPLATE_IDS.has(id)) return 'escort';
  if (m?.musterSoldier || QUEST_VISIONS.has(id)) return 'ally';
  if (id === YUMI_TEMPLATE_ID || isEncounterProp(id)) return 'objective';
  return 'enemy';
}

// The heading a non-enemy is filed under inside its friendly group.
export const ROLE_SECTIONS: Record<Exclude<CreatureRole, 'enemy'>, string> = {
  companion: 'Cosmetic companions',
  pet: 'Combat pets',
  'delve companion': 'Delve companions',
  'practice target': 'Practice targets',
  wildlife: 'Town animals',
  escort: 'Escorts',
  ally: 'Allies and quest visions',
  objective: 'Objectives',
};

// The friendly-creature group a non-enemy is listed under on the NPCs hub.
export const FRIENDLY_GROUPS: Record<Exclude<CreatureRole, 'enemy'>, string> = {
  companion: 'Companions and pets',
  pet: 'Companions and pets',
  'delve companion': 'Companions and pets',
  'practice target': 'Practice targets',
  wildlife: 'Town animals',
  escort: 'Escorts and objectives',
  ally: 'Allies and quest visions',
  objective: 'Escorts and objectives',
};
