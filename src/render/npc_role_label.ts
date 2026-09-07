// The localized text of an NPC nameplate's role line. Thin i18n consumer over
// the pure rule in src/sim/npc_role.ts: a functional role resolves to its
// hudChrome.nameplate.npcRole.<id> label, an NPC with no functional role falls
// back to its authored flavor title (so "Loremaster" still reads as
// something), and an unknown template id (a mirror ahead of its content
// bundle) draws no line rather than a raw id. Not a *_core: it calls t().

import { NPCS } from '../sim/data';
import { type NpcRole, npcRoleFor } from '../sim/npc_role';
import { npcDisplayTitle } from '../ui/entity_display_labels';
import { t } from '../ui/i18n';

/** Role per template id, resolved once: the rule reads only immutable content
 *  tables, and resolveContent asks for every visible NPC plate on each full
 *  pass, so the stock walk must not repeat per plate per pass. */
const ROLE_BY_NPC = new Map<string, NpcRole | null>();

export function npcRoleLabel(npcId: string): string {
  const def = NPCS[npcId];
  if (!def) return '';
  let role = ROLE_BY_NPC.get(npcId);
  if (role === undefined) {
    role = npcRoleFor(def);
    ROLE_BY_NPC.set(npcId, role);
  }
  if (role) return t(`hudChrome.nameplate.npcRole.${role}`);
  return def.title ? npcDisplayTitle(npcId) : '';
}
