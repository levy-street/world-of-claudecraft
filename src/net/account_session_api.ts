// Focused account-session REST client for standalone browser surfaces. This
// module deliberately owns no world mirror, DOM, wallet adapter, or game state,
// so the Exchange SPA can use the established login/session protocol without
// importing src/net/online.ts and its ClientWorld dependency graph.

import { apiUrl, DESKTOP_API_ORIGIN, NATIVE_API_ORIGIN } from '../client_origin';
import { normalizeOrigin } from '../runtime';
import type { PlayerClass } from '../sim/types';
import { apiErrorFromBody } from './api_error';

// JSON is narrowed by each public method at the boundary. The server API has
// legacy additive fields, so the transport intentionally stays loose here.
// biome-ignore lint/suspicious/noExplicitAny: legacy JSON transport boundary.
type LooseJson = any;

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
  skinCatalog?: 'class' | 'mech';
  mainhandItemId?: string | null;
  offhandItemId?: string | null;
  weaponSkinId?: string | null;
  appearance?: Record<string, unknown> | null;
  helmHidden?: boolean;
  createdAt?: string | null;
  appearanceRerollAvailable?: boolean;
}

export interface AccountInfo {
  username: string;
  email: string;
  emailMissing?: boolean;
  createdAt: string;
  characterCount: number;
  twoFactorEnabled: boolean;
  passwordSet: boolean;
}

export interface WalletReauthProof {
  password: string;
  totp?: string;
  recoveryCode?: string;
}

const SESSION_KEY = 'woc_session';

export class AccountSessionApi {
  token: string | null = null;
  username: string | null = null;
  emailMissing: boolean | undefined = undefined;
  realm: string | null = null;
  base = NATIVE_API_ORIGIN || DESKTOP_API_ORIGIN;

  setRealm(url: string): void {
    this.base = normalizeOrigin(url) || NATIVE_API_ORIGIN || DESKTOP_API_ORIGIN;
  }

  protected async post<T = LooseJson>(path: string, body: unknown, base = this.base): Promise<T> {
    const res = await fetch(apiUrl(path, base), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw apiErrorFromBody(data, res.status);
    return data as T;
  }

  protected async get<T = LooseJson>(path: string): Promise<T> {
    const res = await fetch(apiUrl(path, this.base), {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw apiErrorFromBody(data, res.status);
    return data as T;
  }

  protected async delete<T = LooseJson>(path: string, body: unknown): Promise<T> {
    const res = await fetch(apiUrl(path, this.base), {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw apiErrorFromBody(data, res.status);
    return data as T;
  }

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
    this.emailMissing = data.emailMissing === true;
    return {};
  }

  saveSession(): void {
    if (!this.token || !this.username) return;
    try {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ token: this.token, username: this.username }),
      );
    } catch {
      // Storage may be unavailable. The in-memory session still works.
    }
  }

  restoreSession(): boolean {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
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
    this.emailMissing = undefined;
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // Ignore unavailable storage.
    }
  }

  async getAccount(): Promise<AccountInfo> {
    return this.get('/api/account');
  }

  async logout(): Promise<void> {
    await this.post('/api/account/logout', {});
  }

  async characters(): Promise<CharacterSummary[]> {
    const data = await this.get('/api/characters');
    if (typeof data.realm === 'string') this.realm = data.realm;
    return Array.isArray(data.characters) ? data.characters : [];
  }

  async walletLinkChallenge(address: string): Promise<{ nonce: string; message: string }> {
    return this.post('/api/wallet/link/challenge', { address });
  }

  async linkWallet(
    address: string,
    signature: string,
    nonce: string,
    reauth?: WalletReauthProof,
  ): Promise<{ pubkey: string }> {
    return this.post('/api/wallet/link', { ...(reauth ?? {}), address, signature, nonce });
  }

  async linkedWallet(): Promise<{ pubkey: string; linkedAt: string } | null> {
    const data = await this.get('/api/wallet');
    return data.wallet ?? null;
  }

  async unlinkWallet(reauth?: WalletReauthProof): Promise<void> {
    await this.delete('/api/wallet/link', reauth ?? {});
  }
}
