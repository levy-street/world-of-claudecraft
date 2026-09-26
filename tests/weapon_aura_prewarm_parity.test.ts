// Every weapon-aura program CharacterVisual.rebuildWeaponAura can draw must be
// linked at boot by a never-disposed stand-in of its own, on every tier.
//
// The aura is minted per rebuild (imbue applied, weapon attached, sheathe
// swap) and disposed first on the next one, so nothing else holds its program
// between two rebuilds. Adder's Bite's green tip (an RGBA vertex-alpha ramp,
// vertexColors on) held a program no other material shared: it linked live on
// the first coat and relinked after every glow was gone. The full-blade
// imbues and the Stonebound shell and shards only survived through a key
// another module happened to share.
//
// The walk is the real one: every aura channel the renderer drives (each
// ability spec carrying buff.weaponAura, projected by characterWeaponAuraInto
// as the renderer does, plus the Stonebound mode from characterWeaponAuraMode)
// on every mainhand weapon geometry a player can hold (each reachable GLB's
// declared attribute set, read from the file), through
// CharacterVisual.setWeaponAura / setWeaponAuraMode, on ultra and on Low.
// Each drawn aura's drawProgramSignature and each of three's own program keys
// (one per pass) must be carried by a `cast-vfx-basic:weapon-*` stand-in, so
// the coverage never rests on an unrelated stand-in that happens to share it.
// What keeps a program alive at run time is the material the boot entry
// COMPILES: the collector dedupes by signature in walk order, so the full-blade
// imbue is linked through the corpse beacon's stand-in (same signature, earlier
// in the group) and its own stand-in is a same-signature twin. The teardown
// case below emulates three's program refcount over that compiled set.

import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { collectAbilityVfxCompileTargets } from '../src/render/ability_vfx';
import { ABILITY_VFX_FULL_SPECS } from '../src/render/ability_vfx_full_specs';
import { characterWeaponAuraInto, characterWeaponAuraMode } from '../src/render/character_effects';
import {
  itemWeaponModelUrls,
  VISUALS,
  weaponSkinModelUrls,
} from '../src/render/characters/manifest';
import { SanguineWeaponSheath } from '../src/render/characters/sanguine_weapon_sheath';
import { CharacterVisual } from '../src/render/characters/visual';
import { drawProgramSignature } from '../src/render/draw_program_signature_core';
import { buildCastVfxBasicStandIns } from '../src/render/vfx_basic_materials';
import type { Entity } from '../src/sim/types';
import { activateTier, gfxProfileRestorer } from './helpers/gfx_tier';
import { drawsUnder, threeProgramKeys } from './helpers/three_program_keys';

const publicDir = path.resolve(__dirname, '../public');

afterAll(gfxProfileRestorer());

// --- The mainhand geometries a player can hold -----------------------------

/** Every GLB that can land in a mainhand holder (the swap-slot and ranged
 *  attaches a class def declares, every item weapon model, every weapon-skin
 *  model). Offhand-only models (shields, tomes) never carry an imbue: the
 *  aura coats the mainhand holder, and the Sanguine second-hand coat is never
 *  driven by the renderer. */
function mainhandModelUrls(): string[] {
  const urls = new Set<string>([...itemWeaponModelUrls(), ...weaponSkinModelUrls()]);
  for (const def of Object.values(VISUALS))
    for (const attach of def.attach ?? []) urls.add(attach.url);
  return [...urls].sort();
}

interface GltfPrimitive {
  attributes: Record<string, number>;
  targets?: Array<Record<string, number>>;
}
interface GltfJson {
  meshes?: Array<{ primitives: GltfPrimitive[] }>;
  accessors: Array<{ type: string }>;
}

function readGlbJson(file: string): GltfJson {
  const fd = openSync(file, 'r');
  try {
    const header = Buffer.alloc(20);
    readSync(fd, header, 0, 20, 0);
    expect(header.toString('utf8', 0, 4)).toBe('glTF');
    expect(header.readUInt32LE(16)).toBe(0x4e4f534a);
    const length = header.readUInt32LE(12);
    const json = Buffer.alloc(length);
    readSync(fd, json, 0, length, 20);
    return JSON.parse(json.toString('utf8').replace(/\0+$/, '').trimEnd()) as GltfJson;
  } finally {
    closeSync(fd);
  }
}

