// Compile the Thornhollow battleground map (data/battleground/thornhollow.map.json,
// a standard WoC map-editor document, built from the Thornhollow Fields combat plan by
// scripts/assets/build_battleground_map.mjs) into the generated field module the
// game consumes: src/sim/thornhollow_field.generated.ts.
//
// The map document carries four kinds of thing, and the compiler routes each to
// the shape the engine already reasons about:
//
//   terrain stamps   -> emitted verbatim; src/sim/battleground_field.ts evaluates
//                       the same chain at runtime (heightfield), and this script
//                       evaluates it AT BUILD TIME to seat every collider and
//                       placement at its exact ground height.
//   regionRole tags  -> the game-mode anchor record (flags, spawn rings, banners,
//                       graveyards, rune pads). Tagged placements never render
//                       and never collide: the mode draws its own props.
//   collider volumes -> collider/plane decks become STANDABLE colliders (the
//                       ramparts, stairs and flag podiums: the only thing that
//                       raises walkable ground); box/sphere/wall volumes block.
//   everything else  -> art. Rendered by src/render/battleground.ts from the
//                       emitted placement list; collision comes from the vendored
//                       per-asset baked boxes (data/battleground/thornhollow_assets.json,
//                       extracted from the editor build's collision tables), so
//                       what you walk into is what was drawn.
//
// Deterministic: same inputs -> byte-identical output. Re-run via
//   node scripts/assets/compile_thornhollow.mjs
// and commit the result; tests/battleground_band.test.ts pins freshness by
// recompiling into a temp path (the optional argv[1] out-path override below)
// and diffing against the committed module.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAP_PATH = join(ROOT, 'data', 'battleground', 'thornhollow.map.json');
const ASSETS_PATH = join(ROOT, 'data', 'battleground', 'thornhollow_assets.json');
// An optional first argument redirects the emit, so the freshness test
// (tests/battleground_band.test.ts) can recompile into a temp file and diff it
// against the committed module without ever touching the working tree.
const OUT_PATH = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : join(ROOT, 'src', 'sim', 'thornhollow_field.generated.ts');

const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
const assetData = JSON.parse(readFileSync(ASSETS_PATH, 'utf8'));

// ---------------------------------------------------------------------------
// Terrain: exact port of the editor build's stamp chain (world.ts applyStamp +
// terrain_brush.ts terrainBrushWeight). Thornhollow's first six stamps level
// the whole rect to 0, so the base height is irrelevant: the chain IS the
// terrain. No stamp in this map uses an alpha mask (asserted below).
// ---------------------------------------------------------------------------

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

// terrain_brush.ts hash01 + the 'splatter' alpha mask, verbatim (the only mask
// this map uses; the compiler refuses anything else below).
function hash01(x, y, salt) {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function splatterAlpha(u, v) {
  let best = 0;
  for (let i = 0; i < 26; i++) {
    const bx = hash01(i, 3, 71) * 1.7 - 0.85;
    const by = hash01(i, 7, 71) * 1.7 - 0.85;
    const radius = 0.05 + hash01(i, 11, 71) * 0.22;
    const distance = Math.hypot(u - bx, v - by);
    if (distance < radius) best = Math.max(best, 1 - (distance / radius) ** 2);
  }
  return best;
}

function brushWeight(distanceRatio, hardness) {
  if (distanceRatio >= 1) return 0;
  const hard = clamp01(hardness);
  let radial = 1;
  if (hard < 1 && distanceRatio > hard) {
    const t = (distanceRatio - hard) / (1 - hard);
    radial = 1 - t * t * (3 - 2 * t);
  }
  return radial;
}

function applyStamp(e, x, z, h) {
  if (e.radius <= 0) return h;
  const dx = x - e.x;
  const dz = z - e.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= e.radius) return h;
  const t = d / e.radius;
  const alpha = e.alpha ? splatterAlpha(dx / e.radius, dz / e.radius) : 1;
  const w = (e.falloff === 'flat' ? 1 : brushWeight(t, e.hardness ?? 0)) * alpha;
  if (w <= 0) return h;
  if (e.mode === 'level') return lerp(h, e.delta, w);
  return h + e.delta * w;
}

const stamps = map.terrainEdits ?? [];
for (const e of stamps) {
  if (e.alpha && e.alpha !== 'splatter') throw new Error(`unsupported stamp alpha ${e.alpha}`);
  if (e.mode && e.mode !== 'level') throw new Error(`unknown stamp mode ${e.mode}`);
}

function heightAt(x, z) {
  let h = 0;
  for (const e of stamps) h = applyStamp(e, x, z, h);
  return h;
}

// ---------------------------------------------------------------------------
// Anchors (regionRole)
// ---------------------------------------------------------------------------

