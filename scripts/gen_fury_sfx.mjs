// Bounded authoring only: never generates unrelated catalog entries or re-pays
// for a raw take already on disk. Public conformance is a separate review step.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FURY_SFX } from './sfx/fury_sfx.mjs';
import { HARVEST_IMPACT_SFX } from './sfx/harvest_impact_sfx.mjs';
import { WARRIOR_CONTACT_SFX } from './sfx/warrior_contact_sfx.mjs';

const reaver = process.argv.includes('--warrior-reaver');
const contact = reaver || process.argv.includes('--warrior-contact');
const harvest = process.argv.includes('--red-harvest-impact');
const sourceCues = harvest ? HARVEST_IMPACT_SFX : contact ? WARRIOR_CONTACT_SFX : FURY_SFX;
const cues = reaver ? sourceCues.filter((cue) => cue.key.includes('_warrior_reaver')) : sourceCues;
const folder = harvest
  ? 'tmp/harvest-impact-audio'
  : contact
    ? 'tmp/warrior-contact-audio'
    : 'tmp/fury-audio';
mkdirSync(join(folder, 'raw'), { recursive: true });
const ledgerPath = join(folder, 'generation-ledger.json');
const ledger = existsSync(ledgerPath)
  ? JSON.parse(readFileSync(ledgerPath, 'utf8'))
  : { provider: 'ElevenLabs sound-generation', takes: [] };
const planned = cues.flatMap((cue) =>
  Array.from({ length: cue.variants.length }, (_, index) => ({ ...cue, take: index + 1 })),
);
if (!process.argv.includes('--generate')) {
  console.log(
    JSON.stringify({
      planned: planned.length,
      generatedSeconds: planned.length * 0.5,
      command: `node scripts/gen_fury_sfx.mjs${contact ? ' --warrior-contact' : ''} --generate`,
    }),
  );
  process.exit(0);
}
try {
  process.loadEnvFile();
} catch {
  /* ambient key remains valid */
}
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error('ELEVENLABS_API_KEY is missing');
for (const cue of planned) {
  const filename = `${cue.key}_${cue.take}.mp3`;
  const file = join(folder, 'raw', filename);
  if (existsSync(file)) continue;
  console.log(`Generating ${filename}`);
  const response = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      model_id: 'eleven_text_to_sound_v2',
      text: cue.prompt,
      duration_seconds: 0.5,
      prompt_influence: 0.45,
      output_format: 'mp3_44100_128',
    }),
  });
  if (!response.ok)
    throw new Error(`Sound generation failed (${response.status}); prior takes retained`);
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(file, bytes);
  ledger.takes.push({
    filename,
    prompt: cue.prompt,
    generatedSeconds: 0.5,
    intendedDuration: cue.duration,
    generatedAt: new Date().toISOString(),
    requestId: response.headers.get('request-id'),
    characterCost: response.headers.get('character-cost'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(`Retained ${ledger.takes.length} raw takes; public assets unchanged`);
