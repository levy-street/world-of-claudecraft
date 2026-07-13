// The desktop shell's Steam facade (electron/steam.cjs): the
// distribution/dev gating (with the packaged-hatch closure), app id
// resolution, lazy init with per-call retry, and the never-throws link-ticket
// contract. Driven with injected fakes; no electron, no real steamworks.js.
import { describe, expect, it, vi } from 'vitest';
import {
  createSteamShell,
  LINK_TICKET_IDENTITY,
  resolveSteamAppId,
  SPACEWAR_APP_ID,
  steamIntegrationEnabled,
} from '../electron/steam.cjs';

/** A fake steamworks.js whose init returns a client minting `bytes` tickets.
 *  Every minted ticket carries its own cancel spy and is recorded in `tickets`
 *  so the at-most-one-live-handle contract can be asserted per mint. */
function fakeSteamworks(bytes: Buffer | null = Buffer.from([0xab, 0xcd])) {
  const tickets: Array<{ getBytes: () => Buffer | null; cancel: ReturnType<typeof vi.fn> }> = [];
  const getAuthTicketForWebApi = vi.fn(async (_identity: string) => {
    const ticket = { getBytes: () => bytes, cancel: vi.fn() };
    tickets.push(ticket);
    return ticket;
  });
  const init = vi.fn((_appId: number) => ({ auth: { getAuthTicketForWebApi } }));
  return { module: { init }, init, getAuthTicketForWebApi, tickets };
}

describe('steamIntegrationEnabled', () => {
  it('is on for the steam distribution regardless of env or packaging', () => {
    expect(steamIntegrationEnabled({ distribution: 'steam', env: {}, isPackaged: true })).toBe(
      true,
    );
    expect(steamIntegrationEnabled({ distribution: 'steam', env: {}, isPackaged: false })).toBe(
      true,
    );
  });

  it('honors WOC_STEAM_DEV=1 on unpackaged checkouts only (the hatch closure)', () => {
    const env = { WOC_STEAM_DEV: '1' };
    expect(steamIntegrationEnabled({ distribution: 'website', env, isPackaged: false })).toBe(true);
    // A PACKAGED website build ignores the env var: an installed player build
    // can never be flipped into loading native Steam code by local env.
    expect(steamIntegrationEnabled({ distribution: 'website', env, isPackaged: true })).toBe(false);
    expect(steamIntegrationEnabled({ distribution: 'website', env: {}, isPackaged: false })).toBe(
      false,
    );
  });
});

describe('resolveSteamAppId', () => {
  it('prefers the wocDesktop stamp (number or digit string)', () => {
    expect(resolveSteamAppId({ packagedMetadata: { wocDesktop: { steamAppId: 3140820 } } })).toBe(
      3140820,
    );
    expect(resolveSteamAppId({ packagedMetadata: { wocDesktop: { steamAppId: '3140820' } } })).toBe(
      3140820,
    );
  });

  it('falls back to WOC_STEAM_APP_ID on unpackaged checkouts only, then Spacewar', () => {
    expect(resolveSteamAppId({ env: { WOC_STEAM_APP_ID: '999' }, isPackaged: false })).toBe(999);
    expect(resolveSteamAppId({ env: { WOC_STEAM_APP_ID: '999' }, isPackaged: true })).toBe(
      SPACEWAR_APP_ID,
    );
    expect(resolveSteamAppId({})).toBe(SPACEWAR_APP_ID);
    // Garbage stamps degrade to the fallback rather than throwing.
    expect(resolveSteamAppId({ packagedMetadata: { wocDesktop: { steamAppId: 'abc' } } })).toBe(
      SPACEWAR_APP_ID,
    );
  });

  it('treats id 0 as garbage in every branch (number, stamp string, env string)', () => {
    // 0 is all-digits, so a bare /^\d+$/ check would init Steam with app id 0;
    // the string branches hold the number branch's > 0 bar instead.
    expect(resolveSteamAppId({ packagedMetadata: { wocDesktop: { steamAppId: 0 } } })).toBe(
      SPACEWAR_APP_ID,
    );
    expect(resolveSteamAppId({ packagedMetadata: { wocDesktop: { steamAppId: '0' } } })).toBe(
      SPACEWAR_APP_ID,
    );
    expect(resolveSteamAppId({ env: { WOC_STEAM_APP_ID: '0' }, isPackaged: false })).toBe(
      SPACEWAR_APP_ID,
    );
    expect(resolveSteamAppId({ env: { WOC_STEAM_APP_ID: '00' }, isPackaged: false })).toBe(
      SPACEWAR_APP_ID,
    );
  });
});

