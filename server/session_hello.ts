// The per-socket `hello` frame both join arms send (GameServer.join's fresh arm
// and resumeSession), built in one place so the two can never drift. Issuing a
// hello also rotates the session's resume token (server/resume_token.ts): only
// the newest socket's client holds a token that can supersede this session, and
// a token captured from an older socket stops working the moment it is replaced.

import { mintResumeToken } from './resume_token';

export interface HelloSession {
  pid: number;
  name: string;
  isAdmin: boolean;
  chatMutedUntil: number | null;
  movementWireVersion: 1 | 2;
  resumeToken: string;
}

export function issueHelloFrame(
  session: HelloSession,
  cls: string,
  world: { seed: number; realm: string; softWords: string[] },
) {
  session.resumeToken = mintResumeToken();
  return {
    t: 'hello' as const,
    pid: session.pid,
    seed: world.seed,
    name: session.name,
    cls,
    realm: world.realm,
    // Staff advert for admin-gated client surfaces (the /dev Spawns tab).
    // Every gated command is re-checked server-side, so a forged true is inert.
    admin: session.isAdmin,
    // Soft (cosmetic) words the client masks locally when its profanity
    // filter is on. Hard words are never sent; they're enforced server-side.
    softWords: world.softWords,
    // Epoch ms of an active chat mute, or null. Lets the client show status
    // at login; sending is still gated server-side regardless.
    chatMutedUntil: session.chatMutedUntil ?? null,
    movementWire: session.movementWireVersion,
    // Sent only to this session's own socket; the client holds it in memory.
    resumeToken: session.resumeToken,
  };
}
