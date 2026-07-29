// Pure derivation for the PET unit frame: resolve the player's own pet out of the
// entity roster and map it onto a UnitFrameDescriptor the shared unit_frame family
// paints. DOM-free, i18n-free (the localized "Dead" string arrives as a parameter,
// the same way party_frames.ts takes its `format` callback), deterministic.
//
// The pet frame is a further INSTANCE of the unit_frame family, not a new one: this
// core only decides WHICH entity is the pet and what its descriptor looks like, and
// unit_frame.ts / unit_frame_painter.ts do the rest unchanged.
//
// Why the roster scan lives here rather than in hud.ts: the same resolution is
// needed by the HUD (frame + pet action bar) and by the target-pet keybind in
// main.ts, and a pet is not addressable any other way. A pet is an ordinary mob
// entity whose ownerId is its owner's entity id (src/sim/pet/pet_commands.ts,
// petOf), so ownership is re-derived from the roster on both hosts identically.

import { DELVE_COMPANIONS } from '../sim/data';
import type { UnitFrameDescriptor } from './unit_frame';

/** The mob templates that are delve COMPANIONS rather than pets. A companion also
 *  carries its owner's id, so ownership alone cannot tell the two apart; this is the
 *  same discriminator the sim's own petOf uses (Sim.isDelveCompanionMob). Built once
 *  at module load from the content table, so a new companion joins it for free. */
export const DELVE_COMPANION_TEMPLATE_IDS: ReadonlySet<string> = new Set(
  Object.values(DELVE_COMPANIONS).map((c) => c.mobTemplateId),
);

/** The entity fields the pet frame reads. Structural on purpose: the offline Sim
 *  and the online ClientWorld both hold full `Entity` records, and a test can pass
 *  a plain object. */
export interface PetFrameUnit {
  id: number;
  kind: string;
  ownerId: number | null;
  templateId: string;
  name: string;
  hp: number;
  maxHp: number;
  dead: boolean;
}

/**
 * The player's own pet, or null when they have none.
 *
 * DEAD pets are returned deliberately: a hunter's pet survives its owner's death as
 * a revivable corpse, and both the pet frame and the target-frame revive menu must
 * keep showing it (the pet ACTION bar hides itself while the pet is dead, so the
 * frame is the affordance that survives).
 *
 * Delve companions are excluded, matching the sim's own petOf. They carry an ownerId
 * too, so without this a hunter inside a delve, whose real pet is stowed for the run,
 * would see the companion's health under a frame labelled as their pet, and clicking
 * it would select a different entity than the pet bar and the pet keybinds act on.
 */
export function findOwnPet<T extends PetFrameUnit>(
  entities: Iterable<T>,
  playerId: number,
): T | null {
  for (const e of entities) {
    if (e.kind !== 'mob' || e.ownerId !== playerId) continue;
    if (DELVE_COMPANION_TEMPLATE_IDS.has(e.templateId)) continue;
    return e;
  }
  return null;
}

/** A pet as a PARTY ROW needs it: enough to paint a health sliver and to select the
 *  pet by its entity id. Deliberately not `PetFrameUnit`, which is the roster-entity
 *  shape this derives FROM. */
export interface PartyPetInfo {
  /** The pet's entity id, so a click on the sliver can target it. */
  id: number;
  name: string;
  hp: number;
  maxHp: number;
  dead: boolean;
}

/**
 * Every pet in the roster, keyed by its OWNER's entity id, so a party row can look
 * up its member's pet by that member's pid (a party member's pid IS their entity id,
 * which is why the row's own click can call targetEntity(pid)).
 *
 * Only pets the client can actually see are in here: the roster is interest-scoped,
 * so a party member farther than the interest radius contributes nothing and their
 * row simply shows no pet sliver. That is deliberate rather than a gap to fill from
 * the wire: no ability in the game reaches past 35 yards, so a pet you cannot see is
 * one you could not act on anyway.
 *
 * Delve companions are excluded for the same reason findOwnPet excludes them: they
 * carry an ownerId too, and showing one as a party member's pet would be wrong.
 * The FIRST match per owner wins, matching the sim's one-pet-per-owner rule.
 */
export function findPetsByOwner<T extends PetFrameUnit>(
  entities: Iterable<T>,
): Map<number, PartyPetInfo> {
  const byOwner = new Map<number, PartyPetInfo>();
  for (const e of entities) {
    if (e.kind !== 'mob' || e.ownerId === null) continue;
    if (DELVE_COMPANION_TEMPLATE_IDS.has(e.templateId)) continue;
    if (byOwner.has(e.ownerId)) continue;
    byOwner.set(e.ownerId, {
      id: e.id,
      name: e.name,
      hp: e.hp,
      maxHp: e.maxHp,
      dead: e.dead,
    });
  }
  return byOwner;
}

/**
 * Fill a caller-owned descriptor for the pet frame. Allocation-light: the caller
 * keeps one long-lived descriptor and this rewrites its fields in place.
 *
 * Pets carry no power resource at all (createMob never sets resourceType), so the
 * resource group is always `none` and the frame paints hp only, exactly like the
 * target-of-target mini-frame.
 */
export function petFrameDescriptorInto(
  d: UnitFrameDescriptor,
  pet: PetFrameUnit | null,
  deadText: string,
): UnitFrameDescriptor {
  if (!pet) {
    d.present = false;
    return d;
  }
  d.present = true;
  d.hpFrac = pet.hp / Math.max(1, pet.maxHp);
  d.hpText = pet.dead ? deadText : `${pet.hp} / ${pet.maxHp}`;
  d.showAbsorbText = false;
  d.resourceKind = 'none';
  d.resFrac = 0;
  d.resText = '';
  // The pet's level always tracks its owner's (syncPetLevel), so a level chip would
  // only ever restate the player frame's. The chip element exists for the family's
  // element set; null keeps it blank.
  d.levelText = null;
  d.name = pet.name;
  d.titlePre = '';
  d.titlePost = '';
  d.portraitKey = String(pet.id);
  d.absorb = null;
  d.dead = pet.dead;
  d.outOfRange = false;
  return d;
}
