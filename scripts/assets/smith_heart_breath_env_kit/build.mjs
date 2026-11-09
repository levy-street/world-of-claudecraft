// Ship the Breath vein's painted kit (docs/design/raid/kit/
// build_smith_heart_breath_env_kit.py) through the shared ship step
// (scripts/assets/lib/ship_env_kit.mjs), then the textures to KTX2
// (scripts/assets/compress_glb_textures.mjs).
//
//   node scripts/assets/smith_heart_breath_env_kit/prepare_sources.mjs docs/design/raid/kit/breath_env_src/paintings tmp/breath_env tmp/breath_env/kit
//   "<blender>" -b --factory-startup --python docs/design/raid/kit/build_smith_heart_breath_env_kit.py -- --src tmp/breath_env/kit --out tmp/breath_env/smith_heart_breath_env_kit_components.glb
//   node scripts/assets/smith_heart_breath_env_kit/build.mjs
//   node scripts/assets/compress_glb_textures.mjs public/models/props/smith_heart_breath_env_kit.glb
import { shipEnvKit } from '../lib/ship_env_kit.mjs';

export const ASSET = {
  source: 'tmp/breath_env/smith_heart_breath_env_kit_components.glb',
  target: 'public/models/props/smith_heart_breath_env_kit.glb',
};

await shipEnvKit(ASSET);
