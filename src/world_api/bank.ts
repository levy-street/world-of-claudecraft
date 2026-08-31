import type { InvSlot } from '../sim/types';

// ---------------------------------------------------------------------------
// The Bank (the per-character deposit box). A second pooled item store beside
// the carried backpack + bags: capacity is a flat slot budget over one list
// (nothing pins an item to a fixed cell), and the state is per-character,
// serialized inside the character save exactly like inventory/bags. bankInfo
// streams only while standing at a banker NPC (the mailInfo pattern). The base
// 24 slots grow in copper-bought 6-slot blocks (BANK_EXPANSION_PRICES) plus a
// server-stamped bonus-slot grant (recomputed at every join by the entitlement registry).
//
// The Materials Vault is a SECOND store beside that slot bank at the same bursars:
// materials only, keyed per material id rather than per slot, so each material gets
// its own gold-bought capacity instead of competing for a shared slot budget. This
// phase lands the seam surface alone (vaultInfo rides the same proximity gate as
// bankInfo); the snapshot wire and the vault UI land in later phases.
// ---------------------------------------------------------------------------

/** One row of the server-computed bonus-slot breakdown: which account action grants
 *  (or could grant) bonus bank slots, and how far along it is. Earned status is
 *  derived (slots > 0); rows for unearned sources advertise what linking would grant.
 *  The list is append-only data: a future source (X, Twitch) is a new row with a new
 *  id, never a shape change. Offline worlds always carry an empty list. */
export interface BankBonusSource {
  id: string; // stable source id ('email' | 'discord' | 'wallet' | 'referral'; future sources append)
  slots: number; // slots this source grants right now
  maxSlots: number; // slots it grants when fully earned
  count?: number; // progress numerator (referral: qualified referees, capped for display)
  cap?: number; // progress denominator (referral: the referral cap)
}

export interface BankInfo {
  slots: InvSlot[]; // the pooled bank contents (a boundary clone, never a live sim reference)
  // Total slot budget, both pools summed: base + purchased + bonus + every
  // socketed bag's slots. A display total, never a fit answer (a non-material
  // deposit can be refused while materials-pool headroom remains).
  capacity: number;
  purchasedSlots: number; // copper-bought slots, always a multiple of the 6-slot block
  bonusSlots: number; // server-granted bonus slots, recomputed and stamped at every join
  // Copper price of the NEXT expansion, null once purchased slots are maxed.
  nextExpansionCost: number | null;
  // The per-source breakdown behind bonusSlots (server-stamped at join; [] offline).
  bonusSources: BankBonusSource[];
  // --- Bank bag sockets (Bank Storage phase 06): the gold-bought tier above the
  // slot ladder. Sockets unlock in order, cheapest first; each holds one bag
  // item whose slots join the bank's two-pool budget exactly like a carried
  // bag joins the backpack's. ---
  socketsUnlocked: number; // 0..BANK_BAG_SOCKETS
  // The bare bag item id in each socket (null = empty; a boundary clone,
  // always BANK_BAG_SOCKETS entries).
  socketBags: (string | null)[];
  // Copper price of the NEXT socket unlock, null once all sockets are unlocked.
  nextSocketCost: number | null;
  // Claudium price of the NEXT expansion rung (Bank Storage phase 11), the
  // dual-price tag phase 13 renders beside nextExpansionCost. OWNER-ONLY and
  // server-joined: the online server augments the snapshot from its cached
  // service store against this character's ladder position; the field is
  // simply ABSENT when the service is unreachable, when the ladder is full,
  // and ALWAYS in the offline Sim (graceful degradation: gold alone renders).
  // Absent (not null) on purpose, so pre-phase saves, goldens, and the
  // delta-omitting wire stay byte-identical when no price exists.
  nextRungClaudiumPrice?: number;
  // The two-pool budget split and its occupancy under the materials-first
  // allocation rule (src/sim/bag_pools.ts): authoritative numbers for the
  // capacity meter, so the client never re-derives them and drifts from the
  // sim's deposit gate. generalCapacity + materialsCapacity === capacity.
  generalCapacity: number;
  materialsCapacity: number;
  generalUsed: number;
  materialsUsed: number;
}

/** The Materials Vault view: the per-material stock plus the two numbers a client
 *  needs to render its fill state and its next purchase. Every material shares ONE
 *  cap (there is no per-material upgrade), so a single `perMaterialCap` describes
 *  the whole store; a material absent from `stock` is simply held at zero. */
export interface VaultInfo {
  // itemId to count, a boundary clone (never a live sim reference). Key ORDER is
  // not guaranteed across hosts: the record round-trips through Postgres jsonb
  // online, which re-orders object keys, while the offline Sim keeps its local
  // order (the loaded blob's, then deposits). A consumer that renders or
  // iterates it must sort.
  stock: Record<string, number>;
  // Identity-bearing material stacks. Every row is a boundary-deep-clone and
  // carries no advisory bag-cell `slot`; array order is snapshot-local only.
  special: InvSlot[];
  upgrades: number; // purchased rungs 0..5 (0 = the vault is still locked)
  perMaterialCap: number; // 0 while locked, else 40 per purchased rung
  // Copper price of the NEXT rung, null once every rung is purchased.
  nextUpgradeCost: number | null;
}

