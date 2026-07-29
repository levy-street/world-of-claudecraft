// Guard: a character GLB's NORMAL attribute must live in the same axis space as
// its POSITION attribute.
//
// The level-20 armor sets shipped with every normal rotated -90 degrees about X:
// the FBX-to-glTF Z-up conversion ran once over positions and twice over normals.
// Shape, UVs and texture binding were all correct, so nothing in the loader, the
// material pipeline or the eye-test on the silhouette caught it. The only symptom
// was shading, and specifically the character rim term in src/render/gfx.ts
// (addRimGlow): with the normals turned side-on, dot(normal, viewDir) sat at about
// zero across the whole surface, so pow(1 - saturate(dot), 3) pinned at 1 and the
// rim added its full bluish-white everywhere. The armor read as washed out and
// pale, which looks like a lighting bug and is not one.
//
// Measuring it needs no renderer: a vertex normal is a smoothed average of the
// faces meeting at that vertex, so on a sane mesh it agrees with the winding
// derived face normal. See scripts/lib/normal_axis.mjs.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import type { AxisCorrection } from '../scripts/lib/normal_axis.mjs';
import {
  AXIS_CORRECTIONS,
  bestAxisCorrection,
  correctionByName,
  IDENTITY_CORRECTION,
  rotateNormalsInPlace,
  scoreAxisCorrections,
} from '../scripts/lib/normal_axis.mjs';

const PLAYERS = fileURLToPath(new URL('../public/models/chars/players', import.meta.url));

/** Look up a correction that must exist; a typo in the label is a test bug, not a
 *  null to thread through every assertion. */
function correction(name: string): AxisCorrection {
  const found = correctionByName(name);
  if (!found) throw new Error(`no axis correction named ${name}`);
  return found;
}

/** The Z-up to Y-up rotation an FBX import applies: (x, y, z) -> (x, z, -y). */
const ZUP_TO_YUP = correction('(x,z,-y)');
/** Its inverse, the correction the shipped armor needed: (x, y, z) -> (x, -z, y). */
const YUP_REPAIR = correction('(x,-z,y)');

/** A unit cube with correct outward per-face normals. Flat-shaded (24 verts) so
 *  every vertex normal equals its face normal and the healthy score is exactly 1. */
function unitCube(): { position: number[]; normal: number[]; index: number[] } {
  const faces: [number[], number[]][] = [
    [
      [1, 0, 0],
      [0, 1, 2],
    ],
    [
      [-1, 0, 0],
      [0, 2, 1],
    ],
    [
      [0, 1, 0],
      [1, 2, 0],
    ],
    [
      [0, -1, 0],
      [1, 0, 2],
    ],
    [
      [0, 0, 1],
      [2, 0, 1],
    ],
    [
      [0, 0, -1],
      [2, 1, 0],
    ],
  ];
  const position: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  for (const [n, [axis, u, v]] of faces) {
    const base = position.length / 3;
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const p = [0, 0, 0];
      p[axis] = n[axis];
      p[u] = su;
      p[v] = sv;
      position.push(p[0], p[1], p[2]);
      normal.push(n[0], n[1], n[2]);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { position, normal, index };
}

describe('normal axis detection', () => {
  it('scores a correctly authored mesh at the identity and nowhere else', () => {
    const verdict = bestAxisCorrection(unitCube());

    expect(verdict.best).toBe(IDENTITY_CORRECTION.name);
    expect(verdict.identity).toBeCloseTo(1, 6);
    expect(verdict.healthy).toBe(true);
    // No other rotation comes anywhere near, so the winner is unambiguous.
    const runnerUp = Math.max(
      ...[...verdict.scores].filter(([n]) => n !== IDENTITY_CORRECTION.name).map(([, s]) => s),
    );
    expect(runnerUp).toBeLessThan(0.5);
  });

  it('names the exact rotation that undoes a double Z-up conversion', () => {
    const cube = unitCube();
    // Reproduce the shipping defect: positions stay Y-up, normals take the Z-up
    // to Y-up rotation one extra time.
    rotateNormalsInPlace(cube.normal, ZUP_TO_YUP);

    const verdict = bestAxisCorrection(cube);

    expect(verdict.healthy).toBe(false);
    expect(verdict.best).toBe(YUP_REPAIR.name);
    expect(verdict.bestScore).toBeCloseTo(1, 6);
    // A rotation about X leaves the two +-X faces of a cube pointing the right way,
    // so exactly two of six still agree: the identity score is 1/3, far under the
    // 0.7 health threshold. The shipped armor meshes measured 0.15 to 0.40 here.
    expect(verdict.identity).toBeCloseTo(1 / 3, 6);
  });

  it('repairs the mesh it diagnosed, back to an exact identity match', () => {
    const cube = unitCube();
    const pristine = [...cube.normal];
    rotateNormalsInPlace(cube.normal, ZUP_TO_YUP);
    expect(cube.normal).not.toEqual(pristine);

    rotateNormalsInPlace(cube.normal, correction(bestAxisCorrection(cube).best));

    for (let i = 0; i < pristine.length; i++) expect(cube.normal[i]).toBeCloseTo(pristine[i], 6);
    expect(bestAxisCorrection(cube).healthy).toBe(true);
  });

  it('offers the 24 proper rotations and no mirrors', () => {
    expect(AXIS_CORRECTIONS).toHaveLength(24);
    expect(AXIS_CORRECTIONS.filter((c) => c.isIdentity)).toHaveLength(1);
    // A mirror would flip the winding, which is a different defect; it must not be
    // offered as a repair, or the tool would "fix" an inside-out mesh by lying
    // about its normals.
    expect(AXIS_CORRECTIONS.map((c) => c.name)).not.toContain('(-x,y,z)');
  });

  it('treats a mesh with no usable faces as unhealthy rather than passing it', () => {
    // Every triangle degenerate: nothing to compare against, so no clean bill.
    const flat = {
      position: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      normal: [0, 1, 0, 0, 1, 0, 0, 1, 0],
      index: null,
    };
    const verdict = bestAxisCorrection(flat);

    expect(verdict.samples).toBe(0);
    expect(verdict.healthy).toBe(false);
  });

  it('scores every candidate in one pass over the geometry', () => {
    const { scores, samples } = scoreAxisCorrections(unitCube());

    expect(samples).toBe(12);
    expect(scores.size).toBe(24);
  });
});

describe('shipped player character GLBs', () => {
  it('all have normals in the same axis space as their positions', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile() && e.name.endsWith('.glb')) files.push(full);
      }
    };
    walk(PLAYERS);
    // Fail loudly if the directory ever moves, rather than vacuously passing on an
    // empty file list.
    expect(files.length).toBeGreaterThan(20);

    const offenders: string[] = [];
    let measured = 0;
    for (const file of files) {
      const doc = await io.read(file);
      for (const mesh of doc.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          const position = prim.getAttribute('POSITION')?.getArray();
          const normal = prim.getAttribute('NORMAL')?.getArray();
          if (!position || !normal) continue;
          measured++;
          const verdict = bestAxisCorrection({
            position,
            normal,
            index: prim.getIndices()?.getArray() ?? null,
          });
          if (verdict.healthy) continue;
          offenders.push(
            `${path.basename(file)} :: ${mesh.getName() || '(unnamed)'} ` +
              `identity=${verdict.identity.toFixed(3)} best=${verdict.best}@${verdict.bestScore.toFixed(3)}`,
          );
        }
      }
    }

    expect(measured).toBeGreaterThan(200);
    expect(offenders).toEqual([]);
  }, 60_000);
});
