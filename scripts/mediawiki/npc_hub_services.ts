import { npcRoleFor } from '../../src/sim/npc_role';
import type { NpcDef } from '../../src/sim/types';
import { npcServiceLabel } from './npc_service';

// The NPCs hub's Services groups for one NPC: its nameplate role, plus the services an
// NpcDef flag adds without a role (the weekly emissary and the world quest board). The
// flag labels are the ones the NPC's own Service rows use (npcServices in npc_service.ts).

export const FLAG_SERVICES: [flag: 'weeklyEmissary' | 'worldQuestBoard', label: string][] = [
  ['weeklyEmissary', 'Weekly quests'],
  ['worldQuestBoard', 'World quests'],
];

export function npcHubServices(n: NpcDef): string[] {
  const role = npcRoleFor(n);
  const out = role ? [npcServiceLabel(role)] : [];
  for (const [flag, label] of FLAG_SERVICES) if (n[flag] && !out.includes(label)) out.push(label);
  return out;
}
