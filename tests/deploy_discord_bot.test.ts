import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dockerfile = readFileSync('Dockerfile', 'utf8');
const dockerignore = readFileSync('.dockerignore', 'utf8');
const compose = readFileSync('docker-compose.yml', 'utf8');
const composeEnv = (name: string) => `$${`{${name}:-}`}`;

describe('Discord bot deploy container contract', () => {
  it('builds and ships the bundled Discord bot artifact', () => {
    expect(dockerfile).toContain('COPY bot ./bot');
    expect(dockerfile).toContain('npm run build:bot');
    expect(dockerfile).toContain('COPY --from=build /app/dist-bot ./dist-bot');
  });

  it('keeps the Discord bot build script in the Docker build context', () => {
    expect(dockerignore).toContain('!scripts/build_bot.mjs');
  });

  it('runs the Discord bot as a separate compose service', () => {
    expect(compose).toContain('discord-bot:');
    expect(compose).toContain('container_name: eastbrook-discord-bot');
    expect(compose).toContain('command: ["node", "dist-bot/bot.cjs"]');
    expect(compose).toContain('GAME_SERVER_URL: http://game:8787');
    expect(compose).toContain(`DISCORD_BOT_TOKEN: ${composeEnv('DISCORD_BOT_TOKEN')}`);
  });

  it('passes the shared Discord bot secret to the game server', () => {
    expect(compose).toContain(`DISCORD_BOT_SECRET: ${composeEnv('DISCORD_BOT_SECRET')}`);
  });
});
