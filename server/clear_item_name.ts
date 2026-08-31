// The stamped-legendary-name remediation arm (Masterwrought phase 13 review):
// a promoted copy's payload.name is permanent, peer-visible (the eqi
// inspect wire), and Discord-published, and the owner cannot re-promote to
// replace it ('already legendary'), so a name that later needs removing (a
// banlist addition, uncovered language, contextual offense) previously had
// only forbidden hand SQL. A promoted copy is permanently SOULBOUND, never
// tradable: Perfecting binds it on the first resolved ATTEMPT (the R2
// Maker's Bond boundTo stamp in perfecting.ts; a craft-time head start is
// unbound but never Perfected, so every Perfected copy is bound) and the
// unbind service refuses a Perfecting-bound copy outright (commission.ts,
// unbind_perfecting), which is what makes the five-region character walk
// below provably exhaustive for every legal writer: no guild bank, market
// listing, mail parcel, or other character can ever hold a named copy, so
// stripping the one character strips every copy there is. (The proof's
// boundary: a hand-edited blob carrying perfected plus name with no boundTo
// sits outside it; the per-field drop-only load doctrine deliberately does
// not couple those fields.) What the strip CANNOT reach is the Discord
// activity card the promotion already published (server/craft_activity.ts):
// that embed is durable in the third-party channel and has no in-repo
// takedown arm, so an operator handling a name report owes a manual Discord
// removal as a separate step (DEPLOY.md, the clear-item-name runbook).
// This module is the pure decision-and-strip core
// behind the audited admin endpoint (server/admin.ts clearItemNameHandler,
// POST /admin/api/moderation/characters/:id/clear-item-name): validate the
// operator's target, walk the persisted blob's payload-bearing regions (the
// rekeyInstanceSigner walk, src/sim/character_rename.ts), delete
// ItemInstancePayload.name, and hand the endpoint body a typed outcome. It
// deletes ONLY the name: the promotion itself (rolled.quality, the R5 stats,
// signer, bind state) stands untouched.
//
// OFFLINE characters only, the offline admin/boost writer doctrine
// (server/characters.ts renameHandler: an online character's live session
// would clobber the stripped blob on its next autosave, so the endpoint
// refuses while online and the operator disconnects first via the existing
// moderation surface). The LIVE-session arm would need a sim-side action on
// the R35 tool-effect GM-restore precedent (named there, deliberately not
// spelled here: its importer guard scans source TEXT for the identifier);
// kick-then-clear is the recorded operator flow instead. The world-state books
// (market listings, mail parcels) and foreign characters are deliberately
// unswept: the soulbound argument above proves a named copy can never sit in
// them, so the omission is completeness, not the rename sweep's scoping limit
// this header once cited.
//
// The reconnect window (the phase 13 QA, three reviewers converging): the two
// in-process online checks below answer a session this process can see, but
// a fresh login re-reads the blob BEFORE game.join registers it, and a
// session on a peer process is invisible to the map entirely. So the blob
// write itself is fenced on the character_leases table
// (server/db.ts saveOfflineCharacterState): the handshake claims the lease
// before its blob read, so any login that could hold the pre-strip state has
// a live lease by the time the write runs, and the fenced UPDATE touches
// nothing and reports false, which surfaces as a refusal to retry. A kicked
// session releases its lease after its leave flush lands (server/game.ts
// leave), so the decided kick-then-clear flow lands on the first retry; a
// crashed process's orphan lease expires (LEASE_TTL_SECONDS) and the retry
// lands after it. What the fence leaves (recorded, not closed): the UPDATE
// evaluates NOT EXISTS in its own READ COMMITTED snapshot, so a lease
// committed DURING the fenced statement whose blob read lands before this
// commit still holds the pre-strip state (a millisecond window); and the
// live save's own nonce fence carries no expiry term, so a session whose
// lease lapsed (ninety seconds of missed heartbeats) and was never reclaimed
// can autosave over a landed strip. An operator handling a contested name
// suspends the account first (DEPLOY.md).

import type { CharacterState } from '../src/sim/sim';
import { type EquipSlot, isEquipSlot } from '../src/sim/types';
import { CHARACTER_SAVE_LEASED_LINE } from './character_save_statement';

