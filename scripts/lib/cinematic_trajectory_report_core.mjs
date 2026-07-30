import { WORLD_SEED } from '../../src/world_seed.mjs';
import {
  measureArrivalApproach,
  measureSegment,
  pointDistance,
  signedRectDistance,
  worldToLocal,
} from './cinematic_trajectory_geometry.mjs';

export const SAMPLE_RATE_HZ = 20;
const SAMPLE_INTERVAL_SEC = 1 / SAMPLE_RATE_HZ;

export { WORLD_SEED };

const EPSILON = 1e-9;

function shipTarget(harbor) {
  return `harbor_ship_${harbor.id}`;
}

function harborForTarget(runtime, target) {
  return runtime.HARBORS.find((harbor) => shipTarget(harbor) === target) ?? null;
}

function basePose(runtime, harbor) {
  return {
    baseX: harbor.berth.x,
    baseY: runtime.WATER_LEVEL - harbor.berth.draft,
    baseZ: harbor.berth.z,
    baseRot: harbor.berth.rot,
  };
}

function shipFrameForPose(runtime, harbor, pose) {
  return runtime.composeHarborShipAttachFrame(basePose(runtime, harbor), pose, {
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
  });
}

function activePropAt(runtime, scene, target, time) {
  let active = null;
  for (const op of scene.ops) {
    if (op.at > time + EPSILON) break;
    if (op.kind !== 'prop' || op.target !== target) continue;
    const segment = runtime.LAST_BELL_PROP_PATH_SEGMENTS[op.cue];
    active = segment ? { cue: op.cue, segment, startedAt: op.at } : null;
  }
  return active;
}

function shipFrameAt(runtime, scene, harbor, time) {
  const active = activePropAt(runtime, scene, shipTarget(harbor), time);
  const pose = active
    ? runtime.propPathPoseAt(active.segment, time - active.startedAt)
    : { x: 0, y: 0, z: 0, yaw: 0, done: true };
  return shipFrameForPose(runtime, harbor, pose);
}

function shipDeckLocalCenter(runtime, harbor) {
  const parked = shipFrameForPose(runtime, harbor, {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    done: true,
  });
  const deck = harbor.shipDecks[0];
  return worldToLocal(parked, { x: deck.x, y: deck.y, z: deck.z });
}

function shipDeckLocalRect(runtime, harbor, deck) {
  const parked = shipFrameForPose(runtime, harbor, {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    done: true,
  });
  const corners = [
    { x: deck.x - deck.hw, y: deck.y, z: deck.z - deck.hd },
    { x: deck.x - deck.hw, y: deck.y, z: deck.z + deck.hd },
    { x: deck.x + deck.hw, y: deck.y, z: deck.z - deck.hd },
    { x: deck.x + deck.hw, y: deck.y, z: deck.z + deck.hd },
  ].map((corner) => worldToLocal(parked, corner));
  const x0 = Math.min(...corners.map((corner) => corner.x));
  const x1 = Math.max(...corners.map((corner) => corner.x));
  const z0 = Math.min(...corners.map((corner) => corner.z));
  const z1 = Math.max(...corners.map((corner) => corner.z));
  return {
    x: (x0 + x1) / 2,
    z: (z0 + z1) / 2,
    hw: (x1 - x0) / 2,
    hd: (z1 - z0) / 2,
  };
}

function shipDeckCenterAt(runtime, scene, harbor, time) {
  return runtime.sceneRigLocalToWorld(
    shipFrameAt(runtime, scene, harbor, time),
    shipDeckLocalCenter(runtime, harbor),
    { x: 0, y: 0, z: 0 },
  );
}

function closestLiveShipRect(runtime, scene, camera, time) {
  let minimum = Number.POSITIVE_INFINITY;
  let label = 'none';
  for (const harbor of runtime.HARBORS) {
    const localCamera = worldToLocal(shipFrameAt(runtime, scene, harbor, time), camera);
    for (let index = 0; index < harbor.shipDecks.length; index++) {
      const distance = signedRectDistance(
        localCamera,
        shipDeckLocalRect(runtime, harbor, harbor.shipDecks[index]),
      );
      if (distance < minimum) {
        minimum = distance;
        label = `${harbor.id}.ship${index + 1}`;
      }
    }
  }
  return { distance: minimum, label };
}

function closestLiveShipHull(runtime, scene, camera, time) {
  let minimum = Number.POSITIVE_INFINITY;
  let label = 'none';
  for (const harbor of runtime.HARBORS) {
    const localCamera = worldToLocal(shipFrameAt(runtime, scene, harbor, time), camera);
    const distance = signedRectDistance(localCamera, runtime.harborShipLocalBounds(harbor.berth));
    if (distance < minimum) {
      minimum = distance;
      label = `${harbor.id}.hull`;
    }
  }
  return { distance: minimum, label };
}

function resolveRigPoint(runtime, point) {
  return {
    x: point.x,
    y: runtime.groundHeight(point.x, point.z, WORLD_SEED) + point.height,
    z: point.z,
  };
}

