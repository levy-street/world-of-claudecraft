// Stair trim core: the transform stair_trim.mjs runs on a map file, shared so
// the same code can run inside a live Studio tab (Vite serves the repo root):
//   const { trimStairs } = await import('/scripts/assets/deepglass/stair_trim_core.mjs');
// See stair_trim.mjs for what it builds and why.
//
// GLB mode (default, SPACEY 2026-09-23: "redo the textures for the steps so the
// textures look like this image ... bake in the lighting ao"): a flight that
// matches a STAIR_KIT entry is REPLACED by that baked Blender flight
// (scripts/assets/deepglass/dg_stair_flights.py: stone block steps, flagstone
// rails, posts and landings in one GLB at the stairBlock frame), and only the
// collision is generated here. Re-runs find the "Stair flight" placements
// and regenerate their collision. opts.glb = false keeps the old trim path.

const BASE = 0.5; // citadel.ts STAIR_BASE_DEPTH: local y of the foot plaza
const LIFT = 0.08; // citadel.ts STAIR_LIFT
const RAIL_NARROW = 0.7; // where the wide wall would swallow placed dressing
const RAIL_H = 0.85; // wall top over the nosing line
const RAIL_DEPTH = 4; // wall bottom under the nosing line (buried)
const POST_UP = 0.3; // post top over the wall top
const LAND = 3; // landing depth
const SLAB = 0.6; // landing slab thickness
const LAND_LIFT = 0.03; // the foot landing's lip over the plaza (no z-fight)
const SEG = 3; // rail collider segment length (see header)

const NAME_TRIM = 'Stair trim';
const NAME_FLIGHT = 'Stair flight';
const NAME_RAIL = 'Stair rail collision';
const NAME_LAND = 'Stair landing collision';
const STAIR_TRIM_NAMES = new Set([NAME_TRIM, NAME_RAIL, NAME_LAND]);

/** The baked flight kit, keyed by step count. Rails/posts are baked into the
 *  GLB at these widths, so the collision must use them too. The geometry
 *  constants must match dg_stair_flights.py FLIGHTS. */
export const STAIR_KIT = {
  38: { assetId: 'deepglass/stair_flight_38', rise: 14, run: 26, rail: 5.6, post: 5.6 },
  43: { assetId: 'deepglass/stair_flight_43', rise: 16, run: 26, rail: 5.6, post: 5.6 },
  16: { assetId: 'deepglass/stair_flight_16', rise: 6, run: 26, rail: RAIL_NARROW, post: 0.9 },
};
const KIT_HALF_W = 8;

/** The kit entry a stairBlock flight can be swapped for, or null. */
function kitFor(f) {
  const k = STAIR_KIT[f.n];
  if (!k) return null;
  const near = (a, b) => Math.abs(a - b) < 1e-3;
  return near(k.rise, f.rise) &&
    near(k.run, f.run) &&
    near(f.halfW, KIT_HALF_W) &&
    near(f.zMin, -k.run / 2)
    ? k
    : null;
}

/** An installed kit flight placement as flight extents, or null. */
function kitFlightOf(p) {
  for (const [n, k] of Object.entries(STAIR_KIT)) {
    if (p.assetId !== k.assetId) continue;
    const steps = Number(n);
    return {
      n: steps,
      halfW: KIT_HALF_W,
      zMin: -k.run / 2,
      zMax: k.run / 2,
      run: k.run,
      rise: k.rise,
      riser: k.rise / steps,
      tread: k.run / steps,
      kit: k,
    };
  }
  return null;
}

/** A citadel stairBlock flight: its step count and local extents, or null. */
function flightOf(p) {
  if (p.assetId !== 'model/custom' || !p.meshes?.length) return null;
  if (p.rotX || p.rotZ || (p.scale ?? 1) !== 1 || p.name === NAME_TRIM) return null;
  const v = p.meshes[0].verts;
  const count = v.length / 3;
  if (count % 10 !== 0 || count < 20) return null;
  let halfW = 0;
  let zMin = Infinity;
  let zMax = -Infinity;
  let top = -Infinity;
  for (let i = 0; i < v.length; i += 3) {
    halfW = Math.max(halfW, Math.abs(v[i]));
    top = Math.max(top, v[i + 1]);
    zMin = Math.min(zMin, v[i + 2]);
    zMax = Math.max(zMax, v[i + 2]);
  }
  const n = count / 10;
  const rise = top - BASE - LIFT;
  const riser = rise / n;
  // First tread's top (stairBlock vertex 0) must sit a riser + lift over the
  // foot plaza, or this is not a stairBlock flight.
  if (Math.abs(v[1] - (BASE + LIFT + riser)) > 1e-3) return null;
  const run = zMax - zMin;
  return { n, halfW, zMin, zMax, run, rise, riser, tread: run / n };
}

