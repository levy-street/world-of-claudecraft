// Localized text for the raid lockout indicator: the one place the lockout
// countdown calls t(), and the one home of the lockout-id -> display-name
// rule. The pure split (whole day/hour/minute parts and the display shape)
// stays in raid_lockout.ts, which deliberately carries no i18n runtime import;
// this thin sibling splices those parts into the hudChrome.raidLockout
// templates so hud.ts is a consumer of both (the minimap panel and the
// entry-denied toast read the same string), and character select
// (charselect_hints.ts) names and times each roster row's lockouts through
// the same two functions. Unit tested in tests/raid_lockout_format.test.ts.

import { weeklyQuestIdFromLockout } from '../sim/quests/weekly_quest_lock';
import { parseBossLockoutId } from '../sim/raid_boss_lockout_id';
import { worldBossIdFromLockout } from '../sim/world_boss';
import { dungeonDisplayName, tEntity } from './entity_i18n';
import { journalEntryForMob, journalInstanceForRoom } from './hud/journal/journal_catalog';
import { formatNumber, t } from './i18n';
import { lockoutParts, lockoutShape } from './raid_lockout';

/** The localized name of the raid a lockout id locks. A looted world boss rides
 *  a `worldboss:<mobId>` id (markWorldBossLooted in src/sim/world_boss.ts) and
 *  names as the boss mob; a heroic daily rides `<dungeon>:heroic` and names as
 *  "Heroic <dungeon>"; anything else is a bare dungeon id. */
export function raidLockoutDisplayName(id: string): string {
  const bossId = worldBossIdFromLockout(id);
  if (bossId !== null) return tEntity({ kind: 'mob', id: bossId, field: 'name' });
  // A weekly quest turned in this week names as the quest (weekly_quest_lock.ts).
  const questId = weeklyQuestIdFromLockout(id);
  if (questId !== null) return tEntity({ kind: 'quest', id: questId, field: 'title' });
  // One boss of a per-boss raid (the Smith's Heart): "<raid>: <boss>", the boss
  // named as its Adventure Journal page is (a council reads as its pair).
  const bossLock = parseBossLockoutId(id);
  if (bossLock !== null) {
    const values = {
      raid: dungeonDisplayName(bossLock.raidId),
      boss: bossPageName(bossLock.raidId, bossLock.encounterId),
    };
    return bossLock.difficulty === 'heroic'
      ? t('hudChrome.raidLockout.bossNameHeroic', values)
      : t('hudChrome.raidLockout.bossName', values);
  }
  if (id.endsWith(':heroic')) {
    return t('hudChrome.raidLockout.heroicName', {
      name: dungeonDisplayName(id.slice(0, -':heroic'.length)),
    });
  }
  return dungeonDisplayName(id);
}

/** The localized name of a per-boss lock's boss: its journal page's title
 *  key when the raid's journal has one, else the boss mob's own name. */
function bossPageName(raidId: string, encounterId: string): string {
  const instance = journalInstanceForRoom(raidId);
  const entry = journalEntryForMob(encounterId);
  const nameKey =
    instance && entry?.instanceId === instance.id
      ? instance.source.view(entry.bossKey, 'normal').nameKey
      : undefined;
  return nameKey ? t(nameKey) : tEntity({ kind: 'mob', id: encounterId, field: 'name' });
}

/** Localized "Xd Yh" / "Xh Ym" / "Xm" / "<1m" for a remaining-ms span; the
 *  digits run through formatNumber (ungrouped, so a long lockout never picks
 *  up a thousands separator) and the units reorder via the t() template. */
export function formatLockoutDuration(ms: number): string {
  const { days, hours, minutes } = lockoutParts(ms);
  const n = (v: number) => formatNumber(v, { maximumFractionDigits: 0, useGrouping: false });
  switch (lockoutShape(ms)) {
    case 'daysHours':
      return t('hudChrome.raidLockout.daysHours', {
        d: n(days),
        h: n(hours),
      });
    case 'hoursMinutes':
      return t('hudChrome.raidLockout.hoursMinutes', {
        h: n(hours),
        m: n(minutes),
      });
    case 'minutes':
      return t('hudChrome.raidLockout.minutes', { m: n(minutes) });
    default:
      return t('hudChrome.raidLockout.lessThanMinute');
  }
}
