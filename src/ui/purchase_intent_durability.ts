// The thin impure binder that gives a purchase-intent ledger a durable half.
//
// Everything with a rule in it lives in src/ui/purchase_intent_record.ts, a
// registered pure core; everything that reaches a HOST lives here, and that is
// the whole reason this file is separate. src/ui/store_purchase_intent.ts is a
// registered pure core too and its determinism scan is load-bearing (it is what
// lets a caller inject a key minter and unit-test the money rules with no host),
// so the clock, the browser's storage and the question of who the player
// currently is may not move into it. The same split already exists one door
// over: src/ui/purchase_intent_key.ts holds the minter for exactly this reason
// and its header says so.
//
// WHAT THIS CLOSES (ruling 19). The ledger is a Map in a browser tab. A storage
// SKU is REPEATABLE and writes no grant row, so the economy service dedupes on
// the client-minted key ALONE, and a retry under a FRESH key is a SECOND REAL
// CHARGE. A reload, a crash or a closed tab takes the Map with it, and the next
// click mints that fresh key over a debit that may still be live.
//
// AND WHY THE SERVER'S OWN LOGIN RECOVERY DOES NOT ALREADY CLOSE IT, because
// that is the tempting wrong answer. kickStoragePurchaseRecovery (the hook
// ws_auth fires on every admission) does drive every pending row to a terminal
// status, and every settle re-kicks the scan.
// What it cannot do is stop the PLAYER from clicking again under a fresh key
// before it gets there: the pre-spend dry run judges the CURRENT ladder, and a
// rung whose purchase debited but never applied is still unowned, so it still
// FITS. The hold that would have refused that click is deliberately bounded
// (server/storage_ladder_hold.ts). This is the client's half, and it is the only
// half the client can supply.
//
// EVERY FAILURE FALLS BACK TO THE PRE-DURABILITY WORLD. No storage, storage that
// throws, an unknown player, an unparseable row, a stale entry, a key that would
// fail the server's charset: each answers ABSENT, and absent means the ledger
// mints a fresh key exactly as it always did.
//
// THE ONE THING THIS DOES COST THE PLAYER, stated rather than claimed away. A
// restored intent carries its FROZEN price, so if the catalog moved while the
// page was gone the first click after a reload comes back as a definitive
// price_changed and the player pays for it with one extra click and a notice.
// Before durability that click went out at the fresh price and succeeded. That
// is the right trade and not a close one: the alternative is re-reading the live
// price under a restored key, which walks the server's four-field identity check
// into a definitive-looking already_granted over a row that may still be pending
// behind a live debit, which is a SECOND REAL CHARGE. So the honest sentence is:
// nothing here can take money twice and nothing here fails silently; the one
// cost is a price_changed round trip after a catalog move.

import type { IWorld } from '../world_api';
import { mintIntentKey } from './purchase_intent_key';
import {
  intentFromStored,
  isStorablePurchaseIntent,
  purchaseIntentRowName,
  purchaseIntentScope,
  readPurchaseIntentRow,
  type StoredPurchaseIntent,
  writePurchaseIntentRow,
} from './purchase_intent_record';
import { safeLocalStorage } from './safe_local_storage';
import {
  createPurchaseIntentLedger,
  type PurchaseIntent,
  type PurchaseIntentDurablePort,
  type PurchaseIntentLedger,
} from './store_purchase_intent';

// Re-exported so a window wiring a DURABLE ledger names ONE module rather than
// importing the type from the pure core beside it (the StoreSpendResult
// precedent in src/ui/claudium_purchase_bridge.ts).
export type { PurchaseIntentLedger };

/** The narrow structural slice of the world the scope is read from, so this
 *  module never depends on the whole `IWorld` shape. `IWorld` satisfies it, and
 *  a test pins that it does.
 *
 *  Every member is OPTIONAL on purpose. This is a MONEY path and the module's
 *  contract is that nothing in it may make a purchase fail that would otherwise
 *  have worked, so a world that cannot answer (a partial stub, a window
 *  constructed before its world exists, a teardown mid-call) has to degrade to
 *  "identity unknown" rather than throw out of `intentFor`. Unknown costs the
 *  durability and nothing else. */