function meshBuilder() {
  const verts = [];
  const tris = [];
  const vert = (x, y, z) => {
    verts.push(+x.toFixed(4), +y.toFixed(4), +z.toFixed(4));
    return verts.length / 3 - 1;
  };
  // Quad a-b-c-d wound so its normal points along (nx, ny, nz).
  const quad = (a, b, c, d, nx, ny, nz) => {
    const P = (i) => [verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]];
    const [pa, pb, pc] = [P(a), P(b), P(c)];
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const w = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const dot =
      (u[1] * w[2] - u[2] * w[1]) * nx +
      (u[2] * w[0] - u[0] * w[2]) * ny +
      (u[0] * w[1] - u[1] * w[0]) * nz;
    if (dot >= 0) tris.push(a, b, c, a, c, d);
    else tris.push(a, c, b, a, d, c);
  };
  /** A box whose top and bottom may slope along z: x in [x0,x1], z in
   *  [z0,z1], top/bottom heights given at z0 and z1. No bottom face. */
  const slopedBox = (x0, x1, z0, z1, top0, top1, bot0, bot1) => {
    const t00 = vert(x0, top0, z0);
    const t10 = vert(x1, top0, z0);
    const t11 = vert(x1, top1, z1);
    const t01 = vert(x0, top1, z1);
    const b00 = vert(x0, bot0, z0);
    const b10 = vert(x1, bot0, z0);
    const b11 = vert(x1, bot1, z1);
    const b01 = vert(x0, bot1, z1);
    quad(t00, t10, t11, t01, 0, 1, 0);
    quad(b00, b01, t01, t00, -1, 0, 0);
    quad(b10, b11, t11, t10, 1, 0, 0);
    quad(b00, b10, t10, t00, 0, 0, -1);
    quad(b01, b11, t11, t01, 0, 0, 1);
  };
  return { verts, tris, slopedBox };
}

/** Local (lx, lz) of a flight placement to world, three.js rotation.y. */
function toWorld(p, lx, lz) {
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  return { x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c };
}

/**
 * Trim every stairBlock flight in `doc` in place (idempotent).
 * opts: tex, tile, look ({modelLight,modelHue,modelSat}, neutral values dropped),
 * railWide, music (zoneTrack or undefined), log.
 */