const placements = map.placements ?? [];
const tagged = placements.filter((p) => p.regionRole !== undefined);
const byRole = (role) => tagged.filter((p) => p.regionRole === role);

const round = (v, places = 4) => {
  const p = 10 ** places;
  const r = Math.round(v * p) / p;
  return Object.is(r, -0) ? 0 : r;
};
const pt = (p) => ({ x: round(p.x), z: round(p.z) });

const bases = [];
for (const team of [0, 1]) {
  const flag = byRole(`flag${team}`);
  const banner = byRole(`banner${team}`);
  // Author order is by name ('Crimson spawn 1'..'5'), pinned by sorting.
  const spawns = byRole(`spawn${team}`).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  if (flag.length !== 1) throw new Error(`team ${team}: expected 1 flag, got ${flag.length}`);
  if (banner.length !== 1) throw new Error(`team ${team}: expected 1 banner`);
  if (spawns.length < 1) throw new Error(`team ${team}: no spawns`);
  bases.push({ team, flag: pt(flag[0]), spawns: spawns.map(pt), banner: pt(banner[0]) });
}

const graveyards = [];
for (const team of [0, 1]) {
  const plot = byRole(`graveyard${team}`);
  if (plot.length !== 1) throw new Error(`team ${team}: expected 1 graveyard`);
  const p = plot[0];
  const s = p.scale > 0 ? p.scale : 1;
  graveyards.push({
    x: round(p.x),
    z: round(p.z),
    hw: round(Math.max(1, ((p.sizeX ?? 4) * s) / 2)),
    hd: round(Math.max(1, ((p.sizeZ ?? 4) * s) / 2)),
  });
}

const speedRunes = byRole('speedRune').map(pt);
const powerRunes = byRole('powerRune').map(pt);
if (speedRunes.length === 0 || powerRunes.length === 0) throw new Error('missing rune pads');

// ---------------------------------------------------------------------------
// Colliders
// ---------------------------------------------------------------------------

// The chase camera no longer reads collider metadata at all: the release
// removed geometry-driven camera zoom in favour of fading occluders, and the
// `camGhost` flag plus the structural/height classification that fed it went
// with it. `cameraTopY` stays, because SIGHT still reads it (a castle wall
// blocks a cast; a crate you can see over does not).

const colliders = [];

function pushObb(x, z, hw, hd, rot, extra) {
  colliders.push({
    type: 'obb',
    x: round(x),
    z: round(z),
    hw: round(hw),
    hd: round(hd),
    rot: round(rot),
    ...extra,
  });
}

const seatGround = (p) => (p.detached ? (p.groundY ?? 0) : heightAt(p.x, p.z));

// Walkable deck surfaces (rampart planes, stairs, podiums), collected before
// the baked boxes are emitted so box classification can measure clearance
// against the surface a body actually stands on, not just the terrain:
//   effectiveGroundAt = max(terrain, any deck surface under the point).
// That is what lets an arch lintel high over the gate pass under (dropped),
// while a rampart parapet whose base meets the rampart deck still blocks.
const deckSurfaces = []; // {x,z,hw,hd,rot,topY,eaveY?,pitch?,ridgeShiftless?}

function deckTopAt(x, z) {
  let best = -Infinity;
  for (const d of deckSurfaces) {
    const c = Math.cos(-d.rot);
    const s = Math.sin(-d.rot);
    const lx = (x - d.x) * c + (z - d.z) * s;
    const lz = -(x - d.x) * s + (z - d.z) * c;
    if (Math.abs(lx) > d.hw + 0.3 || Math.abs(lz) > d.hd + 0.3) continue;
    let top = d.topY;
    if (d.pitch !== undefined) top = Math.max(d.eaveY, d.topY - Math.abs(lx) * d.pitch);
    if (top > best) best = top;
  }
  return best;
}

function effectiveGroundAt(x, z) {
  return Math.max(heightAt(x, z), deckTopAt(x, z));
}

// A box whose underside clears a standing body's head above the surface below
// it can never obstruct movement, sight (eye 1.6) or the low chase cam: drop
// it. Arch lintels, tree canopies, bridge undersides.
const PASS_UNDER_CLEARANCE = 2.6;

