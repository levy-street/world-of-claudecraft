import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const blueprint = readFileSync('render.frankfurt.yaml', 'utf8');
const activeBlueprint = readFileSync('render.yaml', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');

describe('Frankfurt Devnet economy deployment contract', () => {
  it('enables only the built-in test economy against Solana Devnet', () => {
    expect(blueprint).toContain('- key: WOC_TEST_ECONOMY\n        value: "1"');
    expect(blueprint).toContain(
      '- key: SOLANA_RPC_URL\n        value: https://api.devnet.solana.com',
    );
    expect(blueprint).toContain(
      '- key: WOC_TEST_TREASURY\n        # Public Devnet treasury recovered from the old marketplace dry-run\n        # roster (docs/woc-marketplace-hardening/devnet.md). No private key is\n        # stored in the repository or Render configuration.\n        value: 9fzukogxcT5c113MA7gNSeP1UMsc3eH27BXbBihWaUqf',
    );
    expect(blueprint).not.toContain('api.mainnet-beta.solana.com');
    expect(activeBlueprint).toContain('- key: WOC_TEST_ECONOMY\n        value: "1"');
    expect(activeBlueprint).toContain(
      '- key: SOLANA_RPC_URL\n        value: https://api.devnet.solana.com',
    );
    expect(activeBlueprint).toContain('value: 9fzukogxcT5c113MA7gNSeP1UMsc3eH27BXbBihWaUqf');
    expect(activeBlueprint).not.toContain('api.mainnet-beta.solana.com');
  });

  it('caps the free Frankfurt realm at the requested 25 players', () => {
    expect(blueprint).toContain('- key: MAX_PLAYERS_PER_REALM\n        value: "25"');
    expect(activeBlueprint).toContain('- key: MAX_PLAYERS_PER_REALM\n        value: "25"');
  });

  it('documents every test-economy setting as server-side and test-only', () => {
    expect(envExample).toContain('#WOC_TEST_ECONOMY=1');
    expect(envExample).toContain('#WOC_TEST_TREASURY=');
    expect(envExample).toContain('#WOC_TEST_SOL_USD=150');
    expect(envExample).toContain('Solana Devnet test economy');
  });
});
