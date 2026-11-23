// Reversible Low research only. No game import installs this controller.

import { MeshoptSimplifier } from 'meshoptimizer';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { isPalmBudgetTree, sceneryQualityIndices } from './scenery_quality_indices.mjs';

export function bandDistance(bounds, x, z) {
  return Math.hypot(
    Math.max(bounds[0] - x, x - bounds[1], 0),
    Math.max(bounds[2] - z, z - bounds[3], 0),
  );
}

// Whole-placement footprints for zone scenery; foliage uses its existing
// shader's origin-distance rule. Four yards match the distance study margin.
export function inMiddleBand(item, x, z) {
  const d =
    item.kind === 'foliage' ? Math.hypot(item.x - x, item.z - z) : bandDistance(item.bounds, x, z);
  return d > (item.kind === 'foliage' ? 60 : 64) && d <= 120;
}

export function collectMiddleBandScenery(renderer, radius = 190) {
  const placements = new Map();
  renderer.scene.updateMatrixWorld(true);
  const camera = renderer.camera.position;
  const add = (key, kind, source, matrix, index, owner) => {
    const g = source.geometry;
    if (
      !g.attributes.position ||
      Array.isArray(source.material) ||
      source.material.transparent ||
      source.isSkinnedMesh
    )
      return;
    g.computeBoundingBox();
    const box = g.boundingBox.clone().applyMatrix4(matrix);
    const bounds = [box.min.x, box.max.x, box.min.z, box.max.z];
    if (bandDistance(bounds, camera.x, camera.z) > radius) return;
    let item = placements.get(key);
    if (!item) {
      item = {
        key,
        kind,
        owner,
        parts: [],
        box: new THREE.Box3(),
        bounds,
        x: matrix.elements[12],
        z: matrix.elements[14],
      };
      placements.set(key, item);
    }
    const tint = new THREE.Color(1, 1, 1);
    if (index !== null && source.instanceColor) source.getColorAt(index, tint);
    item.parts.push({ source, matrix: matrix.clone(), index, tint });
    item.box.union(box);
    item.bounds = [item.box.min.x, item.box.max.x, item.box.min.z, item.box.max.z];
  };
  for (const root of renderer.scene.children) {
    if (!['foliage', 'garden-features', 'jungle-features'].includes(root.name)) continue;
    for (const child of root.children) {
      if (child.isInstancedMesh) {
        if (root.name === 'foliage' && !/^(Bark_|Leaves_|Rocks$)/.test(child.material?.name ?? ''))
          continue;
        const matrix = new THREE.Matrix4();
        for (let i = 0; i < child.count; i++) {
          child.getMatrixAt(i, matrix);
          matrix.premultiply(child.matrixWorld);
          const key = `${root.uuid}:${matrix.elements.join(',')}`;
          add(key, root.name === 'foliage' ? 'foliage' : 'zone-instance', child, matrix, i, root);
        }
      } else if (root.name !== 'foliage') {
        let supported = true;
        child.traverse((n) => {
          if (n.matrixAutoUpdate || n.isInstancedMesh || n.isSkinnedMesh) supported = false;
        });
        if (!supported) continue;
        child.traverse((n) => {
          if (n.isMesh) add(child.uuid, 'landmark', n, n.matrixWorld, null, child);
        });
      }
    }
  }
  return [...placements.values()].filter((item) => {
    const s = item.box.getSize(new THREE.Vector3());
    // Keep canopy/rock masses, omit small dressing and broad merged ground strips.
    return s.y >= 4 && Math.max(s.x, s.z) >= 3 && Math.max(s.x, s.z) < 180;
  });
}

function materialFor(source, basic = false) {
  const material = basic ? new THREE.MeshBasicMaterial() : new THREE.MeshLambertMaterial();
  material.name = `research-scenery-${basic ? 'albedo' : 'lit'}:${source.name}`;
  material.map = source.map;
  material.color.copy(source.color ?? new THREE.Color(1, 1, 1));
  material.alphaTest = source.alphaTest;
  material.side = source.side;
  material.vertexColors = !!source.vertexColors;
  material.fog = !basic;
  material.toneMapped = !basic;
  return material;
}

