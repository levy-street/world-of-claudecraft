// The glTF extensions the shipped WOC character files use, held to literals, because an
// extension is not metadata to the renderer: its mere presence can change what a material
// costs to draw.
//
// - KHR_materials_transmission puts every object wearing it through three's transmission pass
//   (the opaque scene drawn a second time into a viewport-sized target), KHR_materials_volume
//   only means anything with it, and KHR_lights_punctual adds lights to the scene, which
//   re-keys every lit program. The loader neutralizes transmission at parse
//   (src/render/assets/transmission_neutralize.ts), but that is a net, never a licence: no WOC
//   file carries any of the three (PR 4360 review, N11).
// - GLTFLoader mints a MeshPhysicalMaterial in place of a MeshStandardMaterial for a material
//   that carries any of the physical extensions (clearcoat, sheen, ior, specular, transmission
//   and their kin), whatever its values. The class compiles its own programs
//   (`#define PHYSICAL`), one more variant of every program the standard material already
//   links. KHR_materials_specular is the one such extension the WOC files carry: the
//   hand-authored cloth and leather of six armor sets ship a specular factor under 1 (a matte
//   surface), so on Medium and above those materials are physical
//   (src/render/characters/assets.ts buildTintedClone clones the file material; the low tier
//   and iOS rebuild everything as Lambert). The factors are NOT the glTF default, so stripping
//   the extension would change how that cloth looks; which files and which values is pinned
//   here, as literals, so the physical class can never spread to another set, file or
//   material unseen (PR 4360 review, S6).
// - A material is also a DRAW: the merged armor folds a kit's parts per file material
//   (src/render/characters/woc_armor_merge_core.ts), and the build keeps two materials apart
//   whenever they differ in an extension value. How many materials each armor file carries is
//   pinned here too.
//
// The list of files is the delivery's own (tests/helpers/woc_shipped_files.ts), and every
// expectation is written out below.
import type * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import {
  glbExtensionNames,
  readWocGlb,
  type WocFileKind,
  type WocGlb,
  type WocShippedFile,
  wocFilesOnDisk,
  wocShippedFiles,
} from './helpers/woc_shipped_files';

const FILES = wocShippedFiles();
const GLBS: readonly (readonly [WocShippedFile, WocGlb])[] = FILES.filter(
  (file) => file.kind !== 'underArmor',
).map((file) => [file, readWocGlb(file.url)] as const);

/** Extensions no WOC file may use, each with what it would cost. */
const FORBIDDEN: Readonly<Record<string, string>> = {
  KHR_materials_transmission:
    "three's transmission pass: the opaque scene drawn again, every frame the object is on screen",
  KHR_materials_volume: 'a refraction volume, which only draws through the transmission pass',
  KHR_lights_punctual: 'a light added to the scene, which re-keys every lit program',
};

/** The extensions every file of a kind uses, and nothing else. Geometry and texture encodings
 *  only: none of these touches a material's class. */
const MESH_FILE = [
  'EXT_meshopt_compression',
  'KHR_mesh_quantization',
  'KHR_texture_basisu',
  'WOC_lod',
];
const KIND_EXTENSIONS: Readonly<Partial<Record<WocFileKind, readonly string[]>>> = {
  // every clip and the rig's nodes, no mesh: nothing to quantize, no texture, no level
  anims: ['EXT_meshopt_compression'],
  base: MESH_FILE,
  armorLow: MESH_FILE,
  armorMedium: MESH_FILE,
  // one degenerate triangle wearing the set's top mip levels
  armorTop: ['KHR_texture_basisu'],
  headCore: MESH_FILE,
  hair: MESH_FILE,
  beards: MESH_FILE,
  beard: MESH_FILE,
};

/** The only extensions a file may list as REQUIRED: the encodings a loader cannot draw
 *  without. A material or level-of-detail extension is always optional. */
const MAY_BE_REQUIRED = ['EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_texture_basisu'];

