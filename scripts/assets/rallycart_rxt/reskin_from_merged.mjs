#!/usr/bin/env node
// Re-skin the Rallycart from a MERGED, unrigged Tripo export.
//
// Tripo's later exports come back as one node, one mesh, one primitive and one
// texture atlas: the whole car welded together with no part separation. That is
// unusable as a mount on its own, because the rig contract needs the four
// wheels as separate meshes hanging off their own nodes, and you cannot parent
// part of a primitive to a node.
//
// It is recoverable because the geometry did not change. The merged export is
// the SAME car in the SAME space as the shipped model (measured: every vertex
// within 2mm of a shipped vertex, mean 0.85mm). So the shipped model can be
// used as a STENCIL: for each triangle of the merged mesh, look up which part
// of the shipped model its vertices sit on, and cut it back along those lines.
//
// What comes out keeps the shipped model's node tree and animations bit for
// bit, and replaces only the geometry and the material. The rig contract, the
// measured exhaust ports, the headlight bowls, the suspension envelope and the
// steering lock therefore all survive untouched, because none of them moved.
//
// Usage:
//   node scripts/assets/rallycart_rxt/reskin_from_merged.mjs <merged.glb> [--emit out.glb]
//
// Without --emit it only reports, which is the right way to look at a new
// export before trusting it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** The shipped model: the rig donor and the stencil both. */
const STENCIL = 'public/models/mounts/rallycart_rxt.glb';

/** Vertices this far apart in model units are the same point. The measured
 *  worst case on WRX-3 was 0.0013, so this has real margin without being loose
 *  enough to jump between a tire and the arch above it (nearest clearance is
 *  about 0.016). */
const MATCH_TOLERANCE = 0.006;

/** Spatial hash cell. Comfortably above the tolerance so a lookup only has to
 *  visit the 27 neighbouring cells. */
const CELL = 0.01;

function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  // 12 byte header, then the JSON chunk's own 8 byte header, then the BIN
  // chunk's 8 byte header.
  const bin = buf.subarray(20 + jsonLength + 8);
  return { json, bin };
}

/** Read an accessor as a flat array of numbers, HONOURING byteStride.
 *  The shipped model interleaves at stride 32; ignoring that silently returns
 *  normals where positions were asked for. */
function readAccessor(glb, index) {
  const acc = glb.json.accessors[index];
  const view = glb.json.bufferViews[acc.bufferView];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type];
  const reader = {
    5120: [1, (b, o) => b.readInt8(o)],
    5121: [1, (b, o) => b.readUInt8(o)],
    5122: [2, (b, o) => b.readInt16LE(o)],
    5123: [2, (b, o) => b.readUInt16LE(o)],
    5125: [4, (b, o) => b.readUInt32LE(o)],
    5126: [4, (b, o) => b.readFloatLE(o)],
  }[acc.componentType];
  if (!reader) throw new Error(`unsupported componentType ${acc.componentType}`);
  const [width, read] = reader;
  const stride = view.byteStride ?? width * components;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Array(acc.count * components);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < components; c++)
      out[i * components + c] = read(glb.bin, base + i * stride + c * width);
  }
  return out;
}

/** Every node's cumulative offset from the root. The rig is translation only,
 *  which is checked rather than assumed. */
function nodeOffsets(json) {
  const parent = new Map();
  json.nodes.forEach((node, i) => {
    for (const child of node.children ?? []) parent.set(child, i);
  });
  const offsets = new Map();
  json.nodes.forEach((node, i) => {
    if (node.rotation || node.scale || node.matrix) {
      throw new Error(
        `node ${node.name}: rig is not translation-only, the stencil maths assumes it is`,
      );
    }
    let x = 0;
    let y = 0;
    let z = 0;
    for (let cur = i; cur !== undefined; cur = parent.get(cur)) {
      const t = json.nodes[cur].translation ?? [0, 0, 0];
      x += t[0];
      y += t[1];
      z += t[2];
    }
    offsets.set(i, [x, y, z]);
  });
  return offsets;
}

/** The stencil: every shipped vertex in MODEL space, tagged with the node and
 *  primitive it belongs to. */
