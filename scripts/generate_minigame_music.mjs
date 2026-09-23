import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Read ELEVENLABS_API_KEY from .env if not set in process.env
// biome-ignore lint/suspicious/noUndeclaredEnvVars: offline asset generation tool
if (!process.env.ELEVENLABS_API_KEY) {
  const envPath = path.join(rootDir, '.env');
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
      if (match && match[1] === 'ELEVENLABS_API_KEY') {
        process.env.ELEVENLABS_API_KEY = match[2].trim().replace(/^['"]|['"]$/g, '');
        break;
      }
    }
  }
}

// biome-ignore lint/suspicious/noUndeclaredEnvVars: offline asset generation tool
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error('Error: ELEVENLABS_API_KEY is not defined in environment or .env');
  process.exit(1);
}

export const MINIGAME_TRACKS = {
  forge: {
    filename: 'minigame_forge.mp3',
    name: 'Taller de Forja (Smith Mara)',
    prompt:
      'Medieval fantasy blacksmith workshop theme, steady rhythmic hammer clanking on anvil beat, warm hearth atmosphere, acoustic folk instruments, lute, bodhran, tambourine, energetic artisan work groove, upbeat medieval game soundtrack, instrumental only, seamless loop feel',
    music_length_ms: 60000,
  },
  cannon: {
    filename: 'minigame_cannon.mp3',
    name: 'Defensa de Cañones (Evergarden / Last Keep)',
    prompt:
      'Urgent cinematic orchestral siege defense music, pounding heavy war drums, aggressive brass horn fanfare, strings ostinato, intense fantasy fortress battle march, epic artillery warfare rhythm, instrumental only, video game background music loop',
    music_length_ms: 60000,
  },
  glider: {
    filename: 'minigame_glider.mp3',
    name: 'Slalom de Planeador (Galecrest)',
    prompt:
      'Soaring aerial wind adventure theme, fast orchestral strings, energetic flutes, swooping brass fanfare, feeling of high-speed gliding through sky and cloudy canyons, uplifting heroic momentum, instrumental only, video game background music loop',
    music_length_ms: 60000,
  },
  pacman: {
    filename: 'minigame_pacman.mp3',
    name: 'Wisp Maze Arcade (Pac-Man)',
    prompt:
      'Fast-paced retro 8-bit chiptune arcade music, classic 1980s arcade maze chase groove, playful bouncy synthesizers, energetic electronic arpeggios, whimsical spooky arcade action, upbeat videogame soundtrack, instrumental only, video game background music loop',
    music_length_ms: 60000,
  },
  shadow: {
    filename: 'minigame_shadow.mp3',
    name: 'Infiltración y Sigilo (Capa de Sombras)',
    prompt:
      'Stealth fantasy espionage theme, sneaky pizzicato strings, soft footsteps rhythm, tense mysterious atmosphere, subtle bassline, covert agent infiltration in shadows, instrumental only, video game background music loop',
    music_length_ms: 60000,
  },
  match3: {
    filename: 'minigame_match3.mp3',
    name: 'Match-3 Confectioner (Dulces de Palmreach)',
    prompt:
      'Cheerful tropical puzzle game music, bouncy marimba and xylophone melodies, sunny ukulele rhythm, light acoustic percussion, casual candy puzzle theme, fun and playful vibe, instrumental only, video game background music loop',
    music_length_ms: 60000,
  },
  puzzle: {
    filename: 'minigame_puzzle.mp3',
    name: 'Líneas Ley y Rayos Arcanos (Galecrest)',
    prompt:
      'Catchy clever logic puzzle minigame theme, rhythmic marimba and vibraphone melody, clockwork ticking percussion, light groovy acoustic bass, playful intellectual challenge, engaging brain teaser puzzle game soundtrack, bouncy momentum, instrumental only, seamless loop',
    music_length_ms: 60000,
  },
  investigation: {
    filename: 'minigame_investigation.mp3',
    name: 'Investigación del Infiltrado (Fenbridge Watch)',
    prompt:
      'Medieval detective noir mystery theme, intriguing subtle piano, moody cello melodies, atmospheric suspense, deductive questioning groove, quiet tavern intrigue and suspicion, instrumental only, video game background music loop',
    music_length_ms: 60000,
  },
  calligraphy: {
    filename: 'minigame_calligraphy.mp3',
    name: 'Caligrafía Rúnica (Eastbrook)',
    prompt:
      'Playful and cheerful fantasy minigame music, whimsical magical melody with glockenspiel, bright pizzicato strings, bouncy joyful woodwinds, light rhythmic snare, upbeat curious wonder, Kirin Tor magic rune puzzle, fun and uplifting videogame soundtrack, instrumental only, seamless loop',
    music_length_ms: 60000,
  },
  caravan: {
    filename: 'minigame_caravan.mp3',
    name: 'Escolta de Caravanas (Comercio de Ruta)',
    prompt:
      'Tense and determined medieval caravan escort theme, watchful defensive march with steady military snare and hand drums, vigilant acoustic guitar and brooding cello, danger on the road, gritty frontier wagon train guard, alert anticipation of bandit ambushes, instrumental only, seamless loop',
    music_length_ms: 60000,
  },
};

async function generateTrack(_key, config) {
  console.log(`[ElevenLabs] Generating ${config.name} (${config.filename})...`);
  console.log(`  Prompt: "${config.prompt}"`);
  console.log(`  Duration: ${config.music_length_ms / 1000}s`);

  const response = await fetch('https://api.elevenlabs.io/v1/music', {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: config.prompt,
      music_length_ms: config.music_length_ms,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error (${response.status}): ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const outPath = path.join(rootDir, 'public', 'audio', 'music', config.filename);
  writeFileSync(outPath, buffer);
  console.log(`[Success] Saved to ${outPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  const targetKey = process.argv[2];
  if (targetKey && !MINIGAME_TRACKS[targetKey]) {
    console.error(
      `Unknown track key: "${targetKey}". Available: ${Object.keys(MINIGAME_TRACKS).join(', ')}`,
    );
    process.exit(1);
  }

  const entries = targetKey
    ? [[targetKey, MINIGAME_TRACKS[targetKey]]]
    : Object.entries(MINIGAME_TRACKS);

  console.log(`Generating ${entries.length} track(s) using ElevenLabs Music API...`);
  for (const [key, config] of entries) {
    await generateTrack(key, config);
  }
  console.log('All requested tracks generated successfully!');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[Error]', err);
    process.exit(1);
  });
}
