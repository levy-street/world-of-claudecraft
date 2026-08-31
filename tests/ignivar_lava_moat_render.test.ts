import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { sharedUniforms } from '../src/render/gfx';
import {
  buildIgnivarLavaMoat,
  IGNIVAR_LAVA_COLOR_URL,
  IGNIVAR_LAVA_MOAT_NAME,
} from '../src/render/ignivar_lava_moat';
import { IGNIVAR_LAVA_MOAT_DEPTH } from '../src/sim/ignivar_arena';

function texture(): THREE.DataTexture {
  const value = new THREE.DataTexture(new Uint8Array([255, 128, 32, 255]), 1, 1);
  value.needsUpdate = true;
  return value;
}

describe('Ignivar lava moat render', () => {
  it('pins the original 1K project texture generated from the owner Drive reference', async () => {
    const bytes = readFileSync(new URL(`../public${IGNIVAR_LAVA_COLOR_URL}`, import.meta.url));
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '7f09961b2ceb8e252bebc8adeb4f16722479cf95b032f467ceb5475abf86da32',
    );
    await expect(sharp(bytes).metadata()).resolves.toMatchObject({
      format: 'webp',
      width: 1024,
      height: 1024,
    });

    const credits = readFileSync(new URL('../CREDITS.md', import.meta.url), 'utf8');
    expect(credits).toContain('ignivar_lava_original.webp');
    expect(credits).toContain('the Yoge/Fab source image is not distributed');
    const manifest = readFileSync(
      new URL('../src/render/assets/manifest.generated.ts', import.meta.url),
      'utf8',
    );
    expect(manifest).toContain('textures/encounters/ignivar/ignivar_lava_original.webp');
  });

  it('builds a lowered animated PBR lava ring and two dry stone bridges', () => {
    const color = texture();
    const moat = buildIgnivarLavaMoat({ lowGfx: false, textures: { color } });
    const surface = moat.getObjectByName('ignivarLavaSurface') as THREE.Mesh;
    const material = surface.material as THREE.ShaderMaterial;
    const bridges = moat.getObjectByName('ignivarLavaBridges') as THREE.InstancedMesh;

    expect(moat.name).toBe(IGNIVAR_LAVA_MOAT_NAME);
    expect(moat.userData.actionable).toBe(true);
    expect(moat.userData.hazard).toBe('lava');
    expect(moat.userData.depth).toBe(IGNIVAR_LAVA_MOAT_DEPTH);
    expect(surface.position.y).toBeCloseTo(-IGNIVAR_LAVA_MOAT_DEPTH + 0.03, 5);
    expect(surface.userData.source).toBe('project-generated:drive-referenced-lava');
    expect(material.uniforms.uTime).toBe(sharedUniforms.uTime);
    expect(material.uniforms.fogColor.value).toBeInstanceOf(THREE.Color);
    expect(material.uniforms.uColorMap.value).toBe(color);
    expect(material.uniforms.uNormalMap).toBeUndefined();
    expect(material.vertexShader).toContain('position.xz * 0.065');
    expect(material.fragmentShader).toContain('texture2D(uColorMap');
    expect(material.fragmentShader.match(/texture2D\(uColorMap/g)).toHaveLength(2);
    expect(material.fragmentShader).toContain('flowA');
    expect(bridges.count).toBe(2);
    expect(bridges.userData.collision).toBe('heightfield');

    const bridgeGeometry = bridges.geometry as THREE.BoxGeometry;
    expect(bridgeGeometry.parameters).toMatchObject({ width: 8, height: 0.32, depth: 5.5 });
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const bridgeZ: number[] = [];
    for (let index = 0; index < bridges.count; index++) {
      bridges.getMatrixAt(index, matrix);
      matrix.decompose(position, rotation, scale);
      expect(position.x).toBeCloseTo(0, 6);
      expect(position.y).toBeCloseTo(-0.14, 6);
      bridgeZ.push(position.z);
    }
    expect(bridgeZ.sort((a, b) => a - b)).toEqual([-30.25, 30.25]);

    surface.geometry.computeBoundingBox();
    expect(surface.geometry.boundingBox?.min.x).toBeCloseTo(-33, 5);
    expect(surface.geometry.boundingBox?.max.x).toBeCloseTo(33, 5);
    expect(surface.geometry.boundingBox?.min.z).toBeCloseTo(-33, 5);
    expect(surface.geometry.boundingBox?.max.z).toBeCloseTo(33, 5);
  });

  it('keeps low graphics readable while reducing only ambient molten detail', () => {
    const textures = { color: texture() };
    const low = buildIgnivarLavaMoat({ lowGfx: true, textures });
    const high = buildIgnivarLavaMoat({ lowGfx: false, textures });
    const lowEmbers = low.getObjectByName('ignivarLavaEmbers') as THREE.Points;
    const highEmbers = high.getObjectByName('ignivarLavaEmbers') as THREE.Points;

    expect(low.getObjectByName('ignivarLavaSurface')).toBeDefined();
    expect(low.getObjectByName('ignivarLavaBridges')).toBeDefined();
    expect(lowEmbers.geometry.getAttribute('position').count).toBe(20);
    expect(highEmbers.geometry.getAttribute('position').count).toBe(56);
  });

  it('shares immutable geometry and material across repeated room builds', () => {
    const textures = { color: texture() };
    const first = buildIgnivarLavaMoat({ lowGfx: false, textures });
    const second = buildIgnivarLavaMoat({ lowGfx: false, textures });
    const firstSurface = first.getObjectByName('ignivarLavaSurface') as THREE.Mesh;
    const secondSurface = second.getObjectByName('ignivarLavaSurface') as THREE.Mesh;
    expect(secondSurface.geometry).toBe(firstSurface.geometry);
    expect(secondSurface.material).toBe(firstSurface.material);
  });

  it('masks arena floor tiles over the moat and attaches the effect only in Ignivar', () => {
    const source = readFileSync(new URL('../src/render/dungeon.ts', import.meta.url), 'utf8');
    expect(source).toContain("from './ignivar_lava_moat'");
    expect(source).toContain('await ensureIgnivarLavaMoatAssets()');
    // The carve is keyed by INTERIOR, not the shared 'ignivar' kit variant:
    // variant-keying stamped the arena octagon onto the Halls, Molten
    // Assembly, and Inner Crucible floors (the black-void bug). The
    // arena-only behavior of the predicate itself is pinned in
    // tests/dungeon_tile_kind_core.test.ts.
    expect(source).toContain('if (ignivarMoatCarvesFloorCell(interior, x, z)) continue;');
    expect(source.match(/buildIgnivarLavaMoat\(/g)).toHaveLength(1);
  });
});
