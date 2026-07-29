import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const foliage = readFileSync(new URL('../src/render/foliage.ts', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

describe('perceptual scenery LOD production wiring', () => {
  it('changes grass density through existing instance counts without runtime uploads', () => {
    const buildChunkBlock = foliage.slice(
      foliage.indexOf('const buildChunk'),
      foliage.indexOf('const disposeChunk'),
    );
    expect(buildChunkBlock.match(/new THREE\.InstancedMesh/g)).toHaveLength(2);
    const densityBlock = foliage.slice(
      foliage.indexOf('const applyMeshDensity'),
      foliage.indexOf('return {', foliage.indexOf('const applyMeshDensity')),
    );
    expect(densityBlock).toContain('farFieldDensityFractionForValues(');
    expect(densityBlock).toContain('advanceInstanceCountInto(');
    expect(densityBlock).toContain('mesh.count =');
    expect(densityBlock).not.toContain('farFieldDensityFraction({');
    expect(densityBlock).not.toContain('advanceInstanceCount(');
    expect(densityBlock).not.toContain('needsUpdate');
    expect(densityBlock).not.toContain('new THREE.InstancedMesh');
    expect(foliage.match(/reorderInstanceDataByStableRank\(/g)).toHaveLength(2);
    expect(foliage).toMatch(/im\.instanceMatrix[\s\S]*?seed,\s*GRASS_RANK_SALT,\s*\);/);
    expect(foliage).toMatch(/fm\.instanceMatrix[\s\S]*?seed,\s*FLOWER_RANK_SALT,\s*\);/);
    expect(foliage).toContain('GFX.farGrassDensityFloor');
  });

  it('routes the live projection only through the scenery flame helper', () => {
    expect(renderer).toContain('this.camera.projectionMatrix.elements[5]');
    expect(
      renderer.match(
        /projectionScalePixels\(\n\s+this\.camera\.projectionMatrix\.elements\[5\],\n\s+this\.renderPixelHeight,/g,
      ),
    ).toHaveLength(2);
    expect(renderer).toContain('const state = updateSceneryFlame(');
    expect(renderer).toContain('if (state.emitsEmber) this.vfx.campfireEmber');
    expect(renderer).not.toContain('animCadenceFrames(projectionPixels');
    const foliageCalls = [...renderer.matchAll(/this\.foliage\.update\(([\s\S]*?)\n {4}\);/g)];
    expect(foliageCalls).toHaveLength(2);
    for (const call of foliageCalls) {
      expect(call[1]).toMatch(/this\.lastRequestedFogFar,\s*projectionPixels,\s*dt,/);
    }
    const flameCall = renderer.slice(
      renderer.indexOf('const state = updateSceneryFlame('),
      renderer.indexOf(
        'if (!state) continue;',
        renderer.indexOf('const state = updateSceneryFlame('),
      ),
    );
    expect(flameCall).toMatch(/this\.tmpV2,\s*projectionPixels,\s*priorState,/);
  });
});
