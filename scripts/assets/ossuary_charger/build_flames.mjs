// Regrow Wraith the Deadstrier's mane and tail flames on its own skeleton.
//
//   node scripts/assets/ossuary_charger/build_flames.mjs [in.glb] [out.glb]
//
// Both default to public/models/mounts/ossuary_charger.glb (rewritten in place).
//
// Every flame is one stylised flame shell: a smooth closed hull, thick where it
// grows from the bone and thinning to a ridge whose edge breaks into a few big
// licks that hook back with the flow. The mane's shell runs along the crest
// from the brow, over the poll and down the neck to the withers; the tail's
// grows off the tailbone; each leg has a small one at the fetlock. Every
// column of a shell takes the skin weights of the body round its root, so the
// roots ride the bones exactly.
//
// Both flame meshes are rebuilt with the attributes src/render/ossuary_flames.ts
// reads: _FLAMET (0 at the root, 1 at the edge), _FLAMEREGION (0 mane, 1 tail,
// 2 legs), _FLAMEHEAT, _FLAMESEED (smooth along each shell), _FLAMEOFFSET (each
// point's flow from its column's root, which the shader stretches with speed
// and reshapes as the licks flicker) and TEXCOORD_0 (u is 1 at a lick's middle
// and 0 at a notch, v names the lick), plus COLOR_0 (the green heat ramp) for
// the far bake. The halo mesh keeps the same shape but is not drawn. The body
// gains _FLAMEGLOW: how strongly the fire lights each bone vertex.
//
// Model frame: y up, +z toward the head, x across; the hooves stand on y = 0.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const DEFAULT = 'public/models/mounts/ossuary_charger.glb';
const IN = process.argv[2] ?? DEFAULT;
const OUT = process.argv[3] ?? IN;

const MANE = 0;
const TAIL = 1;
const LEGS = 2;

/** The halo shell against the core: wider, a little longer. */
const HALO_WIDTH = 1.45;
const HALO_LENGTH = 1.08;

/** Green heat ramp (linear 0..1), matching the shader's ramp. */
const RAMP = [
  [0.0, [0.0, 0.16, 0.02]],
  [0.33, [0.02, 0.6, 0.08]],
  [0.66, [0.18, 0.95, 0.2]],
  [1.0, [0.55, 1.0, 0.42]],
];

let seed = 0x0551a7;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

