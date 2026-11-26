// What the group's pings do on THIS client, the pure half (the DOM half is
// ping_feed_controller.ts): which pings are new since the last look (each
// new one plays its sound and writes its chat line once), which are near
// enough to matter (a group mate across the world does not ping your
// screen), the chat line's key and values, each kind's sound, and where a
// ping sits on the minimap. DOM-free; the names resolve through the i18n
// surface only.

import {
  type PartyPing,
  PING_ASSIST,
  PING_ATTACK,
  PING_LOOK,
  PING_ON_MY_WAY,
  PING_WARNING,
} from '../../../sim/social/party_pings';
import type { Entity } from '../../../sim/types';
import { entityDisplayName } from '../../entity_display_core';
import { tEntity } from '../../entity_i18n';
import { pingChatLineModel } from './ping_chat_line_core';

/** How far from the viewer a ping still sounds, logs and draws (yards). */
export const PING_VIEW_RANGE = 300;

/** True when the ping's point is within PING_VIEW_RANGE of the viewer. */
export function pingInView(
  ping: Pick<PartyPing, 'x' | 'z'>,
  viewer: { x: number; z: number },
): boolean {
  return Math.hypot(ping.x - viewer.x, ping.z - viewer.z) <= PING_VIEW_RANGE;
}

/**
 * The pings in `pings` this client has not seen yet, in order. `seen` is the
 * caller's set of ids; it is updated in place (new ids join, ids no longer
 * live leave, so it stays bounded by the live pings).
 */
export function takeNewPings(seen: Set<number>, pings: readonly PartyPing[]): PartyPing[] {
  const fresh: PartyPing[] = [];
  for (const p of pings) if (!seen.has(p.id)) fresh.push(p);
  if (seen.size > 0) {
    for (const id of seen) if (!pings.some((p) => p.id === id)) seen.delete(id);
  }
  for (const p of fresh) seen.add(p.id);
  return fresh;
}

/** Each kind's sound: its own layered ping cue (scripts/sfx/ping_sfx.mjs),
 *  one per kind and built for its meaning: Look Here a bright glass ping,
 *  Attack a blade shing that lands on a punch, Warning one clashing, wobbling bell,
 *  On My Way a clean fluttering beacon tone, Assist a warm bowl
 *  with a soft sparkle. Mastered at their own pitch (rate 1); the gains even
 *  out the five's loudness. Every one plays on the SFX bus (sfx.playUi, the
 *  SFX volume). */
export const PING_SOUNDS: Readonly<Record<number, { key: string; rate: number; gain: number }>> =
  Object.freeze({
    [PING_LOOK]: { key: 'ui_ping_look', rate: 1, gain: 1 },
    [PING_ATTACK]: { key: 'ui_ping_attack', rate: 1, gain: 1 },
    [PING_WARNING]: { key: 'ui_ping_warning', rate: 1, gain: 1 },
    [PING_ON_MY_WAY]: { key: 'ui_ping_on_my_way', rate: 1, gain: 0.8 },
    [PING_ASSIST]: { key: 'ui_ping_assist', rate: 1, gain: 0.85 },
  });

/** The localized name of a ping's unit: the live entity's display name when
 *  this client has it, else its template's name (a mob or NPC out of view),
 *  else the raw name the server sent (a player). */
export function pingTargetName(ping: PartyPing, live: Entity | undefined): string {
  if (live) return entityDisplayName(live);
  if (ping.targetKind === 'mob' && ping.targetTemplate)
    return tEntity({ kind: 'mob', id: ping.targetTemplate, field: 'name' });
  if (ping.targetKind === 'npc' && ping.targetTemplate)
    return tEntity({ kind: 'npc', id: ping.targetTemplate, field: 'name' });
  return ping.targetName;
}

/** The chat line a ping writes, as plain text: "Name: Attack Wolf", "Name:
 *  Look Here" (the dressed parts are ping_chat_line_core.ts). */
export function pingChatLine(ping: PartyPing, targetName: string | null): string {
  const target = targetName ? { name: targetName, reaction: 'neutral' as const } : null;
  return pingChatLineModel(ping, target).plain;
}

/** Where a ping sits on the north-up, player-centred minimap (canvas px,
 *  +X world is map-left, +Z world is map-up), pulled in to the rim when it
 *  lies past it. `edge` is true when it was pulled in. */
export function pingMinimapPoint(
  ping: { x: number; z: number },
  player: { x: number; z: number },
  pxPerYard: number,
  size: number,
  rim: number,
): { x: number; y: number; edge: boolean } {
  const half = size / 2;
  let dx = -(ping.x - player.x) * pxPerYard;
  let dy = -(ping.z - player.z) * pxPerYard;
  const d = Math.hypot(dx, dy);
  const edge = d > rim;
  if (edge) {
    dx = (dx / d) * rim;
    dy = (dy / d) * rim;
  }
  return { x: half + dx, y: half + dy, edge };
}
