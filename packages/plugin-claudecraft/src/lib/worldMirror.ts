// STUB (RFC) — client-side world mirror.
// Ports the delta-merge from scripts/mp_integration.mjs (mergeSelf / mergeEnts) so the
// agent has a single ground-truth view of the world assembled from delta-encoded snapshots.
// TODO(eliza): port the exact DELTA_SELF_KEYS / ENTITY_IDENTITY_KEYS + snap.keep handling.

import type { WireEntity, WireSelf } from '../types.js';

/** Identity fields that only appear on a "full" entity record; carried forward on lite records. */
const ENTITY_IDENTITY_KEYS = ['k', 'tid', 'nm', 'lv', 'own'] as const;

/** Heavy self fields that are omitted when unchanged and must be carried forward. */
const DELTA_SELF_KEYS = ['inv', 'equip', 'qlog', 'qdone', 'cds', 'stats', 'party'] as const;

export class WorldMirror {
  self: WireSelf | null = null;
  entities = new Map<number, WireEntity>();

  /** Apply one `{t:'snap'}` frame. */
  applySnapshot(_snap: unknown): void {
    // TODO(eliza): mergeSelf(prev, next) over DELTA_SELF_KEYS; mergeEnts over identity keys + keep[].
    void ENTITY_IDENTITY_KEYS;
    void DELTA_SELF_KEYS;
    throw new Error('TODO(eliza): WorldMirror.applySnapshot');
  }

  /** Entities within `radius` yards of self, nearest first. */
  nearbyEntities(_radius: number): WireEntity[] {
    throw new Error('TODO(eliza): WorldMirror.nearbyEntities');
  }

  /** Mobs whose aggro target is self (in combat with us). */
  threateningSelf(): WireEntity[] {
    throw new Error('TODO(eliza): WorldMirror.threateningSelf');
  }
}
