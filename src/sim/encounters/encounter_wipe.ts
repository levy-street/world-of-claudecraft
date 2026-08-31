// The terminal raid-wipe resolution the encounter finales share (Ignivar's
// Apocalypse and Last Inferno, Varkhul's Masterpiece Unbound). A completed
// terminal cast is an encounter failure, not a survivable damage check: after
// the lethal hit, anyone ordinary immunity (Cold Coffin stasis) or a
// cheat-death ward kept standing is force-killed. Only explicit dev/GM
// invulnerability is preserved. Draws no rng of its own; damage and death ride
// the shared combat seams.
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

// Deliberately independent of varkhul.ts's VARKHUL_WIPE_DAMAGE_MULTIPLIER,
// which sizes the Master's Assembly absorb shield, not this wipe damage.
const ENCOUNTER_WIPE_DAMAGE_MULTIPLIER = 100;

export function resolveEncounterWipe(
  ctx: SimContext,
  boss: Entity,
  players: readonly Entity[],
  ability: string,
  source: Entity = boss,
): void {
  for (const player of players) {
    ctx.emit({
      type: 'spellfx',
      sourceId: source.id,
      targetId: player.id,
      school: 'fire',
      fx: 'nova',
    });
    ctx.dealDamage(
      source,
      player,
      player.maxHp * ENCOUNTER_WIPE_DAMAGE_MULTIPLIER,
      false,
      'fire',
      ability,
      'hit',
      true,
      undefined,
      false,
      false,
      true,
    );
    // The wipe is an encounter failure, not a survivable damage check.
    // Preserve explicit dev/GM invulnerability, but do not let ordinary
    // immunity or cheat-death effects turn a completed cast into success.
    if (
      !player.dead &&
      !player.gm &&
      !(ctx.devCommands && (player.devGod || player.profilerInvulnerable))
    ) {
      ctx.handleDeath(player, source);
    }
  }
}
