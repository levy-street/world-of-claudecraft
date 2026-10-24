import { setGmHidden } from '../src/sim/gm_presence';
import type { Sim } from '../src/sim/sim';
import {
  canReceiveWatchNotices,
  type ModerationHost,
  type ModerationSession,
} from './moderation_service';

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

export function gmToolsHost<TSession extends ModerationSession>(
  sim: Sim,
  sessions: ReadonlyMap<number, TSession>,
  broadcast: (text: string, color: string) => void,
): GmToolsHost<TSession> {
  return {
    isCurrentSession: (session) => sessions.get(session.pid) === session && !session.left,
    isGmHidden: (session) => sim.entities.get(session.pid)?.gmHidden === true,
    setGmHidden: (session, hidden) => {
      const entity = sim.entities.get(session.pid);
      if (entity) setGmHidden(sim.ctx, entity, hidden);
    },
    onlineStaff: () => [...sessions.values()].filter(canReceiveWatchNotices),
    announce: (fromName, text) => broadcast(`[Announcement] ${fromName}: ${text}`, ANNOUNCE_COLOR),
  };
}