// --- collider volumes (untagged collider/* placements) ---
for (const p of placements) {
  if (p.regionRole !== undefined) continue;
  if (!p.assetId.startsWith('collider/')) continue;
  if (!p.collide) continue;
  const s = p.scale > 0 ? p.scale : 1;
  const kind = p.assetId.slice('collider/'.length);
  if (kind === 'plane') {
    // Walkable deck. Height = anchor ground + unscaled sizeY offset + gizmo lift.
    const sx = Math.max(0.1, (p.sizeX ?? 12) * s);
    const sz = Math.max(0.1, (p.sizeZ ?? 12) * s);
    const offset = p.sizeY ?? 0;
    const base = seatGround(p) + (p.y ?? 0);
    const walkY = base + offset;
    const tilt = p.rotZ ?? p.rotX ?? 0;
    if (!tilt) {
      pushObb(p.x, p.z, sx / 2, sz / 2, p.rotY ?? 0, {
        cameraTopY: round(walkY),
        moveTopY: round(walkY),
        standable: true,
      });
      deckSurfaces.push({ x: p.x, z: p.z, hw: sx / 2, hd: sz / 2, rot: p.rotY ?? 0, topY: walkY });
    } else {
      // Tilted deck = a ramp. rotZ tilts the local-x span, rotX the local-z
      // span (only rotZ occurs in this map; assert to stay honest). The ridge
      // trick: emit an OBB whose CENTER line lies on the ramp's high edge by
      // doubling the footprint toward the high side; the buried half hides
      // under the deck/terrain it serves, and colliderTopAt's ridge slope
      // reproduces the walk surface exactly on the reachable half.
      if (p.rotX) throw new Error('rotX-tilted deck unsupported (none authored)');
      const run = Math.abs(Math.cos(tilt)) * sx; // horizontal run of the full span
      const rise = Math.abs(Math.sin(tilt)) * sx; // vertical rise of the full span
      const topY = base + offset + rise / 2;
      const eaveY = base + offset - rise / 2;
      // The high edge sits at local +x when tilt>0 (three.js rotation.z lifts
      // -x; the editor authors these with the high edge toward the wall it
      // climbs). Shift the OBB center onto the high edge.
      const highSign = tilt > 0 ? 1 : -1;
      const shift = (run / 2) * highSign;
      const c = Math.cos(p.rotY ?? 0);
      const sn = Math.sin(p.rotY ?? 0);
      pushObb(p.x + shift * c, p.z - shift * sn, run, sz / 2, p.rotY ?? 0, {
        cameraTopY: round(topY),
        moveTopY: round(topY),
        standable: true,
        topSlope: { kind: 'ridge', axis: 'z', pitch: round(rise / run, 5), eaveY: round(eaveY) },
      });
      deckSurfaces.push({
        x: p.x + shift * c,
        z: p.z - shift * sn,
        hw: run,
        hd: sz / 2,
        rot: p.rotY ?? 0,
        topY,
        eaveY,
        pitch: rise / run,
      });
    }
    continue;
  }
  const sx = Math.max(0.1, (p.sizeX ?? (kind === 'sphere' ? 3 : kind === 'wall' ? 12 : 4)) * s);
  const sy = Math.max(0.1, (p.sizeY ?? (kind === 'sphere' ? 3 : kind === 'wall' ? 10 : 4)) * s);
  const sz = Math.max(0.1, (p.sizeZ ?? (kind === 'sphere' ? 3 : kind === 'wall' ? 0.6 : 4)) * s);
  const base = seatGround(p) + (p.y ?? 0);
  if (kind === 'sphere') {
    colliders.push({
      type: 'circle',
      x: round(p.x),
      z: round(p.z),
      r: round(sx / 2),
      cameraTopY: round(base + sx),
    });
  } else {
    pushObb(p.x, p.z, sx / 2, sz / 2, p.rotY ?? 0, {
      cameraTopY: round(base + sy),
    });
  }
}

// --- baked asset collision ---
const rotXZ = (lx, lz, rot) => ({
  x: lx * Math.cos(rot) + lz * Math.sin(rot),
  z: -lx * Math.sin(rot) + lz * Math.cos(rot),
});

// map_doc.ts collideRadiusFor, verbatim factors: the circle fallback for
// assets with no baked data tracks the same visual silhouettes.
const COLLIDE_FACTORS = [
  ['biome/beach_palm', 0.35],
  ['foliage/oak', 0.75],
  ['foliage/pine', 0.75],
  ['foliage/dead', 0.6],
  ['foliage/twisted', 0.75],
  ['foliage/bush', 0.73],
  ['foliage/fern', 0.25],
  ['foliage/mushroom', 0.25],
  ['foliage/rock', 0.75],
  ['grass/', 0.3],
];
function collideRadiusFor(scale, assetId) {
  let factor = 0.8;
  for (const [prefix, f] of COLLIDE_FACTORS) {
    if (assetId.startsWith(prefix)) {
      factor = f;
      break;
    }
  }
  return Math.max(0.1, Math.min(30, factor * scale));
}

// map_doc.ts effectiveCollisionMode: an untagged colliding placement is BAKED.
function effectiveMode(p) {
  if (p.collisionMode) return p.collisionMode;
  if (!p.collide) return 'none';
  if (p.collideRadius !== undefined || p.collideShape === 'square') return 'basic';
  return 'baked';
}

