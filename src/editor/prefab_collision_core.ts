// Prefab pieces: hand the building's AUTHORED collision to the pieces it
// breaks into, instead of letting each piece fall back to its own bounding box.
//
// SPACEY, 2026-09-09: "when pressing on a prefab building to break it down into
// its separate parts make sure the collision remains, right now it switches to
// basic collision". It never literally switched mode: every piece stayed
// `baked`, but on a SOLID BOX around its own mesh (the parts overrides the
// installer measures). Thirty-one hand-authored boxes that leave the doorways
// open, plus seven walkable ramps, became 233 solid lumps, the doors sealed,
// the stairs stopped being decks, and the building read as one blocking mass.
//
// So the split now redistributes the building's own shape. Every authored box
// is converted into the frame of the piece that occupies it and attached as
// that placement's `hitboxes` (which REPLACE the asset bake in colliders.ts);
// the ramps go to the shell, which is the hand-built floor/stair geometry and
// keeps the building's own transform. The union of what comes out is the same
// collision the building had, box for box, proved in
// tests/editor_prefab_collision_core.test.ts by mapping both back to world.
//
// Pieces that end up with nothing are stamped `none`, never left undefined:
// undefined would fall through to their bounding-box override and seal the
// very openings this module exists to keep.
//
// Frames. Everything here is the same model-yard frame as prefab_pieces_core:
// an override coordinate is a model yard times `PIECE_TARGET / maxDim`, with y
// measured from the model's lowest vertex (the renderer seats that on the
// ground). Pure math over the manifest: no DOM, no three.

import type { AuthoredCollisionRamp, MapHitbox } from '../sim/map_doc';
import { MAX_PLACEMENT_HITBOXES, MAX_PLACEMENT_RAMPS } from '../sim/map_doc';
import { PIECE_TARGET, type PrefabPiecesDef } from './prefab_pieces_core';

/** A node the collision can be expressed in: a kit piece, or the shell (which
 *  sits at the model origin, unrotated and unscaled). */
export interface CollisionFrame {
  x: number;
  y: number;
  z: number;
  rotY: number;
  s: number;
  sy: number;
  sz: number;
  maxDim: number;
  minY: number;
}

/** What one placement carries away from the split. */
export interface CollisionShare {
  hitboxes: MapHitbox[];
  ramps: AuthoredCollisionRamp[];
}

export interface PrefabAuthoredCollision {
  boxes: readonly MapHitbox[];
  ramps: readonly AuthoredCollisionRamp[];
}

/** Shell frame: the model origin itself. */
export function shellFrame(def: Pick<PrefabPiecesDef, 'shell'>): CollisionFrame | null {
  if (!def.shell) return null;
  return {
    x: 0,
    y: 0,
    z: 0,
    rotY: 0,
    s: 1,
    sy: 1,
    sz: 1,
    maxDim: def.shell.maxDim,
    minY: def.shell.minY,
  };
}

