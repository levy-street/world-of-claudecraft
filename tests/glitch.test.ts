import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapGlitchSession,
  type GlitchConfig,
  type GlitchSession,
  readGlitchConfig,
  safeGlitchUserName,
  sendGlitchBehaviorEvent,
  storeGlitchCharacterSave,
  submitGlitchProgressionRun,
} from '../src/game/glitch';

const TITLE_ID = '8254e0f9-6c3a-4c94-8a16-570157b9df3b';
const INSTALL_ID = '33a533b2-2128-4604-9afc-886848a897b6';
const SECOND_INSTALL_ID = '44a533b2-2128-4604-9afc-886848a897b6';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function response(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(responses: Response[]) {
  const calls: { url: string; init: RequestInit | undefined; body: unknown }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url: String(input), init, body });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch call');
    return next;
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function config(): GlitchConfig {
  return {
    enabled: true,
    apiBaseUrl: 'https://api.glitch.fun/api',
    titleId: TITLE_ID,
    titleToken: 'title-token',
    gameVersion: '0.20.0',
  };
}

function session(): GlitchSession {
  return {
    installId: INSTALL_ID,
    deviceId: 'device-1',
    userName: 'Dev_Player42',
    licenseType: 'purchased',
    serverTime: '2026-07-04T18:00:00Z',
    launchedByGlitch: true,
    apiBaseUrl: 'https://api.glitch.fun/api',
    titleId: TITLE_ID,
    titleToken: 'title-token',
    gameVersion: '0.20.0',
  };
}

beforeAll(() => {
  if (!globalThis.crypto) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
  }
  if (!globalThis.btoa) {
    Object.defineProperty(globalThis, 'btoa', {
      value: (value: string) => Buffer.from(value, 'binary').toString('base64'),
    });
  }
  if (!globalThis.atob) {
    Object.defineProperty(globalThis, 'atob', {
      value: (value: string) => Buffer.from(value, 'base64').toString('binary'),
    });
  }
});

