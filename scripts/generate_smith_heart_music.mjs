// The Smith's Heart's score: the ElevenLabs Music API takes for each of the
// raid's encounter cues (docs/design/raid/smith_heart.md section 7), the same
// call scripts/generate_minigame_music.mjs makes, with candidates kept apart
// so a person can audition them before one is mastered into
// public/audio/music/ by scripts/master_music_loop.mjs.
//
//   node scripts/generate_smith_heart_music.mjs <key|all> [takes=1] [outDir]
//
// Each take lands as <outDir>/<key>_take<n>.mp3 (never overwritten: the next
// free number is used). The key is read from the environment or the repo-root
// .env and never printed. Offline asset tooling only.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every take shares this tail: an instrumental loop that never resolves. */
const LOOP_TAIL =
  'Instrumental orchestral score, any choir sings only wordless vowels (no lyrics, no words). ' +
  'Full energy from the first bar, no fade-in, no fade-out, no ending, no final cadence: ' +
  'the last bar flows straight back into the first, a seamless video game boss loop. ' +
  'Original composition, cinematic, high fidelity, wide stereo.';

export const SMITH_HEART_TRACKS = {
  council: {
    filename: 'boss_heart_hammer_council.mp3',
    name: 'The Hammer Council (stone, the quarry, war drums)',
    prompt:
      'Epic dark fantasy raid boss battle music: two colossal stone guardians in a vast mountain quarry. ' +
      'Massive war drums and taiko ensembles, low brass and tubas like grinding rock, heavy cellos and basses ' +
      'in a relentless driving ostinato, deep male choir chanting wordless syllables, clanging stone and metal ' +
      'percussion hits, tectonic and earthy, D minor, 128 BPM, rising tension in waves. ',
    music_length_ms: 180000,
  },
  breath: {
    filename: 'boss_heart_breath.mp3',
    name: 'The Guardian of the Breath (wind, the summit, soaring)',
    prompt:
      'Epic soaring fantasy boss battle music on a windswept summit ledge above the clouds, a storm guardian. ' +
      'Rushing string runs and swirling flutes like gusting wind, heroic French horns soaring over the top, ' +
      'thunderous timpani and taiko, bright female choir on open vowels, rising arpeggios, sudden brass stabs like ' +
      'lightning strikes, vast open sky, airy yet dangerous, E minor, 140 BPM. ',
    music_length_ms: 180000,
  },
  quench: {
    filename: 'boss_heart_quench.mp3',
    name: 'The Guardian of the Quench (frost, water, tempered steel)',
    prompt:
      'Epic cold fantasy boss battle music on a frozen lake deep inside a mountain, a guardian of ice and water. ' +
      'Glassy celesta, crystal glass bells and shimmering high string harmonics, sharp staccato strings like ' +
      'cracking ice, hissing metallic swells like red-hot steel plunged into cold water, deep ominous brass, ' +
      'pounding low drums, haunting female choir on wordless vowels, B minor, 120 BPM, tense and glacial but driving. ',
    music_length_ms: 180000,
  },
  heat: {
    filename: 'boss_heart_heat.mp3',
    name: 'The Guardian of the Heat (the first flame, a giant)',
    prompt:
      'Epic blazing fantasy boss battle music against a towering giant of basalt and white-gold fire rising from ' +
      'a well of flame. Colossal slow-hitting giant drums, ringing hammer-on-anvil metallic strikes as the ' +
      'rhythm, roaring trombones and low horns, fierce driving strings, deep male choir chanting wordless ' +
      'syllables, crackling fire energy, majestic and furious, C minor, 124 BPM. ',
    music_length_ms: 180000,
  },
  final: {
    filename: 'boss_heart_masterless_strength.mp3',
    name: 'The Masterless Strength (the Heart, all four elements)',
    prompt:
      'Epic final raid boss battle music, the largest piece of the score: a colossal crystal heart at the core of ' +
      'a mountain binding four elements, stone, storm, frost and fire. Full symphony orchestra and huge choir on ' +
      'wordless vowels, massive war drums and taiko, ringing anvil strikes, crystal bell motif, soaring horn ' +
      'theme, swirling strings, shifting elemental colours, grand, heroic and dangerous, D minor, 134 BPM. ',
    music_length_ms: 180000,
  },
  final_last: {
    filename: 'boss_heart_masterless_last.mp3',
    name: 'The Masterless Strength, its last 15 percent (the climax)',
    prompt:
      'Climactic last phase of an epic final raid boss battle, maximum intensity, a desperate heroic last stand ' +
      'against a crystal heart pouring out all four elements. Full choir fortissimo on wordless vowels, double-time ' +
      'war drums and taiko, screaming brass fanfares, racing string ostinato, ringing anvil strikes and crystal ' +
      'bells, relentless and triumphant yet dire, D minor, 152 BPM. ',
    music_length_ms: 150000,
  },
  final_hidden: {
    filename: 'boss_heart_masterless_hidden.mp3',
    name: 'The Unmade Anvil (the Mythic hidden phase, dread)',
    prompt:
      'Dark dread orchestral boss music: the floor of the world collapsing piece by piece into an abyss while a ' +
      'reborn crystal heart beats. A slow giant heartbeat on low drums, deep descending brass clusters, ' +
      'dissonant string tremolo, rumbling sub bass, distant wordless choir, cracking stone percussion, horror ' +
      'and awe, relentless and inevitable, C sharp minor, 96 BPM. ',
    music_length_ms: 150000,
  },
  halls: {
    filename: 'dungeon_smith_heart.mp3',
    name: "The Smith's Heart halls (exploration between bosses)",
    prompt:
      'Calm but majestic fantasy exploration music deep inside a sacred mountain whose four veins hold stone, ' +
      'storm, frost and fire. Slow warm strings, a solemn horn melody, distant wordless choir, soft low drum ' +
      'pulse like a sleeping heart, glassy crystal bell textures, ancient and awe-filled, D minor, 72 BPM. ' +
      'Instrumental, any choir only wordless vowels. No fade-in, no fade-out, no ending: a seamless ambient ' +
      'video game loop. Original composition, cinematic, wide stereo.',
    music_length_ms: 180000,
    ownTail: true,
  },
};

