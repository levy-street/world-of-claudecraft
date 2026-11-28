// Ship the Hammer vein's painted kit (docs/design/raid/kit/
// build_smith_heart_hammer_env_kit.py) through the shared ship step
// (scripts/assets/lib/ship_env_kit.mjs), then the textures to KTX2
// (scripts/assets/compress_glb_textures.mjs).
//
//   "<blender>" -b --factory-startup --python docs/design/raid/kit/build_smith_heart_hammer_env_kit.py -- --src tmp/hammer_env --out tmp/hammer_env/smith_heart_hammer_env_kit_components.glb
//   node scripts/assets/smith_heart_hammer_env_kit/build.mjs
//   node scripts/assets/compress_glb_textures.mjs public/models/props/smith_heart_hammer_env_kit.glb
import { shipEnvKit } from '../lib/ship_env_kit.mjs';

export const ASSET = {
  source: 'tmp/hammer_env/smith_heart_hammer_env_kit_components.glb',
  target: 'public/models/props/smith_heart_hammer_env_kit.glb',
};

await shipEnvKit(ASSET);