/** Three's rotation about +Y, the convention colliders.ts uses. */
function rotY(lx: number, lz: number, rot: number): { x: number; z: number } {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

function emptyShare(): CollisionShare {
  return { hitboxes: [], ramps: [] };
}

/** Override units per model yard for a normalized model. */
function normOf(maxDim: number): number {
  return PIECE_TARGET / (maxDim || 1);
}

/** A building override box, in MODEL yards of the building GLB. */
function boxInModel(
  b: MapHitbox,
  building: Pick<PrefabPiecesDef, 'maxDim' | 'minY'>,
): { x: number; y: number; z: number; hx: number; hy: number; hz: number; ry: number } {
  const n = normOf(building.maxDim);
  return {
    x: b.x / n,
    y: b.y / n + building.minY,
    z: b.z / n,
    hx: b.hx / n,
    hy: b.hy / n,
    hz: b.hz / n,
    ry: b.ry ?? 0,
  };
}

/** Model-space point -> the frame's own override space. The xz rotation is
 *  undone before the per-axis divide, which is exact for the uniform node
 *  scales the kit ships; a node with sz != sx AND its own yaw would skew, and
 *  none do (the installer writes sy/sz as ratios to s, both 1 in practice). */
function pointToFrame(
  mx: number,
  my: number,
  mz: number,
  f: CollisionFrame,
): { x: number; y: number; z: number } {
  const l = rotY(mx - f.x, mz - f.z, -f.rotY);
  const n = normOf(f.maxDim);
  return {
    x: (l.x / f.s) * n,
    y: ((my - f.y) / (f.s * f.sy) - f.minY) * n,
    z: (l.z / (f.s * f.sz)) * n,
  };
}

/** One authored box, re-expressed in a piece's (or the shell's) override space. */
export function boxToFrame(
  b: MapHitbox,
  building: Pick<PrefabPiecesDef, 'maxDim' | 'minY'>,
  f: CollisionFrame,
): MapHitbox {
  const m = boxInModel(b, building);
  const c = pointToFrame(m.x, m.y, m.z, f);
  const n = normOf(f.maxDim);
  const out: MapHitbox = {
    x: c.x,
    y: c.y,
    z: c.z,
    hx: (m.hx / f.s) * n,
    hy: (m.hy / (f.s * f.sy)) * n,
    hz: (m.hz / (f.s * f.sz)) * n,
  };
  const ry = m.ry - f.rotY;
  if (Math.abs(ry) > 1e-9) out.ry = ry;
  return out;
}

/** One authored ramp (a walkable deck), re-expressed in a frame. */
export function rampToFrame(
  r: AuthoredCollisionRamp,
  building: Pick<PrefabPiecesDef, 'maxDim' | 'minY'>,
  f: CollisionFrame,
): AuthoredCollisionRamp {
  const n = normOf(building.maxDim);
  const mx = r.x / n;
  const mz = r.z / n;
  const my0 = r.y0 / n + building.minY;
  const my1 = r.y1 / n + building.minY;
  const lo = pointToFrame(mx, my0, mz, f);
  const hi = pointToFrame(mx, my1, mz, f);
  const nf = normOf(f.maxDim);
  const out: AuthoredCollisionRamp = {
    x: lo.x,
    z: lo.z,
    hx: (r.hx / n / f.s) * nf,
    hz: (r.hz / n / (f.s * f.sz)) * nf,
    y0: lo.y,
    y1: hi.y,
  };
  const ry = (r.ry ?? 0) - f.rotY;
  if (Math.abs(ry) > 1e-9) out.ry = ry;
  return out;
}

/** How far a piece's own mesh reaches from its node, in model yards. Only the
 *  largest extent is measured into the manifest, so this is a sphere: good
 *  enough to say "this box belongs to that wall", and every box lands
 *  SOMEWHERE regardless, so the union never changes. */
function pieceReach(p: PrefabPiecesDef['pieces'][number]): number {
  return Math.max(0.05, (p.s * p.maxDim) / 2);
}

/** Can a shape be re-expressed in this node's frame WITHOUT distortion?
 *  Undoing the node's yaw and its per-axis scale only commute when the scale is
 *  uniform (or there is no yaw); a node that is both turned and stretched would
 *  skew the box, so it never carries collision, the shell takes that shape
 *  instead, and the union stays exact. */
function frameIsExact(p: PrefabPiecesDef['pieces'][number]): boolean {
  const uniform = Math.abs(p.sy - 1) < 1e-9 && Math.abs(p.sz - 1) < 1e-9;
  return uniform || Math.abs(p.rotY) < 1e-9;
}

/** Index of the piece that best owns a model-space point, or -1 for none. */
function ownerOf(mx: number, my: number, mz: number, def: PrefabPiecesDef): number {
  let best = -1;
  let bestScore = Infinity;
  def.pieces.forEach((p, i) => {
    if (!frameIsExact(p)) return;
    const reach = pieceReach(p);
    const d = Math.hypot(mx - p.x, my - p.y, mz - p.z);
    if (d > reach) return;
    const score = d / reach;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Nearest piece to a model-space point, ignoring reach (the last resort when
 *  a building has no shell to fall back on). */
function nearestPiece(mx: number, my: number, mz: number, def: PrefabPiecesDef): number {
  let best = -1;
  let bestD = Infinity;
  def.pieces.forEach((p, i) => {
    if (!frameIsExact(p)) return;
    const d = Math.hypot(mx - p.x, my - p.y, mz - p.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** The authored box that produced a converted one, matched by world position:
 *  the borrow above moves a box between frames, and re-converting from the
 *  ORIGINAL keeps it exact instead of round-tripping through two frames. */
function authoredBoxOf(
  authored: PrefabAuthoredCollision,
  def: PrefabPiecesDef,
  f: CollisionFrame,
  converted: MapHitbox,
): MapHitbox | null {
  for (const b of authored.boxes) {
    const c = boxToFrame(b, def, f);
    if (Math.hypot(c.x - converted.x, c.y - converted.y, c.z - converted.z) < 1e-6) return b;
  }
  return null;
}

export interface PrefabCollisionSplit {
  /** null when the building has no shell. */
  shell: CollisionShare | null;
  /** One per def.pieces entry, in order. */
  pieces: CollisionShare[];
}

/**
 * Split a building's authored collision across the placements its pieces
 * become. Boxes go to the piece that occupies them (the shell takes the rest);
 * ramps stay with the shell, because a walkable floor belongs to the structure
 * rather than to whichever wall happens to stand nearest it.
 *
 * Per-placement caps are honoured by spilling to the next placement with room,
 * so a shape is never silently dropped.
 */
export function splitPrefabCollision(
  authored: PrefabAuthoredCollision,
  def: PrefabPiecesDef,
): PrefabCollisionSplit {
  const shellF = shellFrame(def);
  const shell = shellF ? emptyShare() : null;
  const pieces = def.pieces.map(() => emptyShare());
  const frameOf = (i: number): CollisionFrame => {
    const p = def.pieces[i];
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      rotY: p.rotY,
      s: p.s,
      sy: p.sy,
      sz: p.sz,
      maxDim: p.maxDim,
      minY: p.minY,
    };
  };

  for (const b of authored.boxes) {
    const m = boxInModel(b, def);
    let owner = ownerOf(m.x, m.y, m.z, def);
    if (owner < 0 && !shell) owner = nearestPiece(m.x, m.y, m.z, def);
    if (owner >= 0 && pieces[owner].hitboxes.length < MAX_PLACEMENT_HITBOXES) {
      pieces[owner].hitboxes.push(boxToFrame(b, def, frameOf(owner)));
      continue;
    }
    if (shell && shellF && shell.hitboxes.length < MAX_PLACEMENT_HITBOXES) {
      shell.hitboxes.push(boxToFrame(b, def, shellF));
      continue;
    }
    const spill = pieces.findIndex(
      (s, i) => frameIsExact(def.pieces[i]) && s.hitboxes.length < MAX_PLACEMENT_HITBOXES,
    );
    if (spill >= 0) pieces[spill].hitboxes.push(boxToFrame(b, def, frameOf(spill)));
  }

  // A walkable deck only counts on a placement that collides at all
  // (placement_ramps gates on collideRadius, which the editor derives from the
  // collision mode), and a placement with ramps but no boxes would fall back to
  // its own bounding-box override and seal itself. So every ramp carrier is
  // guaranteed a box first: the shell borrows the box nearest the model origin
  // when the distribution above left it empty.
  if (authored.ramps.length > 0 && shell && shellF && shell.hitboxes.length === 0) {
    let from = -1;
    let bestD = Infinity;
    pieces.forEach((share, i) => {
      if (share.hitboxes.length <= 1) return; // never strip a piece bare
      const p = def.pieces[i];
      const d = Math.hypot(p.x, p.y, p.z);
      if (d < bestD) {
        bestD = d;
        from = i;
      }
    });
    if (from >= 0) {
      const idx = pieces[from].hitboxes.length - 1;
      const borrowed = authoredBoxOf(authored, def, frameOf(from), pieces[from].hitboxes[idx]);
      pieces[from].hitboxes.splice(idx, 1);
      if (borrowed) shell.hitboxes.push(boxToFrame(borrowed, def, shellF));
    }
  }

  for (const r of authored.ramps) {
    if (shell && shellF && shell.hitboxes.length > 0 && shell.ramps.length < MAX_PLACEMENT_RAMPS) {
      shell.ramps.push(rampToFrame(r, def, shellF));
      continue;
    }
    const n = normOf(def.maxDim);
    const owner = nearestPiece(r.x / n, r.y0 / n + def.minY, r.z / n, def);
    const canTake = (i: number): boolean =>
      i >= 0 &&
      frameIsExact(def.pieces[i]) &&
      pieces[i].hitboxes.length > 0 &&
      pieces[i].ramps.length < MAX_PLACEMENT_RAMPS;
    const spill = canTake(owner) ? owner : pieces.findIndex((_, i) => canTake(i));
    if (spill >= 0) pieces[spill].ramps.push(rampToFrame(r, def, frameOf(spill)));
  }

  return { shell, pieces };
}

/** Stamp one exploded placement with its share. A placement that carries
 *  nothing is stamped `none` on purpose: leaving the mode undefined would fall
 *  back to the piece's own bounding-box override, which is exactly the solid
 *  lump this module replaces. */
export function applyCollisionShare(
  p: {
    collisionMode?: string;
    hitboxes?: MapHitbox[];
    ramps?: AuthoredCollisionRamp[];
    collide?: boolean;
  },
  share: CollisionShare | null,
): void {
  delete p.hitboxes;
  delete p.ramps;
  if (!share || share.hitboxes.length === 0) {
    p.collisionMode = 'none';
    return;
  }
  p.collisionMode = 'baked';
  p.collide = true;
  p.hitboxes = share.hitboxes;
  if (share.ramps.length > 0) p.ramps = share.ramps;
}
