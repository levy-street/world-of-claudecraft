// The readers behind the WOC budget suites (tests/helpers/woc_shipped_files.ts), on fixtures
// written out by hand: a budget is only as good as the count it compares, and every literal
// in those suites was read through these functions. So each rule with more than one arm is
// driven here on bytes whose answer is known without them: the file naming, the KTX2 codec,
// alpha and transfer function, a texture's slots, the level a primitive draws when asked for
// one it lacks, a mesh hung twice, and where an extension name can hide. The KTX2 reader is
// also held against a second parser (three's ktx-parse, the one KTX2Loader reads with), on
// the fixtures and on real shipped textures, so the fixture writer and the reader cannot
// share one wrong offset.
// @ts-expect-error three ships ktx-parse (the reader KTX2Loader uses) untyped
import { read as readWithKtxParse } from 'three/examples/jsm/libs/ktx-parse.module.js';
import { describe, expect, it } from 'vitest';
import {
  glbExtensionNames,
  ktx2Facts,
  parseGlb,
  readWocGlb,
  WOC_FILE_KINDS,
  type WocGlbJson,
  wocFileBytes,
  wocFileKind,
  wocFilesOnDisk,
  wocGlbTextures,
  wocGlbTriangles,
  wocShippedFiles,
} from './woc_shipped_files';

/** A KTX2 container of no level data: the identifier, the header, the index, one level entry
 *  per level and a basic data format descriptor of `samples` samples (BT.709 primaries). */
function ktx2(opts: {
  width: number;
  height: number;
  levels: number;
  scheme: number;
  model: number;
  /** each sample's channel id */
  samples: number[];
  /** the transfer function: 2 sRGB (the default here), 1 linear */
  transfer?: number;
}): Uint8Array {
  const dfdLength = 4 + 24 + 16 * opts.samples.length;
  const dfdAt = 80 + 24 * opts.levels;
  const b = Buffer.alloc(dfdAt + dfdLength);
  b.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // vkFormat, typeSize, width, height, depth, layers, faces, levels, supercompression
  [0, 1, opts.width, opts.height, 0, 0, 1, opts.levels, opts.scheme].forEach((v, i) => {
    b.writeUInt32LE(v, 12 + 4 * i);
  });
  b.writeUInt32LE(dfdAt, 48);
  b.writeUInt32LE(dfdLength, 52);
  b.writeUInt32LE(dfdLength, dfdAt);
  b.writeUInt16LE(24 + 16 * opts.samples.length, dfdAt + 10);
  b[dfdAt + 12] = opts.model;
  b[dfdAt + 13] = 1;
  b[dfdAt + 14] = opts.transfer ?? 2;
  opts.samples.forEach((channel, i) => {
    b[dfdAt + 28 + 16 * i + 3] = channel;
  });
  return new Uint8Array(b);
}

/** What three's own KTX2 parser reads of a container: the fields ktx2Facts decides from. */
function secondOpinion(bytes: Uint8Array) {
  const container = readWithKtxParse(bytes) as {
    pixelWidth: number;
    pixelHeight: number;
    levels: unknown[];
    supercompressionScheme: number;
    dataFormatDescriptor: {
      colorModel: number;
      transferFunction: number;
      samples: { channelType: number }[];
    }[];
  };
  const dfd = container.dataFormatDescriptor[0];
  return {
    width: container.pixelWidth,
    height: container.pixelHeight,
    levels: container.levels.length,
    scheme: container.supercompressionScheme,
    model: dfd.colorModel,
    transfer: dfd.transferFunction,
    channels: dfd.samples.map((sample) => sample.channelType & 0x0f),
  };
}

const ETC1S = { scheme: 1, model: 163 };
const UASTC = { scheme: 2, model: 166 };