/** The bag target's item-id SHAPE bound (the signer doctrine, never a catalog
 *  allowlist): a persisted id survives shape-bounded validation, so a bagged
 *  copy of an id RETIRED from the content tables stays targetable per-cell,
 *  exactly as the `all: true` sweep already reaches it by payload
 *  (src/sim/professions/training.ts sanitizeKnownRecipeIds is the sim's own
 *  statement of the doctrine; the marketplace routes' ITEM_ID_SHAPE carries
 *  the same closed charset). The bound still keeps free text, spaces, quotes,
 *  and control bytes out of the audit reason's folded detail, which is all
 *  the retired allowlist ever bought here: the cell walk matches the
 *  persisted itemId exactly, so an id nothing holds strips nothing. The
 *  length is the sim's persisted-id bound. */
const BAG_ITEM_ID_SHAPE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** The bag target's INDEX bound, both ends. Number.isInteger answers true for
 *  1e21 and for MAX_SAFE_INTEGER, so a lower-bound-only check let an absurd
 *  index through: it bought a pointless load-strip-and-refuse round trip and,
 *  worse, wrote its folded detail into the audit row as `bag 1e+21`, which
 *  reads as corruption to whoever audits it later (the Phase 18 security
 *  review). The ceiling is deliberately far above any inventory the game can
 *  build (the backpack's 16 slots plus the roomiest bag in each of the 4
 *  sockets, src/sim/bags.ts; the suite computes that maximum from the live
 *  catalog and pins it under this bound), so it can never refuse a real
 *  target: it exists to keep nonsense out of the audit trail, not to model
 *  capacity, which is why it is a flat number here rather than a per-character
 *  computation the validator has no blob to make. */
const MAX_BAG_INDEX = 1023;

/** What the operator asked to strip: one worn slot, one bag cell (the
 *  index-plus-id pin, so a shifted stack is never stripped by accident), or
 *  every named copy on the character. The bag target is the persisted
 *  inventory ARRAY index, not the cell the client displays (InvSlot.cell is a
 *  separate, optional dragged-into position), and it reaches the carried
 *  bags only (a banked or buyback-ring copy needs `all: true`); with two
 *  same-id named copies in the bags, an index read off a screenshot rather
 *  than the blob can strip the other one, so the runbook (DEPLOY.md) says to
 *  target by `all: true` unless the index came from the blob itself. */
export type ClearItemNameTarget =
  | { kind: 'slot'; slot: string }
  | { kind: 'bag'; bag: number; itemId: string }
  | { kind: 'all' };

/** Validate a clear-item-name request body. English error prose (the R35
 *  restore family's admin error model) or null when valid. Runs BEFORE the
 *  audit write, so a malformed request never leaves an audit row. The
 *  whole-character sweep is EXPLICIT: exactly one of a worn slot, a bag cell
 *  (both halves), or the literal `all: true` must be named, so a body that
 *  carries only a reason can never quietly strip every copy the character
 *  owns. The bag itemId is SHAPE-bounded (BAG_ITEM_ID_SHAPE, the signer
 *  doctrine), never allowlisted against ITEMS, so a retired id stays
 *  targetable while free text still never reaches the audit reason's folded
 *  detail. */
