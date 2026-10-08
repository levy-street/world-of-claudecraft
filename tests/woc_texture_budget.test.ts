// The TEXTURE ratchet of the WOC character files: every texture a file ships, held to a
// literal size, mip chain and codec. The byte ratchet beside it
// (tests/woc_character_size_budget.test.ts) cannot see any of this: a compressed file's bytes
// say little about what it costs once it is drawn, where a texture is transcoded to a GPU
// format at a fixed rate per texel (one byte on a desktop without ETC2 or ASTC, where BOTH
// codecs land on BC7; half a byte for an opaque ETC1S texture where ETC2 exists). A 2048 x 2048
// ETC1S atlas can weigh about what a 1024 x 512 UASTC one does and take eight times its
// memory, so the size is pinned here, in texels, with the codec that decides the rate.
//
// What is pinned, per kind of file (tests/helpers/woc_shipped_files.ts reads the real files):
// which map slots a file carries, each map's size, its mip levels (a whole chain, or the top
// level alone in a top file), its codec and its transfer function (a colour or glow map is
// sRGB, a normal or packed data map linear: three takes a KTX2 texture's colour space from
// there), and that no map carries an alpha channel.
//
// RE-PINNING. Every expectation below is a literal, on purpose: a pin that read its size from
// the build's own tables (scripts/assets/woc_character/armor_atlas.mjs ATLAS_SIZES) would move
// with them and prove nothing. To change a texture's size or codec deliberately, rebuild the
// files, then edit the literal of that map in SIZE (one per map of each kind of file) or of
// that kind in CODEC here, lower or raise the byte ceilings the rebuild moved, and say in the
// PR body what changed and why (it changes how characters look or what they cost: the art
// owner's call).
import { describe, expect, it } from 'vitest';
import {
  type Ktx2Codec,
  type Ktx2Facts,
  ktx2Facts,
  readWocGlb,
  type WocFileKind,
  type WocShippedFile,
  wocFileBytes,
  wocGlbTextures,
  wocShippedFiles,
} from './helpers/woc_shipped_files';

type Size = readonly [width: number, height: number];

/** The size of every map a WOC file ships, [width, height]: one literal per map of each kind
 *  of file, so resizing one map is one edit. */
const SIZE = {
  /** A base's one map: the body's own suit atlas. */
  body: [512, 512],
  /** A class under-armor atlas, swapped onto the body's uvs under a worn chest piece: the
   *  size of the body map it is drawn in place of (PR 4360 review, N3: it shipped at
   *  [1024, 1024], four times that map's texels on every preset). */
  underArmor: [512, 512],
  /** A low armor file: its colour atlas, and the glow atlas of a set that glows (N3 again:
   *  the colour atlas shipped at [1024, 1024], more texels than the medium file's whole
   *  set of maps). The glow atlas takes the same 2 to 1 shape at a quarter of the scale:
   *  armor_atlas.mjs refuses a layout whose maps differ in aspect. */
  armorLow: { colour: [1024, 512], glow: [256, 128] },
  /** A medium armor file: every map of the set's full layout at half its size. */
  armorMedium: { colour: [1024, 512], normal: [512, 256], data: [512, 256], glow: [512, 256] },
  /** A top armor file: the top level of each of those maps, the full layout itself. */
  armorTop: { colour: [2048, 1024], normal: [1024, 512], data: [1024, 512], glow: [1024, 512] },
  /** A head core's one atlas, per head type (packed from that type's own paints). */
  headCore: { a: [2032, 880], b: [1952, 1408] },
  /** A hairstyle's strands, and the scalp cap of a style that has one, per head type. */
  hair: [512, 512],
  scalp: { a: [256, 256], b: [128, 128] },
  /** The facial-hair texture of a head type (the shared file's and the handlebar's). */
  beard: { a: [384, 384], b: [320, 320] },
} as const satisfies Record<string, Size | Record<string, Size>>;

/** The codec of every kind of file's maps. ETC1S only where a map survives it: the low tier's
 *  colour, an under-armor atlas, and the hair, scalp and beard maps, which ship grey. */
