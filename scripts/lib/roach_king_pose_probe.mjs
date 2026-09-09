// Browser-only diagnostic functions passed to page.evaluate. These observe the
// real renderer's rig; they never drive its mixer or alter authored bone poses.
export function installRoachMotionProbe(bossId) {
  const { renderer } = window.__game;
  const view = renderer.views.get(bossId);
  const visual = view?.visual;
  if (!visual || visual.__roachMotionProbe) return;
  visual.__roachMotionProbe = true;
  window.__roachMotion ??= {};
  const record = { frames: [] };
  window.__roachMotion[view.visualKey] = record;
  const update = visual.update.bind(visual);
  const bones = [];
  visual.model.traverse((node) => {
    if (node.isBone) bones.push({ bone: node, previous: node.quaternion.clone() });
  });
  visual.update = (dt, state, animate, ...rest) => {
    update(dt, state, animate, ...rest);
    if (!animate || record.frames.length >= 2400) return;
    let maxBoneRadians = 0;
    let fastestBone = null;
    for (const sample of bones) {
      const angle = sample.previous.angleTo(sample.bone.quaternion);
      if (angle > maxBoneRadians) {
        maxBoneRadians = angle;
        fastestBone = sample.bone.name;
      }
      sample.previous.copy(sample.bone.quaternion);
    }
    const actions = [...visual.actions.entries()]
      .filter(([, action]) => action.isScheduled() && action.getEffectiveWeight() > 0)
      .map(([name, action]) => ({
        name,
        weight: action.getEffectiveWeight(),
        time: action.time,
        paused: action.paused,
      }));
    record.frames.push({
      dt,
      casting: state.castingAbility,
      dead: state.dead,
      moving: state.moving,
      maxBoneRadians,
      fastestBone,
      // A finished callback may schedule a cached base action after its mixer
      // slot ran. Its time-zero effectiveWeight is stale until the next sample.
      pendingActionSample: actions.some((action) => action.time === 0 && !action.paused),
      weight: actions.reduce((sum, action) => sum + action.weight, 0),
      actions,
    });
  };
}

export function roachBodyContactProbe(bossId) {
  const { renderer } = window.__game;
  const view = renderer.views.get(bossId);
  if (!view?.visual?.modelWrap) return null;
  const bodyClearances = [];
  const bodyPoints = [];
  const allClearances = [];
  const edgeRatios = [];
  const meshes = [];
  view.visual.modelWrap.updateWorldMatrix(true, true);
  view.visual.modelWrap.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    mesh.skeleton.update();
    const positions = mesh.geometry.attributes.position;
    const weights = mesh.geometry.attributes.skinWeight;
    const joints = mesh.geometry.attributes.skinIndex;
    // These are the inspected king rig's thorax and abdomen, despite Tripo
    // naming the thorax like a leg. A grounded head, mandible or paw must never
    // certify a suspended shell. Root weights are remapped by the asset repair.
    const trunkNames = new Set(['tripo0_Left_Limb_0', 'bone_2']);
    const trunk = mesh.skeleton.bones.map(
      (bone) =>
        view.visualKey === 'mob_roach_king' &&
        trunkNames.has(bone.name.replace(/[^a-z0-9_]/gi, '')),
    );
    const point = mesh.position.clone();
    const local = [];
    let bodyVertices = 0;
    for (let i = 0; i < positions.count; i++) {
      mesh.getVertexPosition(i, point);
      local.push(point.clone());
      mesh.localToWorld(point);
      const clearance = point.y - renderer.mageGroundFx.groundY(point.x, point.z);
      allClearances.push(clearance);
      let trunkWeight = 0;
      for (let component = 0; component < 4; component++) {
        if (trunk[joints.getComponent(i, component)])
          trunkWeight += weights.getComponent(i, component);
      }
      if (trunkWeight > 0.8) {
        bodyVertices++;
        bodyClearances.push(clearance);
        bodyPoints.push(point.clone());
      }
    }
    // Ignore subpixel tessellation edges: compression error on a microscopic
    // edge must not outrank a stretched paw or a torn carapace triangle.
    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox.getSize(point);
    const minEdge = Math.max(size.x, size.y, size.z) * 0.002;
    const meshEdges = [];
    const indices = mesh.geometry.index;
    const count = indices?.count ?? positions.count;
    const a = point.clone();
    const b = point.clone();
    for (let i = 0; i < count; i += 3) {
      const triangle = [0, 1, 2].map((j) => indices?.getX(i + j) ?? i + j);
      for (let j = 0; j < 3; j++) {
        const left = triangle[j];
        const right = triangle[(j + 1) % 3];
        a.fromBufferAttribute(positions, left);
        b.fromBufferAttribute(positions, right);
        const restLength = a.distanceTo(b);
        if (restLength >= minEdge)
          meshEdges.push(local[left].distanceTo(local[right]) / restLength);
      }
    }
    meshEdges.sort((a, b) => a - b);
    // Imported armatures can carry a uniform scale outside the geometry.
    // Normalize by the median rigid edge, preserving local stretching ratios.
    const rigidScale = meshEdges[Math.floor(meshEdges.length / 2)] ?? 1;
    edgeRatios.push(...meshEdges.map((ratio) => ratio / rigidScale));
    meshes.push({ name: mesh.name, vertices: positions.count, bodyVertices, rigidScale });
  });
  function distribution(values) {
    if (!values.length) return null;
    values.sort((a, b) => a - b);
    const at = (p) => values[Math.floor((values.length - 1) * p)];
    return { min: at(0), p01: at(0.01), p05: at(0.05), median: at(0.5), p99: at(0.99), max: at(1) };
  }
  // Independently raycast the rendered arena at low body samples. This catches
  // disagreement between authored support, the sim base and the warning sampler.
  let renderedFloor = null;
  if (bodyPoints.length) {
    const roots = [...renderer.riftInteriorGroups.values()];
    const ray = new renderer.raycaster.constructor();
    ray.ray.direction.set(0, -1, 0);
    ray.far = 10;
    bodyPoints.sort((a, b) => a.y - b.y);
    const samples = bodyPoints.slice(0, 32).filter((_, index) => index % 2 === 0);
    renderedFloor = samples.map((point) => {
      const warningY = renderer.mageGroundFx.groundY(point.x, point.z);
      ray.ray.origin.set(point.x, warningY + 0.5, point.z);
      const hit = ray.intersectObjects(roots, true).find((candidate) => {
        for (let node = candidate.object; node; node = node.parent) if (!node.visible) return false;
        const normal = candidate.face?.normal
          .clone()
          .transformDirection(candidate.object.matrixWorld);
        return normal && normal.y > 0.9;
      });
      return {
        x: point.x,
        z: point.z,
        bodyY: point.y,
        warningY,
        floorY: hit?.point.y ?? null,
        clearance: hit ? point.y - hit.point.y : null,
        surface: hit?.object.name ?? null,
      };
    });
  }
  return {
    meshes,
    renderedFloor,
    bodyVertices: bodyClearances.length,
    bodyClearance: distribution(bodyClearances),
    allClearance: distribution(allClearances),
    bodyContactFraction:
      bodyClearances.filter((gap) => Math.abs(gap) <= 0.35).length /
      Math.max(1, bodyClearances.length),
    edgeStretch: distribution(edgeRatios),
  };
}

