// The WOC modular characters: the shipped split files (one base and one animation library per
// body fit; per set and fit a low file, a medium file and the medium maps' top mip levels:
// woc_armor_core.ts) against the
// manifests that select their parts, the pure selection rule, and the game-equipment mapping.
// Part names are the contract: a renamed node fails SILENTLY at runtime (the body just loses a
// limb), so every name a manifest can select is pinned against the file actually served out
// of public/. The blade contacts the renderer holds the hit presentation for (ClipMap.contacts)
// are re-measured here off the shipped library.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';
import { ATLAS_SIZES } from '../scripts/assets/woc_character/armor_atlas.mjs';
import {
  characterPreloadUrls,
  playerVisualKey,
  VISUALS,
  WOC_CONTACTS,
  WOC_CONTACTS_FEMALE,
} from '../src/render/characters/manifest';
import {
  WOC_SPLIT_DIR,
  type WocFit,
  wocAnimsUrl,
  wocArmorPackUrl,
  wocBaseUrl,
} from '../src/render/characters/woc_armor_core';
import {
  WOC_PALADIN_FEMALE_MANIFEST,
  WOC_PALADIN_MANIFEST,
  WOC_WARRIOR_FEMALE_MANIFEST,
  WOC_WARRIOR_MANIFEST,
  type WocCharacterManifest,
} from '../src/render/characters/woc_character_manifest';
import {
  classBodyComposes,
  WOC_BODY_CLASSES,
  WOC_DRESSABLE_EQUIP_SLOTS,
  wocAllPartNames,
  wocAnatomyParts,
  wocArmorAssetFor,
  wocBodyPartNames,
  wocDefaultAppearance,
  wocDefaultWorn,
  wocManifestSets,
  wocMergePartition,
  wocNodeNameOf,
  wocUnderArmorAtlas,
  wocVisibleParts,
  wocWornFromEquipment,
  wocWornSets,
} from '../src/render/characters/woc_parts_core';
import { wocWowAnimsUrl } from '../src/render/characters/woc_wow_animations';
import { ITEMS } from '../src/sim/data';
import { ALL_CLASSES, type EquipSlot } from '../src/sim/types';

const M = WOC_WARRIOR_MANIFEST;

interface GlbJson {
  extensionsRequired?: string[];
  extensionsUsed?: string[];
  images?: { mimeType: string; bufferView?: number; name?: string }[];
  textures?: { source?: number; extensions?: Record<string, { source?: number }> }[];
  materials?: {
    normalTexture?: { index: number };
    occlusionTexture?: { index: number };
    emissiveTexture?: { index: number };
    pbrMetallicRoughness?: {
      baseColorTexture?: { index: number };
      metallicRoughnessTexture?: { index: number };
    };
  }[];
  nodes: { name?: string; scale?: number[]; skin?: number; mesh?: number }[];
  meshes?: { primitives: { material?: number }[] }[];
  skins?: { joints: number[] }[];
  animations?: {
    name: string;
    samplers: { input: number }[];
    channels: { target: { node: number; path: string } }[];
  }[];
  accessors: { max?: number[] }[];
  bufferViews?: { byteOffset?: number; byteLength: number }[];
}

const publicFile = (url: string): Buffer =>
  readFileSync(path.resolve(__dirname, '..', 'public', url));
const glb = (url: string): GlbJson => glbJsonChunk(publicFile(url)) as unknown as GlbJson;
const nodeNamesOf = (json: GlbJson): Set<string> => new Set(json.nodes.map((n) => n.name ?? ''));

const BASE: Record<WocFit, GlbJson> = {
  male: glb(wocBaseUrl('male')),
  female: glb(wocBaseUrl('female')),
};
const LIBRARY: Record<WocFit, GlbJson> = {
  male: glb(wocAnimsUrl('male')),
  female: glb(wocAnimsUrl('female')),
};
const clipDuration = (json: GlbJson, name: string): number => {
  const anim = json.animations?.find((a) => a.name === name);
  if (!anim) throw new Error(`no clip ${name}`);
  return Math.max(...anim.samplers.map((s) => json.accessors[s.input].max?.[0] ?? 0));
};

/** Every WOC class def, with its manifest (the player bodies: the Tideglass Reflections
 *  are mob copies of them). */
const WOC_DEFS = Object.entries(VISUALS).flatMap(([key, def]) =>
  key.startsWith('player_') && def.wocCharacter
    ? [[key, def.wocCharacter] as [string, WocCharacterManifest]]
    : [],
);

/** The 2026-09-24 animation rig (34 joints, in skin joint order): the handoff's bone names plus
 *  neck, clavicles and the waist-plate ring. */
const WOC_JOINTS = [
  'root',
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'clavicle.l',
  'upperarm.l',
  'lowerarm.l',
  'wrist.l',
  'hand.l',
  'handslot.l',
  'armor_shoulder.l',
  'clavicle.r',
  'upperarm.r',
  'lowerarm.r',
  'wrist.r',
  'hand.r',
  'handslot.r',
  'armor_shoulder.r',
  'upperleg.l',
  'lowerleg.l',
  'foot.l',
  'toes.l',
  'skirt.front.l',
  'tassel.side.l',
  'skirt.back.l',
  'upperleg.r',
  'lowerleg.r',
  'foot.r',
  'toes.r',
  'skirt.front.r',
  'tassel.side.r',
  'skirt.back.r',
];

/** The appearance rule (a required slot never empties, a worn piece hides the slots it names),
 *  exercised on a fixture: no shipped base cuts a part of its own today (the head is the
 *  modular head library, never part of a base file). */
const CUT: WocCharacterManifest = {
  ...WOC_WARRIOR_MANIFEST,
  appearance: {
    crest: {
      label: 'Crest',
      required: true,
      variants: { default: { label: 'Crest', nodes: ['Part_Crest_L', 'Part_Crest_R'] } },
    },
    hair: {
      label: 'Plume',
      required: false,
      variants: { default: { label: 'Plume', nodes: ['Part_Plume'] } },
    },
  },
  defaultAppearance: { crest: 'default', hair: 'default' },
};

