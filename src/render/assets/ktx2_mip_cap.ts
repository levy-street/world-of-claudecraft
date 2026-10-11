// iPhone-only KTX2 mip cap: drop the mip levels above KTX2_MIP_CAP_MAX_DIM of
// character-side textures before their first upload.
//
// Why: iOS kills the page's WebContent process past a per-process budget of
// about 1.5 GB on every iPhone whatever its RAM, WebGL memory included. On that
// profile a KTX2 texture's transcoded mip chain stays in the JS heap for the
// session (ktx2_mip_release.ts is off on constrained profiles, and the roots
// below are exempt from it on every host: the portrait, paperdoll, armory, mount
// inspect and guide renderers upload the SAME texture objects into their own
// contexts), and every context that draws it holds a GPU copy on top. Keeping
// only the levels at or under 512 cuts both copies of a 1024 chain by 75
// percent. The trade (softer close-ups of characters, creatures and mounts on
// the phone, in every context that draws them) is cosmetic sharpness only.
//
// Scope: GLBs under KTX2_MIP_CAP_MODEL_ROOTS and the standalone skin atlases
// under KTX2_MIP_CAP_TEXTURE_PREFIXES, on the iPhone profile only: the iOS
// memory profile AND a phone-class user agent. iPads share the iOS profile
// (gfx.ts maps iPad and desktop-class iPadOS to 'ios', conservatively) but
// WebKit's own footprint monitor applies its per-process jetsam limit to
// non-desktop-class devices only, and iPadOS counts as desktop class there, so
// they keep full chains, as do desktop and Android: the loader never calls the
// trim there. An iPhone asking for the desktop site sends a Mac user agent and
// is not recognized as a phone either: it keeps full chains (fails safe).
//
// The three contract (r185 WebGLTextures.uploadTexture): a compressed 2D
// texture's immutable storage is sized from mipmaps[0] and allocates
// mipmaps.length levels, each fed from its own entry, and the CompressedTexture
// `image` (the shared Source data) carries the top dims. Trimming the leading
// entries and updating `image` BEFORE the first upload is therefore all three
// needs; the loader calls this in the parse resolve chains, ahead of every
// consumer. Texture dimensions are not a program-cache-key input (map presence
// and uv channel are, and neither changes), so no program is added or relinked.
// The worker still transcodes the full chain; the dropped levels are garbage
// once the resolve chain returns. The CPU chain stays resident, only smaller, so
// a context restore and every secondary context upload from the capped array
// exactly as before.
//
// Clones: GLTFLoader clones a texture that shares an image source with an
// earlier one (another sampler, a texCoord or KHR_texture_transform variant).
// A clone shares the Source, so the `image` dims, but owns a copy of the level
// array. The GLB walk therefore trims every texture a scene material holds,
// idempotently (a chain whose top already fits is left alone; the check reads
// the array, never the shared image), so every texture a renderer can upload
// ends with its array and the shared image in agreement: the upload lanes and
// the secondary contexts find their textures by the same walk from the scene
// graph. A pre-clone original that only the GLTF parser's own cache still
// holds is left whole on purpose: no material references it, so nothing draws
// it and no context ever uploads it, and the walk stays on the scene graph
// the renderers read instead of reaching into the parser.

/** The largest mip dimension kept on the iPhone profile. */
export const KTX2_MIP_CAP_MAX_DIM = 512;

/** Model roots whose GLB textures are capped on the iPhone profile: the ones a
 *  player sees in close-up on characters, creatures, mounts and held weapons.
 *  Every one is exempt from ktx2_mip_release.ts (a released texture restores
 *  by re-transcoding the FULL chain), pinned by tests/ktx2_mip_cap.test.ts. */
export const KTX2_MIP_CAP_MODEL_ROOTS: readonly string[] = [
  'chars',
  'creatures',
  'mounts',
  'weapons',
];

/** Standalone KTX2 prefixes capped on the iPhone profile: the player skin
 *  atlases (characters/assets.ts loadSkinTexInto). */
export const KTX2_MIP_CAP_TEXTURE_PREFIXES: readonly string[] = ['textures/skins/'];

export interface Ktx2MipCapProfile {
  /** GFX.iosMemoryProfile: every iOS WebKit host, iPads included. */
  readonly iosMemoryProfile: boolean;
  /** A phone-class iOS device (isIosPhoneUserAgent). */
  readonly iosPhone: boolean;
}

