#!/usr/bin/env node
/**
 * Optional Epic BuildPatchTool (BPT) upload helper.
 *
 * Ops-only. Not wired into pretest, npm test, npm run gate, or desktop CI.
 * Fails closed when required credentials / product / artifact ids are missing.
 * Never prints secret values. Does not invent real credentials.
 *
 * Usage:
 *   node scripts/epic-bpt-upload.mjs --help
 *   node scripts/epic-bpt-upload.mjs --dry-run --os win --build-version 0.33.0-windows
 *   node scripts/epic-bpt-upload.mjs --os mac --build-version 0.33.0-mac
 *
 * Required env for a real upload (placeholders only in docs):
 *   EPIC_BPT_BIN                 path to BuildPatchTool executable
 *   EPIC_BPT_ORGANIZATION_ID
 *   EPIC_BPT_PRODUCT_ID
 *   EPIC_BPT_ARTIFACT_ID         artifact for THIS platform upload
 *   EPIC_BPT_CLIENT_ID
 *   EPIC_BPT_CLIENT_SECRET       read only via ClientSecretEnvVar
 *   EPIC_BPT_CLOUD_DIR           dedicated local cache dir (not BuildRoot)
 *
 * Optional:
 *   EPIC_BPT_BUILD_ROOT          override BuildRoot (default from --os)
 *   EPIC_BPT_APP_LAUNCH          override AppLaunch relative path
 *   EPIC_BPT_APP_ARGS            default empty string
 *
 * Official BPT flag reference:
 *   https://dev.epicgames.com/docs/epic-games-store/publishing-tools/uploading-binaries/buildpatch-tool-latest
 * Repo runbook: docs/epic-games-integration/bpt-upload.md
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @typedef {'win' | 'mac'} EpicOs */

/** Default loose trees under release-epic/ (dir targets only; D7). */
export const DEFAULT_BUILD_ROOTS = {
  win: path.join('release-epic', 'win-unpacked'),
  mac: path.join('release-epic', 'mac-universal'),
};

/**
 * Default AppLaunch relative paths. Mac nested MacOS binary name can vary by
 * productName; callers may override with EPIC_BPT_APP_LAUNCH after first pack.
 */
export const DEFAULT_APP_LAUNCH = {
  win: 'World of ClaudeCraft.exe',
  mac: path.join('World of ClaudeCraft.app', 'Contents', 'MacOS', 'World of ClaudeCraft'),
};

/** Env keys required for a non-dry-run upload (names are ops-only; not D15 server keys). */
export const REQUIRED_ENV_KEYS = [
  'EPIC_BPT_BIN',
  'EPIC_BPT_ORGANIZATION_ID',
  'EPIC_BPT_PRODUCT_ID',
  'EPIC_BPT_ARTIFACT_ID',
  'EPIC_BPT_CLIENT_ID',
  'EPIC_BPT_CLIENT_SECRET',
  'EPIC_BPT_CLOUD_DIR',
];

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]} missing keys (empty when fully provisioned)
 */
export function missingBptEnv(env = process.env) {
  const missing = [];
  for (const key of REQUIRED_ENV_KEYS) {
    const raw = (env[key] ?? '').trim();
    if (raw === '') missing.push(key);
  }
  return missing;
}

/**
 * @param {string[]} argv
 * @returns {{
 *   help: boolean,
 *   dryRun: boolean,
 *   os: EpicOs | null,
 *   buildVersion: string | null,
 *   errors: string[],
 * }}
 */
export function parseArgs(argv) {
  const errors = [];
  let help = false;
  let dryRun = false;
  /** @type {EpicOs | null} */
  let os = null;
  /** @type {string | null} */
  let buildVersion = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      help = true;
      continue;
    }
    if (a === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (a === '--os') {
      const v = (argv[++i] ?? '').trim().toLowerCase();
      if (v !== 'win' && v !== 'mac') {
        errors.push(`--os must be "win" or "mac" (got "${v || ''}"). Linux EGS is not supported.`);
      } else {
        os = v;
      }
      continue;
    }
    if (a === '--build-version') {
      const v = (argv[++i] ?? '').trim();
      if (!v) errors.push('--build-version requires a non-empty value.');
      else buildVersion = v;
      continue;
    }
    errors.push(`unknown argument: ${a}`);
  }

  return { help, dryRun, os, buildVersion, errors };
}

