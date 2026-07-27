// The forge's works-every-time gate: pure-Node glTF skinning math (no browser,
// no three.js) that samples real animation clips on a forged armored GLB and
// asserts every Armor_<Slot> mesh actually tracks its underlying body segment.
// A set frozen in bind pose (yesterday's silent failure mode) hard-fails here
// before a human ever has to eyeball it.
import {
  accessorToFloats,
  evalWorlds,
  hierarchy,
  mat4Multiply,
  readDoc,
  SLOT_VERIFY_SEGMENT,
  samplePose,
} from './forge_core.mjs';

const MOVING_CLIPS = ['Walking_A', '1H_Melee_Attack_Chop', '2H_Melee_Attack_Chop', 'Running_A'];
const SAMPLES = 6;
// A worn piece hugs its body segment in every pose; a mis-seated piece floats
// at a standoff. Mean nearest-vertex distance thresholds, world units.
const PROXIMITY_LIMIT = { Helm: 0.16, Shoulders: 0.2, Torso: 0.14, Arms: 0.06, Legs: 0.14 };

/** Keep only verts in the bottom `frac` of a piece's height: a hat's brim,
 *  the part that must hug the crown (the cone above rightly stands off). */
function bottomBand(pts, frac) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < pts.length; i += 3) {
    if (pts[i] < minY) minY = pts[i];
    if (pts[i] > maxY) maxY = pts[i];
  }
  const cut = minY + (maxY - minY) * frac;
  const out = [];
  for (let i = 0; i < pts.length; i += 3) {
    if (pts[i + 1] <= cut) out.push(pts[i], pts[i + 1], pts[i + 2]);
  }
  return out.length ? out : pts;
}

/** Keep only points whose XZ lies within `factor` of the reference set's XZ
 *  radius (about its center): a wide hat brim's overhang ring is excluded
 *  from the hug metric, the part over the head is not. */
function withinFootprint(pts, ref, factor) {
  if (!ref.length) return pts;
  const min = [Infinity, Infinity];
  const max = [-Infinity, -Infinity];
  for (let i = 0; i < ref.length; i += 3) {
    min[0] = Math.min(min[0], ref[i]);
    max[0] = Math.max(max[0], ref[i]);
    min[1] = Math.min(min[1], ref[i + 2]);
    max[1] = Math.max(max[1], ref[i + 2]);
  }
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[1] + max[1]) / 2;
  const rx = ((max[0] - min[0]) / 2) * factor;
  const rz = ((max[1] - min[1]) / 2) * factor;
  const out = [];
  for (let i = 0; i < pts.length; i += 3) {
    const nx = (pts[i] - cx) / (rx || 1e-6);
    const nz = (pts[i + 2] - cz) / (rz || 1e-6);
    if (nx * nx + nz * nz <= 1) out.push(pts[i], pts[i + 1], pts[i + 2]);
  }
  return out.length ? out : pts;
}

function meanNearestDistance(from, to, keepFrac = 1) {
  const ds = [];
  for (let i = 0; i < from.length; i += 3) {
    let best = Infinity;
    for (let j = 0; j < to.length; j += 3) {
      const dx = from[i] - to[j];
      const dy = from[i + 1] - to[j + 1];
      const dz = from[i + 2] - to[j + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) best = d2;
    }
    ds.push(Math.sqrt(best));
  }
  if (!ds.length) return 0;
  if (keepFrac >= 1) return ds.reduce((a, b) => a + b, 0) / ds.length;
  // Trimmed mean of the CLOSEST verts: a seated piece hugs on its contact
  // side while authored decorations (crests, icicles) legitimately stand far;
  // a floating piece has NO close verts, so it still fails.
  ds.sort((a, b) => a - b);
  const take = Math.max(4, Math.floor(ds.length * keepFrac));
  return ds.slice(0, take).reduce((a, b) => a + b, 0) / take;
}

/** Verify one armored GLB. Returns { pass, clips, pieces }; throws only on
 *  malformed files, never on gate failures. */
