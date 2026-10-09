// Tracked-item grants behind the inventory hub (Sim.addItem / addItemInstance):
// every copy of an epic or legendary item (item_provenance.ts
// TRACKED_ITEM_QUALITIES) is minted with a guid and a provenance record the
// first time it reaches a player's bags, and every later hub grant that moves
// the copy to a DIFFERENT character (`opts.movement`: trade, mail, market,
// commission delivery) appends that character to its owner chain. Each stamp
// also emits the server-only `itemTracked` event, which the authoritative
// server mirrors into its item ledger (server/item_ledger.ts); offline and
// headless hosts simply drain it.
//
// The guid belongs to the physical copy for its whole life
// (docs/design/item-tracking.md "Lineage"): a change IN PLACE keeps it and
// writes a `modify` row (recordTrackedChange), the end of the copy writes a
// `consume` row, and only a copy that turns into a DIFFERENT item gets a new
// guid, minted as a `derive` row that names its parent (opts.derivedFrom).
// So "one guid, one live copy" holds, and a guid seen after its consume row
// is a duplicate.
//
// What is NOT tracked, deliberately: stackable defs (a tracked copy is one
// per slot, and a stackable epic consumable would fragment its stack), bags
// (declared payload-free, bags.ts equipBag #2837: a worn bag socket carries
// no payload, so a minted bag could never be equipped), and
// the payload-free `movement` regrants a same-character path makes (a trade
// rollback, an enchant re-mint, a buyback), which the transfer rule in
// item_provenance.ts recognises as the same holder and leaves alone.
//
// The guid comes from the host (`cfg.mintItemGuid`, the server's
// crypto.randomUUID) or, when the host supplied none, from the deterministic
// fallback keyed on the world seed, the tick and a per-Sim ordinal: no rng
// draw either way, so the shared draw order (tests/parity) never moves.
//
// SimContext-backed system module (src/sim/CLAUDE.md): the backing state is
// the payloads in the player's bags; the only module-local state is the
// per-Sim mint ordinal, keyed weakly on the Sim's own player map so two Sims
// in one process never share a counter.

import { stackSizeOf } from './bags';
import { dungeonAt, ITEMS, zoneAt } from './data';
import { effectiveQuality } from './equipment_rules';
import { grantInventoryInstances, type InventoryGrantOptions } from './inventory_grant';
import {
  deterministicItemGuid,
  isItemGuid,
  LEGACY_ITEM_SOURCE,
  MAX_ITEM_LEDGER_DETAIL_LENGTH,
  MAX_ITEM_PROVENANCE_NAME_LENGTH,
  MAX_ITEM_PROVENANCE_SOURCE_LENGTH,
  recordItemTransfer,
  TRACKED_ITEM_QUALITIES,
  WORLD_ITEM_SOURCE,
} from './item_provenance';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { ItemDef, ItemInstancePayload, ItemOwnerRecord, ItemProvenance } from './types';

/** Whether copies of `def` (as this `instance` presents it) carry a guid: an
 *  epic or legendary quality (the copy's own rolled quality wins over the
 *  def's, the equipment_rules.ts precedence) on a one-per-slot def. */
export function isTrackedItem(def: ItemDef | undefined, instance?: ItemInstancePayload): boolean {
  if (!def || def.kind === 'bag') return false;
  const quality = effectiveQuality(def, instance);
  return quality !== undefined && TRACKED_ITEM_QUALITIES.has(quality) && stackSizeOf(def) === 1;
}

/** The plain-arm redirect test (Sim.addItem): a tracked def granted with no
 *  payload takes the instanced arm so every copy is minted. */
export function isTrackedItemGrant(def: ItemDef | undefined): boolean {
  return isTrackedItem(def, undefined);
}

const mintOrdinals = new WeakMap<object, number>();

function nextMintOrdinal(ctx: SimContext): number {
  const key = ctx.players;
  const next = (mintOrdinals.get(key) ?? 0) + 1;
  mintOrdinals.set(key, next);
  return next;
}

function mintGuid(ctx: SimContext, itemId: string, pid: number): string {
  const host = ctx.cfg.mintItemGuid;
  if (host) {
    try {
      const guid = host();
      if (isItemGuid(guid)) return guid;
    } catch {
      // A host mint that throws or misbehaves falls through to the
      // deterministic arm rather than leaving the copy untracked.
    }
  }
  return deterministicItemGuid(ctx.cfg.seed, ctx.tickCount, nextMintOrdinal(ctx), itemId, pid);
}

function holderFor(ctx: SimContext, meta: PlayerMeta): ItemOwnerRecord {
  return {
    at: ctx.lockoutNowMs(),
    by: meta.name.slice(0, MAX_ITEM_PROVENANCE_NAME_LENGTH),
    ...(meta.characterId !== undefined && { byId: meta.characterId }),
  };
}