/** Exact identity-preserving vault-row selector. The displayed index is only
 *  the fast path; the server re-matches the complete fingerprint if it has
 *  gone stale and never falls back to another copy by item id. */
export interface VaultSpecialRef {
  index: number;
  instance?: InvSlot['instance'];
  craftedRecipeId?: string;
}

export interface IWorldBank {
  // Non-null only while standing at a banker NPC.
  bankInfo: BankInfo | null;
  // Copper- and Claudium-bought ladder slots on the CALLER'S OWN character,
  // readable WHEREVER the player stands (Bank Storage phase 15, ruling 17).
  // Deliberately not a field on BankInfo: that snapshot is null away from a
  // bursar, which is exactly the state this read exists for. The Strongbox
  // store opens anywhere and gates its charter list on the ladder position, so
  // the count has to be observable anywhere too; craftVaultStock below is the
  // same always-available owner-only shape.
  //
  // OWNER-ONLY and SELF-ONLY on the wire: it is emitted for the VIEWING
  // session's own character, never for the moderator-spectate anchor the other
  // owner-only keys follow, and it never enters the interest-scoped entity
  // broadcast. That choice is load-bearing rather than cosmetic. For as long as
  // one character stays RESIDENT the count is monotone NON-DECREASING (the sim
  // writes it in exactly two places, both strict increases, plus the join-time
  // load clamp), so a stale reader can only be too PERMISSIVE and never hide
  // capacity a player really has. Following the spectate anchor would let the
  // value move DOWN and void that property.
  //
  // RESIDENCY, not the client session: a fresh join that reloads a durable row
  // written before the last rung comes back LOWER, and one ClientWorld survives
  // a reconnect. src/sim/bank.ts bankPurchasedSlotsFor states the two reachable
  // cases and names what the client drops when it sees the count fall.
  //
  // null means "no answer yet", never "zero": offline when no player resolves,
  // online until the first snapshot lands. A consumer must treat null as
  // unknown, never coerce it to 0 (that would advertise the whole ladder as
  // free room).
  bankPurchasedSlots: number | null;
  bankDeposit(slotIndex: number, count?: number): void;
  bankWithdraw(slotIndex: number, count?: number): void;
  bankBuySlots(): void;
  // --- Bank bag sockets (Bank Storage phases 06 and 07). All banker-gated
  // like the three commands above; the sim owns every rule (unlock order,
  // exact copper, payload-free bags, the non-destructive unsocket tolerance).
  // Implemented in BOTH worlds: the offline Sim resolves them directly and
  // ClientWorld sends the bank_* socket wire commands (phase 07), with every
  // outcome decided server-side. ---
  bankUnlockSocket(): void;
  // Socket a carried bag into an unlocked bank socket (first empty when
  // `socket` is omitted; an occupied socket swaps, returning the old bag to
  // the carried inventory). `target` names the exact carried copy to consume,
  // the equipBag named-slot idiom.
  bankSocketBag(itemId: string, socket?: number, target?: { slotIndex: number }): void;
  // Return the socketed bag to the carried inventory. Refused only when the
  // bag itself cannot fit in the bags; the bank tolerates the shrunk budget
  // (over-capacity blocks new deposits, never destroys items).
  bankUnsocketBag(socket: number): void;
  // Non-null only while standing at a banker NPC, like bankInfo.
  vaultInfo: VaultInfo | null;
  vaultDeposit(slotIndex: number, count?: number): void;
  vaultWithdraw(itemId: string, count?: number, special?: VaultSpecialRef): void;
  // Deposit every depositable carried material in ONE batched server-side
  // command (never a client-side loop of vaultDeposit sends: the command lane
  // burst and the per-send ledger amplification both forbid it; the ruling is
  // recorded in the bank-storage packet's state.md Phase 03 constraints). The
  // sim owns every per-slot rule; the UI predicts the outcome from its own
  // click-time snapshot for the summary line.
  vaultDepositAll(): void;
  vaultBuyUpgrade(): void;
  // The DRAWABLE vault stock as visible to crafting at the player's current
  // location (Bank Storage Phase 04, craft-from-vault). Unlike vaultInfo this
  // is NOT banker-gated: it is null exactly when vault reagent draw is
  // unavailable here (an instanced or competitive context per
  // src/sim/vault_craft_gate.ts, or an unresolvable player), and a record
  // otherwise ({} means available but empty). Rows are filtered to the
  // drawable rule (positive integers within safe range; corrupt rows stay
  // invisible), values are a boundary clone (never a live sim reference), and
  // key order carries the same no-ordering contract as VaultInfo.stock. The
  // crafting window folds this into its per-reagent availability so the
  // client-side send gate agrees with the sim's admission gate in BOTH hosts;
  // owner-only on the wire, never part of the entity broadcast.
  craftVaultStock: Record<string, number> | null;
}
