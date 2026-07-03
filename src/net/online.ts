// Online play: REST auth client + WebSocket world mirror.

import {
  isDesktopAppRuntime,
  normalizeOrigin,
  runtimeApiOrigin,
  runtimeWebSocketUrl,
} from '../runtime';
import { signChallenge } from '../sim/client_challenge';
import { mechChromaItemId, mechChromaSkinIndex } from '../sim/content/skins';
import {
  cloneAllocation,
  computeTalentModifiers,
  emptyAllocation,
  pointsSpent,
  type Role,
  SAVED_LOADOUT_BAR_SLOTS,
  type SavedLoadout,
  type TalentAllocation,
  talentPointsAtLevel,
} from '../sim/content/talents';
import { abilitiesKnownAt, CLASSES, NPCS, resolveDelveShopOffers } from '../sim/data';
import { deadTargetSelectable } from '../sim/dead_target';
import { LEADERBOARD_PAGE_SIZE } from '../sim/leaderboard_page';
import type { Ante, PickAction } from '../sim/lockpick';
import type { MarketQuery } from '../sim/market_query';
import { normalizeMoveFacing, sanitizeMoveInput } from '../sim/move_input';
import { computeQuestState, type ResolvedAbility } from '../sim/sim';
import {
  type Entity,
  type EquipSlot,
  emptyMoveInput,
  type InvSlot,
  type LootRollChoice,
  type LootRollPrompt,
  type MasterLootThreshold,
  type MoveInput,
  type PlayerClass,
  type QuestProgress,
  type QuestState,
  type SimEvent,
} from '../sim/types';
import {
  type AccountCosmetics,
  type ArenaInfo,
  type CharacterSearchResult,
  type ClientCommand,
  type DailyRewardHistory,
  type DailyRewardSpinResult,
  type DailyRewardStatus,
  type DelveCompanionInfo,
  type DelveDailyInfo,
  type DelveRunInfo,
  type DelveShopOfferView,
  type DevLeaderboardPage,
  type DuelInfo,
  type FriendInfo,
  type GuildLeaderboardPage,
  type IWorld,
  isOverheadEmoteId,
  type LeaderboardEntry,
  type LeaderboardPage,
  type LockpickView,
  type MailInfo,
  type MarketInfo,
  type OverheadEmoteId,
  type PartyInfo,
  type PresenceStatus,
  type RaidLockout,
  type SocialInfo,
  type TradeInfo,
} from '../world_api';

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

export interface CharacterSummary {
  id: number;
  name: string;
  class: PlayerClass;
  level: number;
  skin: number;
  online: boolean;
  forceRename: boolean;
  lastPlayed?: string | null;
  playtimeSeconds?: number;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function normalizeAccountCosmetics(value: unknown): AccountCosmetics {
  const src = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    completedQuestIds: stringList(src.completedQuestIds),
    mechChromaIds: stringList(src.mechChromaIds),
  };
}

export function buildWebSocketUrl(protocol: string, host: string): string {
  return runtimeWebSocketUrl(protocol, host, DESKTOP_API_ORIGIN);
}

export const NATIVE_APP = String(import.meta.env.VITE_NATIVE_APP ?? '') === '1';
export const NATIVE_API_ORIGIN = normalizeOrigin(String(import.meta.env.VITE_API_ORIGIN ?? ''));
export const DESKTOP_APP = isDesktopAppRuntime();
export const DESKTOP_API_ORIGIN = DESKTOP_APP ? runtimeApiOrigin() : '';

export function apiUrl(path: string, base = ''): string {
  if (/^https?:\/\//.test(path)) return path;
  const origin = normalizeOrigin(base) || NATIVE_API_ORIGIN || DESKTOP_API_ORIGIN;
  return origin ? `${origin}${path}` : path;
}

export function buildWebSocketAuthMessage(
  token: string,
  characterId: number,
  clientSeed = '',
): { t: 'auth'; token: string; character: number; clientSeed: string } {
  return { t: 'auth', token, character: characterId, clientSeed };
}

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
  createdAt: string;
  characterCount: number;
  twoFactorEnabled: boolean;
}

// Carries the HTTP status alongside the server's error text so callers can
// distinguish an auth failure (401/403 → clear the stored session) from a
// transient 5xx/network blip (keep the token; the session may still be valid).
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** True for an auth-class failure where a stored token should be discarded. */
export function isAuthError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

export class Api {
  private static readonly SESSION_KEY = 'woc_session';
  token: string | null = null;
  username: string | null = null;
  realm: string | null = null;
  // base origin for realm-scoped calls (characters, search, ws). '' = the page
  // origin; set to another realm's origin when the player picks a realm
  base = NATIVE_API_ORIGIN || DESKTOP_API_ORIGIN;

  setRealm(url: string): void {
    this.base = normalizeOrigin(url) || NATIVE_API_ORIGIN || DESKTOP_API_ORIGIN;
  }

  // The realm directory is always read from the page's own server. Sending the
  // token (when logged in) also returns per-realm character counts.
  async realms(): Promise<RealmDirectory> {
    try {
      const res = await fetch(apiUrl('/api/realms'), {
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      });
      if (!res.ok) return { current: '', realms: [], characters: {} };
      const d = await res.json();
      return { current: d.current ?? '', realms: d.realms ?? [], characters: d.characters ?? {} };
    } catch {
      return { current: '', realms: [], characters: {} };
    }
  }

