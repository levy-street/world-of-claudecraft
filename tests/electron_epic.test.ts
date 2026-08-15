// The desktop shell's Epic facade (electron/epic.cjs): the
// distribution/dev gating (with the packaged-hatch closure), id
// resolution, lazy init with per-call retry, launcher exchange-code
// fallback, and the never-throws link-proof contract. Driven with injected
// fakes; no electron, no real EOS SDK.
import { describe, expect, it, vi } from 'vitest';
import {
  createEpicShell,
  epicIntegrationEnabled,
  parseLauncherExchangeCode,
  resolveEpicIds,
} from '../electron/epic.cjs';

/** A fake EOS adapter whose init returns a client minting `proof` strings.
 *  Handle-shaped results carry a cancel spy so settle/supersede contracts
 *  can be asserted. */
function fakeEos(proof: string | null = 'exchange-code-abc', handle = false) {
  const handles: Array<{ proof: string; cancel: ReturnType<typeof vi.fn> }> = [];
  const getLinkProof = vi.fn(async () => {
    if (proof === null) return null;
    if (!handle) return proof;
    const h = { proof, cancel: vi.fn() };
    handles.push(h);
    return h;
  });
  const init = vi.fn((_ids: { productId: string; deploymentId: string; clientId: string }) => ({
    getLinkProof,
  }));
  return { module: { init }, init, getLinkProof, handles };
}

describe('epicIntegrationEnabled', () => {
  it('is on for the epic distribution regardless of env or packaging', () => {
    expect(epicIntegrationEnabled({ distribution: 'epic', env: {}, isPackaged: true })).toBe(true);
    expect(epicIntegrationEnabled({ distribution: 'epic', env: {}, isPackaged: false })).toBe(true);
  });

  it('honors WOC_EPIC_DEV=1 on unpackaged checkouts only (the hatch closure)', () => {
    const env = { WOC_EPIC_DEV: '1' };
    expect(epicIntegrationEnabled({ distribution: 'website', env, isPackaged: false })).toBe(true);
    // A PACKAGED website build ignores the env var: an installed player build
    // can never be flipped into loading native Epic code by local env.
    expect(epicIntegrationEnabled({ distribution: 'website', env, isPackaged: true })).toBe(false);
    expect(epicIntegrationEnabled({ distribution: 'website', env: {}, isPackaged: false })).toBe(
      false,
    );
  });

  it('stays off for packaged steam and website without the unpackaged hatch', () => {
    expect(epicIntegrationEnabled({ distribution: 'steam', env: {}, isPackaged: true })).toBe(
      false,
    );
    expect(
      epicIntegrationEnabled({
        distribution: 'steam',
        env: { WOC_EPIC_DEV: '1' },
        isPackaged: true,
      }),
    ).toBe(false);
    expect(epicIntegrationEnabled({ distribution: 'website', env: {}, isPackaged: true })).toBe(
      false,
    );
  });
});

describe('resolveEpicIds', () => {
  it('prefers the wocDesktop stamp fields', () => {
    expect(
      resolveEpicIds({
        packagedMetadata: {
          wocDesktop: {
            epicProductId: 'prod-1',
            epicDeploymentId: 'dep-1',
            epicClientId: 'client-1',
          },
        },
      }),
    ).toEqual({ productId: 'prod-1', deploymentId: 'dep-1', clientId: 'client-1' });
  });

  it('falls back to WOC_EPIC_* on unpackaged checkouts only', () => {
    const env = {
      WOC_EPIC_PRODUCT_ID: 'env-prod',
      WOC_EPIC_DEPLOYMENT_ID: 'env-dep',
      WOC_EPIC_CLIENT_ID: 'env-client',
    };
    expect(resolveEpicIds({ env, isPackaged: false })).toEqual({
      productId: 'env-prod',
      deploymentId: 'env-dep',
      clientId: 'env-client',
    });
    // Packaged ignores env when the stamp is empty.
    expect(resolveEpicIds({ env, isPackaged: true })).toEqual({
      productId: '',
      deploymentId: '',
      clientId: '',
    });
  });

  it('trims whitespace and treats blank stamp/env as empty (no throw)', () => {
    expect(
      resolveEpicIds({
        packagedMetadata: {
          wocDesktop: {
            epicProductId: '  prod  ',
            epicDeploymentId: '   ',
            epicClientId: 'client',
          },
        },
      }),
    ).toEqual({ productId: 'prod', deploymentId: '', clientId: 'client' });
    expect(resolveEpicIds({})).toEqual({ productId: '', deploymentId: '', clientId: '' });
  });

  it('packaged stamp wins over unpackaged-only env (stamp final)', () => {
    expect(
      resolveEpicIds({
        packagedMetadata: {
          wocDesktop: {
            epicProductId: 'stamped-prod',
            epicDeploymentId: 'stamped-dep',
            epicClientId: 'stamped-client',
          },
        },
        env: {
          WOC_EPIC_PRODUCT_ID: 'env-prod',
          WOC_EPIC_DEPLOYMENT_ID: 'env-dep',
          WOC_EPIC_CLIENT_ID: 'env-client',
        },
        isPackaged: true,
      }),
    ).toEqual({
      productId: 'stamped-prod',
      deploymentId: 'stamped-dep',
      clientId: 'stamped-client',
    });
  });
});