/** The pixel size of a KTX2 image carried in a GLB's binary chunk. */
function ktx2Size(file: Buffer, json: GlbJson, image: number): [number, number] {
  const view = json.bufferViews?.[json.images?.[image]?.bufferView ?? -1];
  if (!view) return [0, 0];
  const jsonLen = file.readUInt32LE(12);
  const bin = 20 + jsonLen + 8; // the BIN chunk's payload
  const at = bin + (view.byteOffset ?? 0);
  return [file.readUInt32LE(at + 20), file.readUInt32LE(at + 24)];
}

/** An embedded KTX2's level count (the eighth header field). */
function ktx2Levels(file: Buffer, json: GlbJson, image: number): number {
  const view = json.bufferViews?.[json.images?.[image]?.bufferView ?? -1];
  if (!view) return 0;
  const at = 20 + file.readUInt32LE(12) + 8 + (view.byteOffset ?? 0);
  return file.readUInt32LE(at + 40);
}

/** The tiers whose pack is a file carrying the set's parts: low and medium. The high pack is the
 *  medium file with the top file's levels laid over it. */
const MESH_TIERS = ['low', 'medium'] as const;

/** The atlas sizes a tier's file carries: the low file its own layout, the medium file every
 *  map of the full layout at half its size. */
function atlasSizes(tier: (typeof MESH_TIERS)[number]): [number, number][] {
  if (tier === 'low') return Object.values(ATLAS_SIZES.low);
  return Object.values(ATLAS_SIZES.full).map(([w, h]) => [w / 2, h / 2]);
}

