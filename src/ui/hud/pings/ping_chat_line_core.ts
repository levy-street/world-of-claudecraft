// The chat callout a ping writes, the pure half (the DOM half is
// ping_chat_line.ts): one line in the classic callout shape, "Jose: Attack
// Training Effigy", split into the parts the painter dresses: the sender, the
// callout words in the ping kind's colour, and for a unit ping the unit's name
// in its reaction colour (hostile red, friendly green, neutral yellow).
//
// The line is two localized templates, so every locale keeps its own word
// order: the frame `hudChrome.pings.chatLine` ('{name}: {callout}') and the
// callout, either the kind's name (a ground ping) or the kind's unit template
// ('Attack {target}', a Japanese '{target}を攻撃'). The slots render to
// sentinels and are split here; a locale that drops a slot falls back to the
// plain parts in order, so a bad translation never swallows a name.
//
// DOM-free; the strings resolve through the i18n surface only.

import {
  type PartyPing,
  PING_ASSIST,
  PING_ATTACK,
  PING_LOOK,
  PING_ON_MY_WAY,
  PING_WARNING,
} from '../../../sim/social/party_pings';
import type { EntityKind } from '../../../sim/types';
import { type TranslationKey, t } from '../../i18n';
import { PING_KIND_LABEL_KEYS } from './ping_wheel_core';

/** How the pinged unit stands to the viewer, for its name's colour. */
export type PingReaction = 'hostile' | 'friendly' | 'neutral';

/** One run of the line. */
export type PingChatPart =
  | { part: 'text'; text: string }
  | { part: 'sender'; text: string }
  | { part: 'callout'; text: string }
  | { part: 'target'; text: string; reaction: PingReaction };

export interface PingChatLineModel {
  kind: number;
  /** The CSS class carrying the kind's colour token (.ping-kind-N). */
  kindClass: string;
  parts: PingChatPart[];
  /** The whole line as plain text (the announcer and tests read it). */
  plain: string;
}

const NAME_TOKEN = '__WOC_PING_NAME__';
const CALLOUT_TOKEN = '__WOC_PING_CALLOUT__';
const TARGET_TOKEN = '__WOC_PING_TARGET__';

const UNIT_CALLOUT_KEYS: Readonly<Record<number, TranslationKey>> = Object.freeze({
  [PING_LOOK]: 'hudChrome.pings.calloutLookUnit',
  [PING_ATTACK]: 'hudChrome.pings.calloutAttackUnit',
  [PING_WARNING]: 'hudChrome.pings.calloutWarningUnit',
  [PING_ON_MY_WAY]: 'hudChrome.pings.calloutOnMyWayUnit',
  [PING_ASSIST]: 'hudChrome.pings.calloutAssistUnit',
});

/** The class that tints a ping's chat line, wheel slot and icon: .ping-kind-N. */
export function pingKindClass(kind: number): string {
  return `ping-kind-${kind in UNIT_CALLOUT_KEYS ? kind : PING_LOOK}`;
}

/** What a pinged unit is to the viewer: the live entity's own reaction when
 *  this client has it (`live`: can the viewer attack it, and is it a wild
 *  hostile), else a fair guess from its kind (a mob out of view reads hostile,
 *  a player or NPC friendly, an object neutral). An attackable mob that is not
 *  wild hostile (a training dummy, a critter) is neutral, the classic yellow. */
export function pingTargetReaction(
  targetKind: EntityKind | null,
  live: { attackable: boolean; hostile: boolean } | null,
): PingReaction {
  if (live) {
    if (targetKind === 'object') return 'neutral';
    if (!live.attackable) return 'friendly';
    if (targetKind === 'mob' && !live.hostile) return 'neutral';
    return 'hostile';
  }
  if (targetKind === 'mob') return 'hostile';
  if (targetKind === 'object') return 'neutral';
  return 'friendly';
}

function splitOn(text: string, token: string): string[] {
  return text.split(token);
}

/** The callout's parts: the kind's words with the unit spliced in. */
function calloutParts(
  kind: number,
  target: { name: string; reaction: PingReaction } | null,
): PingChatPart[] {
  if (!target) {
    const key = PING_KIND_LABEL_KEYS[kind] ?? PING_KIND_LABEL_KEYS[PING_LOOK];
    return [{ part: 'callout', text: t(key) }];
  }
  const key = UNIT_CALLOUT_KEYS[kind] ?? UNIT_CALLOUT_KEYS[PING_LOOK];
  const pieces = splitOn(t(key, { target: TARGET_TOKEN }), TARGET_TOKEN);
  const unit: PingChatPart = { part: 'target', text: target.name, reaction: target.reaction };
  const out: PingChatPart[] = [];
  if (pieces.length === 1) {
    // The locale dropped the slot: keep its words, then the unit.
    if (pieces[0]) out.push({ part: 'callout', text: pieces[0] }, { part: 'text', text: ' ' });
    out.push(unit);
    return out;
  }
  pieces.forEach((piece, i) => {
    if (i > 0) out.push({ ...unit });
    if (piece) out.push({ part: 'callout', text: piece });
  });
  return out;
}

/**
 * The chat line a ping writes. `target` is the unit's localized name and its
 * reaction for a unit ping, null for a ground ping (or a unit this client
 * cannot name, which then reads as the plain callout).
 */
export function pingChatLineModel(
  ping: Pick<PartyPing, 'kind' | 'fromName' | 'target'>,
  target: { name: string; reaction: PingReaction } | null,
): PingChatLineModel {
  const unit = ping.target !== null && target && target.name ? target : null;
  const callout = calloutParts(ping.kind, unit);
  const frame = t('hudChrome.pings.chatLine', { name: NAME_TOKEN, callout: CALLOUT_TOKEN });
  const parts: PingChatPart[] = [];
  let sawName = false;
  let sawCallout = false;
  splitOn(frame, NAME_TOKEN).forEach((seg, i) => {
    if (i > 0) {
      parts.push({ part: 'sender', text: ping.fromName });
      sawName = true;
    }
    splitOn(seg, CALLOUT_TOKEN).forEach((piece, j) => {
      if (j > 0) {
        parts.push(...callout);
        sawCallout = true;
      }
      if (piece) parts.push({ part: 'text', text: piece });
    });
  });
  const safe =
    sawName && sawCallout
      ? parts
      : [
          { part: 'sender', text: ping.fromName } as PingChatPart,
          { part: 'text', text: ': ' } as PingChatPart,
          ...callout,
        ];
  return {
    kind: ping.kind,
    kindClass: pingKindClass(ping.kind),
    parts: safe,
    plain: safe.map((p) => p.text).join(''),
  };
}
