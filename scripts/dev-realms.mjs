#!/usr/bin/env node
// Run several realms locally so you can exercise the classic-MMO-style realm picker.
//
//   npm run realms            # build the server, then launch the realms below
//
// Each realm is a separate process (process-per-realm) sharing the one local
// database from .env. They all advertise the same REALMS directory, so the
// client served by any of them lists and can switch to the others. Connect to
// the first realm's port in your browser. Ctrl-C stops them all.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// Edit this list to add/remove local realms. type: Normal | PvP | RP | RP-PvP
const REALMS = [
  { name: 'Claudemoon', port: 8787, type: 'Normal' },
  { name: 'Highwatch', port: 8788, type: 'PvP' },
  { name: 'Stormhaven', port: 8789, type: 'RP' },
];

const SERVER = 'dist-server/server.cjs';
if (!existsSync(SERVER)) {
  console.error(
    `Missing ${SERVER}. Run \`npm run build:server\` first (or use \`npm run realms\`).`,
  );
  process.exit(1);
}

const directory = REALMS.map((r) => `${r.name}=http://localhost:${r.port}=${r.type}`).join(',');
const COLORS = ['36', '35', '33', '32', '34', '31']; // ansi fg per realm
const children = [];

for (const [i, realm] of REALMS.entries()) {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      REALM_NAME: realm.name,
      REALM_TYPE: realm.type,
      PORT: String(realm.port),
      REALMS: directory,
    },
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  const tag = `\x1b[${COLORS[i % COLORS.length]}m[${realm.name}:${realm.port}]\x1b[0m`;
  const pipe = (stream, dest) =>
    stream.on('data', (b) => {
      for (const line of String(b).split('\n')) if (line.trim()) dest.write(`${tag} ${line}\n`);
    });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.error(`${tag} exited (${code}). Shutting the cluster down.`);
    shutdown();
  });
  children.push(child);
}

console.log(
  `\nLaunched ${REALMS.length} realms. Open http://localhost:${REALMS[0].port} and pick a realm.\n`,
);

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