function apiKey() {
  const envPath = path.join(rootDir, '.env');
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: offline asset generation tool
  if (!process.env.ELEVENLABS_API_KEY && existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // A malformed .env line is not fatal; an explicit env var still wins.
    }
  }
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: offline asset generation tool
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) {
    console.error('ELEVENLABS_API_KEY is not set (environment or the repo-root .env).');
    process.exit(1);
  }
  return key;
}

/** The full prompt one take sends. */
export function promptFor(track) {
  return track.ownTail ? track.prompt : `${track.prompt}${LOOP_TAIL}`;
}

/** The next `count` free take paths for a cue, numbered after any kept takes. */
function freeTakePaths(outDir, key, count) {
  const paths = [];
  for (let n = 1; paths.length < count; n++) {
    const p = path.join(outDir, `${key}_take${n}.mp3`);
    if (!existsSync(p)) paths.push(p);
  }
  return paths;
}

async function generateTake(track, outPath, xiKey) {
  console.log(`[ElevenLabs] ${track.name}: ${path.basename(outPath)}`);
  const response = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192', {
    method: 'POST',
    headers: { 'xi-api-key': xiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: promptFor(track),
      music_length_ms: track.music_length_ms,
      force_instrumental: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`API error (${response.status}): ${await response.text()}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(outPath, buffer);
  console.log(`  saved ${(buffer.length / 1024).toFixed(0)} KB`);
}

async function main() {
  const [target = '', takesArg = '1', outArg] = process.argv.slice(2);
  const keys = target === 'all' ? Object.keys(SMITH_HEART_TRACKS) : [target];
  for (const k of keys) {
    if (!SMITH_HEART_TRACKS[k]) {
      console.error(
        `Unknown track "${k}". Available: ${Object.keys(SMITH_HEART_TRACKS).join(', ')}`,
      );
      process.exit(1);
    }
  }
  const takes = Math.max(1, Math.min(6, Number.parseInt(takesArg, 10) || 1));
  const outDir = path.resolve(outArg ?? path.join(rootDir, 'tmp', 'smith_heart_music'));
  mkdirSync(outDir, { recursive: true });
  const xiKey = apiKey();
  for (const k of keys) {
    // Takes of one cue run side by side; cues run one after another.
    const paths = freeTakePaths(outDir, k, takes);
    await Promise.all(paths.map((p) => generateTake(SMITH_HEART_TRACKS[k], p, xiKey)));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[Error]', err.message);
    process.exit(1);
  });
}
