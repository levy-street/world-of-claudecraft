// A published creature whose family lacks a FAMILY_ORDER slot would silently vanish from
// the bestiary: the generator emits only ordered families, and the freshness test
// faithfully reproduces a buggy generator. Kept in its own module so the unit suite can
// prove the guard actually throws (build_content.mjs is not importable as a module).

/** Throws when famMap holds a family that familyOrder does not know. */
export function assertFamiliesKnown(famMap, familyOrder) {
  const unknown = Object.keys(famMap).filter((f) => !familyOrder.includes(f));
  if (unknown.length) {
    throw new Error(`bestiary family missing from FAMILY_ORDER: ${unknown.join(', ')}`);
  }
}
