// Derives the action-bar "carries a kind:'stealth' aura" flag from the player's
// mirrored aura list, rather than trusting a raw entity field.
//
// Why: offline the entity IS the live sim Entity, whose `stealthed` field is kept
// current every tick by Sim.updateAuras (see src/sim/sim.ts). Online the entity is
// the ClientWorld mirror, constructed with `stealthed: false` and never updated
// (see src/net/online.ts): it is a server-local interest-filtering cache (see
// server/game.ts) that is not encoded on the wire. The wire DOES mirror auras, so
// deriving the flag from `kind === 'stealth'` presence is correct on both hosts.
export function playerStealthed(auras: readonly { kind: string }[]): boolean {
  return auras.some((a) => a.kind === 'stealth');
}
