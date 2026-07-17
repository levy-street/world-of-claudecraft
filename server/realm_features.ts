// The per-realm feature bundle the client reads to decide what UI to show. It is
// derived once at boot from this process's env, frozen, and advertised on
// GET /api/status so the realm picker and every casino window can self-hide on a
// realm that does not run the feature.
//
// This is for UI VISIBILITY ONLY, never authorization: every money route
// re-checks its own env flag plus the regulated gate server-side, so a client
// that lies about the feature set (or hits a route directly) is still refused.
// The client just avoids painting a control that would 404. Because it is
// advisory, the bundle is a plain projection of the fail-closed env flags: an
// unset flag reads false, so a realm with no casino env is bit-identical to a
// normal realm here (an empty-but-present feature object).
//
// A new casino feature adds one boolean here and one env flag; keep the two in
// lockstep and default-off, and add the client-side consumer in the same change.
import { OWN_REALM_FLAGS } from './realm';

export interface RealmFeatures {
  // The realm is the RiverBoat casino realm (its space, NPCs, and gangway are
  // armed). The master switch every other casino feature sits under.
  casino: boolean;
  // Wagered arena pits are live (real-money 1v1 stakes through the arena engine).
  wagering: boolean;
  // The in-game DEX cashier (buy $WOC) is mounted.
  dexSwap: boolean;
  // Player-to-player trading with a $WOC leg is enabled.
  trade: boolean;
  // The house-banked spinner cabinets are live.
  slots: boolean;
  // The $WOC-burn pack-gacha cabinets are live.
  packs: boolean;
  // The Quartermaster's Hi-Lo house game is live.
  hilo: boolean;
  // The live-betting sportsbook deck is live.
  sportsbook: boolean;
}

function flagOn(env: NodeJS.ProcessEnv, name: string): boolean {
  return (env[name] ?? '').trim() === '1';
}

// Derive the bundle from an env bag (injectable so it is unit-testable without
// mutating process.env). Every feature is fail-closed: absent flag reads false.
export function computeRealmFeatures(
  env: NodeJS.ProcessEnv,
  ownFlags: readonly string[] = OWN_REALM_FLAGS,
): RealmFeatures {
  // The casino master reflects the process being a p2w realm with the casino env
  // armed. A realm not flagged p2w never advertises casino features even if a
  // stray env flag is set, so the picker and boat stay coherent with the flag.
  const isCasinoRealm = ownFlags.includes('p2w') && flagOn(env, 'RIVERBOAT_CASINO_ENABLED');
  return {
    casino: isCasinoRealm,
    wagering: isCasinoRealm && flagOn(env, 'WOC_ARENA_WAGER_ENABLED'),
    dexSwap: isCasinoRealm && flagOn(env, 'WOC_DEX_SWAP_ENABLED'),
    trade: isCasinoRealm && flagOn(env, 'WOC_TRADE_ENABLED'),
    slots: isCasinoRealm && flagOn(env, 'SPIN_ENABLED'),
    packs: isCasinoRealm && flagOn(env, 'PACKS_ENABLED'),
    hilo: isCasinoRealm && flagOn(env, 'RIVERBOAT_HILO_ENABLED'),
    sportsbook: isCasinoRealm && flagOn(env, 'SPORTSBOOK_ENABLED'),
  };
}

// This process's frozen feature bundle, resolved once at module load (like REALM
// and OWN_REALM_FLAGS). Every /api/status arm advertises exactly this object.
export const OWN_REALM_FEATURES: Readonly<RealmFeatures> = Object.freeze(
  computeRealmFeatures(process.env),
);