/**
 * The armor packs whose materials carry KHR_materials_specular, by `<fit>_<set>`, each with
 * the specular factor of every material that carries one (sorted). A pack's LOW and MEDIUM
 * files carry the same list (the top file has one material and no extension): 24 files, 48
 * materials. The factors are the artist's own, on the hand-authored materials: 0.5 on the
 * cloth and leather, 0.28 on the four hoods, 0.7 on the rogue's leather and gunmetal
 * shoulders. (Blender's glTF exporter writes twice a material's Specular IOR Level and
 * writes nothing at its default of 0.5, so these read as 0.25, 0.14 and 0.35 set by hand;
 * that is the exporter's rule, not something a file here records.) The warrior, paladin and
 * hunter sets carry none, nor do the helms and shoulders of the druid and shaman. Written to
 * two decimals and compared at the float the file stores.
 */
const SPECULAR_FACTORS: Readonly<Record<string, readonly number[]>> = {
  female_druid: [0.5, 0.5],
  female_mage: [0.28, 0.5],
  female_priest: [0.28, 0.5],
  female_rogue: [0.28, 0.5, 0.7],
  female_shaman: [0.5, 0.5],
  female_warlock: [0.28, 0.5],
  male_druid: [0.5],
  male_mage: [0.28, 0.5],
  male_priest: [0.28, 0.5],
  male_rogue: [0.28, 0.5, 0.7],
  male_shaman: [0.5],
  male_warlock: [0.28, 0.5],
};

/** The armor packs whose materials carry KHR_materials_emissive_strength (the shaman's glow),
 *  with every material's strength, low and medium alike. It scales `emissiveIntensity` and
 *  leaves the material's class alone. */
const EMISSIVE_STRENGTHS: Readonly<Record<string, readonly number[]>> = {
  female_shaman: [1.3, 1.3],
  male_shaman: [1.3, 1.3],
};

/**
 * How many materials each pack's low and medium file carries (its top file carries the one
 * that wears the top levels). Once a kit is folded every material is one armor draw a pass for
 * its wearer, on every preset, so this is a draw budget. The build keeps two materials of a
 * set apart when they differ in double-sidedness or in an extension value
 * (scripts/assets/woc_character/armor_atlas.mjs `signature`): the specular factors above are
 * the only thing between the three materials of the mage, priest, warlock and rogue sets,
 * which would otherwise be one.
 */
const ARMOR_MATERIALS: Readonly<Record<string, number>> = {
  female_druid: 4,
  female_hunter: 2,
  female_mage: 3,
  female_paladin: 1,
  female_priest: 3,
  female_rogue: 3,
  female_shaman: 3,
  female_warlock: 3,
  female_warrior: 2,
  male_druid: 3,
  male_hunter: 1,
  male_mage: 3,
  male_paladin: 1,
  male_priest: 3,
  male_rogue: 3,
  male_shaman: 2,
  male_warlock: 3,
  male_warrior: 1,
};

const SPECULAR = 'KHR_materials_specular';
const EMISSIVE_STRENGTH = 'KHR_materials_emissive_strength';
/** The tiers of a pack whose materials carry the pack's material extensions. */
const MATERIAL_TIERS: readonly WocFileKind[] = ['armorLow', 'armorMedium'];

const packOf = (file: WocShippedFile): string => `${file.fit}_${file.set}`;
/** A list of factors in ascending order, each as the float32 a glTF file stores it at. */
const stored = (values: readonly unknown[]): number[] =>
  values.map((value) => Math.fround(value as number)).sort((a, b) => a - b);

/** Every material of a file that carries `extension`, as that extension's own object. */
function materialExtensions(glb: WocGlb, extension: string): Readonly<Record<string, unknown>>[] {
  return (glb.json.materials ?? []).flatMap((material) => {
    const found = material.extensions?.[extension];
    return found ? [found] : [];
  });
}

