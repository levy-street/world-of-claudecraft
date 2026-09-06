// The Rift Forge kill switch reaches the shipped container.
//
// server/rift_forge_gate.ts reads RIFT_FORGE_ENABLED per verdict (open unless
// the value is 0 / false / off / no), but the shipped compose deployment hands
// the game service an explicit environment allowlist (no env_file), so a value
// set in the host .env never reaches the process unless the game service's
// environment block forwards it. The deploy_*.test.ts family owns this
// contract for the other runtime knobs; this file owns it for the forge
// switch, and pins the two operator docs that name the variable.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const compose = readFileSync('docker-compose.yml', 'utf8');
const deployDoc = readFileSync('DEPLOY.md', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');

/** The game service's environment block: from its `environment:` key to the
 *  service's next sibling key (the four-space keys like `ports:`), which is
 *  before any other service can start. */
function gameServiceEnvironment(text: string): string {
  const service = text.indexOf('\n  game:\n');
  expect(service, 'docker-compose.yml declares the game service').toBeGreaterThan(-1);
  const env = text.indexOf('    environment:\n', service);
  expect(env, 'the game service has an explicit environment block').toBeGreaterThan(-1);
  const next = text.slice(env + 1).search(/\n {4}[a-z_]+:/);
  return next === -1 ? text.slice(env) : text.slice(env, env + 1 + next);
}

describe('the Rift Forge kill switch reaches the shipped container', () => {
  it('passes RIFT_FORGE_ENABLED through to the game service, empty when unset', () => {
    const block = gameServiceEnvironment(compose);
    // Empty (unset) keeps the built-in default (open); the operator's 0 closes.
    expect(block).toContain('RIFT_FORGE_ENABLED: ${RIFT_FORGE_ENABLED:-}');
  });

  it('documents the switch where an operator looks for it', () => {
    expect(deployDoc).toContain('RIFT_FORGE_ENABLED');
    const start = envExample.indexOf('# Rift forge wire commands');
    const end = envExample.indexOf('#RIFT_FORGE_ENABLED=0', start);
    expect(start, 'the env example carries the forge paragraph').toBeGreaterThan(-1);
    expect(end, 'the paragraph ends on the commented-out switch').toBeGreaterThan(start);
    // The switch pauses the forge PAIR; the retired enchant is not a wire
    // command an operator can close. Scoped to the paragraph, so a future
    // Enchanting-profession knob documented elsewhere in the file is not caught.
    expect(envExample.slice(start, end)).not.toMatch(/enchant/i);
  });
});
