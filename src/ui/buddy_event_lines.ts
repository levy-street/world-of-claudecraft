// The chat lines for the two text-free buddy events (src/sim/types.ts
// buddyPresence / buddyRevealed): a pure plan the HUD
// paints, so the wording and colour are unit-pinned away from the coordinator.
//
// The presence line is the whole point of the boss-pet reveal (owner plan):
// the player reads that something is watching them, and only on the walk out
// does the companion show itself. Each companion carries its own line
// (hudChrome.collections.presence.<key>); a companion without one falls back
// to the shared line, so a new catalog entry never paints a raw key.

import { buddyTemplateId } from '../sim/content/buddy_mobs';
import { tEntity } from './entity_i18n';
import { type TranslationKey, t, tOptional } from './i18n';

export interface BuddyEventLine {
  text: string;
  color: string;
}

export const BUDDY_PRESENCE_COLOR = '#c8a8ff';
export const BUDDY_REVEAL_COLOR = '#ffd100';

/** The follower's localized name, through the same mob entity key the
 *  nameplate reads (src/ui/world_entity_i18n.ts). */
export function buddyDisplayName(key: string): string {
  return tEntity({ kind: 'mob', id: buddyTemplateId(key as never), field: 'name' });
}

export function buddyPresenceLine(key: string): BuddyEventLine {
  const own = `hudChrome.collections.presence.${key}` as TranslationKey;
  const text = tOptional(own) ?? t('hudChrome.collections.presenceDefault');
  return { text, color: BUDDY_PRESENCE_COLOR };
}

export function buddyRevealedLine(key: string): BuddyEventLine {
  return {
    text: t('hudChrome.collections.revealed', { name: buddyDisplayName(key) }),
    color: BUDDY_REVEAL_COLOR,
  };
}

/** The HUD's log() arguments for one event: `this.log(...buddyEventLogArgs(ev))`. */
export function buddyEventLogArgs(ev: Parameters<typeof buddyEventLine>[0]): [string, string] {
  const line = buddyEventLine(ev);
  return [line.text, line.color];
}

/** One entry point for the HUD's event switch. */
export function buddyEventLine(
  ev: { type: 'buddyPresence'; key: string } | { type: 'buddyRevealed'; key: string },
): BuddyEventLine {
  switch (ev.type) {
    case 'buddyPresence':
      return buddyPresenceLine(ev.key);
    case 'buddyRevealed':
      return buddyRevealedLine(ev.key);
  }
}
