#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
const entryPoint = env.GLITCH_ENTRY_POINT || 'index.html';
const gameApiOrigin =
  env.VITE_API_ORIGIN || env.GLITCH_GAME_API_ORIGIN || 'https://worldofclaudecraft.com';
const dryRun = env.GLITCH_DEPLOY_DRY_RUN === '1';
const skipBuild = env.GLITCH_DEPLOY_SKIP_BUILD === '1';
const azurePostDeploy = env.GLITCH_AZURE_POST_DEPLOY !== '0';
const azureContainerAppName = env.GLITCH_AZURE_CONTAINERAPP_NAME || 'world-of-claudecraft-node';
const azureResourceGroup = env.GLITCH_AZURE_RESOURCE_GROUP || 'openai-resource-group';
const azurePostDeployTimeoutMs = readPositiveMs('GLITCH_AZURE_POST_DEPLOY_TIMEOUT_MS', 180_000);
const azureSingletonHandoffTimeoutMs = readPositiveMs(
  'GLITCH_AZURE_SINGLETON_HANDOFF_TIMEOUT_MS',
  90_000,
);
const azureRestoreTimeoutMs = readPositiveMs('GLITCH_AZURE_RESTORE_TIMEOUT_MS', 120_000);
const azurePublicOrigin = env.GLITCH_AZURE_PUBLIC_ORIGIN || env.PUBLIC_ORIGIN || gameApiOrigin;
const azurePublicHealthPath = env.GLITCH_AZURE_PUBLIC_HEALTH_PATH || '/api/project-stats';
const azurePublicHealthTimeoutMs = readPositiveMs('GLITCH_AZURE_HEALTHCHECK_TIMEOUT_MS', 15_000);
const azurePublicHealthContains = env.GLITCH_AZURE_HEALTHCHECK_CONTAINS || '';
const preflightScript = path.join(ROOT, 'scripts/glitch_predeploy_check.mjs');

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
  if (entryPoint !== 'index.html') {
    fail(
      'World of ClaudeCraft Glitch node deployments must use GLITCH_ENTRY_POINT=index.html. The Dockerfile launches the Node server; package.json is not a valid entry file for this title.',
    );
  }
  if (!env.DATABASE_URL) {
    fail('Set DATABASE_URL before deploying the Glitch node MMO build.');
  }
  if (!env.GLITCH_SERVER_TITLE_TOKEN) {
    fail('Set GLITCH_SERVER_TITLE_TOKEN before deploying the Glitch node MMO build.');
  }
}

if (nodeDeployment && !dryRun) {
  await runGlitchPreflight();
}

