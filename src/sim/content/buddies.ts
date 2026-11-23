// ---------------------------------------------------------------------------
// Buddies: cosmetic followers, the declarative catalog.
//
// A buddy has zero GAMEPLAY effect: no stats, no abilities, no combat, no
// riding-skill gate, no summon channel, no stat recompute. It IS a real
// server-simulated owned mob entity (src/sim/content/buddy_mobs.ts's
// MobTemplate per key, spawned/despawned by src/sim/buddies.ts and heeled by
// src/sim/pet/buddy_ai.ts using the same A*-pathed locomotion as a hunter
// pet), which is the "AI" this catalog has: purely locomotion, never combat.
// Ownership is an account collection online, with no inventory items.
// The Cosmetics menu manages companions. Summoning pairs the
// Entity.buddyKey identity with a real follower entity spawn or despawn.
//
// Used by the authoritative Sim (ownership + the active-buddy flip + the
// entity itself), the renderer (key -> body via the normal per-mob path,
// MOB_KEYS in src/render/characters/manifest.ts keyed on buddyTemplateId),
// and any future HUD picker. Lives in sim/ so it carries no DOM/render
// imports and runs unchanged on the server, offline, and headless.
// ---------------------------------------------------------------------------

export type BuddyKey = 'horse' | 'crystal_lich' | 'forgemaw' | 'sprites';

export interface BuddyDef {
  key: BuddyKey;
  /** Canonical English display name (the HUD localizes via entities.mobs.buddy_<key>.name, src/ui/world_entity_i18n.ts). */
  name: string;
}

export const BUDDIES: Record<BuddyKey, BuddyDef> = {
  horse: {
    key: 'horse',
    name: 'Tug, the Warhorse',
  },
  crystal_lich: {
    key: 'crystal_lich',
    name: 'Crystal Lich',
  },
  forgemaw: {
    key: 'forgemaw',
    name: 'Forgemaw The Molten',
  },
  sprites: {
    key: 'sprites',
    name: 'Flicker and Glimmer',
  },
};

// Companions have no inventory items requiring item artwork.
export const BUDDY_ART_PENDING_ITEM_IDS: readonly string[] = [];

/** Catalog order: declaration order. */
export const BUDDY_KEYS = Object.keys(BUDDIES) as readonly BuddyKey[];

export function buddyDef(key: string): BuddyDef | null {
  return (BUDDIES as Record<string, BuddyDef | undefined>)[key] ?? null;
}

/** Coerce a persisted/wire string back to a valid catalog key ('' when
 *  unknown, so a save/wire value from a build that removed a buddy loads
 *  cleanly with none out), mirroring normalizeMountKey. */
export function normalizeBuddyKey(key: string | undefined | null): BuddyKey | '' {
  return key && buddyDef(key) ? (key as BuddyKey) : '';
}
