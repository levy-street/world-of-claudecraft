import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_SETTINGS_POLICY,
  ACCOUNT_SETTINGS_PREAUTH_POLICY,
  ACCOUNT_SETTINGS_SAVE_POLICY,
  configureAccountSettingsRuntime,
  resetAccountSettingsRateLimitsForTests,
  routes,
} from '../../server/account_settings';
import type { AccountSettingsDb } from '../../server/account_settings_db';
import { requireAccount } from '../../server/http/middleware/require_account';
import {
  sanitizeAccountSettingsEntries,
  validateAccountSettingsEntries,
} from '../../src/account_settings_contract';
import { type FakeRes, fakeCtx } from './helpers';

class FakeSettingsDb implements AccountSettingsDb {
  ack = new Set<number>();
  profiles = new Map<string, Record<string, string>>();
  writes = 0;
  async acknowledged(id: number) {
    return this.ack.has(id);
  }
  async acknowledge(id: number) {
    this.ack.add(id);
  }
  async initialize(id: number, device: string, character: number, entries: Record<string, string>) {
    if (character !== id * 10 || !this.ack.has(id)) return null;
    const key = `${id}:${device}`;
    if (!this.profiles.has(key)) this.profiles.set(key, entries);
    return this.profiles.get(key)!;
  }
  async save(id: number, device: string, entries: Record<string, string>) {
    const key = `${id}:${device}`;
    if (!this.profiles.has(key)) return false;
    this.writes++;
    this.profiles.set(key, entries);
    return true;
  }
}
const handler = (path: string) => routes.find((route) => route.path === path)!.handler;
const ctx = (body?: unknown, id = 1) =>
  fakeCtx({ account: { accountId: id, scope: 'full' }, body });
