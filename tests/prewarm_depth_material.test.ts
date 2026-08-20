import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  prewarmDepthMaterial,
  prewarmDepthMaterialKey,
  prewarmDepthMaterialsOf,
  prewarmDepthShadowSide,
  prewarmDepthShapeKey,
} from '../src/render/prewarm_depth_material';

// The prewarm depth material must link the SAME program three's shadow pass
// draws. The contract is pinned two ways: against three's own WebGLShadowMap
// source (a three bump that changes its depth material reds here, instead of
// silently turning every prewarmed shadow program into a dead variant, which is
// exactly what the 0.165 -> 0.185 bump did to the RGBADepthPacking override:
// production booked 1196 / 662 / 211 / 129 ms single frames on character shadow
// programs), and against the factory's output.
const shadowMapSource = readFileSync(
  new URL('../node_modules/three/src/renderers/webgl/WebGLShadowMap.js', import.meta.url),
  'utf8',
);

function skinnedCaster(morphs = 0): THREE.SkinnedMesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  if (morphs > 0) {
    geometry.morphAttributes.position = Array.from(
      { length: morphs },
      () =>
        new THREE.Float32BufferAttribute(
          new Float32Array(geometry.attributes.position.count * 3),
          3,
        ),
    );
  }
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  mesh.castShadow = true;
  return mesh;
}

describe("prewarm depth material: same program as three's shadow pass", () => {
  it('three 0.185 WebGLShadowMap draws the DEFAULT depthPacking (source pin)', () => {
    // The shared shadow depth material is constructed with no options...
    expect(shadowMapSource).toContain('_depthMaterial = new MeshDepthMaterial()');
    // ...and getDepthMaterial never assigns depthPacking onto it.
    expect(shadowMapSource).not.toContain('depthPacking');
    // Shadows sample a native depth texture; nothing unpacks RGBA any more.
    const shadowChunk = readFileSync(
      new URL(
        '../node_modules/three/src/renderers/shaders/ShaderChunk/shadowmap_pars_fragment.glsl.js',
        import.meta.url,
      ),
      'utf8',
    );
    expect(shadowChunk).toContain('sampler2DShadow');
    expect(shadowChunk).not.toContain('unpackRGBAToDepth');
  });

  it('the RUNTIME bundle (the patched build) draws the same default packing (source pin)', () => {
    // The app runs three/build/three.module.js, which this repo patches; pin
    // the built getDepthMaterial body too, not only the src/ file.
    const built = readFileSync(
      new URL('../node_modules/three/build/three.module.js', import.meta.url),
      'utf8',
    );
    expect(built).toContain('_depthMaterial = new MeshDepthMaterial()');
    const start = built.indexOf('function getDepthMaterial(');
    const end = built.indexOf('function getDistanceMaterial', start);
    expect(start).toBeGreaterThan(-1);
    const body = end > start ? built.slice(start, end) : built.slice(start, start + 6000);
    expect(body).toContain('result.alphaTest');
    expect(body).not.toContain('depthPacking');
  });

  it("three 0.185 folds these object-derived parameters into a program's key (source pin)", () => {
    // The shape key models exactly these WebGLPrograms.getParameters reads. A
    // three bump that renames or adds one reds here, so the "one awaited
    // material per depth program" contract is re-derived rather than left
    // silently incomplete.
    const programs = readFileSync(
      new URL('../node_modules/three/src/renderers/webgl/WebGLPrograms.js', import.meta.url),
      'utf8',
    );
    for (const line of [
      'skinning: object.isSkinnedMesh === true',
      'instancing: IS_INSTANCEDMESH',
      'instancingColor: IS_INSTANCEDMESH && object.instanceColor !== null',
      'instancingMorph: IS_INSTANCEDMESH && object.morphTexture !== null',
      'batching: IS_BATCHEDMESH',
      'batchingColor: IS_BATCHEDMESH && object._colorsTexture !== null',
      'morphTargets: geometry.morphAttributes.position !== undefined',
      'morphNormals: geometry.morphAttributes.normal !== undefined',
      'morphColors: geometry.morphAttributes.color !== undefined',
      'morphTargetsCount: morphTargetsCount',
      'geometry.morphAttributes.position || geometry.morphAttributes.normal || geometry.morphAttributes.color',
      'depthPacking: material.depthPacking || 0',
      'mapUv: HAS_MAP && getChannel( material.map.channel )',
      'alphaMapUv: HAS_ALPHAMAP && getChannel( material.alphaMap.channel )',
      'displacementMapUv: HAS_DISPLACEMENTMAP && getChannel( material.displacementMap.channel )',
      'vertexNormals: !! geometry.attributes.normal',
    ]) {
      expect(programs, line).toContain(line);
    }
  });

  it("the factory leaves depthPacking at three's default (BasicDepthPacking), never RGBA", () => {
    const depth = prewarmDepthMaterial(
      new Map(),
      new THREE.MeshStandardMaterial(),
      skinnedCaster(),
    );
    expect(depth.depthPacking).toBe(new THREE.MeshDepthMaterial().depthPacking);
    expect(depth.depthPacking).toBe(THREE.BasicDepthPacking);
    expect(depth.depthPacking).not.toBe(THREE.RGBADepthPacking);
  });

  it('mirrors getDepthMaterial: side flip, alphaTest 0.5 under alphaToCoverage, maps carried', () => {
    const map = new THREE.Texture();
    const alphaMap = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({ map, alphaMap, alphaTest: 0.3 });
    const depth = prewarmDepthMaterial(new Map(), source, skinnedCaster());
    expect(depth.side).toBe(THREE.BackSide);
    expect(depth.map).toBe(map);
    expect(depth.alphaMap).toBe(alphaMap);
    expect(depth.alphaTest).toBe(0.3);
    expect(prewarmDepthShadowSide(new THREE.MeshStandardMaterial({ side: THREE.BackSide }))).toBe(
      THREE.FrontSide,
    );
    expect(prewarmDepthShadowSide(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }))).toBe(
      THREE.DoubleSide,
    );
    const explicit = new THREE.MeshStandardMaterial();
    explicit.shadowSide = THREE.FrontSide;
    expect(prewarmDepthShadowSide(explicit)).toBe(THREE.FrontSide);
    const a2c = new THREE.MeshStandardMaterial({ alphaToCoverage: true });
    expect(prewarmDepthMaterial(new Map(), a2c, skinnedCaster()).alphaTest).toBe(0.5);
  });
});

