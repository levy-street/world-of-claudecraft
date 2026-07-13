import { describe, expect, it } from 'vitest';
import {
  collectReleaseVersionFailures,
  inferExpectedReleaseVersion,
  planReleaseVersion,
  setDesktopDownloadVersion,
  setDesktopModuleVersion,
  setGameVersionText,
  setPackageLockVersion,
  setPackageVersion,
  setReadmeVersionBadge,
} from '../scripts/release_version.mjs';

const PACKAGE_JSON = JSON.stringify(
  {
    name: 'world-of-claudecraft',
    version: '0.20.0',
    private: true,
  },
  null,
  2,
);

const PACKAGE_LOCK = JSON.stringify(
  {
    name: 'world-of-claudecraft',
    version: '0.20.0',
    lockfileVersion: 3,
    packages: {
      '': {
        name: 'world-of-claudecraft',
        version: '0.20.0',
      },
      'node_modules/example': {
        version: '9.9.9',
      },
    },
  },
  null,
  2,
);

const GRADLE = `android {
    defaultConfig {
        versionCode 4
        versionName "0.20.0"
    }
}`;

const PBXPROJ = `CURRENT_PROJECT_VERSION = 4;
MARKETING_VERSION = 0.20.0;
CURRENT_PROJECT_VERSION = 4;
MARKETING_VERSION = 0.20.0;`;

const INDEX_HTML = `<a href="https://updates.worldofclaudecraft.com/desktop/world-of-claudecraft-0.20.0-mac-universal.dmg">Download</a>
<a href="https://updates.worldofclaudecraft.com/desktop/world-of-claudecraft-0.20.0-linux-x86_64.AppImage">Download</a>
<div id="game-version">v0.10</div>`;

// play.html links only the mac dmg; the Linux link is index.html-only, so the
// transforms and checks must tolerate its absence.
const PLAY_HTML = `<a href="https://updates.worldofclaudecraft.com/desktop/world-of-claudecraft-0.20.0-mac-universal.dmg">Download</a>
<div id="game-version">v0.10</div>`;

const DESKTOP_TS = `export const DESKTOP_VERSION = '0.20.0';
const DESKTOP_HOST = 'https://updates.worldofclaudecraft.com/desktop';`;

const README_MD = `[![Version](https://img.shields.io/badge/version-0.20.0-blue)](package.json)`;

describe('inferExpectedReleaseVersion', () => {
  it('prefers an explicit semver argument', () => {
    expect(
      inferExpectedReleaseVersion({
        argv: ['--version', '0.21.0'],
        env: { GITHUB_HEAD_REF: 'release/v0.20.0' },
      }),
    ).toBe('0.21.0');
  });

  it('derives the expected version from release branch refs', () => {
    expect(
      inferExpectedReleaseVersion({
        argv: [],
        env: { GITHUB_HEAD_REF: 'release/v0.21.0' },
      }),
    ).toBe('0.21.0');
    expect(
      inferExpectedReleaseVersion({
        argv: [],
        env: { GITHUB_REF: 'refs/heads/release/v1.2.3' },
      }),
    ).toBe('1.2.3');
  });

  it('derives the base version from a suffixed release integration branch', () => {
    expect(
      inferExpectedReleaseVersion({
        argv: [],
        env: { GITHUB_REF: 'refs/heads/release/v0.23.0-mobile-fixes' },
      }),
    ).toBe('0.23.0');
  });

  it('fails loudly when no release version can be inferred', () => {
    expect(() =>
      inferExpectedReleaseVersion({
        argv: [],
        env: { GITHUB_HEAD_REF: 'feature/desktop-launcher-download' },
      }),
    ).toThrow(/release\/vX\.Y\.Z/);
  });
});

