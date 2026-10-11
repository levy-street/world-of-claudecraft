// ---------------------------------------------------------------------------
// Buddy cosmetics: the declarative catalog of looks a collected companion can
// wear. A cosmetic is a per-character unlock (PlayerMeta.buddies.cosmetics,
// src/sim/buddies.ts) and, once unlocked, can be EQUIPPED on the buddy it
// belongs to (one worn cosmetic per buddy). Zero gameplay effect, like the
// buddy itself.
//
// The only cosmetic kind today is a TINT: the entity dye the renderer already
// applies to any rig whose VISUALS entry opts in (`tint: 'entity'` or the
// cosmetic-only `tint: 'cosmetic'`, src/render/characters/manifest.ts). The
// worn tint replaces the buddy template's own color on the follower entity
// (spawnBuddyEntity), so the same wire field (`c`) carries it with no new
// protocol. Kinds that need more than a dye (particle trails, held props) are
// a later catalog extension; the unlock/equip plumbing does not care.
//
// WHERE a cosmetic comes from is NOT authored here: sources live in
// src/sim/content/buddy_sources.ts (challenges, deeds, tokens, grants) so the
// Hunting pane can derive them from the live tables, the same rule the
// buddies themselves follow.
//
// `src/sim`-pure, rng-free.
// ---------------------------------------------------------------------------

import type { BuddyKey } from './buddies';

export interface BuddyCosmeticDef {
  id: string;
  /** The one buddy this look fits. A cosmetic never crosses companions. */
  buddy: BuddyKey;
  /** Canonical English display name (localized at the client boundary through
   *  hudChrome.collections.cosmetic.<id>). */
  name: string;
  /** The entity dye worn while equipped (replaces the template color). */
  tint: number;
}

export const BUDDY_COSMETICS: Record<string, BuddyCosmeticDef> = {
  // -- Boss pets: the challenge looks. Speedrun the boss the pet dropped from
  // or hold a damage rate through the fight (buddy_sources.ts). -------------
  crystal_lich_frostbound: {
    id: 'crystal_lich_frostbound',
    buddy: 'crystal_lich',
    name: 'Frostbound',
    tint: 0x9fd8ff,
  },
  crystal_lich_voltaic: {
    id: 'crystal_lich_voltaic',
    buddy: 'crystal_lich',
    name: 'Voltaic',
    tint: 0xffe066,
  },
  forgemaw_ashen: {
    id: 'forgemaw_ashen',
    buddy: 'forgemaw',
    name: 'Ashen',
    tint: 0x8d8d8d,
  },
  forgemaw_whitehot: {
    id: 'forgemaw_whitehot',
    buddy: 'forgemaw',
    name: 'White-Hot',
    tint: 0xfff2cc,
  },
  // -- Achievement pets: crafted looks, from materials the grind hands out
  // (buddy_sources.ts BUDDY_COSMETIC_TOKENS + content/recipes.ts). ----------
  stag_acorn: {
    id: 'stag_acorn',
    buddy: 'stag',
    name: 'Acorn Crown',
    tint: 0xb8863b,
  },
  // -- Store looks: sold by a vendor for plain gold (the whole point of the
  // token item: a vendor row is the store). ---------------------------------
  stag_gilded: {
    id: 'stag_gilded',
    buddy: 'stag',
    name: 'Gilded',
    tint: 0xffd700,
  },
  // -- Deed look: earned by the wider gathering deed rather than one cap. ----
  moss_hare_verdant: {
    id: 'moss_hare_verdant',
    buddy: 'moss_hare',
    name: 'Verdant',
    tint: 0x3fbf5a,
  },
  // -- The test look (owner request 2026-09-09): the Frog dyed sapphire, to
  // prove the cosmetic dye end to end on a baked-texture rig. Grant-only for
  // now (`/dev buddylook frog_sapphire`, or the admin grant endpoint).
  frog_sapphire: {
    id: 'frog_sapphire',
    buddy: 'frog',
    name: 'Sapphire Frog',
    tint: 0x2f5fd8,
  },
  // -- Ladder/parse rewards: GRANT-only (admin grant endpoint, the monthly
  // PvP ladder and top-parse awards that an out-of-game job hands out). ----
  proud_grunt_warlord: {
    id: 'proud_grunt_warlord',
    buddy: 'proud_grunt',
    name: 'Warlord',
    tint: 0xc41e3a,
  },
};

/** Catalog order: declaration order. */
export const BUDDY_COSMETIC_IDS = Object.keys(BUDDY_COSMETICS) as readonly string[];

export function buddyCosmeticDef(id: string): BuddyCosmeticDef | null {
  return (BUDDY_COSMETICS as Record<string, BuddyCosmeticDef | undefined>)[id] ?? null;
}

/** Every cosmetic authored for `buddy`, in catalog order. */
export function buddyCosmeticsFor(buddy: BuddyKey): BuddyCosmeticDef[] {
  return BUDDY_COSMETIC_IDS.map((id) => BUDDY_COSMETICS[id]).filter((def) => def.buddy === buddy);
}
