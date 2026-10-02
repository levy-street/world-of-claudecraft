// THE REALM'S HEARTH TRIP, BOUND (07a). server/freehold_hearth_trip.ts owns the
// admission contract over an injected host; this is that host, built from the
// GameServer's live pieces so the coordinator carries one constructor call and
// one admission closure. It binds:
// - the trip's ONE character save: saveCharacter with the housing hook, on the
//   character FIFO, under the shared background permit (the save's own WAITS
//   take the trip's admission bound, never its transaction);
// - the plot claim held as in flight for the trip's whole duration, so the
//   renewer keeps it wanted while a trip proves it;
// - the re-dispatch, which replays every gate the frame path runs before a
//   Hearth Key use reaches the sim (hearthKeyUseRefusal: the draining and
//   vault-lock drops, spectating, jailed, dark) and answers each with the
//   frame path's player-facing event, save one: after a COMMITTED advance the
//   key is already spent (R-2), so a vault-lock drop answers busy rather than
//   nothing (a draining realm stays silent: it is going down), and every
//   precheck (a session gone by then included) is a realm drop the trip
//   counts apart, since the sim never saw the use. Two frame-path side effects
//   are deliberately NOT repeated: the command outcome (the use frame that
//   started the trip already received its own, and a re-dispatch is no frame)
//   and the dark-realm probe counter (it counts client frames probing a dark
//   realm, which a server re-dispatch is not; the flag is read once at boot,
//   so a realm that lit the trip cannot turn dark under it). Then it runs the
//   item use through the sim while the ticket is set. It takes no heavy-self
//   receipt mark: the use frame that started the trip already took one, and an
//   admitted entry changes no heavy self field (it moves the player and
//   claims a room, both outside the heavy block, and grants or spends
//   nothing), pinned in tests/server/freehold_wire.test.ts.
import { HEARTH_KEY_COOLDOWN_MS, HEARTH_KEY_ITEM_ID } from '../src/sim/freehold/gate_rules';
import { mergeFreeholdKeyReadyAt } from '../src/sim/freehold/hearth_key';
import { freeholdOwnerKeyOfMeta } from '../src/sim/freehold/owner_key';
import type { SimContext } from '../src/sim/sim_context';
import { PROCESS_LEASE_HOLDER } from './character_lease_db';
import type { CharacterSaveHousingHook } from './character_save_housing';
import type { FreeholdClaimRegistry } from './freehold_claim_registry';
import { createFreeholdHearthTrips, type FreeholdHearthTripSession } from './freehold_hearth_trip';
import { commitFreeholdMutation } from './freehold_mutation';
import type { FreeholdPersistStore } from './freehold_persist';
import type { FreeholdTxPool } from './freehold_tx';
import { hearthKeyUseRefusal } from './freehold_wire';

export interface GameFreeholdHearthTripDeps<S extends FreeholdHearthTripSession> {
  /** The realm's live Sim, read per call (the vault services' getter shape). */
  sim(): {
    readonly ctx: SimContext;
    useItem(itemId: string, pid: number): unknown;
  };
  sessionForPid(
    pid: number,
  ): (S & { readonly spectating?: unknown; readonly jailed?: unknown }) | undefined;
  readonly store: Pick<FreeholdPersistStore, 'authority' | 'adoptHearthReading'>;
  readonly claims: FreeholdClaimRegistry;
  readonly pool: FreeholdTxPool;
  /** saveCharacter(session, { housing, backgroundDbPermit: true }). */
  save(session: S, housing: CharacterSaveHousingHook): Promise<boolean>;
  /** One text-free `freeholdDenied` event to the session, as the frame path sends. */
  sendDenied(session: S, reason: 'busy' | 'no_freehold'): void;
  /** handleMessage's shutdown drop: the realm began draining. */
  draining(): boolean;
  /** handleMessage's vault-loot fence: the character's frames are dropped. */
  vaultLocked(characterId: number): boolean;
  /** The wall clock, bound by the caller (no freehold module reads one itself). */
  nowMs(): number;
}