describe('the shipped WOC split files', () => {
  it('rides every class def on its fit base and library, fetched on demand and never in the boot gate', () => {
    expect(WOC_DEFS).toHaveLength(18);
    for (const [key, manifest] of WOC_DEFS) {
      const def = VISUALS[key];
      expect(manifest.fit, key).toBe(key.endsWith('_female') ? 'female' : 'male');
      expect(def.url, key).toBe(wocBaseUrl(manifest.fit));
      // Both libraries use this exact bind pose; no unretargeted donor may bind by name.
      expect(def.animUrls, key).toEqual([wocAnimsUrl(manifest.fit), wocWowAnimsUrl(manifest.fit)]);
      expect(def.lazyPreload, key).toBe(true);
      expect(def.authoredAtlas, key).toBe(true);
      expect(def.modular, key).toBeUndefined();
    }
    // The boot gate downloads nothing of a WOC body: the launcher fetches a fit when a
    // preview first shows it, world entry loads both fits before the Renderer exists
    // (tests/woc_entry_preload.test.ts), and each armor set streams the first time one is worn.
    for (const url of characterPreloadUrls(false)) {
      expect(url.startsWith(`${WOC_SPLIT_DIR}/`), url).toBe(false);
    }
  });

  it('keeps every weapon a WOC def holds in the boot gate (a held prop attaches synchronously)', () => {
    const boot = new Set(characterPreloadUrls(false));
    for (const [key] of WOC_DEFS) {
      for (const att of VISUALS[key].attach ?? [])
        expect(boot.has(att.url), `${key} ${att.url}`).toBe(true);
    }
  });

  it('carries the body alone in each base: no head part, no armor, no clip', () => {
    for (const fit of ['male', 'female'] as const) {
      const manifest = fit === 'female' ? WOC_WARRIOR_FEMALE_MANIFEST : M;
      const json = BASE[fit];
      const nodes = nodeNamesOf(json);
      expect(wocBodyPartNames(manifest), fit).toEqual(['Character_Body']);
      // The one mesh a base draws is the body. The handoff's original face (head, neck, eyes,
      // mouth, hair, brows) never ships: the modular head packs are the head, and the build
      // strips the original after measuring it (build_woc_split.mjs stripOriginalFace).
      expect(
        json.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name),
        fit,
      ).toEqual(['Character_Body']);
      expect(json.meshes ?? [], fit).toHaveLength(1);
      expect(
        [...nodes].filter((n) => n.startsWith('Character_')),
        fit,
      ).toEqual(['Character_Body']);
      expect(
        [...nodes].filter((n) => n.startsWith('Armor_')),
        fit,
      ).toEqual([]);
      expect(json.animations ?? [], fit).toEqual([]);
    }
  });

  it('rides the animation rig: the 34 named joints, in order, on every skin of every file', () => {
    const files = [wocBaseUrl('male'), wocBaseUrl('female')];
    for (const [, manifest] of WOC_DEFS) {
      for (const set of wocManifestSets(manifest)) {
        // the two files that carry the set's parts (the top file is maps only)
        for (const tier of MESH_TIERS) files.push(wocArmorPackUrl(manifest.fit, set, tier));
      }
    }
    for (const url of new Set(files)) {
      const json = glb(url);
      expect(json.skins?.length ?? 0, url).toBeGreaterThan(0);
      for (const skin of json.skins ?? []) {
        expect(
          skin.joints.map((j) => json.nodes[j].name),
          url,
        ).toEqual(WOC_JOINTS);
      }
    }
  });

  it('ships exactly the 51 authored clips in each library, and no mesh', () => {
    for (const fit of ['male', 'female'] as const) {
      const lib = LIBRARY[fit];
      expect(
        lib.animations?.map((a) => a.name),
        fit,
      ).toEqual([...M.animationNames]);
      expect(lib.meshes ?? [], fit).toEqual([]);
      expect(lib.skins ?? [], fit).toEqual([]);
      for (const joint of WOC_JOINTS)
        expect(nodeNamesOf(lib).has(joint), `${fit} ${joint}`).toBe(true);
    }
    expect(M.animationNames).toHaveLength(51);
    // the two-hand *_2H set is gone from the library (and so from both files, pinned above):
    // 2026-09-29 its idle, gaits and jump (a two-hander plays the one-hand clips out of combat),
    // 2026-09-30 its stance, hit and strikes (Combat_Idle_2H, Hit_2H, Chop_2H, Slash_2H: no
    // two-hand stance, a two-hander fights in one fist on the single set,
    // tests/weapon_loadout_core.test.ts)
    expect(M.animationNames.filter((n) => n.endsWith('_2H'))).toEqual([]);
    expect(M.animationNames.filter((n) => n.endsWith('_Single'))).toHaveLength(4);
    // 2026-09-28: the crossed-blade stance and its strikes (Dual_Chop is the auto attack)
    for (const clip of ['Combat_Idle_Dual', 'Dual_Chop', 'Dual_Cross', 'Dual_Stab', 'Hit_Dual']) {
      expect(M.animationNames, clip).toContain(clip);
    }
    // cut in the 2026-09-24 review: staff holders idle like everyone else, the stretch read badly
    expect(M.animationNames).not.toContain('Idle_Staff');
    expect(M.animationNames).not.toContain('Idle_Stretch');
  });

  it('ships every clip at its authored length: the gaits are authored at game speed', () => {
    for (const fit of ['male', 'female'] as const) {
      const lib = LIBRARY[fit];
      const d = (name: string) => clipDuration(lib, name);
      // the 0.47 s mantle inside the sim's 0.46 s climb
      expect(d('Climb'), fit).toBeCloseTo(0.4667, 2);
      expect(d('Swim'), fit).toBeCloseTo(1.4, 2);
      // Walk 2.2, Run 7 and Walk_Back 4.55 yd/s natural speed (the walkRef/runRef/walkBackRef
      // the defs carry), so the build retimes nothing. The side runs are the Run turned onto the
      // side heading (2026-09-29): the same 7 yd/s cycle (strafeRef defaults to runRef), and the
      // backpedal is a 34-frame jog at 4.55 yd/s.
      expect(d('Run'), fit).toBeCloseTo(0.6667, 2);
      expect(d('Strafe_Left'), fit).toBeCloseTo(d('Run'), 3);
      expect(d('Strafe_Right'), fit).toBeCloseTo(d('Run'), 3);
      expect(d('Walk'), fit).toBeCloseTo(0.8333, 2);
      expect(d('Walk_Back'), fit).toBeCloseTo(0.5667, 2);
      expect(d('Idle'), fit).toBeCloseTo(4.0, 2);
      // the takeoff one-shot; the game clamps its airborne pose until Land fires
      expect(d('Jump'), fit).toBeCloseTo(0.5, 2);
      expect(d('1H_Chop'), fit).toBeCloseTo(1.0, 2);
      // the dual-wield set: two 24-frame strikes, the X-slash, the thrust, the flinch
      expect(d('Dual_Chop'), fit).toBeCloseTo(0.8, 3);
      expect(d('Dual_Cross'), fit).toBeCloseTo(0.6, 3);
      expect(d('Dual_Stab'), fit).toBeCloseTo(0.5, 3);
      expect(d('Hit_Dual'), fit).toBeCloseTo(d('Hit'), 3);
      // every single-weapon variant keeps its one-hand original's length
      for (const [base, variant] of [
        ['Combat_Idle', 'Combat_Idle_Single'],
        ['1H_Chop', '1H_Chop_Single'],
        ['1H_Slash', '1H_Slash_Single'],
        ['Hit', 'Hit_Single'],
      ]) {
        expect(d(variant), `${fit} ${variant}`).toBeCloseTo(d(base), 3);
      }
    }
  });

  it('carries the weapon-scale compensation on both handslot bones, with no scale track', () => {
    // The body normalizes to the same height as the KayKit rigs from a much smaller native
    // height, so the slot scale cancels the ratio (measured idle heights,
    // build_woc_warrior.mjs); a scale channel would overwrite it.
    const slot = { male: 0.4606, female: 0.4668 } as const;
    for (const fit of ['male', 'female'] as const) {
      for (const json of [BASE[fit], LIBRARY[fit]]) {
        for (const side of ['l', 'r']) {
          const node = json.nodes.find((n) => n.name === `handslot.${side}`);
          expect(node?.scale?.[0], `${fit} ${side}`).toBeCloseTo(slot[fit], 3);
        }
      }
      const lib = LIBRARY[fit];
      for (const side of ['l', 'r']) {
        const index = lib.nodes.findIndex((n) => n.name === `handslot.${side}`);
        for (const anim of lib.animations ?? []) {
          const scaleTracks = anim.channels.filter(
            (c) => c.target.node === index && c.target.path === 'scale',
          );
          expect(scaleTracks, `${fit} ${anim.name} handslot.${side}`).toEqual([]);
        }
      }
    }
  });

  it('ships every set at every tier with exactly its own pieces, one atlas per map kind', () => {
    for (const [key, manifest] of WOC_DEFS) {
      for (const set of wocManifestSets(manifest)) {
        for (const tier of MESH_TIERS) {
          const url = wocArmorPackUrl(manifest.fit, set, tier);
          const file = publicFile(url);
          const json = glbJsonChunk(file) as unknown as GlbJson;
          const nodes = nodeNamesOf(json);
          for (const item of Object.values(manifest.items)) {
            for (const node of item.nodes) expect(nodes.has(node), `${url} ${node}`).toBe(true);
          }
          // nothing of the body, and no clip: those ride the base and the library
          expect(
            [...nodes].filter((n) => n.startsWith('Character_')),
            url,
          ).toEqual([]);
          expect(json.animations ?? [], url).toEqual([]);
          // one texture set per armor set (armor_atlas.mjs): at most one atlas per map kind,
          // each exactly one of the layout's atlas sizes (the medium file's at half the full
          // layout: its top level ships in the top file); the low tier is color (and glow) only
          const sizes = atlasSizes(tier);
          const images = json.images ?? [];
          expect(images.length, url).toBeGreaterThan(0);
          expect(images.length, url).toBeLessThanOrEqual(sizes.length);
          for (let i = 0; i < images.length; i++) {
            expect(images[i].mimeType, url).toBe('image/ktx2');
            const [w, h] = ktx2Size(file, json, i);
            expect(
              sizes.some(([sw, sh]) => sw === w && sh === h),
              `${url} image ${i} is ${w}x${h}`,
            ).toBe(true);
          }
          if (tier === 'low') {
            for (const mat of json.materials ?? []) {
              expect(mat.normalTexture, url).toBeUndefined();
              expect(mat.occlusionTexture, url).toBeUndefined();
              expect(mat.pbrMetallicRoughness?.metallicRoughnessTexture, url).toBeUndefined();
            }
          }
        }
      }
      expect(Object.keys(manifest.items), key).toHaveLength(6);
    }
  });

  it("ships each set's top levels: one per medium map, by name and by slot, at the full size", () => {
    /** The image (by name) each slot draws, over every material of a file. */
    const slots = (json: GlbJson): Record<string, string[]> => {
      const nameOf = (index: number | undefined): string => {
        const texture = index === undefined ? undefined : json.textures?.[index];
        const image = texture?.extensions?.KHR_texture_basisu?.source ?? texture?.source;
        return json.images?.[image ?? -1]?.name ?? '';
      };
      const out: Record<string, Set<string>> = {};
      for (const m of json.materials ?? []) {
        const refs: [string, { index: number } | undefined][] = [
          ['baseColor', m.pbrMetallicRoughness?.baseColorTexture],
          ['normal', m.normalTexture],
          ['metallicRoughness', m.pbrMetallicRoughness?.metallicRoughnessTexture],
          ['occlusion', m.occlusionTexture],
          ['emissive', m.emissiveTexture],
        ];
        for (const [slot, ref] of refs) {
          if (!ref) continue;
          out[slot] ??= new Set();
          out[slot].add(nameOf(ref.index));
        }
      }
      return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
    };
    for (const [key, manifest] of WOC_DEFS) {
      for (const set of wocManifestSets(manifest)) {
        const mediumUrl = wocArmorPackUrl(manifest.fit, set, 'medium');
        const topUrl = wocArmorPackUrl(manifest.fit, set, 'high');
        expect(topUrl, key).toBe(`${WOC_SPLIT_DIR}/armor/${manifest.fit}_${set}_top.glb`);
        const mediumFile = publicFile(mediumUrl);
        const topFile = publicFile(topUrl);
        const medium = glbJsonChunk(mediumFile) as unknown as GlbJson;
        const top = glbJsonChunk(topFile) as unknown as GlbJson;
        // nothing of the set but its maps' top levels: one degenerate mesh, one material
        expect(top.meshes ?? [], topUrl).toHaveLength(1);
        expect(top.materials ?? [], topUrl).toHaveLength(1);
        expect(top.skins ?? [], topUrl).toEqual([]);
        expect(top.animations ?? [], topUrl).toEqual([]);
        expect(
          [...nodeNamesOf(top)].filter((n) => n.startsWith('Armor_')),
          topUrl,
        ).toEqual([]);
        // every medium map has its top level under the same name, in the same slot
        const mediumSlots = slots(medium);
        for (const names of Object.values(mediumSlots)) expect(names, mediumUrl).toHaveLength(1);
        expect(slots(top), topUrl).toEqual(mediumSlots);
        const mediumImages = (medium.images ?? []).map((image) => image.name);
        const topImages = (top.images ?? []).map((image) => image.name);
        expect([...topImages].sort(), topUrl).toEqual([...mediumImages].sort());
        // ...one level at exactly the size the medium map halves from, over its whole chain
        mediumImages.forEach((name, i) => {
          const j = topImages.indexOf(name);
          const [w, h] = ktx2Size(mediumFile, medium, i);
          expect(ktx2Size(topFile, top, j), `${topUrl} ${name}`).toEqual([w * 2, h * 2]);
          expect(ktx2Levels(topFile, top, j), `${topUrl} ${name}`).toBe(1);
          expect(ktx2Levels(mediumFile, medium, i), `${mediumUrl} ${name}`).toBe(
            Math.floor(Math.log2(Math.max(w, h))) + 1,
          );
          expect(
            Object.values(ATLAS_SIZES.full).some(([fw, fh]) => fw === w * 2 && fh === h * 2),
            `${topUrl} ${name} is ${w * 2}x${h * 2}`,
          ).toBe(true);
        });
      }
    }
  });

  it('never lets the runtime merge fold two items, or the body, into one draw', () => {
    // rig_merge.ts folds same-material skinned parts into one SkinnedMesh named after the
    // first part; the painter resolves that merged name back to the canonical part, so a fold
    // is only safe INSIDE one manifest item (a pair of boots, a chest's front and back). The
    // runtime merges each armor file's parts by item (woc_armor_bind.ts, partitioned by
    // wocMergePartition), and every item keeps its own partition.
    for (const [key, manifest] of WOC_DEFS) {
      const partitions = new Set<string>();
      for (const item of Object.values(manifest.items)) {
        const own = new Set(item.nodes.map((n) => wocMergePartition(manifest, n)));
        expect(own.size, `${key} ${item.label}`).toBe(1);
        const [partition] = own;
        expect(partitions.has(partition), `${key} ${item.label}`).toBe(false);
        partitions.add(partition);
      }
      expect(wocMergePartition(manifest, 'Character_Body'), key).toBe('base');
    }
  });

  it('is the sanctioned encode: meshopt on every mesh file, KTX2 on every texture', () => {
    const files = [
      wocBaseUrl('male'),
      wocBaseUrl('female'),
      wocAnimsUrl('male'),
      wocAnimsUrl('female'),
    ];
    for (const tier of MESH_TIERS) files.push(wocArmorPackUrl('male', 'mage', tier));
    for (const url of files) {
      const json = glb(url);
      expect(json.extensionsRequired ?? [], url).toContain('EXT_meshopt_compression');
      for (const image of json.images ?? []) expect(image.mimeType, url).toBe('image/ktx2');
    }
    // the top file carries one degenerate triangle and nothing to compress: KTX2 only
    const top = glb(wocArmorPackUrl('male', 'mage', 'high'));
    expect(top.extensionsRequired ?? []).toEqual(['KHR_texture_basisu']);
    for (const image of top.images ?? []) expect(image.mimeType).toBe('image/ktx2');
    for (const fit of ['male', 'female'] as const) {
      expect(BASE[fit].extensionsRequired, fit).toContain('KHR_texture_basisu');
      expect(LIBRARY[fit].images ?? [], fit).toEqual([]);
    }
  });

  it('ships one map per base: the body atlas at 512', () => {
    for (const fit of ['male', 'female'] as const) {
      const url = wocBaseUrl(fit);
      const json = BASE[fit];
      expect(json.materials ?? [], url).toHaveLength(1);
      expect(json.images ?? [], url).toHaveLength(1);
      expect(ktx2Size(publicFile(url), json, 0), url).toEqual([512, 512]);
    }
  });
});