export function clearItemNameBodyError(body: {
  slot?: unknown;
  bag?: unknown;
  itemId?: unknown;
  all?: unknown;
}): string | null {
  const hasSlot = body.slot !== undefined;
  const hasBag = body.bag !== undefined || body.itemId !== undefined;
  const hasAll = body.all !== undefined;
  const forms = [hasSlot, hasBag, hasAll].filter(Boolean).length;
  if (forms !== 1) {
    return 'name exactly one target: a worn slot, a bag cell, or all: true';
  }
  if (hasSlot) {
    if (typeof body.slot !== 'string' || !isEquipSlot(body.slot)) return 'unknown equipment slot';
    return null;
  }
  if (hasAll) {
    // The literal true, never a truthy stand-in: the sweep destroys the most,
    // so the request must say exactly what it means.
    if (body.all !== true) return 'all must be the literal true';
    return null;
  }
  if (body.bag === undefined || body.itemId === undefined) {
    return 'a bag target needs both the cell index and its item id';
  }
  if (
    typeof body.bag !== 'number' ||
    !Number.isInteger(body.bag) ||
    body.bag < 0 ||
    body.bag > MAX_BAG_INDEX
  ) {
    // One message for every malformed shape (a float, a string, a negative,
    // an absurd index): the operator's fix is the same in all four cases, and
    // the ceiling is named so an honest large index is answered honestly.
    return `bag must be a whole number from 0 to ${MAX_BAG_INDEX}`;
  }
  if (typeof body.itemId !== 'string' || !BAG_ITEM_ID_SHAPE.test(body.itemId)) {
    // Shape, not catalog membership: a bagged copy of an id RETIRED from the
    // content tables is still targetable per-cell (the Phase 18
    // retired-id-per-cell-targeting item closed the allowlist's recorded
    // consequence); the cell walk's exact itemId match decides whether
    // anything strips.
    return 'unknown item id';
  }
  return null;
}

/** The validated body as a target. Call only after clearItemNameBodyError
 *  returned null (the sweep arm is reachable only through its explicit
 *  `all: true`; this mapper never infers it from an empty body the validator
 *  would have refused). */
export function clearItemNameTarget(body: {
  slot?: unknown;
  bag?: unknown;
  itemId?: unknown;
  all?: unknown;
}): ClearItemNameTarget {
  if (body.slot !== undefined) return { kind: 'slot', slot: String(body.slot) };
  if (body.bag !== undefined) {
    return { kind: 'bag', bag: Number(body.bag), itemId: String(body.itemId) };
  }
  return { kind: 'all' };
}

/** The audit row's folded detail for one target (recordItemNameClear). */
export function describeClearItemNameTarget(target: ClearItemNameTarget): string {
  switch (target.kind) {
    case 'slot':
      return `slot ${target.slot}`;
    case 'bag':
      return `bag ${target.bag} ${target.itemId}`;
    case 'all':
      return 'all copies';
  }
}

function stripName(instance: { name?: string } | undefined): boolean {
  if (!instance || instance.name === undefined) return false;
  delete instance.name;
  return true;
}

/**
 * Delete ItemInstancePayload.name at `target` across the persisted blob's
 * payload-bearing regions: carried inventory, bank inventory, the vendor
 * buyback ring, and the equipped-instance map under BOTH its spellings (the
 * rekeyInstanceSigner region walk; a slot target touches only the equipment
 * maps, a bag target only its exact cell when the item id still matches).
 * Mutates `state` IN PLACE (the endpoint owns the loaded blob and persists it
 * whole right after) and returns how many copies were stripped, so the caller
 * can skip the save, and answer the operator honestly, when nothing matched.
 */
export function stripLegendaryNames(state: CharacterState, target: ClearItemNameTarget): number {
  let cleared = 0;
  if (target.kind === 'slot') {
    const slot = target.slot as EquipSlot;
    if (stripName(state.equipmentInstance?.[slot])) cleared++;
    if (stripName(state.equipmentInstances?.[slot])) cleared++;
    return cleared;
  }
  if (target.kind === 'bag') {
    const slot = state.inventory?.[target.bag];
    if (slot && slot.itemId === target.itemId && stripName(slot.instance)) cleared++;
    return cleared;
  }
  for (const slot of state.inventory ?? []) {
    if (stripName(slot.instance)) cleared++;
  }
  for (const slot of state.bank?.inventory ?? []) {
    if (stripName(slot.instance)) cleared++;
  }
  for (const slot of state.vendorBuyback ?? []) {
    if (stripName(slot.instance)) cleared++;
  }
  for (const instance of Object.values(state.equipmentInstance ?? {})) {
    if (stripName(instance)) cleared++;
  }
  for (const instance of Object.values(state.equipmentInstances ?? {})) {
    if (stripName(instance)) cleared++;
  }
  return cleared;
}

/** The IO the endpoint body needs, injected so the suite drives it with fakes
 *  (the moderation_service deps-bag shape; admin.ts binds the real ones). */
