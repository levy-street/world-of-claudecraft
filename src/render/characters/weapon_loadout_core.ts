/** Which clip set a WOC body plays for what its hands actually hold (ClipMap.loadoutSwaps).
 *
 * The one-hand clips are authored for a weapon in the right hand and a SHIELD in the left
 * (the off hand is presented forward at chest height). Three other loadouts get their own maps:
 *   'twohand': a two-hand weapon (greatsword, two-hand axe or mace, polearm): held in one fist
 *              like a one-hand sword everywhere, no two-hand stance (2026-09-30): the one-hand
 *              clips out of combat, the single set in combat, its heavy chop included (a
 *              one-hand weapon or a staff keeps the both-fists 2H_Chop, so this stays its own
 *              loadout). No roll is applied: the weapon sits in the fist unturned;
 *   'single':  a one-hand weapon with nothing in the off hand: the free hand stays down;
 *   'dual':    a weapon in each hand (rogue daggers, fury and enhancement blades): the two
 *              blades crossed in front of the chest, and the fast strikes struck from that X.
 *              Two-handers count too: a Fury warrior's Titan's Grip pair (a two-hander in
 *              either hand) fights from the dual stance, never the one-weapon two-hand set.
 * Staves are carried in one hand by these bodies (the staff classes idle like everyone else),
 * so a staff counts as a one-hand weapon whatever its hand flag. Sheathed props leave the
 * hands empty: no loadout, the default clips.
 *
 * Node-only (RENDER_PURE_CORES): no three.js, no DOM.
 */
import { weaponTypeForItem } from '../../sim/content/weapon_skin_rules';
import { ITEMS } from '../../sim/data';
import { weaponHand } from '../../sim/equipment_rules';

export type WeaponLoadout = 'twohand' | 'single' | 'dual';

export interface LoadoutFacts {
  mainhandItemId: string | null;
  offhandItemId: string | null;
  /** The props are sheathed on the back (the Z toggle): the hands are empty. */
  stowed: boolean;
  /** The body shows the equipped mainhand (VisualDef.weaponSlots); false = a fixed attach
   *  that no item replaces (the hunter's crossbow, held in one hand). */
  showsMainhand: boolean;
  /** The body shows the equipped offhand (VisualDef.offhandSlot); an offhand it cannot show
   *  leaves the hand as empty as no offhand at all. */
  showsOffhand: boolean;
  /** A fixed off-hand prop no equipped item replaces (the warlock's book): the hand is full. */
  fixedOffhand: boolean;
}

export function weaponLoadout(f: LoadoutFacts): WeaponLoadout | null {
  if (f.stowed) return null;
  // a weapon in each hand is the dual set whatever either weapon's hand flag says: a Titan's
  // Grip pair holds one two-hander per fist and fights from the crossed-blade stance
  if (
    f.showsMainhand &&
    f.showsOffhand &&
    !f.fixedOffhand &&
    f.offhandItemId &&
    ITEMS[f.offhandItemId]?.kind === 'weapon'
  ) {
    return 'dual';
  }
  if (f.showsMainhand && f.mainhandItemId) {
    const main = ITEMS[f.mainhandItemId];
    if (
      main?.kind === 'weapon' &&
      weaponHand(main) === 'twohand' &&
      weaponTypeForItem(f.mainhandItemId) !== 'staff'
    ) {
      return 'twohand';
    }
  }
  if (f.fixedOffhand) return null;
  // any other offhand (a shield, a held book) keeps the default set; a weapon was caught above
  if (f.showsOffhand && f.offhandItemId) return null;
  return 'single';
}

/** The clip a rig plays for `name` under a swap map: the map's variant when it names one,
 *  null when it maps the clip to '' (suppressed under this loadout, e.g. a fidget authored
 *  with a free hand), else `name` itself. `has` reports whether the loaded rig carries a clip,
 *  so a variant missing from the GLB falls back to the named clip. */
export function swappedClip(
  swap: Readonly<Record<string, string>> | null,
  name: string,
  has: (clip: string) => boolean,
): string | null {
  const alt = swap?.[name];
  if (alt === undefined) return name;
  if (alt === '') return null;
  return has(alt) ? alt : name;
}