describe('Glitch platform integration', () => {
  it('stays disabled unless both the flag and client title token are present', () => {
    expect(readGlitchConfig({ VITE_GLITCH_ENABLED: '1' }, '0.20.0').enabled).toBe(false);
    expect(
      readGlitchConfig(
        { VITE_GLITCH_ENABLED: '1', VITE_GLITCH_TITLE_TOKEN: 'public-title-token' },
        '0.20.0',
      ).enabled,
    ).toBe(true);
  });

  it('validates the launch install and preserves Glitch usernames with symbols', async () => {
    const storage = new MemoryStorage();
    const { calls, fetchImpl } = mockFetch([
      response(200, {
        valid: true,
        user_name: 'Dev_Player42#west',
        license_type: 'purchased',
        server_time: '2026-07-04T18:00:00Z',
      }),
    ]);

    const result = await bootstrapGlitchSession({
      config: config(),
      storage,
      search: `?install_id=${INSTALL_ID}`,
      fetchImpl,
      randomUUID: () => 'device-1',
    });

    expect(result?.installId).toBe(INSTALL_ID);
    expect(result?.userName).toBe('Dev_Player42#west');
    expect(result?.launchedByGlitch).toBe(true);
    expect(storage.getItem('woc_glitch_install_id')).toBe(INSTALL_ID);
    expect(calls[0].url).toBe(
      `https://api.glitch.fun/api/titles/${TITLE_ID}/installs/${INSTALL_ID}/validate`,
    );
    const headers = calls[0].init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer title-token');
  });

  it('recreates an install when validation reports INSTALL_NOT_FOUND', async () => {
    const storage = new MemoryStorage();
    const { calls, fetchImpl } = mockFetch([
      response(404, { reason: 'INSTALL_NOT_FOUND' }),
      response(200, { data: { id: SECOND_INSTALL_ID, user_name: 'Recovered-99' } }),
      response(200, { valid: true, user_name: 'Recovered-99', license_type: 'trial' }),
    ]);

    const result = await bootstrapGlitchSession({
      config: config(),
      storage,
      search: `?install_id=${INSTALL_ID}`,
      fetchImpl,
      randomUUID: () => 'device-1',
    });

    expect(result?.installId).toBe(SECOND_INSTALL_ID);
    expect(calls[1].url).toBe(`https://api.glitch.fun/api/titles/${TITLE_ID}/installs`);
    expect(calls[1].body).toEqual({
      user_install_id: INSTALL_ID,
      platform: 'web',
      device_type: 'desktop',
      operating_system: 'browser',
      game_version: '0.20.0',
      referral_source: 'other',
    });
  });

  it('sanitizes Glitch display names without enforcing the game character-name rule', () => {
    expect(safeGlitchUserName('  Alice_42!! \n Bob\t')).toBe('Alice_42!! Bob');
    expect(safeGlitchUserName('')).toBe('Guest Player');
  });

  it('submits progression runs with scores and stats nested under payload', async () => {
    const { calls, fetchImpl } = mockFetch([response(409, { status: 'duplicate', record: {} })]);

    const result = await submitGlitchProgressionRun(
      session(),
      {
        idempotency_key: 'run-1',
        payload: { scores: { high_score: 42 }, stats: { quests_done: 1 } },
        trust_level: 'unverified',
        platform: 'web',
      },
      fetchImpl,
    );

    expect(result).toEqual({ status: 'duplicate', record: {} });
    expect(calls[0].body).toEqual({
      idempotency_key: 'run-1',
      payload: { scores: { high_score: 42 }, stats: { quests_done: 1 } },
      trust_level: 'unverified',
      platform: 'web',
    });
  });

  it('sends behavioral events with the documented install field names', async () => {
    const { calls, fetchImpl } = mockFetch([response(200, { data: { id: 'event-1' } })]);

    await sendGlitchBehaviorEvent(
      session(),
      {
        step_key: 'quest',
        action_key: 'complete',
        metadata: { quest_id: 'q_wolves', level: 2 },
        event_timestamp: '2026-07-05T12:00:00.000Z',
      },
      fetchImpl,
    );

    expect(calls[0].url).toBe(`https://api.glitch.fun/api/titles/${TITLE_ID}/events`);
    expect(calls[0].body).toEqual({
      game_install_id: INSTALL_ID,
      step_key: 'quest',
      action_key: 'complete',
      metadata: { quest_id: 'q_wolves', level: 2 },
      event_timestamp: '2026-07-05T12:00:00.000Z',
    });
  });

  it('stores cloud saves as base64 raw JSON with a SHA-256 checksum of decoded bytes', async () => {
    const storage = new MemoryStorage();
    storage.setItem('woc_glitch_save_slot_0_version', '1');
    const { calls, fetchImpl } = mockFetch([response(201, { data: { id: 'save-1', version: 2 } })]);

    const result = await storeGlitchCharacterSave({
      session: session(),
      storage,
      characterClass: 'mage',
      state: { level: 3, xp: 40 },
      fetchImpl,
      now: () => new Date('2026-07-04T18:00:00.000Z'),
    });

    expect(result).toEqual({ status: 'saved', version: 2, saveId: 'save-1' });
    const body = calls[0].body as { payload: string; checksum: string; base_version: number };
    const decoded = JSON.parse(Buffer.from(body.payload, 'base64').toString('utf8'));
    expect(decoded).toEqual({
      schema_version: 1,
      character_class: 'mage',
      character_state: { level: 3, xp: 40 },
      saved_at: '2026-07-04T18:00:00.000Z',
    });
    expect(body.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(body.base_version).toBe(1);
    expect(storage.getItem('woc_glitch_save_slot_0_version')).toBe('2');
  });

  it('returns cloud-save conflicts instead of resolving or overwriting silently', async () => {
    const { calls, fetchImpl } = mockFetch([
      response(409, { status: 'conflict', conflict_id: 'conflict-1', save_id: 'save-1' }),
    ]);

    const result = await storeGlitchCharacterSave({
      session: session(),
      storage: new MemoryStorage(),
      characterClass: 'warrior',
      state: { level: 1 },
      fetchImpl,
      now: () => new Date('2026-07-04T18:00:00.000Z'),
    });

    expect(result).toEqual({
      status: 'conflict',
      conflict: { status: 'conflict', conflict_id: 'conflict-1', save_id: 'save-1' },
    });
    expect(calls).toHaveLength(1);
  });
});
