// Synthesize an mp3 for every NPC voice line via ElevenLabs text-to-speech, using
// the per-NPC voices designed by gen_npc_voices.mjs (scripts/voices/voice_ids.json).
//
// Lines come straight from the deterministic sim content (NPC greetings + quest
// offer/completion text). Since scripts can't import the TS sources raw, we bundle
// src/sim/data.ts with esbuild (same trick as export_loot_spreadsheet.mjs) and read
// NPCS / QUESTS off the bundle.
//
//   node scripts/gen_npc_lines.mjs [--force]
//
// Output:
//   public/audio/voice/<voiceNpc>/<lineKey>.mp3   the audio (served at /audio/voice/…)
//   src/game/voice_manifest.generated.ts          lineKey -> public path (runtime lookup)
//
// Idempotent: existing mp3s are skipped unless --force. The key is read from the
// environment / local .env; never commit it.

import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { voiceIdFor } from './voices/npc_voice_prompts.mjs';
import { EXTRA_LINES } from './voices/extra_lines.mjs';

const API = 'https://api.elevenlabs.io';
const TTS_MODEL = 'eleven_multilingual_v2'; // quality model — generation is one-time
const OUTPUT_FORMAT = 'mp3_44100_128';
const root = process.cwd();
const idsPath = path.join(root, 'scripts/voices/voice_ids.json');
const voiceDir = path.join(root, 'public/audio/voice');
const manifestPath = path.join(root, 'src/game/voice_manifest.generated.ts');

const force = process.argv.includes('--force');
// Optional `--only <substr>`: synthesize only lines whose key contains <substr>
// (e.g. a single new quest id). The manifest still rebuilds from every clip on
// disk, so this scopes API calls without dropping existing lines.
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

try { process.loadEnvFile(); } catch { /* no .env — rely on the ambient env */ }
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error('ELEVENLABS_API_KEY is not set (env or .env). Aborting.');
  process.exit(1);
}

if (!existsSync(idsPath)) {
  console.error(`Missing ${path.relative(root, idsPath)} — run gen_npc_voices.mjs first.`);
  process.exit(1);
}
const ids = JSON.parse(readFileSync(idsPath, 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Bundle the sim content tables and import them in-process.
async function loadContent() {
  const build = await esbuild.build({
    stdin: {
      contents: "export { NPCS, QUESTS } from './src/sim/data.ts';",
      resolveDir: root,
      sourcefile: 'voice-lines-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  const dataUrl = `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`;
  return import(dataUrl);
}

// Player-specific tokens can't be baked into a recording — neutralize them so the
// voiced line reads naturally for everyone. ($N name, $C class, $d damage; mirrors
// the runtime expansion in src/ui/entity_i18n.ts.)
function spoken(text) {
  return text
    .replace(/\$N/g, 'adventurer')
    .replace(/\$C/g, 'adventurer')
    .replace(/\$d/g, 'some')
    .replace(/\s+/g, ' ')
    .trim();
}

async function tts(voiceId, text, { retries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/v1/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`, {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: TTS_MODEL }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const detail = await res.text().catch(() => '');
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      const wait = 1500 * (attempt + 1);
      console.warn(`  tts ${voiceId} -> ${res.status}; retrying in ${wait}ms`);
      await sleep(wait);
      continue;
    }
    throw new Error(`tts ${voiceId} -> ${res.status} ${detail.slice(0, 200)}`);
  }
}

const { NPCS, QUESTS } = await loadContent();

// Build the full line list. Each line carries the speaking NPC's voice (giver
// speaks quest offers, turn-in speaks completions); recurring Aldric/Maren records
// resolve to their base voice via voiceIdFor.
const lines = [];
for (const npc of Object.values(NPCS)) {
  if (npc.greeting) lines.push({ key: `greeting__${npc.id}`, text: npc.greeting, voiceNpc: voiceIdFor(npc.id) });
}
for (const q of Object.values(QUESTS)) {
  if (q.text) lines.push({ key: `quest__${q.id}__offer`, text: q.text, voiceNpc: voiceIdFor(q.giverNpcId) });
  if (q.completionText) lines.push({ key: `quest__${q.id}__complete`, text: q.completionText, voiceNpc: voiceIdFor(q.turnInNpcId) });
}
// Encounter dialogue (yells/bubbles) that isn't on an NpcDef/QuestDef.
for (const e of EXTRA_LINES) lines.push({ key: e.key, text: e.text, voiceNpc: e.voiceNpc });

const publicPathFor = (line) => `/audio/voice/${line.voiceNpc}/${line.key}.mp3`;
const diskPathFor = (line) => path.join(voiceDir, line.voiceNpc, `${line.key}.mp3`);

let made = 0;
let skipped = 0;
let chars = 0;
const missingVoice = new Set();

for (const line of lines) {
  if (only && !line.key.includes(only)) continue;
  const voiceId = ids[line.voiceNpc];
  if (!voiceId) {
    missingVoice.add(line.voiceNpc);
    console.warn(`no voice for ${line.voiceNpc} — skipping ${line.key}`);
    continue;
  }
  const dest = diskPathFor(line);
  if (existsSync(dest) && !force) { skipped++; continue; }
  const text = spoken(line.text);
  process.stdout.write(`tts  ${line.key} (${line.voiceNpc}, ${text.length} chars)… `);
  try {
    const mp3 = await tts(voiceId, text);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, mp3);
    chars += text.length;
    made++;
    console.log('ok');
    await sleep(250);
  } catch (err) {
    console.log('FAILED');
    console.error(`  ${err.message}`);
    process.exitCode = 1;
    break;
  }
}

// Regenerate the manifest from whatever audio actually exists on disk, so runtime
// never points at a missing clip even after a partial run.
const entries = {};
for (const line of lines) {
  if (existsSync(diskPathFor(line))) entries[line.key] = publicPathFor(line);
}
const sorted = Object.fromEntries(Object.keys(entries).sort().map((k) => [k, entries[k]]));
mkdirSync(path.dirname(manifestPath), { recursive: true });
writeFileSync(
  manifestPath,
  [
    '// Generated by scripts/gen_npc_lines.mjs. Do not edit by hand.',
    '// Maps an NPC voice-line key to its public audio path (served from public/).',
    'export const VOICE_LINES: Record<string, string> = ',
    `${JSON.stringify(sorted, null, 2)} as const;`,
    '',
  ].join('\n'),
);

console.log(`\nDone: ${made} synthesized, ${skipped} skipped, ${Object.keys(sorted).length}/${lines.length} lines have audio.`);
console.log(`Billed ~${chars} characters this run. Manifest: ${path.relative(root, manifestPath)}`);
if (missingVoice.size) console.log(`Missing voices (run gen_npc_voices.mjs): ${[...missingVoice].join(', ')}`);