/** The zone (or instanced dungeon) id under the recipient, for the origin
 *  record; absent when the entity is not in the world. */
function zoneFor(ctx: SimContext, meta: PlayerMeta): string | undefined {
  const e = ctx.entities.get(meta.entityId);
  if (!e) return undefined;
  const dungeon = dungeonAt(e.pos.x);
  return dungeon ? dungeon.id : zoneAt(e.pos.x, e.pos.z).id;
}

function sourceFor(opts: InventoryGrantOptions | undefined): string {
  const raw =
    opts?.source ??
    (opts?.craftedRecipeId !== undefined
      ? `craft:${opts.craftedRecipeId}`
      : opts?.movement
        ? LEGACY_ITEM_SOURCE
        : WORLD_ITEM_SOURCE);
  return raw.slice(0, MAX_ITEM_PROVENANCE_SOURCE_LENGTH);
}

/**
 * Stamp ONE copy on its way into `meta`'s bags: a copy with no guid is minted
 * (guid + origin record), a copy that already carries one records a transfer
 * when `opts.movement` says it is changing hands and the recipient is not the
 * holder the record last saw. Returns the payload to grant (the input when
 * nothing changed) and emits the server-only ledger event for every stamp.
 * Mutates a copy the caller owns; never the caller's input object.
 */
export function stampTrackedCopy(
  ctx: SimContext,
  meta: PlayerMeta,
  itemId: string,
  instance: ItemInstancePayload,
  opts: InventoryGrantOptions | undefined,
): ItemInstancePayload {
  const def = ITEMS[itemId];
  const quality = def ? effectiveQuality(def, instance) : undefined;
  if (instance.guid === undefined) {
    if (!isTrackedItem(def, instance)) return instance;
    const holder = holderFor(ctx, meta);
    const zone = zoneFor(ctx, meta);
    // A copy made FROM another tracked copy names its parent: the mint is a
    // `derive` row, and the parent's own consume row points back here.
    const derivedFrom = isItemGuid(opts?.derivedFrom) ? opts.derivedFrom : undefined;
    const provenance: ItemProvenance = {
      ...holder,
      source: sourceFor(opts),
      ...(zone !== undefined && { zone }),
      ...(derivedFrom !== undefined && { derivedFrom }),
    };
    const guid = mintGuid(ctx, itemId, meta.entityId);
    ctx.emit({
      type: 'itemTracked',
      pid: meta.entityId,
      kind: derivedFrom === undefined ? 'mint' : 'derive',
      guid,
      itemId,
      quality: quality ?? '',
      by: holder.by,
      ...(holder.byId !== undefined && { byId: holder.byId }),
      source: provenance.source,
      ...(zone !== undefined && { zone }),
      ...(derivedFrom !== undefined && { relatedGuid: derivedFrom }),
      at: holder.at,
    });
    return { guid, provenance, ...instance };
  }
  if (!opts?.movement || !instance.provenance) return instance;
  const holder = holderFor(ctx, meta);
  const stamped: ItemInstancePayload = {
    ...instance,
    provenance: {
      ...instance.provenance,
      ...(Array.isArray(instance.provenance.owners) && {
        owners: instance.provenance.owners.map((o) => ({ ...o })),
      }),
    },
  };
  if (!recordItemTransfer(stamped.provenance as ItemProvenance, holder)) return instance;
  ctx.emit({
    type: 'itemTracked',
    pid: meta.entityId,
    kind: 'transfer',
    guid: instance.guid,
    itemId,
    quality: quality ?? '',
    by: holder.by,
    ...(holder.byId !== undefined && { byId: holder.byId }),
    source: opts.source ?? 'transfer',
    at: holder.at,
  });
  return stamped;
}

/** A payload with its tracked identity stripped, so the hub mints it fresh. */
function withoutIdentity(instance: ItemInstancePayload): ItemInstancePayload {
  const { guid: _guid, provenance: _provenance, ...rest } = instance;
  return rest;
}

/**
 * The instanced hub arm's grant: `count` copies of `instance` into `meta`'s
 * bags, each tracked copy stamped on its own (a fresh mint per copy, since
 * two copies never share a guid). Untracked payloads take the shared packer
 * once, exactly as before tracking existed. Returns the payload the first
 * copy was granted with, for the receipt event.
 *
 * The duplicate guard: a payload that already carries a guid is ONE copy, so
 * only the first of `count` keeps it. Every further copy is minted fresh as a
 * `derive` of that guid rather than landing as a second live copy sharing it
 * (tracked defs are one per slot, so no caller does this today).
 */