/** Tip speed peak of each strike, measured the way the Blender-side
 *  claude-animation-20260924/scripts/contact_times.py measures it: the frame (60 fps) at which
 *  the striking hand's blade tip (handslot +Y, 0.3 out) moves fastest inside the clip's strike
 *  window, less half a frame. */
async function measureContacts(fit: WocFit): Promise<Record<string, number[]>> {
  await MeshoptDecoder.ready;
  const buffer = new Uint8Array(publicFile(wocAnimsUrl(fit))).buffer;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
  const root = gltf.scene;
  const slot = {
    r: root.getObjectByName('handslotr') ?? root.getObjectByName('handslot.r'),
    l: root.getObjectByName('handslotl') ?? root.getObjectByName('handslot.l'),
  };
  const windows: Record<string, ['r' | 'l', number, number][]> = {
    '1H_Chop': [['r', 15, 40]],
    '1H_Chop_Single': [['r', 15, 40]],
    '1H_Slash': [['r', 15, 40]],
    '1H_Slash_Single': [['r', 15, 40]],
    '2H_Chop': [['r', 25, 55]],
    Dual_Chop: [
      ['r', 2, 16],
      ['l', 26, 40],
    ],
    Dual_Cross: [
      ['r', 3, 14],
      ['l', 3, 14],
    ],
    Dual_Stab: [['r', 3, 12]],
    Block: [['l', 18, 30]],
  };
  const mixer = new THREE.AnimationMixer(root);
  const out: Record<string, number[]> = {};
  const m = new THREE.Matrix4();
  const tip = (o: THREE.Object3D): THREE.Vector3 => {
    m.copy(o.matrixWorld);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    const y = new THREE.Vector3().setFromMatrixColumn(m, 1).normalize();
    return p.addScaledVector(y, 0.3);
  };
  for (const [name, wins] of Object.entries(windows)) {
    const clip = gltf.animations.find((c) => c.name === name);
    if (!clip) throw new Error(`${fit}: no clip ${name}`);
    const action = mixer.clipAction(clip);
    action.play();
    const frames = Math.round(clip.duration * 60);
    const tips = { r: [] as THREE.Vector3[], l: [] as THREE.Vector3[] };
    for (let f = 0; f <= frames; f++) {
      mixer.setTime(f / 60);
      root.updateMatrixWorld(true);
      for (const side of ['r', 'l'] as const) {
        const node = slot[side];
        if (!node) throw new Error(`${fit}: no handslot.${side}`);
        tips[side].push(tip(node));
      }
    }
    action.stop();
    out[name] = wins.map(([side, a, b]) => {
      let best = a;
      let bestSpeed = -1;
      for (let f = Math.max(1, a); f <= Math.min(frames, b); f++) {
        const speed = tips[side][f].distanceTo(tips[side][f - 1]);
        if (speed > bestSpeed) {
          bestSpeed = speed;
          best = f;
        }
      }
      return (best - 0.5) / 60;
    });
    mixer.uncacheAction(clip);
  }
  return out;
}

