// Ship the Smith's Heart ring crystal (the heart seal at the Ring's centre, one crystal that
// holds the four elements): the Blender build of the Tripo P2 model
// (docs/design/raid/kit/build_smith_heart_ring_crystal.py) through the shared ship step
// (scripts/assets/lib/ship_env_kit.mjs: only the painting stays, the pieces are never
// joined), then the painting to KTX2 (scripts/assets/compress_glb_textures.mjs). Recipe and
// source records: docs/design/raid/kit/ring_crystal_src/README.md.
//
//   node scripts/assets/smith_heart_hammer_colossi/split_views.mjs docs/design/raid/kit/ring_crystal_src/sheets/ring_crystal_sheet_v4.webp tmp/ring_crystal/crystal/views 4
//   node scripts/assets/smith_heart_hammer_colossi/tripo_views.mjs tmp/ring_crystal/crystal 14000 2048
//   "<blender>" -b --factory-startup --python docs/design/raid/kit/build_smith_heart_ring_crystal.py -- --src tmp/ring_crystal/crystal/raw.glb --out tmp/ring_crystal/smith_heart_ring_crystal_src.glb --reach 8.6 --chunks 12 --crown-r 0.15 --crown-z 0.4
//   node scripts/assets/smith_heart_ring_crystal/build.mjs
//   node scripts/assets/compress_glb_textures.mjs public/models/props/smith_heart_ring_crystal.glb
//   node scripts/build_media_manifest.mjs generate
import { shipEnvKit } from '../lib/ship_env_kit.mjs';

export const ASSET = {
  source: 'tmp/ring_crystal/smith_heart_ring_crystal_src.glb',
  target: 'public/models/props/smith_heart_ring_crystal.glb',
};

await shipEnvKit(ASSET);