function resolveRigShot(runtime, shot) {
  if (shot.kind === 'attach') {
    return {
      ...shot,
      fallbackFrame: {
        position: resolveRigPoint(runtime, shot.fallbackFrame.point),
        yaw: shot.fallbackFrame.yaw,
      },
    };
  }
  if (shot.kind !== 'dolly') {
    throw new Error(`trajectory report does not support camera/${shot.kind}`);
  }
  let lookAt;
  if (shot.lookAt.kind === 'point') {
    lookAt = { kind: 'point', point: resolveRigPoint(runtime, shot.lookAt.point) };
  } else if (shot.lookAt.kind === 'spline') {
    lookAt = {
      kind: 'spline',
      points: shot.lookAt.points.map((point) => resolveRigPoint(runtime, point)),
    };
  } else {
    throw new Error('trajectory report requires resolved entities for subject look-at shots');
  }
  return {
    kind: 'dolly',
    points: shot.points.map((point) => resolveRigPoint(runtime, point)),
    lookAt,
    dur: shot.dur,
  };
}

function closestPierRect(runtime, camera) {
  let minimum = Number.POSITIVE_INFINITY;
  let label = 'none';
  for (const harbor of runtime.HARBORS) {
    for (let index = 0; index < harbor.decks.length; index++) {
      const distance = signedRectDistance(camera, harbor.decks[index]);
      if (distance < minimum) {
        minimum = distance;
        label = `${harbor.id}.deck${index + 1}`;
      }
    }
    for (let index = 0; index < harbor.ramps.length; index++) {
      const distance = signedRectDistance(camera, harbor.ramps[index]);
      if (distance < minimum) {
        minimum = distance;
        label = `${harbor.id}.ramp${index + 1}`;
      }
    }
  }
  return { distance: minimum, label };
}

function segmentWorldSample(runtime, harbor, segment, elapsed) {
  return shipFrameForPose(runtime, harbor, runtime.propPathPoseAt(segment, elapsed)).position;
}

function segmentMetrics(runtime, harbor, segment) {
  return measureSegment(
    (elapsed) => segmentWorldSample(runtime, harbor, segment, elapsed),
    segment.duration,
    SAMPLE_RATE_HZ,
  );
}

function arrivalCueIds(runtime) {
  return new Set([
    runtime.LAST_BELL_VOYAGE_SEGMENT_IDS.out.arrival,
    runtime.LAST_BELL_VOYAGE_SEGMENT_IDS.back.arrival,
  ]);
}

function arrivalMetrics(runtime, harbor, segment) {
  const metrics = segmentMetrics(runtime, harbor, segment);
  const startFrame = shipFrameForPose(runtime, harbor, runtime.propPathPoseAt(segment, 0));
  const bow = { x: Math.cos(startFrame.yaw), z: -Math.sin(startFrame.yaw) };
  return measureArrivalApproach({
    berth: harbor.berth,
    landward: harbor.arrival,
    start: metrics.start,
    end: metrics.end,
    bow,
  });
}

function formatRange(minimum, maximum) {
  return `${minimum.toFixed(1)}..${maximum.toFixed(1)}`;
}

function formatWorldPoint(point) {
  return `(${point.x.toFixed(1)},${point.y.toFixed(1)},${point.z.toFixed(1)})`;
}

function shotLabel(shot) {
  return shot.kind === 'attach' ? `attach/${shot.target.replace('harbor_ship_', '')}` : shot.kind;
}

