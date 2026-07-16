import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const compose = readFileSync('docker-compose.yml', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');
const composeEnv = (name: string) => `$${`{${name}:-}`}`;

// The `game:` service block alone (same slice as deploy_game_ops.test.ts):
// discord-bot runs the SAME image, so a whole-file match would still pass if the
// cap passthrough landed on the wrong service.
const gameService = compose.slice(
  compose.indexOf('\n  game:'),
  compose.indexOf('\n  discord-bot:'),
);

describe('realm admission cap deploy contract', () => {
  // If either boundary marker is missing, indexOf returns -1 and the slice silently
  // degrades into a near-whole-file match, unmaking the scoping the pin below relies
  // on. Assert both markers exist and are ordered, like deploy_game_ops.test.ts does.
  it('finds both game-service slice boundaries, in order', () => {
    const gameStart = compose.indexOf('\n  game:');
    const discordStart = compose.indexOf('\n  discord-bot:');
    expect(gameStart).toBeGreaterThanOrEqual(0);
    expect(discordStart).toBeGreaterThanOrEqual(0);
    expect(discordStart).toBeGreaterThan(gameStart);
  });

  // The game service passes an explicit environment allowlist (no env_file), so a
  // value only reaches the container if it is listed here. MAX_PLAYERS_PER_REALM
  // caps fresh WS admissions (server/ws_auth.ts): without this passthrough line,
  // setting it in the host .env would populate compose interpolation but never
  // reach the process, silently leaving the realm on its built-in default.
  it('passes MAX_PLAYERS_PER_REALM through to the game server container', () => {
    expect(gameService).toContain(`MAX_PLAYERS_PER_REALM: ${composeEnv('MAX_PLAYERS_PER_REALM')}`);
  });

  it('documents MAX_PLAYERS_PER_REALM in .env.example, commented out (default applies)', () => {
    expect(envExample).toContain('#MAX_PLAYERS_PER_REALM=');
  });
});