let db: FakeSettingsDb;
beforeEach(() => {
  db = new FakeSettingsDb();
  configureAccountSettingsRuntime(db);
  resetAccountSettingsRateLimitsForTests();
});
describe('account preference validation', () => {
  it('rejects secrets, character layouts, nonstrings, and oversized payloads', () => {
    for (const entries of [
      { woc_session: 'secret' },
      { 'woc_keybinds:char:1': '{}' },
      { woc_settings: 1 },
      { woc_settings: 'x'.repeat(32_769) },
      { woc_settings: '\u{1F600}'.repeat(16_000), woc_theme: '\u{1F600}'.repeat(16_000) },
    ]) {
      expect(validateAccountSettingsEntries(entries)).toBeNull();
    }
    expect(sanitizeAccountSettingsEntries({ woc_theme: 'dark', session: 'secret' })).toEqual({
      woc_theme: 'dark',
    });
  });
  it('permits bounded frame families and canonical keybindings', () => {
    expect(
      validateAccountSettingsEntries({ woc_keybinds: '{}', woc_hud_frame_cast_hidden: '1' }),
    ).toEqual({ woc_keybinds: '{}', woc_hud_frame_cast_hidden: '1' });
  });
});
describe('account settings endpoints', () => {
  it('rejects absent bearer and read-only tokens before any settings action', async () => {
    const auth = routes[0].middleware![1];
    const next = vi.fn(async () => {});
    await expect(auth(fakeCtx(), next)).rejects.toMatchObject({ status: 401 });
    const readAuth = requireAccount({
      scope: 'full',
      lookupToken: async () => ({ accountId: 1, scope: 'read' }),
    });
    await expect(
      readAuth(fakeCtx({ headers: { authorization: `Bearer ${'a'.repeat(64)}` } }), next),
    ).rejects.toMatchObject({ status: 403 });
    expect(next).not.toHaveBeenCalled();
  });
  it('preauth flood rejection prevents bearer database lookups', async () => {
    const preauth = routes[0].middleware![0];
    const lookupToken = vi.fn(async () => null);
    const auth = requireAccount({ scope: 'full', lookupToken });
    const request = fakeCtx({ headers: { authorization: `Bearer ${'a'.repeat(64)}` } });
    for (let i = 0; i < ACCOUNT_SETTINGS_PREAUTH_POLICY.limit; i++)
      await preauth(request, async () => {});
    await expect(preauth(request, () => auth(request, async () => {}))).rejects.toMatchObject({
      status: 429,
    });
    expect(lookupToken).not.toHaveBeenCalled();
  });
  it('requires an explicit true acknowledgment', async () => {
    await expect(
      handler('/api/account/settings/ack')(ctx({ understood: false })),
    ).rejects.toMatchObject({ status: 422 });
    expect(db.ack.size).toBe(0);
    await handler('/api/account/settings/ack')(ctx({ understood: true }));
    expect(db.ack.has(1)).toBe(true);
  });
  it('denies initialization before acknowledgment and for another account character', async () => {
    const body = { deviceType: 'desktop', characterId: 10, entries: { woc_theme: 'dark' } };
    await expect(handler('/api/account/settings/initialize')(ctx(body))).rejects.toMatchObject({
      status: 404,
    });
    db.ack.add(1);
    await expect(
      handler('/api/account/settings/initialize')(ctx({ ...body, characterId: 20 })),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.profiles.size).toBe(0);
  });
  it('first profile wins across characters, with separate devices and accounts', async () => {
    db.ack.add(1);
    db.ack.add(2);
    for (const [id, deviceType, theme] of [
      [1, 'desktop', 'first'],
      [1, 'desktop', 'second'],
      [1, 'phone', 'phone'],
      [2, 'desktop', 'other'],
    ] as const) {
      await handler('/api/account/settings/initialize')(
        ctx({ deviceType, characterId: id * 10, entries: { woc_theme: theme } }, id),
      );
    }
    expect(db.profiles.get('1:desktop')).toEqual({ woc_theme: 'first' });
    expect(db.profiles.get('1:phone')).toEqual({ woc_theme: 'phone' });
    expect(db.profiles.get('2:desktop')).toEqual({ woc_theme: 'other' });
  });
  it('saving never initializes and rejects an unknown device before writes', async () => {
    await expect(
      handler('/api/account/settings/save')(ctx({ deviceType: 'desktop', entries: {} })),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      handler('/api/account/settings/save')(ctx({ deviceType: 'tv', entries: {} })),
    ).rejects.toMatchObject({ status: 422 });
    expect(db.writes).toBe(0);
  });
  it('bounds repeated attempts and rejects before profile work', () => {
    const request = ctx();
    for (let i = 0; i < 30; i++) expect(ACCOUNT_SETTINGS_POLICY.tier1(request).allowed).toBe(true);
    for (let i = 0; i < 100; i++)
      expect(ACCOUNT_SETTINGS_POLICY.tier1(request).allowed).toBe(false);
  });
  it('allows a minute of debounced saves without spending the login budget', () => {
    const request = ctx();
    for (let i = 0; i < 80; i++)
      expect(ACCOUNT_SETTINGS_SAVE_POLICY.tier1(request).allowed).toBe(true);
    for (let i = 0; i < ACCOUNT_SETTINGS_POLICY.limit; i++)
      expect(ACCOUNT_SETTINGS_POLICY.tier1(request).allowed).toBe(true);
    expect(ACCOUNT_SETTINGS_POLICY.tier1(request).allowed).toBe(false);
    for (let i = 80; i < ACCOUNT_SETTINGS_SAVE_POLICY.limit; i++)
      expect(ACCOUNT_SETTINGS_SAVE_POLICY.tier1(request).allowed).toBe(true);
    expect(ACCOUNT_SETTINGS_SAVE_POLICY.tier1(request).allowed).toBe(false);
    expect(ACCOUNT_SETTINGS_PREAUTH_POLICY.limit).toBeGreaterThanOrEqual(
      ACCOUNT_SETTINGS_POLICY.limit + ACCOUNT_SETTINGS_SAVE_POLICY.limit,
    );
    expect(routes.find((route) => route.path.endsWith('/save'))?.middleware?.[2]).toHaveProperty(
      'rateLimitPolicyName',
      ACCOUNT_SETTINGS_SAVE_POLICY.name,
    );
  });
  it('status reads acknowledgment only and all routes mount auth before rate and body', async () => {
    const request = ctx();
    await handler('/api/account/settings')(request);
    expect((request.res as unknown as FakeRes).body).toBeDefined();
    for (const route of routes)
      expect(route.middleware!.length).toBe(route.method === 'GET' ? 3 : 4);
  });
});
