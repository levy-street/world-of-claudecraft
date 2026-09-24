// CPU-only diagnostic of actual skinned soles, independently sampled from
// the exported clips. Never modifies the file, source or renderer state.
import { Matrix4, Vector3 } from 'three';
import { createGlbIO, indexClip, samplePose } from './pose_blend.mjs';
export async function measureWolfGait(input, sampleCount = 160) {
  const doc = await createGlbIO().read(input),
    root = doc.getRoot();
  const nodes = root.listNodes(),
    bind = nodes.map((n) => [n, n.getTranslation(), n.getRotation(), n.getScale()]);
  function reset() {
    for (const [n, a, b, c] of bind) n.setTranslation(a).setRotation(b).setScale(c);
  }
  function apply(clip, t) {
    reset();
    for (const [k, v] of samplePose(clip, t)) {
      const c = clip.get(k);
      c.node[
        c.path === 'rotation'
          ? 'setRotation'
          : c.path === 'translation'
            ? 'setTranslation'
            : 'setScale'
      ](v);
    }
  }
  const sources = [];
  for (const n of nodes) {
    if (!n.getSkin() || !n.getMesh()) continue;
    const skin = n.getSkin();
    for (const p of n.getMesh().listPrimitives())
      sources.push({ p, j: skin.listJoints(), ib: skin.getInverseBindMatrices() });
  }
  function vertices() {
    const out = [];
    for (const { p, j, ib } of sources) {
      const ms = j.map((n, i) =>
        new Matrix4()
          .fromArray(n.getWorldMatrix())
          .multiply(new Matrix4().fromArray(ib.getElement(i, []))),
      );
      const pos = p.getAttribute('POSITION'),
        js = p.getAttribute('JOINTS_0'),
        ws = p.getAttribute('WEIGHTS_0');
      for (let i = 0; i < pos.getCount(); i++) {
        const v = pos.getElement(i, []),
          ji = js.getElement(i, []),
          w = ws.getElement(i, []),
          q = new Vector3();
        for (let k = 0; k < 4; k++)
          if (w[k]) q.addScaledVector(new Vector3(...v).applyMatrix4(ms[ji[k]]), w[k]);
        out.push(q.toArray());
      }
    }
    return out;
  }
  const idle = indexClip(root, 'Idle');
  apply(idle, 0.5);
  const vs = vertices(),
    mins = [0, 1, 2].map((a) => Math.min(...vs.map((v) => v[a]))),
    maxs = [0, 1, 2].map((a) => Math.max(...vs.map((v) => v[a]))),
    scale = 2.25 / (maxs[1] - mins[1]);
  reset();
  const bv = vertices(),
    groups = [];
  for (const front of [true, false])
    for (const left of [true, false]) {
      const candidates = bv
        .map((v, i) => ({ v, i }))
        .filter(({ v }) => v[0] > 0.05 === front && v[2] < -0.025 === left && Math.abs(v[0]) < 0.4);
      const low = Math.min(...candidates.map(({ v }) => v[1]));
      const indices = candidates.filter(({ v }) => v[1] < low + 0.012).map((v) => v.i);
      const centroid = [0, 1, 2].map(
        (a) => indices.reduce((s, i) => s + bv[i][a], 0) / indices.length,
      );
      const prefix = `tripo::${front ? 0 : 1}_${left ? 'Left' : 'Right'}_Limb_`;
      const chain = nodes
        .filter((n) => n.getName().startsWith(prefix))
        .sort((a, b) => a.getName().localeCompare(b.getName()));
      const terminal = chain.at(-1),
        terminalWorld = terminal.getWorldTranslation();
      const toeLocal = new Vector3(...centroid)
        .applyMatrix4(new Matrix4().fromArray(terminal.getWorldMatrix()).invert())
        .toArray();
      groups.push({
        front,
        left,
        indices,
        centroidBindWorld: centroid,
        terminal: terminal.getName(),
        toeOffsetFromTerminalWorld: centroid.map((v, i) => v - terminalWorld[i]),
        toeLocal,
        chain: chain.map((n, i) => ({
          name: n.getName(),
          world: n.getWorldTranslation(),
          local: n.getTranslation(),
          lengthFromPrevious: i
            ? new Vector3(...n.getWorldTranslation()).distanceTo(
                new Vector3(...chain[i - 1].getWorldTranslation()),
              )
            : null,
        })),
      });
    }
  const percentile = (a, p) => {
    a = [...a].sort((a, b) => a - b);
    return a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? null;
  };
  const clips = [];
  for (const name of ['Walk', 'Run']) {
    const clip = indexClip(root, name),
      dur = Math.max(...[...clip.values()].map((c) => c.times.at(-1))),
      N = sampleCount,
      dt = dur / N,
      samples = groups.map(() => []),
      bodyHeights = [];
    for (let k = 0; k <= N; k++) {
      apply(clip, k * dt);
      bodyHeights.push(
        nodes.find((n) => n.getName() === 'tripo::Root').getWorldTranslation()[1] * scale,
      );
      const vs = vertices();
      groups.forEach((g, i) => {
        samples[i].push({
          x: (g.indices.reduce((s, j) => s + vs[j][0], 0) / g.indices.length) * scale,
          y: (g.indices.reduce((s, j) => s + vs[j][1], 0) / g.indices.length) * scale,
        });
      });
    }
    const rows = samples.map((ss, i) => {
      const lo = Math.min(...ss.map((s) => s.y)),
        hi = Math.max(...ss.map((s) => s.y));
      const vel = [],
        all = [],
        lowBand = [];
      for (let k = 1; k < N; k++) {
        const v = -(ss[k + 1].x - ss[k - 1].x) / (2 * dt);
        if (v > 0) all.push(v);
        if (ss[k].y < lo + (hi - lo) * 0.3 && v > 0) lowBand.push(v);
        // Contact means near the sole's floor, not the lowest 30% of a high
        // recovery arc: that band includes airborne leg retraction in a gallop.
        if (ss[k].y < lo + 0.035 && v > 0) vel.push(v);
      }
      return {
        front: groups[i].front,
        left: groups[i].left,
        rangeX: Math.max(...ss.map((s) => s.x)) - Math.min(...ss.map((s) => s.x)),
        rangeY: hi - lo,
        minY: lo - mins[1] * scale,
        stanceN: vel.length,
        stanceP25: percentile(vel, 0.25),
        stanceMedian: percentile(vel, 0.5),
        stanceP75: percentile(vel, 0.75),
        lowBandMedian: percentile(lowBand, 0.5),
        backwardMedian: percentile(all, 0.5),
        backwardMax: Math.max(...all),
      };
    });
    const airborne = Array.from({ length: N }, (_, k) =>
      samples.every((foot) => foot[k].y - mins[1] * scale > 0.065),
    );
    const meanHeight = (flying) => {
      const heights = bodyHeights.slice(0, N).filter((_, k) => airborne[k] === flying);
      return heights.length ? heights.reduce((sum, h) => sum + h, 0) / heights.length : 0;
    };
    clips.push({
      name,
      duration: dur,
      rows,
      airborneFraction: airborne.filter(Boolean).length / N,
      airborneBodyRise: meanHeight(true) - meanHeight(false),
      airbornePhases: airborne.filter((v, k) => v && !airborne[(k + N - 1) % N]).length,
    });
  }
  return { normScale: scale, clips };
}