describe('prewarm depth material: one instance per depth program', () => {
  it('casters that differ on skinning or morph target count get distinct materials', () => {
    const cache = new Map<string, THREE.MeshDepthMaterial>();
    const source = new THREE.MeshStandardMaterial();
    const rigid = new THREE.Mesh(new THREE.BoxGeometry(), source);
    const skinned = skinnedCaster(0);
    const morph4 = skinnedCaster(4);
    const morph9 = skinnedCaster(9);
    const set = new Set([
      prewarmDepthMaterial(cache, source, rigid),
      prewarmDepthMaterial(cache, source, skinned),
      prewarmDepthMaterial(cache, source, morph4),
      prewarmDepthMaterial(cache, source, morph9),
    ]);
    // Four distinct depth programs (three's key folds in skinning, morphTargets
    // and morphTargetsCount), so four awaited materials, not one.
    expect(set.size).toBe(4);
    expect(cache.size).toBe(4);
  });

  it('casters with the same shape and material inputs share one cached material', () => {
    const cache = new Map<string, THREE.MeshDepthMaterial>();
    const a = skinnedCaster(4);
    const b = skinnedCaster(4);
    // Two recoloured clones of one atlas material collapse onto one depth program.
    const first = prewarmDepthMaterial(cache, new THREE.MeshStandardMaterial(), a);
    const second = prewarmDepthMaterial(cache, new THREE.MeshStandardMaterial(), b);
    expect(second).toBe(first);
    expect(cache.size).toBe(1);
  });

  it('every material-side input splits the key on its own (per-dimension negatives)', () => {
    const mesh = skinnedCaster(2);
    const base = new THREE.MeshStandardMaterial();
    const baseKey = prewarmDepthMaterialKey(base, mesh);
    const variants: Record<string, THREE.Material> = {
      side: new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }),
      map: new THREE.MeshStandardMaterial({ map: new THREE.Texture() }),
      alphaMap: new THREE.MeshStandardMaterial({ alphaMap: new THREE.Texture() }),
      alphaTest: new THREE.MeshStandardMaterial({ alphaTest: 0.5 }),
      alphaToCoverage: new THREE.MeshStandardMaterial({ alphaToCoverage: true }),
      displacementMap: new THREE.MeshStandardMaterial({ displacementMap: new THREE.Texture() }),
      wireframe: new THREE.MeshStandardMaterial({ wireframe: true }),
    };
    for (const [name, material] of Object.entries(variants)) {
      expect(prewarmDepthMaterialKey(material, mesh), name).not.toBe(baseKey);
    }
    // A texture's uv channel is part of three's program key (mapUv), so two
    // casters mapped on different channels need two depth programs.
    const channel0 = new THREE.Texture();
    const channel1 = new THREE.Texture();
    channel1.channel = 1;
    expect(
      prewarmDepthMaterialKey(new THREE.MeshStandardMaterial({ map: channel0 }), mesh),
    ).not.toBe(prewarmDepthMaterialKey(new THREE.MeshStandardMaterial({ map: channel1 }), mesh));
    // Same inputs, different texture OBJECTS: one key (the program is the same).
    expect(prewarmDepthMaterialKey(new THREE.MeshStandardMaterial({ map: channel0 }), mesh)).toBe(
      prewarmDepthMaterialKey(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), mesh),
    );
  });

  it('every mesh-side parameter splits the key on its own (per-dimension negatives)', () => {
    const source = new THREE.MeshStandardMaterial();
    const key = (mesh: THREE.Object3D) => prewarmDepthMaterialKey(source, mesh);
    const plain = new THREE.Mesh(new THREE.BoxGeometry(), source);
    // morph normals only vs morph positions only, same count
    const normalsOnly = new THREE.Mesh(new THREE.BoxGeometry(), source);
    normalsOnly.geometry.morphAttributes.normal = [
      new THREE.Float32BufferAttribute(new Float32Array(72), 3),
    ];
    const positionsOnly = new THREE.Mesh(new THREE.BoxGeometry(), source);
    positionsOnly.geometry.morphAttributes.position = [
      new THREE.Float32BufferAttribute(new Float32Array(72), 3),
    ];
    const colorsOnly = new THREE.Mesh(new THREE.BoxGeometry(), source);
    colorsOnly.geometry.morphAttributes.color = [
      new THREE.Float32BufferAttribute(new Float32Array(72), 3),
    ];
    expect(key(normalsOnly)).not.toBe(key(positionsOnly));
    expect(key(colorsOnly)).not.toBe(key(positionsOnly));
    expect(key(colorsOnly)).not.toBe(key(normalsOnly));
    // batching, batch colours
    const batched = new THREE.BatchedMesh(1, 24, 36, source);
    expect(key(batched)).not.toBe(key(plain));
    const batchedColored = new THREE.BatchedMesh(1, 24, 36, source);
    (batchedColored as unknown as { _colorsTexture: unknown })._colorsTexture = new THREE.Texture();
    expect(key(batchedColored)).not.toBe(key(batched));
    // instancing, instance colours, instance morph texture
    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(), source, 2);
    expect(key(instanced)).not.toBe(key(plain));
    const instancedColored = new THREE.InstancedMesh(new THREE.BoxGeometry(), source, 2);
    instancedColored.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(6), 3);
    expect(key(instancedColored)).not.toBe(key(instanced));
    const instancedMorph = new THREE.InstancedMesh(new THREE.BoxGeometry(), source, 2);
    (instancedMorph as unknown as { morphTexture: unknown }).morphTexture = new THREE.Texture();
    expect(key(instancedMorph)).not.toBe(key(instanced));
    expect(key(instancedMorph)).not.toBe(key(instancedColored));
  });

  it('the shape key names exactly the mesh-derived program parameters', () => {
    expect(prewarmDepthShapeKey(new THREE.Mesh(new THREE.BoxGeometry()))).toBe(
      'rigid:::::::::0:vn',
    );
    expect(prewarmDepthShapeKey(skinnedCaster(9))).toBe('skin::::::mp:::9:vn');
    // A geometry without a normal attribute is a distinct depth program
    // (three's `vertexNormals` boolean).
    const noNormals = new THREE.Mesh(new THREE.BoxGeometry());
    noNormals.geometry.deleteAttribute('normal');
    expect(prewarmDepthShapeKey(noNormals)).toBe('rigid:::::::::0:');
    expect(prewarmDepthShapeKey(noNormals)).not.toBe(
      prewarmDepthShapeKey(new THREE.Mesh(new THREE.BoxGeometry())),
    );
    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(), undefined, 2);
    expect(prewarmDepthShapeKey(instanced)).toContain('inst');
    instanced.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(6), 3);
    expect(prewarmDepthShapeKey(instanced)).toContain('instColor');
    // The material key carries the shape, so a material change and a shape
    // change both invalidate the cache entry.
    const source = new THREE.MeshStandardMaterial();
    expect(prewarmDepthMaterialKey(source, skinnedCaster(2))).not.toBe(
      prewarmDepthMaterialKey(source, skinnedCaster(3)),
    );
  });
});

