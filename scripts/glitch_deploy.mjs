#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CLI_DIR = path.join(os.tmpdir(), 'world-of-claudecraft-glitch-cli-deploy');
const CLI_REPO = 'https://github.com/Glitch-Gaming-Platform/Glitch-Cli-Deploy.git';
const TITLE_ID = '8254e0f9-6c3a-4c94-8a16-570157b9df3b';

loadEnvFile(path.join(ROOT, '.env'));
loadEnvFile(path.join(ROOT, '.env.local'));

const env = { ...process.env };
const deployToken = env.GLITCH_TITLE_TOKEN || env.GLITCH_API_TOKEN;
const clientTitleToken = env.VITE_GLITCH_TITLE_TOKEN;
const version = env.GLITCH_DEPLOY_VERSION || readPackageVersion();
const deploymentType = env.GLITCH_DEPLOYMENT_TYPE || 'node';
const nodeDeployment = deploymentType === 'node';
const staticClientDeployment = deploymentType === 'iframe' || deploymentType === 'wasm';
const entryPoint = nodeDeployment ? 'package.json' : env.GLITCH_ENTRY_POINT || 'index.html';
const gameApiOrigin =
  env.VITE_API_ORIGIN || env.GLITCH_GAME_API_ORIGIN || 'https://worldofclaudecraft.com';
const dryRun = env.GLITCH_DEPLOY_DRY_RUN === '1';
const skipBuild = env.GLITCH_DEPLOY_SKIP_BUILD === '1';

if (!deployToken) {
  fail('Set GLITCH_TITLE_TOKEN to a deploy-scoped Glitch token before deploying.');
}

if (!clientTitleToken && !skipBuild) {
  fail("Set VITE_GLITCH_TITLE_TOKEN to this title's client title token before building.");
}

if (staticClientDeployment && env.GLITCH_ALLOW_STATIC_CLIENT_DEPLOY !== '1') {
  fail(
    'World of ClaudeCraft is a Node-backed MMO. Use GLITCH_DEPLOYMENT_TYPE=node for shared-world deploys, or set GLITCH_ALLOW_STATIC_CLIENT_DEPLOY=1 for a static iframe/wasm client build.',
  );
}

if (nodeDeployment) {
  if (!env.DATABASE_URL) {
    fail('Set DATABASE_URL before deploying the Glitch node MMO build.');
  }
  if (!env.GLITCH_SERVER_TITLE_TOKEN) {
    fail('Set GLITCH_SERVER_TITLE_TOKEN before deploying the Glitch node MMO build.');
  }
}

await ensureCli();

if (!skipBuild && !nodeDeployment) {
  await run('npm', ['run', 'build'], {
    ...env,
    VITE_GLITCH_ENABLED: '1',
    VITE_GLITCH_TITLE_ID: TITLE_ID,
    VITE_API_ORIGIN: gameApiOrigin,
  });
}

const nodeArchive = nodeDeployment ? await prepareNodeSourceArchive() : null;

const deployArgs = [
  path.join(CLI_DIR, 'bin/glitch-deploy.js'),
  'deploy',
  nodeArchive?.archivePath ?? path.join(ROOT, 'dist'),
  '--title',
  env.GLITCH_TITLE_ID || TITLE_ID,
  '--token',
  deployToken,
  '--version',
  version,
  '--entry',
  entryPoint,
  '--type',
  deploymentType,
  '--build-type',
  env.GLITCH_BUILD_TYPE || 'production',
  '--wait',
];
for (const [key, value] of customVariables(env)) {
  deployArgs.push('--var', `${key}=${value}`);
}
if (env.GLITCH_CUSTOM_VARIABLES_JSON) {
  deployArgs.push('--custom-json', env.GLITCH_CUSTOM_VARIABLES_JSON);
}
if (dryRun) deployArgs.push('--dry-run');

try {
  await run(process.execPath, deployArgs, env);
} finally {
  await nodeArchive?.cleanup();
}

async function ensureCli() {
  await mkdir(path.dirname(CLI_DIR), { recursive: true });
  if (!existsSync(CLI_DIR)) {
    await run('git', ['clone', '--depth', '1', CLI_REPO, CLI_DIR], env);
  } else {
    await run('git', ['pull', '--ff-only'], env, CLI_DIR);
  }
  await run('npm', ['install', '--omit=dev'], env, CLI_DIR);
}

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return String(pkg.version || '0.0.0').slice(0, 20);
}

async function prepareNodeSourceArchive() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'woc-glitch-node-'));
  const archivePath = path.join(tempDir, 'world-of-claudecraft-node.zip');
  await run(
    'zip',
    [
      '-rq',
      archivePath,
      '.',
      '-x',
      '.git/*',
      'node_modules/*',
      'dist/*',
      'dist-server/*',
      'dist-env/*',
      'release/*',
      'tmp/*',
      '.agents/*',
      '.claude/*',
      '.codex/*',
      'docs/*',
      'tests/*',
      'python/*',
      'deploy/*',
      '.env',
      '.env.*',
      '.DS_Store',
    ],
    env,
  );
  return {
    archivePath,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

function customVariables(sourceEnv) {
  const vars = new Map();
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (key.startsWith('GLITCH_DEPLOY_VAR_') && value !== undefined) {
      vars.set(key.slice('GLITCH_DEPLOY_VAR_'.length), value);
    }
  }
  if (!nodeDeployment) return vars;
  vars.set('dockerfile', sourceEnv.GLITCH_DOCKERFILE || 'Dockerfile');
  vars.set('build_context', sourceEnv.GLITCH_BUILD_CONTEXT || '.');
  vars.set('GLITCH_ENABLED', sourceEnv.GLITCH_ENABLED || '1');
  vars.set('GLITCH_TITLE_ID', sourceEnv.GLITCH_TITLE_ID || TITLE_ID);
  vars.set('VITE_GLITCH_ENABLED', '1');
  vars.set('VITE_GLITCH_TITLE_ID', sourceEnv.VITE_GLITCH_TITLE_ID || TITLE_ID);
  for (const key of [
    'DATABASE_URL',
    'PUBLIC_ORIGIN',
    'REALM_NAME',
    'REALM_SINGLETON_LOCK',
    'WEB_ORIGINS',
    'GLITCH_SERVER_TITLE_TOKEN',
    'GLITCH_API_BASE_URL',
    'VITE_GLITCH_TITLE_TOKEN',
    'VITE_GLITCH_DEFAULT_CLASS',
  ]) {
    if (sourceEnv[key]) vars.set(key, sourceEnv[key]);
  }
  if (sourceEnv.GLITCH_NODE_EXTERNAL_API_ORIGIN === '1' && sourceEnv.VITE_API_ORIGIN) {
    vars.set('VITE_API_ORIGIN', sourceEnv.VITE_API_ORIGIN);
  }
  return vars;
}

function run(command, args, commandEnv, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: commandEnv,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with status ${code}`));
    });
  });
}

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  process.loadEnvFile?.(file);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