let bakedBoxCount = 0;
let circleFallbackCount = 0;
let rampDeckCount = 0;
let passUnderDropped = 0;

const placementFrame = (p) => {
  const s = p.scale > 0 ? p.scale : 1;
  return {
    s,
    sx: s * (p.scaleX ?? 1),
    sy: s * (p.scaleY ?? 1),
    sz: s * (p.scaleZ ?? 1),
    seat: seatGround(p) + (p.y ?? 0),
    ry: p.rotY ?? 0,
  };
};

const collidingArt = (p) =>
  p.regionRole === undefined &&
  !p.assetId.startsWith('collider/') &&
  p.assetId !== 'grass/patch' && // ground tufts: never collide
  effectiveMode(p) !== 'none';

// Pass 1: every walkable ramp deck (stairs, the wall-tower arcade floor), so
// pass 2's box classification sees the full deck surface set.
for (const p of placements) {
  if (!collidingArt(p) || effectiveMode(p) === 'basic') continue;
  const data = assetData[p.assetId];
  const ramps = data ? data.ramps : [];
  if (!ramps || ramps.length === 0) continue;
  const { sx, sy, sz, seat, ry } = placementFrame(p);

  // A ramp is a rect in normalized model yards, centered (cx, cz), yawed by
  // its own ry on top of the placement yaw, rising along ramp-local +x from
  // yNeg (at -hx) to yPos (at +hx); descending stairs author yNeg > yPos.
  for (const r of ramps) {
    const rampRot = ry + (r.ry ?? 0);
    const center = rotXZ(r.cx * sx, r.cz * sz, ry);
    const hx = Math.abs(r.hx * sx);
    const hz = Math.abs(r.hz * sz);
    const yLo = seat + Math.min(r.yNeg, r.yPos) * sy;
    const yHi = seat + Math.max(r.yNeg, r.yPos) * sy;
    const run = hx * 2;
    const highSign = r.yPos >= r.yNeg ? 1 : -1;
    const shiftW = rotXZ(hx * highSign, 0, rampRot);
    if (yHi - yLo < 0.05) {
      // Flat deck: a plain standable top.
      pushObb(p.x + center.x, p.z + center.z, hx, hz, rampRot, {
        cameraTopY: round(yHi),
        moveTopY: round(yHi),
        standable: true,
      });
      deckSurfaces.push({
        x: p.x + center.x,
        z: p.z + center.z,
        hw: hx,
        hd: hz,
        rot: rampRot,
        topY: yHi,
      });
    } else {
      pushObb(p.x + center.x + shiftW.x, p.z + center.z + shiftW.z, run, hz, rampRot, {
        cameraTopY: round(yHi),
        moveTopY: round(yHi),
        standable: true,
        topSlope: {
          kind: 'ridge',
          axis: 'z',
          pitch: round((yHi - yLo) / run, 5),
          eaveY: round(yLo),
        },
      });
      deckSurfaces.push({
        x: p.x + center.x + shiftW.x,
        z: p.z + center.z + shiftW.z,
        hw: run,
        hd: hz,
        rot: rampRot,
        topY: yHi,
        eaveY: yLo,
        pitch: (yHi - yLo) / run,
      });
    }
    rampDeckCount++;
  }
}