export function helpText() {
  return `epic-bpt-upload: optional Epic BuildPatchTool wrapper (ops only)

Usage:
  node scripts/epic-bpt-upload.mjs --help
  node scripts/epic-bpt-upload.mjs --dry-run --os win --build-version <ver>
  node scripts/epic-bpt-upload.mjs --os mac --build-version <ver>

Options:
  --help              Show this help (no credentials required; exit 0)
  --dry-run           Print the planned BPT argv with secrets redacted; do not exec
  --os win|mac        Platform tree under release-epic/ (no linux)
  --build-version V   Unique binary version string for UploadBinary

Required env for a real upload (never commit real values):
  ${REQUIRED_ENV_KEYS.join('\n  ')}

Optional env:
  EPIC_BPT_BUILD_ROOT   override BuildRoot (default depends on --os)
  EPIC_BPT_APP_LAUNCH   override AppLaunch relative path
  EPIC_BPT_APP_ARGS     launch args (default empty)

Notes:
  - Default CI / npm test / npm run gate never run this script.
  - Cannot complete a real upload until the Epic org/product and BPT credentials exist.
  - Official docs: BuildPatch Tool Instructions (latest) on dev.epicgames.com
  - Repo runbook: docs/epic-games-integration/bpt-upload.md
`;
}

/**
 * @param {{
 *   os: EpicOs,
 *   buildVersion: string,
 *   env?: NodeJS.ProcessEnv,
 *   repoRoot?: string,
 * }} opts
 */
export function resolveUploadPlan(opts) {
  const env = opts.env ?? process.env;
  const repoRoot = opts.repoRoot ?? root;
  const buildRootRel = (env.EPIC_BPT_BUILD_ROOT ?? '').trim() || DEFAULT_BUILD_ROOTS[opts.os];
  const appLaunch = (env.EPIC_BPT_APP_LAUNCH ?? '').trim() || DEFAULT_APP_LAUNCH[opts.os];
  const appArgs = env.EPIC_BPT_APP_ARGS ?? '';
  const cloudDir = (env.EPIC_BPT_CLOUD_DIR ?? '').trim();
  const bin = (env.EPIC_BPT_BIN ?? '').trim();

  const buildRootAbs = path.isAbsolute(buildRootRel)
    ? buildRootRel
    : path.join(repoRoot, buildRootRel);

  /** Args passed to BPT; secret only via ClientSecretEnvVar name, never value. */
  const bptArgs = [
    `-OrganizationId=${(env.EPIC_BPT_ORGANIZATION_ID ?? '').trim()}`,
    `-ProductId=${(env.EPIC_BPT_PRODUCT_ID ?? '').trim()}`,
    `-ArtifactId=${(env.EPIC_BPT_ARTIFACT_ID ?? '').trim()}`,
    `-ClientId=${(env.EPIC_BPT_CLIENT_ID ?? '').trim()}`,
    `-ClientSecretEnvVar=EPIC_BPT_CLIENT_SECRET`,
    `-mode=UploadBinary`,
    `-BuildRoot=${buildRootAbs}`,
    `-CloudDir=${cloudDir}`,
    `-BuildVersion=${opts.buildVersion}`,
    `-AppLaunch=${appLaunch}`,
    `-AppArgs=${appArgs}`,
  ];

  return {
    os: opts.os,
    buildVersion: opts.buildVersion,
    bin,
    buildRootAbs,
    cloudDir,
    appLaunch,
    bptArgs,
  };
}

/**
 * Redact anything that looks like a secret assignment for dry-run logs.
 * @param {string[]} args
 */
export function redactArgsForLog(args) {
  return args.map((a) => {
    if (/ClientSecret=/i.test(a) && !/ClientSecretEnvVar=/i.test(a)) {
      return '-ClientSecret=<redacted>';
    }
    return a;
  });
}

/**
 * @param {string[]} argv process.argv.slice(2)
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   repoRoot?: string,
 *   execBpt?: (bin: string, args: string[], env: NodeJS.ProcessEnv) => { status: number | null, error?: Error | null },
 *   log?: (s: string) => void,
 *   error?: (s: string) => void,
 * }} [deps]
 * @returns {number} exit code
 */
