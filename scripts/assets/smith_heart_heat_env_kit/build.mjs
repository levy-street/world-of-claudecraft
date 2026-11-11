// Ship the Heat vein's painted kit (docs/design/raid/kit/
// build_smith_heart_heat_env_kit.py) through the shared ship step
// (scripts/assets/lib/ship_env_kit.mjs), then the textures to KTX2
// (scripts/assets/compress_glb_textures.mjs).
//
//   node scripts/assets/smith_heart_heat_env_kit/prepare_sources.mjs docs/design/raid/kit/heat_env_src/paintings tmp/heat_env tmp/heat_env/kit
//   "<blender>" -b --factory-startup --python docs/design/raid/kit/build_smith_heart_heat_env_kit.py -- --src tmp/heat_env/kit --out tmp/heat_env/smith_heart_heat_env_kit_components.glb
//   node scripts/assets/smith_heart_heat_env_kit/build.mjs
//   node scripts/assets/compress_glb_textures.mjs public/models/props/smith_heart_heat_env_kit.glb
import { shipEnvKit } from '../lib/ship_env_kit.mjs';

export const ASSET = {
  source: 'tmp/heat_env/smith_heart_heat_env_kit_components.glb',
  target: 'public/models/props/smith_heart_heat_env_kit.glb',
};

await shipEnvKit(ASSET);
