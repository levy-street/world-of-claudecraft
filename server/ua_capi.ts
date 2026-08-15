// UA conversion events: the game-loop-facing shell over meta_capi.ts. Owns
// the level-milestone fan-out (levels 2 and 5), the once-guarded D7Retained
// send, and the email enrichment shared by all of them: the account's signup
// email rides every event as a SHA-256 hash (hashed inside buildCapiPayload,
// never sent raw), which raises Meta's event match quality and directly
// lowers effective CPM. Everything here is fire-and-forget: a CAPI outage or
// a db hiccup costs an ad-platform signal, never gameplay, and nothing throws
// into the caller.

import { accountMailTarget, pool } from './db';
import {
  type CapiUserData,
  capiEnabled,
  trackDay7Retained,
  trackReachedLevel2,
  trackReachedLevel5,
} from './meta_capi';
import { claimDay7Retention } from './ua_capi_db';

/** The session fields the senders read; game.ts sessions satisfy this
 *  structurally, and tests pass a plain object. */
export interface UaCapiSession {
  accountId: number;
  characterId: number;
  ip?: string;
  userAgent?: string;
  fbp?: string;
  fbc?: string;
  sourceUrl?: string;
}

/** Injected seam so tests drive the module without Postgres or network. */
export interface UaCapiDeps {
  enabled: () => boolean;
  emailForAccount: (accountId: number) => Promise<string | null>;
  claimDay7: (accountId: number) => Promise<boolean>;
  sendLevel2: (characterId: number, userData: CapiUserData, sourceUrl?: string) => Promise<void>;
  sendLevel5: (characterId: number, userData: CapiUserData, sourceUrl?: string) => Promise<void>;
  sendDay7: (accountId: number, userData: CapiUserData, sourceUrl?: string) => Promise<void>;
}

const REAL_DEPS: UaCapiDeps = {
  enabled: capiEnabled,
  emailForAccount: async (accountId) => (await accountMailTarget(accountId))?.email ?? null,
  claimDay7: (accountId) => claimDay7Retention(pool, accountId),
  sendLevel2: trackReachedLevel2,
  sendLevel5: trackReachedLevel5,
  sendDay7: trackDay7Retained,
};

async function enrichedUserData(s: UaCapiSession, deps: UaCapiDeps): Promise<CapiUserData> {
  let email: string | null = null;
  try {
    email = await deps.emailForAccount(s.accountId);
  } catch {
    // Email enrichment is best-effort; the event still sends without it.
  }
  return {
    email,
    clientIp: s.ip,
    clientUserAgent: s.userAgent,
    fbp: s.fbp,
    fbc: s.fbc,
  };
}

/** Send the level-2 or level-5 conversion for one levelup event. Any other
 *  level is a silent no-op so the game-loop call site stays a single line. */
export function trackLevelMilestoneCapi(
  s: UaCapiSession,
  level: number,
  deps: UaCapiDeps = REAL_DEPS,
): void {
  if (level !== 2 && level !== 5) return;
  // CAPI-dark process (no token): skip BEFORE the email enrichment read, so a
  // dark realm pays nothing per ding.
  if (!deps.enabled()) return;
  void (async () => {
    const userData = await enrichedUserData(s, deps);
    const send = level === 2 ? deps.sendLevel2 : deps.sendLevel5;
    await send(s.characterId, userData, s.sourceUrl);
  })().catch((err) => {
    console.error('level milestone capi send failed:', err);
  });
}

/** Fire D7Retained exactly once per account, from the session-open path. The
 *  atomic claim (ua_capi_db.ts) owns the day-seven window and the dedupe;
 *  a losing claim is the common case and costs one indexed UPDATE. */
export function maybeTrackDay7Retained(s: UaCapiSession, deps: UaCapiDeps = REAL_DEPS): void {
  // CAPI-dark process: skip BEFORE the claim, so a token-dark window (rotation,
  // deploy gap, a realm without CAPI) can never consume the once-guard with
  // nothing sent; the account stays claimable for a later lit session that
  // still falls inside the day-seven window.
  if (!deps.enabled()) return;
  void (async () => {
    if (!(await deps.claimDay7(s.accountId))) return;
    const userData = await enrichedUserData(s, deps);
    await deps.sendDay7(s.accountId, userData, s.sourceUrl);
  })().catch((err) => {
    console.error('d7 retained capi send failed:', err);
  });
}
