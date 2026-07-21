// Loot free-for-all (FFA) timeout: the classic anti-camp rule.
//
// When a hostile mob is tapped, only the tapper (and their party) may take its
// shared loot. If they dawdle, that lock should not hold the corpse hostage
// forever: a corpse the owner has not cleared within LOOT_FFA_DELAY seconds of
// becoming lootable opens to everyone ("loot goes free-for-all"). Personal quest
// drops (`personalFor`) and already-passed roll items (`openToAll`) are unaffected
// here; this only governs the tap-owned shared pool.
//
// Pure leaf: no Sim/Entity import, no rng, no clock. The owning systems drive the
// countdown with DT and pass the resolved flags in, so this stays trivially
// deterministic and unit-testable (reference: format_money.ts, threat.ts).

// Seconds a tapped corpse stays owner-locked after it becomes lootable. After
// this, any player may loot it. One minute, matching classic-era behavior.
export const LOOT_FFA_DELAY = 60;

/**
 * Has a lootable corpse's owner-lock lapsed? Drives the FFA flag from the
 * per-corpse countdown that the dead-mob tick decrements by DT.
 */
export function lootHasGoneFfa(lootFfaTimer: number): boolean {
  return lootFfaTimer <= 0;
}

/**
 * May `pid` take the shared (tap-owned) loot from a corpse?
 *
 * - `ffaUnlocked`: the owner-lock has lapsed (see {@link lootHasGoneFfa}); anyone may loot.
 * - untapped corpse (`tappedById === null`): already free-for-all.
 * - the tapper themselves, or a member of the tapper's party.
 */
export function hasSharedLootRights(
  pid: number,
  tappedById: number | null,
  tapperPartyMemberIds: readonly number[] | null,
  ffaUnlocked: boolean,
): boolean {
  return (
    ffaUnlocked ||
    tappedById === null ||
    tappedById === pid ||
    !!tapperPartyMemberIds?.includes(pid)
  );
}
