import { describe, expect, it, vi } from 'vitest';
import {
  completeGlitchLogin,
  type GlitchAccountLink,
  type GlitchCharacterRow,
  type GlitchLoginDeps,
  type GlitchServerConfig,
  glitchCharacterNameCandidates,
} from '../server/glitch_auth';
import type { CharacterState } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

const TITLE_ID = '8254e0f9-6c3a-4c94-8a16-570157b9df3b';
const INSTALL_ID = '33a533b2-2128-4604-9afc-886848a897b6';

function response(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function baseConfig(): GlitchServerConfig {
  return {
    enabled: true,
    apiBaseUrl: 'https://api.glitch.fun/api',
    titleId: TITLE_ID,
    titleToken: 'server-title-token',
    defaultClass: 'warrior',
  };
}

function character(row: Partial<GlitchCharacterRow> = {}): GlitchCharacterRow {
  return {
    id: row.id ?? 1,
    account_id: row.account_id ?? 10,
    name: row.name ?? 'Dev Player42',
    class: row.class ?? 'warrior',
    level: row.level ?? 1,
    state: row.state ?? ({ skin: 0 } as CharacterState),
    force_rename: row.force_rename ?? false,
  };
}

function deps(overrides: Partial<GlitchLoginDeps> = {}): GlitchLoginDeps {
  return {
    realm: 'Claudemoon',
    config: baseConfig(),
    fetchImpl: vi.fn(async () =>
      response(200, {
        valid: true,
        user_name: 'Dev_Player42#west',
        license_type: 'trial',
        server_time: '2026-07-04T18:00:00Z',
      }),
    ) as typeof fetch,
    requestMetadata: () => ({ ip: '127.0.0.1', userAgent: 'vitest' }),
    initialCharacterState: (cls: PlayerClass, name: string, skin: number) =>
      ({ class: cls, name, skin }) as unknown as CharacterState,
    glitchAccountForInstall: vi.fn(async () => null),
    linkGlitchAccount: vi.fn(async (_titleId, installId, accountId, glitchUserName) => ({
      title_id: TITLE_ID,
      install_id: installId,
      account_id: accountId,
      glitch_user_name: glitchUserName,
    })),
    createAccount: vi.fn(async (username) => ({ id: 10, username })),
    touchLogin: vi.fn(async () => {}),
    saveToken: vi.fn(async () => {}),
    listCharacters: vi.fn(async () => []),
    createCharacterCapped: vi.fn(async (accountId, name, cls, _limit, state) =>
      character({ id: 55, account_id: accountId, name, class: cls, state }),
    ),
    isCharacterOnline: vi.fn(() => false),
    ...overrides,
  };
}

describe('server Glitch auth bridge', () => {
  it('validates a Glitch install and provisions a normal online character', async () => {
    const d = deps();

    const result = await completeGlitchLogin(
      { installId: INSTALL_ID, requestedClass: 'mage' },
      { ip: '203.0.113.9', userAgent: 'Chrome' },
      d,
    );

    expect(result.username).toBe('Dev_Player42#west');
    expect(result.realm).toBe('Claudemoon');
    expect(result.characterCreated).toBe(true);
    expect(result.character).toMatchObject({
      id: 55,
      name: 'Dev_Player42 wes',
      class: 'mage',
      online: false,
    });
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(d.fetchImpl).toHaveBeenCalledWith(
      `https://api.glitch.fun/api/titles/${TITLE_ID}/installs/${INSTALL_ID}/validate`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer server-title-token' },
      },
    );
    expect(d.linkGlitchAccount).toHaveBeenCalledWith(TITLE_ID, INSTALL_ID, 10, 'Dev_Player42#west');
    expect(d.saveToken).toHaveBeenCalledWith(result.token, 10);
  });

  it('reuses a linked account and existing character on later launches', async () => {
    const link: GlitchAccountLink = {
      account_id: 22,
      glitch_user_name: 'Dev_Player42#west',
    };
    const existing = character({
      id: 77,
      account_id: 22,
      name: 'Dev_Player42 wes',
      class: 'hunter',
    });
    const d = deps({
      glitchAccountForInstall: vi.fn(async () => link),
      listCharacters: vi.fn(async () => [existing]),
      isCharacterOnline: vi.fn(() => true),
    });

    const result = await completeGlitchLogin(
      { installId: INSTALL_ID, requestedClass: 'mage' },
      {},
      d,
    );

    expect(result.character).toMatchObject({ id: 77, class: 'hunter', online: true });
    expect(result.characterCreated).toBe(false);
    expect(d.createAccount).not.toHaveBeenCalled();
    expect(d.createCharacterCapped).not.toHaveBeenCalled();
  });

  it('rejects invalid or unlicensed installs before creating local records', async () => {
    const d = deps({
      fetchImpl: vi.fn(async () =>
        response(200, { valid: false, reason: 'TRIAL_EXPIRED' }),
      ) as typeof fetch,
    });

    await expect(
      completeGlitchLogin({ installId: INSTALL_ID }, { ip: '127.0.0.1' }, d),
    ).rejects.toThrow('TRIAL_EXPIRED');
    expect(d.createAccount).not.toHaveBeenCalled();
  });

  it('keeps numbers from Glitch names while removing unsafe punctuation for character names', () => {
    expect(glitchCharacterNameCandidates('3Wjl_ScH2JsXLEFJZRA9z8t!@#', INSTALL_ID)[0]).toBe(
      '3Wjl_ScH2JsXLEFJ',
    );
  });
});
