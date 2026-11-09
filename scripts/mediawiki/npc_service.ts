import type { NpcRole } from '../../src/sim/npc_role';
import { t } from '../../src/ui/i18n';

// The forge trainer's nameplate still says "Blacksmithing Trainer", but the game has no
// Blacksmithing profession: the forge teaches Armorcrafting and Weaponcrafting
// (STATION_TYPE_BY_CRAFT), which are the pages the wiki links. Name the trades it teaches.
const WIKI_LABELS: Partial<Record<NpcRole, string>> = {
  weaponsmithTrainer: 'Armorcrafting and Weaponcrafting Trainer',
};

export function npcServiceLabel(role: NpcRole): string {
  return WIKI_LABELS[role] ?? t(`hudChrome.nameplate.npcRole.${role}`);
}
