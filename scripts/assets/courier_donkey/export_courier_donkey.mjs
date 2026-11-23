// Import the retained user-supplied rig through both repository compression stages.
// KTX_BIN may point to the Khronos KTX-Software bin directory.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = readFileSync(
  path.join(ROOT, 'scripts/assets/courier_donkey/source/winged_mail_donkey.glb'),
);
if (
  createHash('sha256').update(source).digest('hex') !==
  '28d31e0a4567a7719ef4eccc02175488c90263e177d75364ea4325d2da04e781'
) {
  throw new Error(
    'Courier donor changed: inspect its rig, clips and texture before updating the source pin.',
  );
}
for (const args of [
  ['scripts/assets/build_assets.mjs', 'scripts/assets/specs/courier_donkey.json'],
  ['scripts/assets/compress_glb_textures.mjs', 'public/models/creatures/courier_donkey.glb'],
  ['scripts/build_media_manifest.mjs', 'generate'],
]) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const output = readFileSync(path.join(ROOT, 'public/models/creatures/courier_donkey.glb'));
console.log(
  JSON.stringify(
    {
      sourceBytes: source.length,
      shippingBytes: output.length,
      shippingSha256: createHash('sha256').update(output).digest('hex'),
    },
    null,
    2,
  ),
);
