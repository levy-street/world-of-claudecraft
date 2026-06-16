// STUB (RFC) — bridge entrypoint. Mirrors headless/env_server.ts as a thin top-level service.
// Loads the agent roster, starts the lifecycle manager, and exposes a small control plane.
// TODO(eliza): real config loading, graceful shutdown, structured logging.

import { AgentManager } from './src/AgentManager.js';

async function main(): Promise<void> {
  const cfg = {
    wocServerUrl: process.env.WOC_SERVER_URL ?? 'http://localhost:8787',
    payCluster: process.env.WOC_PAY_CLUSTER ?? 'devnet',
    skipPayment: process.env.WOC_SKIP_PAYMENT === '1', // DEV ONLY — never in prod
  };

  const manager = new AgentManager(cfg);
  await manager.start();

  // TODO(eliza): start control/http.ts (POST /agents, POST /agents/:id/stop, GET /agents)
  // TODO(eliza): handle SIGINT/SIGTERM -> manager.stopAll()
  throw new Error('TODO(eliza): bridge main loop');
}

main().catch((err) => {
  console.error('[bridge] fatal', err);
  process.exitCode = 1;
});
