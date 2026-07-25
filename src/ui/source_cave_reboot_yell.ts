// UI-boundary localization for the Source Cave's sim-emitted, game-authored
// mob lines: the reboot yells (boss + the two staggered reactions) and the
// friendly-phase interaction banter. Player-authored chat may contain the same
// English words, so the caller also supplies whether the speaker is a
// contributor mob before a payload is treated as game content.

import {
  SOURCE_CAVE_MOB_BANTER_LINES,
  SOURCE_CAVE_REBOOT_REACTION_YELLS,
  SOURCE_CAVE_REBOOT_YELL,
} from '../sim/source_cave';
import { t } from './i18n';

const GAME_LINE_KEYS: ReadonlyMap<string, Parameters<typeof t>[0]> = new Map([
  [SOURCE_CAVE_REBOOT_YELL, 'worldContent.sourceCaveRebootYell'],
  [SOURCE_CAVE_REBOOT_REACTION_YELLS[0], 'worldContent.sourceCaveRebootYellWhatsGoingOn'],
  [SOURCE_CAVE_REBOOT_REACTION_YELLS[1], 'worldContent.sourceCaveRebootYellServerDown'],
  [SOURCE_CAVE_MOB_BANTER_LINES[0], 'worldContent.sourceCaveBanterIssue'],
  [SOURCE_CAVE_MOB_BANTER_LINES[1], 'worldContent.sourceCaveBanterPullRequest'],
  [SOURCE_CAVE_MOB_BANTER_LINES[2], 'worldContent.sourceCaveBanterConflicts'],
  [SOURCE_CAVE_MOB_BANTER_LINES[3], 'worldContent.sourceCaveBanterContribute'],
  [SOURCE_CAVE_MOB_BANTER_LINES[4], 'worldContent.sourceCaveBanterFocused'],
  [SOURCE_CAVE_MOB_BANTER_LINES[5], 'worldContent.sourceCaveBanterNextRelease'],
  [SOURCE_CAVE_MOB_BANTER_LINES[6], 'worldContent.sourceCaveBanterRefresh'],
]);

export function localizeSourceCaveRebootYell(text: string, sourceCaveMob: boolean): string {
  if (!sourceCaveMob) return text;
  const key = GAME_LINE_KEYS.get(text);
  return key ? t(key) : text;
}
