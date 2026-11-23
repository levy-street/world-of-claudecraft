// Moving parts of placed building clones: the bank's vault door (SPACEY,
// 2026-09-26: "have a massive vault door in the building that opens when you
// click on it").
//
// A kit building marks each moving part as its own glTF node named G_MOV_*
// whose origin is its pivot, carrying its motion as extras (userData.wocMover,
// written by scripts/assets/blender_tidehold/bl_town_lib.py vault_door):
//
//   { kind: 'swing', axis: 'y', angle }   the leaf, about its hinge line
//   { kind: 'spin',  axis: 'z', angle }   the wheel, about its axle
//   { kind: 'slide', axis: 'x', dist }    the locking bolts, into the leaf
//
// A click toggles the set between shut (t = 0) and open (t = 1). Opening runs
// the lock first (the wheel turns, the bolts draw back) and then swings the
// leaf; shutting runs it backwards. Each clone keeps its own state: it is the
// viewer's door, never synced (the doorway's collision is always closed; the
// strongroom behind it is for looking at).
//
// G_MOV_* nodes are merge buckets (placed_assets STOREY_GROUP_NAMES), so the
// runtime mesh merge never fuses a moving part into its storey. The clone's
// matrices are frozen (static_matrix.ts): a moved node recomposes its own
// matrix and world matrix here, and nothing else ever has to.
import * as THREE from 'three';

export type MoverKind = 'swing' | 'spin' | 'slide';
export interface MoverMotion {
  kind: MoverKind;
  axis: 'x' | 'y' | 'z';
  angle?: number;
  dist?: number;
}

/** Seconds for a full open (or shut). */
export const MOVER_SECONDS = 3.4;
/** The share of the run the lock takes (wheel + bolts) before the swing. */
export const MOVER_LOCK_SHARE = 0.28;
/** How near (yd, horizontal) a player must stand to work a mover. */
export const PLACED_MOVER_REACH = 10;

export type MoverCue = 'unlock' | 'swing' | 'shut' | 'lock';
/** The sound each stage plays (game/sfx keys): the lock gives, the leaf
 *  grinds round on its hinges, it clangs home, the bolts shoot. */
export const PLACED_MOVER_SFX: Record<MoverCue, string> = {
  unlock: 'lockpick_success',
  swing: 'rift_gate_grind',
  shut: 'impact_metal',
  lock: 'lockpick_bind',
};

