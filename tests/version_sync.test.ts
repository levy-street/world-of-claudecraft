import { describe, expect, it } from 'vitest';
import {
  bumpCurrentProjectVersion,
  bumpGradleVersionCode,
  planVersionSync,
  setGradleVersionName,
  setMarketingVersion,
} from '../scripts/version_sync.mjs';

const GRADLE = `    defaultConfig {
        applicationId "com.worldofclaudecraft"
        versionCode 4
        versionName "0.14.0"
        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"
    }`;

const PBXPROJ = `\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCURRENT_PROJECT_VERSION = 4;
\t\t\t\tMARKETING_VERSION = 0.14.0;
\t\t\t\tASSET = foo;
\t\t\t\tCURRENT_PROJECT_VERSION = 4;
\t\t\t\tMARKETING_VERSION = 0.14.0;`;

describe('setGradleVersionName', () => {
  it('rewrites versionName to the target semver, leaving versionCode untouched', () => {
    const out = setGradleVersionName(GRADLE, '0.15.0');
    expect(out).toContain('versionName "0.15.0"');
    expect(out).toContain('versionCode 4');
  });

  it('preserves indentation and surrounding lines', () => {
    const out = setGradleVersionName(GRADLE, '1.2.3');
    expect(out).toContain('        versionName "1.2.3"');
    expect(out).toContain('applicationId "com.worldofclaudecraft"');
  });

  it('throws if no versionName line exists (fail loud, never silently no-op)', () => {
    expect(() => setGradleVersionName('versionCode 4', '0.15.0')).toThrow(/versionName/);
  });
});

describe('bumpGradleVersionCode', () => {
  it('increments the integer build number by one', () => {
    const out = bumpGradleVersionCode(GRADLE);
    expect(out).toContain('versionCode 5');
    expect(out).toContain('versionName "0.14.0"');
  });

  it('throws if no versionCode line exists', () => {
    expect(() => bumpGradleVersionCode('versionName "0.14.0"')).toThrow(/versionCode/);
  });
});

describe('setMarketingVersion', () => {
  it('rewrites every MARKETING_VERSION occurrence (Debug + Release configs)', () => {
    const out = setMarketingVersion(PBXPROJ, '0.15.0');
    expect(out.match(/MARKETING_VERSION = 0\.15\.0;/g)).toHaveLength(2);
    expect(out).not.toContain('MARKETING_VERSION = 0.14.0;');
  });

  it('throws if no MARKETING_VERSION line exists', () => {
    expect(() => setMarketingVersion('CURRENT_PROJECT_VERSION = 4;', '0.15.0')).toThrow(
      /MARKETING_VERSION/,
    );
  });
});

describe('bumpCurrentProjectVersion', () => {
  it('increments every CURRENT_PROJECT_VERSION occurrence to the same next value', () => {
    const out = bumpCurrentProjectVersion(PBXPROJ);
    expect(out.match(/CURRENT_PROJECT_VERSION = 5;/g)).toHaveLength(2);
    expect(out).not.toContain('CURRENT_PROJECT_VERSION = 4;');
  });

  it('uses one shared next value even if occurrences were out of sync (max + 1)', () => {
    const skewed = 'CURRENT_PROJECT_VERSION = 4;\nCURRENT_PROJECT_VERSION = 7;';
    const out = bumpCurrentProjectVersion(skewed);
    expect(out.match(/CURRENT_PROJECT_VERSION = 8;/g)).toHaveLength(2);
  });

  it('throws if no CURRENT_PROJECT_VERSION line exists', () => {
    expect(() => bumpCurrentProjectVersion('MARKETING_VERSION = 0.14.0;')).toThrow(
      /CURRENT_PROJECT_VERSION/,
    );
  });
});

describe('planVersionSync', () => {
  it('produces fully synced gradle and pbxproj for a new semver', () => {
    const plan = planVersionSync({ version: '0.15.0', gradle: GRADLE, pbxproj: PBXPROJ });
    expect(plan.gradle).toContain('versionName "0.15.0"');
    expect(plan.gradle).toContain('versionCode 5');
    expect(plan.pbxproj.match(/MARKETING_VERSION = 0\.15\.0;/g)).toHaveLength(2);
    expect(plan.pbxproj.match(/CURRENT_PROJECT_VERSION = 5;/g)).toHaveLength(2);
  });
});
