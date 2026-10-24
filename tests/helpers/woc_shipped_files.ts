// The shipped WOC character files, read straight off the bytes that ship: which files there
// are and what KIND each is, a GLB's JSON and BIN chunks, each texture's KTX2 header (size,
// mip levels, codec, alpha) and each file's triangles at the three levels of detail a
// character can draw. The budget suites hold those facts to literals written in the tests
// (tests/woc_character_size_budget.test.ts, tests/woc_texture_budget.test.ts,
// tests/woc_triangle_budget.test.ts, tests/woc_material_extensions.test.ts), so nothing here
// may derive an expectation: these functions only READ.
//
// The list of files is never a hand list. The bodies, the armor and the under-armor atlases
// come from the accepted delivery pin the split build writes
// (scripts/assets/woc_character/export_split.json, held to the served bytes by
// tests/woc_export.test.ts); the head files come from the head catalog
// (woc_head_catalog.ts wocHeadAllUrls, held to the directory by
// tests/woc_head_split_files.test.ts). wocFilesOnDisk is the directory itself, so a suite can
// hold the two against each other and a stray file can never sit outside every pin.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import accepted from '../../scripts/assets/woc_character/export_split.json';
import { readKtx2 } from '../../scripts/assets/woc_character/ktx2_levels.mjs';
import {
  type GeometryLodLevel,
  geometryLodDrawn,
  wocLodLevelNames,
} from '../../src/render/assets/geometry_lod_core';
import { WOC_SPLIT_DIR } from '../../src/render/characters/woc_armor_core';
import { wocHeadAllUrls } from '../../src/render/characters/woc_head_catalog';

const PUBLIC = path.resolve(__dirname, '..', '..', 'public');

/** Where the 16 class under-armor atlases ship (under public/), standalone KTX2 files. */
export const WOC_SKIN_DIR = 'textures/skins/woc';

/** What a shipped WOC file is. `beards` is a head type's shared facial-hair file (every beard
 *  cut from one texture), `beard` a beard that ships in a file of its own. */
export type WocFileKind =
  | 'base'
  | 'anims'
  | 'armorLow'
  | 'armorMedium'
  | 'armorTop'
  | 'headCore'
  | 'hair'
  | 'beards'
  | 'beard'
  | 'underArmor';

export const WOC_FILE_KINDS: readonly WocFileKind[] = [
  'base',
  'anims',
  'armorLow',
  'armorMedium',
  'armorTop',
  'headCore',
  'hair',
  'beards',
  'beard',
  'underArmor',
];

export interface WocShippedFile {
  /** Its path under public/, the url the game asks for. */
  readonly url: string;
  readonly kind: WocFileKind;
  /** The body fit of a base, a library, an armor file or an under-armor atlas. */
  readonly fit?: 'male' | 'female';
  /** The armor set of an armor file, the class of an under-armor atlas. */
  readonly set?: string;
  /** The head type of a head file. */
  readonly type?: 'a' | 'b';
  /** The hairstyle of a hair file, the beard of a beard's own file. */
  readonly id?: string;
}

const ARMOR_KIND = { low: 'armorLow', medium: 'armorMedium', top: 'armorTop' } as const;

/** What a url under public/ is, by the naming rules of woc_armor_core.ts and
 *  woc_head_catalog.ts. Throws for anything else: a new kind of file is classified here before
 *  any budget can cover it. */
export function wocFileKind(url: string): Omit<WocShippedFile, 'url'> {
  const dir = `${WOC_SPLIT_DIR}/`;
  if (url.startsWith(dir)) {
    const name = url.slice(dir.length);
    let m = /^(base|anims)_(male|female)\.glb$/.exec(name);
    if (m) return { kind: m[1] as 'base' | 'anims', fit: m[2] as 'male' | 'female' };
    m = /^armor\/(male|female)_([a-z0-9_]+)_(low|medium|top)\.glb$/.exec(name);
    if (m) {
      const kind = ARMOR_KIND[m[3] as keyof typeof ARMOR_KIND];
      return { kind, fit: m[1] as 'male' | 'female', set: m[2] };
    }
    m = /^head_type_([ab])_core\.glb$/.exec(name);
    if (m) return { kind: 'headCore', type: m[1] as 'a' | 'b' };
    m = /^head_type_([ab])_hair_([a-z0-9_]+)\.glb$/.exec(name);
    if (m) return { kind: 'hair', type: m[1] as 'a' | 'b', id: m[2] };
    m = /^head_type_([ab])_beards\.glb$/.exec(name);
    if (m) return { kind: 'beards', type: m[1] as 'a' | 'b' };
    m = /^head_type_([ab])_beard_([a-z0-9_]+)\.glb$/.exec(name);
    if (m) return { kind: 'beard', type: m[1] as 'a' | 'b', id: m[2] };
  }
  const skin = new RegExp(`^${WOC_SKIN_DIR}/(female_)?([a-z0-9]+)_underarmor\\.ktx2$`).exec(url);
  if (skin) return { kind: 'underArmor', fit: skin[1] ? 'female' : 'male', set: skin[2] };
  throw new Error(`${url} is not a WOC character file of a known kind`);
}

