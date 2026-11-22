/**
 * Light the character visual lays over a Paladin's held gear.
 *
 * Which Paladins hold Bastion Rite right now, and how much of it is left: the
 * Paladin kit (ability_vfx/bastion_rite.ts) notes it once a frame from the
 * aura, and the character visual reads it to light the shield the Paladin is
 * holding (characters/paladin_shield_glow_fx.ts). A note not renewed for a
 * moment has lapsed: the rite ended or the entity left.
 */
const HELD = new Map<number, { left: number; at: number }>();
// Generous, so a frame-stepped view (the VFX studio) does not lose a note
// between steps; the kit clears a note itself when its effect ends.
const LAPSE_MS = 1000;

export function noteBastionRiteShield(id: number, left: number, now = performance.now()): void {
  if (!Number.isFinite(id)) return;
  // Renewed once a frame per wearer: the note is mutated in place.
  const note = HELD.get(id) ?? { left: 0, at: 0 };
  note.left = share(left);
  note.at = now;
  if (!HELD.has(id)) HELD.set(id, note);
}

function share(left: number): number {
  return Number.isFinite(left) ? Math.min(1, Math.max(0, left)) : 0;
}

/** `id`'s Bastion Rite has ended: its shield is no longer lit. */
export function forgetBastionRiteShield(id: number): void {
  HELD.delete(id);
}

/** The share of `id`'s Bastion Rite still to run, or null when it holds none. */
export function bastionRiteShieldLeft(id: unknown, now = performance.now()): number | null {
  if (typeof id !== 'number') return null;
  const note = HELD.get(id);
  if (!note) return null;
  if (now - note.at > LAPSE_MS) {
    HELD.delete(id);
    return null;
  }
  return note.left;
}

/** Hallowed Wall's block after its absorb has broken: the plates are gone, so
 * the held shield carries the block (ability_vfx/hallowed_wall.ts). */
const WALLS = new Map<number, { left: number; at: number }>();

export function noteHallowedWallBlock(id: number, left: number, now = performance.now()): void {
  if (!Number.isFinite(id)) return;
  const note = WALLS.get(id) ?? { left: 0, at: 0 };
  note.left = share(left);
  note.at = now;
  if (!WALLS.has(id)) WALLS.set(id, note);
}

/** `id`'s Hallowed Wall block has ended, or its plates hold the absorb again. */
export function forgetHallowedWallBlock(id: number): void {
  WALLS.delete(id);
}

/** The spec sign burning on a held shield's face, as shares of the face's
 * half-width: its reach from the centre and how far it sits above it. Small
 * enough that its outline reads inside the shield's rim. The glow
 * (characters/paladin_shield_glow_fx.ts) and a cast sigil borne on the shield
 * (ability_vfx/paladin_cast_sigil.ts) draw it to the same size. */
export const SHIELD_SIGN_WIDTH = 0.6;
export const SHIELD_SIGN_RISE = 0.06;

/** A cast sigil borne on the held shield (ability_vfx/paladin_cast_sigil.ts,
 * once a frame while it shows): the shield lights as Bastion Rite lights it,
 * burning the sigil's spec icon on its face. */
const SIGILS = new Map<number, { left: number; spec: number; at: number }>();

export function noteShieldSigil(
  id: number,
  left: number,
  spec: number,
  now = performance.now(),
): void {
  if (!Number.isFinite(id)) return;
  const note = SIGILS.get(id) ?? { left: 0, spec: 0, at: 0 };
  note.left = share(left);
  note.spec = spec;
  note.at = now;
  if (!SIGILS.has(id)) SIGILS.set(id, note);
}

/** `id`'s shield sigil has faded: its light goes with it. */
export function forgetShieldSigil(id: number): void {
  SIGILS.delete(id);
}

function shieldSigil(id: number, now: number): { left: number; spec: number } | null {
  const note = SIGILS.get(id);
  if (!note) return null;
  if (now - note.at > LAPSE_MS) {
    SIGILS.delete(id);
    return null;
  }
  return note;
}

/** The spec icon (PALADIN_SPEC_EMBLEMS index) burning on `id`'s held shield:
 * its cast sigil's while one shows, otherwise null (Bastion Rite's own). */
export function shieldSigilSpec(id: unknown, now = performance.now()): number | null {
  return typeof id === 'number' ? (shieldSigil(id, now)?.spec ?? null) : null;
}

/** The light on `id`'s held shield: the largest share left of Bastion Rite,
 * Hallowed Wall's block and a cast sigil on it, or null when none holds. */
export function shieldBlockLeft(id: unknown, now = performance.now()): number | null {
  const buff = shieldBuffLeft(id, now);
  const sigil = typeof id === 'number' ? (shieldSigil(id, now)?.left ?? null) : null;
  if (sigil === null) return buff;
  return buff === null ? sigil : Math.max(buff, sigil);
}

function shieldBuffLeft(id: unknown, now: number): number | null {
  const rite = bastionRiteShieldLeft(id, now);
  if (typeof id !== 'number') return rite;
  const wall = WALLS.get(id);
  if (wall && now - wall.at > LAPSE_MS) WALLS.delete(id);
  const held = wall && now - wall.at <= LAPSE_MS ? wall.left : null;
  if (rite === null) return held;
  return held === null ? rite : Math.max(rite, held);
}

/** Test seam: forget every note. */
export function clearBastionRiteShields(): void {
  HELD.clear();
  WALLS.clear();
  SWINGS.clear();
  SHIELD_FLASHES.clear();
  SIGILS.clear();
}

/** Vowkeeper Strike's light on each Paladin's weapon, as the kit last set it
 * (ability_vfx/vowkeeper_strike.ts, once a frame through the swing). */
const SWINGS = new Map<number, { glow: number; flash: number; at: number }>();

export function noteVowkeeperWeapon(
  id: number,
  glow: number,
  flash: number,
  now = performance.now(),
): void {
  if (!Number.isFinite(id)) return;
  const note = SWINGS.get(id) ?? { glow: 0, flash: 0, at: 0 };
  note.glow = glow;
  note.flash = flash;
  note.at = now;
  if (!SWINGS.has(id)) SWINGS.set(id, note);
}

/** The light on `id`'s weapon through a Vowkeeper Strike, or null when none. */
export function vowkeeperWeaponGlow(
  id: unknown,
  now = performance.now(),
): { glow: number; flash: number } | null {
  if (typeof id !== 'number') return null;
  const swing = SWINGS.get(id);
  if (!swing) return null;
  if (now - swing.at > LAPSE_MS) {
    SWINGS.delete(id);
    return null;
  }
  return swing;
}

/** A flash of the held shield, as the kit last set it (Sunward Disc's throw
 * and catch, ability_vfx/sunward_disc.ts, once a frame while it shows). */
const SHIELD_FLASHES = new Map<number, { flash: number; at: number }>();

export function noteShieldFlash(id: number, flash: number, now = performance.now()): void {
  if (!Number.isFinite(id)) return;
  const note = SHIELD_FLASHES.get(id) ?? { flash: 0, at: 0 };
  note.flash = flash;
  note.at = now;
  if (!SHIELD_FLASHES.has(id)) SHIELD_FLASHES.set(id, note);
}

/** The flash on `id`'s held shield, or null when none. */
export function heldShieldFlash(id: unknown, now = performance.now()): number | null {
  if (typeof id !== 'number') return null;
  const note = SHIELD_FLASHES.get(id);
  if (!note) return null;
  if (now - note.at > LAPSE_MS) {
    SHIELD_FLASHES.delete(id);
    return null;
  }
  return note.flash;
}