function smooth01(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/** How far through its own motion a part of `kind` is at run time `t` (0..1). */
export function moverFraction(kind: MoverKind, t: number): number {
  if (kind === 'swing') return smooth01((t - MOVER_LOCK_SHARE) / (1 - MOVER_LOCK_SHARE));
  return smooth01(t / MOVER_LOCK_SHARE);
}

/** Advance run time `t` toward `target` by `dt` seconds. */
export function stepMoverTime(t: number, target: 0 | 1, dt: number): number {
  const step = dt / MOVER_SECONDS;
  return target === 1 ? Math.min(1, t + step) : Math.max(0, t - step);
}

/** The sound cues crossed going from `from` to `to`. */
export function moverCues(from: number, to: number): MoverCue[] {
  const out: MoverCue[] = [];
  if (to > from) {
    if (from <= 0) out.push('unlock');
    if (from < MOVER_LOCK_SHARE && to >= MOVER_LOCK_SHARE) out.push('swing');
  } else if (to < from) {
    if (from >= 1) out.push('swing');
    if (from > MOVER_LOCK_SHARE && to <= MOVER_LOCK_SHARE) out.push('shut');
    if (to <= 0) out.push('lock');
  }
  return out;
}

/** Read a node's motion extras, or null when it is not a mover. */
export function moverMotionOf(o: THREE.Object3D): MoverMotion | null {
  const m = (o.userData as { wocMover?: unknown }).wocMover as Partial<MoverMotion> | undefined;
  if (!m || typeof m !== 'object') return null;
  if (m.kind !== 'swing' && m.kind !== 'spin' && m.kind !== 'slide') return null;
  if (m.axis !== 'x' && m.axis !== 'y' && m.axis !== 'z') return null;
  return { kind: m.kind, axis: m.axis, angle: m.angle, dist: m.dist };
}

interface Part {
  node: THREE.Object3D;
  motion: MoverMotion;
  rest: number;
}

interface MoverSet {
  owner: object;
  model: THREE.Object3D;
  parts: Part[];
  /** What a click has to hit: the swinging leaf (and everything on it). */
  hit: THREE.Object3D;
  t: number;
  target: 0 | 1;
}

export interface MoverHit {
  id: number;
  x: number;
  y: number;
  z: number;
}

export interface MoverUpdate {
  changed: boolean;
  cues: { cue: MoverCue; x: number; y: number; z: number }[];
}

function visibleChain(o: THREE.Object3D | null): boolean {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Every mover set of the placed clones in one view. */
export class PlacedMovers {
  private readonly sets = new Map<number, MoverSet>();
  private nextId = 1;
  private readonly hits: THREE.Intersection[] = [];
  private readonly tmp = new THREE.Vector3();

  get count(): number {
    return this.sets.size;
  }

  /** Register a fresh clone's moving parts (a no-op for a clone with none). */
  add(owner: object, model: THREE.Object3D): void {
    const parts: Part[] = [];
    let hit: THREE.Object3D | null = null;
    model.traverse((o) => {
      const motion = moverMotionOf(o);
      if (!motion) return;
      const rest = motion.kind === 'slide' ? o.position[motion.axis] : o.rotation[motion.axis];
      parts.push({ node: o, motion, rest });
      if (motion.kind === 'swing' && !hit) hit = o;
    });
    if (parts.length === 0) return;
    this.sets.set(this.nextId++, {
      owner,
      model,
      parts,
      hit: hit ?? parts[0].node,
      t: 0,
      target: 0,
    });
  }

  /** Drop the sets whose clone left the scene (or was swapped). */
  prune(alive: (owner: object, model: THREE.Object3D) => boolean): void {
    for (const [id, set] of this.sets) if (!alive(set.owner, set.model)) this.sets.delete(id);
  }

  /** The mover a ray hits first (visible parts only), or null. */
  pick(raycaster: THREE.Raycaster): MoverHit | null {
    let best: MoverHit | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const [id, set] of this.sets) {
      if (!visibleChain(set.hit)) continue;
      this.hits.length = 0;
      raycaster.intersectObject(set.hit, true, this.hits);
      const h = this.hits[0];
      if (h && h.distance < bestD) {
        bestD = h.distance;
        best = { id, x: h.point.x, y: h.point.y, z: h.point.z };
      }
    }
    this.hits.length = 0;
    return best;
  }

  /** Open a shut door, shut an open one (a moving one turns round). */
  toggle(id: number): void {
    const set = this.sets.get(id);
    if (!set) return;
    set.target = set.target === 1 ? 0 : 1;
  }

  isOpen(id: number): boolean {
    return this.sets.get(id)?.target === 1;
  }

  /** Advance every moving set by `dt` seconds and pose its parts. */
  update(dt: number): MoverUpdate {
    const out: MoverUpdate = { changed: false, cues: [] };
    for (const set of this.sets.values()) {
      if (set.t === set.target) continue;
      const from = set.t;
      set.t = stepMoverTime(set.t, set.target, dt);
      const at = set.hit.getWorldPosition(this.tmp);
      for (const cue of moverCues(from, set.t)) out.cues.push({ cue, x: at.x, y: at.y, z: at.z });
      for (const p of set.parts) {
        const f = moverFraction(p.motion.kind, set.t);
        if (p.motion.kind === 'slide')
          p.node.position[p.motion.axis] = p.rest + (p.motion.dist ?? 0) * f;
        else p.node.rotation[p.motion.axis] = p.rest + (p.motion.angle ?? 0) * f;
        p.node.updateMatrix();
      }
      // world matrices top-down (the wheel and bolts ride on the leaf)
      for (const p of set.parts) {
        if (p.node.parent && moverMotionOf(p.node.parent)) continue;
        p.node.updateMatrixWorld(true);
      }
      out.changed = true;
    }
    return out;
  }
}
