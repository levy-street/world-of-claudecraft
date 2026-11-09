import { BUDDIES } from '../../src/sim/content/buddies';
import { buddyTemplateId } from '../../src/sim/content/buddy_mobs';
import { BUDDY_BOSS_DROPS } from '../../src/sim/content/buddy_sources';
import { pct } from './entity_format';

// The encyclopedia branch predates release v0.45.7's rate change. Boss IDs and
// companion keys are unchanged. Rates and group scaling match that tag's
// src/sim/content/buddy_sources.ts and src/sim/buddy_drops.ts.
export const companionBossSources = BUDDY_BOSS_DROPS.map(({ key, bossId }) => ({
  key,
  bossId,
  fullGroupChance: key === 'forgemaw' ? 0.0005 : 0.001,
}));
export const companionByCreature = new Map(
  Object.values(BUDDIES).map((b) => [buddyTemplateId(b.key), b]),
);

export function companionRollText(fullGroupChance: number): string {
  const solo = fullGroupChance * 10;
  return (
    'Heroic only. Every player who gets credit for the kill rolls on their own. ' +
    'With 10 or more players who can roll, your chance is ' +
    pct(fullGroupChance) +
    ' per kill. ' +
    'With fewer than 10, take ' +
    pct(solo) +
    ' and divide it by the number of those players. ' +
    'For example, your chance is ' +
    pct(solo / 5) +
    ' with five players, or ' +
    pct(solo) +
    ' alone. ' +
    'If you win, leave the instance. Your companion is then shown and added to your collection.'
  );
}