/** GLTFLoader's attribute naming (its ATTRIBUTES table). */
const THREE_ATTRIBUTE: Record<string, string> = {
  POSITION: 'position',
  NORMAL: 'normal',
  TANGENT: 'tangent',
  TEXCOORD_0: 'uv',
  TEXCOORD_1: 'uv1',
  TEXCOORD_2: 'uv2',
  TEXCOORD_3: 'uv3',
  COLOR_0: 'color',
  WEIGHTS_0: 'skinWeight',
  JOINTS_0: 'skinIndex',
};
const ITEM_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const MORPH_ATTRIBUTE: Record<string, string> = {
  POSITION: 'position',
  NORMAL: 'normal',
  COLOR_0: 'color',
};

interface GeometryShape {
  attributes: Array<[name: string, itemSize: number]>;
  morphs: Array<[name: string, count: number]>;
}

function shapeKey(shape: GeometryShape): string {
  return JSON.stringify(shape);
}

/** The distinct attribute sets of every reachable mainhand primitive, with the
 *  models that carry each. */
function mainhandGeometryShapes(): Map<string, { shape: GeometryShape; models: string[] }> {
  const shapes = new Map<string, { shape: GeometryShape; models: string[] }>();
  for (const url of mainhandModelUrls()) {
    const file = path.join(publicDir, url);
    expect(existsSync(file), `${url} ships`).toBe(true);
    const json = readGlbJson(file);
    for (const mesh of json.meshes ?? []) {
      for (const primitive of mesh.primitives) {
        const attributes = Object.entries(primitive.attributes)
          .map(([semantic, accessor]): [string, number] => {
            const name = THREE_ATTRIBUTE[semantic];
            expect(name, `${url}: known attribute ${semantic}`).toBeDefined();
            return [name, ITEM_SIZE[json.accessors[accessor].type]];
          })
          .sort(([a], [b]) => a.localeCompare(b));
        const morphCounts = new Map<string, number>();
        for (const target of primitive.targets ?? []) {
          for (const semantic of Object.keys(target)) {
            const name = MORPH_ATTRIBUTE[semantic];
            if (name) morphCounts.set(name, (morphCounts.get(name) ?? 0) + 1);
          }
        }
        const morphs = [...morphCounts].sort(([a], [b]) => a.localeCompare(b));
        const shape: GeometryShape = { attributes, morphs };
        const key = shapeKey(shape);
        const entry = shapes.get(key) ?? { shape, models: [] };
        entry.models.push(url);
        shapes.set(key, entry);
      }
    }
  }
  return shapes;
}

/** A weapon mesh whose geometry carries exactly `shape`'s attributes. The
 *  positions span a blade along y, so the tip ramp really applies. */
function weaponMesh(shape: GeometryShape): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  const vertexCount = 4;
  for (const [name, itemSize] of shape.attributes) {
    const array = new Float32Array(vertexCount * itemSize);
    if (name === 'position') array.set([0, 0, 0, 0.1, 0.4, 0, -0.1, 0.8, 0.02, 0, 1.2, 0]);
    geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }
  for (const [name, count] of shape.morphs) {
    const itemSize = name === 'color' ? 4 : 3;
    (geometry.morphAttributes as Record<string, THREE.BufferAttribute[]>)[name] = Array.from(
      { length: count },
      () => new THREE.BufferAttribute(new Float32Array(vertexCount * itemSize), itemSize),
    );
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.userData.weaponMesh = true;
  return mesh;
}

// --- The aura channels the renderer drives -----------------------------------

function entityWith(auraIds: readonly string[]): Entity {
  return { auras: auraIds.map((id) => ({ id })), dead: false } as unknown as Entity;
}

/** Every imbue colour channel (one per spec carrying buff.weaponAura), alone
 *  and under the Stonebound structural channel, plus Stonebound alone. */
function auraChannels(): Array<{ label: string; auras: string[] }> {
  const imbues = Object.entries(ABILITY_VFX_FULL_SPECS)
    .filter(([, spec]) => spec.buff?.weaponAura !== undefined)
    .map(([id]) => id)
    .sort();
  const structural = ['rockbiter_weapon', 'shaman_stonebound_armor'];
  const channels: Array<{ label: string; auras: string[] }> = [];
  for (const id of imbues) channels.push({ label: id, auras: [id] });
  for (const id of structural) channels.push({ label: id, auras: [id] });
  for (const id of imbues)
    channels.push({ label: `${id}+rockbiter_weapon`, auras: [id, 'rockbiter_weapon'] });
  return channels;
}

/** The real CharacterVisual methods over a bare rig: one mainhand holder
 *  carrying `mesh`, and the pose wrap the Stonebound shards hang from. */
