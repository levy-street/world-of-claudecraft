// Installing a class tuning document onto the shared ability table.
//
// The authoritative host loads its realm's document at boot and installs it
// ONCE, before the first `Sim` is constructed; the online client installs the
// same document when the server hands it over in the `hello` frame, so its
// tooltips, cooldown pips and cost predictions read the same numbers the server
// resolves. That is the whole reason tuning lands "on server restart" rather
// than live: a mid-flight table swap would change ability values underneath
// in-flight casts and cooldowns, and the two hosts would disagree for as long
// as the change took to reach the client.
//
// Determinism is unaffected: the transform is pure and runs to completion
// before any tick, so every host that installed the same document runs the same
// world, and a host that installed nothing runs the shipped table byte for byte.

import { ABILITIES, CLASSES, type ClassDef } from '../content/classes';
import { ITEMS } from '../data';
import { type AbilityDef, ALL_CLASSES, type PlayerClass, type WeaponInfo } from '../types';
import { applyAbilityTuning } from './ability_knobs';
import {
  type AbilityTuning,
  type ClassTuningDocument,
  classRangedWeaponId,
  emptyClassTuningDocument,
  sanitizeClassTuningDocument,
} from './document';
import { applyWeaponTuning } from './weapon_knobs';

/**
 * Pure form: a NEW ability table with the document applied. Abilities the
 * document does not name (and abilities whose factors all resolve to no change)
 * keep their shipped def by reference.
 */
export function applyClassTuning(
  abilities: Readonly<Record<string, AbilityDef>>,
  doc: ClassTuningDocument,
): Record<string, AbilityDef> {
  const out: Record<string, AbilityDef> = { ...abilities };
  for (const [abilityId, factors] of Object.entries(doc.abilities)) {
    // Own keys only: the tables are plain objects, so a bare `abilities[id]`
    // would answer an id like 'constructor' TRUTHY through the prototype chain
    // and hand the walker an Object function instead of a def. The sanitizer
    // rejects those ids, but a lookup this cheap does not get to rely on it.
    const base = Object.hasOwn(abilities, abilityId) ? abilities[abilityId] : undefined;
    if (!base) continue;
    out[abilityId] = applyAbilityTuning(base, factors as AbilityTuning);
  }
  return out;
}

// The shipped defs and weapon profiles displaced by the current install, so a
// re-install starts from the authored tables rather than compounding on top of
// itself.
const shippedDefs = new Map<string, AbilityDef>();
const shippedItemWeapons = new Map<string, WeaponInfo>();
const shippedClassRanged = new Map<PlayerClass, ClassDef['ranged']>();
let active: ClassTuningDocument = emptyClassTuningDocument();

/**
 * Apply `input` to the process-wide `ABILITIES` table, replacing whatever was
 * installed before. Returns the sanitized document that actually took effect.
 *
 * Call before constructing the `Sim`. Idempotent and reversible: installing an
 * empty document restores the shipped table exactly.
 */
export function installClassTuning(input: unknown): ClassTuningDocument {
  const doc = sanitizeClassTuningDocument(input);

  for (const [abilityId, shipped] of shippedDefs) ABILITIES[abilityId] = shipped;
  shippedDefs.clear();
  for (const [itemId, shipped] of shippedItemWeapons) {
    const item = ITEMS[itemId];
    if (item) (item as { weapon?: WeaponInfo }).weapon = shipped;
  }
  shippedItemWeapons.clear();
  for (const [cls, shipped] of shippedClassRanged) CLASSES[cls].ranged = shipped;
  shippedClassRanged.clear();

  for (const [abilityId, factors] of Object.entries(doc.abilities)) {
    // Object.hasOwn for the same reason as applyClassTuning above.
    const shipped = Object.hasOwn(ABILITIES, abilityId) ? ABILITIES[abilityId] : undefined;
    if (!shipped) continue;
    const tuned = applyAbilityTuning(shipped, factors);
    if (tuned === shipped) continue;
    shippedDefs.set(abilityId, shipped);
    ABILITIES[abilityId] = tuned;
  }

  // Auto-attack profiles. A carried weapon is keyed by item id; a class's own
  // ranged profile (hunter Auto Shot, caster wand) by classRangedWeaponId.
  for (const [weaponId, factors] of Object.entries(doc.weapons)) {
    const cls = classForRangedWeaponId(weaponId);
    if (cls) {
      const shipped = CLASSES[cls].ranged;
      if (!shipped) continue;
      const tuned = applyWeaponTuning(shipped, factors);
      if (tuned === shipped) continue;
      shippedClassRanged.set(cls, shipped);
      // applyWeaponTuning already returns a full clone of the shipped profile,
      // so assign it directly (same as the item arm below).
      CLASSES[cls].ranged = tuned;
      continue;
    }
    const item = Object.hasOwn(ITEMS, weaponId)
      ? (ITEMS[weaponId] as { weapon?: WeaponInfo })
      : undefined;
    const shipped = item?.weapon;
    if (!shipped) continue;
    const tuned = applyWeaponTuning(shipped, factors);
    if (tuned === shipped) continue;
    shippedItemWeapons.set(weaponId, shipped);
    if (item) item.weapon = tuned;
  }

  active = doc;
  return doc;
}

/**
 * Drop this process's install, restoring the shipped tables exactly.
 *
 * The client counterpart to the `hello` install: the tables are process-wide
 * module state, so a tab that leaves a tuned realm must not keep that realm's
 * numbers for whatever runs next (an offline world, a different realm reached
 * without another `hello`). The server never calls this: it installs once at
 * boot and lives on that document until it restarts.
 */
export function uninstallClassTuning(): void {
  installClassTuning(null);
}

const RANGED_ID_BY_CLASS = new Map<string, PlayerClass>(
  ALL_CLASSES.map((cls) => [classRangedWeaponId(cls), cls]),
);

function classForRangedWeaponId(weaponId: string): PlayerClass | null {
  return RANGED_ID_BY_CLASS.get(weaponId) ?? null;
}

/** The document currently installed on this process (empty when untuned). */
export function activeClassTuning(): ClassTuningDocument {
  return active;
}

/** The ability ids whose defs the current install has replaced. */
export function installedTunedAbilityIds(): string[] {
  return [...shippedDefs.keys()].sort();
}

/** The weapon ids (item ids plus class ranged ids) the current install has replaced. */
export function installedTunedWeaponIds(): string[] {
  return [
    ...shippedItemWeapons.keys(),
    ...[...shippedClassRanged.keys()].map(classRangedWeaponId),
  ].sort();
}
