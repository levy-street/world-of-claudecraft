import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Glitch deploy process guardrails', () => {
  it('runs the local node predeploy check before installing the CLI or uploading', () => {
    const deployScript = readFileSync(join(root, 'scripts/glitch_deploy.mjs'), 'utf8');

    expect(deployScript).toContain('scripts/glitch_predeploy_check.mjs');
    expect(deployScript).toContain('runGlitchPreflight');
    expect(deployScript.indexOf('await runGlitchPreflight()')).toBeLessThan(
      deployScript.indexOf('await ensureCli()'),
    );
    expect(deployScript.indexOf('await ensureCli()')).toBeLessThan(
      deployScript.indexOf('const nodeArchive'),
    );
  });

  it('pins this repo to the documented Glitch node entry point', () => {
    const deployScript = readFileSync(join(root, 'scripts/glitch_deploy.mjs'), 'utf8');

    expect(deployScript).toContain("entryPoint !== 'index.html'");
    expect(deployScript).toContain('package.json is not a valid entry file');
  });

  it('requires static Glitch clients to declare their WOC API origin', () => {
    const deployScript = readFileSync(join(root, 'scripts/glitch_deploy.mjs'), 'utf8');
    const docs = readFileSync(join(root, 'docs/glitch-deployment.md'), 'utf8');

    expect(deployScript).toContain('configuredGameApiOrigin');
    expect(deployScript).toContain('staticClientDeployment && !configuredGameApiOrigin');
    expect(deployScript).toContain('serves /api/auth/glitch');
    expect(deployScript).toContain('VITE_API_ORIGIN: gameApiOrigin');
    expect(deployScript).toContain('sourceEnv.VITE_API_ORIGIN || sourceEnv.GLITCH_GAME_API_ORIGIN');
    expect(deployScript).toContain("['VITE_DESKTOP_RELATIVE_API', '1']");
    expect(deployScript).toContain("vars.set('VITE_DESKTOP_RELATIVE_API', '1')");
    expect(deployScript).toContain('GLITCH_PLATFORM_ORIGINS');
    expect(deployScript).toContain("key.startsWith('GLITCH_DEPLOY_VAR_')");
    expect(deployScript).toContain("variableName === 'VITE_API_ORIGIN'");
    expect(deployScript).toContain('assertNodeExternalApiOriginEnabled');
    expect(deployScript).toContain('must not set VITE_API_ORIGIN for a Glitch node deployment');
    expect(deployScript).toContain('not the Glitch platform origin');
    expect(docs).toContain('must point at the World of');
    expect(docs).toContain('not be assumed from the Desktop App');
    expect(docs).toContain('VITE_DESKTOP_RELATIVE_API=1');
  });

  it('preflights the locally built server and the live-failure site-presence route', () => {
    const preflight = readFileSync(join(root, 'scripts/glitch_predeploy_check.mjs'), 'utf8');

    expect(preflight).toContain("await run('npm', ['run', 'build']");
    expect(preflight).toContain("await run('npm', ['run', 'build:server']");
    expect(preflight).toContain('dist-server/server.cjs');
    expect(preflight).toContain('/api/project-stats');
    expect(preflight).toContain('/api/site-presence');
    expect(preflight).toContain("page: 'home'");
    expect(preflight).toContain("VITE_DESKTOP_RELATIVE_API: '1'");
  });

  it('passes Desktop App relative API config through the node Docker build', () => {
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');

    expect(dockerfile).toContain('COPY glitch.public.env .env.production');
    expect(dockerfile).toContain('ARG VITE_DESKTOP_RELATIVE_API=""');
    expect(dockerfile).toContain('export VITE_DESKTOP_RELATIVE_API');
  });

  it('uses a realm name short enough for the server realm validator', () => {
    const preflight = readFileSync(join(root, 'scripts/glitch_predeploy_check.mjs'), 'utf8');

    expect(preflight).not.toContain('GlitchPreflight${Date.now()');
    expect(preflight).toContain('slice(-8)');
    expect(preflight).toContain('slice(-6)');
  });

  it('runs the Azure post-deploy handoff after the Glitch upload', () => {
    const deployScript = readFileSync(join(root, 'scripts/glitch_deploy.mjs'), 'utf8');

    expect(deployScript).toContain('runAzurePreDeploySetup');
    expect(deployScript).toContain('runAzurePostDeployCheck');
    expect(deployScript).toContain('GLITCH_DEPLOY_CLI_WAIT');
    expect(deployScript).toContain('waitForAzurePostDeployLatestRevision');
    expect(deployScript).toContain("if (useCliBuildWait) deployArgs.push('--wait')");
    expect(deployScript).toContain('GLITCH_AZURE_POST_DEPLOY');
    expect(deployScript).toContain('readAzureTraffic');
    expect(deployScript).toContain('selectAzureFallbackRevision');
    expect(deployScript).toContain('readAzureRevisionMode');
    expect(deployScript).toContain('readAzureScale');
    expect(deployScript).toContain('readLatestReadyAzureRevisionName');
    expect(deployScript).toContain('restoreAzureFallbackRevision');
    expect(deployScript).toContain('properties.latestReadyRevisionName');
    expect(deployScript).toContain('properties.configuration.ingress.traffic');
    expect(deployScript).toContain('ingress');
    expect(deployScript).toContain('traffic');
    expect(deployScript).toContain('--revision-weight');
    expect(deployScript).toContain('set-mode');
    expect(deployScript).toContain('multiple');
    expect(deployScript).toContain('--min-replicas');
    expect(deployScript).toContain('--max-replicas');
    expect(deployScript).toContain('already hosted by another game server process');
    expect(deployScript).toContain('activate');
    expect(deployScript).toContain('--all');
    expect(deployScript.indexOf('await runAzurePreDeploySetup()')).toBeLessThan(
      deployScript.indexOf('await run(process.execPath, deployArgs, env)'),
    );
    expect(deployScript.indexOf('await run(process.execPath, deployArgs, env)')).toBeLessThan(
      deployScript.indexOf('await runAzurePostDeployCheck(azurePreDeployState)'),
    );
  });

  it('keeps Azure promotion and fallback recovery no-damage by default', () => {
    const deployScript = readFileSync(join(root, 'scripts/glitch_deploy.mjs'), 'utf8');

    expect(deployScript).toContain('promoteAzureRevision');
    expect(deployScript).toContain('assertAzureTrafficPinnedToRevision');
    expect(deployScript).toContain('probeAzurePublicHealth');
    expect(deployScript).toContain('GLITCH_AZURE_SINGLETON_HANDOFF_TIMEOUT_MS');
    expect(deployScript).toContain('GLITCH_AZURE_SINGLETON_LOCK_CLEAR_MS');
    expect(deployScript).toContain('GLITCH_AZURE_RESTORE_TIMEOUT_MS');
    expect(deployScript).toContain('GLITCH_AZURE_HEALTHCHECK_TIMEOUT_MS');
    expect(deployScript).toContain('GLITCH_AZURE_PUBLIC_HEALTH_PATH');
    expect(deployScript).toContain('GLITCH_AZURE_REVISION_FAILURE_GRACE_MS');
    expect(deployScript).toContain('GLITCH_AZURE_REVISION_PROGRESS_LOG_MS');
    expect(deployScript).toContain('classifyAzureRevisionState');
    expect(deployScript).toContain('isAzureTransitionalRunningState');
    expect(deployScript).toContain('activating|deploying|initializing');
    expect(deployScript).toContain('detected new revision');
    expect(deployScript).toContain('reached a terminal Azure state');
    expect(deployScript).toContain('stopAzureRevisionsForSingleton');
    expect(deployScript).toContain('terminateRealmSingletonLockHolders');
    expect(deployScript).toContain('copyAzureRevisionForSingleton');
    expect(deployScript).toContain('setAzureSingleReplicaScale(0, 1)');
    expect(deployScript).toContain('pg_terminate_backend');
    expect(deployScript).toContain('revision');
    expect(deployScript).toContain('copy');
    expect(deployScript).toContain('stopping ${activeRevisions.length} active revision(s)');
    expect(deployScript).toContain(
      'refusing realm singleton handoff because no fallback revision is known',
    );
    expect(deployScript.indexOf('await routeAzureTrafficToRevision(latestRevision)')).toBeLessThan(
      deployScript.indexOf('await deactivateOlderAzureRevisions(revisions, latestRevision)'),
    );
    const restoreFallbackBody = deployScript.slice(
      deployScript.indexOf('async function restoreAzureFallbackRevision'),
    );
    expect(
      restoreFallbackBody.indexOf('await activateAzureRevisionIfNeeded(fallbackRevision)'),
    ).toBeLessThan(
      restoreFallbackBody.indexOf('await routeAzureTrafficToRevision(fallbackRevision)'),
    );
  });

  it('documents the Azure single-replica invariant for the MMO realm', () => {
    const docs = readFileSync(join(root, 'docs/glitch-deployment.md'), 'utf8');

    expect(docs).toContain('--min-replicas 1');
    expect(docs).toContain('--max-replicas 1');
    expect(docs).toContain('--mode multiple');
    expect(docs).toContain('restores traffic to the current known-good revision');
    expect(docs).toContain('GLITCH_AZURE_SINGLETON_HANDOFF_TIMEOUT_MS');
    expect(docs).toContain('GLITCH_AZURE_PUBLIC_HEALTH_PATH');
    expect(docs).toContain('REALM_SINGLETON_LOCK=1');
    expect(docs).toContain('Realm "Claudemoon" is already hosted');
    expect(docs).toContain('Postgres realm advisory lock holder');
    expect(docs).toContain('az containerapp revision copy');
    expect(docs).toContain('GLITCH_AZURE_POST_DEPLOY=0');
  });
});
