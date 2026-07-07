import { describe, expect, it } from 'vitest';
import {
  resolveCrashSubmitUrl,
  resolveDesktopConfig,
  resolveDesktopOrigins,
  resolveDistribution,
  updaterAllowed,
} from '../electron/desktop_config.cjs';

const steamStamp = { wocDesktop: { distribution: 'steam' } };
const websiteStamp = { wocDesktop: { distribution: 'website' } };

describe('resolveDistribution', () => {
  it('reads the packaged wocDesktop stamp', () => {
    expect(resolveDistribution({ packagedMetadata: steamStamp })).toBe('steam');
    expect(resolveDistribution({ packagedMetadata: websiteStamp })).toBe('website');
  });

  it('lets WOC_DISTRIBUTION override the stamp on UNPACKAGED checkouts only', () => {
    expect(
      resolveDistribution({
        packagedMetadata: websiteStamp,
        env: { WOC_DISTRIBUTION: 'steam' },
        isPackaged: false,
      }),
    ).toBe('steam');
    expect(
      resolveDistribution({ packagedMetadata: steamStamp, env: { WOC_DISTRIBUTION: 'website' } }),
    ).toBe('website');
  });

  it('a PACKAGED build ignores the env override: the stamp is final (no updater escape hatch)', () => {
    expect(
      resolveDistribution({
        packagedMetadata: steamStamp,
        env: { WOC_DISTRIBUTION: 'website' },
        isPackaged: true,
      }),
    ).toBe('steam');
    const config = resolveDesktopConfig({
      packagedMetadata: steamStamp,
      env: { WOC_DISTRIBUTION: 'website' },
      isPackaged: true,
    });
    expect(config.distribution).toBe('steam');
    expect(config.updaterEnabled).toBe(false);
  });

  it('collapses unknown or missing values to website instead of throwing', () => {
    expect(resolveDistribution({})).toBe('website');
    expect(resolveDistribution()).toBe('website');
    expect(
      resolveDistribution({ packagedMetadata: { wocDesktop: { distribution: 'beta' } } }),
    ).toBe('website');
    expect(
      resolveDistribution({ packagedMetadata: steamStamp, env: { WOC_DISTRIBUTION: 'nonsense' } }),
    ).toBe('steam');
    expect(resolveDistribution({ packagedMetadata: { wocDesktop: { distribution: 42 } } })).toBe(
      'website',
    );
  });
});

describe('updaterAllowed (the Steam / dev double gate)', () => {
  it('allows only a packaged website build', () => {
    expect(updaterAllowed({ distribution: 'website', isPackaged: true })).toBe(true);
  });

  it('never allows a Steam build, packaged or not', () => {
    expect(updaterAllowed({ distribution: 'steam', isPackaged: true })).toBe(false);
    expect(updaterAllowed({ distribution: 'steam', isPackaged: false })).toBe(false);
  });

  it('never allows an unpackaged checkout, even forced to website', () => {
    expect(updaterAllowed({ distribution: 'website', isPackaged: false })).toBe(false);
    expect(updaterAllowed({ distribution: 'website', isPackaged: undefined })).toBe(false);
  });
});

describe('resolveCrashSubmitUrl', () => {
  it('accepts only https URLs, from env first then the stamp (unpackaged)', () => {
    expect(
      resolveCrashSubmitUrl({
        packagedMetadata: { wocDesktop: { crashSubmitUrl: 'https://crash.example.com/minidump' } },
      }),
    ).toBe('https://crash.example.com/minidump');
    expect(
      resolveCrashSubmitUrl({
        packagedMetadata: { wocDesktop: { crashSubmitUrl: 'https://stamped.example.com' } },
        env: { WOC_CRASH_SUBMIT_URL: 'https://env.example.com' },
        isPackaged: false,
      }),
    ).toBe('https://env.example.com');
  });

  it('a PACKAGED build ignores the env URL: minidump uploads cannot be redirected locally', () => {
    expect(
      resolveCrashSubmitUrl({
        packagedMetadata: { wocDesktop: { crashSubmitUrl: 'https://stamped.example.com' } },
        env: { WOC_CRASH_SUBMIT_URL: 'https://evil.example.com' },
        isPackaged: true,
      }),
    ).toBe('https://stamped.example.com');
    expect(
      resolveCrashSubmitUrl({
        env: { WOC_CRASH_SUBMIT_URL: 'https://evil.example.com' },
        isPackaged: true,
      }),
    ).toBe('');
  });

  it('rejects http, malformed, and missing values with the local-only empty string', () => {
    expect(
      resolveCrashSubmitUrl({
        packagedMetadata: { wocDesktop: { crashSubmitUrl: 'http://crash.example.com' } },
      }),
    ).toBe('');
    expect(resolveCrashSubmitUrl({ env: { WOC_CRASH_SUBMIT_URL: 'not a url' } })).toBe('');
    expect(resolveCrashSubmitUrl({})).toBe('');
    expect(resolveCrashSubmitUrl()).toBe('');
  });

  it('falls through an invalid env value to a valid stamp', () => {
    expect(
      resolveCrashSubmitUrl({
        packagedMetadata: { wocDesktop: { crashSubmitUrl: 'https://stamped.example.com' } },
        env: { WOC_CRASH_SUBMIT_URL: 'ftp://nope' },
      }),
    ).toBe('https://stamped.example.com');
  });
});

