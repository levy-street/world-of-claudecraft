import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reusePackedOrmSample } from '../src/render/water_flora_shader_core';

const SHADER = `
  #include <roughnessmap_fragment>
  #include <metalnessmap_fragment>
  #include <aomap_fragment>
`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('water flora packed ORM shader', () => {
  it('samples the packed map once and reuses its three channels', () => {
    const patched = reusePackedOrmSample(SHADER);

    expect(patched.match(/texture2D\( roughnessMap, vRoughnessMapUv \)/g)).toHaveLength(1);
    expect(patched).toContain('roughnessFactor *= waterFloraOrm.g;');
    expect(patched).toContain('metalnessFactor *= waterFloraOrm.b;');
    expect(patched).toContain('waterFloraOrm.r');
    expect(patched).not.toContain('#include <roughnessmap_fragment>');
    expect(patched).not.toContain('#include <metalnessmap_fragment>');
    expect(patched).not.toContain('#include <aomap_fragment>');
    expect(patched).not.toMatch(/\bif\s*\(/);
  });

  it('patches a clone only when every packed texture sample is equivalent', async () => {
    vi.resetModules();
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => new Promise(() => {})),
    }));
    vi.doMock('../src/render/assets/preload', () => ({ registerPreload: vi.fn() }));
    const { waterFloraShaderInternalsForTest } = await import('../src/render/water_flora');

    const orm = new THREE.Texture();
    const ao = orm.clone();
    const source = new THREE.MeshStandardMaterial({
      aoMap: ao,
      roughnessMap: orm,
      metalnessMap: orm,
    });
    const patched = waterFloraShaderInternalsForTest.waterFloraMaterial(
      source,
    ) as THREE.MeshStandardMaterial;
    expect(patched).not.toBe(source);
    expect(source.onBeforeCompile.toString()).not.toContain('reusePackedOrmSample');

    const shader = { uniforms: {}, vertexShader: '', fragmentShader: SHADER };
    patched.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      null as unknown as THREE.WebGLRenderer,
    );
    expect(
      shader.fragmentShader.match(/texture2D\( roughnessMap, vRoughnessMapUv \)/g),
    ).toHaveLength(1);

    ao.minFilter = THREE.NearestFilter;
    const mismatched = new THREE.MeshStandardMaterial({
      aoMap: ao,
      roughnessMap: orm,
      metalnessMap: orm,
    });
    expect(waterFloraShaderInternalsForTest.waterFloraMaterial(mismatched)).toBe(mismatched);
  });

  it('rejects every identity condition that can change the packed texel', async () => {
    vi.resetModules();
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => new Promise(() => {})),
    }));
    vi.doMock('../src/render/assets/preload', () => ({ registerPreload: vi.fn() }));
    const { waterFloraShaderInternalsForTest } = await import('../src/render/water_flora');

    const makeMaterial = (): {
      material: THREE.MeshStandardMaterial;
      orm: THREE.Texture;
      ao: THREE.Texture;
    } => {
      const orm = new THREE.Texture();
      const ao = orm.clone();
      return {
        material: new THREE.MeshStandardMaterial({
          aoMap: ao,
          roughnessMap: orm,
          metalnessMap: orm,
        }),
        orm,
        ao,
      };
    };
    const rejects = (
      mutate: (material: THREE.MeshStandardMaterial, orm: THREE.Texture, ao: THREE.Texture) => void,
    ): void => {
      const { material, orm, ao } = makeMaterial();
      mutate(material, orm, ao);
      expect(waterFloraShaderInternalsForTest.waterFloraMaterial(material)).toBe(material);
    };

    const basic = new THREE.MeshBasicMaterial();
    expect(waterFloraShaderInternalsForTest.waterFloraMaterial(basic)).toBe(basic);
    rejects((material) => {
      material.aoMap = null;
    });
    rejects((material) => {
      material.roughnessMap = null;
    });
    rejects((material) => {
      material.metalnessMap = new THREE.Texture();
    });
    rejects((_material, _orm, ao) => {
      ao.source = new THREE.Source(null);
    });
    rejects((_material, _orm, ao) => {
      ao.channel = 1;
    });
    rejects((_material, _orm, ao) => {
      ao.mapping = THREE.CubeReflectionMapping;
    });
    rejects((_material, _orm, ao) => {
      ao.wrapS = THREE.RepeatWrapping;
    });
    rejects((_material, _orm, ao) => {
      ao.wrapT = THREE.MirroredRepeatWrapping;
    });
    rejects((_material, _orm, ao) => {
      ao.magFilter = THREE.NearestFilter;
    });
    rejects((_material, _orm, ao) => {
      ao.anisotropy = 2;
    });
    rejects((_material, _orm, ao) => {
      ao.format = THREE.RedFormat;
    });
    rejects((_material, _orm, ao) => {
      ao.internalFormat = 'R8';
    });
    rejects((_material, _orm, ao) => {
      ao.type = THREE.FloatType;
    });
    rejects((_material, _orm, ao) => {
      ao.generateMipmaps = false;
    });
    rejects((_material, _orm, ao) => {
      ao.premultiplyAlpha = true;
    });
    rejects((_material, _orm, ao) => {
      ao.flipY = false;
    });
    rejects((_material, _orm, ao) => {
      ao.unpackAlignment = 1;
    });
    rejects((_material, _orm, ao) => {
      ao.colorSpace = THREE.SRGBColorSpace;
    });
    rejects((_material, _orm, ao) => {
      ao.matrixAutoUpdate = false;
    });
    rejects((_material, _orm, ao) => {
      ao.offset.x = 0.25;
    });
    rejects((_material, _orm, ao) => {
      ao.repeat.x = 2;
    });
    rejects((_material, _orm, ao) => {
      ao.center.y = 0.5;
    });
    rejects((_material, _orm, ao) => {
      ao.rotation = 0.2;
    });
    rejects((_material, orm, ao) => {
      orm.matrixAutoUpdate = false;
      ao.matrixAutoUpdate = false;
      ao.matrix.elements[0] = 2;
    });
  });
});
