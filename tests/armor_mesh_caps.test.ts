// Guard: no level-20 armor piece may ship as an open shell.
//
// The sets are cut into Torso / Legs / Arms / Shoulders / Helm by the armor forge,
// and the cut left three of the five with no bottom, no top and no shoulder end.
// Front-face culling turns an open shell into a hole rather than a seam: at the
// waist, where the torso's rim and the legs' rim face each other across a gap, you
// saw the sky straight through the character. scripts/glb_cap_holes.mjs closes each
// clean rim cycle with a fan built from vertices the rim already owns, so nothing
// moves and no skin weight is invented.
//
// See scripts/lib/mesh_caps.mjs.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readAccessor, readGlb } from '../scripts/lib/glb_binary.mjs';
import {
  boundaryRims,
  capCycles,
  orientationDefects,
  triangleCount,
  weldVertices,
} from '../scripts/lib/mesh_caps.mjs';

const PLAYERS = fileURLToPath(new URL('../public/models/chars/players', import.meta.url));

/** An open-ended triangular tube: two rings of three, walled but with no end caps,
 *  so it has exactly two clean boundary cycles. */
function openTube(): { position: number[]; indices: number[] } {
  const position = [
    1, 0, 0, -0.5, 0, 0.866, -0.5, 0, -0.866, 1, 2, 0, -0.5, 2, 0.866, -0.5, 2, -0.866,
  ];
  const indices: number[] = [];
  for (let i = 0; i < 3; i++) {
    const a = i;
    const b = (i + 1) % 3;
    indices.push(a, b, a + 3, b, b + 3, a + 3);
  }
  return { position, indices };
}

/** A closed tetrahedron: no boundary at all. */
function tetrahedron(): { position: number[]; indices: number[] } {
  return {
    position: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
  };
}

function analyse(mesh: { position: number[]; indices: number[] }) {
  const { remap, representative } = weldVertices(mesh.position);
  const triCount = triangleCount(mesh.indices, mesh.position.length);
  return {
    remap,
    representative,
    triCount,
    rims: boundaryRims(mesh.indices, remap, triCount),
    defects: orientationDefects(mesh.indices, remap, triCount),
  };
}

describe('boundary rim detection', () => {
  it('finds both open ends of a tube and none on a closed solid', () => {
    const tube = analyse(openTube());
    expect(tube.rims.cycles).toHaveLength(2);
    expect(tube.rims.cycles.map((c) => c.length).sort()).toEqual([3, 3]);
    expect(tube.rims.open).toEqual([]);
    expect(tube.defects.boundary).toBe(6);

    const solid = analyse(tetrahedron());
    expect(solid.rims.cycles).toEqual([]);
    expect(solid.defects.boundary).toBe(0);
    expect(solid.defects.flipped).toBe(0);
  });
});