describe('parseLauncherExchangeCode', () => {
  it('reads AUTH_PASSWORD when AUTH_TYPE is exchangecode (Epic launcher form)', () => {
    expect(
      parseLauncherExchangeCode([
        'game',
        '-AUTH_LOGIN=unused',
        '-AUTH_PASSWORD=ed642dfd4e6f47bf8354caf1bcab2fc2',
        '-AUTH_TYPE=exchangecode',
      ]),
    ).toBe('ed642dfd4e6f47bf8354caf1bcab2fc2');
  });

  it('accepts double-dash forms and rejects wrong type or empty password', () => {
    expect(parseLauncherExchangeCode(['--AUTH_TYPE=exchangecode', '--AUTH_PASSWORD=abc123'])).toBe(
      'abc123',
    );
    expect(parseLauncherExchangeCode(['-AUTH_TYPE=password', '-AUTH_PASSWORD=nope'])).toBeNull();
    expect(parseLauncherExchangeCode(['-AUTH_TYPE=exchangecode'])).toBeNull();
    expect(parseLauncherExchangeCode(null)).toBeNull();
    expect(parseLauncherExchangeCode([])).toBeNull();
  });
});

describe('createEpicShell', () => {
  it('website build: never loads EOS and answers null', async () => {
    const requireEos = vi.fn();
    const shell = createEpicShell({
      distribution: 'website',
      env: {},
      isPackaged: true,
      requireEos,
      readArgv: () => ['-AUTH_TYPE=exchangecode', '-AUTH_PASSWORD=should-not-use'],
    });
    expect(shell.enabled).toBe(false);
    await expect(shell.getLinkProof()).resolves.toBeNull();
    expect(requireEos).not.toHaveBeenCalled();
  });

  it('steam build: capability false and never loads EOS', async () => {
    const requireEos = vi.fn();
    const shell = createEpicShell({
      distribution: 'steam',
      env: {},
      isPackaged: true,
      requireEos,
    });
    expect(shell.enabled).toBe(false);
    await expect(shell.getLinkProof()).resolves.toBeNull();
    expect(requireEos).not.toHaveBeenCalled();
  });

  it('epic build: enabled true even when proof is null without native/adapter', async () => {
    const shell = createEpicShell({
      distribution: 'epic',
      packagedMetadata: {
        wocDesktop: {
          epicProductId: 'prod',
          epicDeploymentId: 'dep',
          epicClientId: 'client',
        },
      },
      env: {},
      isPackaged: true,
      // No requireEos: no native load attempt.
      readArgv: () => [],
    });
    expect(shell.enabled).toBe(true);
    expect(shell.productId).toBe('prod');
    expect(shell.deploymentId).toBe('dep');
    expect(shell.clientId).toBe('client');
    await expect(shell.getLinkProof()).resolves.toBeNull();
  });

  it('epic build: lazy-inits once with stamped ids and returns the adapter proof', async () => {
    const fake = fakeEos('id-token-proof');
    const shell = createEpicShell({
      distribution: 'epic',
      packagedMetadata: {
        wocDesktop: {
          epicProductId: 'prod-x',
          epicDeploymentId: 'dep-x',
          epicClientId: 'client-x',
        },
      },
      env: {},
      isPackaged: true,
      requireEos: () => fake.module,
    });
    expect(shell.enabled).toBe(true);
    await expect(shell.getLinkProof()).resolves.toBe('id-token-proof');
    await expect(shell.getLinkProof()).resolves.toBe('id-token-proof');
    expect(fake.init).toHaveBeenCalledTimes(1);
    expect(fake.init).toHaveBeenCalledWith({
      productId: 'prod-x',
      deploymentId: 'dep-x',
      clientId: 'client-x',
    });
  });

  it('epic without adapter: mints launcher exchange code from argv', async () => {
    const shell = createEpicShell({
      distribution: 'epic',
      env: {},
      isPackaged: true,
      readArgv: () => [
        '-AUTH_LOGIN=unused',
        '-AUTH_PASSWORD=launcher-exchange-99',
        '-AUTH_TYPE=exchangecode',
      ],
    });
    expect(shell.enabled).toBe(true);
    await expect(shell.getLinkProof()).resolves.toBe('launcher-exchange-99');
  });

  it('dev loop: WOC_EPIC_DEV=1 on an unpackaged checkout enables capability', async () => {
    const fake = fakeEos('dev-proof');
    const shell = createEpicShell({
      distribution: 'website',
      env: { WOC_EPIC_DEV: '1', WOC_EPIC_PRODUCT_ID: 'dev-prod' },
      isPackaged: false,
      requireEos: () => fake.module,
    });
    expect(shell.enabled).toBe(true);
    await expect(shell.getLinkProof()).resolves.toBe('dev-proof');
    expect(fake.init).toHaveBeenCalledWith({
      productId: 'dev-prod',
      deploymentId: '',
      clientId: '',
    });
  });

  it('init failure answers null and RETRIES on the next click', async () => {
    const log = { warn: vi.fn() };
    const good = fakeEos('recovered');
    let calls = 0;
    const shell = createEpicShell({
      distribution: 'epic',
      env: {},
      isPackaged: true,
      log,
      requireEos: () => ({
        init: (ids) => {
          calls++;
          if (calls === 1) throw new Error('EOS_Init failed');
          return good.module.init(ids);
        },
      }),
      readArgv: () => [],
    });
    await expect(shell.getLinkProof()).resolves.toBeNull();
    expect(log.warn).toHaveBeenCalledTimes(1);
    await expect(shell.getLinkProof()).resolves.toBe('recovered');
  });

  it('a throwing or empty proof call answers null, never a rejection across IPC', async () => {
    const throwing = createEpicShell({
      distribution: 'epic',
      env: {},
      isPackaged: true,
      requireEos: () => ({
        init: () => ({
          getLinkProof: async () => {
            throw new Error('proof refused');
          },
        }),
      }),
      readArgv: () => [],
    });
    await expect(throwing.getLinkProof()).resolves.toBeNull();

    const empty = createEpicShell({
      distribution: 'epic',
      env: {},
      isPackaged: true,
      requireEos: () => ({
        init: () => ({
          getLinkProof: async () => '',
        }),
      }),
      readArgv: () => [],
    });
    await expect(empty.getLinkProof()).resolves.toBeNull();

    const noApi = createEpicShell({
      distribution: 'epic',
      env: {},
      isPackaged: true,
      requireEos: () => ({ init: () => ({}) }),
      readArgv: () => [],
    });
    await expect(noApi.getLinkProof()).resolves.toBeNull();
  });

  it('a new mint cancels the superseded handle, and only the superseded one', async () => {
    const fake = fakeEos('handle-proof', true);
    const shell = createEpicShell({
      distribution: 'epic',
      env: {},
      isPackaged: true,
      requireEos: () => fake.module,
    });
    await expect(shell.getLinkProof()).resolves.toBe('handle-proof');
    expect(fake.handles[0].cancel).not.toHaveBeenCalled();
    await expect(shell.getLinkProof()).resolves.toBe('handle-proof');
    expect(fake.handles[0].cancel).toHaveBeenCalledTimes(1);
    expect(fake.handles[1].cancel).not.toHaveBeenCalled();
  });

  it('empty adapter proof falls through to argv exchange code', async () => {
    const shell = createEpicShell({
      distribution: 'epic',
      env: {},
      isPackaged: true,
      requireEos: () => ({
        init: () => ({
          getLinkProof: async () => null,
        }),
      }),
      readArgv: () => ['-AUTH_TYPE=exchangecode', '-AUTH_PASSWORD=from-argv'],
    });
    await expect(shell.getLinkProof()).resolves.toBe('from-argv');
  });
});

