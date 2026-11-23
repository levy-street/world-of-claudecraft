import type { Presence, PresenceStatus } from './social';
import { canShowInWho, type WhoVisibilitySession } from './who_roster';

// The cheap (no-DB) once-a-second push that keeps each client's already-known
// friends and guildmates current on the world map: their live x/z, zone,
// activity and Book of Deeds title. Moved out of the GameServer coordinator
// (monolith ratchet); server/game.ts keeps a one-line delegate and the host.
//
// A friend/guild edge on the OTHER side survives a block (blockAdd only cleans
// the blocker's own outgoing friend edge, never guild membership), so a tracked
// id can stay in socialTrackedIds long after a block either way. canShowInWho
// refuses to leak live position across it, bidirectionally, and also honours
// the tracked character's presence setting (server/presence_privacy.ts), the
// same rule /who applies.

export interface SocialPositionSession extends WhoVisibilitySession {
  socialTrackedIds?: number[];
}

/** What the push needs from GameServer, so it never reaches into the coordinator. */
export interface SocialPositionHost<S extends SocialPositionSession> {
  sessions(): Iterable<S>;
  sessionByCharacterId(characterId: number): S | null;
  presenceOf(session: S): Presence;
  /** The live Book of Deeds title (sim meta, no DB read), null when untitled. */
  activeTitleOf(session: S): string | null;
  send(session: S, frame: unknown): void;
}

export interface SocialPositionRow {
  id: number;
  x: number;
  z: number;
  zone: string;
  status: PresenceStatus;
  title: string | null;
}

export function broadcastSocialPositions<S extends SocialPositionSession>(
  host: SocialPositionHost<S>,
): void {
  for (const session of host.sessions()) {
    const ids = session.socialTrackedIds;
    if (!ids || ids.length === 0) continue;
    const list: SocialPositionRow[] = [];
    for (const id of ids) {
      const other = host.sessionByCharacterId(id);
      if (!other) continue; // offline: snapshots own the online/offline flip
      if (!canShowInWho(session, other)) continue;
      const loc = host.presenceOf(other);
      if (loc.x === undefined || loc.z === undefined) continue;
      // The `social` frame's DB-sourced roster title lags the autosave, so this
      // keeps non-nearby friends/guildmates current without a relog. Always
      // present so a cleared title propagates as an explicit null.
      const title = host.activeTitleOf(other);
      list.push({ id, x: loc.x, z: loc.z, zone: loc.zone, status: loc.status, title });
    }
    if (list.length > 0) host.send(session, { t: 'socialpos', list });
  }
}