const CODEC = {
  base: 'UASTC',
  underArmor: 'ETC1S',
  armorLow: 'ETC1S',
  armorMedium: 'UASTC',
  armorTop: 'UASTC',
  headCore: 'UASTC',
  hair: 'ETC1S',
  beards: 'ETC1S',
  beard: 'ETC1S',
} as const satisfies Partial<Record<WocFileKind, Ktx2Codec>>;

/** The armor sets whose kit glows: their files carry an emissive atlas beside the others. */
const GLOW_SETS: readonly string[] = ['shaman'];

/** The hairstyles that ship a scalp cap beside their strands, per head type. */
const SCALP_CAP_STYLES: Readonly<Record<'a' | 'b', readonly string[]>> = {
  a: ['quiff', 'shoulder', 'topknot', 'undercut'],
  b: ['bob', 'crown', 'curls', 'shoulder', 'topknot', 'twins', 'undercut'],
};

type Transfer = Ktx2Facts['transfer'];

interface Row {
  /** The material slots that sample the map, joined with `+` (sorted). */
  readonly slots: string;
  readonly size: Size;
  readonly codec: Ktx2Codec;
  /** A whole mip chain down to 1 x 1, or the top level alone. */
  readonly levels: 'chain' | 'top';
  /** sRGB for a map that holds colour, linear for one that holds vectors or factors. */
  readonly transfer: Transfer;
}

/** One texture as a line of the comparison: slot, size, codec, transfer, mip levels. */
function line(slots: string, size: Size, codec: string, transfer: string, levels: number): string {
  const mips = `${levels} mip level${levels === 1 ? '' : 's'}`;
  return `${slots}: ${size[0]} x ${size[1]} ${codec} ${transfer}, ${mips}`;
}

function expectedLine(row: Row): string {
  const [width, height] = row.size;
  const levels = row.levels === 'top' ? 1 : Math.floor(Math.log2(Math.max(width, height))) + 1;
  return line(row.slots, row.size, row.codec, row.transfer, levels);
}

function actualLine(slots: readonly string[], ktx: Ktx2Facts): string {
  return line(slots.join('+'), [ktx.width, ktx.height], ktx.codec, ktx.transfer, ktx.levels);
}

/** The textures a file of this identity must carry: decided by the file's NAME alone (its
 *  kind, set, head type and style) and the literals above, never by its content. */
function pinnedTextures(file: WocShippedFile): Row[] {
  const type = file.type ?? 'a';
  const glow = GLOW_SETS.includes(file.set ?? '');
  const colour = (size: Size, codec: Ktx2Codec, slots = 'baseColor'): Row => ({
    slots,
    size,
    codec,
    levels: 'chain',
    transfer: 'sRGB',
  });
  switch (file.kind) {
    case 'anims':
      return [];
    case 'base':
      return [colour(SIZE.body, CODEC.base)];
    case 'underArmor':
      return [colour(SIZE.underArmor, CODEC.underArmor, 'standalone')];
    case 'armorLow': {
      const rows = [colour(SIZE.armorLow.colour, CODEC.armorLow)];
      if (glow) rows.push(colour(SIZE.armorLow.glow, CODEC.armorLow, 'emissive'));
      return rows;
    }
    case 'armorMedium':
    case 'armorTop': {
      const top = file.kind === 'armorTop';
      const size = top ? SIZE.armorTop : SIZE.armorMedium;
      const shape = {
        codec: top ? CODEC.armorTop : CODEC.armorMedium,
        levels: top ? 'top' : 'chain',
      } as const;
      const rows: Row[] = [
        { slots: 'baseColor', size: size.colour, transfer: 'sRGB', ...shape },
        { slots: 'normal', size: size.normal, transfer: 'linear', ...shape },
        // one packed map: occlusion in red, roughness in green, metal in blue
        { slots: 'metallicRoughness+occlusion', size: size.data, transfer: 'linear', ...shape },
      ];
      if (glow) rows.push({ slots: 'emissive', size: size.glow, transfer: 'sRGB', ...shape });
      return rows;
    }
    case 'headCore':
      return [colour(SIZE.headCore[type], CODEC.headCore)];
    case 'hair': {
      // grey, and stored sRGB like the colour it stands in for (the codec and the transfer of
      // every hair-only texture are tests/woc_head_split_files.test.ts's pin too)
      const rows = [colour(SIZE.hair, CODEC.hair)];
      if (SCALP_CAP_STYLES[type].includes(file.id ?? '')) {
        rows.push(colour(SIZE.scalp[type], CODEC.hair));
      }
      return rows;
    }
    case 'beards':
    case 'beard':
      return [colour(SIZE.beard[type], CODEC[file.kind])];
  }
}