describe('cancelLinkProof (settle cleanup)', () => {
  const epicShell = () => {
    const fake = fakeEos('settle-proof', true);
    const shell = createEpicShell({
      distribution: 'epic',
      env: {},
      isPackaged: true,
      requireEos: () => fake.module,
    });
    return { fake, shell };
  };

  it('cancels the live handle, nulls the slot, and leaves no stale supersede', async () => {
    const { fake, shell } = epicShell();
    await expect(shell.getLinkProof()).resolves.toBe('settle-proof');
    shell.cancelLinkProof();
    expect(fake.handles[0].cancel).toHaveBeenCalledTimes(1);
    await expect(shell.getLinkProof()).resolves.toBe('settle-proof');
    expect(fake.handles[0].cancel).toHaveBeenCalledTimes(1);
    expect(fake.handles[1].cancel).not.toHaveBeenCalled();
  });

  it('is idempotent and a no-op with no live handle', async () => {
    const { fake, shell } = epicShell();
    expect(() => shell.cancelLinkProof()).not.toThrow();
    await expect(shell.getLinkProof()).resolves.toBe('settle-proof');
    shell.cancelLinkProof();
    shell.cancelLinkProof();
    expect(fake.handles[0].cancel).toHaveBeenCalledTimes(1);
  });

  it('never throws when cancel throws or the handle lacks cancel', async () => {
    const { fake, shell } = epicShell();
    await expect(shell.getLinkProof()).resolves.toBe('settle-proof');
    fake.handles[0].cancel.mockImplementation(() => {
      throw new Error('cancel refused');
    });
    expect(() => shell.cancelLinkProof()).not.toThrow();

    const bare = createEpicShell({
      distribution: 'epic',
      env: {},
      isPackaged: true,
      requireEos: () => ({
        init: () => ({
          getLinkProof: async () => ({ proof: 'bare-proof' }),
        }),
      }),
    });
    await expect(bare.getLinkProof()).resolves.toBe('bare-proof');
    expect(() => bare.cancelLinkProof()).not.toThrow();
  });
});