describe('blade contact timing (ClipMap.contacts, the hit presentation waits for the blade)', () => {
  for (const fit of ['male', 'female'] as const) {
    it(`${fit}: every listed contact is the shipped clip's own, within a frame`, async () => {
      const table = fit === 'female' ? WOC_CONTACTS_FEMALE : WOC_CONTACTS;
      const measured = await measureContacts(fit);
      for (const [clip, times] of Object.entries(measured)) {
        expect(table[clip]?.length, `${fit} ${clip}`).toBe(times.length);
        times.forEach((t, i) => {
          expect(
            Math.abs((table[clip]?.[i] ?? -1) - t),
            `${fit} ${clip}[${i}]`,
          ).toBeLessThanOrEqual(1 / 60 + 1e-6);
        });
      }
      // the split halves carry their half's own contact (the cut is the guard between them)
      const split = VISUALS.player_warrior.clips.dualWieldSplit ?? 0;
      expect(split).toBeCloseTo(clipDuration(LIBRARY[fit], 'Dual_Chop') / 2, 6);
      const [main, off] = table.Dual_Chop;
      expect(main).toBeLessThan(split);
      expect(off).toBeGreaterThan(split);
      expect(table['Dual_Chop#main']?.[0]).toBeCloseTo(main, 3);
      expect(table['Dual_Chop#off']?.[0]).toBeCloseTo(off - split, 3);
    });
  }

  it('gives each body its own table: the female defs carry the female contacts', () => {
    for (const [key, manifest] of WOC_DEFS) {
      expect(VISUALS[key].clips.contacts, key).toBe(
        manifest.fit === 'female' ? WOC_CONTACTS_FEMALE : WOC_CONTACTS,
      );
    }
  });
});

