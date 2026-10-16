// The armor set atlas (scripts/assets/woc_character/armor_atlas.mjs): materials whose cells
// would hold IDENTICAL pixels (a mirrored left piece wearing its right twin's maps, the
// 2026-10-03 male warrior rebuild) share one cell, both pieces' UVs land in it, and a piece
// whose master or baked factors differ keeps its own cell.
import { Document } from '@gltf-transform/core';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { atlasArmorSet } from '../scripts/assets/woc_character/armor_atlas.mjs';

const solid = (r: number, g: number, b: number) =>
  sharp({ create: { width: 16, height: 16, channels: 4, background: { r, g, b, alpha: 1 } } })
    .png()
    .toBuffer();

/** A unit quad at `x`, UVs over the whole square, drawn with `material`. */
function quad(
  doc: Document,
  name: string,
  x: number,
  material: ReturnType<Document['createMaterial']>,
) {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const positions = new Float32Array([x, 0, 0, x + 1, 0, 0, x + 1, 1, 0, x, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const prim = doc
    .createPrimitive()
    .setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer),
    )
    .setAttribute(
      'TEXCOORD_0',
      doc.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buffer),
    )
    .setIndices(
      doc
        .createAccessor()
        .setType('SCALAR')
        .setArray(new Uint16Array([0, 1, 2, 0, 2, 3]))
        .setBuffer(buffer),
    )
    .setMaterial(material);
  const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim));
  doc.getRoot().listScenes()[0].addChild(node);
  return prim;
}

function uvBox(prim: ReturnType<Document['createPrimitive']>): number[] {
  const acc = prim.getAttribute('TEXCOORD_0');
  return [...(acc?.getMin([]) ?? []), ...(acc?.getMax([]) ?? [])].map((v) => Number(v.toFixed(6)));
}

async function atlasOf(twinFactor: [number, number, number, number]) {
  const doc = new Document();
  doc.createBuffer();
  doc.createScene();
  const red = await solid(200, 40, 40);
  const blue = await solid(40, 40, 200);
  const masters = new Map<unknown, Buffer>();
  const textured = (name: string, png: Buffer, factor: [number, number, number, number]) => {
    const tex = doc.createTexture(name).setImage(new Uint8Array(png)).setMimeType('image/png');
    masters.set(tex, png);
    return doc.createMaterial(name).setBaseColorTexture(tex).setBaseColorFactor(factor);
  };
  const right = quad(doc, 'Shoulder_R', 0, textured('shoulder_r', red, [1, 1, 1, 1]));
  // the left twin: a separate texture object over the SAME master bytes
  const left = quad(doc, 'Shoulder_L', 2, textured('shoulder_l', red, twinFactor));
  const chest = quad(doc, 'Chest', 4, textured('chest', blue, [1, 1, 1, 1]));
  const summary = (await atlasArmorSet(doc, 'low', (tex) => masters.get(tex) ?? null)) as {
    materials: number;
    cellsShared: number;
  };
  return { summary, right, left, chest };
}

describe('woc armor atlas', () => {
  it('gives a twin wearing identical maps the same cell, and keeps others apart', async () => {
    const { summary, right, left, chest } = await atlasOf([1, 1, 1, 1]);
    expect(summary.materials).toBe(3);
    expect(summary.cellsShared).toBe(1);
    // both twins sample one cell, the chest its own
    expect(uvBox(left)).toEqual(uvBox(right));
    expect(uvBox(chest)).not.toEqual(uvBox(right));
    // and a shared cell is sized for one piece, not two: the twins' cell is as large as the
    // chest's (all three pieces have the same area and coverage)
    const side = (box: number[]) => box[2] - box[0];
    expect(side(uvBox(right))).toBeCloseTo(side(uvBox(chest)), 6);
  });

  it('keeps a twin apart when a baked factor would make its pixels differ', async () => {
    const { summary, right, left } = await atlasOf([0.5, 0.5, 0.5, 1]);
    expect(summary.cellsShared).toBe(0);
    expect(uvBox(left)).not.toEqual(uvBox(right));
  });
});
