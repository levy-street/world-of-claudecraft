#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planVersionSync } from './version_sync.mjs';

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const RELEASE_REF_RE = /(?:^|refs\/heads\/)release\/v?(\d+\.\d+\.\d+)$/;
const MAC_DMG_RE = /world-of-claudecraft-\d+\.\d+\.\d+-mac-universal\.dmg/g;
const GAME_VERSION_RE = /(<div\b[^>]*\bid=["']game-version["'][^>]*>)v[^<]*(<\/div>)/;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PATHS = {
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  gradle: 'android/app/build.gradle',
  pbxproj: 'ios/App/App.xcodeproj/project.pbxproj',
  htmlFiles: ['index.html', 'play.html'],
};

function parseJson(text, path) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err.message}`);
  }
}

function stringifyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeVersion(version) {
  const normalized = version?.startsWith('v') ? version.slice(1) : version;
  if (!VERSION_RE.test(normalized ?? '')) {
    throw new Error(`Invalid release version "${version}". Expected X.Y.Z.`);
  }
  return normalized;
}

function versionFromRef(ref) {
  const match = ref?.match(RELEASE_REF_RE);
  return match ? match[1] : null;
}

export function inferExpectedReleaseVersion({ argv = [], env = process.env } = {}) {
  const versionFlagIndex = argv.indexOf('--version');
  if (versionFlagIndex !== -1) {
    return normalizeVersion(argv[versionFlagIndex + 1]);
  }

  const explicit = argv.find((arg) => VERSION_RE.test(arg) || /^v\d+\.\d+\.\d+$/.test(arg));
  if (explicit) return normalizeVersion(explicit);

  const fromEnv =
    versionFromRef(env.GITHUB_HEAD_REF) ??
    versionFromRef(env.GITHUB_REF_NAME) ??
    versionFromRef(env.GITHUB_REF);
  if (fromEnv) return fromEnv;

  throw new Error(
    'Could not infer release version. Run from release/vX.Y.Z or pass --version X.Y.Z.',
  );
}

export function setPackageVersion(packageJson, version) {
  const pkg = parseJson(packageJson, 'package.json');
  pkg.version = normalizeVersion(version);
  return stringifyJson(pkg);
}

export function setPackageLockVersion(packageLock, version) {
  const lock = parseJson(packageLock, 'package-lock.json');
  lock.version = normalizeVersion(version);
  if (lock.packages?.['']) {
    lock.packages[''].version = normalizeVersion(version);
  }
  return stringifyJson(lock);
}

export function setDesktopDownloadVersion(html, version, path) {
  if (!MAC_DMG_RE.test(html)) {
    throw new Error(`${path} is missing a macOS desktop download URL`);
  }
  MAC_DMG_RE.lastIndex = 0;
  return html.replace(
    MAC_DMG_RE,
    `world-of-claudecraft-${normalizeVersion(version)}-mac-universal.dmg`,
  );
}

export function setGameVersionText(html, version, path) {
  if (!GAME_VERSION_RE.test(html)) {
    throw new Error(`${path} is missing #game-version`);
  }
  return html.replace(GAME_VERSION_RE, `$1v${normalizeVersion(version)}$2`);
}

export function planReleaseVersion({
  version,
  packageJson,
  packageLock,
  gradle,
  pbxproj,
  htmlFiles,
}) {
  const normalized = normalizeVersion(version);
  const nativePlan = planVersionSync({ version: normalized, gradle, pbxproj });
  const nextHtmlFiles = Object.fromEntries(
    Object.entries(htmlFiles).map(([path, html]) => [
      path,
      setGameVersionText(setDesktopDownloadVersion(html, normalized, path), normalized, path),
    ]),
  );

  return {
    packageJson: setPackageVersion(packageJson, normalized),
    packageLock: setPackageLockVersion(packageLock, normalized),
    gradle: nativePlan.gradle,
    pbxproj: nativePlan.pbxproj,
    htmlFiles: nextHtmlFiles,
  };
}

function readPackageVersion(packageJson) {
  return parseJson(packageJson, 'package.json').version;
}

function readPackageLockVersions(packageLock) {
  const lock = parseJson(packageLock, 'package-lock.json');
  return {
    root: lock.version,
    packageRoot: lock.packages?.['']?.version,
  };
}

function readGradleVersionName(gradle) {
  return gradle.match(/^\s*versionName\s+"([^"]+)"/m)?.[1] ?? null;
}

