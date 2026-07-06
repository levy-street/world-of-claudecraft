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

  it('preflights the locally built server and the live-failure site-presence route', () => {
    const preflight = readFileSync(join(root, 'scripts/glitch_predeploy_check.mjs'), 'utf8');

    expect(preflight).toContain("await run('npm', ['run', 'build']");
    expect(preflight).toContain("await run('npm', ['run', 'build:server']");
    expect(preflight).toContain('dist-server/server.cjs');
    expect(preflight).toContain('/api/project-stats');
    expect(preflight).toContain('/api/site-presence');
    expect(preflight).toContain("page: 'home'");
  });

  it('uses a realm name short enough for the server realm validator', () => {
    const preflight = readFileSync(join(root, 'scripts/glitch_predeploy_check.mjs'), 'utf8');

    expect(preflight).not.toContain('GlitchPreflight${Date.now()');
    expect(preflight).toContain('slice(-8)');
    expect(preflight).toContain('slice(-6)');
  });

  it('runs the Azure post-deploy handoff after the Glitch upload', () => {
    const deployScript = readFileSync(join(root, 'scripts/glitch_deploy.mjs'), 'utf8');

    expect(deployScript).toContain('runAzurePostDeployCheck');
    expect(deployScript).toContain('GLITCH_AZURE_POST_DEPLOY');
    expect(deployScript).toContain('--min-replicas');
    expect(deployScript).toContain('--max-replicas');
    expect(deployScript).toContain('already hosted by another game server process');
    expect(deployScript).toContain('activate');
    expect(deployScript.indexOf('await run(process.execPath, deployArgs, env)')).toBeLessThan(
      deployScript.indexOf('await runAzurePostDeployCheck()'),
    );
  });

  it('documents the Azure single-replica invariant for the MMO realm', () => {
    const docs = readFileSync(join(root, 'docs/glitch-deployment.md'), 'utf8');

    expect(docs).toContain('--min-replicas 1');
    expect(docs).toContain('--max-replicas 1');
    expect(docs).toContain('REALM_SINGLETON_LOCK=1');
    expect(docs).toContain('Realm "Claudemoon" is already hosted');
    expect(docs).toContain('GLITCH_AZURE_POST_DEPLOY=0');
  });
});