export function grantTrackedInstances(
  ctx: SimContext,
  meta: PlayerMeta,
  itemId: string,
  count: number,
  instance: ItemInstancePayload,
  opts: InventoryGrantOptions | undefined,
): ItemInstancePayload {
  if (instance.guid === undefined && !isTrackedItem(ITEMS[itemId], instance)) {
    grantInventoryInstances(
      meta.inventory,
      itemId,
      count,
      instance,
      opts?.craftedRecipeId,
      opts?.materialSources,
    );
    return instance;
  }
  let first: ItemInstancePayload | undefined;
  for (let i = 0; i < count; i++) {
    const stamped =
      i > 0 && isItemGuid(instance.guid)
        ? stampTrackedCopy(ctx, meta, itemId, withoutIdentity(instance), {
            ...opts,
            derivedFrom: instance.guid,
          })
        : stampTrackedCopy(ctx, meta, itemId, instance, opts);
    grantInventoryInstances(
      meta.inventory,
      itemId,
      1,
      stamped,
      opts?.craftedRecipeId,
      opts?.materialSources,
    );
    first ??= stamped;
  }
  return first ?? instance;
}

/**
 * A tracked copy withdrawn from a shared container that bypasses the hub
 * (the guild bank, guild_bank.ts): find the copy by guid in the withdrawing
 * character's bags and record the change of hands as a movement grant would.
 */
export function recordTrackedWithdrawal(
  ctx: SimContext,
  meta: PlayerMeta,
  guid: string,
  source: string,
): void {
  const slot = meta.inventory.find((s) => s.instance?.guid === guid);
  if (!slot?.instance) return;
  slot.instance = stampTrackedCopy(ctx, meta, slot.itemId, slot.instance, {
    movement: true,
    source,
  });
}

/**
 * Stamp a guid onto a copy that became tracked IN PLACE (the legendary
 * promotion, professions/perfecting.ts: a Perfected copy's rolled quality
 * turns legendary without passing through the hub). Mutates the live payload
 * and emits the mint. A copy that already carries a guid keeps it and gets a
 * `modify` row instead (source and `detail` name the change), since the
 * guid belongs to the copy for its whole life.
 */
export function ensureTrackedInPlace(
  ctx: SimContext,
  meta: PlayerMeta,
  itemId: string,
  payload: ItemInstancePayload,
  source: string,
  detail?: string,
): void {
  if (payload.guid !== undefined) {
    recordTrackedChange(ctx, meta, itemId, payload, 'modify', source, detail);
    return;
  }
  const stamped = stampTrackedCopy(ctx, meta, itemId, payload, { source });
  if (stamped.guid === undefined) return;
  payload.guid = stamped.guid;
  payload.provenance = stamped.provenance;
}

/**
 * Record a lifecycle step of a tracked copy that is NOT a grant: a change in
 * place (`modify`: Perfecting, an enchant, a Rift Forge upgrade, an unbind)
 * or the end of the copy (`consume`: sundered, salvaged, disenchanted,
 * destroyed, learned, spent). `source` names the action (a sim-composed id),
 * `detail` the specifics (a rank, an enchant id, what it became) and
 * `relatedGuid` the other copy a swap or derivation names. A payload with no
 * guid (an untracked or pre-tracking copy) records nothing. Emits only: the
 * copy itself is never touched, so a call can sit beside any mutation.
 */
export function recordTrackedChange(
  ctx: SimContext,
  meta: PlayerMeta,
  itemId: string,
  payload: ItemInstancePayload | undefined,
  kind: 'modify' | 'consume',
  source: string,
  detail?: string,
  relatedGuid?: string,
): void {
  const guid = payload?.guid;
  if (!isItemGuid(guid)) return;
  const def = ITEMS[itemId];
  const holder = holderFor(ctx, meta);
  ctx.emit({
    type: 'itemTracked',
    pid: meta.entityId,
    kind,
    guid,
    itemId,
    quality: (def ? effectiveQuality(def, payload) : undefined) ?? '',
    by: holder.by,
    ...(holder.byId !== undefined && { byId: holder.byId }),
    source: source.slice(0, MAX_ITEM_PROVENANCE_SOURCE_LENGTH),
    ...(detail !== undefined &&
      detail.length > 0 && { detail: detail.slice(0, MAX_ITEM_LEDGER_DETAIL_LENGTH) }),
    ...(isItemGuid(relatedGuid) && relatedGuid !== guid && { relatedGuid }),
    at: holder.at,
  });
}

/** `consume` rows for every tracked copy among `payloads` (a remover's
 *  consumed-instance list, e.g. removeItem's): one per copy, all with the
 *  same action, detail and related guid. */
export function recordTrackedConsumed(
  ctx: SimContext,
  meta: PlayerMeta,
  itemId: string,
  payloads: readonly (ItemInstancePayload | undefined)[],
  source: string,
  detail?: string,
  relatedGuid?: string,
): void {
  for (const payload of payloads) {
    recordTrackedChange(ctx, meta, itemId, payload, 'consume', source, detail, relatedGuid);
  }
}
