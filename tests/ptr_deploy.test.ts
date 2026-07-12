import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ptrBootstrap = readFileSync(
  new URL('../deploy/ptr-user-data.sh', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const productionBootstrap = readFileSync(
  new URL('../deploy/user-data.sh', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const deployGuide = readFileSync(new URL('../DEPLOY.md', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);

function shellAssignment(source: string, name: string): string | undefined {
  return source.match(new RegExp(`^${name}="([^"]*)"$`, 'm'))?.[1];
}

describe('PTR deployment boundary', () => {
  it('pins the canonical repository and PTR release branch', () => {
    expect(shellAssignment(ptrBootstrap, 'REPO')).toBe(
      'https://github.com/levy-street/world-of-claudecraft.git',
    );
    expect(shellAssignment(ptrBootstrap, 'BRANCH')).toBe('release/v0.24.0-ptr');
  });

  it('fails closed when the pinned branch cannot update', () => {
    expect(ptrBootstrap).toContain('git pull --ff-only origin "$BRANCH"');
    expect(ptrBootstrap).not.toMatch(/git pull[^\n]*\|\|\s*true/);
  });

  it('requires the deployed commit to equal the exact fetched remote ref', () => {
    expect(ptrBootstrap).toMatch(
      /git pull --ff-only origin "\$BRANCH"\nif \[ "\$\(git rev-parse HEAD\)" != "\$\(git rev-parse FETCH_HEAD\)" \]; then\n(?: {2}.*\n)+? {2}exit 1\nfi/,
    );
  });

  it('refuses nonignored source changes before building the PTR image', () => {
    const sourceGuard = ptrBootstrap.match(
      /if \[ -n "\$\(git status --porcelain --untracked-files=all\)" \]; then\n(?: {2}.*\n)+? {2}exit 1\nfi/,
    );

    expect(sourceGuard, 'missing fail-closed worktree guard').not.toBeNull();
    expect(ptrBootstrap.indexOf(sourceGuard?.[0] ?? '')).toBeLessThan(
      ptrBootstrap.indexOf('docker compose up -d --build'),
    );
  });

  it('passes dev commands only through an explicitly isolated PTR environment', () => {
    expect(shellAssignment(ptrBootstrap, 'APP_DIR')).toBe('/opt/eastbrook-ptr');
    expect(ptrBootstrap).toContain('echo "ALLOW_DEV_COMMANDS=1"');
    expect(compose).toMatch(/^\s{6}ALLOW_DEV_COMMANDS: \$\{ALLOW_DEV_COMMANDS:-\}\s*$/m);
    expect(compose).not.toMatch(/ALLOW_DEV_COMMANDS:\s*\$\{ALLOW_DEV_COMMANDS:-1\}/);
    expect(productionBootstrap).not.toContain('ALLOW_DEV_COMMANDS=1');
    expect(deployGuide).toContain('## PTR throwaway environment');
    expect(deployGuide).toContain('deploy/ptr-user-data.sh');
  });
});