describe('WOC character files: the glTF extensions they use', () => {
  it('covers every GLB that ships: the 84 files of the delivery pin and the head catalog', () => {
    expect(GLBS).toHaveLength(84);
    // nothing ships outside the list this suite walks
    expect(FILES.map((file) => file.url)).toEqual(wocFilesOnDisk());
  });

  it.each(GLBS.map(([file, glb]) => [file.url, file, glb] as const))(
    '%s uses no transmission, volume or punctual light',
    (url, _file, glb) => {
      const used = glbExtensionNames(glb.json);
      for (const [name, cost] of Object.entries(FORBIDDEN)) {
        expect(
          used,
          `${url} uses ${name} (${cost}). A WOC character file never does.`,
        ).not.toContain(name);
      }
    },
  );

  it.each(GLBS.map(([file, glb]) => [file.url, file, glb] as const))(
    '%s uses exactly the extensions pinned for it',
    (url, file, glb) => {
      const pinned = new Set(KIND_EXTENSIONS[file.kind]);
      if (MATERIAL_TIERS.includes(file.kind)) {
        if (packOf(file) in SPECULAR_FACTORS) pinned.add(SPECULAR);
        if (packOf(file) in EMISSIVE_STRENGTHS) pinned.add(EMISSIVE_STRENGTH);
      }
      expect(
        glbExtensionNames(glb.json),
        `${url} (${file.kind}): the extensions it uses, against the pin. A new material ` +
          'extension can change the material class every wearer compiles: add it to this test ' +
          'only with its cost stated in the PR body.',
      ).toEqual([...pinned].sort());
      for (const name of glb.json.extensionsRequired ?? []) {
        expect(MAY_BE_REQUIRED, `${url} requires ${name}`).toContain(name);
      }
    },
  );

  it('pins which armor materials are physical: the specular factor of every one', () => {
    let files = 0;
    let materials = 0;
    for (const [file, glb] of GLBS) {
      const found = materialExtensions(glb, SPECULAR);
      const pinned = MATERIAL_TIERS.includes(file.kind)
        ? SPECULAR_FACTORS[packOf(file)]
        : undefined;
      expect(
        found.map((ext) => ext.specularFactor).sort((a, b) => (a as number) - (b as number)),
        `${file.url}: the specular factor of each material that carries ${SPECULAR}. Every ` +
          'one compiles as a physical material on Medium and above; a new one is the art ' +
          "owner's call, named in SPECULAR_FACTORS.",
      ).toEqual(stored(pinned ?? []));
      for (const ext of found) {
        // a factor alone: no colour factor and no specular map (a map would add a texture
        // slot and another program variant), and a real factor under the default of 1
        expect(Object.keys(ext), file.url).toEqual(['specularFactor']);
        expect(ext.specularFactor, file.url).toBeGreaterThan(0);
        expect(ext.specularFactor, file.url).toBeLessThan(1);
      }
      if (found.length > 0) files++;
      materials += found.length;
    }
    expect([files, materials]).toEqual([24, 48]);
    // no stale row: every pinned pack ships
    const packs = new Set(GLBS.map(([file]) => packOf(file)));
    for (const pack of Object.keys(SPECULAR_FACTORS)) expect(packs.has(pack), pack).toBe(true);
  });

  it('pins how many materials each armor file carries: each is a draw for its wearer', () => {
    let files = 0;
    for (const [file, glb] of GLBS) {
      if (file.kind !== 'armorLow' && file.kind !== 'armorMedium' && file.kind !== 'armorTop') {
        continue;
      }
      files++;
      const pinned = file.kind === 'armorTop' ? 1 : ARMOR_MATERIALS[packOf(file)];
      expect(
        glb.json.materials?.length,
        `${file.url}: the materials it carries. Each one is an armor draw a pass for every ` +
          'wearer of the set: one more is a cost to name in the PR body, then to re-pin in ' +
          'ARMOR_MATERIALS.',
      ).toBe(pinned);
    }
    expect(files).toBe(54);
    expect(Object.keys(ARMOR_MATERIALS)).toHaveLength(18);
  });

  it('pins the glow strength of the one set that carries it', () => {
    let files = 0;
    for (const [file, glb] of GLBS) {
      const found = materialExtensions(glb, EMISSIVE_STRENGTH);
      const pinned = MATERIAL_TIERS.includes(file.kind)
        ? EMISSIVE_STRENGTHS[packOf(file)]
        : undefined;
      expect(
        found.map((ext) => ext.emissiveStrength),
        `${file.url}: ${EMISSIVE_STRENGTH}`,
      ).toEqual(stored(pinned ?? []));
      if (found.length > 0) files++;
    }
    expect(files).toBe(4);
  });
});