describe('WOC part selection (the handoff adapter apply rule)', () => {
  it('shows the body and the full default kit', () => {
    const shown = wocVisibleParts(M, wocDefaultAppearance(M), wocDefaultWorn(M));
    for (const name of wocBodyPartNames(M)) expect(shown.has(name), name).toBe(true);
    for (const item of Object.values(M.items)) {
      for (const node of item.nodes) expect(shown.has(node), node).toBe(true);
    }
  });

  it('shows the body alone with nothing worn: the anatomy the height normalization measures', () => {
    const bare = wocWornFromEquipment(M, {}, false);
    const shown = wocVisibleParts(M, wocDefaultAppearance(M), bare);
    expect([...shown]).toEqual(['Character_Body']);
    expect(wocAnatomyParts(M)).toEqual(shown);
    // no shipped body cuts a part of its own: the head is never a base part
    for (const [key, manifest] of WOC_DEFS) {
      expect(manifest.appearance, key).toEqual({});
      expect(manifest.defaultAppearance, key).toEqual({});
      expect([...wocAnatomyParts(manifest)], key).toEqual(['Character_Body']);
    }
  });

  it('never empties a required appearance slot, and hides the slots a worn piece names', () => {
    const asked = { crest: null, hair: null };
    const shown = wocVisibleParts(CUT, asked, wocDefaultWorn(CUT));
    expect(shown.has('Part_Crest_L')).toBe(true);
    expect(shown.has('Part_Crest_R')).toBe(true);
    // optional and unasked: empty
    expect(shown.has('Part_Plume')).toBe(false);
    // the default look draws it, the helm (hidesAppearance: hair) hides it, bare-headed shows it
    const dressed = wocVisibleParts(CUT, wocDefaultAppearance(CUT), wocDefaultWorn(CUT));
    expect(dressed.has('Part_Plume')).toBe(false);
    const bareHead = wocVisibleParts(CUT, wocDefaultAppearance(CUT), {
      ...wocDefaultWorn(CUT),
      head: null,
    });
    expect(bareHead.has('Part_Plume')).toBe(true);
    expect(wocBodyPartNames(CUT)).toEqual([
      'Character_Body',
      'Part_Crest_L',
      'Part_Crest_R',
      'Part_Plume',
    ]);
  });

  it('switches paired pieces together and ignores an item in the wrong slot', () => {
    const shown = wocVisibleParts(M, wocDefaultAppearance(M), {
      feet: 'original_boots',
      head: 'original_boots',
    });
    expect(shown.has('Armor_Original_Boot_L')).toBe(true);
    expect(shown.has('Armor_Original_Boot_R')).toBe(true);
    expect(shown.has('Armor_Original_Helm')).toBe(false);
  });

  it('can name every piece of every set its fit ships, so any set dresses any class of that fit', () => {
    const names = new Set(wocAllPartNames(M));
    for (const [, manifest] of WOC_DEFS) {
      if (manifest.fit !== 'male') continue;
      for (const item of Object.values(manifest.items)) {
        for (const node of item.nodes) expect(names.has(node), node).toBe(true);
      }
    }
  });
});

describe('game equipment to WOC asset mapping', () => {
  const equipped: Partial<Record<EquipSlot, string>> = {
    helmet: 'mistveil_cord',
    chest: 'worn_mail',
    mainhand: 'worn_sword',
  };

  it('dresses the mapped slots, leaves empty slots bare, and reserves legs and back', () => {
    const worn = wocWornFromEquipment(M, equipped, false);
    expect(worn).toEqual({
      head: 'original_helm',
      chest: 'original_chest',
      arms: null,
      hands: null,
      waist: null,
      feet: null,
      legs: null,
      back: null,
    });
    // the files that worn set draws from: the class's own set, nothing else
    expect(wocWornSets(M, worn)).toEqual(['warrior']);
    expect(wocWornSets(M, wocWornFromEquipment(M, {}, false))).toEqual([]);
  });

  it('empties only the head slot for the paperdoll eye', () => {
    const worn = wocWornFromEquipment(M, equipped, true);
    expect(worn.head).toBeNull();
    expect(worn.chest).toBe('original_chest');
  });

  it('falls back to the slot original for an equipped item with no mapping', () => {
    // A worn but unmapped helmet still reads as armored, never as bare.
    expect(wocArmorAssetFor(M, 'helmet', 'mistveil_cord')).toBe('original_helm');
    expect(wocArmorAssetFor(M, 'helmet', null)).toBeNull();
    expect(wocArmorAssetFor(M, 'legs', 'wyrmshadow_legguards')).toBeNull();
    expect(wocArmorAssetFor(M, 'neck', 'anything')).toBeNull();
  });

  it('maps the six dressable equip slots onto six distinct manifest items', () => {
    expect(WOC_DRESSABLE_EQUIP_SLOTS).toEqual([
      'helmet',
      'shoulder',
      'gloves',
      'chest',
      'waist',
      'feet',
    ]);
    const assets = new Set<string>();
    const expected = {
      helmet: ['original_helm', 'head'],
      shoulder: ['original_shoulders', 'arms'],
      gloves: ['original_gauntlets', 'hands'],
      chest: ['original_chest', 'chest'],
      waist: ['original_waist', 'waist'],
      feet: ['original_boots', 'feet'],
    } as const;
    for (const slot of WOC_DRESSABLE_EQUIP_SLOTS) {
      const item = Object.values(ITEMS).find((def) => def.kind === 'armor' && def.slot === slot);
      expect(item, slot).toBeDefined();
      const asset = wocArmorAssetFor(M, slot, item?.id);
      expect(asset, slot).not.toBeNull();
      if (!asset) continue;
      expect([asset, M.items[asset]?.slot], slot).toEqual(expected[slot as keyof typeof expected]);
      assets.add(asset);
    }
    expect(assets.size).toBe(Object.keys(M.items).length);
  });
});

describe('a WOC body never composes the KayKit library', () => {
  it('names every class, and each carries the manifest on its def', () => {
    expect([...WOC_BODY_CLASSES].sort()).toEqual([...ALL_CLASSES].sort());
    for (const cls of ALL_CLASSES) {
      const def = VISUALS[`player_${cls}`];
      expect(def.wocCharacter !== undefined, cls).toBe(WOC_BODY_CLASSES.has(cls));
      expect(classBodyComposes(cls)).toBe(!WOC_BODY_CLASSES.has(cls));
    }
  });
});

