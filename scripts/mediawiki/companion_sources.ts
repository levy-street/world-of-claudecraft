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
    'Heroic only. Every player who receives kill credit gets a separate roll. ' +
    'With 10 or more eligible players, your chance is ' +
    pct(fullGroupChance) +
    ' per kill. ' +
    'With fewer than 10, divide ' +
    pct(solo) +
    ' by the number of eligible players. ' +
    'For example, your chance is ' +
    pct(solo / 5) +
    ' with five players or ' +
    pct(solo) +
    ' alone. ' +
    'If you win, leave the instance to reveal your companion and add it to your collection.'
  );
}