export function roachPoseFailures(stages, motion = {}) {
  const failures = [];
  for (const [name, stage] of Object.entries(stages)) {
    if (stage.boss.visualKey !== 'mob_roach_king') continue;
    if (!stage.pose?.edgeStretch || stage.pose.edgeStretch.max > 4)
      failures.push(`${name}: stretched king skin triangles`);
  }
  const corpse = stages['death-end']?.pose;
  if (!corpse || corpse.bodyVertices < 1000)
    failures.push('Missing substantial corpse body sample');
  const floor = corpse?.renderedFloor?.filter((sample) => sample.clearance !== null) ?? [];
  if (floor.length < 8 || !floor.some((sample) => Math.abs(sample.clearance) < 0.15))
    failures.push('Corpse shell does not contact the rendered arena');
  if (floor.filter((sample) => Math.abs(sample.clearance) < 0.35).length < floor.length / 4)
    failures.push('Corpse has only isolated point contact');
  for (const [key, record] of Object.entries(motion)) {
    if (
      record.frames.some(
        (frame) => !frame.pendingActionSample && (frame.weight < 0.98 || frame.weight > 1.02),
      )
    )
      failures.push(`${key}: animation transition loses normalized pose weight`);
  }
  return failures;
}

export async function captureRoachCorpseAngles(page, bossId, paths) {
  const saved = await page.evaluate((id) => {
    const panel = document.querySelector('[title="Click to copy a JSON perf report"]');
    if (panel) panel.style.visibility = 'hidden';
    const { sim, input } = window.__game;
    const previous = {
      position: { ...sim.player.pos },
      yaw: input.camYaw,
      pitch: input.camPitch,
      distance: input.camDist,
    };
    sim.player.pos = { ...sim.entities.get(id).pos };
    sim.player.prevPos = { ...sim.player.pos };
    input.camPitch = 0.22;
    input.camDist = 18;
    return previous;
  }, bossId);
  for (const [index, file] of paths.entries()) {
    await page.evaluate(
      (yaw) => {
        window.__game.input.camYaw = yaw;
      },
      Math.PI / 2 + index * Math.PI,
    );
    await new Promise((resolve) => setTimeout(resolve, 800));
    await page.screenshot({ path: file });
  }
  await page.evaluate((previous) => {
    const { sim, input } = window.__game;
    sim.player.pos = previous.position;
    sim.player.prevPos = { ...previous.position };
    input.camYaw = previous.yaw;
    input.camPitch = previous.pitch;
    input.camDist = previous.distance;
    const panel = document.querySelector('[title="Click to copy a JSON perf report"]');
    if (panel) panel.style.visibility = '';
  }, saved);
}
