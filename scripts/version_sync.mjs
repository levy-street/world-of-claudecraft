#!/usr/bin/env node
// Sync the app version across the three release manifests so a single
// `npm version <x.y.z>` bumps all of them in one commit:
//   - package.json                                "version"           (npm owns this)
//   - android/app/build.gradle                    versionName + versionCode
//   - ios/App/App.xcodeproj/project.pbxproj       MARKETING_VERSION + CURRENT_PROJECT_VERSION
//
// The marketing/semver string is copied verbatim; the native build numbers
// (versionCode / CURRENT_PROJECT_VERSION) are monotonically incremented, because
// the App Store and Play Store require a strictly higher build number on every
// upload even when the marketing version is unchanged (e.g. a resubmission).
//
// Pure string transforms live here and are unit-tested (tests/version_sync.test.ts);
// the file I/O at the bottom only runs when invoked as a CLI.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function setGradleVersionName(gradle, version) {
  if (!/^\s*versionName\s+"[^"]*"/m.test(gradle)) {
    throw new Error('version_sync: no versionName line found in build.gradle');
  }
  return gradle.replace(/(^\s*versionName\s+")[^"]*(")/m, `$1${version}$2`);
}

export function bumpGradleVersionCode(gradle) {
  const m = gradle.match(/^(\s*versionCode\s+)(\d+)/m);
  if (!m) throw new Error('version_sync: no versionCode line found in build.gradle');
  const next = Number(m[2]) + 1;
  return gradle.replace(/(^\s*versionCode\s+)\d+/m, `$1${next}`);
}

export function setMarketingVersion(pbxproj, version) {
  if (!/MARKETING_VERSION\s*=/.test(pbxproj)) {
    throw new Error('version_sync: no MARKETING_VERSION line found in project.pbxproj');
  }
  return pbxproj.replace(/(MARKETING_VERSION\s*=\s*)[^;]*(;)/g, `$1${version}$2`);
}

export function bumpCurrentProjectVersion(pbxproj) {
  const matches = [...pbxproj.matchAll(/CURRENT_PROJECT_VERSION\s*=\s*(\d+)\s*;/g)];
  if (matches.length === 0) {
    throw new Error('version_sync: no CURRENT_PROJECT_VERSION line found in project.pbxproj');
  }
  // One shared next value across all build configs, derived from the max so the
  // pair can never end up out of sync.
  const next = Math.max(...matches.map((m) => Number(m[1]))) + 1;
  return pbxproj.replace(/(CURRENT_PROJECT_VERSION\s*=\s*)\d+(\s*;)/g, `$1${next}$2`);
}

// Pure planner: given the target semver and current file contents, return the
// fully rewritten contents. No I/O, so tests can exercise the whole pipeline.
export function planVersionSync({ version, gradle, pbxproj }) {
  return {
    gradle: bumpGradleVersionCode(setGradleVersionName(gradle, version)),
    pbxproj: bumpCurrentProjectVersion(setMarketingVersion(pbxproj, version)),
  };
}

const GRADLE_PATH = 'android/app/build.gradle';
const PBXPROJ_PATH = 'ios/App/App.xcodeproj/project.pbxproj';

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  // Prefer an explicit CLI arg; otherwise use whatever version package.json holds
  // (npm has already written the new version by the time the `version` hook runs).
  const version = process.argv[2] ?? pkg.version;
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`version_sync: refusing to sync invalid version "${version}"`);
  }

  const gradlePath = resolve(root, GRADLE_PATH);
  const pbxprojPath = resolve(root, PBXPROJ_PATH);
  const plan = planVersionSync({
    version,
    gradle: readFileSync(gradlePath, 'utf8'),
    pbxproj: readFileSync(pbxprojPath, 'utf8'),
  });
  writeFileSync(gradlePath, plan.gradle);
  writeFileSync(pbxprojPath, plan.pbxproj);
  console.log(`version_sync: set native manifests to ${version} (build numbers bumped)`);
}

// Run only as a CLI, never on import (so tests stay pure).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