// Pass 2: baked boxes and the circle fallbacks.
for (const p of placements) {
  if (!collidingArt(p)) continue;
  const mode = effectiveMode(p);
  const data = assetData[p.assetId];
  const { s, sx, sy, sz, seat, ry } = placementFrame(p);
  const tilted = Boolean(p.rotX || p.rotZ);
  if (mode === 'basic') {
    const r = Math.max(0.1, Math.min(30, p.collideRadius ?? collideRadiusFor(s, p.assetId)));
    colliders.push({
      type: 'circle',
      x: round(p.x),
      z: round(p.z),
      r: round(r),
      cameraTopY: round(seat + 2.2 * sy),
    });
    circleFallbackCount++;
    continue;
  }
  const boxes = data ? data.boxes : null;
  const ramps = data ? data.ramps : [];

  if (boxes && boxes.length > 0) {
    for (const b of boxes) {
      let top;
      let baseY;
      let hw;
      let hd;
      let cx;
      let cz;
      let rot;
      const boxRy = b.ry ?? 0; // per-box yaw on top of the placement yaw
      if (!tilted) {
        const c = rotXZ(b.x * sx, b.z * sz, ry);
        cx = p.x + c.x;
        cz = p.z + c.z;
        hw = Math.abs(b.hx * sx);
        hd = Math.abs(b.hz * sz);
        top = seat + (b.y + b.hy) * sy;
        baseY = seat + (b.y - b.hy) * sy;
        rot = ry + boxRy;
      } else {
        // Tilted placement: run all 8 corners through the full rotation, band
        // by the corners' Y span, and fit the XZ rectangle in the rotY frame
        // (the editor build's own baked-box tilt treatment).
        const cosX = Math.cos(p.rotX ?? 0),
          sinX = Math.sin(p.rotX ?? 0);
        const cosZ = Math.cos(p.rotZ ?? 0),
          sinZ = Math.sin(p.rotZ ?? 0);
        const cosY = Math.cos(ry),
          sinY = Math.sin(ry);
        let minLx = Infinity,
          maxLx = -Infinity,
          minLz = Infinity,
          maxLz = -Infinity;
        let minY = Infinity,
          maxY = -Infinity;
        for (const ex of [-1, 1])
          for (const ey of [-1, 1])
            for (const ez of [-1, 1]) {
              // Corner offset in the box's own (possibly yawed) frame, then into
              // model space, then scaled.
              const off = rotXZ(ex * b.hx, ez * b.hz, boxRy);
              let vx = (b.x + off.x) * sx;
              let vy = (b.y + ey * b.hy) * sy;
              let vz = (b.z + off.z) * sz;
              // three.js Euler XYZ order: R = Ry * Rx * Rz applied as local Z, X, then Y.
              let tx = vx * cosZ - vy * sinZ,
                ty = vx * sinZ + vy * cosZ;
              vx = tx;
              vy = ty;
              let tz = vz * cosX - vy * sinX;
              ty = vz * sinX + vy * cosX;
              vz = tz;
              vy = ty;
              tx = vx * cosY + vz * sinY;
              tz = -vx * sinY + vz * cosY;
              vx = tx;
              vz = tz;
              // Back into the rotY frame for the rectangle fit.
              const lx = vx * cosY - vz * sinY;
              const lz = vx * sinY + vz * cosY;
              minLx = Math.min(minLx, lx);
              maxLx = Math.max(maxLx, lx);
              minLz = Math.min(minLz, lz);
              maxLz = Math.max(maxLz, lz);
              minY = Math.min(minY, vy);
              maxY = Math.max(maxY, vy);
            }
        const midL = rotXZ((minLx + maxLx) / 2, (minLz + maxLz) / 2, ry);
        cx = p.x + midL.x;
        cz = p.z + midL.z;
        hw = (maxLx - minLx) / 2;
        hd = (maxLz - minLz) / 2;
        top = seat + maxY;
        baseY = seat + minY;
        rot = ry;
      }
      if (hw < 0.05 || hd < 0.05) continue;
      // Clearance is measured against the surface a body actually stands on:
      // the terrain, or a deck (rampart, stairs, podium) where one covers this
      // spot. A gate arch's lintel clears a standing body, so it must not wall
      // the gateway shut; a parapet sitting ON the rampart deck still blocks.
      const surface = effectiveGroundAt(cx, cz);
      if (baseY - surface >= PASS_UNDER_CLEARANCE) {
        passUnderDropped++;
        continue;
      }
      // Clutter whose top a body can hop over keeps the parkour contract the
      // open world has: low tops are passable and standable.
      const lowTop = top - surface <= 1.6;
      pushObb(cx, cz, hw, hd, rot, {
        cameraTopY: round(top),
        ...(lowTop ? { moveTopY: round(top), standable: true } : {}),
      });
      bakedBoxCount++;
    }
  } else if (!ramps || ramps.length === 0) {
    // No collision data: the legacy circle, the same fallback the editor build
    // uses for un-baked assets.
    const r = collideRadiusFor(s, p.assetId);
    colliders.push({
      type: 'circle',
      x: round(p.x),
      z: round(p.z),
      r: round(r),
      cameraTopY: round(seat + 2.2 * sy),
    });
    circleFallbackCount++;
  }
}

// --- perimeter blockers ---
for (const b of map.blockers ?? []) {
  const dx = b.x2 - b.x1;
  const dz = b.z2 - b.z1;
  const len = Math.hypot(dx, dz);
  if (len < 0.01) continue;
  const cx = (b.x1 + b.x2) / 2;
  const cz = (b.z1 + b.z2) / 2;
  const rot = Math.atan2(-dz, dx);
  const topY = Math.max(heightAt(b.x1, b.z1), heightAt(b.x2, b.z2), heightAt(cx, cz)) + 12;
  pushObb(cx, cz, len / 2 + 0.35, 0.6, rot, { cameraTopY: round(topY) });
}

// ---------------------------------------------------------------------------
// Render placements: everything untagged that draws. Seat Y is precomputed so
// the renderer never re-derives terrain math. Grass patches stay procedural.
// ---------------------------------------------------------------------------