/** Phone-class iOS: an iPhone or iPod user agent. An iPad user agent and the
 *  desktop-class iPadOS one (a Mac string, told apart only by touch) are not
 *  phones: WebKit applies its per-process WebContent limit to phone-class
 *  devices only. */
export function isIosPhoneUserAgent(userAgent: string | undefined): boolean {
  return typeof userAgent === 'string' && /iPhone|iPod/.test(userAgent);
}

const MODEL_ROOT = /(?:^|\/)models\/([^/]+)\//;

function isCappedUrl(url: string): boolean {
  const root = MODEL_ROOT.exec(url)?.[1];
  if (root !== undefined) return KTX2_MIP_CAP_MODEL_ROOTS.includes(root);
  return KTX2_MIP_CAP_TEXTURE_PREFIXES.some(
    (prefix) => url.startsWith(prefix) || url.includes(`/${prefix}`),
  );
}

/** The largest mip dimension to keep for a texture loaded from `url` (raw or
 *  origin-resolved), or null to keep the full chain. */
export function ktx2MipCapFor(url: string, profile: Ktx2MipCapProfile): number | null {
  if (!profile.iosMemoryProfile || !profile.iosPhone) return null;
  return isCappedUrl(url) ? KTX2_MIP_CAP_MAX_DIM : null;
}

interface MipLevel {
  width: number;
  height: number;
}

/** The structural slice of THREE.CompressedTexture this module trims. */
interface CappableTexture {
  isCompressedTexture?: boolean;
  isCompressedArrayTexture?: boolean;
  isCompressedCubeTexture?: boolean;
  mipmaps?: unknown;
  image?: unknown;
}

function isMipLevel(level: unknown): level is MipLevel {
  const l = level as Partial<MipLevel> | null;
  return (
    typeof l === 'object' &&
    l !== null &&
    typeof l.width === 'number' &&
    typeof l.height === 'number'
  );
}

/** Drop the leading mip levels of a plain 2D compressed texture while its top
 *  level exceeds `maxDim` on either side and more than one level remains, then
 *  point `image` at the new top level. The level array is trimmed IN PLACE, so
 *  no other holder of THIS array keeps the dropped levels alive (a pre-clone
 *  original only the GLTF parser holds has its own array and keeps them until
 *  the parser goes). Returns true when it
 *  dropped something. Must run before the texture's first upload. No-op on
 *  anything else (decoded images, raw data textures, array and cube
 *  containers, malformed chains). */
export function capCompressedMips(texture: unknown, maxDim: number): boolean {
  const tex = texture as CappableTexture | null;
  if (!tex || typeof tex !== 'object' || tex.isCompressedTexture !== true) return false;
  if (tex.isCompressedArrayTexture === true || tex.isCompressedCubeTexture === true) return false;
  const mips = tex.mipmaps;
  if (!Array.isArray(mips) || !mips.every(isMipLevel)) return false;
  let drop = 0;
  while (mips.length - drop > 1) {
    const level = mips[drop] as MipLevel;
    if (Math.max(level.width, level.height) <= maxDim) break;
    drop++;
  }
  if (drop === 0) return false;
  mips.splice(0, drop);
  const top = mips[0] as MipLevel;
  const image = tex.image as Partial<MipLevel> | null | undefined;
  if (image && typeof image === 'object') {
    image.width = top.width;
    image.height = top.height;
  }
  return true;
}

interface GltfLike {
  scene?: { traverse?: (cb: (o: unknown) => void) => void };
}

function isTexture(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { isTexture?: unknown }).isTexture === true
  );
}

/** Cap every compressed texture a parsed GLB's scene can draw: every
 *  texture-valued property of every scene material, extension maps included,
 *  each texture once. Returns how many textures were trimmed. Fails soft on
 *  partial GLTF shapes. */
export function capGltfKtx2Mips(gltf: GltfLike | object, maxDim: number): number {
  const scene = (gltf as GltfLike).scene;
  if (typeof scene?.traverse !== 'function') return 0;
  const textures = new Set<unknown>();
  scene.traverse((o) => {
    const mesh = o as { isMesh?: boolean; material?: unknown };
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (typeof mat !== 'object' || mat === null) continue;
      for (const value of Object.values(mat)) if (isTexture(value)) textures.add(value);
    }
  });
  let trimmed = 0;
  for (const tex of textures) if (capCompressedMips(tex, maxDim)) trimmed++;
  return trimmed;
}
