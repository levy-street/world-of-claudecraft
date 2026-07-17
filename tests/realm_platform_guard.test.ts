import { describe, expect, it, vi } from 'vitest';

import { parseRealms, resolveRealmFlags } from '../server/realm';
import {
  globallyExcludedRealms,
  isAppShellRequest,
  p2wRealmNames,
  realmsVisibleToRequest,
  webOnlyRealmRefuses,
} from '../server/realm_platform_guard';
import { passesTurnstile } from '../server/turnstile';
import { createWsAuth } from '../server/ws_auth';

// Request stubs by client class. Origin is the class marker web_login_guard
// reads; the exact values mirror NATIVE_APP_ORIGINS / DESKTOP_APP_ORIGINS.
const browserReq = () => ({ headers: { origin: 'https://worldofclaudecraft.com' } }) as any;
const noOriginReq = () => ({ headers: {} }) as any;
const nativeReq = () => ({ headers: { origin: 'capacitor://localhost' } }) as any;
const desktopReq = () => ({ headers: { origin: 'app://worldofclaudecraft' } }) as any;
// A genuine browser on `npm run dev` presents the Vite page origin on POST/WS;
// it shares DESKTOP_APP_ORIGINS but must never be refused by a web-only realm.
const viteDevReq = () => ({ headers: { origin: 'http://localhost:5173' } }) as any;

describe('resolveRealmFlags', () => {
  it('parses plus-separated and comma-separated tokens, deduped and case-folded', () => {
    expect(resolveRealmFlags('web+p2w')).toEqual(['web', 'p2w']);
    expect(resolveRealmFlags('web,p2w')).toEqual(['web', 'p2w']);
    expect(resolveRealmFlags(' WEB + web ')).toEqual(['web']);
  });
  it('drops unknown tokens and yields no flags for empty input', () => {
    expect(resolveRealmFlags('web+shiny+p2w')).toEqual(['web', 'p2w']);
    expect(resolveRealmFlags('shiny')).toEqual([]);
    expect(resolveRealmFlags('')).toEqual([]);
    expect(resolveRealmFlags(undefined)).toEqual([]);
  });
});

describe('parseRealms flags field', () => {
  it('parses the optional 4th field and defaults to no flags without it', () => {
    const dir = parseRealms(
      'Claudemoon=https://claudemoon.example.com=Normal,RiverBoat=https://riverboat.example.com=Normal=web+p2w',
    );
    expect(dir).toHaveLength(2);
    expect(dir[0]).toEqual({
      name: 'Claudemoon',
      url: 'https://claudemoon.example.com',
      type: 'Normal',
      flags: [],
    });
    expect(dir[1].flags).toEqual(['web', 'p2w']);
  });
  it('accepts an empty type field before flags and stays backward compatible', () => {
    const dir = parseRealms('RiverBoat=https://riverboat.example.com==web');
    expect(dir[0].type).toBe('Normal');
    expect(dir[0].flags).toEqual(['web']);
    // Two-field legacy entries keep parsing exactly as before.
    const legacy = parseRealms('Claudemoon=https://claudemoon.example.com');
    expect(legacy[0].flags).toEqual([]);
  });
});

const DIR = parseRealms(
  'Claudemoon=https://claudemoon.example.com=Normal,RiverBoat=https://riverboat.example.com=Normal=web+p2w',
);

describe('realmsVisibleToRequest', () => {
  it('serves the full directory to browser and origin-less requests', () => {
    expect(realmsVisibleToRequest(browserReq(), DIR).map((r) => r.name)).toEqual([
      'Claudemoon',
      'RiverBoat',
    ]);
    expect(realmsVisibleToRequest(noOriginReq(), DIR)).toHaveLength(2);
  });
  it('drops web-only realms for the native and desktop app-shell classes', () => {
    for (const req of [nativeReq(), desktopReq()]) {
      expect(isAppShellRequest(req)).toBe(true);
      expect(realmsVisibleToRequest(req, DIR).map((r) => r.name)).toEqual(['Claudemoon']);
    }
  });
});

describe('webOnlyRealmRefuses', () => {
  it('refuses app shells only when the own realm carries the web flag', () => {
    expect(webOnlyRealmRefuses(['web'], nativeReq())).toBe(true);
    expect(webOnlyRealmRefuses(['web'], desktopReq())).toBe(true);
    expect(webOnlyRealmRefuses(['web'], browserReq())).toBe(false);
    expect(webOnlyRealmRefuses(['web'], noOriginReq())).toBe(false);
    expect(webOnlyRealmRefuses([], nativeReq())).toBe(false);
    expect(webOnlyRealmRefuses(['p2w'], nativeReq())).toBe(false);
  });
  it('never refuses a browser on the Vite dev origins (packaged desktop only)', () => {
    expect(webOnlyRealmRefuses(['web'], viteDevReq())).toBe(false);
    // The broad class still treats the dev origin as an app shell for the
    // harmless directory filter.
    expect(isAppShellRequest(viteDevReq())).toBe(true);
  });
});

describe('p2wRealmNames', () => {
  it('collects only p2w-flagged realm names', () => {
    expect(p2wRealmNames(DIR)).toEqual(['RiverBoat']);
    expect(p2wRealmNames(parseRealms('Claudemoon=https://claudemoon.example.com'))).toEqual([]);
  });
});