/** A shipped file's textures as read from its bytes. */
function shippedTextures(file: WocShippedFile): { slots: readonly string[]; ktx: Ktx2Facts }[] {
  if (file.kind === 'underArmor') {
    return [{ slots: ['standalone'], ktx: ktx2Facts(wocFileBytes(file.url)) }];
  }
  return wocGlbTextures(readWocGlb(file.url));
}

/** Bytes a mip chain takes once transcoded to a format of 16 bytes per 4 x 4 block (BC7 or
 *  ASTC 4 x 4: one byte a texel), every level rounded up to whole blocks. */
function blockBytes(ktx: Ktx2Facts): number {
  let bytes = 0;
  for (let level = 0; level < ktx.levels; level++) {
    const width = Math.max(1, ktx.width >> level);
    const height = Math.max(1, ktx.height >> level);
    bytes += Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
  }
  return bytes;
}

const FILES = wocShippedFiles();
const REPIN =
  'If this is deliberate, rebuild, then edit the literal for that kind of map in SIZE or ' +
  'CODEC (tests/woc_texture_budget.test.ts, "RE-PINNING") and say so in the PR body.';

describe('WOC character textures: size, mip levels and codec', () => {
  it.each(FILES.map((file) => [file.url, file] as const))(
    '%s ships exactly its pinned maps',
    (url, file) => {
      const shipped = shippedTextures(file);
      expect(
        shipped.map((texture) => actualLine(texture.slots, texture.ktx)).sort(),
        `${url} (${file.kind}): the textures it ships, against the pin. ${REPIN}`,
      ).toEqual(pinnedTextures(file).map(expectedLine).sort());
      for (const texture of shipped) {
        expect(
          texture.ktx.alpha,
          `${url}: ${actualLine(texture.slots, texture.ktx)} carries an alpha channel no WOC ` +
            'material reads (an opaque ETC1S map is half a byte a texel on ETC2 and one byte with ' +
            'alpha: encode it without)',
        ).toBe(false);
      }
    },
  );

  it('read every texture that ships, and names no glow set or scalp style that does not', () => {
    // the census, as literals: how many textures of each codec the 100 files carry between
    // them. A reader that skipped a file, a slot or a kind would not land on these.
    const census: Record<string, number> = {};
    for (const file of FILES) {
      for (const { ktx } of shippedTextures(file)) {
        const key = `${file.kind} ${ktx.codec}`;
        census[key] = (census[key] ?? 0) + 1;
      }
    }
    expect(census).toEqual({
      'armorLow ETC1S': 20,
      'armorMedium UASTC': 56,
      'armorTop UASTC': 56,
      'base UASTC': 2,
      'beard ETC1S': 2,
      'beards ETC1S': 2,
      'headCore UASTC': 2,
      'hair ETC1S': 31,
      'underArmor ETC1S': 16,
    });
    // no stale rule: a glowing set and a scalp cap style each name files that ship
    const sets = new Set(FILES.map((file) => file.set));
    for (const set of GLOW_SETS) expect(sets.has(set), `glow set ${set}`).toBe(true);
    for (const type of ['a', 'b'] as const) {
      const styles = FILES.filter((f) => f.kind === 'hair' && f.type === type).map((f) => f.id);
      for (const id of SCALP_CAP_STYLES[type]) {
        expect(styles, `Type ${type} scalp cap style ${id}`).toContain(id);
      }
    }
  });
});