function buildStencil(glb) {
  const offsets = nodeOffsets(glb.json);
  const grid = new Map();
  const parts = [];
  glb.json.nodes.forEach((node, nodeIndex) => {
    if (node.mesh === undefined) return;
    const [ox, oy, oz] = offsets.get(nodeIndex);
    glb.json.meshes[node.mesh].primitives.forEach((prim, primIndex) => {
      const partId = parts.length;
      parts.push({ node: node.name, nodeIndex, primIndex, offset: [ox, oy, oz], count: 0 });
      const pos = readAccessor(glb, prim.attributes.POSITION);
      const nrm =
        prim.attributes.NORMAL === undefined ? null : readAccessor(glb, prim.attributes.NORMAL);
      for (let i = 0; i < pos.length; i += 3) {
        const p = [pos[i] + ox, pos[i + 1] + oy, pos[i + 2] + oz];
        const key = `${Math.round(p[0] / CELL)},${Math.round(p[1] / CELL)},${Math.round(p[2] / CELL)}`;
        let bucket = grid.get(key);
        if (!bucket) {
          bucket = [];
          grid.set(key, bucket);
        }
        bucket.push([
          p[0],
          p[1],
          p[2],
          partId,
          nrm ? nrm[i] : 0,
          nrm ? nrm[i + 1] : 0,
          nrm ? nrm[i + 2] : 0,
        ]);
      }
    });
  });
  return { grid, parts };
}

/** Which stencil part a point sits on, or null when nothing is close enough. */
function lookup(stencil, x, y, z) {
  let best = Number.POSITIVE_INFINITY;
  let part = null;
  const cx = Math.round(x / CELL);
  const cy = Math.round(y / CELL);
  const cz = Math.round(z / CELL);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = stencil.grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
        if (!bucket) continue;
        for (const [px, py, pz, id] of bucket) {
          const d = Math.hypot(x - px, y - py, z - pz);
          if (d < best) {
            best = d;
            part = id;
          }
        }
      }
    }
  }
  return best <= MATCH_TOLERANCE ? { part, distance: best } : null;
}

/**
 * The nearest stencil vertex BELONGING TO a given part, with its normal.
 *
 * Restricting to the part is what lets a seam be rebuilt correctly. The merge
 * welded each seam's two vertices into one, averaging their normals and losing
 * the hard edge. The split duplicates that single vertex back into both
 * primitives, and because each copy looks up only within ITS OWN part, each one
 * recovers its own side's normal. The crease comes back.
 */
function lookupInPart(stencil, x, y, z, part) {
  const cx = Math.round(x / CELL);
  const cy = Math.round(y / CELL);
  const cz = Math.round(z / CELL);
  const scan = (reach, wanted) => {
    let best = Number.POSITIVE_INFINITY;
    let found = null;
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dz = -reach; dz <= reach; dz++) {
          const bucket = stencil.grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!bucket) continue;
          for (const v of bucket) {
            if (wanted !== null && v[3] !== wanted) continue;
            const d = Math.hypot(x - v[0], y - v[1], z - v[2]);
            if (d < best) {
              best = d;
              found = v;
            }
          }
        }
      }
    }
    return found;
  };
  for (const reach of [1, 2, 3]) {
    const hit = scan(reach, part);
    if (hit) return { vertex: hit, ownPart: true };
  }
  // A triangle that straddled a boundary was voted into ONE part, so a corner
  // of it may sit on geometry that part does not own. Snapping it to the
  // nearest stencil vertex of any part still puts it exactly on the tuned
  // surface, which is what matters; only its normal comes from a neighbour.
  for (const reach of [1, 2, 3]) {
    const hit = scan(reach, null);
    if (hit) return { vertex: hit, ownPart: false };
  }
  return null;
}

/**
 * Cut the merged mesh along the stencil's part boundaries.
 *
 * Assignment is per TRIANGLE, not per vertex, because a triangle has to live
 * in exactly one mesh. A triangle whose three corners disagree is straddling a
 * boundary; those are reported rather than silently dropped, because on this
 * model there should be none (the wheels never touch the bodywork, that gap is
 * the suspension envelope) and any at all would mean the export changed.
 */