describe('resolveDesktopOrigins (the packaged-build VITE_DESKTOP_* hatch closure)', () => {
  const originStamp = {
    wocDesktop: {
      distribution: 'website',
      apiOrigin: 'https://stamped.example.com',
      loginOrigin: 'https://login.example.com',
    },
  };

  it('a PACKAGED build reads only the stamp: runtime env cannot widen the CSP or move login', () => {
    expect(
      resolveDesktopOrigins({
        packagedMetadata: originStamp,
        env: {
          VITE_DESKTOP_API_ORIGIN: 'https://evil.example.com',
          VITE_DESKTOP_LOGIN_ORIGIN: 'https://evil-login.example.com',
        },
        isPackaged: true,
      }),
    ).toEqual({
      apiOrigin: 'https://stamped.example.com',
      loginOrigin: 'https://login.example.com',
    });
  });

  it('an unpackaged checkout honors env first (local-server smoke builds)', () => {
    expect(
      resolveDesktopOrigins({
        packagedMetadata: originStamp,
        env: { VITE_DESKTOP_API_ORIGIN: 'http://localhost:8787' },
        isPackaged: false,
      }),
    ).toEqual({ apiOrigin: 'http://localhost:8787', loginOrigin: 'https://login.example.com' });
  });

  it('falls back to the production origin, and login falls back to the api origin', () => {
    expect(resolveDesktopOrigins({})).toEqual({
      apiOrigin: 'https://worldofclaudecraft.com',
      loginOrigin: 'https://worldofclaudecraft.com',
    });
    expect(resolveDesktopOrigins()).toEqual({
      apiOrigin: 'https://worldofclaudecraft.com',
      loginOrigin: 'https://worldofclaudecraft.com',
    });
    expect(
      resolveDesktopOrigins({
        packagedMetadata: { wocDesktop: { apiOrigin: 'https://api.example.com' } },
        isPackaged: true,
      }),
    ).toEqual({ apiOrigin: 'https://api.example.com', loginOrigin: 'https://api.example.com' });
  });
});

const defaultOrigins = {
  apiOrigin: 'https://worldofclaudecraft.com',
  loginOrigin: 'https://worldofclaudecraft.com',
};

describe('resolveDesktopConfig', () => {
  it('summarizes the packaged website build', () => {
    const config = resolveDesktopConfig({ packagedMetadata: websiteStamp, isPackaged: true });
    expect(config).toEqual({
      distribution: 'website',
      updaterEnabled: true,
      crashSubmitUrl: '',
      updateChannel: 'latest',
      ...defaultOrigins,
    });
  });

  it('summarizes the packaged Steam build with the updater hard off', () => {
    const config = resolveDesktopConfig({ packagedMetadata: steamStamp, isPackaged: true });
    expect(config).toEqual({
      distribution: 'steam',
      updaterEnabled: false,
      crashSubmitUrl: '',
      updateChannel: 'latest',
      ...defaultOrigins,
    });
  });

  it('keeps a bare dev checkout on website with the updater off', () => {
    const config = resolveDesktopConfig({ isPackaged: false });
    expect(config).toEqual({
      distribution: 'website',
      updaterEnabled: false,
      crashSubmitUrl: '',
      updateChannel: 'latest',
      ...defaultOrigins,
    });
  });

  it('derives the update channel from the baked origin: non-production reads the dev feed', () => {
    const dev = resolveDesktopConfig({
      packagedMetadata: {
        wocDesktop: { distribution: 'website', apiOrigin: 'https://dev.worldofclaudecraft.com' },
      },
      isPackaged: true,
    });
    expect(dev.updateChannel).toBe('dev');
    expect(dev.updaterEnabled).toBe(true);
    const smoke = resolveDesktopConfig({
      packagedMetadata: {
        wocDesktop: { distribution: 'website', apiOrigin: 'http://localhost:8787' },
      },
      isPackaged: true,
    });
    expect(smoke.updateChannel).toBe('dev');
    // No env hatch: a packaged build's channel follows its baked origin only.
    const forced = resolveDesktopConfig({
      packagedMetadata: {
        wocDesktop: { distribution: 'website', apiOrigin: 'https://dev.worldofclaudecraft.com' },
      },
      env: { VITE_DESKTOP_API_ORIGIN: 'https://worldofclaudecraft.com' },
      isPackaged: true,
    });
    expect(forced.updateChannel).toBe('dev');
  });
});