export function runCli(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((s) => console.log(s));
  const error = deps.error ?? ((s) => console.error(s));
  const parsed = parseArgs(argv);

  if (parsed.help) {
    log(helpText());
    return 0;
  }

  if (parsed.errors.length) {
    for (const e of parsed.errors) error(`epic-bpt-upload: ${e}`);
    error('epic-bpt-upload: see --help');
    return 2;
  }

  if (!parsed.os) {
    error('epic-bpt-upload: --os win|mac is required (Linux EGS is not supported).');
    return 2;
  }
  if (!parsed.buildVersion) {
    error('epic-bpt-upload: --build-version is required.');
    return 2;
  }

  const missing = missingBptEnv(env);
  const plan = resolveUploadPlan({
    os: parsed.os,
    buildVersion: parsed.buildVersion,
    env,
    repoRoot: deps.repoRoot ?? root,
  });

  const redacted = redactArgsForLog(plan.bptArgs);
  log(`epic-bpt-upload: os=${plan.os} version=${plan.buildVersion}`);
  log(`epic-bpt-upload: bin=${plan.bin || '(unset EPIC_BPT_BIN)'}`);
  log(`epic-bpt-upload: buildRoot=${plan.buildRootAbs}`);
  log(`epic-bpt-upload: args=${JSON.stringify(redacted)}`);

  if (parsed.dryRun) {
    if (missing.length) {
      log(
        'epic-bpt-upload: dry-run note: missing env (upload would fail closed): ' +
          missing.join(', '),
      );
    }
    if (plan.bin && !existsSync(plan.bin)) {
      log(`epic-bpt-upload: dry-run note: EPIC_BPT_BIN path does not exist yet: ${plan.bin}`);
    }
    if (!existsSync(plan.buildRootAbs)) {
      log(
        `epic-bpt-upload: dry-run note: BuildRoot not found yet: ${plan.buildRootAbs} ` +
          '(run npm run electron:build:epic on the matching OS first).',
      );
    }
    log(
      'epic-bpt-upload: dry-run only; not executing BuildPatchTool. ' +
        'Cannot complete a real upload until the Epic org/product and BPT credentials exist.',
    );
    return 0;
  }

  if (missing.length) {
    error(
      'epic-bpt-upload: missing required credentials or ids. ' +
        'Cannot upload until the Epic org/product exists and BPT env is set. ' +
        `Missing: ${missing.join(', ')}. ` +
        'Use --help for the key list or --dry-run for a no-secret plan. ' +
        'See docs/epic-games-integration/bpt-upload.md. Never commit real secrets.',
    );
    return 1;
  }

  if (!existsSync(plan.bin)) {
    error(
      `epic-bpt-upload: EPIC_BPT_BIN does not exist: ${plan.bin}. ` +
        'Download BuildPatchTool from the Developer Portal (Artifacts and Binaries).',
    );
    return 1;
  }

  if (!existsSync(plan.buildRootAbs)) {
    error(
      `epic-bpt-upload: BuildRoot not found: ${plan.buildRootAbs}. ` +
        'Run npm run electron:build:epic on the matching OS first.',
    );
    return 1;
  }

  // Refuse non-directory BuildRoot (loose tree only; never a single installer file).
  try {
    const st = statSync(plan.buildRootAbs);
    if (!st.isDirectory()) {
      error(`epic-bpt-upload: BuildRoot must be a directory of loose files: ${plan.buildRootAbs}`);
      return 1;
    }
  } catch {
    error(`epic-bpt-upload: cannot stat BuildRoot: ${plan.buildRootAbs}`);
    return 1;
  }

  const execBpt =
    deps.execBpt ??
    ((bin, args, runEnv) => {
      const result = spawnSync(bin, args, {
        env: runEnv,
        stdio: 'inherit',
        cwd: deps.repoRoot ?? root,
      });
      return { status: result.status, error: result.error ?? null };
    });

  const result = execBpt(plan.bin, plan.bptArgs, env);
  if (result.error) {
    error(`epic-bpt-upload: failed to spawn BPT: ${result.error.message}`);
    return 1;
  }
  if (result.status === null || result.status !== 0) {
    error(`epic-bpt-upload: BuildPatchTool exited with status ${result.status}`);
    return typeof result.status === 'number' ? result.status : 1;
  }
  log('epic-bpt-upload: BuildPatchTool finished successfully.');
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  process.exit(runCli(process.argv.slice(2)));
}