export function reportScene(runtime, scene) {
  const cameraOps = scene.ops.filter((op) => op.kind === 'camera');
  const shots = cameraOps.filter((op) => op.shot.kind !== 'release');
  console.log(
    `\n${scene.id} (${scene.duration.toFixed(1)}s, ${SAMPLE_RATE_HZ} Hz, seed ${WORLD_SEED})`,
  );
  if (shots.length === 0) {
    console.log('  no camera or prop trajectory shots');
    return;
  }
  console.log(
    '  # time        shot              camera xyz ranges                  clear terrain/water wet   fixed pier xz     live deck xz      hull xz           ship dist   prop path, max speed                    arrival',
  );
  const arrivalIds = arrivalCueIds(runtime);
  for (let index = 0; index < shots.length; index++) {
    const cameraOp = shots[index];
    const next = cameraOps.find((candidate) => candidate.at > cameraOp.at + EPSILON);
    const endAt = Math.min(scene.duration, next?.at ?? scene.duration);
    const resolved = resolveRigShot(runtime, cameraOp.shot);
    const sampleCount = Math.max(1, Math.ceil((endAt - cameraOp.at) * SAMPLE_RATE_HZ));
    const range = {
      x0: Number.POSITIVE_INFINITY,
      x1: Number.NEGATIVE_INFINITY,
      y0: Number.POSITIVE_INFINITY,
      y1: Number.NEGATIVE_INFINITY,
      z0: Number.POSITIVE_INFINITY,
      z1: Number.NEGATIVE_INFINITY,
    };
    let terrainClearance = Number.POSITIVE_INFINITY;
    let waterClearance = Number.POSITIVE_INFINITY;
    let wetSamples = 0;
    let pierDistance = Number.POSITIVE_INFINITY;
    let pierLabel = 'none';
    let liveShipDistance = Number.POSITIVE_INFINITY;
    let liveShipLabel = 'none';
    let hullDistance = Number.POSITIVE_INFINITY;
    let hullLabel = 'none';
    let shipDistanceMin = Number.POSITIVE_INFINITY;
    let shipDistanceMax = Number.NEGATIVE_INFINITY;
    const attachedHarbor =
      resolved.kind === 'attach' ? harborForTarget(runtime, resolved.target) : null;
    for (let sample = 0; sample <= sampleCount; sample++) {
      const time = Math.min(endAt, cameraOp.at + sample * SAMPLE_INTERVAL_SEC);
      const pose = runtime.evaluateSceneRigPose(
        resolved,
        time - cameraOp.at,
        () => null,
        (target) => {
          const harbor = harborForTarget(runtime, target);
          return harbor ? shipFrameAt(runtime, scene, harbor, time) : null;
        },
      );
      const camera = runtime.sceneRigCameraPosition(pose);
      range.x0 = Math.min(range.x0, camera.x);
      range.x1 = Math.max(range.x1, camera.x);
      range.y0 = Math.min(range.y0, camera.y);
      range.y1 = Math.max(range.y1, camera.y);
      range.z0 = Math.min(range.z0, camera.z);
      range.z1 = Math.max(range.z1, camera.z);
      const terrain = runtime.terrainHeight(camera.x, camera.z, WORLD_SEED);
      terrainClearance = Math.min(terrainClearance, camera.y - terrain);
      waterClearance = Math.min(waterClearance, camera.y - runtime.WATER_LEVEL);
      if (terrain < runtime.WATER_LEVEL) wetSamples++;
      const pier = closestPierRect(runtime, camera);
      if (pier.distance < pierDistance) {
        pierDistance = pier.distance;
        pierLabel = pier.label;
      }
      const liveShip = closestLiveShipRect(runtime, scene, camera, time);
      if (liveShip.distance < liveShipDistance) {
        liveShipDistance = liveShip.distance;
        liveShipLabel = liveShip.label;
      }
      const hull = closestLiveShipHull(runtime, scene, camera, time);
      if (hull.distance < hullDistance) {
        hullDistance = hull.distance;
        hullLabel = hull.label;
      }
      if (attachedHarbor) {
        const shipCenter = shipDeckCenterAt(runtime, scene, attachedHarbor, time);
        const distance = pointDistance(camera, shipCenter);
        shipDistanceMin = Math.min(shipDistanceMin, distance);
        shipDistanceMax = Math.max(shipDistanceMax, distance);
      }
    }
    const active =
      resolved.kind === 'attach'
        ? activePropAt(runtime, scene, resolved.target, cameraOp.at)
        : null;
    let prop = '-';
    let arrival = '-';
    if (active && attachedHarbor) {
      const metrics = segmentMetrics(runtime, attachedHarbor, active.segment);
      prop = `${active.cue} ${formatWorldPoint(metrics.start)}>${formatWorldPoint(
        metrics.end,
      )} ${metrics.maximumSpeed.toFixed(1)}yd/s`;
      if (arrivalIds.has(active.cue)) {
        const approach = arrivalMetrics(runtime, attachedHarbor, active.segment);
        arrival = `sea ${approach.seawardStart.toFixed(1)} dot ${approach.towardBerth.toFixed(
          3,
        )} bow ${approach.bowFirst.toFixed(3)} berth ${approach.berthDistance.toFixed(1)}`;
      }
    }
    const wetPercent = (wetSamples / (sampleCount + 1)) * 100;
    const shipDistance =
      attachedHarbor === null ? '-' : formatRange(shipDistanceMin, shipDistanceMax);
    console.log(
      `  ${String(index + 1).padStart(2)} ${cameraOp.at.toFixed(2).padStart(5)}-${endAt
        .toFixed(2)
        .padEnd(5)} ${shotLabel(resolved).padEnd(17)} x${formatRange(
        range.x0,
        range.x1,
      )} y${formatRange(range.y0, range.y1)} z${formatRange(
        range.z0,
        range.z1,
      )}  ${terrainClearance.toFixed(1).padStart(5)}/${waterClearance
        .toFixed(1)
        .padStart(5)} ${wetPercent.toFixed(0).padStart(3)}%  ${pierDistance
        .toFixed(1)
        .padStart(5)} ${pierLabel.padEnd(17)} ${liveShipDistance
        .toFixed(1)
        .padStart(5)} ${liveShipLabel.padEnd(16)} ${hullDistance
        .toFixed(1)
        .padStart(5)} ${hullLabel.padEnd(16)} ${shipDistance.padStart(10)}  ${prop}  ${arrival}`,
    );
  }
}