if (nodeDeployment && !dryRun && azurePostDeploy) {
  await runAzurePreDeploySetup();
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

if (nodeDeployment && !dryRun && azurePostDeploy) {
  await runAzurePostDeployCheck();
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

async function runGlitchPreflight() {
  console.log('Running mandatory Glitch node predeploy check before upload...');
  await run(process.execPath, [preflightScript], {
    ...env,
    VITE_GLITCH_ENABLED: '1',
    VITE_GLITCH_TITLE_ID: TITLE_ID,
  });
}

async function runAzurePreDeploySetup() {
  console.log('Preparing Azure Container App for Glitch revision traffic handoff...');
  await runCapture('az', ['--version'], env);
  await setAzureRevisionModeMultiple();
  await enforceAzureSingleReplicaScale();
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
  const publicBuildEnv = nodePublicBuildEnv(env);
  if (publicBuildEnv) {
    const publicEnvPath = path.join(tempDir, 'glitch.public.env');
    await writeFile(publicEnvPath, publicBuildEnv);
    await run('zip', ['-q', archivePath, 'glitch.public.env'], env, tempDir);
  }
  return {
    archivePath,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

function nodePublicBuildEnv(sourceEnv) {
  const vars = new Map([
    ['VITE_GLITCH_ENABLED', '1'],
    [
      'VITE_GLITCH_TITLE_ID',
      sourceEnv.VITE_GLITCH_TITLE_ID || sourceEnv.GLITCH_TITLE_ID || TITLE_ID,
    ],
    ['VITE_GLITCH_TITLE_TOKEN', clientTitleToken],
    ['VITE_GLITCH_DEFAULT_CLASS', sourceEnv.VITE_GLITCH_DEFAULT_CLASS || 'warrior'],
  ]);
  if (sourceEnv.VITE_GLITCH_API_BASE_URL) {
    vars.set('VITE_GLITCH_API_BASE_URL', sourceEnv.VITE_GLITCH_API_BASE_URL);
  }
  if (sourceEnv.VITE_TURNSTILE_SITEKEY) {
    vars.set('VITE_TURNSTILE_SITEKEY', sourceEnv.VITE_TURNSTILE_SITEKEY);
  }
  if (sourceEnv.GLITCH_NODE_EXTERNAL_API_ORIGIN === '1' && sourceEnv.VITE_API_ORIGIN) {
    vars.set('VITE_API_ORIGIN', sourceEnv.VITE_API_ORIGIN);
  }
  return `${[...vars].map(([key, value]) => `${key}=${JSON.stringify(String(value))}`).join('\n')}\n`;
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

async function runAzurePostDeployCheck() {
  console.log('Running Azure Container App post-deploy health check...');
  await runCapture('az', ['--version'], env);
  await setAzureRevisionModeMultiple();
  await enforceAzureSingleReplicaScale();

  const initialRevisions = await readAzureRevisions();
  const initialTraffic = await readAzureTraffic();
  const fallbackRevision = await selectAzureFallbackRevision(initialRevisions, initialTraffic);
  const latestRevision = await readLatestAzureRevisionName();
  if (fallbackRevision) {
    console.log(`Azure post-deploy: fallback revision is ${fallbackRevision}.`);
  } else {
    console.warn(
      'Azure post-deploy: no healthy fallback revision found; refusing destructive singleton recovery unless one appears.',
    );
  }

  if (latestRevision === fallbackRevision) {
    try {
      await routeAzureTrafficToRevision(latestRevision);
      await probeAzurePublicHealth(latestRevision);
      console.log(`Azure post-deploy: ${latestRevision} is already the healthy traffic target.`);
      return;
    } catch (error) {
      fail(redact(`Azure post-deploy: current traffic target failed verification: ${error}`));
    }
  }

  let singletonHandoffDone = false;
  const deadline = Date.now() + azurePostDeployTimeoutMs;
  while (Date.now() < deadline) {
    const revisions = await readAzureRevisions();
    const latest = revisions.find((revision) => revision.name === latestRevision);
    if (isHealthySingleReplicaRevision(latest)) {
      try {
        await promoteAzureRevision(latestRevision, fallbackRevision);
      } catch (error) {
        fail(redact(String(error)));
      }
      return;
    }

    if (!singletonHandoffDone && latest && revisionFailed(latest)) {
      const logs = await readAzureRevisionLogs(latestRevision);
      if (logs.includes('already hosted by another game server process')) {
        singletonHandoffDone = true;
        try {
          await tryAzureSingletonHandoff(latestRevision, fallbackRevision);
          return;
        } catch (error) {
          const fallbackMessage = await restoreAzureFallbackRevision(
            fallbackRevision,
            latestRevision,
          );
          fail(
            [
              `Azure post-deploy: singleton handoff for ${latestRevision} failed.`,
              redact(String(error)),
              fallbackMessage,
            ]
              .filter(Boolean)
              .join('\n'),
          );
        }
      }
    }

    await sleep(10_000);
  }

  const finalRevisions = await readAzureRevisions();
  const latestLogs = await readAzureRevisionLogs(latestRevision).catch(() => '');
  const fallbackMessage = await restoreAzureFallbackRevision(fallbackRevision, latestRevision);
  fail(
    [
      `Azure post-deploy: ${latestRevision} did not become healthy within ${azurePostDeployTimeoutMs}ms.`,
      fallbackMessage,
      `Revision state: ${JSON.stringify(finalRevisions)}`,
      latestLogs ? `Log tail:\n${redact(latestLogs)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

async function setAzureRevisionModeMultiple() {
  await run(
    'az',
    [
      'containerapp',
      'revision',
      'set-mode',
      '--name',
      azureContainerAppName,
      '--resource-group',
      azureResourceGroup,
      '--mode',
      'multiple',
      '--output',
      'none',
    ],
    env,
  );
}

async function enforceAzureSingleReplicaScale() {
  await run(
    'az',
    [
      'containerapp',
      'update',
      '--name',
      azureContainerAppName,
      '--resource-group',
      azureResourceGroup,
      '--min-replicas',
      '1',
      '--max-replicas',
      '1',
      '--output',
      'none',
    ],
    env,
  );
}

async function promoteAzureRevision(latestRevision, fallbackRevision) {
  try {
    await routeAzureTrafficToRevision(latestRevision);
    await probeAzurePublicHealth(latestRevision);
    const revisions = await readAzureRevisions();
    await deactivateOlderAzureRevisions(revisions, latestRevision);
    console.log(
      `Azure post-deploy: ${latestRevision} is healthy with one replica and public traffic.`,
    );
  } catch (error) {
    const fallbackMessage = await restoreAzureFallbackRevision(fallbackRevision, latestRevision);
    throw new Error(
      [
        `Azure post-deploy: ${latestRevision} passed revision health but failed promotion.`,
        redact(String(error)),
        fallbackMessage,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

async function routeAzureTrafficToRevision(revision) {
  try {
    await setAzureTrafficRevisionWeight(revision);
  } catch (error) {
    console.warn(
      redact(
        `Azure post-deploy: traffic route failed once; resetting revision mode to multiple before retry: ${error}`,
      ),
    );
    await setAzureRevisionModeMultiple();
    await setAzureTrafficRevisionWeight(revision);
  }
  await assertAzureTrafficPinnedToRevision(revision);
}

async function setAzureTrafficRevisionWeight(revision) {
  await run(
    'az',
    [
      'containerapp',
      'ingress',
      'traffic',
      'set',
      '--name',
      azureContainerAppName,
      '--resource-group',
      azureResourceGroup,
      '--revision-weight',
      `${revision}=100`,
      '--output',
      'none',
    ],
    env,
  );
}

async function assertAzureTrafficPinnedToRevision(revision) {
  const traffic = await readAzureTraffic();
  const pinned = traffic.some(
    (entry) => entry.revisionName === revision && Number(entry.weight || 0) === 100,
  );
  const leakedTraffic = traffic.filter(
    (entry) => entry.revisionName !== revision && Number(entry.weight || 0) > 0,
  );
  if (!pinned || leakedTraffic.length > 0) {
    throw new Error(
      `Azure post-deploy: traffic is not pinned to ${revision}: ${JSON.stringify(traffic)}`,
    );
  }
}

async function restoreAzureFallbackRevision(fallbackRevision, failedRevision) {
  if (!fallbackRevision) {
    return 'No fallback revision was available to restore.';
  }
  if (fallbackRevision === failedRevision) return '';
  console.log(`Azure post-deploy: restoring traffic to fallback revision ${fallbackRevision}.`);
  try {
    if (failedRevision) {
      await deactivateAzureRevision(failedRevision).catch((error) => {
        console.warn(redact(`Azure post-deploy: could not deactivate ${failedRevision}: ${error}`));
      });
    }
    await activateAzureRevision(fallbackRevision);
    await waitForAzureRevisionHealthy(fallbackRevision, azureRestoreTimeoutMs);
    await routeAzureTrafficToRevision(fallbackRevision);
    await probeAzurePublicHealth(fallbackRevision);
    return `Restored traffic to fallback revision ${fallbackRevision} and verified public health.`;
  } catch (error) {
    return redact(`Failed to restore fallback revision ${fallbackRevision}: ${error}`);
  }
}

function revisionFailed(revision) {
  return /failed|unhealthy/i.test(`${revision.healthState} ${revision.runningState}`);
}

function isHealthySingleReplicaRevision(revision) {
  return (
    revision?.active &&
    revision.healthState === 'Healthy' &&
    revision.runningState !== 'Failed' &&
    Number(revision.replicas || 0) === 1
  );
}

async function tryAzureSingletonHandoff(latestRevision, fallbackRevision) {
  if (!fallbackRevision) {
    throw new Error(
      'Azure post-deploy: refusing realm singleton handoff because no fallback revision is known.',
    );
  }

  console.log(
    `Azure post-deploy: ${latestRevision} hit the realm singleton during rollout; attempting bounded handoff with fallback ${fallbackRevision}.`,
  );
  const revisions = await readAzureRevisions();
  await deactivateOlderAzureRevisions(revisions, latestRevision);
  await deactivateAzureRevision(latestRevision).catch((error) => {
    console.warn(redact(`Azure post-deploy: could not deactivate ${latestRevision}: ${error}`));
  });
  await sleep(20_000);
  await activateAzureRevision(latestRevision);
  await waitForAzureRevisionHealthy(latestRevision, azureSingletonHandoffTimeoutMs);
  await promoteAzureRevision(latestRevision, fallbackRevision);
}

async function deactivateOlderAzureRevisions(revisions, latestRevision) {
  for (const revision of revisions) {
    if (!revision.active || revision.name === latestRevision) continue;
    await deactivateAzureRevision(revision.name);
  }
}

async function activateAzureRevision(revision) {
  await run(
    'az',
    [
      'containerapp',
      'revision',
      'activate',
      '--name',
      azureContainerAppName,
      '--resource-group',
      azureResourceGroup,
      '--revision',
      revision,
      '--output',
      'none',
    ],
    env,
  );
}

async function deactivateAzureRevision(revision) {
  await run(
    'az',
    [
      'containerapp',
      'revision',
      'deactivate',
      '--name',
      azureContainerAppName,
      '--resource-group',
      azureResourceGroup,
      '--revision',
      revision,
      '--output',
      'none',
    ],
    env,
  );
}

async function waitForAzureRevisionHealthy(revisionName, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastRevision = null;
  while (Date.now() < deadline) {
    const revisions = await readAzureRevisions();
    lastRevision = revisions.find((revision) => revision.name === revisionName) || null;
    if (isHealthySingleReplicaRevision(lastRevision)) return lastRevision;
    await sleepRemaining(deadline, 10_000);
  }
  throw new Error(
    [
      `Azure post-deploy: ${revisionName} did not become healthy within ${timeoutMs}ms.`,
      lastRevision ? `Last state: ${JSON.stringify(lastRevision)}` : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
}

async function selectAzureFallbackRevision(revisions, traffic) {
  const byName = new Map(revisions.map((revision) => [revision.name, revision]));
  const weightedTraffic = [...traffic].sort(
    (left, right) => Number(right.weight || 0) - Number(left.weight || 0),
  );
  for (const entry of weightedTraffic) {
    if (Number(entry.weight || 0) <= 0 || !entry.revisionName) continue;
    if (isHealthySingleReplicaRevision(byName.get(entry.revisionName))) {
      return entry.revisionName;
    }
  }

  const latestReadyRevision = await readLatestReadyAzureRevisionName();
  if (latestReadyRevision && byName.has(latestReadyRevision)) return latestReadyRevision;

  return revisions.find(isHealthySingleReplicaRevision)?.name || '';
}

async function readLatestReadyAzureRevisionName() {
  const result = await runCapture(
    'az',
    [
      'containerapp',
      'show',
      '--name',
      azureContainerAppName,
      '--resource-group',
      azureResourceGroup,
      '--query',
      'properties.latestReadyRevisionName',
      '--output',
      'tsv',
    ],
    env,
  );
  return result.stdout.trim();
}

async function readAzureTraffic() {
  const result = await runCapture(
    'az',
    [
      'containerapp',
      'show',
      '--name',
      azureContainerAppName,
      '--resource-group',
      azureResourceGroup,
      '--query',
      'properties.configuration.ingress.traffic',
      '--output',
      'json',
    ],
    env,
  );
  const traffic = JSON.parse(result.stdout || '[]');
  return Array.isArray(traffic) ? traffic : [];
}

async function readLatestAzureRevisionName() {
  const result = await runCapture(
    'az',
    [
      'containerapp',
      'show',
      '--name',
      azureContainerAppName,
      '--resource-group',
      azureResourceGroup,
      '--query',
      'properties.latestRevisionName',
      '--output',
      'tsv',
    ],
    env,
  );
  const revision = result.stdout.trim();
  if (!revision) fail('Azure post-deploy: could not read the latest revision name.');
  return revision;
}

async function readAzureRevisions() {
  const result = await runCapture(
    'az',
    [
      'containerapp',
      'revision',
      'list',
      '--name',
      azureContainerAppName,
      '--resource-group',
      azureResourceGroup,
      '--all',
      '--query',
      '[].{name:name,active:properties.active,healthState:properties.healthState,runningState:properties.runningState,replicas:properties.replicas}',
      '--output',
      'json',
    ],
    env,
  );
  return JSON.parse(result.stdout);
}

async function readAzureRevisionLogs(revision) {
  const result = await runCapture(
    'az',
    [
      'containerapp',
      'logs',
      'show',
      '--name',
      azureContainerAppName,
      '--resource-group',
      azureResourceGroup,
      '--revision',
      revision,
      '--tail',
      '120',
    ],
    env,
  );
  return redact(`${result.stdout}\n${result.stderr}`);
}

async function probeAzurePublicHealth(label) {
  if (typeof fetch !== 'function') {
    throw new Error('Azure post-deploy: current Node runtime does not provide fetch.');
  }
  const url = azurePublicHealthUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), azurePublicHealthTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json,text/plain,*/*' },
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    if (azurePublicHealthContains && !body.includes(azurePublicHealthContains)) {
      throw new Error(
        `response did not include expected marker ${JSON.stringify(azurePublicHealthContains)}`,
      );
    }
    console.log(`Azure post-deploy: public health probe passed for ${label}.`);
  } catch (error) {
    throw new Error(redact(`Azure post-deploy: public health probe failed for ${label}: ${error}`));
  } finally {
    clearTimeout(timeout);
  }
}

function azurePublicHealthUrl() {
  const origin = azurePublicOrigin.replace(/\/+$/, '');
  const healthPath = azurePublicHealthPath.startsWith('/')
    ? azurePublicHealthPath
    : `/${azurePublicHealthPath}`;
  return `${origin}${healthPath}`;
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

function runCapture(command, args, commandEnv, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: commandEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} exited with status ${code}\n${redact(stdout)}\n${redact(stderr)}`.trim(),
        ),
      );
    });
  });
}

function redact(value) {
  let out = value;
  for (const key of [
    'DATABASE_URL',
    'GLITCH_TITLE_TOKEN',
    'GLITCH_API_TOKEN',
    'GLITCH_SERVER_TITLE_TOKEN',
    'VITE_GLITCH_TITLE_TOKEN',
  ]) {
    const secret = env[key];
    if (secret) out = out.split(secret).join('[REDACTED]');
  }
  return out
    .replace(/postgres:\/\/[^\s"'`]+/g, '[DATABASE_URL_REDACTED]')
    .replace(/gl_deploy_[A-Za-z0-9]+/g, '[DEPLOY_TOKEN_REDACTED]')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}\.[A-Za-z0-9]+/gi, '[TITLE_TOKEN_REDACTED]');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepRemaining(deadline, maxSleepMs) {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return;
  await sleep(Math.min(maxSleepMs, remainingMs));
}

function readPositiveMs(key, fallback) {
  const value = Number(env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  process.loadEnvFile?.(file);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
