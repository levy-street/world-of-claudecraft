#!/usr/bin/env node
// Declare the ORM occlusion channel on the shipped GLBs.
//
// The Tripo-generated props/weapons/mounts carry a packed ORM texture
// (R = occlusion, G = roughness, B = metalness, the glTF convention; verified
// on samples: the R channel holds real baked cavity data, e.g. anvil.glb
// MI_Trim_Metal R min 50 / mean 244) but the exporter only wires it as
// metallicRoughnessTexture. Without an occlusionTexture declaration the R
// channel is dead weight: three's GLTFLoader never builds an aoMap from it.
// Declaring the SAME texture as occlusionTexture costs zero bytes of new
// image data and gives every such material its baked AO for free at runtime
// (GLTFLoader assigns material.aoMap and reads the R channel by spec).
//
// Usage:
//   node scripts/assets/declare_orm_occlusion.mjs --check   report only
//   node scripts/assets/declare_orm_occlusion.mjs --write   rewrite the GLBs
//
// IO setup matches scripts/asset_pipeline/lib/glb.mjs (NodeIO + ALL_EXTENSIONS
// + meshopt codecs), so meshopt-compressed statics round-trip losslessly.
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGlb, saveGlb } from '../asset_pipeline/lib/glb.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODEL_DIRS = ['props', 'weapons', 'mounts'];

const mode = process.argv[2];
if (mode !== '--check' && mode !== '--write') {
  console.error('usage: node scripts/assets/declare_orm_occlusion.mjs --check|--write');
  process.exit(1);
}

let totalFilesChanged = 0;
let totalMatsDeclared = 0;
for (const dir of MODEL_DIRS) {
  const dirPath = join(root, 'public', 'models', dir);
  let filesChanged = 0;
  let matsDeclared = 0;
  for (const file of readdirSync(dirPath)
    .filter((f) => f.endsWith('.glb'))
    .sort()) {
    const path = join(dirPath, file);
    const doc = await openGlb(path);
    let changed = 0;
    for (const mat of doc.getRoot().listMaterials()) {
      const orm = mat.getMetallicRoughnessTexture();
      if (!orm || mat.getOcclusionTexture()) continue;
      mat.setOcclusionTexture(orm);
      // The occlusion sample must come from the exact texels the MR sample
      // uses: mirror the UV set and any KHR_texture_transform.
      const mrInfo = mat.getMetallicRoughnessTextureInfo();
      const occInfo = mat.getOcclusionTextureInfo();
      if (mrInfo && occInfo) {
        occInfo.setTexCoord(mrInfo.getTexCoord());
        const transform = mrInfo.getExtension('KHR_texture_transform');
        if (transform) occInfo.setExtension('KHR_texture_transform', transform);
      }
      changed++;
    }
    if (changed > 0) {
      matsDeclared += changed;
      filesChanged++;
      if (mode === '--write') await saveGlb(doc, path);
      else console.log(`would declare ${changed} occlusion texture(s): models/${dir}/${file}`);
    }
  }
  totalFilesChanged += filesChanged;
  totalMatsDeclared += matsDeclared;
  console.log(
    `${dir}: ${filesChanged} file(s), ${matsDeclared} material(s)` +
      (mode === '--write' ? ' rewritten' : ' pending'),
  );
}
console.log(
  `${mode === '--write' ? 'declared' : 'would declare'} occlusionTexture on ` +
    `${totalMatsDeclared} material(s) across ${totalFilesChanged} GLB(s)`,
);