/** Every shipped WOC character file, sorted by url: the accepted delivery pin's files and the
 *  head catalog's. */
export function wocShippedFiles(): WocShippedFile[] {
  const urls = new Set([
    ...Object.keys(accepted.files),
    ...wocHeadAllUrls('a'),
    ...wocHeadAllUrls('b'),
  ]);
  return [...urls].sort().map((url) => ({ url, ...wocFileKind(url) }));
}

/** Every file under the two directories the WOC character files ship in, sorted, as urls.
 *  Recursive on purpose: a file in a new subdirectory is still a file that ships. Nothing is
 *  left out, a dotfile included: public/ deploys verbatim, and the byte ratchet's own walk
 *  (tests/woc_character_size_budget.test.ts) is as strict. */
export function wocFilesOnDisk(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(path.join(PUBLIC, dir), { withFileTypes: true })) {
      const url = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(url);
      else out.push(url);
    }
  };
  walk(WOC_SPLIT_DIR);
  walk(WOC_SKIN_DIR);
  return out.sort();
}

/** The bytes of a shipped file. */
export function wocFileBytes(url: string): Buffer {
  return readFileSync(path.join(PUBLIC, url));
}

// --- KTX2 ---------------------------------------------------------------------------------

/** The two Basis Universal codecs a WOC texture ships in. */
export type Ktx2Codec = 'ETC1S' | 'UASTC';

export interface Ktx2Facts {
  readonly width: number;
  readonly height: number;
  /** Mip levels in the container (1: the top level alone). */
  readonly levels: number;
  readonly codec: Ktx2Codec;
  /** Whether the texture transcodes WITH an alpha channel, by the Basis transcoder's own
   *  rule (it then lands on a format twice the size wherever the opaque target is half a
   *  byte a texel: ETC2): an ETC1S texture of two slices, whatever the second one is called,
   *  or a UASTC one whose channel is RGBA or RRRG. */
  readonly alpha: boolean;
  /** The transfer function its texels are stored in: a colour or glow map is sRGB, a normal
   *  or a packed data map is linear (three reads a KTX2 texture's colour space from here). */
  readonly transfer: 'sRGB' | 'linear';
  /** Bytes of the container as shipped. */
  readonly bytes: number;
}

/** Data format descriptor colour models, and the BasisLZ supercompression scheme (KTX 2.0). */
const KTX2 = { etc1s: 163, uastc: 166, basisLz: 1 } as const;
/** Data format descriptor transfer functions. */
const TRANSFER = { linear: 1, srgb: 2 } as const;
/** The UASTC channel ids that carry alpha: RGBA and RRRG. */
const UASTC_ALPHA_CHANNELS: readonly number[] = [3, 5];

/**
 * A KTX2 texture's header facts. The codec is read from BOTH places a container states it, the
 * data format descriptor's colour model and the supercompression scheme, and the two must
 * agree: ETC1S is always BasisLZ, and a UASTC texture never is. Anything else throws, and so
 * does a transfer function that is neither sRGB nor linear, so an unknown encoding can never
 * pass for a known one.
 */
