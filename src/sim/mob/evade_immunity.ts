// A wild mob mid-evade (leashed home, walking back to spawn after breaking combat)
// is damage/threat-immune: combat/damage.ts's dealDamage voids any hit that lands
// on one regardless. Acquiring or keeping one as a target just wastes an attack on
// a mob that cannot be hurt, so Sim.enterCombat/aggroMob, the player's own
// auto-attack engage in combat/auto_attack.ts, the pet command surface in
// pet/pet_commands.ts, the AI target picker in pet/pet_ai.ts, and
// warlock_pet_skills.ts all refuse to acquire or keep one. An owned mob (a
// player's own pet) is exempt: it runs pet AI, not wild-mob leash recovery, and
// never legitimately carries this state.
//
// NOT yet consulted by every attacker-side entry point in the sim: a player's own
// direct-cast pet-redirect abilities (hunter Pack Command in
// combat/hunter_packlord.ts, warlock Reap in combat/necromancy.ts) still let the
// swing fire and rely on dealDamage's void downstream, the same shipped precedent
// combat/auto_attack.ts's own engage gate follows for a player's ordinary attack.
// Extending the guard there is a deliberate follow-up, not an oversight here.
//
// Pure leaf: no SimContext, draws no rng, reads only Entity fields.

import type { Entity } from '../types';

export function isEvadingWildMob(target: Entity): boolean {
  return target.kind === 'mob' && target.aiState === 'evade' && target.ownerId === null;
}