describe('createSteamShell', () => {
  it('website build: never loads steamworks.js and answers null', async () => {
    const requireSteamworks = vi.fn();
    const shell = createSteamShell({
      distribution: 'website',
      env: {},
      isPackaged: true,
      requireSteamworks,
    });
    expect(shell.enabled).toBe(false);
    await expect(shell.getLinkTicket()).resolves.toBeNull();
    expect(requireSteamworks).not.toHaveBeenCalled();
  });

  it('steam build: lazy-inits once with the stamped app id and returns the hex ticket', async () => {
    const fake = fakeSteamworks(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
    const shell = createSteamShell({
      distribution: 'steam',
      packagedMetadata: { wocDesktop: { steamAppId: '3140820' } },
      env: {},
      isPackaged: true,
      requireSteamworks: () => fake.module,
    });
    // The capability main.cjs exposes to the renderer (desktop-steam-capability).
    expect(shell.enabled).toBe(true);
    await expect(shell.getLinkTicket()).resolves.toBe('deadbeef');
    await expect(shell.getLinkTicket()).resolves.toBe('deadbeef');
    expect(fake.init).toHaveBeenCalledTimes(1);
    expect(fake.init).toHaveBeenCalledWith(3140820);
    expect(fake.getAuthTicketForWebApi).toHaveBeenCalledWith(LINK_TICKET_IDENTITY);
  });

  it('pins the link identity both ends verify with', () => {
    expect(LINK_TICKET_IDENTITY).toBe('wocc-link');
  });

  it('dev loop: WOC_STEAM_DEV=1 on an unpackaged checkout inits with Spacewar', async () => {
    const fake = fakeSteamworks();
    const shell = createSteamShell({
      distribution: 'website',
      env: { WOC_STEAM_DEV: '1' },
      isPackaged: false,
      requireSteamworks: () => fake.module,
    });
    await shell.getLinkTicket();
    expect(fake.init).toHaveBeenCalledWith(SPACEWAR_APP_ID);
  });

  it('init failure (Steam not running) answers null and RETRIES on the next click', async () => {
    const log = { warn: vi.fn() };
    const good = fakeSteamworks();
    let calls = 0;
    const shell = createSteamShell({
      distribution: 'steam',
      env: {},
      isPackaged: true,
      log,
      requireSteamworks: () => ({
        init: (appId: number) => {
          calls++;
          if (calls === 1) throw new Error('SteamAPI_Init failed');
          return good.module.init(appId);
        },
      }),
    });
    await expect(shell.getLinkTicket()).resolves.toBeNull();
    expect(log.warn).toHaveBeenCalledTimes(1);
    // The player starts Steam and clicks Link again: no relaunch needed.
    await expect(shell.getLinkTicket()).resolves.toBe('abcd');
  });

  it('a throwing or empty ticket call answers null, never a rejection across IPC', async () => {
    const throwing = createSteamShell({
      distribution: 'steam',
      env: {},
      isPackaged: true,
      requireSteamworks: () => ({
        init: () => ({
          auth: {
            getAuthTicketForWebApi: async () => {
              throw new Error('ticket refused');
            },
          },
        }),
      }),
    });
    await expect(throwing.getLinkTicket()).resolves.toBeNull();

    const empty = fakeSteamworks(Buffer.alloc(0));
    const emptyShell = createSteamShell({
      distribution: 'steam',
      env: {},
      isPackaged: true,
      requireSteamworks: () => empty.module,
    });
    await expect(emptyShell.getLinkTicket()).resolves.toBeNull();

    const noApi = createSteamShell({
      distribution: 'steam',
      env: {},
      isPackaged: true,
      requireSteamworks: () => ({ init: () => ({ auth: {} }) }),
    });
    await expect(noApi.getLinkTicket()).resolves.toBeNull();
  });

  it('a new mint cancels the superseded ticket, and only the superseded one', async () => {
    const fake = fakeSteamworks();
    const shell = createSteamShell({
      distribution: 'steam',
      env: {},
      isPackaged: true,
      requireSteamworks: () => fake.module,
    });
    // The live ticket is NOT cancelled while the server may still be
    // verifying it (the shell never learns when that finishes).
    await expect(shell.getLinkTicket()).resolves.toBe('abcd');
    expect(fake.tickets[0].cancel).not.toHaveBeenCalled();
    // The next click supersedes it: exactly the old handle is cancelled.
    await expect(shell.getLinkTicket()).resolves.toBe('abcd');
    expect(fake.tickets[0].cancel).toHaveBeenCalledTimes(1);
    expect(fake.tickets[1].cancel).not.toHaveBeenCalled();
  });

  it('an empty ticket is cancelled on the spot (it never reaches the server)', async () => {
    const fake = fakeSteamworks(Buffer.alloc(0));
    const shell = createSteamShell({
      distribution: 'steam',
      env: {},
      isPackaged: true,
      requireSteamworks: () => fake.module,
    });
    await expect(shell.getLinkTicket()).resolves.toBeNull();
    expect(fake.tickets[0].cancel).toHaveBeenCalledTimes(1);
    // The dead handle is not retained: the next mint cancels nothing extra.
    await expect(shell.getLinkTicket()).resolves.toBeNull();
    expect(fake.tickets[0].cancel).toHaveBeenCalledTimes(1);
    expect(fake.tickets[1].cancel).toHaveBeenCalledTimes(1);
  });

  it('a throwing or absent cancel never surfaces across IPC', async () => {
    const fake = fakeSteamworks();
    const shell = createSteamShell({
      distribution: 'steam',
      env: {},
      isPackaged: true,
      requireSteamworks: () => fake.module,
    });
    await expect(shell.getLinkTicket()).resolves.toBe('abcd');
    fake.tickets[0].cancel.mockImplementation(() => {
      throw new Error('cancel refused');
    });
    await expect(shell.getLinkTicket()).resolves.toBe('abcd');
    expect(fake.tickets[0].cancel).toHaveBeenCalledTimes(1);
    // A ticket without cancel (an older binding shape) is tolerated too.
    const bare = createSteamShell({
      distribution: 'steam',
      env: {},
      isPackaged: true,
      requireSteamworks: () => ({
        init: () => ({
          auth: { getAuthTicketForWebApi: async () => ({ getBytes: () => Buffer.from([0x01]) }) },
        }),
      }),
    });
    await expect(bare.getLinkTicket()).resolves.toBe('01');
    await expect(bare.getLinkTicket()).resolves.toBe('01');
  });
});

describe('cancelLinkTicket (Valve CancelAuthTicket on link settle)', () => {
  const steamShell = () => {
    const fake = fakeSteamworks();
    const shell = createSteamShell({
      distribution: 'steam',
      env: {},
      isPackaged: true,
      requireSteamworks: () => fake.module,
    });
    return { fake, shell };
  };

  it('cancels the live handle, nulls the slot, and leaves no stale supersede', async () => {
    const { fake, shell } = steamShell();
    await expect(shell.getLinkTicket()).resolves.toBe('abcd');
    // The renderer reports the attempt settled: the live handle is cancelled now,
    // not deferred to the next mint or process exit.
    shell.cancelLinkTicket();
    expect(fake.tickets[0].cancel).toHaveBeenCalledTimes(1);
    // The slot is nulled, so the NEXT mint has nothing stale to supersede-cancel
    // (a double-cancel of the just-settled handle would otherwise be possible).
    await expect(shell.getLinkTicket()).resolves.toBe('abcd');
    expect(fake.tickets[0].cancel).toHaveBeenCalledTimes(1);
    expect(fake.tickets[1].cancel).not.toHaveBeenCalled();
  });

  it('is idempotent and a no-op with no live handle', async () => {
    const { fake, shell } = steamShell();
    // No handle minted yet: a settle signal is harmless.
    expect(() => shell.cancelLinkTicket()).not.toThrow();
    await expect(shell.getLinkTicket()).resolves.toBe('abcd');
    shell.cancelLinkTicket();
    shell.cancelLinkTicket(); // a repeat signal cancels nothing extra
    expect(fake.tickets[0].cancel).toHaveBeenCalledTimes(1);
  });

  it('never throws when cancel throws or the handle lacks cancel', async () => {
    const { fake, shell } = steamShell();
    await expect(shell.getLinkTicket()).resolves.toBe('abcd');
    fake.tickets[0].cancel.mockImplementation(() => {
      throw new Error('cancel refused');
    });
    expect(() => shell.cancelLinkTicket()).not.toThrow();
    // A ticket shape without cancel (an older binding) is tolerated too.
    const bare = createSteamShell({
      distribution: 'steam',
      env: {},
      isPackaged: true,
      requireSteamworks: () => ({
        init: () => ({
          auth: { getAuthTicketForWebApi: async () => ({ getBytes: () => Buffer.from([0x01]) }) },
        }),
      }),
    });
    await expect(bare.getLinkTicket()).resolves.toBe('01');
    expect(() => bare.cancelLinkTicket()).not.toThrow();
  });
});