function compactGeometry(source, indices) {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const a = source.attributes[name];
    if (a) g.setAttribute(name, a.clone());
  }
  g.setIndex(Array.from(indices));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

export async function installMiddleBandExperiment(renderer, distanceController, options = {}) {
  const member = options.member ?? inMiddleBand;
  const excluded = options.excluded ?? (() => false);
  const cellSize = options.cellSize ?? 64;
  const columns = 1024 / cellSize;
  const perAtlas = (columns * columns) / 4;
  if (![64, 128, 256].includes(cellSize)) throw Error('Unsupported atlas cell size');
  if (renderer.webgl.shadowMap.enabled) throw Error('Low without dynamic shadows required');
  if (distanceController.snapshot().cap !== 0)
    throw Error('Collect before packing source instances');
  await MeshoptSimplifier.ready;
  const items = collectMiddleBandScenery(renderer, options.radius ?? 190).filter(
    options.filter ?? (() => true),
  );
  if ((!items.length && !options.allowEmpty) || items.length > 320)
    throw Error(`Unsupported atlas population: ${items.length}`);
  const root = new THREE.Group();
  root.name = options.name ?? 'research-middle-band';
  root.visible = false;
  const quality = new THREE.Group();
  const regional = new THREE.Group();
  const simple = new THREE.Group(),
    sprites = new THREE.Group();
  root.add(simple, sprites, quality, regional);
  const ownedGeometry = new Set(),
    ownedMaterial = new Set(),
    targets = [];
  const reduced = new Map(),
    simpleBatches = new Map(),
    stats = [];
  const materialCache = new Map();
  const ownMaterial = (m) => {
    ownedMaterial.add(m);
    return m;
  };
  let mode = 'cutoff',
    disposed = false,
    lastSelection = null,
    active = [];
  const originalUpdate = renderer.foliage.update;
  function dispose() {
    if (disposed) return;
    if (renderer.foliage.update === update) renderer.foliage.update = originalUpdate;
    root.removeFromParent();
    for (const t of targets) t.dispose();
    for (const g of ownedGeometry) g.dispose();
    for (const m of ownedMaterial) m.dispose();
    disposed = true;
  }
  function selection() {
    const { x, z } = renderer.camera.position;
    return items
      .map((item, i) => {
        if (!member(item, x, z) || excluded(item)) return -1;
        // Do not duplicate complete landmarks or instance parts the 60-yard
        // source still owns, including merged/broad source batches.
        if (item.kind === 'landmark' && item.owner.visible) return -1;
        if (
          item.kind === 'zone-instance' &&
          item.parts.some((p) => {
            const retained = distanceController.retains(p.source, p.index);
            return retained ?? (p.source.visible && p.source.parent.visible);
          })
        )
          return -1;
        return i;
      })
      .filter((i) => i >= 0);
  }
  function update(...args) {
    const result = originalUpdate.apply(this, args);
    if (mode !== 'cutoff') tick();
    return result;
  }
  function tick() {
    active = selection();
    const key = active.join(',');
    if (['simple', 'quality', 'regional'].includes(mode) && key !== lastSelection) {
      const keep = new Set(active);
      for (const b of simpleBatches.values()) {
        if (b.mode !== mode) continue;
        let n = 0;
        for (const part of b.ranges)
          if (keep.has(part.item)) {
            b.mesh.geometry.index.array.set(b.allIndices.subarray(part.start, part.end), n);
            n += part.end - part.start;
          }
        b.mesh.geometry.setDrawRange(0, n);
        b.mesh.geometry.index.needsUpdate = true;
      }
      lastSelection = key;
    }
    for (const b of mode === 'sprites' ? spriteBatches : []) {
      let n = 0;
      for (const i of active) {
        if (i < b.start || i >= b.end) continue;
        const item = items[i],
          center = item.box.getCenter(new THREE.Vector3());
        const angle = Math.atan2(
          renderer.camera.position.x - center.x,
          renderer.camera.position.z - center.z,
        );
        const view = ((Math.round(angle / (Math.PI / 2)) % 4) + 4) % 4;
        const cell = (i - b.start) * 4 + view,
          col = cell % columns,
          row = Math.floor(cell / columns);
        const w = item.width,
          h = item.height,
          rightX = Math.cos(angle),
          rightZ = -Math.sin(angle);
        for (let k = 0; k < 4; k++) {
          const side = k % 2 ? 0.5 : -0.5,
            top = k >= 2;
          b.position.setXYZ(
            n * 4 + k,
            center.x + side * w * rightX,
            center.y + (top ? 0.5 : -0.5) * h,
            center.z + side * w * rightZ,
          );
          b.uv.setXY(
            n * 4 + k,
            (col * cellSize + (k % 2 ? cellSize - 0.5 : 0.5)) / 1024,
            (row * cellSize + (top ? cellSize - 0.5 : 0.5)) / 1024,
          );
        }
        n++;
      }
      b.mesh.geometry.setDrawRange(0, n * 6);
      b.position.needsUpdate = true;
      b.uv.needsUpdate = true;
    }
    simple.visible = mode === 'simple';
    quality.visible = mode === 'quality';
    regional.visible = mode === 'regional';
    sprites.visible = mode === 'sprites';
  }
  const spriteBatches = [];
  try {
    for (const variant of [
      'simple',
      ...(options.quality ? ['quality'] : []),
      ...(options.palmZone ? ['regional'] : []),
    ]) {
      reduced.clear();
      for (const [i, item] of items.entries())
        for (const p of item.parts) {
          const g = p.source.geometry,
            sourceMat = p.source.material;
          const palm = variant === 'regional' && isPalmBudgetTree(item, p.source, options.palmZone);
          let profiles = reduced.get(g);
          if (!profiles) {
            profiles = new Map();
            reduced.set(g, profiles);
          }
          let indices = profiles.get(palm);
          if (!indices) {
            const base = g.index
              ? Uint32Array.from(g.index.array)
              : Uint32Array.from({ length: g.attributes.position.count }, (_, j) => j);
            const positions = new Float32Array(g.attributes.position.count * 3);
            for (let j = 0; j < g.attributes.position.count; j++)
              positions.set(
                [
                  g.attributes.position.getX(j),
                  g.attributes.position.getY(j),
                  g.attributes.position.getZ(j),
                ],
                j * 3,
              );
            indices =
              variant !== 'simple'
                ? sceneryQualityIndices(g, palm ? 256 : 512, palm)
                : base.length > 384
                  ? MeshoptSimplifier.simplifySloppy(base, positions, 3, null, 384, 1)[0]
                  : base;
            if (!indices.length)
              indices = MeshoptSimplifier.simplify(base, positions, 3, 384, 1, ['Permissive'])[0];
            if (!indices.length) indices = base;
            profiles.set(palm, indices);
            stats.push({
              mode: variant,
              palm,
              name: sourceMat.name,
              before: base.length / 3,
              after: indices.length / 3,
            });
          }
          const geo = compactGeometry(g, indices).toNonIndexed();
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
          const batchKey = `${variant}:${sourceMat.uuid}`;
          let b = simpleBatches.get(batchKey);
          if (!b) {
            const material = ownMaterial(materialFor(sourceMat));
            material.vertexColors = true;
            b = { mode: variant, material, parts: [], ranges: [], vertices: 0 };
            simpleBatches.set(batchKey, b);
          }
          b.ranges.push({
            item: i,
            start: b.vertices,
            end: b.vertices + geo.attributes.position.count,
          });
          b.vertices += geo.attributes.position.count;
          b.parts.push(geo);
        }
    }
    for (const b of simpleBatches.values()) {
      const g = mergeGeometries(b.parts);
      for (const p of b.parts) p.dispose();
      ownedGeometry.add(g);
      b.allIndices = Uint32Array.from({ length: g.attributes.position.count }, (_, i) => i);
      g.setIndex(new THREE.BufferAttribute(b.allIndices.slice(), 1));
      g.setDrawRange(0, 0);
      b.mesh = new THREE.Mesh(g, b.material);
      b.mesh.frustumCulled = false;
      (b.mode === 'regional' ? regional : b.mode === 'quality' ? quality : simple).add(b.mesh);
    }
    // Bake full source meshes into bounded 1024px atlases, four yaw views at
    // configurable cells. This is a steady-state representation experiment only.
    for (let start = 0; start < items.length; start += perAtlas) {
      const end = Math.min(items.length, start + perAtlas);
      const target = new THREE.WebGLRenderTarget(1024, 1024, {
        depthBuffer: true,
        stencilBuffer: false,
      });
      targets.push(target);
      target.texture.generateMipmaps = false;
      target.texture.minFilter = THREE.LinearFilter;
      target.texture.magFilter = THREE.LinearFilter;
      const bake = new THREE.Scene();
      if (options.litSprites) {
        for (const light of renderer.scene.children)
          if (light.isHemisphereLight || light.isDirectionalLight) bake.add(light.clone());
      }
      const camera = new THREE.OrthographicCamera();
      const groups = [];
      for (let i = start; i < end; i++) {
        const item = items[i],
          group = new THREE.Group();
        const center = item.box.getCenter(new THREE.Vector3()),
          size = item.box.getSize(new THREE.Vector3());
        item.width = Math.hypot(size.x, size.z) * 1.04;
        item.height = size.y * 1.04;
        for (const p of item.parts) {
          let base = materialCache.get(p.source.material);
          if (!base) {
            base = ownMaterial(materialFor(p.source.material, !options.litSprites));
            base.fog = false;
            base.toneMapped = false;
            materialCache.set(p.source.material, base);
          }
          const mat = ownMaterial(base.clone());
          mat.color.multiply(p.tint);
          const geo = compactGeometry(
            p.source.geometry,
            p.source.geometry.index?.array ??
              Uint32Array.from(
                { length: p.source.geometry.attributes.position.count },
                (_, j) => j,
              ),
          );
          ownedGeometry.add(geo);
          const mesh = new THREE.Mesh(geo, mat);
          mesh.matrixAutoUpdate = false;
          mesh.matrix.copy(p.matrix);
          mesh.matrix.setPosition(
            new THREE.Vector3(
              p.matrix.elements[12] - center.x,
              p.matrix.elements[13] - center.y,
              p.matrix.elements[14] - center.z,
            ),
          );
          group.add(mesh);
        }
        bake.add(group);
        groups.push(group);
      }
      await renderer.webgl.compileAsync(bake, camera);
      const webgl = renderer.webgl,
        previous = webgl.getRenderTarget(),
        viewport = webgl.getViewport(new THREE.Vector4()),
        scissor = webgl.getScissor(new THREE.Vector4()),
        scissorTest = webgl.getScissorTest(),
        clear = webgl.getClearColor(new THREE.Color()),
        alpha = webgl.getClearAlpha(),
        auto = webgl.autoClear;
      try {
        webgl.setRenderTarget(target);
        webgl.setScissorTest(false);
        webgl.setClearColor(0, 0);
        webgl.clear();
        webgl.autoClear = false;
        for (let i = start; i < end; i++) {
          groups.forEach((g, j) => {
            g.visible = j === i - start;
          });
          const item = items[i];
          camera.left = -item.width / 2;
          camera.right = item.width / 2;
          camera.top = item.height / 2;
          camera.bottom = -item.height / 2;
          camera.near = 0.1;
          camera.far = 2000;
          camera.updateProjectionMatrix();
          for (let view = 0; view < 4; view++) {
            const angle = (view * Math.PI) / 2;
            camera.position.set(Math.sin(angle) * 500, 0, Math.cos(angle) * 500);
            camera.lookAt(0, 0, 0);
            camera.updateMatrixWorld();
            const cell = (i - start) * 4 + view;
            webgl.setRenderTarget(target);
            webgl.setViewport(
              (cell % columns) * cellSize,
              Math.floor(cell / columns) * cellSize,
              cellSize,
              cellSize,
            );
            webgl.setScissor(
              (cell % columns) * cellSize,
              Math.floor(cell / columns) * cellSize,
              cellSize,
              cellSize,
            );
            webgl.setScissorTest(true);
            webgl.clear();
            webgl.render(bake, camera);
          }
        }
      } finally {
        webgl.setRenderTarget(previous);
        webgl.setViewport(viewport);
        webgl.setScissor(scissor);
        webgl.setScissorTest(scissorTest);
        webgl.setClearColor(clear, alpha);
        webgl.autoClear = auto;
      }
      const g = new THREE.BufferGeometry(),
        count = end - start;
      const position = new THREE.Float32BufferAttribute(new Float32Array(count * 12), 3),
        uv = new THREE.Float32BufferAttribute(new Float32Array(count * 8), 2),
        normal = new THREE.Float32BufferAttribute(new Float32Array(count * 12), 3);
      for (let i = 0; i < count * 4; i++) normal.setXYZ(i, 0, 1, 0);
      g.setAttribute('position', position);
      g.setAttribute('normal', normal);
      g.setAttribute('uv', uv);
      g.setIndex(
        Array.from({ length: count }, (_, i) => [
          i * 4,
          i * 4 + 1,
          i * 4 + 2,
          i * 4 + 2,
          i * 4 + 1,
          i * 4 + 3,
        ]).flat(),
      );
      ownedGeometry.add(g);
      const SpriteMaterial = options.litSprites
        ? THREE.MeshBasicMaterial
        : THREE.MeshLambertMaterial;
      const mat = ownMaterial(
        new SpriteMaterial({
          map: target.texture,
          alphaTest: 0.35,
          side: THREE.DoubleSide,
        }),
      );
      mat.name = `${root.name}:sprite-atlas`;
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      sprites.add(mesh);
      spriteBatches.push({ start, end, mesh, position, uv });
    }
    // New visible materials go through the game's compile/upload/touch lane.
    await renderer.compileGate(root, false, root.name);
    renderer.scene.add(root);
    root.visible = true;
    if (options.activateDistance !== false) distanceController.set(60);
    renderer.foliage.update = update;
    tick();
    return {
      set(value) {
        if (disposed) throw Error('Disposed');
        if (
          ![
            'cutoff',
            'simple',
            'sprites',
            ...(options.quality ? ['quality'] : []),
            ...(options.palmZone ? ['regional'] : []),
          ].includes(value)
        )
          throw Error('Unsupported mode');
        mode = value;
        lastSelection = null;
        tick();
      },
      snapshot() {
        // Audits are outside timing; a disabled representation does no frame work.
        tick();
        return {
          mode,
          items: items.length,
          active: active.slice(),
          counts: active.reduce((o, i) => {
            o[items[i].kind] = (o[items[i].kind] ?? 0) + 1;
            return o;
          }, {}),
          atlasBytes: targets.length * 1024 * 1024 * 4,
          stats,
          simpleDraws: [...simpleBatches.values()].filter((b) => b.mode === mode).length,
          triangles: ['simple', 'quality', 'regional'].includes(mode)
            ? [...simpleBatches.values()]
                .filter((b) => b.mode === mode)
                .reduce((n, b) => n + b.mesh.geometry.drawRange.count / 3, 0)
            : 0,
          spriteDraws: spriteBatches.length,
          nearViolations: active.filter(
            (i) => !member(items[i], renderer.camera.position.x, renderer.camera.position.z),
          ).length,
          inventory: items.map((i, n) => ({
            id: n,
            key: i.key,
            x: i.x,
            z: i.z,
            kind: i.kind,
            bounds: i.bounds,
            parts: i.parts.length,
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
