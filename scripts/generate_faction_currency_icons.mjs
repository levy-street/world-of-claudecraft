import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const CURRENCY_DIR = path.join(ROOT, 'public', 'ui', 'currency');

const ICONS = [
  {
    src: path.join(ROOT, 'public', 'ui', 'items', 'rift_watchers_band.webp'),
    dest: path.join(CURRENCY_DIR, 'rift_watch_mark.webp'),
  },
  {
    src: path.join(ROOT, 'public', 'ui', 'items', 'order_prayer_beads.webp'),
    dest: path.join(CURRENCY_DIR, 'church_order_crest.webp'),
  },
  {
    src: path.join(ROOT, 'public', 'ui', 'items', 'automaton_cog_ring.webp'),
    dest: path.join(CURRENCY_DIR, 'automaton_cog.webp'),
  },
];

async function main() {
  for (const icon of ICONS) {
    await sharp(icon.src).resize(128, 128).webp({ quality: 90 }).toFile(icon.dest);
    console.log(`Generated ${path.basename(icon.dest)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
