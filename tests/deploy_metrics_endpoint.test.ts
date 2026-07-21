import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const compose = readFileSync('docker-compose.yml', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');
const composeEnv = (name: string) => `$${`{${name}:-}`}`;

describe('Prometheus /metrics deploy contract', () => {
  // The game service passes an explicit environment allowlist (no env_file), so a
  // secret only reaches the container if it is listed here. METRICS_TOKEN gates
  // GET /metrics (server/http/health.ts): without this line, setting it in the
  // host .env would populate compose interpolation but never reach the process,
  // leaving the endpoint stuck at 404.
  it('passes METRICS_TOKEN through to the game server container', () => {
    expect(compose).toContain(`METRICS_TOKEN: ${composeEnv('METRICS_TOKEN')}`);
  });

  it('documents METRICS_TOKEN in .env.example, commented out (off by default)', () => {
    expect(envExample).toContain('#METRICS_TOKEN=');
  });
});