function auraFixture(mesh: THREE.Mesh) {
  const holder = new THREE.Group();
  holder.userData = { heldPropHolder: true, heldSlot: 0, swapWeaponHolder: true };
  holder.add(mesh);
  const model = new THREE.Group();
  model.add(holder);
  const poseWrap = new THREE.Group();
  const state = {
    model,
    poseWrap,
    height: 2.2,
    weaponItemId: 'wyrmfang_greatblade',
    offhandItemId: null,
    weaponAuraColor: null as number | null,
    weaponAuraTip: false,
    weaponAuraSanguine: false,
    weaponAuraMode: 'none',
    weaponAuraMeshes: [] as THREE.Mesh[],
    sanguineSheath: new SanguineWeaponSheath(),
  };
  const visual = Object.assign(Object.create(CharacterVisual.prototype), state) as CharacterVisual;
  return { visual, state };
}

/** Drive one channel exactly as Renderer's per-frame sync does. */
function driveChannel(visual: CharacterVisual, auras: readonly string[]): void {
  const entity = entityWith(auras);
  const aura = characterWeaponAuraInto(entity, { color: 0, tip: false });
  visual.setWeaponAura(aura ? aura.color : null, aura?.tip ?? false);
  visual.setWeaponAuraMode(characterWeaponAuraMode(entity));
}

interface LiveDraw {
  label: string;
  object: THREE.Object3D;
  material: THREE.Material;
}

function liveAuraDraws(): LiveDraw[] {
  const draws: LiveDraw[] = [];
  for (const { shape, models } of mainhandGeometryShapes().values()) {
    for (const channel of auraChannels()) {
      const { visual, state } = auraFixture(weaponMesh(shape));
      driveChannel(visual, channel.auras);
      for (const mesh of state.weaponAuraMeshes) {
        draws.push({
          label: `${channel.label} on ${models[0]} (${models.length} models)`,
          object: mesh,
          material: mesh.material as THREE.Material,
        });
      }
    }
  }
  return draws;
}

// --- The stand-ins --------------------------------------------------------

function weaponStandIns(): THREE.Mesh[] {
  const group = buildCastVfxBasicStandIns();
  return (group.children as THREE.Mesh[]).filter((mesh) =>
    mesh.name.startsWith('cast-vfx-basic:weapon-'),
  );
}

function coverageOf(meshes: readonly THREE.Mesh[]) {
  const signatures = new Set<string>();
  const keys = new Set<string>();
  for (const mesh of meshes) {
    for (const draw of drawsUnder(mesh)) {
      signatures.add(drawProgramSignature(draw.object, draw.material));
      for (const key of threeProgramKeys(draw.material, draw.object).split('\n')) keys.add(key);
    }
  }
  return { signatures, keys };
}