export interface ClearItemNameDeps {
  characterOnline(characterId: number): boolean;
  loadCharacter(
    characterId: number,
  ): Promise<{ level: number; state: CharacterState | null } | null>;
  /** The refusal arm's existence probe (server/clear_item_name_db.ts
   *  characterStateExists): SELECT 1 over the SAME id-realm-state-not-null
   *  predicate loadCharacter answers not-found on, so a fenced-out write is
   *  read as the retry line without paying the blob a second time. */
  characterStateExists(characterId: number): Promise<boolean>;
  /** The lease-fenced offline save (server/db.ts saveOfflineCharacterState):
   *  resolves false when a live load lease exists, in which case the strip
   *  did NOT land and the endpoint refuses (the reconnect-window closure). */
  saveCharacterState(characterId: number, level: number, state: CharacterState): Promise<boolean>;
  recordAudit(input: {
    characterId: number;
    adminAccountId: number;
    detail: string;
    reason: unknown;
  }): Promise<unknown>;
}

export type ClearItemNameOutcome = { ok: true; cleared: number } | { ok: false; error: string };

/**
 * The whole endpoint decision, shared-body style so the route handler stays a
 * thin binder. Order mirrors the R35 restore contract: validate (no audit row
 * for an impossible request), require the character OFFLINE here (the module
 * header's live-session rationale), write the audit row, then load-strip,
 * re-check OFFLINE once more immediately before the save (the login-race
 * close), then save, so a strip can never exist unaudited; a post-audit
 * refusal (deleted character, nothing matched, the character logging in
 * mid-strip) surfaces as an explicit error and the audit row honestly records
 * the attempt. recordAudit throws on a missing reason (moderation_db
 * cleanText), surfaced by the caller's catch like the restores.
 */
export async function runClearItemName(
  deps: ClearItemNameDeps,
  input: {
    characterId: number;
    adminAccountId: number;
    body: { slot?: unknown; bag?: unknown; itemId?: unknown; all?: unknown; reason?: unknown };
  },
): Promise<ClearItemNameOutcome> {
  const bodyError = clearItemNameBodyError(input.body);
  if (bodyError) return { ok: false, error: bodyError };
  const target = clearItemNameTarget(input.body);
  if (deps.characterOnline(input.characterId)) {
    return { ok: false, error: 'character is online on this realm; disconnect them first' };
  }
  await deps.recordAudit({
    characterId: input.characterId,
    adminAccountId: input.adminAccountId,
    detail: describeClearItemNameTarget(target),
    reason: input.body.reason,
  });
  const row = await deps.loadCharacter(input.characterId);
  if (!row?.state) return { ok: false, error: 'character not found' };
  const cleared = stripLegendaryNames(row.state, target);
  if (cleared === 0) return { ok: false, error: 'no named copy matched that target' };
  // Narrow the login race: a character who came online between the pre-check
  // and here would have a live session whose next autosave clobbers this
  // write, so re-check IMMEDIATELY before the save and refuse without
  // writing (the restore family's self-detecting shape). This check answers
  // the sessions this process can see; the fenced save below answers the
  // rest (a login mid-handshake, a session on a peer process). The audit row
  // above already recorded the REQUEST honestly, "requested" prose and all.
  if (deps.characterOnline(input.characterId)) {
    return {
      ok: false,
      error: 'character came online before the strip landed; kick them and retry',
    };
  }
  const landed = await deps.saveCharacterState(input.characterId, row.level, row.state);
  if (!landed) {
    // The fenced UPDATE's 0-row answer has two causes: a live lease (the
    // retry line), or the character row vanishing between the load and the
    // write (a deleted character, which no retry can cure). One SELECT 1 on
    // the refusal path only, never a second blob load, over the same
    // predicate the first load answers not-found on (a row with a null state
    // is a vanished character too, never a lease), so the operator reads the
    // true cause.
    const still = await deps.characterStateExists(input.characterId);
    return { ok: false, error: still ? CHARACTER_SAVE_LEASED_LINE : 'character not found' };
  }
  return { ok: true, cleared };
}
