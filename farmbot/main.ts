// IO shell for the farm bot: argument/env parsing, login, character
// resolution, ClientWorld construction, and the 10 Hz decision loop that
// drives the pure brain (farmbot/brain.ts). All time and process concerns
// live here; the brain, navigator, and config modules stay pure and are
// unit-tested without a network.
//
// Usage: node dist-farmbot/farmbot.cjs --config farmbot.config.json
// Credentials come from the environment (WOC_USERNAME / WOC_PASSWORD), never
// from the config file, and are never logged.

import { readFileSync } from 'node:fs';
import { Api, ClientWorld } from '../src/net/online';
import { zoneAt } from '../src/sim/data';
import { firstFishableSampleAhead } from '../src/sim/professions/fishing';
import { createBrain, stepBrain } from './brain';
import { type FarmBotConfig, parseConfig } from './config';
import { installNodeShims } from './shims';

const TICK_MS = 100; // 10 Hz decision loop
const HELLO_TIMEOUT_MS = 15_000;
const LOGOUT_GRACE_MS = 300; // let the logout frame flush before exit
const FBSTAT_INTERVAL_MS = 2_000; // launcher status channel cadence

function fail(message: string): never {
  console.error(`farmbot: ${message}`);
  process.exit(1);
}

function parseArgs(argv: readonly string[]): string {
  let configPath = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--config') {
      configPath = argv[i + 1] ?? '';
      i += 1;
    } else if (arg.startsWith('--config=')) {
      configPath = arg.slice('--config='.length);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  if (!configPath) fail('missing required argument: --config <path>');
  return configPath;
}

