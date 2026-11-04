import { setGmHidden } from '../src/sim/gm_presence';
import type { Sim } from '../src/sim/sim';
import { logger } from './http/logger';
import {
  canReceiveWatchNotices,
  type ModerationHost,
  type ModerationSession,
} from './moderation_service';
import { copyPresenceSubject, type PresenceSubject } from './presence_privacy';
import type { SocialService } from './social';

// The live half of the GM tool commands (/visible, /watch login pings,
// /announce) that ModerationService drives through its host. Kept beside
// server/game.ts rather than inside it: the game only spreads these members
// into moderationHost() and supplies its session roster and broadcast.

// Realm announcements read apart from the gold system lines around them.
export const ANNOUNCE_COLOR = '#ff7d1a';

export type GmToolsHost<TSession extends ModerationSession> = Pick<
  ModerationHost<TSession>,
  'isCurrentSession' | 'isGmHidden' | 'setGmHidden' | 'onlineStaff' | 'announce'
>;

/** The one social call /visible makes: the friends and guild "online" side. */
export type GmPresenceSocial = Pick<SocialService, 'announcePresence'>;

export function gmToolsHost<TSession extends ModerationSession & PresenceSubject>(
  sim: Sim,
  sessions: ReadonlyMap<number, TSession>,
  broadcast: (text: string, color: string) => void,
  social?: GmPresenceSocial,
): GmToolsHost<TSession> {
  return {
    isCurrentSession: (session) => sessions.get(session.pid) === session && !session.left,
    isGmHidden: (session) => sim.entities.get(session.pid)?.gmHidden === true,
    setGmHidden: (session, hidden) => {
      const entity = sim.entities.get(session.pid);
      if (!entity) return;
      // Taken before the flag flips, so hiding still tells friends and
      // guildmates "has gone offline" (a GM already on /presence none says nothing).
      const before = copyPresenceSubject(session);
      setGmHidden(sim.ctx, entity, hidden);
      // The social graph reads the session, not the entity: the friends and
      // guild rows, the live position push, the public guild board, and the
      // deed celebrations all go dark (server/presence_privacy.ts).
      if (hidden) session.gmHidden = true;
      else delete session.gmHidden;
      if (!social) return;
      const actor = {
        characterId: session.characterId,
        accountId: session.accountId,
        name: session.name,
      };
      void social
        .announcePresence(actor, !hidden, hidden ? before : undefined)
        .catch((err) =>
          logger.error({ err }, 'failed to announce GM visibility to the social graph'),
        );
    },
    onlineStaff: () => [...sessions.values()].filter(canReceiveWatchNotices),
    announce: (fromName, text) => broadcast(`[Announcement] ${fromName}: ${text}`, ANNOUNCE_COLOR),
  };
}