  // Live status for a realm (population + reachability), for the realm picker.
  async realmStatus(url: string): Promise<{ online: boolean; players: number }> {
    try {
      const res = await fetch(apiUrl('/api/status', url), { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return { online: false, players: 0 };
      const d = await res.json();
      return { online: true, players: d.players_online ?? 0 };
    } catch {
      return { online: false, players: 0 };
    }
  }

  private async post(path: string, body: unknown): Promise<any> {
    const res = await fetch(apiUrl(path, this.base), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error ?? `request failed (${res.status})`, res.status);
    return data;
  }

  private async get(path: string): Promise<any> {
    const res = await fetch(apiUrl(path, this.base), {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error ?? `request failed (${res.status})`, res.status);
    return data;
  }

  private async delete(path: string, body: unknown): Promise<any> {
    const res = await fetch(apiUrl(path, this.base), {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error ?? `request failed (${res.status})`, res.status);
    return data;
  }

  async register(
    username: string,
    password: string,
    turnstileToken = '',
    ref = '',
    nativeAttestation: unknown = undefined,
  ): Promise<void> {
    const data = await this.post('/api/register', {
      username,
      password,
      turnstileToken,
      ref,
      nativeAttestation,
    });
    this.token = data.token;
    this.username = data.username;
  }

  // Returns { twoFactorRequired: true } when the account has 2FA on and no code
  // was supplied: the caller then re-invokes with `code` (or `recoveryCode`). A
  // wrong code throws ApiError(401), like a wrong password.
  async login(
    username: string,
    password: string,
    turnstileToken = '',
    code = '',
    recoveryCode = '',
    nativeAttestation: unknown = undefined,
  ): Promise<{ twoFactorRequired?: boolean }> {
    const data = await this.post('/api/login', {
      username,
      password,
      turnstileToken,
      code,
      recoveryCode,
      nativeAttestation,
    });
    if (data.twoFactorRequired && !data.token) return { twoFactorRequired: true };
    this.token = data.token;
    this.username = data.username;
    return {};
  }

  async createDesktopLoginCode(): Promise<{ code: string; expiresInMs: number }> {
    const data = await this.post('/api/desktop-login/create', {});
    return {
      code: typeof data.code === 'string' ? data.code : '',
      expiresInMs: typeof data.expiresInMs === 'number' ? data.expiresInMs : 0,
    };
  }

  async exchangeDesktopLoginCode(code: string): Promise<void> {
    const data = await this.post('/api/desktop-login/exchange', { code });
    this.token = data.token;
    this.username = data.username;
  }

  // ── Persistent session (home-page account portal) ──────────────────────────
  // The bearer token + username are cached in localStorage so a reload restores
  // the logged-in nav state. The token is always re-validated server-side via
  // getAccount() before it is trusted; a 401 there means the caller should clear.
  saveSession(): void {
    if (!this.token || !this.username) return;
    try {
      localStorage.setItem(
        Api.SESSION_KEY,
        JSON.stringify({ token: this.token, username: this.username }),
      );
    } catch {
      /* storage may be unavailable (private mode); session stays in-memory */
    }
  }

  restoreSession(): boolean {
    try {
      const raw = localStorage.getItem(Api.SESSION_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw) as { token?: unknown; username?: unknown };
      if (typeof data.token !== 'string' || typeof data.username !== 'string') return false;
      this.token = data.token;
      this.username = data.username;
      return true;
    } catch {
      return false;
    }
  }

  clearSession(): void {
    this.token = null;
    this.username = null;
    try {
      localStorage.removeItem(Api.SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  // Account-wide self-service (whoami / password / email / deactivate) routes
  // through this.base, i.e. the currently-selected realm origin. This is correct
  // for the single-origin deploy (every realm shares one accounts DB, so the
  // account locks DB-wide regardless of which realm process serves the request).
  // MULTI-REALM ASSUMPTION: in a cross-origin multi-realm deploy the deactivate
  // online-check + forced-disconnect would only see THIS realm's live sessions;
  // characters live on other realm processes would not be torn down immediately
  // (they still lose auth at the DB on the next token check). Routing these
  // account-wide calls to a canonical account origin needs a new client/server
  // seam (the client has no realm directory today) — deferred to multi-realm
  // rollout. See server/realm.ts REALM_DIRECTORY / REALM_ORIGINS.
  async getAccount(): Promise<AccountInfo> {
    return this.get('/api/account');
  }

  async changePassword(current: string, next: string): Promise<void> {
    await this.post('/api/account/password', { current, next });
  }

  async logout(): Promise<void> {
    await this.post('/api/account/logout', {});
  }

  async deactivateAccount(username: string, password: string): Promise<void> {
    await this.post('/api/account/deactivate', { username, password });
  }

  // Request a verified email change: server mails a confirm link to the new
  // address and a notice to the old one. The address only changes on verify.
  async changeEmail(password: string, newEmail: string): Promise<void> {
    await this.post('/api/account/email/change', { password, newEmail });
  }

  // ── Two-factor (TOTP) ──────────────────────────────────────────────────────
  // setup returns the secret + otpauth URI to render as a QR code; enable
  // confirms a live code and returns the one-time recovery codes.
  async twoFactorSetup(password: string): Promise<{ secret: string; otpauthUri: string }> {
    return this.post('/api/account/2fa/setup', { password });
  }

  async twoFactorEnable(code: string): Promise<{ recoveryCodes: string[] }> {
    const data = await this.post('/api/account/2fa/enable', { code });
    return { recoveryCodes: Array.isArray(data.recoveryCodes) ? data.recoveryCodes : [] };
  }

  async twoFactorDisable(password: string): Promise<void> {
    await this.post('/api/account/2fa/disable', { password });
  }

  // GDPR data export: downloads the account + characters as a JSON file. Returns
  // the parsed bundle too, so the caller can trigger a browser download.
  async exportData(): Promise<unknown> {
    const res = await fetch(apiUrl('/api/account/export', this.base), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: '{}',
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = `request failed (${res.status})`;
      try {
        msg = JSON.parse(text).error ?? msg;
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(msg, res.status);
    }
    return JSON.parse(text);
  }

  async characters(): Promise<CharacterSummary[]> {
    const data = await this.get('/api/characters');
    if (typeof data.realm === 'string') this.realm = data.realm;
    return data.characters;
  }

  async createCharacter(name: string, cls: PlayerClass, skin = 0): Promise<void> {
    await this.post('/api/characters', { name, class: cls, skin });
  }

  async renameCharacter(characterId: number, name: string): Promise<void> {
    await this.post(`/api/characters/${characterId}/rename`, { name });
  }

  async deleteCharacter(characterId: number, name: string): Promise<void> {
    await this.delete(`/api/characters/${characterId}`, { name });
  }

  // Force-disconnect this character's live session (a stale tab, a crash, or
  // another device) so we can enter the world on it. Returns whether a session
  // was actually displaced (false = it was already offline).
  async takeoverCharacter(characterId: number): Promise<boolean> {
    const data = await this.post(`/api/characters/${characterId}/takeover`, {});
    return data.takenOver === true;
  }

  async reportPlayer(
    reporterCharacterId: number,
    targetPid: number,
    reason: string,
    details: string,
  ): Promise<void> {
    await this.post('/api/reports', { reporterCharacterId, targetPid, reason, details });
  }

  async reportPlayerByName(
    reporterCharacterId: number,
    targetCharacterName: string,
    reason: string,
    details: string,
  ): Promise<void> {
    await this.post('/api/reports', { reporterCharacterId, targetCharacterName, reason, details });
  }

  async submitBugReport(payload: {
    characterId: number;
    characterName: string;
    pos: { x: number; y: number; z: number };
    description: string;
    screenshot: string | null;
    meta: unknown;
  }): Promise<{ screenshotStored: boolean }> {
    const res = await this.post('/api/bug-reports', payload);
    // The server drops a screenshot that fails its allowlist/size gate; surface
    // that so the player is not told the screenshot was attached when it was not.
    return { screenshotStored: res?.screenshotStored !== false };
  }

  async projectStats(): Promise<{
    accounts_created: number;
    players_online: number;
    realm: string;
  }> {
    return this.get('/api/project-stats');
  }

  // Lifetime-XP leaderboard for the home page. 'global' ranks across all realms.
  async leaderboard(
    scope: 'realm' | 'global' = 'global',
    limit = 100,
  ): Promise<LeaderboardEntry[]> {
    try {
      const data = await this.get(
        `/api/leaderboard?scope=${scope}&metric=lifetimeXp&limit=${limit}`,
      );
      return data.leaders ?? [];
    } catch {
      return [];
    }
  }

  // News & Updates feed for the home page, mirrored from GitHub Releases by the
  // server. Not realm-scoped — always read from the page's own origin.
  async releases(limit = 20): Promise<ReleaseEntry[]> {
    try {
      const res = await fetch(apiUrl(`/api/releases?limit=${limit}`));
      if (!res.ok) return [];
      const data = await res.json();
      return data.releases ?? [];
    } catch {
      return [];
    }
  }

  // ── Non-custodial Solana wallet linking ───────────────────────────────────
  // Step 1: ask the server for the exact message to sign for this address.
  async walletLinkChallenge(address: string): Promise<{ nonce: string; message: string }> {
    return this.post('/api/wallet/link/challenge', { address });
  }

  // Step 2: submit the wallet's signature; server verifies + persists the link.
  async linkWallet(address: string, signature: string, nonce: string): Promise<{ pubkey: string }> {
    return this.post('/api/wallet/link', { address, signature, nonce });
  }

  // Current account's linked wallet (null when none).
  async linkedWallet(): Promise<{ pubkey: string; linkedAt: string } | null> {
    const data = await this.get('/api/wallet');
    return data.wallet ?? null;
  }

  async unlinkWallet(): Promise<void> {
    await this.delete('/api/wallet/link', {});
  }

  // ── Discord link/login + status ────────────────────────────────────────────
  // Returns the discord.com authorize URL the browser navigates to (login = new
  // session, link = attach to the current account).
  async discordStart(mode: 'login' | 'link'): Promise<{ url: string }> {
    return this.post(`/api/auth/discord/start?mode=${mode}`, {});
  }

  // First-time Discord login chooser: create a brand-new account for the verified
  // Discord identity (parked under `linkToken`) and start a session.
  async discordLoginNew(linkToken: string): Promise<void> {
    const data = await this.post('/api/auth/discord/login/new', { linkToken });
    this.token = data.token;
    this.username = data.username;
  }

  // First-time Discord login chooser: link the verified Discord identity to an
  // EXISTING account (username + password, plus a 2FA code if that account has it).
  // Returns { twoFactorRequired: true } when a code is needed (the caller re-invokes
  // with `code`/`recoveryCode`), mirroring login(); a wrong code/password throws.
  async discordLoginLink(
    linkToken: string,
    username: string,
    password: string,
    code = '',
    recoveryCode = '',
  ): Promise<{ twoFactorRequired?: boolean }> {
    const data = await this.post('/api/auth/discord/login/link', {
      linkToken,
      username,
      password,
      code,
      recoveryCode,
    });
    if (data.twoFactorRequired && !data.token) return { twoFactorRequired: true };
    this.token = data.token;
    this.username = data.username;
    return {};
  }

  // Current account's Discord link status + reward points + live guild presence.
  async discordStatus(): Promise<Record<string, unknown>> {
    return this.get('/api/discord');
  }

  // Unlink Discord. A Discord-provisioned account (no real password yet) must send a
  // `password` so it stays reachable after unlinking; the server 400s with
  // 'password_required' otherwise. A normal account passes nothing.
  async unlinkDiscord(password?: string): Promise<void> {
    await this.delete('/api/discord', password ? { password } : {});
  }

  // ── GitHub link + developer-badge status ───────────────────────────────────
  // Returns the github.com authorize URL the browser navigates to (link-only:
  // attaches the verified GitHub identity to the current account).
  async githubStart(): Promise<{ url: string }> {
    return this.post('/api/auth/github/start', {});
  }

  // Current account's GitHub link status + landed-commit count + dev tier.
  async githubStatus(): Promise<Record<string, unknown>> {
    return this.get('/api/github');
  }

  // Unlink GitHub from the current account.
  async unlinkGithub(): Promise<void> {
    await this.delete('/api/github', {});
  }

  // ── Shareable player card + referrals ──────────────────────────────────────
  // Publish (or replace) this character's card PNG. The server may return a
  // realm-relative public page path; main.ts normalizes it to an absolute URL
  // before injecting it into the share UI.
  // The body is the raw PNG, so this bypasses the JSON `post` helper.
  async uploadCard(characterId: number, png: Blob, lang = 'en'): Promise<{ url: string }> {
    const params = new URLSearchParams({ character: String(characterId), lang });
    const res = await fetch(`${this.base}/api/card?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: png,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `card upload failed (${res.status})`);
    return { url: data.url };
  }

  // The account's referral count + published-card slug (null before first
  // publish). Best-effort: returns zeros rather than throwing on error.
  async referralStats(): Promise<{ count: number; slug: string | null }> {
    try {
      const data = await this.get('/api/referrals');
      return { count: data.count ?? 0, slug: data.slug ?? null };
    } catch {
      return { count: 0, slug: null };
    }
  }

  // A character's realm standing by lifetime XP (rank 1 = highest), for the
  // card's "Top N%" flex. Best-effort: null on error so the card still renders.
  async characterStanding(characterId: number): Promise<{ rank: number; total: number } | null> {
    try {
      const data = await this.get(`/api/characters/${characterId}/standing`);
      if (typeof data.rank === 'number' && typeof data.total === 'number')
        return { rank: data.rank, total: data.total };
      return null;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// World mirror
// ---------------------------------------------------------------------------

function wrapAngle(d: number): number {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function copyPos(
  dst: { x: number; y: number; z: number },
  src: { x: number; y: number; z: number },
): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
}

// A single position update never moves an entity more than a few yards by
// walking; anything past this is a teleport (arena pit, dungeon portal,
// graveyard release). Those are snapped, not interpolated — see applyWire.
const TELEPORT_SNAP_DIST_SQ = 40 * 40;

// Despawn grace (anti-flicker, entity-map churn). The server keeps known
// entities in interest out to a drop radius (100yd players / 130yd npcs) that is
// wider than the add radius, but a wandering entity riding that boundary — or a
// single late/dropped frame — can still fall out of one snapshot without truly
// leaving. (Distance-tier-throttled entities are NOT a source here: the server
// lists them in `keep`, so they count as seen and are never missing.) Deleting a
// briefly-absent entity that frame, then re-creating it the next, churns the
// entity map; hold it at its last pose for this window instead. Kept short so a
// genuine leaver (logout, corpse cleanup) lingers only momentarily.
const DESPAWN_GRACE_MS = 600;
// ...but only for entities last seen near/beyond the interest boundary, where
// that churn happens. A close-range disappearance is intentional (an enemy going
// stealth) and must hide at once, so anything nearer than this drops immediately.
// Note the converse: an out-leveled stealther seen at >=70yd now lingers up to
// DESPAWN_GRACE_MS before vanishing — acceptable, since you can only see a
// stealthed unit at that range when far out-leveling it.
const DESPAWN_GRACE_MIN_DIST_SQ = 70 * 70;

function blankEntity(id: number): Entity {
  return {
    id,
    kind: 'mob',
    templateId: '',
    name: '',
    level: 1,
    mendTimer: 0,
    wardTimer: 0,
    rallyTimer: 0,
    warcryTimer: 0,
    petPath: [],
    petPathCooldown: 0,
    castPushbackReduction: 0,
    pos: { x: 0, y: 0, z: 0 },
    prevPos: { x: 0, y: 0, z: 0 },
    facing: 0,
    prevFacing: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    onGround: true,
    jumping: false,
    fallStartY: 0,
    hp: 1,
    maxHp: 1,
    resource: 0,
    maxResource: 0,
    resourceType: null,
    overheadEmoteId: null,
    overheadEmoteUntil: 0,
    overheadEmoteSeq: 0,
    stats: { str: 0, agi: 0, sta: 0, int: 0, spi: 0, armor: 0 },
    weapon: { min: 1, max: 2, speed: 2 },
    attackPower: 0,
    rangedPower: 0,
    spellPower: 0,
    critChance: 0.05,
    dodgeChance: 0.05,
    moveSpeed: 7,
    hostile: false,
    targetId: null,
    autoAttack: false,
    swingTimer: 0,
    inCombat: false,
    combatTimer: 99,
    auras: [],
    stealthed: false,
    ccDr: new Map(),
    castingAbility: null,
    castRemaining: 0,
    castTotal: 0,
    castAim: null,
    channeling: false,
    channelTickTimer: 0,
    channelTickEvery: 0,
    gcdRemaining: 0,
    cooldowns: new Map(),
    queuedOnSwing: null,
    fiveSecondRule: 99,
    comboPoints: 0,
    comboTargetId: null,
    overpowerUntil: -1,
    potionCooldownUntil: -1,
    potionCdRemaining: 0,
    savedMana: 0,
    chargeTargetId: null,
    chargeTimeLeft: 0,
    chargePath: [],
    followTargetId: null,
    sitting: false,
    eating: null,
    drinking: null,
    aiState: 'idle',
    tappedById: null,
    pulseTimer: 0,
    stompTimer: 0,
    stoneskinTimer: 0,
    terrifyTimer: 0,
    detonateTimer: Infinity,
    firedSummons: 0,
    summonedIds: [],
    enraged: false,
    healedThisPull: false,
    threat: new Map(),
    forcedTargetId: null,
    forcedTargetTimer: 0,
    ownerId: null,
    petMode: 'defensive',
    petTauntTimer: 0,
    petAutoTaunt: false,
    petManualTauntPending: false,
    spawnPos: { x: 0, y: 0, z: 0 },
    leashAnchor: null,
    evadeStall: 0,
    fleeTimer: 0,
    fleeReturnTimer: 0,
    hasFled: false,
    wanderTarget: null,
    wanderTimer: 0,
    aggroTargetId: null,
    respawnTimer: 0,
    corpseTimer: 0,
    lootFfaTimer: Infinity,
    lootable: false,
    loot: null,
    xpValue: 0,
    questIds: [],
    vendorItems: [],
    objectItemId: null,
    dungeonId: null,
    dead: false,
    scale: 1,
    color: 0xffffff,
    skinCatalog: 'class',
    skin: 0,
    mainhandItemId: null,
    equippedItems: {},
    guild: '',
  };
}

export class ClientWorld implements IWorld {
  // --- IWorldEntityRoster: roster + player reads, mirrored from snapshots. The
  // `player` getter lives below the ctor (it reads `entities`/`playerId`). `known`
  // is IWorldCombat-owned but rides here as a self-wire mirror field with the rest
  // of the roster data. ---
  cfg: { seed: number; playerClass: PlayerClass };
  entities = new Map<number, Entity>();
  playerId = -1;
  private ownPlayerId = -1;
  private readonly ownPlayerClass: PlayerClass;
  spectating: string | null = null;
  moveInput: MoveInput = emptyMoveInput();
  known: ResolvedAbility[] = [];
  realm = '';
  inventory: InvSlot[] = [];
  vendorBuyback: InvSlot[] = [];
  equipment: Partial<Record<EquipSlot, string>> = {};
  copper = 0;
  // --- IWorldCosmetics: account cosmetics (completed-quest + mech-chroma ids),
  // mirrored from snapshot self. ---
  accountCosmetics: AccountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  // --- IWorldProgressionXp: XP + post-cap progression scalars + unlocked
  // milestones, mirrored from snapshot self. ---
  xp = 0;
  // Post-cap progression (Max-Level XP Overflow), mirrored from snapshot self.
  lifetimeXp = 0;
  prestigeRank = 0;
  // Rested XP pool, mirrored from snapshot self.
  restedXp = 0;
  unlockedMilestones: string[] = [];
  // --- IWorldTalents: talents + spec/role + saved loadouts, mirrored from
  // snapshot self (display + staging). ---
  talents: TalentAllocation = emptyAllocation();
  talentSpec: string | null = null;
  talentRole: Role | null = null;
  loadouts: SavedLoadout[] = [];
  activeLoadout = -1;
  questLog = new Map<string, QuestProgress>();
  questsDone = new Set<string>();
  // --- IWorldParty: party/raid roster, mirrored from the snapshot self (`party`).
  // The raid-target markers ride the `markers` map below; IWorldPet keeps no mirror
  // field (pet state lives on the owned-mob entity wire). ---
  partyInfo: PartyInfo | null = null;
  // --- IWorldTrade: active trade-window state, mirrored from the snapshot self
  // (`s.trade`, delta-omitted). ---
  tradeInfo: TradeInfo | null = null;
  // --- IWorldDuelArena: duel + rated-arena state, mirrored from the snapshot self
  // (`s.duel`/`s.arena`, delta-omitted); the live 2v2 Fiesta view rides
  // arenaInfo.match.fiesta and its dynamics flow over the events queue. ---
  duelInfo: DuelInfo | null = null;
  arenaInfo: ArenaInfo | null = null;
  // --- IWorldSocialGraph: persistent friends/blocks/guild, set ONLY by the
  // `social`/`socialpos` frames (there is no `s.social` snapshot field). ---
  socialInfo: SocialInfo | null = null;
  // --- IWorldMarket: World Market view, mirrored from the snapshot self
  // (`s.market`, delta-omitted). ---
  marketInfo: MarketInfo | null = null;
  // --- IWorldMail: Ravenpost mailbox view + unread badge, mirrored from the
  // snapshot self (`s.mail` / `s.mailU`, delta-omitted). ---
  mailInfo: MailInfo | null = null;
  mailUnread = 0;
  // --- IWorldDelves: active delve run + companion + marks/upgrades + daily, all
  // mirrored from the snapshot self (delta-omitted). lockpickState is the exception:
  // it has NO snapshot field and is rebuilt from the lockpick* events by the private
  // applyLockpickEvent. delveClears is a NON-IWorld mirror behind delveShopOffers. ---
  delveRun: DelveRunInfo | null = null;
  companionState: DelveCompanionInfo | null = null;
  // Lockpicking: rebuilt from the lockpick* events (there is no snapshot field).
  // Holds only the fog-windowed cells the server discloses.
  lockpickState: LockpickView | null = null;
  delveMarks = 0;
  companionUpgrades: Record<string, number> = {};
  // Per-delve clears (key `${delveId}:${tierId}`), mirrored from the self-wire so
  // delveShopOffers can resolve the shop lock badge client-side.
  delveClears: Record<string, number> = {};
  delveDaily: DelveDailyInfo = { date: '', firstClearXp: [], markClears: 0 };
  // --- IWorldParty: raid-target marker mirror, from the self-wire `marks` (markerFor
  // reads it, no send). ---
  markers: Record<number, number> = {}; // entityId -> markerId, mirrored from the self-wire
  private lootRollPrompts: LootRollPrompt[] = []; // open need-greed rolls, mirrored from the self-wire
  // bumped whenever a fresh social snapshot lands, so an open panel re-renders
  private socialDirty = false;
  // snapshot interpolation
  lastSnapAt = 0;
  snapInterval = 50; // ms, adapts to measured cadence
  // entity id -> performance.now() when it first went missing from a snapshot;
  // used for the despawn grace window (anti-flicker), cleared once it returns
  private missingSince = new Map<number, number>();
  // scratch for applySnapshot's per-message "ids present in this snap" set,
  // reused across snapshots (20 Hz) instead of allocating a Set per message
  private wireSeen = new Set<number>();
  // camera follow for keyboard turns applied by the main loop
  pendingFacingDelta = 0;
  connected = false;
  onDisconnect: ((reason: string) => void) | null = null;
  readonly characterId: number;

  private ws: WebSocket;
  private readonly token: string;
  private readonly base: string;
  private readonly clientSeed: string;
  private eventQueue: SimEvent[] = [];
  // inventory deltas arrive in snapshots, separate from the event frames the
  // HUD redraws on — the frame loop polls this so open panels re-render
  private invChanged = false;
  private cosmeticsChanged = false;
  // Soft (cosmetic) profanity terms the server sends in `hello` and pushes via
  // `censor` frames when an admin edits the list. The HUD drains these to mask
  // chat locally when the player's filter is on. Hard words never arrive here.
  profanityWords: string[] = [];
  private profanityDirty = false;
  private pendingQuestCommands = new Map<string, 'accept' | 'turnin'>();
  private mouselookFacing: number | null = null;
  private sendTimer: number | undefined;
  private lastInputSentAt = 0;
  private lastInputSig = '';
  private inputSeq = 0;
  private pendingInputSeqSentAt = new Map<number, number>();
  private ackedInputSeq = 0;
  private inputEchoSamples: number[] = [];
  private spectateFacingPending = false;
  private pendingSpectateFacing: number | null = null;

  constructor(token: string, characterId: number, cls: PlayerClass, base = '', clientSeed = '') {
    this.characterId = characterId;
    this.token = token;
    this.base = normalizeOrigin(base) || NATIVE_API_ORIGIN || DESKTOP_API_ORIGIN;
    this.clientSeed = clientSeed;
    this.ownPlayerClass = cls;
    this.cfg = { seed: 20061, playerClass: cls };
    // when a realm was picked, connect to that realm's origin; otherwise the
    // page's own host
    const wsUrl = this.base
      ? `${this.base.replace(/^http/, 'ws')}/ws`
      : buildWebSocketUrl(location.protocol, location.host);
    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify(buildWebSocketAuthMessage(token, characterId, this.clientSeed)));
    };
    this.ws.onmessage = (ev) => this.onMessage(String(ev.data));
    this.ws.onclose = () => {
      this.connected = false;
      clearInterval(this.sendTimer);
      this.onDisconnect?.('Connection to the server was lost.');
    };
    // input stream at sim rate
    this.sendTimer = window.setInterval(() => this.sendInput(), 50);
  }

  close(): void {
    clearInterval(this.sendTimer);
    this.ws.onclose = null;
    this.ws.close();
  }

  get player(): Entity {
    return this.entities.get(this.playerId) ?? blankEntity(-1);
  }

  drainEvents(): SimEvent[] {
    const out = this.eventQueue;
    this.eventQueue = [];
    return out;
  }

  setMoveInput(input: unknown, facing?: unknown): void {
    Object.assign(this.moveInput, sanitizeMoveInput(input));
    if (arguments.length > 1) this.setMouselookFacing(facing);
  }

  setMouselookFacing(facing: unknown): void {
    this.mouselookFacing = normalizeMoveFacing(facing);
  }

  flushInput(now = performance.now()): boolean {
    return this.sendInput(now, true);
  }

  consumeInputEchoSamples(): number[] {
    const samples = this.inputEchoSamples;
    this.inputEchoSamples = [];
    return samples;
  }

  consumeSpectateFacing(): number | null {
    const facing = this.pendingSpectateFacing;
    this.pendingSpectateFacing = null;
    return facing;
  }

  // -----------------------------------------------------------------------
  // Socket
  // -----------------------------------------------------------------------

  private inputSignature(): string {
    const mi = this.moveInput;
    const facing =
      this.mouselookFacing === null ? '' : Math.round(this.mouselookFacing * 10000).toString();
    return [
      mi.forward ? 1 : 0,
      mi.back ? 1 : 0,
      mi.turnLeft ? 1 : 0,
      mi.turnRight ? 1 : 0,
      mi.strafeLeft ? 1 : 0,
      mi.strafeRight ? 1 : 0,
      mi.jump ? 1 : 0,
      facing,
    ].join(',');
  }

  private sendInput(now = performance.now(), changedOnly = false): boolean {
    if (
      typeof this.spectating === 'string' ||
      !this.connected ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      return false;
    }
    const sig = this.inputSignature();
    if (changedOnly) {
      if (sig === this.lastInputSig) return false;
      if (now - this.lastInputSentAt < 16) return false;
    }
    const mi = this.moveInput;
    const msg: Record<string, unknown> = {
      t: 'input',
      seq: ++this.inputSeq,
      mi: {
        f: mi.forward ? 1 : 0,
        b: mi.back ? 1 : 0,
        tl: mi.turnLeft ? 1 : 0,
        tr: mi.turnRight ? 1 : 0,
        sl: mi.strafeLeft ? 1 : 0,
        sr: mi.strafeRight ? 1 : 0,
        j: mi.jump ? 1 : 0,
      },
    };
    if (this.mouselookFacing !== null) msg.facing = this.mouselookFacing;
    this.ws.send(JSON.stringify(msg));
    this.lastInputSentAt = now;
    this.lastInputSig = sig;
    this.pendingInputSeqSentAt.set(this.inputSeq, now);
    if (this.pendingInputSeqSentAt.size > 120) {
      const stale = this.inputSeq - 120;
      for (const seq of this.pendingInputSeqSentAt.keys()) {
        if (seq <= stale) this.pendingInputSeqSentAt.delete(seq);
      }
    }
    return true;
  }

  private canSendCommand(): boolean {
    return this.connected && this.ws.readyState === WebSocket.OPEN;
  }

  private rawCmd(payload: Record<string, unknown>): void {
    if (!this.canSendCommand()) return;
    this.ws.send(JSON.stringify({ t: 'cmd', ...payload }));
  }

  // Typed IWorld command send (W0b): `cmd` must be a ClientCommand, i.e. a token
  // from the shared COMMAND_NAMES table that is NOT dispatch-only. This is what
  // makes "every ClientWorld send is in the server's dispatch-set" a compile-time
  // guarantee rather than a runtime hope: a send of an unknown or dispatch-only
  // token fails `tsc`. The raw escape hatch (devCmd) stays untyped on purpose.
  private cmd(payload: { cmd: ClientCommand } & Record<string, unknown>): void {
    if (typeof this.spectating === 'string' && payload.cmd !== 'chat') return;
    this.rawCmd(payload);
  }

  /** Raw WS command — used by dev scripts and browser console when online. */
  devCmd(payload: Record<string, unknown>): void {
    this.rawCmd(payload);
  }

  private onMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.t === 'hello') {
      this.playerId = msg.pid;
      this.ownPlayerId = msg.pid;
      this.cfg.seed = msg.seed;
      if (typeof msg.realm === 'string') this.realm = msg.realm;
      if (Array.isArray(msg.softWords)) {
        this.profanityWords = msg.softWords.filter(
          (w: unknown): w is string => typeof w === 'string',
        );
        this.profanityDirty = true;
      }
      this.connected = true;
      return;
    }
    if (msg.t === 'spectate') {
      this.spectating = typeof msg.name === 'string' ? msg.name : null;
      this.spectateFacingPending = true;
      this.pendingSpectateFacing = null;
      this.pendingInputSeqSentAt.clear();
      this.inputEchoSamples = [];
      if (typeof this.spectating !== 'string') {
        this.playerId = this.ownPlayerId;
        this.cfg.playerClass = this.ownPlayerClass;
      }
      Object.assign(this.moveInput, emptyMoveInput());
      this.mouselookFacing = null;
      return;
    }
    if (msg.t === 'censor') {
      // live word-list update pushed after an admin edits the filter
      this.profanityWords = Array.isArray(msg.words)
        ? msg.words.filter((w: unknown): w is string => typeof w === 'string')
        : [];
      this.profanityDirty = true;
      return;
    }
    if (msg.t === 'error') {
      this.connected = false;
      this.onDisconnect?.(msg.error ?? 'rejected by server');
      return;
    }
    if (msg.t === 'events') {
      for (const ev of msg.list) {
        this.applyLockpickEvent(ev as SimEvent);
        this.eventQueue.push(ev as SimEvent);
      }
      return;
    }
    if (msg.t === 'social') {
      this.socialInfo = {
        friends: msg.friends ?? [],
        blocks: msg.blocks ?? [],
        guild: msg.guild ?? null,
      };
      this.socialDirty = true;
      return;
    }
    if (msg.t === 'socialpos') {
      // live position refresh for friends/guildmates (drives the world map);
      // merge into the existing roster in place — snapshots own online/offline.
      if (this.socialInfo && Array.isArray(msg.list)) {
        const byId = new Map<
          number,
          { x: number; z: number; zone: string; status: PresenceStatus }
        >();
        for (const e of msg.list) byId.set(e.id, e);
        const apply = (arr: FriendInfo[]) => {
          for (const m of arr) {
            const u = byId.get(m.id);
            if (u) {
              m.x = u.x;
              m.z = u.z;
              m.zone = u.zone;
              m.status = u.status;
              m.online = true;
            }
          }
        };
        apply(this.socialInfo.friends);
        if (this.socialInfo.guild) apply(this.socialInfo.guild.members);
      }
      return;
    }
    if (msg.t === 'challenge') {
      // Server-presented challenge: solve it and return the answer signed with
      // this client's seed so the answer is bound to us. WIP not yet interactive.
      if (typeof msg.nonce === 'string' && typeof msg.challenge === 'string') {
        const challengeResponse = '42';
        const signature = signChallenge(msg.nonce, challengeResponse, this.clientSeed);
        this.cmd({ cmd: 'challengeResponse', n: msg.nonce, r: challengeResponse, sig: signature });
      }
      return;
    }
    if (msg.t === 'snap') {
      this.applySnapshot(msg);
    }
  }

  consumeSocialChanged(): boolean {
    const v = this.socialDirty;
    this.socialDirty = false;
    return v;
  }

  consumeProfanityChanged(): boolean {
    const v = this.profanityDirty;
    this.profanityDirty = false;
    return v;
  }

  private applySnapshot(snap: any): void {
    const now = performance.now();
    if (typeof this.spectating === 'string' && typeof snap.self?.id === 'number') {
      this.playerId = snap.self.id;
    }
    // the interpolation alpha the render loop reached on its last frame
    // (same formula and caps as main.ts); used below to re-anchor the new
    // interpolation segment at the pose currently on screen
    const contAlpha =
      this.lastSnapAt > 0
        ? Math.min(1.25, (now - this.lastSnapAt) / Math.max(20, this.snapInterval))
        : 1;
    if (this.lastSnapAt > 0) {
      const gap = now - this.lastSnapAt;
      if (gap > 5 && gap < 500) this.snapInterval = this.snapInterval * 0.9 + gap * 0.1;
    }
    this.lastSnapAt = now;

    // lazy init (not the field initializer alone): tests build bare instances
    // via Object.create(ClientWorld.prototype), which skips field initializers
    if (this.wireSeen === undefined) this.wireSeen = new Set();
    const seen = this.wireSeen;
    seen.clear();
    const prevSelf = this.entities.get(this.playerId);
    const prevSelfFacing = prevSelf?.facing;
    const prevSelfDead = prevSelf?.dead ?? false;

    const applyWire = (w: any): Entity | null => {
      let e = this.entities.get(w.id);
      // identity fields ride only in "full" records: first sight and changes
      const hasIdentity = w.k !== undefined;
      if (!e) {
        // a lite record for an entity we never met would render as a
        // half-initialized ghost; skip it (the server sends identity first)
        if (!hasIdentity) return null;
        e = blankEntity(w.id);
        e.pos = { x: w.x, y: w.y, z: w.z };
        copyPos(e.prevPos, e.pos);
        e.facing = w.f;
        e.prevFacing = w.f;
        this.entities.set(w.id, e);
      }
      if (hasIdentity) {
        e.kind = w.k;
        e.templateId = w.tid;
        e.name = w.nm;
        e.level = w.lv;
        e.skin = w.sk ?? 0;
        e.mainhandItemId = w.mh ?? null; // equipped mainhand → held weapon model (render-only)
        e.equippedItems = w.eq ?? {}; // full worn set (render-only), for the inspect window
        e.skinCatalog = w.cat === 'mech' ? 'mech' : 'class';
        e.holderTier = w.ht ?? 0; // $WOC holder-tier flair (cosmetic, server-set)
        e.holderBalance = typeof w.hb === 'number' ? w.hb : undefined; // exact $WOC, for inspect
        e.discordTier = w.dt ?? 0; // Discord status-tier flair (cosmetic, server-set)
        e.discordAvatar = typeof w.dav === 'string' ? w.dav : undefined; // Discord PFP (linked)
        e.discordName = typeof w.dnm === 'string' ? w.dnm : undefined; // Discord handle/nickname
        e.discordJoined = typeof w.dj === 'number' ? w.dj : undefined; // Discord join epoch ms
        e.discordRole = typeof w.dr === 'string' ? w.dr : undefined; // top staff/special role key
        e.devTier = w.dvt ?? 0; // developer-badge tier (cosmetic, server-set)
        e.devMergedPrs = typeof w.dvc === 'number' ? w.dvc : undefined; // merged-PR count
        e.githubLogin = typeof w.dgl === 'string' ? w.dgl : undefined; // GitHub login
        e.scale = w.sc ?? 1;
        e.color = w.c ?? 0xffffff;
        e.dungeonId = w.dgn ?? null;
        e.objectItemId = w.obj ?? null;
        e.guild = w.gd ?? '';
        if (e.kind === 'npc') {
          const def = NPCS[e.templateId];
          e.questIds = def ? [...def.questIds] : [];
          e.vendorItems = def?.vendorItems ? [...def.vendorItems] : [];
        }
      }
      // interpolation bases: re-anchor at the pose the renderer last drew,
      // not at the previous server pose — when a frame extrapolated past the
      // last update, restarting from the server pose snapped entities
      // backwards every snapshot (visible rubber-banding while running).
      // Non-self entities are drawn on their per-entity clock (renderer.sync),
      // so the continuation alpha comes from that same clock; self stays on
      // the global snapshot clock the camera follow uses.
      const prevUpdatedAt = e.netUpdatedAt;
      const prevInterval = e.netInterval;
      const entAlpha =
        w.id !== this.playerId && prevUpdatedAt !== undefined && prevInterval !== undefined
          ? Math.min(1.25, (now - prevUpdatedAt) / Math.max(20, prevInterval))
          : contAlpha;
      const entFacingAlpha = Math.min(1, entAlpha);
      // per-entity update clock: distant entities are sent below snapshot
      // rate, so each one interpolates over its own measured cadence. Only
      // gaps within the slowest legitimate cadence count — records also
      // pause while an entity's state is unchanged, and folding an idle
      // period into the estimate would smear its next steps in slow motion
      if (prevUpdatedAt !== undefined) {
        const gap = now - prevUpdatedAt;
        if (gap > 5 && gap < 450) {
          e.netInterval = prevInterval === undefined ? gap : prevInterval * 0.7 + gap * 0.3;
        }
      }
      e.netUpdatedAt = now;
      // A teleport (arena pit, dungeon portal, graveyard release) jumps an
      // entity far further than any single walking update could. Interpolating
      // across that gap streaks it across the map — and when its per-entity
      // interpolation clock isn't established yet, the renderer falls back to
      // the global alpha and the entity sticks at its old pose until its next
      // real update (e.g. taking damage). Snap both poses to the destination so
      // it appears exactly where the server placed it.
      const teleDx = w.x - e.pos.x,
        teleDz = w.z - e.pos.z;
      const wasDead = e.dead;
      const nowDead = !!w.dead;
      if ((wasDead && !nowDead) || teleDx * teleDx + teleDz * teleDz > TELEPORT_SNAP_DIST_SQ) {
        e.prevPos = { x: w.x, y: w.y, z: w.z };
        e.prevFacing = w.f;
      } else {
        e.prevPos = {
          x: e.prevPos.x + (e.pos.x - e.prevPos.x) * entAlpha,
          y: e.prevPos.y + (e.pos.y - e.prevPos.y) * entAlpha,
          z: e.prevPos.z + (e.pos.z - e.prevPos.z) * entAlpha,
        };
        e.prevFacing = e.prevFacing + wrapAngle(e.facing - e.prevFacing) * entFacingAlpha;
      }
      e.pos.x = w.x;
      e.pos.y = w.y;
      e.pos.z = w.z;
      e.facing = w.f;
      e.hp = w.hp;
      e.maxHp = w.mhp;
      e.rangedPower = w.rp ?? 0;
      e.overheadEmoteId = isOverheadEmoteId(w.emo) ? w.emo : null;
      e.overheadEmoteUntil = e.overheadEmoteId ? Number.POSITIVE_INFINITY : 0;
      if (typeof w.emoSeq === 'number') e.overheadEmoteSeq = w.emoSeq;
      e.dead = nowDead;
      e.lootable = !!w.loot;
      e.hostile = !!w.h;
      e.castingAbility = w.cast ?? null;
      e.castRemaining = w.castRem ?? 0;
      e.castTotal = w.castTot ?? 0;
      e.channeling = !!w.chan;
      e.sitting = !!w.sit;
      e.aggroTargetId = w.aggro ?? null;
      e.tappedById = w.tap ?? null;
      e.ownerId = w.own ?? null;
      e.petMode = w.pm ?? 'defensive';
      e.petTauntTimer = w.pt ?? 0;
      e.petAutoTaunt = !!w.pa;
      e.petManualTauntPending = false;
      // same semantics as `new Map(w.thr ?? [])` (absent thr = empty table), but
      // updates the existing Map in place: no per-entity Map churn at 20 Hz
      e.threat.clear();
      if (w.thr) for (const [tid, tv] of w.thr as [number, number][]) e.threat.set(tid, tv);
      // The wire carries the aura magnitude (and imbue range / tick cadence / school) so buff
      // and debuff hover tooltips show the real numbers online exactly as offline (aura_effect
      // reads these). A 0/absent value decodes to 0 (value-less auras and an old server are
      // unchanged), a missing school falls back to the physical default, and imbue range /
      // tick cadence stay undefined when not sent. sourceId stays simplified (a separate
      // pre-existing wire reduction, not read by the tooltip).
      //
      // Between snapshots the aura SET is usually unchanged (only `rem` ticks down), so when
      // the incoming ids line up index-for-index with the existing records, update those
      // records in place: no array + per-aura object allocation per entity at 20 Hz, and the
      // preserved object identity matches the offline Sim (one live aura object across ticks).
      // Any composition change (gain/fade/reorder) falls back to the fresh build below.
      const wireAuras: any[] = w.auras ?? [];
      let sameAuraShape = e.auras.length === wireAuras.length;
      if (sameAuraShape) {
        for (let i = 0; i < wireAuras.length; i++) {
          if (e.auras[i].id !== wireAuras[i].id) {
            sameAuraShape = false;
            break;
          }
        }
      }
      if (sameAuraShape) {
        for (let i = 0; i < wireAuras.length; i++) {
          const a = wireAuras[i];
          const rec = e.auras[i];
          rec.name = a.name;
          rec.kind = a.kind;
          rec.remaining = a.rem;
          rec.duration = a.dur;
          rec.value = a.value ?? 0;
          rec.value2 = a.value2;
          rec.value3 = a.value3;
          rec.tickInterval = a.tickInterval;
          rec.school = a.school ?? 'physical';
          rec.stacks = a.stacks;
          // Mirror the charge count for a charge-limited aura (Lightning Shield); the wire
          // sends it only when defined (server/game.ts), so an ordinary aura or an old server
          // decodes to undefined and the badge falls back to the stacks path, exactly as before.
          rec.charges = a.charges;
        }
      } else {
        e.auras = wireAuras.map((a: any) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          remaining: a.rem,
          duration: a.dur,
          value: a.value ?? 0,
          value2: a.value2,
          value3: a.value3,
          tickInterval: a.tickInterval,
          sourceId: 0,
          school: a.school ?? 'physical',
          stacks: a.stacks,
          charges: a.charges,
        }));
      }
      e.loot = w.lootList ?? null;
      return e;
    };

    for (const w of snap.ents) {
      if (applyWire(w) !== null) seen.add(w.id);
    }
    // entities listed in keep are alive but unchanged (or not due an update
    // at their distance tier this snapshot) — just protect them from pruning
    for (const id of snap.keep ?? []) {
      seen.add(id);
    }

    // self with extended state (always a full record)
    const s = snap.self;
    const e = s ? applyWire(s) : null;
    if (s && e) {
      if (typeof this.spectating === 'string' && e.kind === 'player' && e.templateId in CLASSES) {
        this.cfg.playerClass = e.templateId as PlayerClass;
      }
      if (this.spectateFacingPending) {
        this.pendingSpectateFacing = e.facing;
        this.spectateFacingPending = false;
      } else if (typeof this.spectating === 'string' && prevSelf && prevSelfDead && !e.dead) {
        this.pendingSpectateFacing = e.facing;
      }
      seen.add(s.id);
      if (typeof s.ack === 'number' && s.ack > this.ackedInputSeq) {
        for (let seq = this.ackedInputSeq + 1; seq <= s.ack; seq++) {
          const sentAt = this.pendingInputSeqSentAt.get(seq);
          if (sentAt !== undefined) {
            this.inputEchoSamples.push(now - sentAt);
            this.pendingInputSeqSentAt.delete(seq);
          }
        }
        this.ackedInputSeq = s.ack;
      }
      e.resource = s.res;
      e.maxResource = s.mres;
      e.resourceType = s.rtype;
      // delta fields: the server omits them while unchanged, so only the
      // snapshots that carry them rebuild the local structures
      if (s.cds !== undefined) {
        // in-place rebuild (same result as `new Map(Object.entries(...))`): no
        // intermediate entry arrays and no Map churn on the 20 Hz self record
        e.cooldowns.clear();
        for (const k in s.cds) e.cooldowns.set(k, Number(s.cds[k]));
      }
      e.gcdRemaining = s.gcd ?? 0;
      e.potionCdRemaining = s.pcd ?? 0;
      e.comboPoints = s.combo ?? 0;
      e.comboTargetId = s.comboTgt ?? null;
      e.targetId = s.target ?? null;
      e.autoAttack = !!s.auto;
      e.swingTimer = s.swing ?? e.swingTimer;
      e.queuedOnSwing = s.queued ?? null;
      e.stats = s.stats ?? e.stats;
      e.attackPower = s.ap ?? 0;
      e.rangedPower = s.rp ?? 0;
      e.spellPower = s.sp ?? 0;
      e.critChance = s.crit ?? 0.05;
      e.dodgeChance = s.dodge ?? 0.05;
      e.weapon = s.weapon ?? e.weapon;
      e.eating = s.eat
        ? { itemId: '', kind: 'food', hpPer2s: 0, manaPer2s: 0, remaining: s.eat.remaining }
        : null;
      e.drinking = s.drk
        ? { itemId: '', kind: 'drink', hpPer2s: 0, manaPer2s: 0, remaining: s.drk.remaining }
        : null;
      // IWorldProgressionXp facet (W7) self-decode: xp/lxp/rxp/prk ride every
      // self-frame (?? 0); milestones is delta-guarded (omitted keeps the prior
      // mirror). Terse keys (lxp->lifetimeXp, rxp->restedXp, prk->prestigeRank,
      // milestones->unlockedMilestones) are unchanged by the re-group.
      this.xp = s.xp ?? 0;
      this.lifetimeXp = s.lxp ?? 0;
      this.restedXp = s.rxp ?? 0;
      this.prestigeRank = s.prk ?? 0;
      if (s.milestones !== undefined) this.unlockedMilestones = s.milestones;
      // IWorldInventory facet (W2) self-decode: copper rides every self-frame (?? 0);
      // inv/buyback/equip are delta-guarded (a missing field keeps the prior mirror).
      // Terse keys (inv/buyback/equip/copper) and the per-field guards are unchanged by
      // the move; the offline counterpart is src/sim/items.ts.
      this.copper = s.copper ?? 0;
      if (s.inv !== undefined) {
        this.inventory = s.inv;
        this.invChanged = true;
      }
      if (s.buyback !== undefined) {
        this.vendorBuyback = s.buyback;
        this.invChanged = true;
      }
      if (s.equip !== undefined) this.equipment = s.equip;
      // IWorldCosmetics facet (W7) self-decode: cosmetics is delta-guarded (a
      // missing field keeps the prior mirror); normalizeAccountCosmetics rebuilds it.
      if (s.cosmetics !== undefined) {
        this.accountCosmetics = normalizeAccountCosmetics(s.cosmetics);
        this.cosmeticsChanged = true;
      }
      if (s.qlog !== undefined)
        this.questLog = new Map((s.qlog as QuestProgress[]).map((q) => [q.questId, q]));
      if (s.qdone !== undefined) this.questsDone = new Set(s.qdone);
      if (s.lockouts !== undefined) this.selfLockouts = s.lockouts as Record<string, number>;
      if (s.qlog !== undefined || s.qdone !== undefined) this.pendingQuestCommands?.clear();
      // IWorldTalents facet (W7) self-decode: tal is delta-guarded (omitted keeps
      // the prior mirror); the known rebuild below is display-only (re-renders what
      // the server already decided), not client authority.
      // talent state (heavy field, sent on change): mirror it, then resolve known
      // with the precomputed modifiers so granted abilities + tweaks show locally.
      if (s.tal !== undefined && s.tal) {
        this.talents = s.tal.alloc ?? emptyAllocation();
        this.talentSpec = s.tal.spec ?? null;
        this.talentRole = s.tal.role ?? null;
        this.loadouts = s.tal.loadouts ?? [];
        this.activeLoadout = typeof s.tal.activeLoadout === 'number' ? s.tal.activeLoadout : -1;
      }
      if (!this.talents) this.talents = emptyAllocation();
      const talents = this.talents;
      this.known = abilitiesKnownAt(
        this.cfg.playerClass,
        e.level,
        computeTalentModifiers(this.cfg.playerClass, talents),
      );
      // --- IWorldParty: party roster + raid markers, delta-omitted self-decode
      // (keep the prior value when absent; `marks: null` clears on disband). ---
      if (s.party !== undefined) this.partyInfo = s.party;
      if (s.marks !== undefined) this.markers = s.marks ?? {}; // null = cleared (no party/disband)
      // --- IWorldTrade / IWorldDuelArena: trade/duel/arena delta self-decode
      // (W0a-covered; keep the prior mirror value when the field is omitted).
      // IWorldSocialGraph.socialInfo has NO snapshot key - it is set only by the
      // social/socialpos frames. ---
      if (s.trade !== undefined) this.tradeInfo = s.trade;
      if (s.duel !== undefined) this.duelInfo = s.duel;
      if (s.arena !== undefined) this.arenaInfo = s.arena;
      if (s.market !== undefined) this.marketInfo = s.market;
      if (s.mail !== undefined) this.mailInfo = s.mail;
      if (s.mailU !== undefined) this.mailUnread = s.mailU ?? 0;
      if (s.lroll !== undefined) this.lootRollPrompts = s.lroll ?? [];
      if (s.drun !== undefined) this.delveRun = s.drun;
      if (s.dcompanion !== undefined) this.companionState = s.dcompanion;
      if (s.dmarks !== undefined) this.delveMarks = s.dmarks ?? 0;
      if (s.dcomp !== undefined) this.companionUpgrades = s.dcomp ?? {};
      if (s.dclears !== undefined) this.delveClears = s.dclears ?? {};
      if (s.delveDaily !== undefined) this.delveDaily = s.delveDaily;
      // camera follows server-side facing changes when not mouselooking
      if (prevSelfFacing !== undefined && this.mouselookFacing === null) {
        let d = e.facing - prevSelfFacing;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        this.pendingFacingDelta += d;
      }
    }

    // prune entities that left our interest area. An entity briefly absent from
    // a single snapshot (interest-boundary churn, a late/dropped frame) is held
    // at its last pose for a short grace window rather than deleted outright, so
    // the entity map doesn't churn delete/re-create across the boundary. The
    // grace applies only near/beyond the interest boundary; a close-range
    // disappearance (an enemy going stealth) still hides immediately.
    // (A `keep`-listed entity counts as seen above, so its timer is cleared.)
    const self = this.entities.get(this.playerId);
    const missingSince = this.missingSince;
    for (const [id, e] of this.entities) {
      if (id === this.playerId) continue;
      // Keep the moderator's last own-self record while a different player is
      // presented as self. The spectate-clear frame can then restore the original
      // identity immediately instead of exposing a blank entity before the next
      // server snapshot arrives.
      if (typeof this.spectating === 'string' && id === this.ownPlayerId) {
        missingSince.delete(id);
        continue;
      }
      if (seen.has(id)) {
        missingSince.delete(id);
        continue;
      }
      const dx = self ? e.pos.x - self.pos.x : 0;
      const dz = self ? e.pos.z - self.pos.z : 0;
      if (dx * dx + dz * dz < DESPAWN_GRACE_MIN_DIST_SQ) {
        this.entities.delete(id);
        missingSince.delete(id);
        continue;
      }
      const since = missingSince.get(id);
      if (since === undefined) {
        missingSince.set(id, now);
      } else if (now - since >= DESPAWN_GRACE_MS) {
        this.entities.delete(id);
        missingSince.delete(id);
      }
    }
  }

  // -----------------------------------------------------------------------
  // IWorld commands -> network
  // -----------------------------------------------------------------------

  questState(questId: string): QuestState {
    const state = computeQuestState(questId, this.questLog, this.questsDone, this.player.level);
    const pending = this.pendingQuestCommands?.get(questId);
    if (
      (pending === 'accept' && state === 'available') ||
      (pending === 'turnin' && state === 'ready')
    ) {
      return 'active';
    }
    return state;
  }

  consumeInventoryChanged(): boolean {
    const v = this.invChanged;
    this.invChanged = false;
    return v;
  }

  consumeCosmeticsChanged(): boolean {
    const v = this.cosmeticsChanged;
    this.cosmeticsChanged = false;
    return v;
  }

  // Refuse a hostile-target cast at an already-dead target: near-monotonic +
  // locally authoritative state, so it only drops casts the server would reject
  // anyway. The exception is a same-id revive (graveyard release, Fiesta respawn)
  // that flips a known-dead target back to alive without clearing attackers'
  // targetId — there the client can drop one hostile cast for a snapshot+RTT and
  // self-heals on the next GCD. (Mob respawn clears attackers' targetId, so it
  // has no such window.)
  private deadTargetCast(def: ResolvedAbility['def'] | undefined): boolean {
    if (!def?.requiresTarget || def.targetType === 'friendly') return false;
    const tid = this.player.targetId;
    const target = tid !== null ? this.entities.get(tid) : undefined;
    return !!target && target.dead;
  }

  // --- IWorldCombat: ability casts, auto-attack, spirit release ---
  castAbility(abilityId: string): void {
    if (this.deadTargetCast(this.known.find((k) => k.def.id === abilityId)?.def)) {
      this.eventQueue.push({ type: 'error', text: 'You have no target.', reason: 'target_dead' });
      return;
    }
    this.cmd({ cmd: 'cast', ability: abilityId });
  }
  castAbilityBySlot(slot: number): void {
    if (this.deadTargetCast(this.known[slot]?.def)) {
      this.eventQueue.push({ type: 'error', text: 'You have no target.', reason: 'target_dead' });
      return;
    }
    this.cmd({ cmd: 'castSlot', slot });
  }
  castAbilityAt(abilityId: string, aim: { x: number; z: number }): void {
    // Ground-targeted: no entity target involved, so no dead-target guard.
    this.cmd({ cmd: 'castAt', ability: abilityId, x: aim.x, z: aim.z });
  }
  cancelAura(auraId: string): void {
    // Authoritative on the server; the dropped aura disappears on the next self
    // snapshot. No optimistic local removal (stat recalc is server-owned).
    this.cmd({ cmd: 'cancel_aura', aura: auraId });
  }
  startAutoAttack(): void {
    this.cmd({ cmd: 'attack' });
  }
  stopAutoAttack(): void {
    this.cmd({ cmd: 'stopattack' });
  }
  releaseSpirit(): void {
    this.cmd({ cmd: 'release' });
  }

  // --- IWorldTargeting: target selection + tab cycling ---
  targetEntity(id: number | null): void {
    // optimistic local update for snappy UI
    const p = this.entities.get(this.playerId);
    if (p) {
      if (id === null) p.targetId = null;
      else {
        const e = this.entities.get(id);
        if (e && (!e.dead || deadTargetSelectable(e, this.playerId))) p.targetId = id;
      }
    }
    this.cmd({ cmd: 'target', id });
  }
  tabTarget(): void {
    this.cmd({ cmd: 'tab' });
  }
  targetNearestFriendly(): void {
    this.cmd({ cmd: 'targetNearestFriendly' });
  }
  friendlyTabTarget(): void {
    this.cmd({ cmd: 'tabFriendly' });
  }

  // --- IWorldTelemetry: fire-and-forget metrics sink ---
  reportTelemetry(kind: string, data: Record<string, number>): void {
    if (!this.canSendCommand()) return;
    this.cmd({ cmd: 'telemetry', kind, ...data });
  }
  interact(): void {
    this.cmd({ cmd: 'interact' });
  }
  lootCorpse(id: number): void {
    this.cmd({ cmd: 'loot', id });
  }
  // --- IWorldLoot: need-greed roll submit + HUD reconcile read ---
  submitLootRoll(rollId: number, choice: LootRollChoice): void {
    this.cmd({ cmd: 'lootRoll', rollId, choice });
  }
  activeLootRolls(): LootRollPrompt[] {
    return this.lootRollPrompts;
  }
  pickUpObject(id: number): void {
    this.cmd({ cmd: 'pickup', id });
  }
  acceptQuest(questId: string): void {
    if (!this.canSendCommand()) return;
    this.pendingQuestCommands.set(questId, 'accept');
    this.cmd({ cmd: 'accept', quest: questId });
  }
  turnInQuest(questId: string): void {
    if (!this.canSendCommand()) return;
    this.pendingQuestCommands.set(questId, 'turnin');
    this.cmd({ cmd: 'turnin', quest: questId });
  }
  abandonQuest(questId: string): void {
    if (!this.canSendCommand()) return;
    this.questLog.delete(questId);
    this.pendingQuestCommands.delete(questId);
    this.cmd({ cmd: 'abandon', quest: questId });
  }
  acceptLinkedQuest(questId: string, fromPid: number): void {
    this.cmd({ cmd: 'qlinkaccept', quest: questId, from: fromPid });
  }
  // IWorldInventory facet (W2): the eight item/vendor command senders. Each is a thin
  // cmd() emit whose offline counterpart is the moved src/sim/items.ts body resolved on
  // the server. The move changes no wire field or command string.
  equipItem(itemId: string): void {
    this.cmd({ cmd: 'equip', item: itemId });
  }
  unequipItem(slot: EquipSlot): void {
    this.cmd({ cmd: 'unequip_item', slot });
  }
  useItem(itemId: string): void {
    this.cmd({ cmd: 'use', item: itemId });
  }
  discardItem(itemId: string, count?: number): void {
    this.cmd({ cmd: 'discard', item: itemId, count });
  }
  buyItem(npcId: number, itemId: string): void {
    this.cmd({ cmd: 'buy', npc: npcId, item: itemId });
  }
  sellItem(itemId: string, count?: number): void {
    this.cmd({ cmd: 'sell', item: itemId, count });
  }
  sellAllJunk(): void {
    this.cmd({ cmd: 'sell_all_junk' });
  }
  buyBackItem(itemId: string): void {
    this.cmd({ cmd: 'buyback', item: itemId });
  }
  // --- IWorldCosmetics: skin + mech-chroma equips. Optimistic local nudge, then
  // the snake_case cmd (change_skin/claim_event_skin/unequip_mech_chroma); the
  // server re-validates and the self-snapshot reconciles. ---
  changeSkin(skin: number, catalog: 'class' | 'mech' = 'class'): void {
    const idx =
      catalog === 'mech'
        ? Math.max(0, Math.floor(skin))
        : Math.max(0, Math.min(7, Math.floor(skin)));
    const p = this.entities.get(this.playerId);
    if (p) {
      p.skin = idx;
      p.skinCatalog = catalog;
    }
    this.cmd({ cmd: 'change_skin', skin: idx, catalog });
  }
  claimEventSkin(skin: number): void {
    const idx = Math.max(0, Math.floor(skin));
    this.cmd({ cmd: 'claim_event_skin', skin: idx });
  }
  unequipMechChroma(chromaId: string): void {
    const itemId = mechChromaItemId(chromaId);
    const skin = mechChromaSkinIndex(chromaId);
    if (itemId && skin >= 0 && this.accountCosmetics.mechChromaIds.includes(chromaId)) {
      this.accountCosmetics = {
        ...this.accountCosmetics,
        mechChromaIds: this.accountCosmetics.mechChromaIds.filter((id) => id !== chromaId),
      };
      const current = this.entities.get(this.playerId);
      if (current?.skinCatalog === 'mech' && current.skin === skin) {
        current.skin = 0;
        current.skinCatalog = 'class';
      }
      const existing = this.inventory.find((slot) => slot.itemId === itemId);
      this.inventory = existing
        ? this.inventory.map((slot) =>
            slot.itemId === itemId ? { ...slot, count: slot.count + 1 } : slot,
          )
        : [...this.inventory, { itemId, count: 1 }];
      this.invChanged = true;
      this.cosmeticsChanged = true;
    }
    this.cmd({ cmd: 'unequip_mech_chroma', chroma: chromaId });
  }
  chat(text: string): void {
    this.cmd({ cmd: 'chat', text });
  }
  playEmote(emoteId: OverheadEmoteId): void {
    if (!this.player.dead) {
      this.player.overheadEmoteId = emoteId;
      this.player.overheadEmoteUntil = Number.POSITIVE_INFINITY;
      this.player.overheadEmoteSeq += 1;
    }
    this.cmd({ cmd: 'emote', emote: emoteId });
  }
  // --- IWorldPet: hunter-pet commands (snake_case wire; pet state mirrors on the
  // owned-mob entity wire, not the self frame). setPetAutoTaunt nudges the owned mob
  // locally before the send (sanctioned trivial-UI optimism), re-confirmed next frame. ---
  abandonPet(): void {
    this.cmd({ cmd: 'pet_abandon' });
  }
  renamePet(name: string): void {
    this.cmd({ cmd: 'pet_rename', name });
  }
  revivePet(): void {
    this.cmd({ cmd: 'pet_revive' });
  }
  petAttack(): void {
    this.cmd({ cmd: 'pet_attack' });
  }
  petTaunt(): void {
    this.cmd({ cmd: 'pet_taunt' });
  }
  setPetAutoTaunt(enabled: boolean): void {
    for (const e of this.entities.values()) {
      if (e.kind === 'mob' && e.ownerId === this.playerId) {
        e.petAutoTaunt = enabled;
        break;
      }
    }
    this.cmd({ cmd: 'pet_auto_taunt', enabled });
  }
  feedPet(itemId: string): void {
    this.cmd({ cmd: 'pet_feed', item: itemId });
  }
  healPet(): void {
    this.cmd({ cmd: 'pet_heal' });
  }
  setPetMode(mode: 'passive' | 'defensive' | 'aggressive'): void {
    this.cmd({ cmd: 'pet_mode', mode });
  }
  // --- IWorldParty: party/raid commands + raid-target markers (terse wire strings;
  // markers belong to IWorldParty, not IWorldTargeting; markerFor is a mirrored-state
  // read, no send). ---
  // social systems
  partyInvite(targetPid: number): void {
    this.cmd({ cmd: 'pinvite', id: targetPid });
  }
  partyAccept(): void {
    this.cmd({ cmd: 'paccept' });
  }
  partyDecline(): void {
    this.cmd({ cmd: 'pdecline' });
  }
  partyLeave(): void {
    this.cmd({ cmd: 'pleave' });
  }
  partyKick(targetPid: number): void {
    this.cmd({ cmd: 'pkick', id: targetPid });
  }
  partyPromote(targetPid: number): void {
    this.cmd({ cmd: 'ppromote', id: targetPid });
  }
  convertPartyToRaid(): void {
    this.cmd({ cmd: 'praid' });
  }
  convertRaidToParty(): void {
    this.cmd({ cmd: 'punraid' });
  }
  moveRaidMember(targetPid: number, group: 1 | 2): void {
    this.cmd({ cmd: 'pmoveRaid', id: targetPid, group });
  }
  setPartyLootMaster(enabled: boolean, looter: number, threshold: MasterLootThreshold): void {
    this.cmd({ cmd: 'setLootMaster', enabled, looter, threshold });
  }
  assignMasterLoot(rollId: number, targetPids: number[]): void {
    this.cmd({ cmd: 'masterAssign', rollId, pids: targetPids });
  }
  // raid/target markers
  markerFor(entityId: number): number | null {
    return this.markers[entityId] ?? null;
  }
  setMarker(entityId: number, markerId: number): void {
    this.cmd({ cmd: 'setMarker', id: entityId, marker: markerId });
  }
  clearMarker(entityId: number): void {
    this.cmd({ cmd: 'clearMarker', id: entityId });
  }
  // --- IWorldTrade: trade-window command sends (tradeInfo is a snapshot read). ---
  tradeRequest(targetPid: number): void {
    this.cmd({ cmd: 'trade_req', id: targetPid });
  }
  tradeAccept(): void {
    this.cmd({ cmd: 'trade_accept' });
  }
  tradeSetOffer(items: InvSlot[], copper: number): void {
    this.cmd({ cmd: 'trade_offer', items, copper });
  }
  tradeConfirm(): void {
    this.cmd({ cmd: 'trade_confirm' });
  }
  tradeCancel(): void {
    this.cmd({ cmd: 'trade_cancel' });
  }
  // --- IWorldDuelArena: duel + rated-arena-queue + 2v2 Fiesta augment-pick sends
  // (duelInfo/arenaInfo are snapshot reads; fiesta dynamics ride the events queue). ---
  duelRequest(targetPid: number): void {
    this.cmd({ cmd: 'duel_req', id: targetPid });
  }
  duelAccept(): void {
    this.cmd({ cmd: 'duel_accept' });
  }
  duelDecline(): void {
    this.cmd({ cmd: 'duel_decline' });
  }
  arenaQueueJoin(format?: import('../world_api').ArenaFormat): void {
    this.cmd({ cmd: 'arena_queue', format: format ?? '1v1' });
  }
  arenaQueueLeave(): void {
    this.cmd({ cmd: 'arena_leave' });
  }
  arenaAugmentPick(augmentId: string): void {
    this.cmd({ cmd: 'arena_augment', augment: augmentId });
  }
  // --- IWorldSocialGraph: persistent social command sends (resolved server-side by
  // character name) + the REST character typeahead. socialInfo arrives via the
  // social/socialpos frames; searchCharacters is a GET, not a cmd(). ---
  friendAdd(name: string): void {
    this.cmd({ cmd: 'friend_add', name });
  }
  friendRemove(name: string): void {
    this.cmd({ cmd: 'friend_remove', name });
  }
  blockAdd(name: string): void {
    this.cmd({ cmd: 'block_add', name });
  }
  blockRemove(name: string): void {
    this.cmd({ cmd: 'block_remove', name });
  }
  guildCreate(name: string): void {
    this.cmd({ cmd: 'guild_create', name });
  }
  guildInvite(name: string): void {
    this.cmd({ cmd: 'guild_invite', name });
  }
  guildAccept(): void {
    this.cmd({ cmd: 'guild_accept' });
  }
  guildDecline(): void {
    this.cmd({ cmd: 'guild_decline' });
  }
  guildLeave(): void {
    this.cmd({ cmd: 'guild_leave' });
  }
  guildKick(name: string): void {
    this.cmd({ cmd: 'guild_kick', name });
  }
  guildPromote(name: string): void {
    this.cmd({ cmd: 'guild_promote', name });
  }
  guildDemote(name: string): void {
    this.cmd({ cmd: 'guild_demote', name });
  }
  guildTransfer(name: string): void {
    this.cmd({ cmd: 'guild_transfer', name });
  }
  guildDisband(): void {
    this.cmd({ cmd: 'guild_disband' });
  }
  async searchCharacters(query: string): Promise<CharacterSearchResult[]> {
    const q = query.trim();
    if (!q) return [];
    try {
      const res = await fetch(apiUrl(`/api/search?q=${encodeURIComponent(q)}`, this.base), {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) return [];
      return (await res.json()).results ?? [];
    } catch {
      return [];
    }
  }
  // --- IWorldMarket: World Market browse/list/buy/cancel/collect command sends
  // (snake_case wire strings). marketInfo is a snapshot read (mirror field above). ---
  marketSearch(query: MarketQuery): void {
    this.cmd({
      cmd: 'market_search',
      q: query.search,
      itemType: query.itemType,
      subtype: query.subtype,
      rarity: query.rarity,
      page: query.page,
    });
  }
  marketList(itemId: string, count: number, price: number): void {
    this.cmd({ cmd: 'market_list', item: itemId, count, price });
  }
  marketBuy(listingId: number): void {
    this.cmd({ cmd: 'market_buy', id: listingId });
  }
  marketCancel(listingId: number): void {
    this.cmd({ cmd: 'market_cancel', id: listingId });
  }
  marketCollect(): void {
    this.cmd({ cmd: 'market_collect' });
  }
  // --- IWorldMail: Ravenpost letter sends (snake_case wire strings). mailInfo /
  // mailUnread are snapshot reads (mirror fields above). ---
  mailSend(to: string, subject: string, body: string, copper: number, items: InvSlot[]): void {
    this.cmd({
      cmd: 'mail_send',
      to,
      subject,
      body,
      copper,
      items: items.map((s) => ({ itemId: s.itemId, count: s.count })),
    });
  }
  mailTake(mailId: number): void {
    this.cmd({ cmd: 'mail_take', id: mailId });
  }
  mailDelete(mailId: number): void {
    this.cmd({ cmd: 'mail_delete', id: mailId });
  }
  mailMarkRead(mailId: number): void {
    this.cmd({ cmd: 'mail_read', id: mailId });
  }
  // --- IWorldDungeons: dungeon enter/leave sends + the raid-lockout countdown read.
  // selfLockouts mirrors the snapshot `s.lockouts`; raidLockouts derives the live
  // countdown locally so it ticks without traffic. enter_crypt/leave_crypt are legacy
  // dispatch-only aliases ClientWorld never sends (the enterCrypt/leaveCrypt helpers
  // below just forward to enterDungeon/leaveDungeon). ---
  enterDungeon(dungeonId: string): void {
    this.cmd({ cmd: 'enter_dungeon', dungeon: dungeonId });
  }
  leaveDungeon(): void {
    this.cmd({ cmd: 'leave_dungeon' });
  }
  // Raid lockouts mirrored from snapshot self as {dungeonId: expiryEpochMs}; the
  // remaining time is derived locally so the countdown ticks down without traffic.
  private selfLockouts: Record<string, number> = {};
  raidLockouts(): RaidLockout[] {
    const now = Date.now();
    const src = this.selfLockouts ?? {};
    const out: RaidLockout[] = [];
    for (const id of Object.keys(src)) {
      const msRemaining = src[id] - now;
      if (msRemaining > 0) out.push({ id, msRemaining });
    }
    return out;
  }
  // --- IWorldDelves: delve enter/leave + interact + companion-upgrade + Marks-vendor
  // buy + lockpick lifecycle + chest collect. delveShopOffers is a pure client read
  // from the delveClears mirror (no command). lockpickState rides no snapshot field;
  // the private applyLockpickEvent below rebuilds it from the lockpick* events. ---
  enterDelve(delveId: string, tierId: string): void {
    this.cmd({ cmd: 'enter_delve', delveId, tierId });
  }
  leaveDelve(): void {
    this.cmd({ cmd: 'leave_delve' });
  }
  delveInteract(objectId: number): void {
    this.cmd({ cmd: 'delve_interact', objectId });
  }
  companionUpgrade(companionId: string): void {
    this.cmd({ cmd: 'companion_upgrade', companionId });
  }
  delveBuyShopItem(delveId: string, itemId: string): void {
    this.cmd({ cmd: 'delve_buy', delveId, itemId });
  }
  delveShopOffers(delveId: string): DelveShopOfferView[] {
    return resolveDelveShopOffers(delveId, this.delveClears);
  }
  lockpickEngage(objectId: number, ante: Ante): void {
    this.cmd({ cmd: 'lockpick_engage', objectId, ante });
  }
  lockpickAction(action: PickAction): void {
    this.cmd({ cmd: 'lockpick_action', sid: this.lockpickState?.sessionId, action });
  }
  lockpickAbort(): void {
    this.cmd({ cmd: 'lockpick_abort', sid: this.lockpickState?.sessionId });
  }
  collectDelveChestLoot(chestId: number): void {
    this.cmd({ cmd: 'collect_delve_chest_loot', objectId: chestId });
  }
  // Mirror the authoritative lockpick lifecycle into lockpickState. The events
  // still flow to the HUD (drainEvents) for transient feedback (juice/sounds).
  private applyLockpickEvent(ev: SimEvent): void {
    if (ev.type === 'lockpickSession') {
      this.lockpickState = {
        sessionId: ev.sessionId,
        objectId: ev.objectId,
        w: ev.w,
        h: ev.h,
        col: ev.col,
        row: ev.row,
        page: ev.page,
        pageCount: ev.pageCount,
        tries: ev.tries,
        triesTotal: ev.triesTotal,
        lootTier: ev.lootTier,
        allowed: ev.allowed,
        visible: ev.visible,
        stepTimeoutMs: ev.stepTimeoutMs,
      };
    } else if (ev.type === 'lockpickStep') {
      const s = this.lockpickState;
      if (s && s.sessionId === ev.sessionId) {
        s.col = ev.col;
        s.row = ev.row;
        s.page = ev.page;
        s.pageCount = ev.pageCount;
        s.tries = ev.tries;
        s.triesTotal = ev.triesTotal;
        s.visible = ev.visible;
      }
    } else if (ev.type === 'lockpickEnd') {
      if (this.lockpickState?.sessionId === ev.sessionId) this.lockpickState = null;
    }
  }
  // --- IWorldProgressionXp: lifetime-XP leaderboard (REST GET, no wire command) +
  // the opt-in prestige action (cmd 'prestige'). The XP/milestone reads ride the
  // self-snapshot mirror fields above. ---
  async leaderboard(page = 0, pageSize = LEADERBOARD_PAGE_SIZE): Promise<LeaderboardPage> {
    const empty: LeaderboardPage = { leaders: [], page: 0, pageCount: 1, total: 0, pageSize };
    try {
      const res = await fetch(
        apiUrl(`/api/leaderboard?metric=lifetimeXp&page=${page}&pageSize=${pageSize}`, this.base),
      );
      if (!res.ok) return empty;
      const data = await res.json();
      return {
        leaders: data.leaders ?? [],
        page: data.page ?? page,
        pageCount: data.pageCount ?? 1,
        total: data.total ?? data.leaders?.length ?? 0,
        pageSize: data.pageSize ?? pageSize,
      };
    } catch {
      return empty;
    }
  }
  // Guild high-score board (REST GET, no wire command): ?board=guilds ranks
  // guilds by summed member lifetime XP. Realm-scoped (default), paged exactly
  // like the player board above.
  async guildLeaderboard(
    page = 0,
    pageSize = LEADERBOARD_PAGE_SIZE,
  ): Promise<GuildLeaderboardPage> {
    const empty: GuildLeaderboardPage = {
      leaders: [],
      page: 0,
      pageCount: 1,
      total: 0,
      pageSize,
    };
    try {
      const res = await fetch(
        apiUrl(`/api/leaderboard?board=guilds&page=${page}&pageSize=${pageSize}`, this.base),
      );
      if (!res.ok) return empty;
      const data = await res.json();
      return {
        leaders: data.leaders ?? [],
        page: data.page ?? page,
        pageCount: data.pageCount ?? 1,
        total: data.total ?? data.leaders?.length ?? 0,
        pageSize: data.pageSize ?? pageSize,
      };
    } catch {
      return empty;
    }
  }
  // Developer high-score board (REST GET, no wire command): ?board=devs ranks
  // contributors by landed commits. The same data for every realm, paged exactly
  // like the player + guild boards above.
  async devLeaderboard(page = 0, pageSize = LEADERBOARD_PAGE_SIZE): Promise<DevLeaderboardPage> {
    const empty: DevLeaderboardPage = {
      leaders: [],
      page: 0,
      pageCount: 1,
      total: 0,
      pageSize,
    };
    try {
      const res = await fetch(
        apiUrl(`/api/leaderboard?board=devs&page=${page}&pageSize=${pageSize}`, this.base),
      );
      if (!res.ok) return empty;
      const data = await res.json();
      return {
        leaders: data.leaders ?? [],
        page: data.page ?? page,
        pageCount: data.pageCount ?? 1,
        total: data.total ?? data.leaders?.length ?? 0,
        pageSize: data.pageSize ?? pageSize,
      };
    } catch {
      return empty;
    }
  }

  async dailyRewards(): Promise<DailyRewardStatus> {
    const res = await fetch(apiUrl('/api/daily-rewards', this.base), {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error('daily rewards unavailable');
    return (await res.json()) as DailyRewardStatus;
  }

  async spinDailyReward(): Promise<DailyRewardSpinResult> {
    const res = await fetch(apiUrl('/api/daily-rewards/spin', this.base), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? 'daily spin unavailable');
    return data as DailyRewardSpinResult;
  }

  async dailyRewardHistory(): Promise<DailyRewardHistory> {
    const res = await fetch(apiUrl('/api/daily-rewards/history', this.base), {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) return { payouts: [] };
    return (await res.json()) as DailyRewardHistory;
  }

  prestige(): void {
    this.cmd({ cmd: 'prestige' });
  }
  // --- IWorldTalents: talentPoints is a local compute (no send); applyTalents/
  // respec/setSpec/saveLoadout/switchLoadout/deleteLoadout send camelCase commands,
  // saveLoadout/deleteLoadout carry sanctioned display-only local recompute.
  // Talents & Specializations: the server re-validates every allocation. ---
  talentPoints(): { total: number; spent: number } {
    const level = this.entities.get(this.playerId)?.level ?? 1;
    return { total: talentPointsAtLevel(level), spent: pointsSpent(this.talents) };
  }
  applyTalents(alloc: TalentAllocation): void {
    this.cmd({ cmd: 'applyTalents', alloc });
  }
  respec(): void {
    this.cmd({ cmd: 'respec' });
  }
  setSpec(specId: string | null): void {
    this.cmd({ cmd: 'setSpec', spec: specId });
  }
  saveLoadout(name: string, bar: (string | null)[], alloc?: TalentAllocation): void {
    this.cmd({ cmd: 'saveLoadout', name, bar, alloc });
    if (alloc) {
      const clean = (name || 'Build').toString().slice(0, 24);
      const safeBar = Array.isArray(bar)
        ? bar.slice(0, SAVED_LOADOUT_BAR_SLOTS).map((b) => (typeof b === 'string' ? b : null))
        : [];
      const saved = { name: clean, alloc: cloneAllocation(alloc), bar: safeBar };
      this.talents = cloneAllocation(alloc);
      const existing = this.loadouts.findIndex((l) => l.name === clean);
      if (existing >= 0) {
        this.loadouts[existing] = saved;
        this.activeLoadout = existing;
      } else {
        this.loadouts = [...this.loadouts, saved];
        this.activeLoadout = this.loadouts.length - 1;
      }
      this.known = abilitiesKnownAt(
        this.cfg.playerClass,
        this.player.level,
        computeTalentModifiers(this.cfg.playerClass, this.talents),
      );
    }
  }
  switchLoadout(index: number): void {
    this.cmd({ cmd: 'switchLoadout', index });
  }
  deleteLoadout(index: number): void {
    this.cmd({ cmd: 'deleteLoadout', index });
    if (index < 0 || index >= this.loadouts.length) return;
    const wasActive = this.activeLoadout === index;
    this.loadouts = this.loadouts.filter((_, i) => i !== index);
    if (wasActive) {
      this.activeLoadout =
        this.loadouts.length > 0 ? Math.min(index, this.loadouts.length - 1) : -1;
      const next = this.activeLoadout >= 0 ? this.loadouts[this.activeLoadout] : null;
      if (next) {
        this.talents = cloneAllocation(next.alloc);
        this.known = abilitiesKnownAt(
          this.cfg.playerClass,
          this.player.level,
          computeTalentModifiers(this.cfg.playerClass, this.talents),
        );
      }
    } else if (this.activeLoadout > index) this.activeLoadout -= 1;
  }
  // legacy aliases kept for older scripts
  enterCrypt(): void {
    this.enterDungeon('hollow_crypt');
  }
  leaveCrypt(): void {
    this.leaveDungeon();
  }
}