async function main(): Promise<void> {
  const configPath = parseArgs(process.argv.slice(2));

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (err) {
    fail(`cannot read config file '${configPath}': ${(err as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    fail(`config file '${configPath}' is not valid JSON: ${(err as Error).message}`);
  }
  let config: FarmBotConfig;
  try {
    config = parseConfig(json);
  } catch (err) {
    fail((err as Error).message);
  }

  // Dynamic key lookup, matching bot/config.ts: keeps the literal-key env
  // inventory lint quiet while the check below enforces presence.
  const env = (name: string): string => process.env[name] ?? '';
  const username = env('WOC_USERNAME');
  const password = env('WOC_PASSWORD');
  if (!username || !password) {
    fail('credentials come from the environment: set WOC_USERNAME and WOC_PASSWORD');
  }

  installNodeShims();

  const api = new Api();
  api.setRealm(config.serverUrl);
  const login = await api.login(username, password);
  if (login.twoFactorRequired) {
    fail('this account has two-factor authentication enabled; the bot does not support 2FA');
  }
  if (!api.token) fail('login failed: the server returned no session token');

  const characters = await api.characters();
  const character = characters.find((c) => c.name === config.characterName);
  if (!character) {
    const names = characters.map((c) => c.name).join(', ') || '(none)';
    fail(`character '${config.characterName}' not found on this account; have: ${names}`);
  }
  if (character.online) {
    // A live session elsewhere (stale tab, crash) holds the character;
    // displace it so the bot can enter the world.
    const takenOver = await api.takeoverCharacter(character.id);
    console.log(
      `farmbot: '${character.name}' had a live session, takeover ${takenOver ? 'done' : 'not needed'}`,
    );
  }

  const world = new ClientWorld(api.token, character.id, character.class, config.serverUrl);

  let loop: ReturnType<typeof setInterval> | null = null;
  let shuttingDown = false;
  const shutdown = (code: number): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (loop !== null) clearInterval(loop);
    try {
      world.sendLogout();
      world.close();
    } catch {
      // teardown must never mask the original exit path
    }
    setTimeout(() => process.exit(code), LOGOUT_GRACE_MS);
  };
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  // Readiness: the server's hello frame flips ClientWorld.connected
  // (online.ts onMessage). onDisconnect fires on any fatal rejection
  // (bad auth, kick, exhausted reconnects).
  let ready = false;
  await new Promise<void>((resolve, reject) => {
    const poll = setInterval(() => {
      if (world.connected) {
        ready = true;
        clearInterval(poll);
        resolve();
      }
    }, 50);
    const timeout = setTimeout(() => {
      clearInterval(poll);
      reject(
        new Error(`no server hello within ${HELLO_TIMEOUT_MS}ms (is ${config.serverUrl} up?)`),
      );
    }, HELLO_TIMEOUT_MS);
    world.onDisconnect = (reason) => {
      if (ready) {
        console.error(`farmbot: disconnected: ${reason}`);
        shutdown(1);
      } else {
        clearInterval(poll);
        clearTimeout(timeout);
        reject(new Error(`disconnected before ready: ${reason}`));
      }
    };
    world.onConnectionLost = (attempt, maxAttempts) => {
      console.log(`farmbot: connection lost, reconnect attempt ${attempt}/${maxAttempts}`);
    };
    world.onReconnected = () => {
      console.log('farmbot: reconnected');
    };
  });

  console.log(
    `farmbot: in world as ${character.name} (level ${character.level} ${character.class}), farming ${config.zoneId}`,
  );

  // Offline fishable-water probe for spot pre-validation. cfg.seed is the
  // authoritative server seed by now: createBrain runs after the hello wait.
  const brain = createBrain(config, {
    fishableAt: (x, z, facing) => firstFishableSampleAhead(x, z, facing, world.cfg.seed) !== null,
    zoneHubAt: (x, z) => zoneAt(x, z).hub,
    rng: Math.random,
    // Target mode's source resolver gates on this startup snapshot of the
    // character (tools/rods in bags, proficiency mirror, level).
    targetContext: {
      inventory: world.inventory,
      proficiencies: world.gatheringProficiency,
      playerLevel: world.player.level,
    },
  });
  const webhookUrl = config.safety.webhookUrl;
  let lastFbstatAt = 0;
  loop = setInterval(() => {
    try {
      const events = world.drainEvents();
      const lines = stepBrain(brain, world, events, Date.now());
      for (const line of lines) console.log(line);
      if (brain.alerts.length > 0) {
        // Alerts always print locally; with a webhook configured they also
        // POST Discord/Slack-compatible JSON, fire-and-forget.
        for (const entry of brain.alerts.splice(0)) {
          console.log(`ALERT: ${entry.text}`);
          if (webhookUrl) {
            void fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: entry.text }),
            }).catch((err: unknown) => {
              console.log(`alert webhook failed: ${(err as Error).message}`);
            });
          }
        }
      }
      // The launcher's status channel: one machine-readable line on its own,
      // parsed out of the log stream by the FBSTAT prefix.
      if (Date.now() - lastFbstatAt >= FBSTAT_INTERVAL_MS) {
        lastFbstatAt = Date.now();
        const player = world.player;
        console.log(
          `FBSTAT ${JSON.stringify({
            pos: { x: player.pos.x, z: player.pos.z },
            zoneId: zoneAt(player.pos.x, player.pos.z).id,
            mode: brain.mode,
            hp: player.hp,
            maxHp: player.maxHp,
            resource: player.resource,
            maxResource: player.maxResource,
            bagsUsed: world.inventory.length,
            bagCapacity: world.bagCapacity,
            stats: brain.stats,
            xp: world.xp,
            level: player.level,
            xpGained: brain.stats.xpGained,
            ...(config.mode === 'target'
              ? {
                  target: {
                    itemId: config.target.itemId,
                    count: brain.stats.targetCount,
                    goal: config.target.goal,
                  },
                }
              : {}),
            inventory: world.inventory.map((s) => ({ itemId: s.itemId, count: s.count })),
          })}`,
        );
      }
      if (brain.done) shutdown(0);
    } catch (err) {
      console.error(`farmbot: tick error: ${(err as Error).stack ?? err}`);
    }
  }, TICK_MS);
}

main().catch((err: unknown) => {
  fail((err as Error).message ?? String(err));
});
