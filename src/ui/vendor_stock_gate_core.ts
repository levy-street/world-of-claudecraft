// Pure, host-agnostic vendor stock gate: filters an NPC's vendorItems down
// to the rows the viewing player may currently buy, off the same
// NpcDef.vendorQuestGates data the sim's buyItem validates against
// (src/sim/items.ts), so what the window shows and what the server sells can
// never disagree. A gated row appears once its quest is in the log and stays
// once the quest is done (a graduate can buy a second pouch). First user:
// the tutorial island's Linen Pouch (q_ps_pouch_and_purse).
//
// The pure-core half of the pure-core + thin-consumer split (root
// CLAUDE.md): DOM-free, driven directly by
// tests/vendor_stock_gate_core.test.ts, registered in UI_PURE_CORES
// (tests/architecture.test.ts). Works identically against the Sim- and
// ClientWorld-shaped inputs (both expose questLog/questsDone via IWorld).

import { NPCS } from '../sim/data';

export function visibleVendorStock(
  npc: { templateId?: string; vendorItems: readonly string[] },
  questLog: ReadonlyMap<string, unknown>,
  questsDone: ReadonlySet<string>,
): string[] {
  const gates = NPCS[npc.templateId ?? '']?.vendorQuestGates;
  if (!gates) return [...npc.vendorItems];
  return npc.vendorItems.filter((itemId) => {
    const gateQuest = gates[itemId];
    return !gateQuest || questLog.has(gateQuest) || questsDone.has(gateQuest);
  });
}