describe('release version transforms', () => {
  it('updates package.json without disturbing surrounding fields', () => {
    const out = JSON.parse(setPackageVersion(PACKAGE_JSON, '0.21.0'));
    expect(out.version).toBe('0.21.0');
    expect(out.name).toBe('world-of-claudecraft');
    expect(out.private).toBe(true);
  });

  it('updates the root package lock versions only', () => {
    const out = JSON.parse(setPackageLockVersion(PACKAGE_LOCK, '0.21.0'));
    expect(out.version).toBe('0.21.0');
    expect(out.packages[''].version).toBe('0.21.0');
    expect(out.packages['node_modules/example'].version).toBe('9.9.9');
  });

  it('updates macOS desktop artifact links', () => {
    const out = setDesktopDownloadVersion(INDEX_HTML, '0.21.0', 'index.html');
    expect(out).toContain('world-of-claudecraft-0.21.0-mac-universal.dmg');
    expect(out).not.toContain('world-of-claudecraft-0.20.0-mac-universal.dmg');
  });

  it('updates Linux AppImage artifact links where present', () => {
    const out = setDesktopDownloadVersion(INDEX_HTML, '0.21.0', 'index.html');
    expect(out).toContain('world-of-claudecraft-0.21.0-linux-x86_64.AppImage');
    expect(out).not.toContain('world-of-claudecraft-0.20.0-linux-x86_64.AppImage');
  });

  it('tolerates pages without a Linux link (play.html)', () => {
    const out = setDesktopDownloadVersion(PLAY_HTML, '0.21.0', 'play.html');
    expect(out).toContain('world-of-claudecraft-0.21.0-mac-universal.dmg');
    expect(out).not.toContain('AppImage');
  });

  it('updates DESKTOP_VERSION in the desktop download module', () => {
    const out = setDesktopModuleVersion(DESKTOP_TS, '0.21.0', 'src/game/desktop_download.ts');
    expect(out).toContain("export const DESKTOP_VERSION = '0.21.0';");
    expect(out).not.toContain('0.20.0');
  });

  it('updates README version badges', () => {
    const out = setReadmeVersionBadge(README_MD, '0.21.0', 'README.md');
    expect(out).toContain('version-0.21.0-blue');
    expect(out).not.toContain('version-0.20.0-blue');
  });

  it('fails loudly when a README has no version badge', () => {
    expect(() => setReadmeVersionBadge('# World of ClaudeCraft', '0.21.0', 'README.md')).toThrow(
      /version badge/,
    );
  });

  it('fails loudly when the module has no DESKTOP_VERSION constant', () => {
    expect(() => setDesktopModuleVersion('const x = 1;', '0.21.0', 'desktop_download.ts')).toThrow(
      /DESKTOP_VERSION/,
    );
  });

  it('updates the visible page version text', () => {
    const out = setGameVersionText(INDEX_HTML, '0.21.0', 'index.html');
    expect(out).toContain('<div id="game-version">v0.21.0</div>');
  });
});

describe('planReleaseVersion', () => {
  it('prepares every release version surface for the target semver', () => {
    const plan = planReleaseVersion({
      version: '0.21.0',
      packageJson: PACKAGE_JSON,
      packageLock: PACKAGE_LOCK,
      gradle: GRADLE,
      pbxproj: PBXPROJ,
      desktopModule: DESKTOP_TS,
      htmlFiles: {
        'index.html': INDEX_HTML,
        'play.html': PLAY_HTML,
      },
      readmeFiles: {
        'README.md': README_MD,
      },
    });

    expect(JSON.parse(plan.packageJson).version).toBe('0.21.0');
    expect(JSON.parse(plan.packageLock).packages[''].version).toBe('0.21.0');
    expect(plan.gradle).toContain('versionName "0.21.0"');
    expect(plan.pbxproj.match(/MARKETING_VERSION = 0\.21\.0;/g)).toHaveLength(2);
    expect(plan.htmlFiles['index.html']).toContain('world-of-claudecraft-0.21.0-mac-universal.dmg');
    expect(plan.htmlFiles['index.html']).toContain(
      'world-of-claudecraft-0.21.0-linux-x86_64.AppImage',
    );
    expect(plan.htmlFiles['play.html']).toContain('<div id="game-version">v0.21.0</div>');
    expect(plan.desktopModule).toContain("export const DESKTOP_VERSION = '0.21.0';");
    expect(plan.readmeFiles['README.md']).toContain('version-0.21.0-blue');
  });
});

describe('collectReleaseVersionFailures', () => {
  it('reports stale release surfaces', () => {
    const failures = collectReleaseVersionFailures({
      version: '0.21.0',
      packageJson: PACKAGE_JSON,
      packageLock: PACKAGE_LOCK,
      gradle: GRADLE,
      pbxproj: PBXPROJ,
      desktopModule: DESKTOP_TS,
      htmlFiles: {
        'index.html': INDEX_HTML,
        'play.html': '<div class="coming-soon-badge">Coming Soon...</div>',
      },
      readmeFiles: {
        'README.md': README_MD,
      },
    });

    expect(failures).toEqual(
      expect.arrayContaining([
        'package.json version is 0.20.0, expected 0.21.0',
        'package-lock.json root version is 0.20.0, expected 0.21.0',
        'android/app/build.gradle versionName is 0.20.0, expected 0.21.0',
        'ios/App/App.xcodeproj/project.pbxproj MARKETING_VERSION includes 0.20.0, expected all 0.21.0',
        'index.html game-version is v0.10, expected v0.21.0',
        'index.html has a stale Linux desktop download URL, expected 0.21.0',
        'src/game/desktop_download.ts DESKTOP_VERSION is 0.20.0, expected 0.21.0',
        'play.html is missing the macOS desktop download URL for 0.21.0',
        'play.html still contains Coming Soon in the download panel',
        'README.md version badge includes 0.20.0, expected all 0.21.0',
      ]),
    );
  });

  it('does not require a Linux link on pages that never had one', () => {
    const failures = collectReleaseVersionFailures({
      version: '0.20.0',
      packageJson: PACKAGE_JSON,
      packageLock: PACKAGE_LOCK,
      gradle: GRADLE,
      pbxproj: PBXPROJ,
      desktopModule: DESKTOP_TS,
      htmlFiles: {
        'play.html': PLAY_HTML,
      },
      readmeFiles: {
        'README.md': README_MD,
      },
    });

    expect(failures.filter((failure) => failure.includes('Linux'))).toEqual([]);
  });
});
