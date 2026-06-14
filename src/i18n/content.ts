// Localized accessors for game content.
//
// The sim's content tables (names, quest prose, etc.) stay canonical English.
// These helpers overlay the active locale's translation when one exists and
// fall back to the English definition otherwise, so the client can render any
// content in the player's language without the sim ever knowing about locales.
//
// Call sites pass the stable content id (e.g. an ability/item/mob/quest id) —
// never a display string — so a missing translation degrades gracefully to
// English instead of breaking.

import { ABILITIES, CLASSES } from '../sim/content/classes';
import { ITEMS, MOBS, NPCS, QUESTS, ZONES, DUNGEONS } from '../sim/data';
import type { Aura, PlayerClass, ZoneDef } from '../sim/types';
import { getLocale } from './index';
import { ZH_CONTENT } from './content/zh';

// Pick the Chinese value when the locale is zh and a (non-empty) translation
// exists; otherwise use the canonical English fallback.
function pick(en: string, zh: string | undefined): string {
  return getLocale() === 'zh' && zh ? zh : en;
}

const ZONE_BY_ID: Record<string, ZoneDef> = Object.fromEntries(ZONES.map((z) => [z.id, z]));

// ---- Classes --------------------------------------------------------------
export function className(c: PlayerClass | string): string {
  return pick(CLASSES[c as PlayerClass]?.name ?? c, ZH_CONTENT.classes[c]);
}

// ---- Abilities ------------------------------------------------------------
export function abilityName(id: string): string {
  return pick(ABILITIES[id]?.name ?? id, ZH_CONTENT.abilities[id]?.name);
}
export function abilityDesc(id: string): string {
  return pick(ABILITIES[id]?.description ?? '', ZH_CONTENT.abilities[id]?.description);
}

// Buff/debuff label for an aura. Auras carry the id of the ability that applied
// them; when that's a real ability we can localize it, otherwise we fall back to
// the English name the sim stamped on the aura (e.g. boss-only pulses).
export function auraName(aura: Pick<Aura, 'id' | 'name'>): string {
  if (ABILITIES[aura.id]) return abilityName(aura.id);
  return auraDisplayName(aura.name);
}

// Reverse indexes so aura *events* (which carry an English display name, not an
// id) can still be localized: ability names and boss AoE-pulse names.
const ABILITY_ID_BY_NAME: Record<string, string> = {};
for (const [id, def] of Object.entries(ABILITIES)) ABILITY_ID_BY_NAME[def.name] = id;
const PULSE_MOB_BY_NAME: Record<string, string> = {};
for (const [id, m] of Object.entries(MOBS)) if (m.aoePulse) PULSE_MOB_BY_NAME[m.aoePulse.name] = id;

// Localize an aura/effect by its English display name (best-effort).
export function auraDisplayName(enName: string): string {
  const aid = ABILITY_ID_BY_NAME[enName];
  if (aid) return abilityName(aid);
  const mid = PULSE_MOB_BY_NAME[enName];
  if (mid) return pick(enName, ZH_CONTENT.mobs[mid]?.aoePulse);
  return enName;
}

// ---- Items ----------------------------------------------------------------
export function itemName(id: string): string {
  return pick(ITEMS[id]?.name ?? id, ZH_CONTENT.items[id]);
}

// ---- Mobs -----------------------------------------------------------------
export function mobName(id: string): string {
  return pick(MOBS[id]?.name ?? id, ZH_CONTENT.mobs[id]?.name);
}

// ---- NPCs -----------------------------------------------------------------
export function npcName(id: string): string {
  return pick(NPCS[id]?.name ?? id, ZH_CONTENT.npcs[id]?.name);
}
export function npcTitle(id: string): string {
  return pick(NPCS[id]?.title ?? '', ZH_CONTENT.npcs[id]?.title);
}
export function npcGreeting(id: string): string {
  return pick(NPCS[id]?.greeting ?? '', ZH_CONTENT.npcs[id]?.greeting);
}

// ---- Quests ---------------------------------------------------------------
export function questName(id: string): string {
  return pick(QUESTS[id]?.name ?? id, ZH_CONTENT.quests[id]?.name);
}
export function questText(id: string): string {
  return pick(QUESTS[id]?.text ?? '', ZH_CONTENT.quests[id]?.text);
}
export function questCompletion(id: string): string {
  return pick(QUESTS[id]?.completionText ?? '', ZH_CONTENT.quests[id]?.completionText);
}
export function questObjective(id: string, index: number): string {
  const en = QUESTS[id]?.objectives[index]?.label ?? '';
  return pick(en, ZH_CONTENT.quests[id]?.objectives?.[index]);
}

// ---- Zones ----------------------------------------------------------------
export function zoneName(id: string): string {
  return pick(ZONE_BY_ID[id]?.name ?? id, ZH_CONTENT.zones[id]?.name);
}
export function zoneWelcome(id: string): string {
  return pick(ZONE_BY_ID[id]?.welcome ?? '', ZH_CONTENT.zones[id]?.welcome);
}
export function zoneHub(id: string): string {
  return pick(ZONE_BY_ID[id]?.hub.name ?? '', ZH_CONTENT.zones[id]?.hub);
}
// Point-of-interest label, matched by its English text within the zone.
export function poiLabel(zoneId: string, englishLabel: string): string {
  const zone = ZONE_BY_ID[zoneId];
  if (!zone) return englishLabel;
  const idx = zone.pois.findIndex((p) => p.label === englishLabel);
  if (idx < 0) return englishLabel;
  return pick(englishLabel, ZH_CONTENT.zones[zoneId]?.pois?.[idx]);
}

// ---- Dungeons -------------------------------------------------------------
export function dungeonName(id: string): string {
  return pick(DUNGEONS[id]?.name ?? id, ZH_CONTENT.dungeons[id]?.name);
}
export function dungeonEnter(id: string): string {
  return pick(DUNGEONS[id]?.enterText ?? '', ZH_CONTENT.dungeons[id]?.enterText);
}
export function dungeonLeave(id: string): string {
  return pick(DUNGEONS[id]?.leaveText ?? '', ZH_CONTENT.dungeons[id]?.leaveText);
}