describe('the paladin: the male body in the paladin set', () => {
  const PAL = WOC_PALADIN_MANIFEST;
  const palNodes = nodeNamesOf(glb(wocArmorPackUrl('male', 'paladin', 'medium')));

  it('plays the same 51 clips as the warrior, from the same library', () => {
    expect(PAL.animationNames).toEqual(M.animationNames);
    expect(VISUALS.player_paladin.animUrls).toEqual(VISUALS.player_warrior.animUrls);
    expect(VISUALS.player_paladin.url).toBe(VISUALS.player_warrior.url);
  });

  it('carries every armor node the paladin manifest names, and none of the warrior armor', () => {
    for (const item of Object.values(PAL.items)) {
      for (const node of item.nodes) expect(palNodes.has(node), node).toBe(true);
    }
    for (const item of Object.values(M.items)) {
      for (const node of item.nodes) expect(palNodes.has(node), node).toBe(false);
    }
    expect(wocManifestSets(PAL)).toEqual(['paladin']);
  });

  it('swaps the body atlas only under the chest plate, and ships that atlas encoded', () => {
    expect(wocUnderArmorAtlas(PAL, wocWornFromEquipment(PAL, {}, false))).toBeNull();
    expect(
      wocUnderArmorAtlas(PAL, wocWornFromEquipment(PAL, { chest: 'recruit_tunic' }, false)),
    ).toBe(PAL.underArmorAtlas?.url);
    expect(wocUnderArmorAtlas(PAL, wocWornFromEquipment(PAL, { helmet: 'x' }, false))).toBeNull();
    expect(wocUnderArmorAtlas(M, wocWornFromEquipment(M, { chest: 'x' }, false))).toBeNull();
    // the url names the atlas the skin convention's way; what ships (and loads) is its KTX2
    // sibling, the PNG master stays in the character source export
    // (tests/skin_atlas_ktx2_compression.test.ts pins that no master ships)
    const png = path.resolve(__dirname, '..', 'public', PAL.underArmorAtlas?.url ?? '');
    expect(existsSync(png.replace(/\.png$/, '.ktx2'))).toBe(true);
  });
});

describe('the female body: the creation pick selects the second fit for the class', () => {
  const FEM = WOC_WARRIOR_FEMALE_MANIFEST;
  const femArmor = nodeNamesOf(glb(wocArmorPackUrl('female', 'warrior', 'medium')));

  it('ships every armor node the female warrior names, and none of the male warrior armor', () => {
    for (const item of Object.values(FEM.items)) {
      for (const node of item.nodes) expect(femArmor.has(node), node).toBe(true);
    }
    for (const item of Object.values(M.items)) {
      for (const node of item.nodes) expect(femArmor.has(node), node).toBe(false);
    }
  });

  it('is the female pick of a WOC class and nothing else', () => {
    expect(playerVisualKey('warrior', { gender: 'female' })).toBe('player_warrior_female');
    expect(playerVisualKey('warrior', { gender: 'male' })).toBe('player_warrior');
    expect(playerVisualKey('warrior', null)).toBe('player_warrior');
    expect(playerVisualKey('paladin', { gender: 'female' })).toBe('player_paladin_female');
    expect(playerVisualKey('mage', { gender: 'female' })).toBe('player_mage_female');
    expect(playerVisualKey('nope', { gender: 'female' })).toBe('player_warrior');
    const fem = VISUALS.player_warrior_female;
    expect(fem.wocCharacter).toBe(FEM);
    // the class def to the letter, bar its own blade contacts
    expect({ ...fem.clips, contacts: undefined }).toEqual({
      ...VISUALS.player_warrior.clips,
      contacts: undefined,
    });
    expect(fem.height).toBe(VISUALS.player_warrior.height);
    expect(fem.attach).toEqual(VISUALS.player_warrior.attach);
  });

  it('reads a split two-material piece and its merged mesh as one manifest node', () => {
    expect(wocNodeNameOf('Armor_Female_Warrior_Boot_L')).toBe('Armor_Female_Warrior_Boot_L');
    expect(wocNodeNameOf('Armor_Female_Warrior_Boot_L_2')).toBe('Armor_Female_Warrior_Boot_L');
    expect(wocNodeNameOf('Armor_Female_Warrior_Boot_L_1_bodymerged')).toBe(
      'Armor_Female_Warrior_Boot_L',
    );
    expect(wocNodeNameOf('Character_Body_bodymerged')).toBe('Character_Body');
  });

  it('never lets two toggleable parts share a merged mesh, whatever material they share', () => {
    const boots = wocMergePartition(FEM, 'Armor_Female_Warrior_Boot_L_2');
    expect(boots).toBe('item:female_warrior_boots');
    expect(wocMergePartition(FEM, 'Armor_Female_Warrior_Boot_R_2')).toBe(boots);
    expect(wocMergePartition(FEM, 'Armor_Female_Warrior_Gauntlet_L_2')).toBe(
      'item:female_warrior_gauntlets',
    );
    expect(wocMergePartition(FEM, 'Armor_Female_Warrior_Chest_Back')).toBe(
      wocMergePartition(FEM, 'Armor_Female_Warrior_Chest_Front'),
    );
    expect(wocMergePartition(FEM, 'Character_Body')).toBe('base');
    // a part cut into a base merges with its own appearance slot (the CUT fixture: no
    // shipped base carries one)
    expect(wocMergePartition(CUT, 'Part_Crest_R')).toBe('appearance:crest');
    expect(wocMergePartition(CUT, 'Part_Plume_bodymerged')).toBe('appearance:hair');
    expect(wocMergePartition(FEM, 'Something_Else')).toBe('node:Something_Else');
  });
});

describe('the female paladin: the female body in the female paladin set', () => {
  const FP = WOC_PALADIN_FEMALE_MANIFEST;
  const fpNodes = nodeNamesOf(glb(wocArmorPackUrl('female', 'paladin', 'medium')));

  it('ships every node its manifest names, none of the warrior armor, the helm single-material', () => {
    for (const item of Object.values(FP.items)) {
      for (const node of item.nodes) expect(fpNodes.has(node), node).toBe(true);
    }
    for (const item of Object.values(WOC_WARRIOR_FEMALE_MANIFEST.items)) {
      for (const node of item.nodes) expect(fpNodes.has(node), node).toBe(false);
    }
    // the revision's helm is the 498-triangle design, single material per piece
    expect(fpNodes.has('Armor_Female_Paladin_Boot_L_2')).toBe(false);
  });

  it('mirrors the paladin def, swaps the female under-layer under the chest, and partitions the shared lining', () => {
    const fem = VISUALS.player_paladin_female;
    expect(fem.wocCharacter).toBe(FP);
    expect({ ...fem.clips, contacts: undefined }).toEqual({
      ...VISUALS.player_paladin.clips,
      contacts: undefined,
    });
    expect(fem.attackTimeScale).toBe(VISUALS.player_paladin.attackTimeScale);
    expect(FP.underArmorAtlas).toEqual({
      slot: 'chest',
      url: 'textures/skins/woc/female_paladin_underarmor.png',
    });
    const png = path.resolve(__dirname, '..', 'public', FP.underArmorAtlas?.url ?? '');
    expect(existsSync(png.replace(/\.png$/, '.ktx2'))).toBe(true);
    expect(wocUnderArmorAtlas(FP, wocWornFromEquipment(FP, { chest: 'x' }, false))).toBe(
      FP.underArmorAtlas?.url,
    );
    expect(wocUnderArmorAtlas(FP, wocWornFromEquipment(FP, {}, false))).toBeNull();
    expect(wocMergePartition(FP, 'Armor_Female_Paladin_Boot_L_2')).not.toBe(
      wocMergePartition(FP, 'Armor_Female_Paladin_Gauntlet_L_2'),
    );
  });
});