describe('weapon-aura stand-ins carry every live aura program', () => {
  it('reads a real, non-empty mainhand model set', () => {
    const urls = mainhandModelUrls();
    expect(urls.length).toBeGreaterThan(50);
    expect(urls).toContain('models/weapons/dagger.glb');
    // Every held model ships under models/weapons today; one elsewhere is still walked.
    for (const url of urls) expect(url.endsWith('.glb'), url).toBe(true);
    expect(mainhandGeometryShapes().size).toBeGreaterThan(0);
  });

  for (const tier of ['ultra', 'low'] as const) {
    describe(`on ${tier}`, () => {
      it('walks every aura variant, the tip ramp and the Stonebound parts included', () => {
        activateTier(tier);
        const draws = liveAuraDraws();
        const materials = draws.map((draw) => draw.material as THREE.MeshBasicMaterial);
        // The walk really reaches each kind of aura mesh.
        expect(materials.some((m) => m.vertexColors && m.blending === THREE.AdditiveBlending)).toBe(
          true,
        );
        expect(
          materials.some((m) => !m.vertexColors && m.blending === THREE.AdditiveBlending),
        ).toBe(true);
        if (tier === 'ultra') {
          expect(materials.some((m) => m.wireframe && m.side === THREE.DoubleSide)).toBe(true);
          expect(materials.some((m) => m.wireframe && m.side === THREE.FrontSide)).toBe(true);
        } else {
          expect(materials.some((m) => !m.wireframe && m.side === THREE.DoubleSide)).toBe(true);
          expect(materials.some((m) => !m.wireframe && m.side === THREE.FrontSide)).toBe(true);
        }
        for (const draw of draws) {
          if ((draw.material as THREE.MeshBasicMaterial).vertexColors) {
            const color = (draw.object as THREE.Mesh).geometry.getAttribute('color');
            expect(color?.itemSize, `${draw.label}: RGBA tip ramp`).toBe(4);
          }
        }
      });

      it('has every live signature and three program key in a weapon stand-in', () => {
        activateTier(tier);
        const coverage = coverageOf(weaponStandIns());
        const draws = liveAuraDraws();
        expect(draws.length).toBeGreaterThan(0);
        for (const draw of draws) {
          expect(
            coverage.signatures.has(drawProgramSignature(draw.object, draw.material)),
            `${draw.label}: signature`,
          ).toBe(true);
          for (const key of threeProgramKeys(draw.material, draw.object).split('\n')) {
            expect(coverage.keys.has(key), `${draw.label}: program`).toBe(true);
          }
        }
      });

      it('keeps one stand-in per distinct live signature, none unused', () => {
        activateTier(tier);
        const live = new Set(
          liveAuraDraws().map((draw) => drawProgramSignature(draw.object, draw.material)),
        );
        const standIns = weaponStandIns().map((mesh) =>
          drawProgramSignature(mesh, mesh.material as THREE.Material),
        );
        if (tier === 'ultra') expect(new Set(standIns).size).toBe(standIns.length);
        expect(new Set(standIns)).toEqual(live);
      });
    });
  }

  it.each(['ultra', 'low'] as const)('%s: every aura program outlives teardowns', (tier) => {
    activateTier(tier);
    // The boot entry compiles one representative per signature
    // (collectAbilityVfxCompileTargets over the scene the group joins at renderer
    // construction). Each compiled material holds its programs; three drops a
    // program when its last holder is disposed (WebGLPrograms.releaseProgram).
    const scene = new THREE.Scene();
    scene.add(buildCastVfxBasicStandIns());
    const compiled = [
      ...new Set(
        collectAbilityVfxCompileTargets(scene).flatMap((target) => {
          const material = (target.object as THREE.Mesh).material as
            | THREE.Material
            | THREE.Material[]
            | undefined;
          if (!material) return [];
          return Array.isArray(material) ? material : [material];
        }),
      ),
    ];
    const holders = new Map<string, number>();
    const acquire = (material: THREE.Material, object: THREE.Object3D) => {
      const keys = threeProgramKeys(material, object).split('\n');
      for (const key of keys) holders.set(key, (holders.get(key) ?? 0) + 1);
      return keys;
    };
    const compiledDisposals = compiled.map((material) => vi.spyOn(material, 'dispose'));
    scene.traverse((object) => {
      const material = (object as THREE.Mesh).material as THREE.Material | undefined;
      if (material && compiled.includes(material)) acquire(material, object);
    });
    const dropped: string[] = [];
    let auras = 0;
    for (const { shape } of mainhandGeometryShapes().values()) {
      const { visual, state } = auraFixture(weaponMesh(shape));
      for (const channel of auraChannels()) {
        // A rebuild disposes the previous aura first, then mints the next.
        driveChannel(visual, channel.auras);
        for (const mesh of state.weaponAuraMeshes) {
          const material = mesh.material as THREE.Material;
          if (material.userData.held) continue;
          material.userData.held = true;
          auras++;
          const keys = acquire(material, mesh);
          material.addEventListener('dispose', () => {
            for (const key of keys) {
              const left = (holders.get(key) ?? 0) - 1;
              holders.set(key, left);
              if (left === 0) dropped.push(key);
            }
          });
        }
      }
      driveChannel(visual, []);
      expect(state.weaponAuraMeshes).toHaveLength(0);
    }
    expect(auras).toBeGreaterThan(0);
    expect(dropped).toEqual([]);
    for (const dispose of compiledDisposals) expect(dispose).not.toHaveBeenCalled();
  });

  it('is collected with the pooled cast VFX, so the boot entry links it for every class', () => {
    const scene = new THREE.Scene();
    const group = buildCastVfxBasicStandIns();
    scene.add(group);
    const collected = new Set(
      collectAbilityVfxCompileTargets(scene).map((target) =>
        drawProgramSignature(
          target.object,
          (target.object as THREE.Mesh).material as THREE.Material,
        ),
      ),
    );
    const standIns = weaponStandIns();
    expect(standIns.length).toBeGreaterThan(0);
    for (const mesh of standIns) {
      expect(mesh.visible).toBe(false);
      expect(mesh.userData.renderCategory).toBe('vfx');
      expect(collected.has(drawProgramSignature(mesh, mesh.material as THREE.Material))).toBe(true);
    }
  });
});