function readMarketingVersions(pbxproj) {
  return [...pbxproj.matchAll(/MARKETING_VERSION\s*=\s*([^;]+)\s*;/g)].map((match) =>
    match[1].trim(),
  );
}

function readGameVersion(html) {
  return html.match(GAME_VERSION_RE)?.[0].match(/>v([^<]+)</)?.[1] ?? null;
}

export function collectReleaseVersionFailures({
  version,
  packageJson,
  packageLock,
  gradle,
  pbxproj,
  htmlFiles,
}) {
  const expected = normalizeVersion(version);
  const failures = [];

  const pkgVersion = readPackageVersion(packageJson);
  if (pkgVersion !== expected) {
    failures.push(`package.json version is ${pkgVersion}, expected ${expected}`);
  }

  const lockVersions = readPackageLockVersions(packageLock);
  if (lockVersions.root !== expected) {
    failures.push(`package-lock.json root version is ${lockVersions.root}, expected ${expected}`);
  }
  if (lockVersions.packageRoot !== expected) {
    failures.push(
      `package-lock.json packages[""] version is ${lockVersions.packageRoot}, expected ${expected}`,
    );
  }

  const gradleVersion = readGradleVersionName(gradle);
  if (gradleVersion !== expected) {
    failures.push(`android/app/build.gradle versionName is ${gradleVersion}, expected ${expected}`);
  }

  const marketingVersions = readMarketingVersions(pbxproj);
  if (marketingVersions.length === 0) {
    failures.push('ios/App/App.xcodeproj/project.pbxproj has no MARKETING_VERSION entries');
  } else {
    const staleMarketing = marketingVersions.find(
      (marketingVersion) => marketingVersion !== expected,
    );
    if (staleMarketing) {
      failures.push(
        `ios/App/App.xcodeproj/project.pbxproj MARKETING_VERSION includes ${staleMarketing}, expected all ${expected}`,
      );
    }
  }

  const expectedArtifact = `world-of-claudecraft-${expected}-mac-universal.dmg`;
  for (const [path, html] of Object.entries(htmlFiles)) {
    const gameVersion = readGameVersion(html);
    if (gameVersion !== expected) {
      failures.push(`${path} game-version is v${gameVersion}, expected v${expected}`);
    }
    if (!html.includes(expectedArtifact)) {
      failures.push(`${path} is missing the macOS desktop download URL for ${expected}`);
    }
    if (/coming soon/i.test(html)) {
      failures.push(`${path} still contains Coming Soon in the download panel`);
    }
  }

  return failures;
}

function readReleaseFiles() {
  return {
    packageJson: readFileSync(resolve(ROOT, PATHS.packageJson), 'utf8'),
    packageLock: readFileSync(resolve(ROOT, PATHS.packageLock), 'utf8'),
    gradle: readFileSync(resolve(ROOT, PATHS.gradle), 'utf8'),
    pbxproj: readFileSync(resolve(ROOT, PATHS.pbxproj), 'utf8'),
    htmlFiles: Object.fromEntries(
      PATHS.htmlFiles.map((path) => [path, readFileSync(resolve(ROOT, path), 'utf8')]),
    ),
  };
}

function writeReleaseFiles(plan) {
  writeFileSync(resolve(ROOT, PATHS.packageJson), plan.packageJson);
  writeFileSync(resolve(ROOT, PATHS.packageLock), plan.packageLock);
  writeFileSync(resolve(ROOT, PATHS.gradle), plan.gradle);
  writeFileSync(resolve(ROOT, PATHS.pbxproj), plan.pbxproj);
  for (const [path, html] of Object.entries(plan.htmlFiles)) {
    writeFileSync(resolve(ROOT, path), html);
  }
}

function main() {
  const [mode = 'check', ...rest] = process.argv.slice(2);
  const argv = mode === 'check' || mode === 'prepare' ? rest : [mode, ...rest];
  const action = mode === 'prepare' ? 'prepare' : 'check';
  const version = inferExpectedReleaseVersion({ argv });
  const files = readReleaseFiles();

  if (action === 'prepare') {
    writeReleaseFiles(planReleaseVersion({ version, ...files }));
    console.log(`release_version: prepared release ${version}`);
    return;
  }

  const failures = collectReleaseVersionFailures({ version, ...files });
  if (failures.length > 0) {
    console.error(`release_version: release ${version} is not synchronized:`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`release_version: release ${version} is synchronized`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
