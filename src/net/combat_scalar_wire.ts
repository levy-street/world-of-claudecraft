// Mirrors the self-wire record's static combat-rating scalars and weapon
// fields onto the ClientWorld's local Entity mirror. Kept as its own module
// (the account_cosmetics_wire.ts / guild_bank_log_wire.ts convention) so
// online.ts stays a consumer rather than growing another decode block; a new
// self-wire scalar lands here, not as another inline `e.x = s.y ?? e.x` line
// in the coordinator.
//
// Every field here is delta-guarded on selfWireJson (server/game.ts): an
// omitted key means unchanged, not zero, so the fallback is always the prior
// mirrored value (`s.X ?? e.X`), the one exception being rangedPower, which
// falls back to 0 (hunters carry it; every other class has none to omit).

import type { Entity } from '../sim/types';

// biome-ignore lint/suspicious/noExplicitAny: mirrors online.ts's own LooseJson wire-record idiom
export function applySelfCombatScalars(e: Entity, s: any): void {
  e.attackPower = s.ap ?? e.attackPower;
  e.rangedPower = s.rp ?? 0;
  e.spellPower = s.sp ?? e.spellPower;
  e.healPower = s.hpw ?? e.healPower;
  // Spell haste feeds the hasted-cast-time tooltip; melee/ranged haste need no
  // wiring (the swing timers already ride the snapshot).
  e.spellHaste = s.sh ?? e.spellHaste;
  e.critChance = s.crit ?? e.critChance;
  e.dodgeChance = s.dodge ?? e.dodgeChance;
  e.blockChance = s.blk ?? e.blockChance;
  e.blockValue = s.bval ?? e.blockValue;
  // Crit/haste/hit RATING are informational paper-doll stats (combat values
  // ride crit/sh above, and hit resolves server-side); delta-guarded like the
  // rest of this record so the online character sheet keeps showing the
  // last-known value between gear/talent changes instead of flashing back to
  // the blankEntity 0. Server-recomputed.
  e.critRating = s.crat ?? e.critRating;
  e.hasteRating = s.hrat ?? e.hasteRating;
  e.hitRating = s.hirat ?? e.hitRating;
  e.weapon = s.weapon ?? e.weapon;
  // offhandWeapon can legitimately BE null (unequipped), so it needs the
  // explicit presence check the other fields above don't: `?? e.X` would keep
  // a stale weapon forever once the server sends an explicit null. dualWielding
  // rides no wire key of its own: always exactly offhandWeapon !== null
  // (src/sim/entity.ts), so the client derives it instead of mirroring it.
  if (s.offhandWeapon !== undefined) e.offhandWeapon = s.offhandWeapon;
  e.dualWielding = e.offhandWeapon !== null;
}