const renderPlacements = [];
for (const p of placements) {
  if (p.regionRole !== undefined) continue;
  if (p.assetId.startsWith('collider/')) continue;
  if (p.hidden) continue;
  const entry = {
    assetId: p.assetId,
    x: round(p.x),
    z: round(p.z),
    rotY: round(p.rotY ?? 0),
    scale: round(p.scale > 0 ? p.scale : 1),
    seatY: round(seatGround(p) + (p.y ?? 0)),
  };
  if (p.scaleX !== undefined) entry.scaleX = round(p.scaleX);
  if (p.scaleY !== undefined) entry.scaleY = round(p.scaleY);
  if (p.scaleZ !== undefined) entry.scaleZ = round(p.scaleZ);
  if (p.rotX) entry.rotX = round(p.rotX);
  if (p.rotZ) entry.rotZ = round(p.rotZ);
  if (p.hue !== undefined) entry.hue = round(p.hue);
  if (p.lum !== undefined) entry.lum = round(p.lum);
  if (p.clump !== undefined) entry.clump = round(p.clump);
  renderPlacements.push(entry);
}

// ---------------------------------------------------------------------------
// Ground paint: RLE over the 0.25yd id grid + the swatch table. 255 = bare.
// ---------------------------------------------------------------------------

const paint = map.biomePaint;
if (!paint || !Array.isArray(paint.ids)) throw new Error('missing biomePaint');
const swatches = (paint.custom ?? []).map((c) => ({
  id: c.id,
  texture: c.textureSha.replace(/^builtin:/, ''),
  tileSize: c.tileSize,
  light: c.light ?? 0,
}));
const rle = [];
{
  const ids = paint.ids;
  let cur = ids[0] ?? 255;
  let run = 0;
  for (const v of ids) {
    const id = v ?? 255;
    if (id === cur) {
      run++;
    } else {
      rle.push(cur, run);
      cur = id;
      run = 1;
    }
  }
  rle.push(cur, run);
}

// ---------------------------------------------------------------------------
// The baked heightfield: a 1yd grid over the full rect, quantized to 1cm and
// base64-embedded, so the runtime pays a decode (instant) instead of the ~2s
// stamp-chain evaluation. Column-major: index = col * rows + row.
// ---------------------------------------------------------------------------

const H_CELL = 1;
const H_COLS = Math.round(((map.worldHalfX ?? 120) * 2) / H_CELL) + 1;
const H_ROWS = Math.round((map.content.zones[0].zMax * 2) / H_CELL) + 1;
const HALF_X = map.worldHalfX ?? 120;
const HALF_Z = map.content.zones[0].zMax;
let hMin = Infinity;
let hMax = -Infinity;
const rawHeights = new Float64Array(H_COLS * H_ROWS);
for (let col = 0; col < H_COLS; col++) {
  for (let row = 0; row < H_ROWS; row++) {
    const h = heightAt(-HALF_X + col * H_CELL, -HALF_Z + row * H_CELL);
    rawHeights[col * H_ROWS + row] = h;
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
  }
}
if ((hMax - hMin) * 100 > 65500) throw new Error('height range exceeds uint16 quantization');
const quant = new Uint8Array(H_COLS * H_ROWS * 2);
for (let i = 0; i < rawHeights.length; i++) {
  const q = Math.round((rawHeights[i] - hMin) * 100);
  quant[i * 2] = q & 0xff;
  quant[i * 2 + 1] = (q >> 8) & 0xff;
}
const heightB64 = Buffer.from(quant).toString('base64');

// ---------------------------------------------------------------------------
// Probes: build-time heights the runtime heightfield must reproduce, pinned by
// tests so the compile-time seating and the runtime terrain can never fork.
// ---------------------------------------------------------------------------

