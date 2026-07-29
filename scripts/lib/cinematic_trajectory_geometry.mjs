const EPSILON = 1e-9;

export function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function signedRectDistance(point, rect) {
  const dx = Math.abs(point.x - rect.x) - rect.hw;
  const dz = Math.abs(point.z - rect.z) - rect.hd;
  if (dx <= 0 && dz <= 0) return Math.max(dx, dz);
  return Math.hypot(Math.max(0, dx), Math.max(0, dz));
}

export function measureSegment(sampleWorld, duration, sampleRateHz) {
  if (duration <= 0) {
    const start = sampleWorld(-1);
    const end = sampleWorld(0);
    return {
      start,
      end,
      maximumSpeed: pointDistance(start, end) <= EPSILON ? 0 : Number.POSITIVE_INFINITY,
    };
  }
  const interval = 1 / sampleRateHz;
  const steps = Math.max(1, Math.ceil(duration * sampleRateHz));
  let maximumSpeed = 0;
  let previousTime = 0;
  let previous = sampleWorld(0);
  for (let step = 1; step <= steps; step++) {
    const time = Math.min(duration, step * interval);
    const current = sampleWorld(time);
    maximumSpeed = Math.max(maximumSpeed, pointDistance(current, previous) / (time - previousTime));
    previous = current;
    previousTime = time;
  }
  return {
    start: sampleWorld(0),
    end: sampleWorld(duration),
    maximumSpeed,
  };
}

export function measureArrivalApproach({ berth, landward, start, end, bow }) {
  const seaward = normalizeFlat({
    x: berth.x - landward.x,
    z: berth.z - landward.z,
  });
  const startFromBerth = {
    x: start.x - berth.x,
    z: start.z - berth.z,
  };
  const travel = normalizeFlat({
    x: end.x - start.x,
    z: end.z - start.z,
  });
  const landwardDirection = { x: -seaward.x, z: -seaward.z };
  return {
    seawardStart: flatDot(startFromBerth, seaward),
    towardBerth: flatDot(travel, landwardDirection),
    bowFirst: flatDot(travel, bow),
    berthDistance: Math.hypot(end.x - berth.x, end.z - berth.z),
  };
}

function normalizeFlat(point) {
  const magnitude = Math.hypot(point.x, point.z);
  if (magnitude <= EPSILON) return { x: 0, z: 0 };
  return { x: point.x / magnitude, z: point.z / magnitude };
}

function flatDot(a, b) {
  return a.x * b.x + a.z * b.z;
}
