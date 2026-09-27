// The REST payload shapes the online client's Api reads and returns (realm
// directory, release notes, account info, wallet proofs). Type-only, moved out
// of online.ts under the monolith ratchet; online.ts re-exports every name so
// existing importers keep their '../net/online' path.

export type RealmType = 'Normal' | 'PvP' | 'RP' | 'RP-PvP';

export interface RealmEntry {
  name: string;
  url: string;
  type: RealmType;
}

export interface RealmDirectory {
  current: string;
  realms: RealmEntry[];
  characters: Record<string, number>; // realm name -> how many characters you have
}

// A published GitHub release, as surfaced by the server's /api/releases proxy
// for the home-page "News & Updates" view. Body is raw release-note markdown.
export interface ReleaseEntry {
  id: number;
  tag: string;
  name: string;
  body: string;
  url: string;
  prerelease: boolean;
  publishedAt: string; // ISO 8601
}

export interface AccountInfo {
  username: string;
  email: string;
  // True when the account has no recovery email yet (mandatory-email capture).
  emailMissing?: boolean;
  createdAt: string;
  characterCount: number;
  twoFactorEnabled: boolean;
  // False for an account provisioned by Apple or Discord sign-in that never got
  // a real, owner-chosen password (see setInitialPassword below).
  passwordSet: boolean;
}

export interface SeekerEntitlementStatus {
  entitled: boolean;
  mint: string | null;
}

/** Account proof for a wallet-link CHANGE (the R11 relink gate): the password
 *  arm, plus the second factor when the account has one enrolled. */
export interface WalletReauthProof {
  password: string;
  totp?: string;
  recoveryCode?: string;
}