const probes = [];
// Scatter INSIDE the rect: the runtime grid clamps to it, so a probe sampled
// outside would compare a clamped read against an unclamped chain evaluation
// and fail for a reason that has nothing to do with the two ports agreeing.
const PROBE_HALF_X = HALF_X - 2;
const PROBE_HALF_Z = HALF_Z - 2;
for (let i = 0; i < 40; i++) {
  // Deterministic scatter over the rect (no rng: hash the index).
  const hx = Math.sin(i * 127.1) * 43758.5453;
  const hz = Math.sin(i * 311.7) * 12543.8567;
  const x = round((hx - Math.floor(hx) - 0.5) * 2 * PROBE_HALF_X);
  const z = round((hz - Math.floor(hz) - 0.5) * 2 * PROBE_HALF_Z);
  probes.push({ x, z, h: round(heightAt(x, z)) });
}
for (const b of bases)
  probes.push({ x: b.flag.x, z: b.flag.z, h: round(heightAt(b.flag.x, b.flag.z)) });

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const j = (v) => JSON.stringify(v);
const lines = [];
lines.push('// GENERATED by scripts/assets/compile_thornhollow.mjs, do not edit by hand.');
lines.push('// Source: data/battleground/thornhollow.map.json (Thornhollow v8, map editor).');
lines.push('// Data only: no imports beyond types. Every big table is a LAZY memoized');
lines.push('// JSON.parse behind a Proxy (see emitJsonConst in the compiler). What that');
lines.push('// defers is MATERIALIZATION of the placement, paint and stamp tables into');
lines.push('// objects: it is skipped until the band is first used. What is always paid:');
lines.push('// this module ships in the main client entry, so every player downloads it,');
lines.push('// the engine parses this source, and the JSON literals stay resident as');
lines.push('// strings. TH_COLLIDERS is not deferred in practice either, because the');
lines.push('// collider grid mounts the band slots on its first build, in every world.');
lines.push("import type { Collider } from './colliders';");
lines.push('');
lines.push('export interface ThFieldPlacement {');
lines.push('  assetId: string;');
lines.push('  x: number;');
lines.push('  z: number;');
lines.push('  rotY: number;');
lines.push('  scale: number;');
lines.push('  /** Precomputed world-local seat height (terrain or detached anchor + lift). */');
lines.push('  seatY: number;');
lines.push('  scaleX?: number;');
lines.push('  scaleY?: number;');
lines.push('  scaleZ?: number;');
lines.push('  rotX?: number;');
lines.push('  rotZ?: number;');
lines.push('  hue?: number;');
lines.push('  lum?: number;');
lines.push('  clump?: number;');
lines.push('}');
lines.push('');
lines.push('export interface ThHeightStamp {');
lines.push('  x: number;');
lines.push('  z: number;');
lines.push('  radius: number;');
lines.push('  delta: number;');
lines.push("  falloff: 'smooth' | 'flat';");
lines.push("  mode?: 'level';");
lines.push('  hardness?: number;');
lines.push("  alpha?: 'splatter';");
lines.push('}');
lines.push('');
lines.push(`export const TH_HALF_X = ${j(map.worldHalfX ?? 120)};`);
lines.push(`export const TH_HALF_Z = ${j(map.content.zones[0].zMax)};`);
lines.push(`export const TH_SEED = ${j(map.meta.seed ?? 0)};`);
lines.push('');
// The big tables are emitted as JSON.parse over a string literal: a typed
// object-literal array this large trips tsc's union-complexity limit (TS2590),
// while a parsed constant is assignability-checked only against the declared
// type. The JSON never contains quotes or backslashes (keys and numbers only),
// so the single-quoted embedding needs no escaping.
//
// LAZY, and that is the point. `src/sim/world.ts` is core, so this module lands
// in the main client entry for every player, and an eager parse of a megabyte
// of field data was ~37ms of startup on desktop (several times that on a
// low-end phone) charged to everyone whether or not they ever queue. Each table
// is a memoized getter instead: the JSON.parse happens on the first read. That
// saves the parse, not the byte cost: the literals still ship and still sit
// resident as source strings for every player. It is also per TABLE, not per
// player: TH_COLLIDERS is read whenever the collider grid is built, so only the
// placement, paint and stamp tables actually stay cold for someone who never
// queues. The exported SHAPE is unchanged (a readonly array), so every consumer
// and pin reads exactly as before.
const emitJsonConst = (name, type, value) => {
  const s = JSON.stringify(value);
  if (s.includes("'") || s.includes('\\')) throw new Error(`${name}: JSON needs escaping`);
  const json = `__${name.toLowerCase()}_json`;
  const cache = `__${name.toLowerCase()}`;
  const load = `__${name.toLowerCase()}_load`;
  // The literal is stored ONCE and parsed on first touch. The Proxy keeps the
  // exported shape a plain readonly array, so no consumer or pin changes.
  lines.push(`const ${json} =`);
  lines.push(`  '${s}';`);
  lines.push(`let ${cache}: ${type} | null = null;`);
  lines.push(`const ${load} = (): ${type} => (${cache} ??= JSON.parse(${json}));`);
  lines.push(`export const ${name}: ${type} = new Proxy([] as unknown as ${type}, {`);
  lines.push(`  get: (_t, p, r) => Reflect.get(${load}() as object, p, r),`);
  lines.push(`  has: (_t, p) => Reflect.has(${load}() as object, p),`);
  lines.push(`  ownKeys: () => Reflect.ownKeys(${load}() as object),`);
  lines.push(`  getOwnPropertyDescriptor: (_t, p) =>`);
  lines.push(`    Reflect.getOwnPropertyDescriptor(${load}() as object, p),`);
  lines.push('});');
};

