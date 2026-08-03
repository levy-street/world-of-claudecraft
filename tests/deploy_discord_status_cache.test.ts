// Deploy contract for the Phase 9 /api/discord status cache levers
// (server/discord_status_cache.ts). The game service passes an EXPLICIT
// environment allowlist (no env_file), so a key missing from that list is
// INERT in production: the host .env populates compose interpolation but the
// value never reaches the process, and the operator lever documented in
// DEPLOY.md silently does nothing (the exact gap Phase 7 found on the bot
// service, where 11 of 24 knobs shipped inert). Template:
// tests/deploy_admission_cap.test.ts.
//
// The matching commented .env.example fills (#DISCORD_STATUS_CACHE_TTL_MS=15000,
// #DISCORD_STATUS_CACHE_MAX_ENTRIES=2000) are OWED to the maintainer: every
// .env* path is blocked at the harness level for agent sessions in this
// environment, so this file deliberately carries no .env.example pin until
// that lands.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const compose = readFileSync('docker-compose.yml', 'utf8');
const composeEnv = (name: string) => `$${`{${name}:-}`}`;

// The `game:` service block alone: discord-bot runs the SAME image, so a
// whole-file match would still pass if the passthrough landed on the wrong
// service (these are SERVER keys the bot never reads).
const gameService = compose.slice(
  compose.indexOf('\n  game:'),
  compose.indexOf('\n  discord-bot:'),
);

describe('/api/discord status cache deploy contract', () => {
  it('finds both game-service slice boundaries, in order', () => {
    const gameStart = compose.indexOf('\n  game:');
    const discordStart = compose.indexOf('\n  discord-bot:');
    expect(gameStart).toBeGreaterThanOrEqual(0);
    expect(discordStart).toBeGreaterThanOrEqual(0);
    expect(discordStart).toBeGreaterThan(gameStart);
  });

  it('passes both cache levers through to the game server container', () => {
    expect(gameService).toContain(
      `DISCORD_STATUS_CACHE_TTL_MS: ${composeEnv('DISCORD_STATUS_CACHE_TTL_MS')}`,
    );
    expect(gameService).toContain(
      `DISCORD_STATUS_CACHE_MAX_ENTRIES: ${composeEnv('DISCORD_STATUS_CACHE_MAX_ENTRIES')}`,
    );
  });

  it('documents both levers as DEPLOY.md rows', () => {
    const deploy = readFileSync('DEPLOY.md', 'utf8');
    // Backticked-key form: the keys appear only in their operator bullets, and
    // the pin must fail if a bullet is deleted while some prose echo survives.
    expect(deploy).toContain('`DISCORD_STATUS_CACHE_TTL_MS=`');
    expect(deploy).toContain('`DISCORD_STATUS_CACHE_MAX_ENTRIES=`');
  });
});
