import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const compose = readFileSync('docker-compose.yml', 'utf8');
const deploy = readFileSync('DEPLOY.md', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');
const composeEnv = (name: string, fallback: string) => `$${`{${name}:-${fallback}}`}`;

describe('community test account deploy contract', () => {
  it('passes PROVISION_TEST_ACCOUNTS only to the game container and defaults it off', () => {
    expect(compose).toContain(
      `PROVISION_TEST_ACCOUNTS: ${composeEnv('PROVISION_TEST_ACCOUNTS', '0')}`,
    );
    expect(envExample).toContain('#PROVISION_TEST_ACCOUNTS=0');
    expect(envExample).not.toMatch(/^PROVISION_TEST_ACCOUNTS=1$/m);
  });

  it('documents the paired, reversible public-test profile', () => {
    expect(deploy).toContain('PROVISION_TEST_ACCOUNTS=1');
    expect(deploy).toContain('COMMUNITY_TEST_RIFTS=1');
    expect(deploy).toMatch(/newly created accounts/i);
    expect(deploy).toContain('ALLOW_DEV_COMMANDS');
    expect(deploy).toContain('RIFT_RUNTIME_ASSETS');
  });
});
