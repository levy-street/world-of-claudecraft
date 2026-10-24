// Local Low-only experiment, never installed by the game. Aggressively caps
// props, towns, foliage and registered zone scenery, including landmark trees.
// Terrain, actors, combat effects, fog, lights and materials are untouched.
export function installSceneryDistanceExperiment(renderer) {
  if (renderer.webgl.shadowMap.enabled) throw Error('Requires Low without dynamic shadows');
  const foliage = renderer.foliage;
  const originalUpdate = foliage.update;
  const horizon = renderer.entryDetailHorizon;
  const originalHorizon = horizon.sceneryCullFar;
  const originalSweep = renderer.updateZoneFeatureVisibility;
  const originalRender = renderer.webgl.render;
  const entries = [];
  const objects = [];
  const objectSeen = new Set();
  const seen = new Set();
  let cap = 0;
  let sceneryOff = false;
  let suppressedRoots = 0;
  let disposed = false;
  let lastX = Number.NaN;
  let lastZ = Number.NaN;
  let serial = 0;

  function edge(b, x, z) {
    return Math.hypot(Math.max(b[0] - x, x - b[1], 0), Math.max(b[2] - z, z - b[3], 0));
  }

  function applyObjects() {
    const { x, z } = renderer.camera.position;
    for (const e of objects)
      e.object.visible = e.visible && (!cap || edge(e.bounds, x, z) <= cap + 4);
  }

  function refresh() {
    if (disposed) throw Error('Experiment disposed');
    const additions = [];
    renderer.scene.traverse((root) => {
      if (root.name !== 'jungle-features') return;
      for (const mesh of root.children) {
        if (!mesh.isInstancedMesh || seen.has(mesh)) continue;
        if (
          mesh.morphTexture ||
          Object.values(mesh.geometry.attributes).some((a) => a.isInstancedBufferAttribute)
        )
          throw Error('Unsupported instance attributes');
        if (mesh.count !== mesh.instanceMatrix.count) throw Error('Source already packed');
        mesh.geometry.computeBoundingBox();
        const matrix = mesh.matrixWorld.clone();
        const bounds = [];
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          matrix.premultiply(mesh.matrixWorld);
          const b = mesh.geometry.boundingBox.clone().applyMatrix4(matrix);
          bounds.push([b.min.x, b.max.x, b.min.z, b.max.z]);
        }
        additions.push({
          mesh,
          count: mesh.count,
          matrix: mesh.instanceMatrix.array.slice(),
          color: mesh.instanceColor?.array.slice() ?? null,
          bounds,
          kept: mesh.count,
          indices: bounds.map((_, i) => i),
        });
      }
    });
    // Validate the complete addition set before taking ownership.
    for (const e of additions) {
      entries.push(e);
      seen.add(e.mesh);
    }
    // Jungle parts bake their local transforms into geometry, then share exact
    // placement matrices. Union their footprints so trunks and canopies agree.
    const placements = new Map();
    for (const e of entries) {
      for (let i = 0; i < e.count; i++) {
        const key = `${e.mesh.parent.uuid}:${Array.from(e.matrix.subarray(i * 16, i * 16 + 16)).join(',')}`;
        const b = e.bounds[i];
        const shared = placements.get(key);
        if (shared) {
          shared[0] = Math.min(shared[0], b[0]);
          shared[1] = Math.max(shared[1], b[1]);
          shared[2] = Math.min(shared[2], b[2]);
          shared[3] = Math.max(shared[3], b[3]);
          e.bounds[i] = shared;
        } else placements.set(key, b);
      }
    }
    // Registered static subtrees include the giant Evergarden/Palmreach trees.
    // Keep complete models together. Dynamic or instanced subtrees remain under
    // their existing group sweep; jungle instances additionally pack above.
    for (const entry of renderer.zoneFeatureGroups) {
      for (const object of entry.group.children) {
        if (objectSeen.has(object) || object.isInstancedMesh) continue;
        const bounds = [Infinity, -Infinity, Infinity, -Infinity];
        let supported = true;
        let meshes = 0;
        object.traverse((node) => {
          if (node.matrixAutoUpdate || node.isInstancedMesh || node.isSkinnedMesh)
            supported = false;
          if (!node.isMesh) return;
          node.geometry.computeBoundingBox();
          const b = node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld);
          bounds[0] = Math.min(bounds[0], b.min.x);
          bounds[1] = Math.max(bounds[1], b.max.x);
          bounds[2] = Math.min(bounds[2], b.min.z);
          bounds[3] = Math.max(bounds[3], b.max.z);
          meshes++;
        });
        if (!supported || !meshes || !bounds.every(Number.isFinite)) continue;
        objects.push({ object, visible: object.visible, bounds, root: entry.group.name });
        objectSeen.add(object);
      }
    }
    lastX = Number.NaN;
    apply();
    applyObjects();
  }

  function upload(e) {
    for (const attr of [e.mesh.instanceMatrix, e.mesh.instanceColor]) {
      if (!attr) continue;
      attr.clearUpdateRanges();
      if (e.kept > 0) attr.addUpdateRange(0, e.kept * attr.itemSize);
      attr.needsUpdate = true;
    }
    e.mesh.count = e.kept;
  }

  function apply() {
    const { x, z } = renderer.camera.position;
    // Baseline needs restoration once, without introducing movement uploads.
    if (!cap && Number.isFinite(lastX)) return;
    if (Math.hypot(x - lastX, z - lastZ) < 4) return;
    lastX = x;
    lastZ = z;
    serial++;
    for (const e of entries) {
      e.indices = [];
      for (let i = 0; i < e.count; i++) {
        const [minX, maxX, minZ, maxZ] = e.bounds[i];
        const dx = Math.max(minX - x, x - maxX, 0);
        const dz = Math.max(minZ - z, z - maxZ, 0);
        // Four-yard movement margin, measured from the full instance footprint.
        // Even the strongest candidate remains far outside the 40-yard collider floor.
        if (cap && Math.hypot(dx, dz) > cap + 4) continue;
        const j = e.indices.length;
        e.mesh.instanceMatrix.array.set(e.matrix.subarray(i * 16, i * 16 + 16), j * 16);
        if (e.color) {
          const n = e.mesh.instanceColor.itemSize;
          e.mesh.instanceColor.array.set(e.color.subarray(i * n, i * n + n), j * n);
        }
        e.indices.push(i);
      }
      e.kept = e.indices.length;
      upload(e);
    }
  }

  function update(...args) {
    if (renderer.foliage !== foliage) throw Error('Renderer rebuilt during experiment');
    if (cap) args[9] = Math.min(args[9], cap);
    const result = originalUpdate.apply(this, args);
    apply();
    applyObjects();
    return result;
  }

  function horizonUpdate(distance) {
    const result = originalHorizon.call(this, distance);
    return cap ? Math.min(result, cap) : result;
  }

  function sweep(distance) {
    const result = originalSweep.call(this, cap ? Math.min(distance, cap) : distance);
    applyObjects();
    return result;
  }

  function render(scene, ...args) {
    const hidden = [];
    if (sceneryOff && scene === renderer.scene) {
      for (const root of scene.children) {
        if (root.visible && ['props', 'foliage'].includes(root.userData.renderCategory)) {
          hidden.push(root);
          root.visible = false;
        }
      }
      suppressedRoots = hidden.length;
    }
    try {
      return originalRender.call(this, scene, ...args);
    } finally {
      for (const root of hidden) root.visible = true;
    }
  }

  refresh();
  foliage.update = update;
  horizon.sceneryCullFar = horizonUpdate;
  renderer.updateZoneFeatureVisibility = sweep;
  renderer.webgl.render = render;
  return {
    retains(mesh, index) {
      const entry = entries.find((e) => e.mesh === mesh);
      return entry ? entry.indices.includes(index) : null;
    },
    setSceneryOff(enabled) {
      if (disposed) throw Error('Experiment disposed');
      sceneryOff = enabled;
      if (!enabled) suppressedRoots = 0;
    },
    set(value) {
      if (disposed) throw Error('Experiment disposed');
      if (![0, 60, 80, 120].includes(value)) throw Error('Unsupported distance');
      cap = value;
      lastX = Number.NaN;
      apply();
      applyObjects();
    },
    refresh,
    snapshot() {
      return {
        cap,
        sceneryOff,
        suppressedRoots,
        serial,
        objects: objects.map((e) => ({
          uuid: e.object.uuid,
          root: e.root,
          bounds: e.bounds,
          originallyVisible: e.visible,
          visible: e.object.visible,
        })),
        entries: entries.map((e) => ({
          uuid: e.mesh.uuid,
          root: e.mesh.parent?.name,
          total: e.count,
          kept: e.kept,
          indices: e.indices.slice(),
          bounds: e.bounds,
          placementsExact: e.indices.every((idx, j) =>
            e.matrix
              .subarray(idx * 16, idx * 16 + 16)
              .every((v, k) => v === e.mesh.instanceMatrix.array[j * 16 + k]),
          ),
        })),
      };
    },
    dispose() {
      if (disposed) return;
      cap = 0;
      lastX = Number.NaN;
      apply();
      for (const e of objects) e.object.visible = e.visible;
      if (foliage.update === update) foliage.update = originalUpdate;
      if (horizon.sceneryCullFar === horizonUpdate) horizon.sceneryCullFar = originalHorizon;
      if (renderer.updateZoneFeatureVisibility === sweep)
        renderer.updateZoneFeatureVisibility = originalSweep;
      if (renderer.webgl.render === render) renderer.webgl.render = originalRender;
      disposed = true;
    },
  };
}
