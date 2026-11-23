import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyVertexColourScale, vertexColourScaleOf } from '../src/render/vertex_colour_glb_parts';
import { stripComments } from './helpers/strip_comments';

// A painted, vertex-coloured GLB (the Mirefen tavern, scripts/assets/mirefen_tavern/) stores
// its painted faces' vertex colours under a headroom, so the baked light can lift the paint
// above its map, and names the linear factor that undoes it in each painted material's extras
// (`vertexColourScale`). A converter that builds fresh materials reads the factor itself; a GLB
// drawn with its own materials (an authored map draws them as they are) has the loader apply
// the factor to those materials' colour once, as it parses the file
// (src/render/vertex_colour_glb_parts.ts applyVertexColourScale, src/render/assets/loader.ts).

const SCALE = 2.4876;

function material(name: string, scale?: unknown): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
  mat.name = name;
  if (scale !== undefined) mat.userData = { vertexColourScale: scale };
  return mat;
}

describe('the vertex colour scale of a painted GLB material', () => {
  it('reads the factor its extras name, and 1 for anything else', () => {
    expect(vertexColourScaleOf(material('PaintedPlaster', SCALE))).toBe(SCALE);
    expect(vertexColourScaleOf(material('PlainMetal'))).toBe(1);
    for (const junk of [0, -2, Number.NaN, Number.POSITIVE_INFINITY, '2', null]) {
      expect(vertexColourScaleOf(material('X', junk)), String(junk)).toBe(1);
    }
  });

  it('scales each painted material once, however many meshes share it, and nothing else', () => {
    const scene = new THREE.Group();
    const painted = material('PaintedPlaster', SCALE);
    const other = material('PaintedSlate', SCALE);
    const plain = material('PlainMetal');
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    scene.add(new THREE.Mesh(geometry, painted));
    scene.add(new THREE.Mesh(geometry, painted));
    scene.add(new THREE.Mesh(geometry, [other, plain]));
    expect(applyVertexColourScale(scene)).toBe(2);
    expect(painted.color.toArray()).toEqual([SCALE, SCALE, SCALE]);
    expect(other.color.toArray()).toEqual([SCALE, SCALE, SCALE]);
    // an untextured material draws its vertex colours as they are
    expect(plain.color.toArray()).toEqual([1, 1, 1]);
    // never twice: a second pass (or a clone, which carries the mark) changes nothing
    expect(applyVertexColourScale(scene)).toBe(0);
    expect(painted.color.r).toBe(SCALE);
    const cloned = new THREE.Group().add(new THREE.Mesh(geometry, painted.clone()));
    expect(applyVertexColourScale(cloned)).toBe(0);
    expect(
      ((cloned.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.r,
    ).toBe(SCALE);
    // a factor scales the material's own colour (its glTF base colour factor), not a fixed one
    const tinted = material('Tinted', 2);
    tinted.color.setRGB(0.5, 0.25, 1);
    expect(applyVertexColourScale(new THREE.Group().add(new THREE.Mesh(geometry, tinted)))).toBe(1);
    expect(tinted.color.toArray()).toEqual([1, 0.5, 2]);
  });

  it('runs in the loader parse chain, before any consumer sees the scene', () => {
    // Comments stripped, so a commented-out call cannot satisfy the pin.
    const loader = stripComments(
      readFileSync(path.join(__dirname, '..', 'src/render/assets/loader.ts'), 'utf8'),
    );
    const polish = loader.indexOf('polishGltfTextures(gltf);');
    const scale = loader.indexOf('applyVertexColourScale(gltf.scene);');
    const classify = loader.indexOf('classifyGltfKtx2Textures(gltf, resolved);');
    expect(polish).toBeGreaterThan(-1);
    expect(scale).toBeGreaterThan(polish);
    expect(classify).toBeGreaterThan(scale);
  });
});
