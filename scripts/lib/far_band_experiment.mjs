// Reversible research only. Install before the middle-band controller packs sources.
import { MeshoptSimplifier } from 'meshoptimizer';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bandDistance, collectMiddleBandScenery } from './middle_band_experiment.mjs';

export function inFarBand(item, x, z) {
  const d =
    item.kind === 'foliage' ? Math.hypot(item.x - x, item.z - z) : bandDistance(item.bounds, x, z);
  return d > 120 && d <= 240;
}

export async function installFarBandExperiment(renderer, distance, options = {}) {
  const member = options.member ?? inFarBand;
  const excluded = options.excluded ?? (() => false);
  const target = (options.targetTriangles ?? 32) * 3;
  if (renderer.webgl.shadowMap.enabled || distance.snapshot().cap !== 0)
    throw Error('Requires unpacked Low scenery without dynamic shadows');
  await MeshoptSimplifier.ready;
  // Seventy extra yards permit the same bounded movement captures as the middle study.
  const items = collectMiddleBandScenery(renderer, options.radius ?? 310);
  if (!items.length || items.length > 2000) throw Error('Unsupported far population');
  const root = new THREE.Group();
  root.name = options.name ?? 'research-far-band';
  root.visible = false;
  const batches = new Map(),
    geometries = new Set(),
    materials = new Set();
  const reduced = new Map(),
    stats = [];
  const originalUpdate = renderer.foliage.update;
  let disposed = false,
    enabled = false,
    lastKey = null,
    active = [];
  function dispose() {
    if (disposed) return;
    if (renderer.foliage.update === update) renderer.foliage.update = originalUpdate;
    root.removeFromParent();
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    disposed = true;
  }
  function tick() {
    const { x, z } = renderer.camera.position;
    active = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!member(item, x, z) || excluded(item)) continue;
      if (item.kind === 'landmark' && item.owner.visible) continue;
      if (
        item.kind === 'zone-instance' &&
        item.parts.some(
          (p) =>
            distance.retains(p.source, p.index) ?? (p.source.visible && p.source.parent.visible),
        )
      )
        continue;
      active.push(i);
    }
    const key = active.join(',');
    if (enabled && key !== lastKey) {
      const keep = new Set(active);
      for (const b of batches.values()) {
        let n = 0;
        for (const range of b.ranges)
          if (keep.has(range.item)) {
            b.mesh.geometry.index.array.set(b.allIndices.subarray(range.start, range.end), n);
            n += range.end - range.start;
          }
        b.mesh.geometry.setDrawRange(0, n);
        b.mesh.geometry.index.needsUpdate = true;
      }
      lastKey = key;
    }
    root.visible = enabled;
  }
  function update(...args) {
    const result = originalUpdate.apply(this, args);
    if (enabled) tick();
    return result;
  }
  try {
    for (const [i, item] of items.entries())
      for (const p of item.parts) {
        const source = p.source.geometry,
          sourceMat = p.source.material;
        let indices = reduced.get(source);
        if (!indices) {
          const base = source.index
            ? Uint32Array.from(source.index.array)
            : Uint32Array.from({ length: source.attributes.position.count }, (_, j) => j);
          const positions = new Float32Array(source.attributes.position.count * 3);
          for (let j = 0; j < source.attributes.position.count; j++)
            positions.set(
              [
                source.attributes.position.getX(j),
                source.attributes.position.getY(j),
                source.attributes.position.getZ(j),
              ],
              j * 3,
            );
          indices =
            base.length > target
              ? MeshoptSimplifier.simplifySloppy(base, positions, 3, null, target, 1)[0]
              : base;
          if (!indices.length)
            indices = MeshoptSimplifier.simplify(base, positions, 3, target, 1, ['Permissive'])[0];
          if (!indices.length) indices = base;
          reduced.set(source, indices);
          stats.push({ name: sourceMat.name, before: base.length / 3, after: indices.length / 3 });
        }
        const indexed = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'uv', 'color'])
          if (source.attributes[name]) indexed.setAttribute(name, source.attributes[name]);
        indexed.setIndex(Array.from(indices));
        const geo = indexed.toNonIndexed();
        geometries.add(geo);
        if (!geo.attributes.normal) geo.computeVertexNormals();
        geo.applyMatrix4(p.matrix);
        if (!geo.attributes.uv)
          geo.setAttribute(
            'uv',
            new THREE.Float32BufferAttribute(
              new Float32Array(geo.attributes.position.count * 2),
              2,
            ),
          );
        const colors = new Float32Array(geo.attributes.position.count * 3),
          c = geo.attributes.color;
        for (let j = 0; j < geo.attributes.position.count; j++)
          colors.set(
            [
              (c?.getX(j) ?? 1) * p.tint.r,
              (c?.getY(j) ?? 1) * p.tint.g,
              (c?.getZ(j) ?? 1) * p.tint.b,
            ],
            j * 3,
          );
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        let b = batches.get(sourceMat);
        if (!b) {
          const material = new THREE.MeshLambertMaterial({
            map: sourceMat.map,
            color: sourceMat.color,
            alphaTest: sourceMat.alphaTest,
            side: sourceMat.side,
            vertexColors: true,
          });
          material.name = `${root.name}:${sourceMat.name}`;
          materials.add(material);
          b = { material, parts: [], ranges: [], vertices: 0 };
          batches.set(sourceMat, b);
        }
        b.ranges.push({
          item: i,
          start: b.vertices,
          end: b.vertices + geo.attributes.position.count,
        });
        b.vertices += geo.attributes.position.count;
        b.parts.push(geo);
      }
    for (const b of batches.values()) {
      const g = mergeGeometries(b.parts);
      if (!g) throw Error('Incompatible far geometry');
      geometries.add(g);
      for (const part of b.parts) {
        part.dispose();
        geometries.delete(part);
      }
      b.parts.length = 0;
      b.allIndices = Uint32Array.from({ length: g.attributes.position.count }, (_, i) => i);
      g.setIndex(new THREE.BufferAttribute(b.allIndices.slice(), 1));
      g.setDrawRange(0, 0);
      b.mesh = new THREE.Mesh(g, b.material);
      b.mesh.frustumCulled = false;
      root.add(b.mesh);
    }
    await renderer.compileGate(root, false, root.name);
    renderer.scene.add(root);
    renderer.foliage.update = update;
    tick();
    return {
      set(value) {
        if (disposed) throw Error('Disposed');
        if (typeof value !== 'boolean') throw Error('Expected boolean');
        enabled = value;
        lastKey = null;
        tick();
      },
      snapshot() {
        // Audits run outside timing. Disabled mode does no selection work per frame.
        tick();
        return {
          enabled,
          items: items.length,
          active: active.slice(),
          stats,
          draws: batches.size,
          triangles: enabled
            ? [...batches.values()].reduce((n, b) => n + b.mesh.geometry.drawRange.count / 3, 0)
            : 0,
          nearViolations: active.filter(
            (i) => !member(items[i], renderer.camera.position.x, renderer.camera.position.z),
          ).length,
          inventory: items.map((item, id) => ({
            id,
            key: item.key,
            kind: item.kind,
            bounds: item.bounds,
            x: item.x,
            z: item.z,
            parts: item.parts.length,
          })),
        };
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