export interface PurchaseIntentScopeSource {
  cfg?: { playerClass?: string };
  player?: { name?: string };
  spectating?: string | null;
}

/** The storage seam this module writes through, narrowed to what it uses. */
type IntentRowStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * The per-character scope, from the two reads every spending window already
 * makes through `IWorld`.
 *
 * `characters.name` is `TEXT UNIQUE NOT NULL` (server/db.ts), so a character
 * name is unique across the whole database, realms included: it determines the
 * character row and, through its `account_id` foreign key, the account. That is
 * the account-and-character scope the money rule needs, expressed in the one
 * field the client already holds, with no new `IWorld` member and no parity
 * triangle.
 *
 * EMPTY MEANS "NOT YET KNOWN", and it is absolute. Before the first snapshot
 * `ClientWorld.player` answers a blank entity whose name is the empty string, and
 * a record written under a placeholder scope is one the real character can never
 * claim and the next character might. So an empty name reads nothing and, far
 * more importantly, WRITES nothing.
 *
 * A character RENAME orphans the record. That is a stated cost, not an
 * oversight: the row is simply not found, the ledger falls back to minting, and
 * the failure direction is losing the protection rather than restoring a key
 * that belongs to someone else.
 *
 * A SPECTATING SESSION HAS NO SCOPE AT ALL, and that guard is the whole reason
 * this function is not two field reads inline. A moderator spectate repoints
 * `playerId` at the watched character and swaps `cfg.playerClass` with it, so
 * BOTH reads above answer for the ANCHOR rather than the VIEWER for as long as
 * it runs (src/net/online.ts restores `ownPlayerClass` when spectate ends, which
 * is the proof it was swapped; src/main.ts guards a row of per-frame work on the
 * same fact). The purchase itself is unaffected, because a Claudium spend is an
 * HTTP call the server resolves from the session rather than a ws command the
 * spectate gate drops, so the money moves on the VIEWER's account while the
 * record would file itself under the WATCHED character's name. That record is
 * then unfindable after a reload, which puts this session back to exactly the
 * pre-durability behaviour the phase exists to end, and it is readable by the
 * watched character if they ever play on this browser.
 *
 * So spectating reads as identity-not-known: no read, and above all no WRITE.
 * The moderator loses the durability for that session, which is the direction
 * every other failure here takes too, and nothing is ever filed under a name
 * that did not earn it.
 */
export function scopeOfWorld(world: PurchaseIntentScopeSource): string {
  if (typeof world.spectating === 'string') return '';
  const playerClass = world.cfg?.playerClass;
  const name = world.player?.name;
  if (typeof playerClass !== 'string' || typeof name !== 'string') return '';
  return purchaseIntentScope(playerClass, name);
}

/** A ledger whose intents survive the page. `world` is read lazily on every
 *  call, because a window is constructed long before it is online and a player
 *  can switch characters under a window that is merely closed. */
export function durableIntents(world: () => IWorld): PurchaseIntentLedger {
  return createPurchaseIntentLedger(
    mintIntentKey,
    durablePurchaseIntentPort(() => scopeOfWorld(world())),
  );
}

/**
 * The port itself, with the host arriving as arguments so a Vitest drives every
 * arm with a fake store and a fake clock.
 *
 * TWO TRADES THIS SHAPE ACCEPTS, written down so a later reader does not have to
 * rediscover them:
 *
 * CROSS-TAB LAST WRITE WINS. Every method here is a read-modify-write of the one
 * row, and localStorage offers no compare-and-swap, so two tabs on the same
 * character can lose one another's save. The failure direction is back to the
 * pre-durability world (a lost record means a fresh key, which is exactly what
 * used to happen every time), and the surviving tab's own in-memory ledger is
 * untouched. A `storage` event listener would narrow the window without closing
 * it; the packet accepts the race rather than pretend a lock exists.
 *
 * THE SAVE RIDES THE MINT, NOT THE SEND. `intentFor` is called when the confirm
 * prompt OPENS, so the key is durable before it can possibly reach the wire,
 * which is the order that matters. The consequence is that closing the TAB on an
 * open confirm dialog (rather than dismissing it, which abandons) leaves a record
 * for a purchase that never happened. Re-using it later is harmless: it has no
 * prior row anywhere, so the retry is an ordinary fresh attempt, and a moved
 * catalog price answers price_changed and mints afresh.
 */
