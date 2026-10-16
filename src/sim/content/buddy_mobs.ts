import type { MobTemplate } from '../types';
import type { BuddyKey } from './buddies';

// Mob templates backing the real, server-simulated buddy follower entity
// (src/sim/pet/buddy_ai.ts spawns/heels one of these exactly like a hunter
// pet, minus every combat field). One entry per BuddyKey (src/sim/content/
// buddies.ts), id-prefixed so a buddy's own templateId can never collide
// with a real tameable/summoned mob's. hp/dmg are non-zero only because
// createMob's stat math (src/sim/entity.ts) always runs it; a buddy never
// takes or deals damage (spawned hostile:false, and nothing ever targets an
// owned, non-hostile entity). scale is the ONLY visible-size knob now — the
// old render-only BUDDY_VISUAL_SPECS.scale multiplier is gone along with the
// purely-cosmetic follower system it belonged to.
export const BUDDY_TEMPLATE_PREFIX = 'buddy_';

export function buddyTemplateId(key: BuddyKey): string {
  return `${BUDDY_TEMPLATE_PREFIX}${key}`;
}

// One shared scale for the whole roster (2026-08-30 owner request: use the
// dragon's own scale for every buddy, present and future). History, for
// anyone tracing why this is 1.701: hunter-pet proportion (1x the rig's
// authored height) run through -70%, then +50% off that, then +100% off
// THAT (1 * 0.3 * 1.5 * 2 = 0.9), then cate_coin's own +200% bump made
// universal (0.9 * 3 = 2.7), then the dragon's own -30% (2.7 * 0.7 = 1.89)
// made universal in turn, and finally a roster-wide -10% (1.89 * 0.9 =
// 1.701, the 2026-09-08 owner request). (That dragon buddy has since been
// removed from the game; the number it set stayed, which is why the trail
// names a key the catalog no longer has.) No per-buddy override any more:
// buddyTemplate below takes no scale argument on purpose, so a new buddy can
// never be added at an inconsistent size.
const BUDDY_SCALE = 1.701;

function buddyTemplate(
  key: BuddyKey,
  name: string,
  family: MobTemplate['family'],
  color: number,
): MobTemplate {
  return {
    id: buddyTemplateId(key),
    name,
    minLevel: 1,
    maxLevel: 60,
    family,
    hpBase: 1,
    hpPerLevel: 0,
    dmgBase: 0,
    dmgPerLevel: 0,
    attackSpeed: 2,
    armorPerLevel: 0,
    moveSpeed: 7,
    aggroRadius: 0,
    loot: [],
    scale: BUDDY_SCALE,
    color,
  };
}

export const BUDDY_MOBS: Record<string, MobTemplate> = {
  [buddyTemplateId('horse')]: buddyTemplate('horse', 'Tug, the Warhorse', 'beast', 0xffffff),
  [buddyTemplateId('crystal_lich')]: buddyTemplate(
    'crystal_lich',
    'Crystal Lich',
    'undead',
    0xffffff,
  ),
  [buddyTemplateId('forgemaw')]: buddyTemplate(
    'forgemaw',
    'Forgemaw The Molten',
    'elemental',
    0xffffff,
  ),
  [buddyTemplateId('sapling')]: buddyTemplate('sapling', 'Sapling', 'elemental', 0xffffff),
};

/** Every valid buddy templateId, for the cheap `isBuddyMob` membership check
 *  (src/sim/pet/buddy_ai.ts) — a Set so a per-tick per-owned-mob check never
 *  scans the catalog. */
export const BUDDY_TEMPLATE_IDS: ReadonlySet<string> = new Set(Object.keys(BUDDY_MOBS));