export function ktx2Facts(bytes: Uint8Array): Ktx2Facts {
  const ktx = readKtx2(bytes);
  const dfd = ktx.dfd;
  if (dfd.length < 44) throw new Error('KTX2: no basic data format descriptor');
  const view = new DataView(dfd.buffer, dfd.byteOffset, dfd.byteLength);
  const model = dfd[12];
  // the basic descriptor block: 24 bytes, then one 16 byte record per sample, whose fourth
  // byte's low nibble is the channel
  const samples = (view.getUint16(10, true) - 24) / 16;
  const scheme = ktx.supercompressionScheme;
  let codec: Ktx2Codec;
  let alpha: boolean;
  if (model === KTX2.etc1s && scheme === KTX2.basisLz) {
    codec = 'ETC1S';
    alpha = samples === 2;
  } else if (model === KTX2.uastc && scheme !== KTX2.basisLz) {
    codec = 'UASTC';
    alpha = UASTC_ALPHA_CHANNELS.includes(dfd[28 + 3] & 0x0f);
  } else {
    throw new Error(
      `KTX2: colour model ${model} under supercompression ${scheme} is no known codec`,
    );
  }
  const transfer = dfd[14];
  if (transfer !== TRANSFER.srgb && transfer !== TRANSFER.linear) {
    throw new Error(`KTX2: transfer function ${transfer} is neither sRGB nor linear`);
  }
  return {
    width: ktx.pixelWidth,
    height: ktx.pixelHeight,
    levels: ktx.levelCount,
    codec,
    alpha,
    transfer: transfer === TRANSFER.srgb ? 'sRGB' : 'linear',
    bytes: bytes.length,
  };
}

// --- GLB ----------------------------------------------------------------------------------

interface TextureRef {
  readonly index?: number;
}

export interface WocGlbMaterial {
  readonly name?: string;
  readonly extensions?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly [key: string]: unknown;
}

export interface WocGlbPrimitive {
  readonly attributes: Readonly<Record<string, number>>;
  readonly indices?: number;
  readonly mode?: number;
  readonly material?: number;
  readonly extensions?: {
    readonly WOC_lod?: { readonly levels?: readonly { readonly indices: number }[] };
  };
}

/** The parts of a glTF JSON chunk these suites read. */
export interface WocGlbJson {
  readonly extensionsUsed?: readonly string[];
  readonly extensionsRequired?: readonly string[];
  readonly nodes?: readonly { readonly name?: string; readonly mesh?: number }[];
  readonly meshes?: readonly { readonly primitives: readonly WocGlbPrimitive[] }[];
  readonly accessors?: readonly { readonly count: number }[];
  readonly materials?: readonly WocGlbMaterial[];
  readonly textures?: readonly {
    readonly source?: number;
    readonly extensions?: Readonly<Record<string, { readonly source?: number } | undefined>>;
  }[];
  readonly images?: readonly { readonly name?: string; readonly bufferView?: number }[];
  readonly bufferViews?: readonly { readonly byteOffset?: number; readonly byteLength: number }[];
}