export function trimStairs(doc, opts = {}) {
  const TEX = opts.tex ?? 'WardenStone';
  const TEX_TILE = opts.tile ?? 7;
  const RAIL_WIDE = opts.railWide ?? 5.6;
  const music = opts.music;
  const log = opts.log ?? (() => {});
  const LOOK = Object.fromEntries(
    Object.entries(opts.look ?? {}).filter(
      ([k, v]) => !((k === 'modelSat' && v === 1) || (k !== 'modelSat' && v === 0)),
    ),
  );
  const retexture = (p) => {
    delete p.modelHue;
    delete p.modelSat;
    delete p.modelLight;
    Object.assign(p, { modelTexId: TEX, modelTexTile: TEX_TILE, ...LOOK });
  };
  const trimMesh = (p, f, RAIL_T, POST, railTop, railBot, wHalf, footTop, headTop) => {
    const m = meshBuilder();
    for (const side of [-1, 1]) {
      const xi = side * f.halfW;
      const xo = side * (f.halfW + RAIL_T);
      const [x0, x1] = side < 0 ? [xo, xi] : [xi, xo];
      m.slopedBox(
        x0,
        x1,
        f.zMin,
        f.zMax,
        railTop(f.zMin),
        railTop(f.zMax),
        railBot(f.zMin),
        railBot(f.zMax),
      );
      const xc = side * (f.halfW + RAIL_T / 2);
      for (const zc of [f.zMin, f.zMax]) {
        const top = railTop(zc) + POST_UP;
        const bot = railBot(zc);
        m.slopedBox(xc - POST / 2, xc + POST / 2, zc - POST / 2, zc + POST / 2, top, top, bot, bot);
      }
    }
    m.slopedBox(
      -wHalf,
      wHalf,
      f.zMin - LAND,
      f.zMin,
      footTop,
      footTop,
      footTop - SLAB,
      footTop - SLAB,
    );
    m.slopedBox(
      -wHalf,
      wHalf,
      f.zMax,
      f.zMax + LAND,
      headTop,
      headTop,
      headTop - SLAB,
      headTop - SLAB,
    );
    added.push({
      assetId: 'model/custom',
      x: p.x,
      z: p.z,
      rotY: p.rotY,
      scale: 1,
      collide: false,
      detached: true,
      groundY: p.groundY,
      ...(p.y ? { y: p.y } : {}),
      meshes: [{ verts: m.verts, tris: m.tris }],
      modelTexId: TEX,
      modelTexTile: TEX_TILE,
      ...LOOK,
      name: NAME_TRIM,
    });
  };
  const useGlb = opts.glb ?? true;
  const kept = doc.placements.filter((p) => !STAIR_TRIM_NAMES.has(p.name));
  const out = [];
  const added = [];
  let flights = 0;
  for (const src of kept) {
    let f = flightOf(src);
    let kit = f && useGlb ? kitFor(f) : null;
    if (!f) {
      f = useGlb ? kitFlightOf(src) : null;
      kit = f?.kit ?? null;
    }
    if (!f) {
      out.push(src);
      continue;
    }
    flights++;
    // The flight's own placement: an installed kit GLB as is, a stairBlock
    // that matches the kit swapped for it, anything else kept (trim path).
    const p =
      kit && src.assetId === 'model/custom'
        ? {
            assetId: kit.assetId,
            x: src.x,
            z: src.z,
            rotY: src.rotY,
            scale: 1,
            collide: false,
            detached: true,
            groundY: src.groundY,
            ...(src.y ? { y: src.y } : {}),
            name: NAME_FLIGHT,
          }
        : src;
    out.push(p);
    // A flight framed by placed dressing (the arena gate's pillars and
    // pennants) keeps the narrow wall rather than burying it.
    const wideBlocked = kept.some((q) => {
      if (q === p || q.assetId?.startsWith('collider/') || STAIR_TRIM_NAMES.has(q.name))
        return false;
      const c = Math.cos(p.rotY);
      const s = Math.sin(p.rotY);
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      return (
        Math.abs(lx) >= f.halfW &&
        Math.abs(lx) <= f.halfW + RAIL_WIDE + 0.3 &&
        lz >= f.zMin - LAND &&
        lz <= f.zMax + LAND
      );
    });
    // Nosing line: the downhill edge of each tread top, rising a riser per tread.
    const nose = (z) => BASE + LIFT + f.riser + ((z - f.zMin) * f.riser) / f.tread;
    const RAIL_T = kit ? kit.rail : wideBlocked ? RAIL_NARROW : RAIL_WIDE;
    const POST = kit ? kit.post : RAIL_T === RAIL_WIDE ? RAIL_T : 0.9; // end post, flush with a wide wall
    if (!kit) retexture(p);
    const railTop = (z) => nose(z) + RAIL_H;
    const railBot = (z) => nose(z) - RAIL_DEPTH;
    const wHalf = f.halfW + RAIL_T;
    const footTop = BASE + LAND_LIFT;
    const headTop = BASE + LIFT + f.rise;
    if (!kit) trimMesh(p, f, RAIL_T, POST, railTop, railBot, wHalf, footTop, headTop);
    // Rail collision: short full-height boxes along each wall and its posts.
    const z0 = f.zMin - POST / 2;
    const z1 = f.zMax + POST / 2;
    const segs = Math.max(1, Math.ceil((z1 - z0) / SEG));
    const segLen = (z1 - z0) / segs;
    for (const side of [-1, 1]) {
      for (let i = 0; i < segs; i++) {
        const lz = z0 + (i + 0.5) * segLen;
        const w = toWorld(p, side * (f.halfW + RAIL_T / 2), lz);
        added.push({
          assetId: 'collider/box',
          x: +w.x.toFixed(3),
          z: +w.z.toFixed(3),
          rotY: p.rotY,
          scale: 1,
          collide: true,
          sizeX: Math.max(RAIL_T, POST),
          sizeY: RAIL_H + POST_UP + 0.5,
          sizeZ: +segLen.toFixed(3),
          hidden: true,
          name: NAME_RAIL,
        });
      }
    }
    // Landing floors: flat planes at each slab's top (world height).
    const worldY = (local) => (p.groundY ?? 0) + (p.y ?? 0) + local;
    for (const [lz, top] of [
      [f.zMin - LAND / 2, footTop],
      [f.zMax + LAND / 2, headTop],
    ]) {
      const w = toWorld(p, 0, lz);
      added.push({
        assetId: 'collider/plane',
        x: +w.x.toFixed(3),
        z: +w.z.toFixed(3),
        rotY: p.rotY,
        scale: 1,
        collide: true,
        sizeX: wHalf * 2,
        sizeY: +worldY(top).toFixed(3),
        sizeZ: LAND,
        detached: true,
        groundY: 0,
        hidden: true,
        name: NAME_LAND,
      });
    }
    log(
      `flight @(${p.x.toFixed(0)},${p.z.toFixed(0)}) rotY ${p.rotY.toFixed(2)}: ${f.n} steps, rise ${f.rise.toFixed(2)}, ` +
        `foot y ${worldY(BASE).toFixed(2)} head y ${worldY(headTop).toFixed(2)}, ${kit ? kit.assetId : 'trim mesh'}, ` +
        `${segs * 2} rail boxes, rails ${RAIL_T} yd${wideBlocked ? ' (narrow: dressing beside it)' : ''}`,
    );
  }
  doc.placements = [...out, ...added];
  if (music) doc.music = { ...(doc.music ?? {}), zoneTrack: music };
  return { flights, added: added.length };
}
