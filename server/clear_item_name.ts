// The stamped-legendary-name remediation arm (Masterwrought phase 13 review):
// a promoted copy's payload.name is permanent, tradable, peer-visible (the eqi
// inspect wire), and Discord-published, and the owner cannot re-promote to
// replace it ('already legendary'), so a name that later needs removing (a
// banlist addition, uncovered language, contextual offense) previously had
// only forbidden hand SQL. This module is the pure decision-and-strip core
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
// moderation surface). The LIVE-session arm needs a sim-side action mirroring
// restoreToolEffectSlotAction (the R35 server-admin-only precedent); until it
// lands, kick-then-clear is the recorded operator flow. Copies escrowed in
// the world-state books (market listings, mail parcels) and foreign-held
// copies are out of scope here, the rename sweep's recorded limit.

import type { CharacterState } from '../src/sim/sim';
import { type EquipSlot, isEquipSlot } from '../src/sim/types';

/** What the operator asked to strip: one worn slot, one bag cell (the
 *  index-plus-id pin, so a shifted stack is never stripped by accident), or
 *  every named copy on the character. */
export type ClearItemNameTarget =
  | { kind: 'slot'; slot: string }
  | { kind: 'bag'; bag: number; itemId: string }
  | { kind: 'all' };

/** Validate a clear-item-name request body. English error prose (the R35
 *  restore family's admin error model) or null when valid. Runs BEFORE the
 *  audit write, so a malformed request never leaves an audit row. */
export function clearItemNameBodyError(body: {
  slot?: unknown;
  bag?: unknown;
  itemId?: unknown;
}): string | null {
  const hasSlot = body.slot !== undefined;
  const hasBag = body.bag !== undefined;
  const hasItemId = body.itemId !== undefined;
  if (hasSlot && (hasBag || hasItemId)) return 'name a worn slot or a bag cell, not both';
  if (hasSlot) {
    if (typeof body.slot !== 'string' || !isEquipSlot(body.slot)) return 'unknown equipment slot';
    return null;
  }
  if (hasBag !== hasItemId) return 'a bag target needs both the cell index and its item id';
  if (hasBag) {
    if (typeof body.bag !== 'number' || !Number.isInteger(body.bag) || body.bag < 0) {
      return 'bag must be a non-negative whole number';
    }
    if (typeof body.itemId !== 'string' || body.itemId.length === 0 || body.itemId.length > 64) {
      return 'unknown item id';
    }
  }
  return null;
}

/** The validated body as a target. Call only after clearItemNameBodyError
 *  returned null. No target fields means the whole-character sweep. */
export function clearItemNameTarget(body: {
  slot?: unknown;
  bag?: unknown;
  itemId?: unknown;
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
  saveCharacterState(characterId: number, level: number, state: CharacterState): Promise<unknown>;
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
 * header's live-session rationale), write the audit row, then load-strip-save,
 * so a strip can never exist unaudited; a post-audit refusal (deleted
 * character, nothing matched) surfaces as an explicit error and the audit row
 * honestly records the attempt. recordAudit throws on a missing reason
 * (moderation_db cleanText), surfaced by the caller's catch like the restores.
 */
export async function runClearItemName(
  deps: ClearItemNameDeps,
  input: {
    characterId: number;
    adminAccountId: number;
    body: { slot?: unknown; bag?: unknown; itemId?: unknown; reason?: unknown };
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
  if (!row || !row.state) return { ok: false, error: 'character not found' };
  const cleared = stripLegendaryNames(row.state, target);
  if (cleared === 0) return { ok: false, error: 'no named copy matched that target' };
  await deps.saveCharacterState(input.characterId, row.level, row.state);
  return { ok: true, cleared };
}