export interface WocGlb {
  readonly url: string;
  /** Bytes of the whole file. */
  readonly bytes: number;
  readonly json: WocGlbJson;
  /** The BIN chunk (empty for a file without one). */
  readonly bin: Buffer;
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Split a GLB's bytes into its JSON and BIN chunks. */
export function parseGlb(url: string, file: Buffer): WocGlb {
  if (file.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${url} is not a GLB`);
  if (file.readUInt32LE(16) !== CHUNK_JSON) throw new Error(`${url}: its first chunk is not JSON`);
  const jsonEnd = 20 + file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, jsonEnd).toString('utf8')) as WocGlbJson;
  let bin: Buffer = Buffer.alloc(0);
  if (jsonEnd + 8 <= file.length) {
    if (file.readUInt32LE(jsonEnd + 4) !== CHUNK_BIN) {
      throw new Error(`${url}: its second chunk is not BIN`);
    }
    bin = file.subarray(jsonEnd + 8, jsonEnd + 8 + file.readUInt32LE(jsonEnd));
  }
  return { url, bytes: file.length, json, bin };
}

/** A shipped GLB, read from public/. */
export function readWocGlb(url: string): WocGlb {
  return parseGlb(url, wocFileBytes(url));
}

export interface WocGlbTexture {
  /** The image's name in the file. */
  readonly image: string;
  /** The material slots that sample it, sorted (`baseColor`, `normal`, `occlusion`,
   *  `metallicRoughness`, `emissive`, or an extension's own texture slot). Empty for an image
   *  no material samples. */
  readonly slots: readonly string[];
  readonly ktx: Ktx2Facts;
}

/** Every image a GLB embeds, in file order, with the slots that sample it and its KTX2 facts.
 *  An image that is not an embedded KTX2 throws (readKtx2 refuses it): every WOC texture is. */
export function wocGlbTextures(glb: WocGlb): WocGlbTexture[] {
  const { json, bin } = glb;
  const slotsOfTexture = new Map<number, Set<string>>();
  const walk = (value: unknown, key?: string): void => {
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
    } else if (value && typeof value === 'object') {
      const index = (value as TextureRef).index;
      if (key?.endsWith('Texture') && typeof index === 'number') {
        const slots = slotsOfTexture.get(index) ?? new Set<string>();
        slots.add(key.slice(0, -'Texture'.length));
        slotsOfTexture.set(index, slots);
      }
      // `extras` is an application's own data: nothing in it is a texture slot
      for (const [k, entry] of Object.entries(value)) if (k !== 'extras') walk(entry, k);
    }
  };
  for (const material of json.materials ?? []) walk(material);
  const slotsOfImage = new Map<number, Set<string>>();
  (json.textures ?? []).forEach((texture, t) => {
    const sources = [
      texture.source,
      ...Object.values(texture.extensions ?? {}).map((e) => e?.source),
    ];
    for (const source of sources) {
      if (typeof source !== 'number') continue;
      const slots = slotsOfImage.get(source) ?? new Set<string>();
      for (const slot of slotsOfTexture.get(t) ?? []) slots.add(slot);
      slotsOfImage.set(source, slots);
    }
  });
  return (json.images ?? []).map((image, i) => {
    const view = json.bufferViews?.[image.bufferView ?? -1];
    if (!view) throw new Error(`${glb.url}: image ${i} is not embedded`);
    const at = view.byteOffset ?? 0;
    return {
      image: image.name ?? '',
      slots: [...(slotsOfImage.get(i) ?? [])].sort(),
      ktx: ktx2Facts(bin.subarray(at, at + view.byteLength)),
    };
  });
}

/** Triangles a file draws at each level of detail when everything in it is drawn. */
export type WocTriangles = Readonly<Record<GeometryLodLevel, number>>;

/**
 * A GLB's triangles at level 0, MID and FAR, counted the way the runtime draws them: per NODE
 * (a mesh two nodes hang is drawn twice), each primitive at the level it would draw when that
 * level is asked of it (geometry_lod_core.ts: its WOC_lod list names its levels by position,
 * and a primitive without the level asked draws the next finer one it has). From the index
 * accessors' counts alone: no buffer is decoded, so this is the count of a file whose lists
 * are valid. A list the runtime would refuse (woc_lod_plugin.ts drops one that is not a legal
 * triangle list, and the primitive then draws level 0) is the build's own check and
 * tests/woc_lod_extension.test.ts's to catch, never this count's.
 */
export function wocGlbTriangles(json: WocGlbJson): WocTriangles {
  const total = { lod0: 0, mid: 0, far: 0 };
  const count = (accessor: number | undefined, what: string): number => {
    const n = json.accessors?.[accessor ?? -1]?.count;
    if (n === undefined || n % 3 !== 0) throw new Error(`${what} is not a triangle list`);
    return n / 3;
  };
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const mesh = json.meshes?.[node.mesh];
    if (!mesh) throw new Error(`node ${node.name}: no mesh ${node.mesh}`);
    for (const [p, primitive] of mesh.primitives.entries()) {
      const what = `node ${node.name} primitive ${p}`;
      if ((primitive.mode ?? 4) !== 4) throw new Error(`${what} is not drawn as triangles`);
      const own = count(primitive.indices ?? primitive.attributes.POSITION, what);
      const levels = primitive.extensions?.WOC_lod?.levels ?? [];
      const carried: Partial<Record<GeometryLodLevel, number>> = { lod0: own };
      for (const [i, name] of wocLodLevelNames(levels.length).entries()) {
        carried[name] = count(levels[i].indices, `${what} level ${name}`);
      }
      for (const wanted of ['lod0', 'mid', 'far'] as const) {
        const drawn = geometryLodDrawn(wanted, (level) => carried[level] !== undefined);
        total[wanted] += carried[drawn] ?? own;
      }
    }
  }
  return total;
}

/** Every extension name a glTF JSON uses anywhere: its `extensionsUsed` and
 *  `extensionsRequired` lists and the keys of every `extensions` object in it (the root, a
 *  node, a material, a texture, a primitive, a buffer view), sorted. `extras` is an
 *  application's own data, never an extension, and is not read. */
export function glbExtensionNames(json: unknown): string[] {
  const names = new Set<string>();
  const walk = (value: unknown, key?: string): void => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (
          (key === 'extensionsUsed' || key === 'extensionsRequired') &&
          typeof entry === 'string'
        ) {
          names.add(entry);
        }
        walk(entry);
      }
    } else if (value && typeof value === 'object') {
      if (key === 'extensions') for (const name of Object.keys(value)) names.add(name);
      for (const [k, entry] of Object.entries(value)) if (k !== 'extras') walk(entry, k);
    }
  };
  walk(json);
  return [...names].sort();
}
