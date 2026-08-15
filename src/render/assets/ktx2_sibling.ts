// The one place that names the `.ktx2` sibling convention on the runtime side.
//
// scripts/assets/compress_standalone_textures.mjs writes a `.ktx2` file next
// to every standalone source image the runtime loads by URL (same directory,
// same basename) and never deletes the source. Three consumers request the
// sibling instead of the raw image (terrain.ts, worn_stone.ts,
// detail_normals.ts), so the extension swap lives here rather than being
// spelled three times; the character skin atlases build their url in
// characters/assets.ts from a manifest entry that is already a `.ktx2` path.
//
// The node twin of this rule is `ktx2SiblingPath` in
// scripts/assets/lib/standalone_texture_compression_core.mjs.

/** Source extensions that carry a compressed sibling. */
const KTX2_SOURCE_EXTENSIONS = ['.jpg', '.png'];

/** Swap a shipped image url for its compressed sibling. Throws on anything
 *  the compression pipeline does not convert, so a typo fails loudly at the
 *  call site instead of 404ing at load time. */
export function ktx2SiblingUrl(url: string): string {
  const lower = url.toLowerCase();
  const ext = KTX2_SOURCE_EXTENSIONS.find((e) => lower.endsWith(e));
  if (!ext) throw new Error(`no ktx2 sibling for ${url}`);
  return `${url.slice(0, -ext.length)}.ktx2`;
}
