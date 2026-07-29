// Builds the parse-service content pack from the sim source of truth: the
// dictionary woc-parse-service uses to label ability ids, mob keys, zones,
// dungeons, classes, and specs without importing game code. Mirrors the
// esbuild-bundle pattern of scripts/wiki/build_content.mjs (never import raw
// .ts). Run DIRECTLY: `node scripts/parse/build_content_pack.mjs`; writes
// dist/parse-content-pack.json. NO npm alias, deliberately: the Fenbridge
// asset family fingerprints all of package.json as a shipping-GLB input
// (tests/fenbridge_town_assets.test.ts), so a script entry demands a 63-file
// re-export; same ruling as scripts/gate_select.mjs. With --ship
// (PARSE_INGEST_URL + PARSE_INGEST_TOKEN set) it also POSTs the pack to the
// service as a one-record batch.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import * as esbuild from 'esbuild';

const root = process.cwd();
const outFile = path.join(root, 'dist', 'parse-content-pack.json');

const entrySource = `
  export { CLASSES, ABILITIES } from './src/sim/content/classes.ts';
  export { TALENTS } from './src/sim/content/talents.ts';
  export { ZONES, DUNGEONS, MOBS } from './src/sim/data.ts';
`;

const built = await esbuild.build({
  stdin: {
    contents: entrySource,
    resolveDir: root,
    sourcefile: 'parse-content-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const dataUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`;
const { CLASSES, ABILITIES, TALENTS, ZONES, DUNGEONS, MOBS } = await import(dataUrl);

const build = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;

const abilities = {};
const abilityNameToId = {};
for (const [id, def] of Object.entries(ABILITIES)) {
  abilities[id] = { name: def.name, class: def.class ?? null, castTime: def.castTime ?? 0 };
  // damage.ability is a display name today (fidelity gap 7.6); this bridge
  // lets the service resolve names until stable ids ride every event.
  if (abilityNameToId[def.name] === undefined) abilityNameToId[def.name] = id;
}

const mobs = {};
for (const [key, def] of Object.entries(MOBS)) {
  mobs[key] = {
    name: def.name,
    boss: def.boss === true,
    elite: def.elite === true,
    family: def.family ?? null,
    level: def.level ?? def.minLevel ?? null,
  };
}

const zones = {};
for (const zone of ZONES) {
  zones[zone.id] = zone.name;
}

const dungeons = {};
for (const [id, def] of Object.entries(DUNGEONS)) {
  const spawnTemplates = new Set();
  for (const spawn of def.spawns ?? []) {
    const template = spawn.template ?? spawn.templateId ?? spawn.mob ?? null;
    if (typeof template === 'string') spawnTemplates.add(template);
  }
  dungeons[id] = {
    name: def.name,
    bossKeys: [...spawnTemplates].filter((t) => MOBS[t]?.boss === true),
  };
}

const classes = {};
for (const [id, def] of Object.entries(CLASSES)) {
  classes[id] = {
    name: def.name,
    resourceType: def.resourceType ?? null,
    specs: (TALENTS[id]?.specs ?? []).map((spec) => ({ id: spec.id, name: spec.name })),
  };
}

const payload = { abilities, abilityNameToId, mobs, zones, dungeons, classes };
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify({ build, payload }, null, 2)}\n`);
console.log(
  `parse content pack: build ${build}, ${Object.keys(abilities).length} abilities, ` +
    `${Object.keys(mobs).length} mobs, ${Object.keys(dungeons).length} dungeons -> ${path.relative(root, outFile)}`,
);

if (process.argv.includes('--ship')) {
  const url = process.env.PARSE_INGEST_URL;
  const token = process.env.PARSE_INGEST_TOKEN;
  if (!url || !token) {
    console.error('parse:content --ship needs PARSE_INGEST_URL and PARSE_INGEST_TOKEN');
    process.exit(1);
  }
  const header = {
    t: 'batch',
    v: 1,
    batchId: `content-${build}-${Date.now()}`,
    realm: 'content',
    env: process.env.PARSE_ENV_LABEL ?? 'dev',
    build,
    sentAtMs: Date.now(),
  };
  const record = { t: 'content_pack', build, payload };
  const body = gzipSync(
    Buffer.from(`${JSON.stringify(header)}\n${JSON.stringify(record)}`, 'utf8'),
  );
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-ndjson', 'x-woc-parse-secret': token },
    body,
    signal: AbortSignal.timeout(15000),
    // Never follow a redirect with the secret attached (cross-origin
    // redirects forward custom headers).
    redirect: 'error',
  });
  if (!res.ok) {
    console.error(`parse:content ship failed: ${res.status}`);
    process.exit(1);
  }
  console.log('parse content pack shipped');
}