describe('capping', () => {
  it('closes every hole and leaves the shell consistently wound', () => {
    const mesh = openTube();
    const before = analyse(mesh);
    expect(before.defects.boundary).toBeGreaterThan(0);

    const { triangles } = capCycles(
      { position: mesh.position, representative: before.representative },
      before.rims.cycles,
    );
    const capped = { position: mesh.position, indices: [...mesh.indices, ...triangles] };
    const after = analyse(capped);

    expect(after.defects.boundary).toBe(0);
    // A cap wound the wrong way would close the hole but leave two faces pointing
    // the same way through an edge, which reads as a shading tear.
    expect(after.defects.flipped).toBe(0);
    expect(after.rims.cycles).toEqual([]);
  });

  it('adds no vertices, so nothing has to invent a skin weight', () => {
    const mesh = openTube();
    const { representative, rims } = analyse(mesh);
    const { triangles } = capCycles({ position: mesh.position, representative }, rims.cycles);

    expect(triangles.length).toBeGreaterThan(0);
    const vertexCount = mesh.position.length / 3;
    for (const index of triangles) expect(index).toBeLessThan(vertexCount);
  });

  it('does not move, add or reshape any existing vertex', () => {
    const mesh = openTube();
    const original = [...mesh.position];
    const { representative, rims } = analyse(mesh);
    capCycles({ position: mesh.position, representative }, rims.cycles);

    expect(mesh.position).toEqual(original);
  });

  it('leaves a branching rim alone rather than capping it crooked', () => {
    // A fin hanging off one top-rim vertex on two fresh vertices. Vertex 3 now has
    // two outgoing boundary edges (3 -> 5 around the rim, 3 -> 6 along the fin), so
    // the top rim is no longer a cycle and cannot be safely fanned.
    const mesh = openTube();
    mesh.position.push(3, 3, 0, 3, 4, 0);
    mesh.indices.push(3, 6, 7);
    const { rims } = analyse(mesh);

    expect(rims.open.length).toBeGreaterThan(0);
    // The untouched bottom rim is still a clean cycle and still gets capped.
    expect(rims.cycles).toHaveLength(1);

    const { representative } = analyse(mesh);
    const { triangles } = capCycles({ position: mesh.position, representative }, rims.cycles);
    const after = analyse({ position: mesh.position, indices: [...mesh.indices, ...triangles] });
    // Strictly fewer holes than we started with, and never a mis-wound face.
    expect(after.defects.boundary).toBeLessThan(analyse(mesh).defects.boundary);
    expect(after.defects.flipped).toBe(0);
  });
});

describe('shipped level-20 armor', () => {
  it('has no open rim cycle left in any piece', () => {
    // The per-class mech suits ride the same forge and the same capping pass,
    // so they are held to the same no-open-shell contract as the lvl20 sets.
    const files = readdirSync(PLAYERS).filter(
      (f) => f.endsWith('_lvl20.glb') || f.endsWith('_mech.glb'),
    );
    expect(files).toHaveLength(18); // 9 lvl20 sets + 9 mech suits

    const offenders: string[] = [];
    for (const file of files) {
      const { json, bin } = readGlb(path.join(PLAYERS, file));
      const meshes = json.meshes as unknown as {
        name?: string;
        primitives: { attributes: Record<string, number>; indices?: number }[];
      }[];
      for (const mesh of meshes) {
        for (const prim of mesh.primitives) {
          const attrs = prim.attributes;
          const indexId = prim.indices;
          if (attrs.POSITION === undefined) continue;
          const position = readAccessor(json, bin as Buffer, attrs.POSITION);
          const indices = indexId === undefined ? null : readAccessor(json, bin as Buffer, indexId);
          const { remap } = weldVertices(position);
          const rims = boundaryRims(indices, remap, triangleCount(indices, position.length));
          if (rims.cycles.length > 0) {
            offenders.push(
              `${file} :: ${mesh.name ?? '(unnamed)'} has ${rims.cycles.length} open rim(s)`,
            );
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  }, 30_000);

  it('every set GLB carries the handslot bones that hold the wearer weapons', () => {
    // The armored/suit visuals spread the class body's attach defs (weapons on
    // handslot.r, offhand on handslot.l), but those bones are NOT part of the
    // forge output: they are grafted in as a post-step (scripts/glb_graft_handslots.mjs,
    // copying the body's parent bone + local TRS). A set that skips the graft
    // renders fine until a weapon equips into nothing, so pin the bones here.
    const files = readdirSync(PLAYERS).filter(
      (f) => f.endsWith('_lvl20.glb') || f.endsWith('_mech.glb'),
    );
    expect(files).toHaveLength(18);
    const offenders: string[] = [];
    for (const file of files) {
      const { json } = readGlb(path.join(PLAYERS, file));
      const names = new Set(((json.nodes ?? []) as { name?: string }[]).map((node) => node.name));
      for (const bone of ['handslot.r', 'handslot.l']) {
        if (!names.has(bone)) offenders.push(`${file} :: missing ${bone}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
