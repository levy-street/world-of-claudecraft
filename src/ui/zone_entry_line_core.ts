// The chat-pane line the HUD logs when the player crosses into a zone: the
// localized zone welcome hint while the zone's welcome quest is still on offer,
// the zone's localized town-done line (ZoneDef.welcomeDone) once every town
// quest (sim/town_quests.ts) is turned in, nothing otherwise. The decision
// itself is the sim leaf's zoneEntryHint; this core only maps the hint to
// localized text, so the HUD stays a one-line consumer and the rule is testable
// without a DOM. Pure core: no DOM, no Three; the world dependency is the two
// members it reads.
import { zoneEntryHint } from '../sim/town_quests';
import type { PlayerClass, QuestState, ZoneDef } from '../sim/types';
import { zoneWelcome, zoneWelcomeDone } from './entity_display_core';

export interface ZoneEntryWorld {
  questState(questId: string): QuestState;
  cfg: { playerClass: PlayerClass };
}

export function zoneEntryLine(zone: ZoneDef, world: ZoneEntryWorld): string | null {
  const hint = zoneEntryHint(zone, (questId) => world.questState(questId), world.cfg.playerClass);
  if (hint === 'town_done') return zoneWelcomeDone(zone.id);
  if (hint === 'welcome') return zoneWelcome(zone.id);
  return null;
}
