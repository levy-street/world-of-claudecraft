// Pose-to-pose key interpolation. Keys are sparse nested poses at clip seconds:
//   [{ t: 0, chest: [4, 0, 0], arm: { r: { raise: 20 } } }, { t: 0.4, ... }]
// Every numeric leaf is its own channel, interpolated only across the keys
// that set it. Interpolation is a non-uniform Catmull-Rom Hermite spline;
// `ease` on a key (0..1) flattens that key's tangent (1 = full ease in/out),
// and `linear` keys (ease: -1) keep constant velocity through a pass.
// Looping clips wrap their neighbours across the seam; one-shots ease to rest
// at both ends unless the end key sets its own ease.

function flatten(value, prefix, out) {
  if (typeof value === 'number') out[prefix] = value;
  else if (Array.isArray(value))
    value.forEach((v, i) => {
      flatten(v, `${prefix}.${i}`, out);
    });
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

function assign(target, path, value) {
  const parts = path.split('.');
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = parts[i + 1];
    node[parts[i]] ??= /^\d+$/.test(next) ? [] : {};
    node = node[parts[i]];
  }
  node[parts.at(-1)] = value;
}

/**
 * A Catmull-Rom path through [u, value] points with given end slopes, for
 * segments that must join another motion with matching velocity.
 */
export function hermitePath(points, startSlope, endSlope) {
  const n = points.length;
  const slope = (i) => {
    if (i === 0) return startSlope;
    if (i === n - 1) return endSlope;
    return (points[i + 1][1] - points[i - 1][1]) / (points[i + 1][0] - points[i - 1][0]);
  };
  return (u) => {
    let i = 0;
    while (i < n - 2 && u > points[i + 1][0]) i++;
    const [ua, a] = points[i],
      [ub, b] = points[i + 1];
    const span = ub - ua;
    const s = Math.max(0, Math.min(1, (u - ua) / span));
    const s2 = s * s,
      s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * a +
      (s3 - 2 * s2 + s) * slope(i) * span +
      (-2 * s3 + 3 * s2) * b +
      (s3 - s2) * slope(i + 1) * span
    );
  };
}

/** A sampler for sparse keyed poses: `sample(seconds)` returns a nested pose. */
export function keyedTrack(keys, { duration, loop, lag = {} }) {
  const channels = new Map();
  for (const key of keys) {
    if (!(key.t >= 0 && key.t <= duration + 1e-9)) throw Error(`Key time ${key.t} outside clip`);
    const { t, ease = 0, ...pose } = key;
    for (const [path, value] of Object.entries(flatten(pose, '', {}))) {
      if (!channels.has(path)) channels.set(path, []);
      channels.get(path).push({ t, v: value, ease });
    }
  }
  for (const [path, list] of channels) {
    list.sort((a, b) => a.t - b.t);
    if (loop && list.length > 1 && Math.abs(list.at(-1).t - duration) < 1e-9) {
      // A loop's end key duplicates its start: drop it, after checking they agree.
      if (Math.abs(list.at(-1).v - list[0].v) > 1e-9 || list[0].t > 1e-9)
        throw Error(`Loop seam mismatch on ${path}`);
      list.pop();
    }
  }
  const lagFor = (path) => {
    let best = 0,
      length = -1;
    for (const [prefix, seconds] of Object.entries(lag))
      if ((path === prefix || path.startsWith(`${prefix}.`)) && prefix.length > length) {
        best = seconds;
        length = prefix.length;
      }
    return best;
  };
  const lags = new Map([...channels.keys()].map((p) => [p, lagFor(p)]));

  function point(list, i) {
    // Wrapped neighbour access for loops; clamped (repeated) for one-shots.
    const n = list.length;
    if (loop) {
      const k = ((i % n) + n) % n;
      const shift = Math.floor(i / n) * duration;
      return { t: list[k].t + shift, v: list[k].v, ease: list[k].ease };
    }
    return list[Math.max(0, Math.min(n - 1, i))];
  }
  function tangent(list, i) {
    const p = point(list, i);
    if (p.ease === -1) {
      const a = point(list, i - 1),
        b = point(list, i + 1);
      return (b.v - a.v) / (b.t - a.t || 1);
    }
    if (!loop && (i <= 0 || i >= list.length - 1)) return 0;
    const a = point(list, i - 1),
      b = point(list, i + 1);
    const slope = (b.v - a.v) / (b.t - a.t);
    return slope * (1 - Math.max(0, Math.min(1, p.ease)));
  }
  function value(list, time) {
    if (list.length === 1) return list[0].v;
    let t = time;
    if (loop) t = ((t % duration) + duration) % duration;
    else t = Math.max(0, Math.min(duration, t));
    let i = -1;
    for (let k = 0; k < list.length; k++) if (list[k].t <= t) i = k;
    if (!loop && i < 0) return list[0].v;
    if (!loop && i === list.length - 1) return list.at(-1).v;
    const a = point(list, i),
      b = point(list, i + 1);
    const ta = a.t;
    const span = b.t - ta;
    const u = (t - ta) / span;
    const ma = tangent(list, i) * span,
      mb = tangent(list, i + 1) * span;
    const u2 = u * u,
      u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * a.v +
      (u3 - 2 * u2 + u) * ma +
      (-2 * u3 + 3 * u2) * b.v +
      (u3 - u2) * mb
    );
  }
  return {
    channels: [...channels.keys()],
    sample(seconds) {
      const pose = {};
      for (const [path, list] of channels)
        assign(pose, path, value(list, seconds - lags.get(path)));
      return pose;
    },
  };
}