function splitByStencil(merged, stencil) {
  const prim = merged.json.meshes[0].primitives[0];
  const pos = readAccessor(merged, prim.attributes.POSITION);
  const nrm =
    prim.attributes.NORMAL === undefined ? null : readAccessor(merged, prim.attributes.NORMAL);
  const uv =
    prim.attributes.TEXCOORD_0 === undefined
      ? null
      : readAccessor(merged, prim.attributes.TEXCOORD_0);
  const idx =
    prim.indices === undefined
      ? Array.from({ length: pos.length / 3 }, (_, i) => i)
      : readAccessor(merged, prim.indices);

  const vertexPart = new Array(pos.length / 3).fill(null);
  let unmatched = 0;
  let worst = 0;
  for (let v = 0; v < pos.length / 3; v++) {
    const hit = lookup(stencil, pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    if (!hit) {
      unmatched++;
      continue;
    }
    vertexPart[v] = hit.part;
    if (hit.distance > worst) worst = hit.distance;
  }

  const groups = new Map();
  const straddling = [];
  const crossMesh = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = vertexPart[idx[t]];
    const b = vertexPart[idx[t + 1]];
    const c = vertexPart[idx[t + 2]];
    if (a === null || b === null || c === null) {
      straddling.push({ tri: t / 3, reason: 'unmatched vertex' });
      continue;
    }
    if (a !== b || b !== c) {
      const nodes = new Set([stencil.parts[a].node, stencil.parts[b].node, stencil.parts[c].node]);
      if (nodes.size > 1) crossMesh.push({ tri: t / 3, nodes: [...nodes].join('/') });
      // Majority wins, so a triangle seamed across two primitives of the SAME
      // mesh still lands somewhere sensible; it is recorded either way.
      straddling.push({ tri: t / 3, reason: `parts ${a}/${b}/${c}` });
    }
    const part = a === b || a === c ? a : b;
    let group = groups.get(part);
    if (!group) {
      group = [];
      groups.set(part, group);
    }
    group.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  return { pos, nrm, uv, groups, straddling, crossMesh, unmatched, worst };
}

function main() {
  const [mergedPath, ...rest] = process.argv.slice(2);
  if (!mergedPath) {
    console.error('usage: reskin_from_merged.mjs <merged.glb> [--emit out.glb]');
    process.exit(2);
  }
  if (!existsSync(STENCIL)) throw new Error(`stencil missing: ${STENCIL} (run from the repo root)`);

  const stencil = buildStencil(readGlb(STENCIL));
  const merged = readGlb(mergedPath);
  const split = splitByStencil(merged, stencil);

  console.log(`stencil: ${STENCIL}`);
  console.log(
    `  ${stencil.parts.length} parts across ${new Set(stencil.parts.map((p) => p.node)).size} meshes`,
  );
  console.log(`merged:  ${mergedPath}`);
  console.log(
    `  ${split.pos.length / 3} vertices, normals ${split.nrm ? 'yes' : 'NO'}, uvs ${split.uv ? 'yes' : 'NO'}`,
  );
  console.log('');
  console.log(
    `worst vertex match distance: ${split.worst.toFixed(5)} (tolerance ${MATCH_TOLERANCE})`,
  );
  console.log(`unmatched vertices:          ${split.unmatched}`);
  console.log(`straddling triangles:        ${split.straddling.length}`);
  console.log(`  of those, crossing a MESH:  ${split.crossMesh.length}`);
  for (const c of split.crossMesh.slice(0, 5)) console.log(`    tri ${c.tri}: ${c.nodes}`);
  console.log('');

  const byNode = new Map();
  for (const [part, indices] of split.groups) {
    const info = stencil.parts[part];
    const entry = byNode.get(info.node) ?? { prims: 0, tris: 0 };
    entry.prims++;
    entry.tris += indices.length / 3;
    byNode.set(info.node, entry);
  }
  console.log('reconstructed parts:');
  for (const [node, entry] of byNode) {
    console.log(
      `  ${node.padEnd(12)} ${String(entry.prims).padStart(3)} prims  ${String(entry.tris).padStart(6)} tris`,
    );
  }
  const missing = stencil.parts.filter((_, i) => !split.groups.has(i));
  console.log('');
  console.log(`stencil parts with NO geometry recovered: ${missing.length}`);
  for (const part of missing) console.log(`  ${part.node} prim ${part.primIndex}`);

  const emitAt = rest.indexOf('--emit');
  if (emitAt !== -1) {
    const out = rest[emitAt + 1];
    if (!out) throw new Error('--emit needs an output path');
    if (split.unmatched > 0)
      throw new Error(
        `${split.unmatched} unmatched vertices: refusing to emit a model with geometry the stencil cannot place`,
      );
    if (split.crossMesh.length > 0)
      throw new Error(
        `${split.crossMesh.length} triangles straddle a MESH boundary: the wheels are not cleanly separable, refusing to emit`,
      );
    if (missing.length > 0)
      throw new Error(`${missing.length} stencil parts recovered no geometry: refusing to emit`);
    const bytes = buildGlb(readGlb(STENCIL), merged, stencil, split);
    writeFileSync(out, bytes);
    console.log('');
    console.log(
      `wrote ${out}  (${(bytes.length / 1048576).toFixed(2)} MB, uncompressed: run the KTX2 pass before committing)`,
    );
  }
}

/** Pad to a 4-byte boundary, which glTF requires of every bufferView an
 *  accessor reads through. */
function pad4(n) {
  return (4 - (n % 4)) % 4;
}

/**
 * Assemble the re-skinned GLB.
 *
 * The node tree and every animation come from the STENCIL untouched, because
 * they ARE the rig contract: the runtime finds `Susp_*`, `Steer_*`, `Wheel_*`
 * and `rider_anchor` by name, and the suspension and steering measure the mesh
 * at load. Keep the names and the transforms and everything downstream keeps
 * working without knowing the skin changed.
 *
 * Only the geometry and the material are new. Mesh indices are preserved in the
 * stencil's own order so the copied nodes' `mesh` fields stay valid.
 */
function buildGlb(stencilGlb, merged, stencil, split) {
  const chunks = [];
  let offset = 0;
  const bufferViews = [];
  let borrowed = 0;
  const accessors = [];

  const pushView = (buf, extra = {}) => {
    const padding = pad4(offset);
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      offset += padding;
    }
    chunks.push(buf);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...extra });
    offset += buf.length;
    return bufferViews.length - 1;
  };

  const pushFloats = (values, type, components) => {
    const buf = Buffer.alloc(values.length * 4);
    for (let i = 0; i < values.length; i++) buf.writeFloatLE(values[i], i * 4);
    const view = pushView(buf, components === undefined ? {} : { target: 34962 });
    const count = values.length / components;
    const acc = { bufferView: view, componentType: 5126, count, type };
    if (type === 'VEC3') {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < values.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], values[i + k]);
          max[k] = Math.max(max[k], values[i + k]);
        }
      }
      acc.min = min;
      acc.max = max;
    } else if (type === 'SCALAR') {
      acc.min = [Math.min(...values)];
      acc.max = [Math.max(...values)];
    }
    accessors.push(acc);
    return accessors.length - 1;
  };

  // --- geometry, one primitive per stencil part -------------------------
  const meshes = stencilGlb.json.meshes.map(() => ({ primitives: [] }));
  const partsByMesh = new Map();
  stencil.parts.forEach((part, id) => {
    const meshIndex = stencilGlb.json.nodes[part.nodeIndex].mesh;
    if (!partsByMesh.has(meshIndex)) partsByMesh.set(meshIndex, []);
    partsByMesh.get(meshIndex).push({ id, part });
  });

  for (const [meshIndex, parts] of [...partsByMesh].sort((a, b) => a[0] - b[0])) {
    // Preserve the stencil's own primitive order, so prim N still means what it
    // meant: the exhaust ports and headlight bowls are identified by index.
    parts.sort((a, b) => a.part.primIndex - b.part.primIndex);
    for (const { id: partId, part } of parts) {
      const indices = split.groups.get(partId);
      const remap = new Map();
      const position = [];
      const normal = [];
      const uv = [];
      const out = [];
      for (const v of indices) {
        let mapped = remap.get(v);
        if (mapped === undefined) {
          mapped = remap.size;
          remap.set(v, mapped);
          // POSITION AND NORMAL COME FROM THE STENCIL, not from the merged
          // export. This is the difference between a re-skin and a re-import.
          //
          // The merge shifts vertices by up to 1.3mm as it welds, which sounds
          // harmless and is not: where a fender runs nearly TANGENT to the
          // tire's swept arc, a 1mm radial nudge walks the contact point
          // several degrees around it. Measured on this model, taking the
          // merged positions cost the right front 5.5 degrees of steering
          // lock, and every other measured constant would drift the same way.
          //
          // Snapping to the stencil keeps the car geometrically IDENTICAL to
          // the tuned model, so the steering lock, the suspension envelope, the
          // exhaust ports and the headlight bowls all stay exactly where they
          // were tuned. Only the UVs and the texture are new, which is what a
          // re-skin actually means. It also restores the hard edges the weld
          // averaged away, since each seam copy takes its own side's normal.
          const hit = lookupInPart(
            stencil,
            split.pos[v * 3],
            split.pos[v * 3 + 1],
            split.pos[v * 3 + 2],
            partId,
          );
          if (!hit)
            throw new Error(`vertex ${v} has no stencil counterpart anywhere near part ${partId}`);
          if (!hit.ownPart) borrowed++;
          const src = hit.vertex;
          // Back into the owning node's own space: the node carries the offset.
          position.push(src[0] - part.offset[0], src[1] - part.offset[1], src[2] - part.offset[2]);
          normal.push(src[4], src[5], src[6]);
          if (split.uv) uv.push(split.uv[v * 2], split.uv[v * 2 + 1]);
        }
        out.push(mapped);
      }
      const attributes = { POSITION: pushFloats(position, 'VEC3', 3) };
      attributes.NORMAL = pushFloats(normal, 'VEC3', 3);
      if (split.uv) attributes.TEXCOORD_0 = pushFloats(uv, 'VEC2', 2);

      const wide = remap.size > 65535;
      const idxBuf = Buffer.alloc(out.length * (wide ? 4 : 2));
      for (let i = 0; i < out.length; i++) {
        if (wide) idxBuf.writeUInt32LE(out[i], i * 4);
        else idxBuf.writeUInt16LE(out[i], i * 2);
      }
      const idxView = pushView(idxBuf, { target: 34963 });
      accessors.push({
        bufferView: idxView,
        componentType: wide ? 5125 : 5123,
        count: out.length,
        type: 'SCALAR',
      });
      meshes[meshIndex].primitives.push({
        attributes,
        indices: accessors.length - 1,
        material: 0,
      });
    }
  }

  // --- animations, copied wholesale ------------------------------------
  const animations = stencilGlb.json.animations?.map((anim) => ({
    name: anim.name,
    channels: anim.channels.map((c) => ({ sampler: c.sampler, target: { ...c.target } })),
    samplers: anim.samplers.map((s) => {
      const input = readAccessor(stencilGlb, s.input);
      const output = readAccessor(stencilGlb, s.output);
      const outType = stencilGlb.json.accessors[s.output].type;
      return {
        input: pushFloats(input, 'SCALAR', 1),
        output: pushFloats(output, outType, { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[outType]),
        interpolation: s.interpolation ?? 'LINEAR',
      };
    }),
  }));

  // --- material and texture, from the new skin --------------------------
  const srcImage = merged.json.images[0];
  const srcView = merged.json.bufferViews[srcImage.bufferView];
  const imageBytes = merged.bin.subarray(
    srcView.byteOffset ?? 0,
    (srcView.byteOffset ?? 0) + srcView.byteLength,
  );
  const imageView = pushView(Buffer.from(imageBytes));

  const json = {
    asset: { version: '2.0', generator: 'reskin_from_merged.mjs' },
    scene: stencilGlb.json.scene ?? 0,
    scenes: stencilGlb.json.scenes,
    nodes: stencilGlb.json.nodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
    materials: [merged.json.materials[0]],
    textures: merged.json.textures,
    images: [{ bufferView: imageView, mimeType: srcImage.mimeType, name: srcImage.name }],
  };
  if (merged.json.samplers) json.samplers = merged.json.samplers;
  if (animations?.length) json.animations = animations;

  // --- container --------------------------------------------------------
  if (borrowed) {
    console.log();
  }
  if (borrowed > 0) {
    console.log(
      `  ${borrowed} seam vertices took a neighbouring part's normal (straddling triangles)`,
    );
  }

  const bin = Buffer.concat(chunks);
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = Buffer.alloc(pad4(jsonBuf.length), 0x20);
  const binPad = Buffer.alloc(pad4(bin.length), 0);
  const jsonChunk = Buffer.concat([jsonBuf, jsonPad]);
  const binChunk = Buffer.concat([bin, binPad]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
}

main();