describe('prewarmDepthMaterialsOf: the twins the shadow arm used for a caster', () => {
  it('finds the cached twin of every material of a caster tuple by the same key, deduped, minting nothing', () => {
    const cache = new Map<string, THREE.MeshDepthMaterial>();
    const plain = new THREE.MeshStandardMaterial({ name: 'plain' });
    const cutout = new THREE.MeshStandardMaterial({ name: 'cutout', alphaTest: 0.5 });
    const caster = new THREE.Mesh(new THREE.BoxGeometry(), [plain, cutout, plain]);
    caster.castShadow = true;
    // nothing minted yet: the lookup answers empty and adds nothing
    expect(prewarmDepthMaterialsOf(cache, caster)).toEqual([]);
    expect(cache.size).toBe(0);
    const plainTwin = prewarmDepthMaterial(cache, plain, caster);
    const cutoutTwin = prewarmDepthMaterial(cache, cutout, caster);
    expect(prewarmDepthMaterialsOf(cache, caster)).toEqual([plainTwin, cutoutTwin]);
    expect(cache.size).toBe(2);
  });

  it('keys on the caster shape too: a skinned twin of the same material is not a rigid caster twin', () => {
    const cache = new Map<string, THREE.MeshDepthMaterial>();
    const skin = new THREE.MeshStandardMaterial();
    const rig = skinnedCaster();
    rig.material = skin;
    const statue = new THREE.Mesh(new THREE.BoxGeometry(), skin);
    statue.castShadow = true;
    const skinnedTwin = prewarmDepthMaterial(cache, skin, rig);
    expect(prewarmDepthMaterialsOf(cache, statue)).toEqual([]);
    expect(prewarmDepthMaterialsOf(cache, rig)).toEqual([skinnedTwin]);
  });

  it('is blind to castShadow: a mesh not casting today still names the twin minted for its shape and material', () => {
    // castShadow is a runtime toggle; whatever swap rule the shadow arm
    // applies, the lookup answers which twins EXIST for this mesh, and a twin
    // minted through another mesh of the same shape and material is the very
    // program this one draws once it casts.
    const cache = new Map<string, THREE.MeshDepthMaterial>();
    const material = new THREE.MeshStandardMaterial();
    const shadowless = new THREE.Mesh(new THREE.BoxGeometry(), material);
    shadowless.castShadow = false;
    expect(prewarmDepthMaterialsOf(cache, shadowless)).toEqual([]);
    const other = new THREE.Mesh(new THREE.BoxGeometry(), material);
    other.castShadow = true;
    const twin = prewarmDepthMaterial(cache, material, other);
    expect(prewarmDepthMaterialsOf(cache, shadowless)).toEqual([twin]);
  });

  it('answers empty for a material-less mesh and a non-mesh', () => {
    const cache = new Map<string, THREE.MeshDepthMaterial>();
    const material = new THREE.MeshStandardMaterial();
    const bare = new THREE.Mesh(new THREE.BoxGeometry(), material);
    bare.castShadow = true;
    prewarmDepthMaterial(cache, material, bare);
    (bare as unknown as { material: THREE.Material | null }).material = null;
    expect(prewarmDepthMaterialsOf(cache, bare)).toEqual([]);
    expect(prewarmDepthMaterialsOf(cache, new THREE.Group())).toEqual([]);
  });
});
