import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const atlas = path.resolve('scripts/assets/demon_hunter_skill_atlas.png');
const vengefulRetreatIcon = path.resolve('scripts/assets/vengeful_retreat_icon.png');
const outDir = path.resolve('public/ui/skills/demon_hunter');
const iconSize = 128;
const cols = 4;
const rows = 3;

const abilities = [
  'demon_bite',
  'chaos_strike',
  'throw_glaive',
  'fel_rush',
  'immolation_aura',
  'blur',
  'blade_dance',
  'sigil_of_flame',
  'eye_beam',
  'metamorphosis',
  'vengeful_retreat',
];

const meta = await sharp(atlas).metadata();
if (!meta.width || !meta.height) throw new Error(`Could not read atlas dimensions: ${atlas}`);
const cellW = Math.floor(meta.width / cols);
const cellH = Math.floor(meta.height / rows);
const size = Math.min(cellW, cellH);
const leftPad = Math.floor((meta.width - cellW * cols) / 2);
const topPad = Math.floor((meta.height - cellH * rows) / 2);

for (let i = 0; i < abilities.length; i++) {
  const abilityId = abilities[i];
  const column = i % cols;
  const row = Math.floor(i / cols);
  const source = abilityId === 'vengeful_retreat' ? vengefulRetreatIcon : atlas;
  const pipeline = sharp(source);
  if (abilityId !== 'vengeful_retreat') {
    pipeline.extract({ left: leftPad + column * cellW, top: topPad + row * cellH, width: size, height: size });
  }
  await pipeline
    .resize(iconSize, iconSize, { fit: 'cover' })
    .webp({ quality: 88, alphaQuality: 100, smartSubsample: true, effort: 6 })
    .toFile(path.join(outDir, `${abilityId}.webp`));
}

const mapping = {
  class: 'demon_hunter',
  license:
    'Generated in-repo raster atlas by Codex/OpenAI image generation for World of ClaudeCraft; project-owned generated bitmap assets.',
  iconSize,
  sourceAtlas: 'scripts/assets/demon_hunter_skill_atlas.png',
  runtimeDir: 'public/ui/skills/demon_hunter',
  grid: { columns: cols, rows, sourceWidth: meta.width, sourceHeight: meta.height },
  abilities: abilities.map((abilityId, i) => ({
    abilityId,
    sourceCell: { column: i % cols, row: Math.floor(i / cols) },
    output: `${abilityId}.webp`,
    source: abilityId === 'vengeful_retreat' ? 'scripts/assets/vengeful_retreat_icon.png' : 'scripts/assets/demon_hunter_skill_atlas.png',
  })),
};
await writeFile(path.join(outDir, 'mapping.json'), `${JSON.stringify(mapping, null, 2)}\n`);
console.log(`generated ${abilities.length} Demon Hunter icons from ${mapping.sourceAtlas}`);