describe('globallyExcludedRealms', () => {
  it('unions the own realm in when its effective flags say p2w', () => {
    // Directory forgot +p2w on RiverBoat, but the RiverBoat process's own
    // REALM_FLAGS carries it: that process still excludes itself.
    const dir = parseRealms(
      'Claudemoon=https://claudemoon.example.com,RiverBoat=https://riverboat.example.com=Normal=web',
    );
    expect(globallyExcludedRealms(dir, 'RiverBoat', ['web', 'p2w'])).toEqual(['RiverBoat']);
    expect(globallyExcludedRealms(dir, 'Claudemoon', [])).toEqual([]);
  });
  it('dedupes when the directory and own flags agree', () => {
    expect(globallyExcludedRealms(DIR, 'RiverBoat', ['web', 'p2w'])).toEqual(['RiverBoat']);
    expect(globallyExcludedRealms(DIR, 'Claudemoon', [])).toEqual(['RiverBoat']);
  });
});

describe('passesTurnstile on a web-only realm', () => {
  it('inverts the app-shell admission arms into rejections', async () => {
    // Native attestation and the desktop Origin bypass both become rejections;
    // no attestation or siteverify call is ever attempted.
    await expect(passesTurnstile(nativeReq(), {}, '', undefined, ['web'])).resolves.toBe(false);
    await expect(passesTurnstile(desktopReq(), {}, '', undefined, ['web'])).resolves.toBe(false);
  });
  it('keeps the browser gate unchanged', async () => {
    // No secret configured keeps local dev frictionless, exactly as today.
    await expect(passesTurnstile(browserReq(), {}, '', undefined, ['web'])).resolves.toBe(true);
    // A non-web realm keeps the desktop Origin bypass.
    await expect(passesTurnstile(desktopReq(), {}, '', undefined, [])).resolves.toBe(true);
  });
});

describe('ws auth app-shell refusal', () => {
  it('rejects the handshake before any DB work with the wire literal', async () => {
    const sent: any[] = [];
    const closes: any[] = [];
    const ws = {
      readyState: 1,
      send: (p: string) => sent.push(JSON.parse(p)),
      close: () => closes.push(true),
      on: () => {},
    } as any;
    const accountForToken = vi.fn(async () => 1);
    const deps: any = {
      game: { isIpBlocked: () => false, countIpSessions: () => 0, clients: { size: 0 } },
      accountForToken,
      moderationStatusForAccount: vi.fn(),
      getCharacter: vi.fn(),
      chatMuteStatusForAccount: vi.fn(),
      adminRolesForAccount: vi.fn(),
      permissionsForRoles: () => new Set<string>(),
      metaRequestUserData: () => ({}),
      metaEventSourceUrl: () => undefined,
      loadAccountCosmetics: vi.fn(),
      isConnectionRefused: () => false,
      bufferHandshakeMessages: () => () => {},
      requestMetadata: () => ({ ip: '1.2.3.4', userAgent: 'test' }),
      maxWsPerIpHard: 100,
      maxPlayersPerRealm: 0,
      acquireCharacterLease: vi.fn(),
      releaseCharacterLease: vi.fn(),
      bankBonusForAccount: vi.fn(),
      refusesAppShellClient: (req: any) => webOnlyRealmRefuses(['web'], req),
    };
    const h = createWsAuth(deps);
    await h.authenticateWebSocket(
      ws,
      JSON.stringify({ t: 'auth', token: 'tok', character: 7 }),
      nativeReq(),
    );
    expect(sent).toContainEqual({
      t: 'error',
      error: 'this realm can only be entered from a web browser',
    });
    expect(closes.length).toBeGreaterThan(0);
    expect(accountForToken).not.toHaveBeenCalled();
  });
  it('leaves browser handshakes on the normal path', async () => {
    const sent: any[] = [];
    const ws = {
      readyState: 1,
      send: (p: string) => sent.push(JSON.parse(p)),
      close: () => {},
      on: () => {},
    } as any;
    const accountForToken = vi.fn(async () => null);
    const deps: any = {
      game: { isIpBlocked: () => false, countIpSessions: () => 0, clients: { size: 0 } },
      accountForToken,
      moderationStatusForAccount: vi.fn(),
      getCharacter: vi.fn(),
      chatMuteStatusForAccount: vi.fn(),
      adminRolesForAccount: vi.fn(),
      permissionsForRoles: () => new Set<string>(),
      metaRequestUserData: () => ({}),
      metaEventSourceUrl: () => undefined,
      loadAccountCosmetics: vi.fn(),
      isConnectionRefused: () => false,
      bufferHandshakeMessages: () => () => {},
      requestMetadata: () => ({ ip: '1.2.3.4', userAgent: 'test' }),
      maxWsPerIpHard: 100,
      maxPlayersPerRealm: 0,
      acquireCharacterLease: vi.fn(),
      releaseCharacterLease: vi.fn(),
      bankBonusForAccount: vi.fn(),
      refusesAppShellClient: (req: any) => webOnlyRealmRefuses(['web'], req),
    };
    const h = createWsAuth(deps);
    await h.authenticateWebSocket(
      ws,
      JSON.stringify({ t: 'auth', token: 'tok', character: 7 }),
      browserReq(),
    );
    // The browser request proceeds past the class check into normal auth (and
    // fails there only because the token stub resolves to no account).
    expect(accountForToken).toHaveBeenCalledTimes(1);
    expect(sent).toContainEqual({ t: 'error', error: 'not authenticated' });
  });
});