const stampRows = stamps.map((e) => {
  const o = {
    x: round(e.x),
    z: round(e.z),
    radius: round(e.radius),
    delta: round(e.delta),
    falloff: e.falloff,
  };
  if (e.mode === 'level') o.mode = 'level';
  if (e.hardness !== undefined) o.hardness = round(e.hardness);
  if (e.alpha) o.alpha = e.alpha;
  return o;
});
emitJsonConst('TH_STAMPS', 'readonly ThHeightStamp[]', stampRows);
lines.push('');
lines.push('export const TH_BASES = [');
for (const b of bases) {
  lines.push(
    `  { team: ${b.team} as 0 | 1, flag: ${j(b.flag)}, spawns: ${j(b.spawns)}, banner: ${j(b.banner)} },`,
  );
}
lines.push('] as const;');
lines.push('');
lines.push(`export const TH_GRAVEYARDS = ${j(graveyards)} as const;`);
lines.push(`export const TH_SPEED_RUNES = ${j(speedRunes)} as const;`);
lines.push(`export const TH_POWER_RUNES = ${j(powerRunes)} as const;`);
lines.push('');
emitJsonConst('TH_COLLIDERS', 'readonly Collider[]', colliders);
lines.push('');
emitJsonConst('TH_PLACEMENTS', 'readonly ThFieldPlacement[]', renderPlacements);
lines.push('');
lines.push('export interface ThPaintSwatch {');
lines.push('  id: number;');
lines.push(
  '  /** Basename under public/textures/battleground/ (extension resolved by the renderer manifest). */',
);
lines.push('  texture: string;');
lines.push('  /** Ground tiling period, yards. */');
lines.push('  tileSize: number;');
lines.push('  /** Albedo lift, -1..1. */');
lines.push('  light: number;');
lines.push('}');
lines.push('');
lines.push(`export const TH_PAINT_SWATCHES: readonly ThPaintSwatch[] = ${j(swatches)};`);
lines.push(`export const TH_PAINT_CELL = ${j(paint.cell)};`);
lines.push(`export const TH_PAINT_COLS = ${j(paint.cols)};`);
lines.push(`export const TH_PAINT_ROWS = ${j(paint.rows)};`);
lines.push(`export const TH_PAINT_ORIGIN_X = ${j(paint.originX)};`);
lines.push(`export const TH_PAINT_ORIGIN_Z = ${j(paint.originZ)};`);
lines.push('/** Run-length pairs [id, count, id, count, ...] over the row-major cell grid. */');
emitJsonConst('TH_PAINT_RLE', 'readonly number[]', rle);
lines.push('');
lines.push(
  `export const TH_LIGHTS = ${j((map.lights ?? []).map((l) => ({ x: round(l.x), y: round(l.y ?? 3), z: round(l.z), color: l.color, intensity: l.intensity, range: l.range })))} as const;`,
);
lines.push(
  `export const TH_DECALS = ${j((map.decals ?? []).map((d) => ({ x: round(d.x), z: round(d.z), tex: d.tex.replace(/^builtin:/, ''), size: round(d.size), rot: round(d.rot ?? 0) })))} as const;`,
);
lines.push(
  `export const TH_LOCATIONS = ${j((map.locations ?? []).map((l) => ({ name: l.name, minX: l.minX, minZ: l.minZ, maxX: l.maxX, maxZ: l.maxZ })))} as const;`,
);
lines.push('');
lines.push('/** Build-time heights the runtime heightfield must reproduce (see tests). */');
lines.push(`export const TH_HEIGHT_PROBES = ${j(probes)} as const;`);
lines.push('');
lines.push('// The baked heightfield: 1yd cells over the full rect, column-major');
lines.push('// (index = col * rows + row), uint16 little-endian centimeters above');
lines.push('// TH_HEIGHT_MIN, base64. Decoded once by src/sim/battleground_field.ts.');
lines.push(`export const TH_HEIGHT_CELL = ${j(H_CELL)};`);
lines.push(`export const TH_HEIGHT_COLS = ${j(H_COLS)};`);
lines.push(`export const TH_HEIGHT_ROWS = ${j(H_ROWS)};`);
lines.push(`export const TH_HEIGHT_MIN = ${j(round(hMin))};`);
lines.push(`export const TH_HEIGHTFIELD_B64 =`);
for (let i = 0; i < heightB64.length; i += 400) {
  const chunk = heightB64.slice(i, i + 400);
  lines.push(`  '${chunk}'${i + 400 < heightB64.length ? ' +' : ';'}`);
}
lines.push('');

writeFileSync(OUT_PATH, lines.join('\n'));
console.log(
  `wrote ${OUT_PATH}: ${stamps.length} stamps, ${colliders.length} colliders ` +
    `(${bakedBoxCount} baked boxes, ${rampDeckCount} ramp decks, ${circleFallbackCount} circle fallbacks, ` +
    `${passUnderDropped} pass-under boxes dropped), ` +
    `${renderPlacements.length} placements, ${swatches.length} swatches, RLE ${rle.length / 2} runs`,
);