export function durablePurchaseIntentPort(
  scope: () => string,
  storage: () => IntentRowStore | null = safeLocalStorage,
  nowMs: () => number = Date.now,
): PurchaseIntentDurablePort {
  // One read-modify-write against the row, or null when there is nothing to work
  // with. Storage can throw on an individual call even when the seam handed back
  // an object (a private-mode quota lockout), so the read is guarded here and
  // every caller treats a throw as "no row".
  const open = (): {
    name: string;
    scope: string;
    store: IntentRowStore;
    raw: string | null;
  } | null => {
    try {
      const s = scope();
      const name = purchaseIntentRowName(s);
      if (name === null) return null;
      const store = storage();
      if (store === null) return null;
      return { name, scope: s, store, raw: store.getItem(name) };
    } catch {
      // Deliberately broad, and the reason is the module's whole contract: the
      // scope getter reaches a live world and the read reaches a browser store,
      // and neither may throw out of intentFor. Everything that goes wrong in
      // here costs the DURABILITY and nothing else, so the ledger falls back to
      // exactly what it did before durability existed.
      return null;
    }
  };

  // Write the row back, or REMOVE it when nothing is left. Removing rather than
  // leaving an empty husk is the point of widening the storage seam: this row
  // names a real-money attempt, and it should not outlive the attempt by a
  // single settled purchase.
  const persist = (
    store: IntentRowStore,
    name: string,
    s: string,
    intents: Record<string, StoredPurchaseIntent>,
  ): void => {
    try {
      if (Object.keys(intents).length === 0) store.removeItem(name);
      else store.setItem(name, writePurchaseIntentRow(s, intents));
    } catch {
      // A full or locked-down store loses the durability and nothing else: the
      // in-memory ledger is unaffected, so this page behaves exactly as it did
      // before durability existed.
    }
  };

  return {
    load(itemId: string): PurchaseIntent | null {
      const o = open();
      if (o === null) return null;
      const read = readPurchaseIntentRow(o.raw, o.scope, nowMs());
      // The expiry sweep rides every read, including reads for a DIFFERENT item
      // and reads from the other ledger sharing this row. That is what bounds an
      // intent nothing will ever settle or abandon, which is the one path with
      // no other reaper.
      if (read.prunedReadableRow) persist(o.store, o.name, o.scope, read.retained);
      const stored = read.intents[itemId];
      return stored === undefined ? null : intentFromStored(stored);
    },

    save(itemId: string, intent: PurchaseIntent): void {
      const o = open();
      if (o === null) return;
      // ONE CLOCK READ for the whole read-modify-write. It used to sample three
      // times, and the stamp it wrote was then judged against a LATER sample: a
      // clock that stepped backwards in between (an ntp correction, a suspended
      // laptop) made the record fail its own future-stamp guard and never
      // persist, silently, on the one path that exists to write it.
      const now = nowMs();
      const read = readPurchaseIntentRow(o.raw, o.scope, now);
      // An unreadable row answers empty and is overwritten wholesale here, which
      // is the only thing that ever clears one: reading it is what we could not
      // do, and it sits under a name this scope owns.
      const entry = { key: intent.key, costClaudium: intent.costClaudium, mintedAtMs: now };
      // Do not write what the reader would refuse. The store's charter path mints
      // `intentFor(itemId, row?.costClaudium ?? 0)` when the catalog row is
      // missing, and a zero cost is rejected on READ (the wire refuses it too), so
      // persisting one produces an entry that is dead on arrival and merely costs
      // a later prune. The row stays honest instead.
      if (!isStorablePurchaseIntent(entry, now)) return;
      persist(o.store, o.name, o.scope, { ...read.retained, [itemId]: entry });
    },

    drop(itemId: string): void {
      const o = open();
      if (o === null) return;
      const read = readPurchaseIntentRow(o.raw, o.scope, nowMs());
      // Nothing of ours to remove and nothing to reap: do not write at all,
      // which is what keeps a drop from destroying a row it could not read.
      if (read.retained[itemId] === undefined && !read.prunedReadableRow) return;
      const rest = { ...read.retained };
      delete rest[itemId];
      persist(o.store, o.name, o.scope, rest);
    },
  };
}