const ACCOUNT_OWNER_KEY = /^account:([1-9][0-9]*)$/;

export function createGameFreeholdHearthTrips<S extends FreeholdHearthTripSession>(
  deps: GameFreeholdHearthTripDeps<S>,
): ReturnType<typeof createFreeholdHearthTrips> {
  return createFreeholdHearthTrips({
    sessionForPid: (pid) => deps.sessionForPid(pid),
    authority: (ownerKey) => deps.store.authority(ownerKey),
    claimFor: (accountId) => {
      const claim = deps.claims.forAccount(accountId);
      return claim
        ? { plotId: claim.plotId, holder: PROCESS_LEASE_HOLDER, generation: claim.generation }
        : undefined;
    },
    commit: async (session, request, waitSignal) => {
      const releases = request.claimProofs.map((proof) => deps.claims.holdInFlight(proof.plotId));
      try {
        return await commitFreeholdMutation(
          {
            save: (hook) => deps.save(session as S, hook),
            pool: deps.pool,
            characterId: session.characterId,
          },
          request,
          { waitSignal },
        );
      } finally {
        for (const release of releases) release();
      }
    },
    redispatch: (session, advanced) => {
      // run() checked the same session synchronously just before this call,
      // so this cannot miss today; were it to, the sim never saw the use: a
      // realm drop with nothing to answer, never the sim's refusal.
      const live = deps.sessionForPid(session.pid);
      if (!live) return 'dropped';
      const refusal = hearthKeyUseRefusal({
        draining: deps.draining(),
        vaultLocked: deps.vaultLocked(live.characterId),
        spectating: live.spectating,
        jailed: live.jailed,
      });
      // The frame path's two realm drops answer nothing, unless the advance
      // already committed: then a fenced vault answers busy (the player can
      // act on it), and the trip counts either drop apart.
      if (refusal === 'draining' || refusal === 'vault_locked') {
        if (advanced && refusal === 'vault_locked') deps.sendDenied(live, 'busy');
        return 'dropped';
      }
      if (refusal === null) {
        // By item id, without the frame's bag slot, on purpose: the key is
        // one permanent, never-consumed copy, so id resolution finds it
        // wherever it sits now, while a slot carried from the frame could
        // name another item if the key moved bags during the trip.
        deps.sim().useItem(HEARTH_KEY_ITEM_ID, session.pid);
        return undefined;
      }
      // Spectating answers nothing, jailed busy and dark no_freehold, each as
      // the frame path does. The sim never saw the use, so after a committed
      // advance each is a realm drop too, never the sim's refusal.
      if (refusal === 'jailed') deps.sendDenied(live, 'busy');
      if (refusal === 'dark') deps.sendDenied(live, 'no_freehold');
      return advanced ? 'dropped' : undefined;
    },
    mergeReadyAt: (ownerKey, readyAtMs) =>
      mergeFreeholdKeyReadyAt(deps.sim().ctx, ownerKey, readyAtMs),
    adoptDurable: (ownerKey, readyAtMs, revision) =>
      deps.store.adoptHearthReading(ownerKey, readyAtMs, revision),
    // A walk of the roster, run only for an abandoned trip that carries a
    // durable clock (a leave or takeover inside its own transaction): rare.
    ownerOnline: (ownerKey) => {
      for (const meta of deps.sim().ctx.players.values()) {
        if (freeholdOwnerKeyOfMeta(meta) === ownerKey) return true;
      }
      return false;
    },
    accountOf: (ownerKey) => {
      const match = ACCOUNT_OWNER_KEY.exec(ownerKey);
      const id = match ? Number(match[1]) : Number.NaN;
      return Number.isSafeInteger(id) && id > 0 ? id : null;
    },
    cooldownMs: HEARTH_KEY_COOLDOWN_MS,
    nowMs: () => deps.nowMs(),
    warn: (message) => console.warn(message),
  });
}