function ramp(h) {
  for (let i = 1; i < RAMP.length; i++) {
    const [p0, c0] = RAMP[i - 1];
    const [p1, c1] = RAMP[i];
    if (h <= p1) {
      const t = (h - p0) / (p1 - p0);
      return c0.map((c, k) => c + (c1[k] - c) * t);
    }
  }
  return RAMP[RAMP.length - 1][1];
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(IN);
const nodes = doc.getRoot().listNodes();
const byName = (name) => {
  const n = nodes.find((x) => x.getName() === name);
  if (!n) throw new Error(`missing node ${name}`);
  return n;
};
const bodyPrim = byName('ossuary_body').getMesh().listPrimitives()[0];
const corePrim = byName('ossuary_fire_core').getMesh().listPrimitives()[0];
const haloPrim = byName('ossuary_fire_halo').getMesh().listPrimitives()[0];

// --- the body: its crest line and the skin weights near any point ----------
const bodyPos = bodyPrim.getAttribute('POSITION');
const bodyJ = bodyPrim.getAttribute('JOINTS_0');
const bodyW = bodyPrim.getAttribute('WEIGHTS_0');
const bodyVerts = [];
for (let i = 0; i < bodyPos.getCount(); i++) bodyVerts.push(bodyPos.getElement(i, []));

/** Highest body point near the midline at a given z. */
function midlineTop(z) {
  let top = -Infinity;
  for (const v of bodyVerts) {
    if (Math.abs(v[0]) < 0.06 && Math.abs(v[2] - z) < 0.015) top = Math.max(top, v[1]);
  }
  if (top === -Infinity) throw new Error(`no body midline at z=${z}`);
  return top;
}

/** The crest line at a given z: the top of the spine, the neck vertebrae and
 *  the skull, averaged over a short run so the mane's root line follows the
 *  bones without stepping over each vertebra tip and the gaps between them. */
function crestY(z) {
  let sum = 0;
  for (let k = -2; k <= 2; k++) sum += midlineTop(z + k * 0.01);
  return sum / 5;
}

/** Skin weights for a flame column rooted at p: the blend of every body vertex within
 *  WEIGHT_RADIUS (the bone the root sits on, not one stray vertex of a
 *  neighbouring piece), its four strongest joints renormalized. Falls back to
 *  the nearest vertex. */
const WEIGHT_RADIUS = 0.03;
function weightsNear(p) {
  const sum = new Map();
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < bodyVerts.length; i++) {
    const v = bodyVerts[i];
    const d = Math.sqrt((v[0] - p[0]) ** 2 + (v[1] - p[1]) ** 2 + (v[2] - p[2]) ** 2);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
    if (d > WEIGHT_RADIUS) continue;
    const j = bodyJ.getElement(i, []);
    const w = bodyW.getElement(i, []);
    const falloff = 1 - d / WEIGHT_RADIUS;
    for (let k = 0; k < 4; k++) if (w[k] > 0) sum.set(j[k], (sum.get(j[k]) ?? 0) + w[k] * falloff);
  }
  if (sum.size === 0)
    return { joints: bodyJ.getElement(best, []), weights: bodyW.getElement(best, []) };
  const top = [...sum.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = top.reduce((acc, [, w]) => acc + w, 0);
  while (top.length < 4) top.push([0, 0]);
  return { joints: top.map(([j]) => j), weights: top.map(([, w]) => w / total) };
}

// --- flame layout -------------------------------------------------------------
// Each flame is one stylised flame SHELL: a smooth closed hull, thick where it
// grows out of the bone and thinning to a ridge, whose outer edge breaks into a
// few big licks that hook back with the flow. The mane's shell is rooted all
// along the crest from the brow over the eyes (z 0.45), over the poll and down
// the neck to just short of the withers (z 0.14, clear of the rider), and drapes a little out
// over both sides of the neck. It stands mostly upright, clear of the rider.
// The tail's shell grows off the tailbone and
// streams back and down; each leg has a small shell at the fetlock.
//
// A shell is a grid: columns along its root line (s), rows from root to edge
// (h). Each column is a curving flow line; the hull is that surface pushed out
// to either side by a thickness that is fullest at the root and in the middle
// of the root line and falls to nothing at the edge and the two ends, so the
// two sides meet and the hull is closed.
const MANE_FROM = 0.14;
const MANE_TO = 0.45;
const TAIL_Z = -0.335;
const FETLOCK_Y = 0.095;
const ROWS = 14;

const tailRoot = [0, crestY(TAIL_Z) - 0.02, TAIL_Z];

// The legs, found from the body itself at fetlock height (the hooves stand on
// y = 0, front legs ahead of z -0.05), so the shells sit on the bone.
const legs = [];
for (const sx of [1, -1]) {
  for (const front of [true, false]) {
    const ring = bodyVerts.filter(
      (v) => Math.abs(v[1] - FETLOCK_Y) < 0.012 && Math.sign(v[0]) === sx && v[2] > -0.05 === front,
    );
    if (ring.length === 0) throw new Error(`no leg at the fetlock (x ${sx}, front ${front})`);
    const cx = ring.reduce((a, v) => a + v[0], 0) / ring.length;
    const cz = ring.reduce((a, v) => a + v[2], 0) / ring.length;
    const back = Math.min(...ring.map((v) => v[2]));
    legs.push({ centre: [cx, FETLOCK_Y, cz], back });
  }
}

/** Where column s stands among a shell's licks: peak is 1 at a lick's middle
 *  and 0 at the notch between two licks; lick is that lick's index. */
function lobeAt(s, licks) {
  const x = s * licks.length;
  const i = Math.min(licks.length - 1, Math.floor(x));
  const f = x - i;
  return { peak: (1 - Math.abs(2 * f - 1)) ** 1.2, scale: licks[i], lick: i };
}

const maneLicks = [0.8, 1.0, 0.85, 1.05, 0.9, 1.0, 0.75];
const tailLicks = [0.9, 1.05, 0.95];
const legLicks = [0.95, 1.05];

const shells = [
  {
    region: MANE,
    cols: 44,
    licks: maneLicks,
    thickness: 0.05,
    column(s) {
      // s runs from the withers (0) to the brow (1).
      const z = MANE_FROM + (MANE_TO - MANE_FROM) * s;
      const head = Math.max(0, (z - 0.3) / (MANE_TO - 0.3));
      const lobe = lobeAt(s, maneLicks);
      const body = 0.12 + 0.1 * Math.sin(Math.PI * (0.08 + 0.8 * s));
      return {
        root: [0, crestY(z) - 0.025, z],
        length: body * (0.55 + 0.55 * lobe.peak * lobe.scale) * (1 - 0.2 * head),
        // Standing up off the crest, only a little raked back, so the licks
        // hook over the neck rather than back into the rider's face.
        dir: norm([0, 1, -0.22 - 0.15 * s + 0.4 * head]),
        sweep: [0, -0.2, -1],
        curl: 0.3 + 0.15 * s - 0.15 * head,
        lobe,
      };
    },
    // Thickness pushes out across the neck.
    side: () => [1, 0, 0],
  },
  {
    region: TAIL,
    cols: 20,
    licks: tailLicks,
    thickness: 0.045,
    column(s) {
      const u = s * 2 - 1;
      const lobe = lobeAt(s, tailLicks);
      return {
        root: add(tailRoot, [u * 0.03, 0, 0]),
        length: (0.36 + 0.04 * (1 - u * u)) * (0.6 + 0.5 * lobe.peak * lobe.scale),
        dir: norm([u * 0.4, -0.42, -1]),
        sweep: [0, -1, 0],
        curl: 0.34,
        lobe,
      };
    },
    side: () => [0, 1, 0],
  },
  ...legs.map((leg) => ({
    region: LEGS,
    cols: 12,
    licks: legLicks,
    thickness: 0.018,
    column(s) {
      const u = s * 2 - 1;
      const lobe = lobeAt(s, legLicks);
      const depth = leg.centre[2] - leg.back;
      return {
        root: [leg.centre[0] + u * depth * 0.9, FETLOCK_Y, leg.back + depth * 0.4],
        length: 0.09 * (0.6 + 0.55 * lobe.peak * lobe.scale),
        dir: norm([u * 0.5, 0.5, -1]),
        sweep: [0, 1, 0],
        curl: 0.3,
        lobe,
      };
    },
    side: () => [0, 1, 0],
  })),
];

// --- geometry -----------------------------------------------------------------
function flowPoint(c, h) {
  const L = c.length;
  const p = add(c.root, mul(c.dir, L * h));
  // The licks hook back with the flow toward their edge.
  return add(p, mul(norm(c.sweep), L * c.curl * h * h));
}

/** Thickness across a shell: fullest at the root, falling to a ridge at the
 *  edge, and to nothing at both ends of the root line, so the hull closes. */
const thick = (s, h) => Math.sin(Math.PI * s) ** 0.5 * (1 - h) ** 0.8 * (1 + 1.2 * h);

function buildLayer(widthScale, lengthScale, keep) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const col = [];
  const joints = [];
  const weights = [];
  const flameT = [];
  const flameSeed = [];
  const region = [];
  const heat = [];
  const offsets = [];
  const index = [];
  for (const [shellIndex, shell] of shells.entries()) {
    const columns = [];
    for (let k = 0; k <= shell.cols; k++) {
      const c = shell.column(k / shell.cols);
      c.length *= lengthScale;
      columns.push(c);
    }
    const R = ROWS + 1;
    // Two faces (+1 and -1 along the shell's side direction), same grid.
    const faceBase = [];
    for (const face of [1, -1]) {
      faceBase.push(pos.length / 3);
      for (let k = 0; k <= shell.cols; k++) {
        const s = k / shell.cols;
        const c = columns[k];
        const skin = weightsNear(c.root);
        const next = columns[Math.min(shell.cols, k + 1)];
        const prev = columns[Math.max(0, k - 1)];
        for (let r = 0; r <= ROWS; r++) {
          const h = r / ROWS;
          const centre = flowPoint(c, h);
          const along = norm(
            sub(flowPoint(c, Math.min(1, h + 0.05)), flowPoint(c, Math.max(0, h - 0.05))),
          );
          const across = norm(sub(flowPoint(next, h), flowPoint(prev, h)));
          // Out of the shell's plane, on this face's side.
          let out = norm(cross(across, along));
          const want = shell.side(s, h);
          if (out[0] * want[0] + out[1] * want[1] + out[2] * want[2] < 0) out = mul(out, -1);
          const t = shell.thickness * widthScale * thick(s, h);
          pos.push(...add(centre, mul(out, face * t)));
          nrm.push(...mul(out, face));
          // u: 1 at a lick's middle, 0 at a notch; v names the lick.
          uv.push(c.lobe.peak, c.lobe.lick + shellIndex * 16);
          const hh = Math.min(1, (1 - 0.45 * h) * (0.9 + 0.2 * rand()));
          heat.push(hh);
          const rgb = ramp(hh);
          col.push(rgb[0], rgb[1], rgb[2], keep.halo ? Math.min(0.85, hh * 1.1) : 1);
          joints.push(...skin.joints);
          weights.push(...skin.weights);
          flameT.push(h);
          // Smooth along the shell, so its motion travels down it as one wave.
          flameSeed.push(s * 1.3 + shellIndex * 0.37);
          region.push(shell.region);
          // The flow from the root: the shader stretches and reshapes along it.
          offsets.push(...sub(centre, c.root));
        }
      }
    }
    for (const [fi, base] of faceBase.entries()) {
      for (let k = 0; k < shell.cols; k++) {
        for (let r = 0; r < ROWS; r++) {
          const a = base + k * R + r;
          const b = a + R;
          if (fi === 0) index.push(a, b, a + 1, a + 1, b, b + 1);
          else index.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
    }
    // Close the root between the two faces.
    for (let k = 0; k < shell.cols; k++) {
      const a = faceBase[0] + k * R;
      const b = faceBase[1] + k * R;
      index.push(a, b, a + R, a + R, b, b + R);
    }
  }
  return { pos, nrm, uv, col, joints, weights, flameT, flameSeed, region, heat, offsets, index };
}

// The bones the fire lights: every body vertex near a flame root gets a glow
// weight (1 at the root, falling to 0 by GLOW_RADIUS), which the body shader
// adds as green light that flickers with the fire.
const GLOW_RADIUS = 0.09;
const glowRoots = [];
for (const shell of shells) {
  for (let k = 0; k <= shell.cols; k += 2) glowRoots.push(shell.column(k / shell.cols).root);
}
const bodyGlow = new Float32Array(bodyVerts.length);
for (let i = 0; i < bodyVerts.length; i++) {
  const v = bodyVerts[i];
  let best = Infinity;
  for (const r of glowRoots) {
    const d = Math.hypot(v[0] - r[0], v[1] - r[1], v[2] - r[2]);
    if (d < best) best = d;
  }
  const g = Math.max(0, 1 - best / GLOW_RADIUS);
  bodyGlow[i] = g * g;
}

function writeLayer(prim, layer) {
  const buffer = doc.getRoot().listBuffers()[0];
  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const old = prim.listSemantics().map((s) => prim.getAttribute(s));
  old.push(prim.getIndices());
  prim.setAttribute('POSITION', acc('VEC3', new Float32Array(layer.pos)));
  prim.setAttribute('NORMAL', acc('VEC3', new Float32Array(layer.nrm)));
  prim.setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(layer.uv)));
  prim.setAttribute(
    'COLOR_0',
    acc(
      'VEC4',
      new Uint16Array(layer.col.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 65535))),
    ).setNormalized(true),
  );
  prim.setAttribute('JOINTS_0', acc('VEC4', new Uint8Array(layer.joints)));
  prim.setAttribute('WEIGHTS_0', acc('VEC4', new Float32Array(layer.weights)));
  prim.setAttribute('_FLAMET', acc('SCALAR', new Float32Array(layer.flameT)));
  prim.setAttribute('_FLAMEREGION', acc('SCALAR', new Float32Array(layer.region)));
  prim.setAttribute('_FLAMEHEAT', acc('SCALAR', new Float32Array(layer.heat)));
  prim.setAttribute('_FLAMESEED', acc('SCALAR', new Float32Array(layer.flameSeed)));
  prim.setAttribute('_FLAMEOFFSET', acc('VEC3', new Float32Array(layer.offsets)));
  prim.setIndices(acc('SCALAR', new Uint32Array(layer.index)));
  for (const a of old) if (a.listParents().length <= 1) a.dispose();
}

const core = buildLayer(1, 1, { halo: false });
seed = 0x0551a7;
const halo = buildLayer(HALO_WIDTH, HALO_LENGTH, { halo: true });
if (core.pos.length !== halo.pos.length) throw new Error('core and halo vertex counts differ');
writeLayer(corePrim, core);
{
  const buffer = doc.getRoot().listBuffers()[0];
  const old = bodyPrim.getAttribute('_FLAMEGLOW');
  bodyPrim.setAttribute(
    '_FLAMEGLOW',
    doc.createAccessor().setType('SCALAR').setArray(bodyGlow).setBuffer(buffer),
  );
  if (old && old.listParents().length <= 1) old.dispose();
}
writeLayer(haloPrim, halo);
await io.write(OUT, doc);

const count = (layer, r) => layer.region.filter((x) => x === r).length;
console.log(
  `flames: ${shells.length} shells, core ${core.pos.length / 3} verts`,
  `(mane ${count(core, MANE)}, tail ${count(core, TAIL)}, legs ${count(core, LEGS)})`,
  `mane z ${MANE_FROM} to ${MANE_TO}, tail root ${tailRoot.map((x) => x.toFixed(3)).join(',')}`,
);