describe('the seven class equipment sets (2026-09-18) on the shared bodies', () => {
  const SETS = ['hunter', 'rogue', 'mage', 'priest', 'warlock', 'druid', 'shaman'] as const;

  it.each(SETS)(
    '%s: both fits ride their base and library, with every minted node and the body atlas',
    (cls) => {
      for (const fit of ['male', 'female'] as const) {
        const key = fit === 'female' ? `player_${cls}_female` : `player_${cls}`;
        const def = VISUALS[key];
        expect(def.url, key).toBe(wocBaseUrl(fit));
        expect(def.animUrls, key).toEqual([wocAnimsUrl(fit), wocWowAnimsUrl(fit)]);
        const manifest = def.wocCharacter;
        expect(manifest, key).toBeDefined();
        if (!manifest) return;
        expect(manifest.fit, key).toBe(fit);
        expect(wocManifestSets(manifest), key).toEqual([cls]);
        const armor = nodeNamesOf(glb(wocArmorPackUrl(fit, cls, 'medium')));
        expect(Object.keys(manifest.items).length, key).toBe(6);
        for (const item of Object.values(manifest.items)) {
          expect(item.set, key).toBe(cls);
          for (const node of item.nodes) expect(armor.has(node), `${key} ${node}`).toBe(true);
        }
        const base = nodeNamesOf(BASE[fit]);
        for (const slot of Object.values(manifest.appearance)) {
          for (const v of Object.values(slot.variants)) {
            for (const node of v.nodes) expect(base.has(node), `${key} ${node}`).toBe(true);
          }
        }
        // Chest-gated body atlas, shipped with its KTX2 sibling.
        const atlas = manifest.underArmorAtlas;
        expect(atlas?.slot, key).toBe('chest');
        expect(atlas?.url, key).toBe(
          `textures/skins/woc/${fit === 'female' ? 'female_' : ''}${cls}_underarmor.png`,
        );
        const png = path.resolve(__dirname, '..', 'public', atlas?.url ?? '');
        expect(existsSync(png.replace(/\.png$/, '.ktx2')), key).toBe(true);
        // Item ids follow the artist's fragments: <fit>_<class>_<piece>.
        for (const id of Object.keys(manifest.items))
          expect(id.startsWith(`${fit}_${cls}_`), id).toBe(true);
        expect(manifest.defaultEquipment.head, key).toBe(
          `${fit}_${cls}_${cls === 'druid' || cls === 'shaman' ? 'helm' : 'hood'}`,
        );
      }
    },
  );

  it('gives every set the warrior owner rules: 1x strikes, silent shouts, the climb and swim lanes', () => {
    for (const cls of SETS) {
      for (const key of [`player_${cls}`, `player_${cls}_female`]) {
        const def = VISUALS[key];
        expect(def.attackTimeScale, key).toBe(1);
        expect(def.hideWeaponsWhileSwimming, key).toBe(true);
        expect(def.swimRise, key).toEqual({ stroke: -0.65, tread: -1.0 });
        expect(def.clips.shoutEmote, key).toBeNull();
        expect(def.clips.climb, key).toBe('Climb');
        expect(def.clips.swim, key).toBe('WoW_a_swimN');
        expect(def.height, key).toBe(VISUALS.player_warrior.height);
      }
      expect({ ...VISUALS[`player_${cls}_female`].clips, contacts: undefined }).toEqual({
        ...VISUALS[`player_${cls}`].clips,
        contacts: undefined,
      });
      expect(playerVisualKey(cls, { gender: 'female' })).toBe(`player_${cls}_female`);
      expect(playerVisualKey(cls, { gender: 'male' })).toBe(`player_${cls}`);
    }
  });

  it('casters raise and hold, release bolts through the throw, and channel the loop', () => {
    for (const cls of ['mage', 'priest', 'warlock', 'druid', 'shaman'] as const) {
      const clips = VISUALS[`player_${cls}`].clips;
      expect(clips.cast, cls).toBe('Cast_Raise');
      expect(clips.castHoldPointSeconds, cls).toBe(1.0);
      expect(clips.castPlayOut, cls).toEqual(['Cast_Raise']);
      for (const clip of Object.values(clips.attackByAbility ?? {})) {
        expect(['Cast_Shoot', '1H_Chop', '1H_Slash', '2H_Chop'], cls).toContain(clip);
      }
      for (const clip of Object.values(clips.castByAbility ?? {}))
        expect(clip, cls).toBe('Cast_Loop');
    }
    // The hunter aims from the shot clip's raise and releases its tail.
    const hunter = VISUALS.player_hunter.clips;
    expect(hunter.clipSplits).toEqual([
      { clip: 'Ranged_Shoot', at: 0.17, names: ['Ranged_Shoot#aim', 'Ranged_Shoot#release'] },
    ]);
    expect(hunter.cast).toBe('Ranged_Shoot#aim');
    expect(hunter.castHoldPointSeconds).toBeLessThan(0.17);
    expect(hunter.attackByAbility?.aimed_shot).toBe('Ranged_Shoot#release');
    expect(hunter.attack).toEqual(['Ranged_Shoot']);
    expect(VISUALS.player_hunter.weaponSlots).toBeUndefined();
    // Dual wielders split the two-strike clip like the warrior.
    expect(VISUALS.player_rogue.clips.dualWieldSplit).toBe(
      VISUALS.player_warrior.clips.dualWieldSplit,
    );
    expect(VISUALS.player_shaman.clips.dualWieldSplit).toBe(
      VISUALS.player_warrior.clips.dualWieldSplit,
    );
  });
});