// Why the lists above matter, on the loader this repo ships (three's GLTFLoader, pinned in
// package.json): the material CLASS follows the extension's presence, not its values.
describe('GLTFLoader: what a material extension does to the material class', () => {
  /** A one-triangle GLB whose three primitives wear a plain material, one with a specular
   *  factor and one with an emissive strength. */
  function fixture(specular: Record<string, unknown>): ArrayBuffer {
    const json = {
      asset: { version: '2.0' },
      extensionsUsed: [SPECULAR, EMISSIVE_STRENGTH],
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [
        {
          primitives: [0, 1, 2].map((material) => ({ attributes: { POSITION: 0 }, material })),
        },
      ],
      materials: [
        { name: 'plain' },
        { name: 'specular', extensions: { [SPECULAR]: specular } },
        {
          name: 'glow',
          emissiveFactor: [1, 1, 1],
          extensions: { [EMISSIVE_STRENGTH]: { emissiveStrength: 1.5 } },
        },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
      ],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36 }],
    };
    let text = JSON.stringify(json);
    text += ' '.repeat((4 - (text.length % 4)) % 4);
    const bin = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
    const out = Buffer.alloc(12 + 8 + text.length + 8 + bin.length);
    out.write('glTF', 0);
    out.writeUInt32LE(2, 4);
    out.writeUInt32LE(out.length, 8);
    out.writeUInt32LE(text.length, 12);
    out.write('JSON', 16);
    out.write(text, 20);
    out.writeUInt32LE(bin.length, 20 + text.length);
    out.write('BIN\0', 24 + text.length);
    bin.copy(out, 28 + text.length);
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
  }

  async function materialsOf(specular: Record<string, unknown>) {
    const gltf = await new GLTFLoader().parseAsync(fixture(specular), '');
    const byName = new Map<string, THREE.MeshPhysicalMaterial>();
    gltf.scene.traverse((object) => {
      const material = (object as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
      if (material) byName.set(material.name, material);
    });
    return byName;
  }

  it('mints a physical material for a specular factor, and a standard one without', async () => {
    const materials = await materialsOf({ specularFactor: 0.5 });
    expect([...materials.keys()].sort()).toEqual(['glow', 'plain', 'specular']);
    const specular = materials.get('specular');
    expect(specular?.type).toBe('MeshPhysicalMaterial');
    expect(specular?.defines).toHaveProperty('PHYSICAL');
    expect(specular?.specularIntensity).toBe(0.5);
    expect(specular?.specularColor.toArray()).toEqual([1, 1, 1]);
    // the plain material beside it, and the one that only scales its glow, stay standard
    for (const name of ['plain', 'glow']) {
      expect(materials.get(name)?.type, name).toBe('MeshStandardMaterial');
      expect(materials.get(name)?.defines, name).not.toHaveProperty('PHYSICAL');
    }
    expect(materials.get('glow')?.emissiveIntensity).toBe(1.5);
  });

  it('mints it for the extension alone, even at the glTF default values', async () => {
    // an empty extension object is the default factor of 1: it draws exactly what a standard
    // material draws and still compiles the physical class, so a build must never write one
    const specular = (await materialsOf({})).get('specular');
    expect(specular?.type).toBe('MeshPhysicalMaterial');
    expect(specular?.specularIntensity).toBe(1);
    // with the index of refraction that gives a standard material its 0.04 reflectance
    expect(specular?.ior).toBe(1.5);
  });
});
