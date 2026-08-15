// Pure helpers for the GLB texture KTX2 conversion (scripts/assets/
// compress_glb_textures.mjs) and its guard suite
// (tests/glb_texture_compression.test.ts). No gltf-transform or sharp imports
// here: the test imports this module directly, so it must stay light.

/** Read the raw JSON chunk of a GLB without decoding buffers. */
export function glbJsonChunk(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
}

/** Which embedded images a conversion pass would touch, and whether the file
 *  can be skipped without a write. */
export function classifyGlb(json) {
  const images = json.images ?? [];
  const convertible = images.filter(
    (i) => i.mimeType === 'image/webp' || i.mimeType === 'image/png' || i.mimeType === 'image/jpeg',
  ).length;
  return {
    images: images.length,
    convertible,
    hadMeshopt: (json.extensionsUsed ?? []).includes('EXT_meshopt_compression'),
    skip: convertible === 0,
  };
}

/** Counts that must survive a texture-only conversion byte-for-byte. */
export function structuralSnapshot(json) {
  return {
    skins: json.skins?.length ?? 0,
    animations: json.animations?.length ?? 0,
    meshes: json.meshes?.length ?? 0,
    nodes: json.nodes?.length ?? 0,
    nodesWithExtras: (json.nodes ?? []).filter((n) => n.extras !== undefined).length,
    hasAssetExtras: json.asset?.extras !== undefined,
  };
}

export function snapshotMismatch(before, after) {
  const keys = Object.keys(before);
  const diffs = keys.filter((k) => before[k] !== after[k]);
  return diffs.length ? diffs : null;
}

// Armory skin models with a WEAPON_VFX rig stay webp: createWeaponVfx derives
// each skin's emissive map and de-baked albedo by drawing the baseColor image
// into a canvas (src/render/weapon_vfx.ts deriveEmissive), which a compressed
// texture cannot do. Those models are streamed on demand on the native iOS
// profile, so they cost nothing in the world-entry memory window anyway.
// tests/glb_texture_compression.test.ts re-derives this partition by importing
// WEAPON_VFX for real and fails if this extraction ever drifts.
export function weaponVfxModelKeys(source) {
  const start = source.indexOf('export const WEAPON_VFX');
  if (start < 0) throw new Error('WEAPON_VFX table not found');
  const body = source.slice(start, source.indexOf('\n};', start));
  const keys = [];
  for (const m of body.matchAll(/^ {2}(?:'([^']+)'|([a-z0-9_]+)):\s*\{/gm)) {
    keys.push(m[1] ?? m[2]);
  }
  if (keys.length === 0) throw new Error('WEAPON_VFX extraction matched no keys');
  return keys;
}