export async function verifyArmored(
  path,
  { clipNames = null, log = console.log, helmMode = null, helmScale = 1, fitMode = 'slots' } = {},
) {
  const doc = await readDoc(path);
  const root = doc.getRoot();
  const tree = hierarchy(doc);

  const anims = root.listAnimations();
  const byName = new Map(anims.map((a) => [a.getName(), a]));
  const wanted = clipNames ?? [...MOVING_CLIPS.filter((n) => byName.has(n)).slice(0, 2), 'Idle'];
  const clips = wanted.filter((n) => byName.has(n));
  if (!clips.some((n) => MOVING_CLIPS.includes(n))) {
    throw new Error(
      `no moving clip found in ${path} (have: ${anims.map((a) => a.getName()).join(', ')})`,
    );
  }

  const meshes = [];
  for (const node of tree.order) {
    const mesh = node.getMesh();
    const skin = node.getSkin();
    if (!mesh || !skin) continue;
    const name = node.getName() || mesh.getName();
    const joints = skin.listJoints();
    const ibmArr = accessorToFloats(skin.getInverseBindMatrices());
    const prims = [];
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const jAcc = prim.getAttribute('JOINTS_0');
      const wAcc = prim.getAttribute('WEIGHTS_0');
      if (!pos || !jAcc || !wAcc) continue;
      const count = pos.getCount();
      const stride = Math.max(1, Math.floor(count / 160));
      const samples = [];
      const pv = [0, 0, 0];
      const jv = [0, 0, 0, 0];
      const wv = [0, 0, 0, 0];
      for (let i = 0; i < count; i += stride) {
        pos.getElement(i, pv);
        jAcc.getElement(i, jv);
        wAcc.getElement(i, wv);
        let dom = 0;
        for (let k = 1; k < 4; k++) if (wv[k] > wv[dom]) dom = k;
        samples.push({ p: [...pv], j: [...jv], w: [...wv], dom: joints[jv[dom]]?.getName() ?? '' });
      }
      prims.push(samples);
    }
    meshes.push({ name, joints, ibmArr, prims });
  }

  const report = { path, pass: true, clips: {}, pieces: {} };
  for (const clipName of clips) {
    const anim = byName.get(clipName);
    let duration = 0;
    for (const ch of anim.listChannels()) {
      const input = ch.getSampler()?.getInput();
      if (input) {
        const times = accessorToFloats(input);
        duration = Math.max(duration, times[times.length - 1]);
      }
    }
    const displacement = new Map();
    let first = null;
    for (let si = 0; si < SAMPLES; si++) {
      const t = (duration * si) / SAMPLES;
      const worlds = evalWorlds(tree, samplePose(anim, t));
      const positionsByMesh = new Map();
      for (const mesh of meshes) {
        const jointMats = mesh.joints.map((j, i) =>
          mat4Multiply(worlds.get(j), mesh.ibmArr.slice(i * 16, i * 16 + 16)),
        );
        const out = [];
        for (const samples of mesh.prims) {
          for (const { p, j, w } of samples) {
            let x = 0;
            let y = 0;
            let z = 0;
            for (let k = 0; k < 4; k++) {
              const wk = w[k];
              if (wk <= 1e-6) continue;
              const m = jointMats[j[k]];
              x += wk * (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]);
              y += wk * (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]);
              z += wk * (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]);
            }
            out.push(x, y, z);
          }
        }
        positionsByMesh.set(mesh.name, out);
      }
      if (si === 0) {
        first = positionsByMesh;
        if (!report._t0 && MOVING_CLIPS.includes(clipName)) {
          report._t0 = positionsByMesh;
          const jointPos = new Map();
          for (const node of tree.order) {
            const name = node.getName();
            if (!name || jointPos.has(name)) continue;
            const m = worlds.get(node);
            jointPos.set(name, [m[12], m[13], m[14]]);
          }
          report._t0Joints = jointPos;
        }
        for (const mesh of meshes) {
          displacement.set(mesh.name, { sum: 0, max: 0, count: 0, blown: false });
        }
      } else {
        for (const mesh of meshes) {
          const base = first.get(mesh.name);
          const now = positionsByMesh.get(mesh.name);
          const d = displacement.get(mesh.name);
          for (let i = 0; i < now.length; i += 3) {
            const dx = now[i] - base[i];
            const dy = now[i + 1] - base[i + 1];
            const dz = now[i + 2] - base[i + 2];
            const dist = Math.hypot(dx, dy, dz);
            if (!Number.isFinite(dist) || Math.abs(now[i]) > 10 || Math.abs(now[i + 1]) > 10) {
              d.blown = true;
            }
            d.sum += dist;
            d.max = Math.max(d.max, dist);
            d.count += 1;
          }
        }
      }
    }
    const stats = {};
    for (const [name, d] of displacement) {
      stats[name] = { mean: d.count ? d.sum / d.count : 0, max: d.max, blown: d.blown };
    }
    report.clips[clipName] = stats;
  }

  // Judge each armor piece against its body segment on the first moving clip:
  // it must MOVE with the segment and SIT on it (mean nearest-vertex standoff
  // within the slot limit; a floating, mis-seated piece animates but fails).
  const movingClip = clips.find((n) => MOVING_CLIPS.includes(n));
  const stats = report.clips[movingClip];
  const t0 = report._t0 ?? new Map();
  delete report._t0;
  for (const mesh of meshes) {
    const name = mesh.name;
    if (!name.startsWith('Armor_')) continue;
    const slot = name.slice('Armor_'.length).replace(/_\d+$/, '');
    const segNames = SLOT_VERIFY_SEGMENT[slot] ?? [];
    const segName = segNames.find((s) => stats[s]);
    const seg = segName ? stats[segName] : null;
    const armor = stats[name];
    const segMean = seg?.mean ?? 0;
    const ratio = segMean > 1e-9 ? armor.mean / segMean : 1;
    // Bracers are judged against the forearm BONE LINES (baggy sleeves make
    // vert proximity lie): most verts must project onto the elbow-to-wrist
    // span, close to the line. Other slots use segment vert proximity.
    let standoff = 0;
    let limit = PROXIMITY_LIMIT[slot] ?? 0.15;
    // An INTENTIONALLY oversized helm (a bobble-proportion nudge scale) stands
    // proportionally further off the head verts; scale its allowance with the
    // declared nudge so a floating helm at scale 1 still fails.
    if (slot === 'Helm' && helmMode === 'helm' && helmScale > 1) limit *= helmScale;
    // WHOLE-set fits keep the suit's authored offsets (a suit stands proud of
    // the body it was authored around), so proximity gets more allowance; the
    // movement ratio and blow-up checks still catch broken binding, and a
    // grossly misplaced piece still trips even the widened limit.
    if (fitMode === 'whole' || fitMode === 'anchored') limit *= 1.5;
    let seated = true;
    let coverage = null;
    if (slot === 'Arms' && t0.get(name) && report._t0Joints) {
      const lines = [];
      for (const side of ['Left', 'Right']) {
        const F = report._t0Joints.get(`mixamorig${side}Arm`);
        const H = report._t0Joints.get(`mixamorig${side}Hand`);
        if (F && H) {
          const d = [H[0] - F[0], H[1] - F[1], H[2] - F[2]];
          const len = Math.hypot(...d) || 1e-3;
          lines.push({ F, dir: [d[0] / len, d[1] / len, d[2] / len], len });
        }
      }
      const pts = t0.get(name);
      let covered = 0;
      let perpSum = 0;
      let n = 0;
      for (let i = 0; i < pts.length; i += 3) {
        let best = null;
        for (const line of lines) {
          const px = pts[i] - line.F[0];
          const py = pts[i + 1] - line.F[1];
          const pz = pts[i + 2] - line.F[2];
          const t = (px * line.dir[0] + py * line.dir[1] + pz * line.dir[2]) / line.len;
          const perp = Math.hypot(
            px - line.dir[0] * t * line.len,
            py - line.dir[1] * t * line.len,
            pz - line.dir[2] * t * line.len,
          );
          if (!best || perp < best.perp) best = { t, perp };
        }
        if (best) {
          n += 1;
          if (best.t >= -0.3 && best.t <= 1.55) {
            covered += 1;
            perpSum += best.perp;
          }
        }
      }
      coverage = n ? covered / n : 0;
      standoff = covered ? perpSum / covered : 9;
      limit = 0.13;
      // Whole-set sleeves keep their authored girth around the arm line.
      if (fitMode === 'whole' || fitMode === 'anchored') limit *= 1.5;
      seated = coverage >= 0.5 && standoff <= limit;
    } else {
      let segT0 = segName ? t0.get(segName) : null;
      let armorPts = t0.get(name);
      // A hat is judged by its brim: the bottom band must hug the top of the
      // HAIR (the hat rides on the hair, not the scalp); the cone above and
      // the wide brim OVERHANG are meant to stand clear, so only brim verts
      // inside the head/hair footprint count.
      if (slot === 'Helm' && helmMode === 'hat' && armorPts) {
        const union = [];
        for (const [n, pts] of t0) {
          if (n === 'Head' || /^Head_(Male|Female)_Hair/.test(n)) union.push(...pts);
        }
        if (union.length) segT0 = union;
        armorPts = withinFootprint(bottomBand(armorPts, 0.3), segT0 ?? [], 1.15);
      }
      if (slot === 'Helm' && helmMode === 'mask' && armorPts && segT0) {
        // A mask's antlers/crest legitimately stand far off the head; its
        // PLATE is what must hug the face. Judge the closest 30% of verts.
        const dists = [];
        for (let i = 0; i < armorPts.length; i += 3) {
          let best = Infinity;
          for (let j = 0; j < segT0.length; j += 3) {
            const dx = armorPts[i] - segT0[j];
            const dy = armorPts[i + 1] - segT0[j + 1];
            const dz = armorPts[i + 2] - segT0[j + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < best) best = d2;
          }
          dists.push(Math.sqrt(best));
        }
        dists.sort((a, b) => a - b);
        const take = Math.max(4, Math.floor(dists.length * 0.3));
        standoff = dists.slice(0, take).reduce((a, b) => a + b, 0) / take;
        limit = 0.1;
        seated = standoff <= limit;
      } else {
        // Whole/anchored fits keep authored decorative overhangs; judge the
        // contact side (closest 60 percent of verts) instead of the full mean.
        const keep = fitMode === 'slots' ? 1 : 0.5;
        standoff = segT0 && armorPts ? meanNearestDistance(armorPts, segT0, keep) : 0;
        seated = standoff <= limit;
      }
    }
    const pass = !armor.blown && seated && (segMean < 0.005 || armor.mean >= 0.25 * segMean);
    report.pieces[name] = {
      clip: movingClip,
      armorMean: round(armor.mean),
      segMean: round(segMean),
      ratio: round(ratio),
      standoff: round(standoff),
      standoffLimit: limit,
      ...(coverage !== null ? { coverage: round(coverage) } : {}),
      blown: armor.blown,
      pass,
    };
    if (!pass) report.pass = false;
  }
  delete report._t0Joints;
  if (!Object.keys(report.pieces).length) {
    report.pass = false;
    report.error = 'no Armor_* meshes found';
  }
  for (const [name, r] of Object.entries(report.pieces)) {
    log(
      `  ${r.pass ? 'PASS' : 'FAIL'}  ${name.padEnd(18)} moves ${r.armorMean} vs segment ${r.segMean}, standoff ${r.standoff} (limit ${r.standoffLimit})${r.blown ? ' BLOWN UP' : ''}`,
    );
  }
  return report;
}

function round(v) {
  return Math.round(v * 1e4) / 1e4;
}
