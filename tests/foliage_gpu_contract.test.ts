import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const foliage = readFileSync(new URL('../src/render/foliage.ts', import.meta.url), 'utf8');
const blades = readFileSync(new URL('../src/render/blade_grass.ts', import.meta.url), 'utf8');
const canopy = readFileSync(new URL('../src/render/canopy_detail.ts', import.meta.url), 'utf8');

describe('foliage GPU optimization production wiring', () => {
  it('omits all-up normal buffers only where the exact constant-normal patch is live', () => {
    expect(blades).not.toContain("setAttribute('normal'");
    expect(blades).toContain('patchConstantUpNormalVertexShader(sh.vertexShader)');

    expect(foliage).toContain("geo.deleteAttribute('normal');");
    expect(foliage).toContain("flowerGeo.deleteAttribute('normal');");
    expect(foliage).toContain(
      'sh.vertexShader = patchConstantUpNormalVertexShader(sh.vertexShader);',
    );
    expect(foliage).toContain('sh.fragmentShader = patchGrassFragmentShader(sh.fragmentShader);');
  });

  it('packs cap flags and keeps cap and no-cap shader programs distinct', () => {
    expect(foliage).toContain('new Uint8Array(g.getAttribute');
    expect(foliage).toContain("g.setAttribute('aCap', new THREE.Uint8BufferAttribute(arr, 1));");
    expect(foliage).toContain(
      'mat.customProgramCacheKey = () => `grass-card|cap:${capProgramKey}|${baseProgramKey}`;',
    );
    expect(foliage).toContain(
      'const capCollapseBand = grassCapCollapseBand(GFX.bladeCarpetRadius);',
    );
    expect(foliage).toContain('const capCollapse = grassCapCollapseShaderPatch(capBand);');
    expect(foliage).toContain('applyGrassShader(mat, uniforms, capCollapseBand);');
    expect(foliage).toContain('applyGrassShader(fmMat, uniforms, null);');
    expect(foliage).not.toContain("flowerGeo.setAttribute('aCap'");
  });

  it('trims each immutable grass and flower buffer to the exact live float prefix', () => {
    expect(foliage).toContain('(matrix.array as Float32Array).slice(0, count * 16)');
    expect(foliage).toContain('(color.array as Float32Array).slice(0, count * color.itemSize)');
    expect(foliage).toContain('trimStaticInstanceAttributes(im, n);');
    expect(foliage).toContain('trimStaticInstanceAttributes(fm, fn);');
  });

  it('limits each occluder matrix upload to exactly one mat4', () => {
    expect(foliage.match(/instanceMatrix\.addUpdateRange\(part\.index \* 16, 16\);/g)).toHaveLength(
      2,
    );
  });

  it('freezes static bucket and streamed chunk transforms after construction', () => {
    expect(foliage).toContain("import { freezeStaticMatrices } from './static_matrix';");
    expect(foliage).toMatch(/parent\.add\(im\);\s+freezeStaticMatrices\(im\);/);
    expect(foliage).toMatch(/parent\.add\(fm\);\s+freezeStaticMatrices\(fm\);/);
    expect(foliage).toMatch(
      /: buildGrassRing\(group, seed\);\s+freezeStaticMatrices\(group\);\s+return \{/,
    );
  });

  it('attaches canopy and shared leaf-map fragment savings to live materials', () => {
    expect(canopy).toContain(
      'const patched = patchCanopyDetailShaderSource(shader.vertexShader, shader.fragmentShader, {',
    );
    expect(canopy).toContain('shader.vertexShader = patched.vertexShader;');
    expect(canopy).toContain('shader.fragmentShader = patched.fragmentShader;');
    expect(foliage).toContain('if (pol.leaf && std.map) reuseLeafMapSampleForEmissive(mat);');
    expect(foliage).toContain(
      'shader.fragmentShader = reuseDiffuseMapSampleForEmissive(shader.fragmentShader);',
    );
  });
});