// Texture memory across the tiers (PR 4360 review, N3). Each count compares one shipped file
// with ANOTHER (no file is measured against itself). Both read 0 since the 2026-10-05
// rebuild (the low atlases at 1024 x 512, the under-armor atlases at 512 x 512) and are the
// lasting guard: a rebuild that makes the low preset the costlier one again, or an
// under-armor atlas larger than the map it replaces, fails here.
describe('WOC texture memory across the tiers', () => {
  /**
   * Low armor packs that take MORE texture memory than their own medium pack, at one byte a
   * texel (a desktop without ETC2 transcodes both codecs to BC7): 1,398,128 bytes of low
   * atlas against 1,048,688 for the three medium maps, so the low preset is the costlier one.
   * All 18 were, until the low atlases were rebuilt at 1024 x 512 (SIZE.armorLow): 0 since,
   * and it stays 0.
   */
  const LOW_PACKS_LARGER_THAN_THEIR_MEDIUM_PACK = 0;

  /**
   * Under-armor atlases larger than the body map they are drawn in place of (the base's own
   * 512 x 512 atlas, over the same uvs): at 1024 x 1024 each holds four times that map's
   * texels, on every preset (four times its bytes where both land on BC7, twice where the
   * atlas lands on ETC2). All 16 were, until they were rebuilt at 512 x 512
   * (SIZE.underArmor): 0 since, and it stays 0.
   */
  const UNDER_ARMOR_ATLASES_LARGER_THAN_THE_BODY_MAP = 0;

  it('counts the low armor packs that take more texture memory than their medium pack', () => {
    const packs = new Map<string, Partial<Record<WocFileKind, number>>>();
    for (const file of FILES) {
      if (file.kind !== 'armorLow' && file.kind !== 'armorMedium') continue;
      const key = `${file.fit} ${file.set}`;
      const bytes = shippedTextures(file).reduce((sum, t) => sum + blockBytes(t.ktx), 0);
      packs.set(key, { ...packs.get(key), [file.kind]: bytes });
    }
    expect(packs.size).toBe(18);
    const larger: string[] = [];
    for (const [key, pack] of packs) {
      expect(pack.armorLow, `${key}: a low pack`).toBeGreaterThan(0);
      expect(pack.armorMedium, `${key}: a medium pack`).toBeGreaterThan(0);
      if ((pack.armorLow ?? 0) > (pack.armorMedium ?? 0)) {
        larger.push(`${key}: low ${pack.armorLow} > medium ${pack.armorMedium}`);
      }
    }
    expect(
      larger,
      'low packs larger than their medium pack, in bytes at one byte a texel. Fewer than the ' +
        'pin is the fix landing: lower LOW_PACKS_LARGER_THAN_THEIR_MEDIUM_PACK (0 is the goal)',
    ).toHaveLength(LOW_PACKS_LARGER_THAN_THEIR_MEDIUM_PACK);
  });

  it('counts the under-armor atlases larger than the body map they replace', () => {
    const body = new Map<string, Ktx2Facts>();
    for (const file of FILES) {
      if (file.kind === 'base') body.set(file.fit ?? '', shippedTextures(file)[0].ktx);
    }
    expect([...body.keys()].sort()).toEqual(['female', 'male']);
    const atlases = FILES.filter((file) => file.kind === 'underArmor');
    expect(atlases).toHaveLength(16);
    const larger: string[] = [];
    for (const file of atlases) {
      const base = body.get(file.fit ?? '');
      expect(base, `${file.url}: its fit's body map`).toBeDefined();
      const { ktx } = shippedTextures(file)[0];
      if (base && (ktx.width > base.width || ktx.height > base.height)) {
        larger.push(
          `${file.url}: ${ktx.width} x ${ktx.height} over ${base.width} x ${base.height}`,
        );
      }
    }
    expect(
      larger,
      'under-armor atlases larger than the body map. Fewer than the pin is the fix landing: ' +
        'lower UNDER_ARMOR_ATLASES_LARGER_THAN_THE_BODY_MAP (0 is the goal)',
    ).toHaveLength(UNDER_ARMOR_ATLASES_LARGER_THAN_THE_BODY_MAP);
  });
});
