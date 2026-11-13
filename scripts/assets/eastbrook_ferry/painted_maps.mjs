// The painted maps of the Eastbrook ferry and the harbours built beside it, for their build
// scripts (each asset's build.mjs): which files they are, the check that a model wears exactly
// the maps it should, and the passes that ship them as KTX2.
//
// The maps are cut once from the Eastbrook town paintings by paint_ferry.py into tex/, laid
// on the models by paintlib.py, and leave Blender as WebP inside each source GLB. Every model
// ships its own copy as KTX2 like every other model's maps
// (tests/glb_texture_compression.test.ts): the same passes as
// scripts/assets/compress_glb_textures.mjs, which needs the `ktx` tool from
// KhronosGroup/KTX-Software on PATH. A model that is small on screen ships them smaller.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { textureCompress } from '@gltf-transform/functions';

const TEX = 'scripts/assets/eastbrook_ferry/tex';

/** The source file of each map, by the name it carries inside a GLB. */
export const PAINTED_MAP_FILES = {
  ferry_wood: `${TEX}/ferry_wood.png`,
  ferry_fittings: `${TEX}/ferry_fittings.png`,
  ferry_cloth: `${TEX}/ferry_cloth.png`,
  harbour_stone: `${TEX}/harbour_stone.png`,
};

/**
 * What a painted model's fingerprint covers beside its own sources: the painted layer over
 * shiplib, where each map's bands and courses sit, this module, and the maps it wears
 * (`maps`: material name to map name).
 */
export function paintedMapInputs(maps) {
  const worn = [...new Set(Object.values(maps))].sort();
  return [
    'scripts/assets/eastbrook_ferry/paintlib.py',
    'scripts/assets/eastbrook_ferry/painted_maps.mjs',
    `${TEX}/layout.json`,
    ...worn.map((name) => PAINTED_MAP_FILES[name]),
  ];
}

/** A fingerprinted input's bytes: a GLB or a map as it is, text with its line endings
 *  normalized so a Windows checkout and a Linux checkout agree. */
export function fingerprintBody(file, bytes) {
  return /\.(glb|png)$/.test(file)
    ? bytes
    : Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'));
}

/**
 * Throws unless every material of `gltf` wears exactly the base-colour map `maps` names for
 * it (none for a material it does not name), and the document carries those maps and no
 * other texture.
 */
export function checkPaintedMaps(gltf, maps) {
  for (const material of gltf.listMaterials()) {
    const want = maps[material.getName()] ?? null;
    const map = material.getBaseColorTexture();
    if ((map?.getName() ?? null) !== want) {
      throw new Error(`${material.getName()} wears ${map?.getName() ?? 'no map'}, not ${want}`);
    }
    for (const other of [
      material.getNormalTexture(),
      material.getOcclusionTexture(),
      material.getEmissiveTexture(),
      material.getMetallicRoughnessTexture(),
    ]) {
      if (other) throw new Error(`${material.getName()} carries a map that is not its paint`);
    }
  }
  const worn = new Set(
    gltf
      .listMaterials()
      .map((material) => maps[material.getName()])
      .filter(Boolean),
  );
  const carried = gltf
    .listTextures()
    .map((texture) => texture.getName())
    .sort();
  if (JSON.stringify(carried) !== JSON.stringify([...worn].sort())) {
    throw new Error(
      `Expected the maps ${[...worn].sort().join(', ')}, found ${carried.join(', ')}`,
    );
  }
}

/**
 * The transforms that ship a model's painted maps: WebP to PNG (the KTX tool reads no WebP),
 * each map brought down to `size` pixels a side where it is larger (or to its own entry in
 * `sizes`, map name to pixels, for a map the model shows little of), then KTX2 (ETC1S). Run
 * them after prune and dedup and before meshopt.
 */
export async function paintedMapTransforms(size, sizes = {}) {
  // The gltf-transform CLI owns the KTX2 pass and the Sharp build it runs on (loading a
  // second Sharp beside it fails on Windows: see compress_glb_textures.mjs).
  const { Mode, toktx } = await import('@gltf-transform/cli');
  const cliRequire = createRequire(createRequire(import.meta.url).resolve('@gltf-transform/cli'));
  const sharp = (await import(pathToFileURL(cliRequire.resolve('sharp')).href)).default;
  const toPng = { encoder: sharp, targetFormat: 'png', formats: /^image\/webp$/ };
  return [
    // the maps with a size of their own first; once PNG they are no longer WebP, so the
    // general pass below leaves them alone
    ...Object.entries(sizes).map(([name, own]) =>
      textureCompress({ ...toPng, pattern: new RegExp(`^${name}$`), resize: [own, own] }),
    ),
    textureCompress({ ...toPng, resize: [size, size] }),
    toktx({ mode: Mode.ETC1S, jobs: 2, encoder: sharp }),
  ];
}

/** Throws unless every map of `gltf` is KTX2 and no larger than its size a side. */
export function checkShippedMaps(gltf, size, sizes = {}) {
  for (const texture of gltf.listTextures()) {
    if (texture.getMimeType() !== 'image/ktx2') {
      throw new Error(`${texture.getName()} did not become KTX2`);
    }
    const limit = sizes[texture.getName()] ?? size;
    const dims = texture.getSize() ?? [0, 0];
    if (Math.max(...dims) > limit || Math.min(...dims) < 64) {
      throw new Error(`${texture.getName()} ships at ${dims.join('x')}, over ${limit}`);
    }
  }
}
