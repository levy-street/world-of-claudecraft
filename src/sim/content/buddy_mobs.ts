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
// anyone tracing why this is 1.89: hunter-pet proportion (1x the rig's
// authored height) run through -70%, then +50% off that, then +100% off
// THAT (1 * 0.3 * 1.5 * 2 = 0.9), then cate_coin's own +200% bump made
// universal (0.9 * 3 = 2.7), then the dragon's own -30% (2.7 * 0.7 = 1.89)
// made universal in turn. (That dragon buddy has since been removed from the
// game; the number it set stayed, which is why the trail names a key the
// catalog no longer has.) No per-buddy override any more: buddyTemplate
// below takes no scale argument on purpose, so a new buddy can never be
// added at an inconsistent size.
const BUDDY_SCALE = 1.89;

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
  // mob_fox / mob_critter (src/render/characters/manifest.ts MOB_KEYS below)
  // carry `tint: 'entity'`, so color here is the real per-species dye, same
  // values the old BUDDY_VISUAL_SPECS.tint used.
  [buddyTemplateId('ember_fox')]: buddyTemplate('ember_fox', 'Ember Fox', 'beast', 0xd9662b),
  [buddyTemplateId('moss_hare')]: buddyTemplate('moss_hare', 'Moss Hare', 'beast', 0x6f8f5a),
  // The rest render dedicated GLBs (public/models/buddies/) with baked
  // textures and no `tint` on their VISUALS entry, so color below is inert —
  // kept only because MobTemplate.color is required.
  [buddyTemplateId('frog')]: buddyTemplate('frog', 'Frog', 'beast', 0xffffff),
  [buddyTemplateId('crimson_claw_crab')]: buddyTemplate(
    'crimson_claw_crab',
    'Crimson Claw Crab',
    'beast',
    0xffffff,
  ),
  [buddyTemplateId('golden_sentinel')]: buddyTemplate(
    'golden_sentinel',
    'Golden Sentinel',
    'beast',
    0xffffff,
  ),
  [buddyTemplateId('nightfang')]: buddyTemplate('nightfang', 'Nightfang', 'beast', 0xffffff),
  [buddyTemplateId('tuskhorn_boar')]: buddyTemplate(
    'tuskhorn_boar',
    'Tuskhorn Boar',
    'beast',
    0xffffff,
  ),
  [buddyTemplateId('emerald_wolf')]: buddyTemplate(
    'emerald_wolf',
    'Emerald Wolf',
    'beast',
    0xffffff,
  ),
  [buddyTemplateId('tiger')]: buddyTemplate('tiger', 'Tiger', 'beast', 0xffffff),
  [buddyTemplateId('cate_coin')]: buddyTemplate('cate_coin', 'Cate Coin', 'beast', 0xffffff),
  [buddyTemplateId('alon')]: buddyTemplate('alon', 'Alon', 'beast', 0xffffff),
  [buddyTemplateId('trollface')]: buddyTemplate('trollface', 'Trollface', 'beast', 0xffffff),
  [buddyTemplateId('ansem')]: buddyTemplate('ansem', 'Ansem', 'beast', 0xffffff),
  [buddyTemplateId('triple_t')]: buddyTemplate('triple_t', 'Triple T', 'beast', 0xffffff),
  [buddyTemplateId('kekius')]: buddyTemplate('kekius', 'Kekius', 'beast', 0xffffff),
  [buddyTemplateId('solbot')]: buddyTemplate('solbot', 'Solbot', 'beast', 0xffffff),
  [buddyTemplateId('frostfire')]: buddyTemplate('frostfire', 'Frostfire', 'beast', 0xffffff),
  [buddyTemplateId('rocky')]: buddyTemplate('rocky', 'Rocky', 'beast', 0xffffff),
  // The three vendor-only rares. Humanoid rigs (orc grunt, goblin, gnome),
  // family 'humanoid' so nothing in the pet/beast paths ever mistakes one for
  // a tameable; they still never fight, exactly like every other buddy.
  [buddyTemplateId('proud_grunt')]: buddyTemplate(
    'proud_grunt',
    'Proud Grunt',
    'humanoid',
    0xffffff,
  ),
  [buddyTemplateId('loot_goblin')]: buddyTemplate(
    'loot_goblin',
    'Loot Goblin',
    'humanoid',
    0xffffff,
  ),
  [buddyTemplateId('penny_goldspark')]: buddyTemplate(
    'penny_goldspark',
    'Penny Goldspark',
    'humanoid',
    0xffffff,
  ),
  // The beast tier drawn from the shipped creature rigs. Those rigs carry
  // `tint: 'entity'` in the visual manifest, so the color below is the real
  // per-buddy dye (the ember_fox/moss_hare model): a pet stag is not the same
  // brown as the mob its rig came from.
  [buddyTemplateId('stag')]: buddyTemplate('stag', 'Stag', 'beast', 0xb98a4e),
  [buddyTemplateId('alpaca')]: buddyTemplate('alpaca', 'Alpaca', 'beast', 0xe8dcc6),
  [buddyTemplateId('bull')]: buddyTemplate('bull', 'Bull', 'beast', 0x6b4a37),
  [buddyTemplateId('spider')]: buddyTemplate('spider', 'Spider', 'spider', 0x4a3d63),
  [buddyTemplateId('raptor')]: buddyTemplate('raptor', 'Raptor', 'reptile', 0x5f8a4a),
  [buddyTemplateId('skeleton')]: buddyTemplate('skeleton', 'Skeleton', 'undead', 0xd8d3c4),
  // The epic raid drop. Its own GLB with baked crystal textures and no tint,
  // so the color is inert here like every other dedicated-rig buddy.
  [buddyTemplateId('crystal_lich')]: buddyTemplate(
    'crystal_lich',
    'Crystal Lich',
    'undead',
    0xffffff,
  ),
  // The Crucible drop. Its own GLB carries the molten texture, so the color
  // is inert here like every other dedicated-rig buddy.
  [buddyTemplateId('forgemaw')]: buddyTemplate(
    'forgemaw',
    'Forgemaw The Molten',
    'elemental',
    0xffffff,
  ),
  // The fishing catch and the green elemental. Both ship their own GLB with
  // baked textures and no tint, so the color is inert here as usual.
  [buddyTemplateId('crystal_tide')]: buddyTemplate(
    'crystal_tide',
    'Crystal Tide',
    'beast',
    0xffffff,
  ),
  [buddyTemplateId('phantom')]: buddyTemplate('phantom', 'Phantom', 'elemental', 0xffffff),
};

/** Every valid buddy templateId, for the cheap `isBuddyMob` membership check
 *  (src/sim/pet/buddy_ai.ts) — a Set so a per-tick per-owned-mob check never
 *  scans the catalog. */
export const BUDDY_TEMPLATE_IDS: ReadonlySet<string> = new Set(Object.keys(BUDDY_MOBS));