/** A GLB of a JSON chunk and a BIN chunk. */
function glb(json: unknown, bin: Uint8Array = new Uint8Array(0)): Buffer {
  let text = JSON.stringify(json);
  text += ' '.repeat((4 - (text.length % 4)) % 4);
  const out = Buffer.alloc(20 + text.length + (bin.length ? 8 + bin.length : 0));
  out.write('glTF', 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(text.length, 12);
  out.write('JSON', 16);
  out.write(text, 20);
  if (bin.length) {
    out.writeUInt32LE(bin.length, 20 + text.length);
    out.write('BIN\0', 24 + text.length);
    out.set(bin, 28 + text.length);
  }
  return out;
}

describe('wocFileKind', () => {
  const dir = 'models/chars/players/woc';

  it('names every kind of file by the delivery and catalog naming rules', () => {
    expect(wocFileKind(`${dir}/base_female.glb`)).toEqual({ kind: 'base', fit: 'female' });
    expect(wocFileKind(`${dir}/anims_male.glb`)).toEqual({ kind: 'anims', fit: 'male' });
    expect(wocFileKind(`${dir}/armor/male_mage_low.glb`)).toEqual({
      kind: 'armorLow',
      fit: 'male',
      set: 'mage',
    });
    expect(wocFileKind(`${dir}/armor/female_iron_crown_medium.glb`)).toEqual({
      kind: 'armorMedium',
      fit: 'female',
      set: 'iron_crown',
    });
    expect(wocFileKind(`${dir}/armor/male_rogue_top.glb`).kind).toBe('armorTop');
    expect(wocFileKind(`${dir}/head_type_b_core.glb`)).toEqual({ kind: 'headCore', type: 'b' });
    expect(wocFileKind(`${dir}/head_type_a_hair_swept.glb`)).toEqual({
      kind: 'hair',
      type: 'a',
      id: 'swept',
    });
    // the shared file and a beard's own file are two kinds: seven beards against one
    expect(wocFileKind(`${dir}/head_type_a_beards.glb`)).toEqual({ kind: 'beards', type: 'a' });
    expect(wocFileKind(`${dir}/head_type_b_beard_handlebar.glb`)).toEqual({
      kind: 'beard',
      type: 'b',
      id: 'handlebar',
    });
    expect(wocFileKind('textures/skins/woc/mage_underarmor.ktx2')).toEqual({
      kind: 'underArmor',
      fit: 'male',
      set: 'mage',
    });
    expect(wocFileKind('textures/skins/woc/female_druid_underarmor.ktx2')).toEqual({
      kind: 'underArmor',
      fit: 'female',
      set: 'druid',
    });
  });

  it('refuses anything else, so a new kind of file is classified before it is budgeted', () => {
    for (const url of [
      `${dir}/armor/male_mage_high.glb`,
      `${dir}/head_type_c_core.glb`,
      `${dir}/base_male.gltf`,
      'textures/skins/woc/mage_underarmor.png',
      'models/chars/players/knight.glb',
    ]) {
      expect(() => wocFileKind(url), url).toThrow(/not a WOC character file/);
    }
  });
});

describe('the shipped file list', () => {
  it('is the directory itself: the pin and the catalog name every file that ships', () => {
    const files = wocShippedFiles();
    expect(files.map((file) => file.url)).toEqual(wocFilesOnDisk());
    // literal: 2 bases, 2 libraries, 54 armor files, 2 head cores, 20 hairstyles, 2 shared
    // beard files, 2 handlebars, 16 under-armor atlases
    const count = (kind: string) => files.filter((file) => file.kind === kind).length;
    expect(WOC_FILE_KINDS.map((kind) => [kind, count(kind)])).toEqual([
      ['base', 2],
      ['anims', 2],
      ['armorLow', 18],
      ['armorMedium', 18],
      ['armorTop', 18],
      ['headCore', 2],
      ['hair', 20],
      ['beards', 2],
      ['beard', 2],
      ['underArmor', 16],
    ]);
  });
});

describe('ktx2Facts', () => {
  it('reads the size, the levels, the codec and the transfer function', () => {
    const opaque = ktx2Facts(
      ktx2({ width: 1024, height: 512, levels: 11, ...ETC1S, samples: [0] }),
    );
    expect(opaque).toEqual({
      width: 1024,
      height: 512,
      levels: 11,
      codec: 'ETC1S',
      alpha: false,
      transfer: 'sRGB',
      bytes: 80 + 24 * 11 + 44,
    });
    const data = ktx2Facts(
      ktx2({ width: 2048, height: 1024, levels: 1, ...UASTC, samples: [0], transfer: 1 }),
    );
    expect([data.codec, data.alpha, data.levels, data.transfer]).toEqual([
      'UASTC',
      false,
      1,
      'linear',
    ]);
    // an uncompressed UASTC payload is still UASTC
    expect(
      ktx2Facts(ktx2({ width: 8, height: 8, levels: 1, scheme: 0, model: 166, samples: [0] }))
        .codec,
    ).toBe('UASTC');
  });

  it('reads alpha by the transcoder rule: two ETC1S slices, or a UASTC RGBA or RRRG channel', () => {
    const alpha = (codec: { scheme: number; model: number }, samples: number[]) =>
      ktx2Facts(ktx2({ width: 8, height: 8, levels: 1, ...codec, samples })).alpha;
    // ETC1S: one slice is opaque; a second slice is transcoded as alpha whatever its channel
    // is called (AAA, or the green half of a two-channel RRR + GGG map)
    expect(alpha(ETC1S, [0])).toBe(false);
    expect(alpha(ETC1S, [0, 15])).toBe(true);
    expect(alpha(ETC1S, [3, 4])).toBe(true);
    // UASTC: one sample, and its channel says what the blocks hold
    expect(alpha(UASTC, [0])).toBe(false); // RGB
    expect(alpha(UASTC, [3])).toBe(true); // RGBA
    expect(alpha(UASTC, [5])).toBe(true); // RRRG
    expect(alpha(UASTC, [4])).toBe(false); // RRR
    expect(alpha(UASTC, [6])).toBe(false); // RG
  });

  it('refuses a container whose two statements of its codec disagree, or that names neither', () => {
    const facts = (scheme: number, model: number) => () =>
      ktx2Facts(ktx2({ width: 8, height: 8, levels: 1, scheme, model, samples: [0] }));
    // ETC1S blocks without BasisLZ, UASTC blocks under it, and a plain RGBA texture
    expect(facts(2, 163)).toThrow(/no known codec/);
    expect(facts(1, 166)).toThrow(/no known codec/);
    expect(facts(0, 1)).toThrow(/no known codec/);
  });

  it('refuses a transfer function it does not know, and a descriptor with no sample', () => {
    const unknown = () =>
      ktx2Facts(ktx2({ width: 8, height: 8, levels: 1, ...UASTC, samples: [0], transfer: 13 }));
    expect(unknown).toThrow(/neither sRGB nor linear/);
    expect(() =>
      ktx2Facts(ktx2({ width: 8, height: 8, levels: 1, ...UASTC, samples: [] })),
    ).toThrow(/no basic data format descriptor/);
  });

  it('agrees with a second parser on the fixtures: the writer here and the reader share no offset', () => {
    for (const [codec, samples, transfer] of [
      [ETC1S, [0], 2],
      [ETC1S, [0, 15], 2],
      [UASTC, [3], 1],
      [UASTC, [5], 2],
    ] as const) {
      const bytes = ktx2({
        width: 64,
        height: 32,
        levels: 7,
        ...codec,
        samples: [...samples],
        transfer,
      });
      expect(secondOpinion(bytes)).toEqual({
        width: 64,
        height: 32,
        levels: 7,
        scheme: codec.scheme,
        model: codec.model,
        transfer,
        channels: [...samples],
      });
    }
  });

  it('agrees with a second parser on real encoder output, one shipped texture of each codec', () => {
    // an under-armor atlas (ETC1S, standalone) and a base's body map (UASTC, embedded)
    const atlas = wocFileBytes('textures/skins/woc/mage_underarmor.ktx2');
    const base = readWocGlb('models/chars/players/woc/base_male.glb');
    const view = base.json.bufferViews?.[base.json.images?.[0].bufferView ?? -1];
    const at = view?.byteOffset ?? 0;
    const body = base.bin.subarray(at, at + (view?.byteLength ?? 0));
    for (const [bytes, codec] of [
      [atlas, 'ETC1S'],
      [body, 'UASTC'],
    ] as const) {
      const facts = ktx2Facts(bytes);
      const other = secondOpinion(bytes);
      expect(facts.codec).toBe(codec);
      expect([facts.width, facts.height, facts.levels]).toEqual([
        other.width,
        other.height,
        other.levels,
      ]);
      // the model and the scheme the codec was decided from, the transfer function, and the
      // one opaque sample
      expect([other.model, other.scheme]).toEqual(codec === 'ETC1S' ? [163, 1] : [166, 2]);
      expect(facts.transfer).toBe(other.transfer === 2 ? 'sRGB' : 'linear');
      expect(other.transfer).toBe(2);
      expect(other.channels).toEqual([0]);
      expect(facts.alpha).toBe(false);
    }
  });
});

describe('wocGlbTextures', () => {
  it('names each image by every slot that samples it, through the basisu source', () => {
    const colour = ktx2({ width: 16, height: 8, levels: 5, ...UASTC, samples: [0] });
    const data = ktx2({ width: 8, height: 4, levels: 4, ...UASTC, samples: [0] });
    const idle = ktx2({ width: 4, height: 4, levels: 1, ...ETC1S, samples: [0] });
    const bin = Buffer.concat([colour, data, idle]);
    const json = {
      materials: [
        {
          pbrMetallicRoughness: {
            baseColorTexture: { index: 0 },
            metallicRoughnessTexture: { index: 1 },
          },
          occlusionTexture: { index: 1 },
        },
        // a second material on the same colour map, and an extension's own texture slot
        {
          pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
          extensions: { KHR_materials_specular: { specularTexture: { index: 1 } } },
        },
      ],
      textures: [
        { extensions: { KHR_texture_basisu: { source: 0 } } },
        { extensions: { KHR_texture_basisu: { source: 1 } } },
      ],
      images: [
        { name: 'colour', bufferView: 0 },
        { name: 'data', bufferView: 1 },
        { name: 'idle', bufferView: 2 },
      ],
      bufferViews: [
        { byteLength: colour.length },
        { byteOffset: colour.length, byteLength: data.length },
        { byteOffset: colour.length + data.length, byteLength: idle.length },
      ],
    };
    const textures = wocGlbTextures(parseGlb('fixture.glb', glb(json, bin)));
    expect(textures.map((t) => [t.image, t.slots, t.ktx.width, t.ktx.height, t.ktx.codec])).toEqual(
      [
        ['colour', ['baseColor'], 16, 8, 'UASTC'],
        ['data', ['metallicRoughness', 'occlusion', 'specular'], 8, 4, 'UASTC'],
        // an image no material samples is still an image the file ships: listed, with no slot
        ['idle', [], 4, 4, 'ETC1S'],
      ],
    );
  });
});

describe('wocGlbTextures and parseGlb, what they refuse', () => {
  it('reads a plain texture source as it reads a basisu one, and no slot out of `extras`', () => {
    const map = ktx2({ width: 8, height: 8, levels: 4, ...ETC1S, samples: [0] });
    const json = {
      materials: [
        {
          emissiveTexture: { index: 0 },
          // application data that only looks like a slot
          extras: { paintTexture: { index: 0 } },
        },
      ],
      textures: [{ source: 0 }],
      images: [{ name: 'glow', bufferView: 0 }],
      bufferViews: [{ byteLength: map.length }],
    };
    const [texture] = wocGlbTextures(parseGlb('plain.glb', glb(json, map)));
    expect([texture.image, texture.slots]).toEqual(['glow', ['emissive']]);
  });

  it('refuses an image that is not embedded, and one that is not a KTX2', () => {
    const external = { images: [{ name: 'elsewhere', uri: 'elsewhere.ktx2' }] };
    expect(() => wocGlbTextures(parseGlb('external.glb', glb(external)))).toThrow(
      /image 0 is not embedded/,
    );
    const png = { images: [{ bufferView: 0 }], bufferViews: [{ byteLength: 96 }] };
    expect(() => wocGlbTextures(parseGlb('png.glb', glb(png, new Uint8Array(96))))).toThrow(
      /not a KTX2 file/,
    );
  });

  it('refuses bytes that are not a GLB of a JSON chunk and a BIN chunk', () => {
    const good = glb({ asset: { version: '2.0' } }, new Uint8Array(4));
    expect(parseGlb('good.glb', good).bin).toHaveLength(4);
    // no BIN chunk at all is a file with none (an empty buffer), never an error
    expect(parseGlb('bare.glb', glb({})).bin).toHaveLength(0);
    const magic = Buffer.from(good);
    magic.write('glTX', 0);
    expect(() => parseGlb('magic.glb', magic)).toThrow(/is not a GLB/);
    const first = Buffer.from(good);
    first.write('BIN\0', 16);
    expect(() => parseGlb('first.glb', first)).toThrow(/first chunk is not JSON/);
    const second = Buffer.from(good);
    second.write('JSON', 20 + good.readUInt32LE(12) + 4);
    expect(() => parseGlb('second.glb', second)).toThrow(/second chunk is not BIN/);
  });
});

describe('wocGlbTriangles', () => {
  /** `count` is an accessor's element count; accessor i is named by its index. */
  const accessors = (...counts: number[]) => counts.map((count) => ({ count }));
  const lod = (...indices: number[]) => ({
    WOC_lod: { levels: indices.map((i) => ({ indices: i })) },
  });

  it('draws each primitive at the level asked, or the next finer one it carries', () => {
    const json: WocGlbJson = {
      // 0: positions (9 vertices), then index lists of 300, 150, 60, 90 and 30 entries
      accessors: accessors(9, 300, 150, 60, 90, 30),
      nodes: [{ name: 'bone' }, { name: 'one', mesh: 1 }, { name: 'none', mesh: 2 }, { mesh: 0 }],
      meshes: [
        // both levels: 100 / 50 / 20
        { primitives: [{ attributes: { POSITION: 0 }, indices: 1, extensions: lod(2, 3) }] },
        // a list of ONE is the far level, and MID falls back to level 0: 30 / 30 / 10
        { primitives: [{ attributes: { POSITION: 0 }, indices: 4, extensions: lod(5) }] },
        // no level: level 0 throughout, and no index either: its vertices in order, 3 / 3 / 3
        { primitives: [{ attributes: { POSITION: 0 } }] },
      ],
    };
    expect(wocGlbTriangles(json)).toEqual({ lod0: 133, mid: 83, far: 33 });
  });

  it('counts a mesh once per node that hangs it, and never a mesh no node hangs', () => {
    const json: WocGlbJson = {
      accessors: accessors(9, 300, 150, 60, 600),
      nodes: [{ name: 'left', mesh: 0 }, { name: 'right', mesh: 0 }, { name: 'bone' }],
      meshes: [
        { primitives: [{ attributes: { POSITION: 0 }, indices: 1, extensions: lod(2, 3) }] },
        { primitives: [{ attributes: { POSITION: 0 }, indices: 4 }] },
      ],
    };
    expect(wocGlbTriangles(json)).toEqual({ lod0: 200, mid: 100, far: 40 });
  });

  it('refuses what is not a triangle list rather than counting it', () => {
    const lines: WocGlbJson = {
      accessors: accessors(9, 300),
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 1 }] }],
    };
    expect(() => wocGlbTriangles(lines)).toThrow(/not drawn as triangles/);
    const ragged: WocGlbJson = {
      accessors: accessors(9, 301),
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    };
    expect(() => wocGlbTriangles(ragged)).toThrow(/not a triangle list/);
  });
});

describe('glbExtensionNames', () => {
  it('finds an extension wherever a file can name it', () => {
    const json = {
      extensionsUsed: ['KHR_used'],
      extensionsRequired: ['KHR_required'],
      extensions: { KHR_root: { lights: [{ type: 'point' }] } },
      nodes: [{ extensions: { KHR_node: { light: 0 } } }],
      materials: [{ extensions: { KHR_material: { factor: 1 } } }],
      meshes: [{ primitives: [{ attributes: {}, extensions: { KHR_primitive: {} } }] }],
      textures: [{ extensions: { KHR_texture: { source: 0 } } }],
      bufferViews: [{ byteLength: 4, extensions: { KHR_view: {} } }],
    };
    expect(glbExtensionNames(json)).toEqual([
      'KHR_material',
      'KHR_node',
      'KHR_primitive',
      'KHR_required',
      'KHR_root',
      'KHR_texture',
      'KHR_used',
      'KHR_view',
    ]);
  });

  it("reads no application data: an `extras` blob's own keys are not extensions", () => {
    const json = { materials: [{ extras: { extensions: { not_an_extension: {} } } }] };
    expect(glbExtensionNames(json)).toEqual([]);
    expect(glbExtensionNames({})).toEqual([]);
  });
});
