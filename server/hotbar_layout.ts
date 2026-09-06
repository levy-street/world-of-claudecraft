// Per-character action-bar layout persistence, server side: the join-time read
// of the stored document, the per-profile merge of a client save, and the
// per-character FIFO database write. The document model and its bounds
// validation live in src/world_api/action_bar.ts (shared with the client); this
// module is what server/game.ts composes, so the coordinator carries one store
// field, one session-state spread, and one dispatch line.

import {
  ACTION_BAR_LAYOUT_LEGACY_PROFILE,
  type ActionBarLayoutProfiles,
  actionBarLayoutWire,
  sanitizeActionBarLayout,
  sanitizeActionBarLayoutProfile,
  sanitizeActionBarLayoutProfiles,
  withActionBarLayoutProfile,
} from '../src/world_api/action_bar';
import { setCharacterHotbarLayout } from './db';
import { createKeyedSerialWriter, KeyedSerialWriteAborted } from './serial_writer';

export interface HotbarLayoutState {
  // Frozen at join, serialized ONCE: the `hbl` self wire value (the v2 document
  // plus the desktop `forms` mirror for pre-profile clients) as JSON text, or
  // the text `null` when the character has never saved one (an explicit "seed
  // from local"). Self-scoped, never an entity/broadcast field; the heavy self
  // pass diffs the string against lastSent so it is sent exactly once and never
  // re-stringified, and a later client save never round-trips back here.
  initialHotbarLayoutJson: string;
  // Live: the stored document every save merges its ONE profile into, so a
  // touch save never clobbers the desktop arrangement (and vice versa).
  hotbarLayout: ActionBarLayoutProfiles | null;
}

/** Session state for a stored column value (untrusted at rest: re-validated
 *  here before it can wire out). Spread into the session at join and assigned
 *  again on a resume, whose auth handshake re-reads the row fresh. `live` is a
 *  document known to be at least as new as the row: a resume passes the
 *  session's own (this session is the character's only writer), a fresh join
 *  passes the store's still-pending document from the previous session, so a
 *  queued write that has not committed yet never regresses the merge base or
 *  the wire value. */
export function hotbarLayoutState(
  stored: unknown,
  live: ActionBarLayoutProfiles | null = null,
): HotbarLayoutState {
  const doc = live ?? sanitizeActionBarLayoutProfiles(stored);
  return {
    initialHotbarLayoutJson: JSON.stringify(doc ? actionBarLayoutWire(doc) : null),
    hotbarLayout: doc,
  };
}

/**
 * Merge one client save into the stored document. Returns the new document, or
 * null when the payload is dropped: a malformed/oversized layout, or a profile
 * name outside the known set. A save that names no profile comes from a
 * pre-profile client bundle and lands on the legacy (desktop) profile.
 */
export function mergeHotbarLayoutSave(
  current: ActionBarLayoutProfiles | null,
  msg: { profile?: unknown; layout?: unknown },
): ActionBarLayoutProfiles | null {
  const profile =
    msg.profile === undefined
      ? ACTION_BAR_LAYOUT_LEGACY_PROFILE
      : sanitizeActionBarLayoutProfile(msg.profile);
  if (profile === null) return null;
  const layout = sanitizeActionBarLayout(msg.layout);
  if (layout === null) return null;
  return withActionBarLayoutProfile(current, profile, layout);
}

/** The per-character FIFO writer behind the `save_hotbar_layout` command. A
 *  save that is still queued when the next one arrives is superseded (the
 *  session document already holds every merge, so the newest write carries
 *  them all), and a write that has started is never disturbed, so a burst or
 *  a hostile flood costs at most one running plus one queued write per
 *  character and the newer document is never overwritten by the older. */
export class HotbarLayoutStore {
  private readonly queues = createKeyedSerialWriter<number>();
  private readonly queued = new Map<number, AbortController>();
  // The newest merged document per character until its write has settled. A
  // queued write can outlive its session's logout, so a fresh join whose auth
  // handshake read the row before that commit seeds from here instead of the
  // stale row (otherwise its first save would merge onto the old document and
  // drop the previous session's last edit of the other profile).
  private readonly documents = new Map<number, ActionBarLayoutProfiles>();

  /** The newest document still on its way to the database for this character,
   *  or null once every write has settled (the row is then current). */
  pending(characterId: number): ActionBarLayoutProfiles | null {
    return this.documents.get(characterId) ?? null;
  }

  /** Validate + merge a client save into the session's document, then persist
   *  the whole document. A dropped payload never crashes the session. */
  save(session: HotbarLayoutState & { characterId: number }, msg: Record<string, unknown>): void {
    const doc = mergeHotbarLayoutSave(session.hotbarLayout, msg);
    if (doc === null) return;
    session.hotbarLayout = doc;
    const characterId = session.characterId;
    this.queued.get(characterId)?.abort();
    const controller = new AbortController();
    this.queued.set(characterId, controller);
    this.documents.set(characterId, doc);
    void this.queues
      .enqueueCancellable(characterId, controller.signal, () =>
        setCharacterHotbarLayout(characterId, doc),
      )
      .catch((err) => {
        if (err instanceof KeyedSerialWriteAborted) return; // superseded before it started
        console.error('failed to save hotbar layout:', err);
      })
      .finally(() => {
        if (this.queued.get(characterId) === controller) this.queued.delete(characterId);
        if (this.documents.get(characterId) === doc) this.documents.delete(characterId);
      });
  }
}
