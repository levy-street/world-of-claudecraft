// Derives the action-bar "stealth abilities are usable" flag from the player's
// mirrored aura list, rather than trusting a raw entity field.
//
// Why: offline the entity IS the live sim Entity, whose `stealthed` field is kept
// current every tick by Sim.updateAuras (see src/sim/sim.ts). Online the entity is
// the ClientWorld mirror, constructed with `stealthed: false` and never updated
// (see src/net/online.ts): it is a server-local interest-filtering cache (see
// server/game.ts) that is not encoded on the wire. The wire DOES mirror auras, so
// deriving the flag from aura presence is correct on both hosts.
//
// Two Skulduggery states count beside real stealth, mirroring the sim's cast
// gates (src/sim/combat/rogue_engines.ts): the shadow veil (aura id
// 'veilstrike') and a FULL Gloam bank, which unlocks the Duskveil openers in
// the open so the next one thrown detonates it. Greyed buttons here read as
// "the engine is broken" (owner playtest), so the bar must agree with the sim.
import { GLOAM_STAGES } from '../../../sim/combat/rogue_engines';

export function playerStealthed(
  auras: readonly { kind: string; id?: string; stacks?: number }[],
): boolean {
  return auras.some(
    (a) =>
      a.kind === 'stealth' ||
      a.id === 'veilstrike' ||
      (a.id === 'gloam' && (a.stacks ?? 1) >= GLOAM_STAGES),
  );
}
