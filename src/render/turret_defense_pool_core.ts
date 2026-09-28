// Fire and Fly monsters on screen, the pool half: how many rigs of each
// template the wave plan can put on screen at once, which to build first,
// which rig and which marker body each monster holds (by id, the living before
// corpses), the feedback ring consumed once by sequence number, and the
// placeholder shell and blast timeline. The painter is turret_defense_visual.ts.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES) and allocation-free per frame: the
// books and pools are fixed arrays refilled in place.

import { TURRET_WEAPON } from '../sim/content/turret_defense';
import type { TurretEvent } from '../sim/minigames/turret_defense';
import { type TurretFeedback, turretFeedbackSince } from '../sim/minigames/turret_feedback';

export interface TurretPlanInput {
  readonly kinds: readonly { readonly templateId: string }[];
  readonly waves: readonly { readonly spawns: readonly number[] }[];
}

function templateCountsPerWave(plan: TurretPlanInput): Map<string, number>[] {
  return plan.waves.map((wave) => {
    const counts = new Map<string, number>();
    for (const kind of wave.spawns) {
      const id = plan.kinds[kind]?.templateId;
      if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  });
}

/**
 * Rigs per template: the most of it any wave spawns, plus the previous wave's
 * of the same template, whose corpses can still lie there while the next wave
 * spawns. A wave never clears with a living monster, and an older corpse has
 * sunk long before a whole wave and its break have passed.
 */
export function turretRigCapacities(plan: TurretPlanInput): Map<string, number> {
  const perWave = templateCountsPerWave(plan);
  const capacities = new Map<string, number>();
  perWave.forEach((counts, w) => {
    for (const [id, count] of counts) {
      const carried = w > 0 ? (perWave[w - 1].get(id) ?? 0) : 0;
      capacities.set(id, Math.max(capacities.get(id) ?? 0, count + carried));
    }
  });
  return capacities;
}

/** Marker bodies (stand-in, health bar, strike ring): every body a wave and its predecessor can field. */
export function turretBodyCapacity(plan: TurretPlanInput): number {
  let most = 0;
  plan.waves.forEach((wave, w) => {
    const carried = w > 0 ? plan.waves[w - 1].spawns.length : 0;
    most = Math.max(most, wave.spawns.length + carried);
  });
  return most;
}

function addWaveTemplates(plan: TurretPlanInput, w: number, into: string[]): void {
  for (const kind of plan.waves[w]?.spawns ?? []) {
    const id = plan.kinds[kind]?.templateId;
    if (id !== undefined && !into.includes(id)) into.push(id);
  }
}

/** Templates in build priority: the current wave's, the next, then later waves, then the previous wave's. */
export function turretBuildOrder(plan: TurretPlanInput, wave: number): string[] {
  const order: string[] = [];
  const from = Math.max(0, wave);
  for (let w = from; w < plan.waves.length; w++) addWaveTemplates(plan, w, order);
  if (from > 0) addWaveTemplates(plan, from - 1, order);
  return order;
}

/**
 * The templates whose rigs are built on the frame (the current and the next
 * wave's); the rest of the order waits for idle time.
 */
export function turretUrgentTemplates(plan: TurretPlanInput, wave: number): Set<string> {
  const urgent: string[] = [];
  const from = Math.max(0, wave);
  addWaveTemplates(plan, from, urgent);
  addWaveTemplates(plan, from + 1, urgent);
  return new Set(urgent);
}

/** The next template to build one rig of, or null when every pool in the order is full or blocked. */
export function nextTurretRig(
  order: readonly string[],
  capacities: ReadonlyMap<string, number>,
  built: ReadonlyMap<string, number>,
  blocked: { has(templateId: string): boolean },
): string | null {
  for (const id of order) {
    if (blocked.has(id)) continue;
    if ((built.get(id) ?? 0) < (capacities.get(id) ?? 0)) return id;
  }
  return null;
}

export interface TurretMonsterRef {
  readonly id: number;
  readonly kind: number;
  readonly hp: number;
}

/**
 * Which rig and which marker body each monster holds. Assignments stick to the
 * monster id; a monster only ever takes a READY rig (the rest draw their
 * stand-in), and a living monster may take a ready rig from a corpse of its
 * template when none is free. A slot whose monster left the view is released.
 */
export class TurretSlotBook {
  readonly rigTemplate: string[] = [];
  readonly rigReady: boolean[] = [];
  readonly rigId: (number | null)[] = [];
  readonly bodyId: (number | null)[] = [];
  private readonly rigLiving: boolean[] = [];
  private readonly rigStamp: number[] = [];
  private readonly bodyStamp: number[] = [];
  private readonly rigById = new Map<number, number>();
  private readonly bodyById = new Map<number, number>();
  private frame = 0;

  addRig(templateId: string): number {
    this.rigTemplate.push(templateId);
    this.rigReady.push(false);
    this.rigId.push(null);
    this.rigLiving.push(false);
    this.rigStamp.push(0);
    return this.rigTemplate.length - 1;
  }

  setRigReady(index: number): void {
    this.rigReady[index] = true;
  }

  /** Grows the marker bodies to `count` (never shrinks). */
  growBodies(count: number): void {
    while (this.bodyId.length < count) {
      this.bodyId.push(null);
      this.bodyStamp.push(0);
    }
  }

  rigOf(id: number): number {
    return this.rigById.get(id) ?? -1;
  }

  bodyOf(id: number): number {
    return this.bodyById.get(id) ?? -1;
  }

  releaseAll(): void {
    this.rigId.fill(null);
    this.bodyId.fill(null);
    this.rigById.clear();
    this.bodyById.clear();
  }

  assign(monsters: readonly TurretMonsterRef[], templateOf: (kind: number) => string): void {
    const frame = ++this.frame;
    for (const m of monsters) {
      const body = this.bodyById.get(m.id);
      if (body !== undefined) this.bodyStamp[body] = frame;
      const rig = this.rigById.get(m.id);
      if (rig !== undefined) {
        this.rigStamp[rig] = frame;
        this.rigLiving[rig] = m.hp > 0;
      }
    }
    for (let i = 0; i < this.bodyId.length; i++) {
      const id = this.bodyId[i];
      if (id !== null && this.bodyStamp[i] !== frame) {
        this.bodyId[i] = null;
        this.bodyById.delete(id);
      }
    }
    for (let i = 0; i < this.rigId.length; i++) {
      const id = this.rigId[i];
      if (id !== null && this.rigStamp[i] !== frame) {
        this.rigId[i] = null;
        this.rigById.delete(id);
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      const living = pass === 0;
      for (const m of monsters) {
        if (m.hp > 0 !== living) continue;
        if (!this.bodyById.has(m.id)) this.takeBody(m.id, frame);
        if (!this.rigById.has(m.id)) this.takeRig(m, templateOf(m.kind), frame, living);
      }
    }
  }

  private takeBody(id: number, frame: number): void {
    const free = this.bodyId.indexOf(null);
    if (free < 0) return;
    this.bodyId[free] = id;
    this.bodyStamp[free] = frame;
    this.bodyById.set(id, free);
  }

  private takeRig(m: TurretMonsterRef, templateId: string, frame: number, living: boolean): void {
    let corpse = -1;
    for (let i = 0; i < this.rigId.length; i++) {
      if (!this.rigReady[i] || this.rigTemplate[i] !== templateId) continue;
      if (this.rigId[i] === null) {
        this.occupy(i, m, frame);
        return;
      }
      if (living && corpse < 0 && !this.rigLiving[i]) corpse = i;
    }
    if (corpse < 0) return;
    const evicted = this.rigId[corpse];
    if (evicted !== null) this.rigById.delete(evicted);
    this.occupy(corpse, m, frame);
  }

  private occupy(index: number, m: TurretMonsterRef, frame: number): void {
    this.rigId[index] = m.id;
    this.rigStamp[index] = frame;
    this.rigLiving[index] = m.hp > 0;
    this.rigById.set(m.id, index);
  }
}

const NO_FEEDBACK: readonly TurretFeedback[] = [];

export interface TurretFeedbackSource {
  readonly defense: { readonly startTick: number };
  readonly feedback: readonly TurretFeedback[];
}

/**
 * Hands each feedback entry out once. The cursor restarts with every seat
 * (seq restarts at 1, and the seat's start tick changes); a first new seq above
 * the last one plus one means the ring overflowed between reads, counted in
 * `dropped`. An unchanged view object carries nothing new and costs nothing.
 */
export class TurretFeedbackCursor {
  dropped = 0;
  private lastView: TurretFeedbackSource | null = null;
  private startTick = Number.NaN;
  private lastSeq = 0;

  reset(): void {
    this.lastView = null;
    this.startTick = Number.NaN;
    this.lastSeq = 0;
  }

  take(view: TurretFeedbackSource): readonly TurretFeedback[] {
    if (view === this.lastView) return NO_FEEDBACK;
    this.lastView = view;
    if (view.defense.startTick !== this.startTick) {
      this.startTick = view.defense.startTick;
      this.lastSeq = 0;
    }
    const fresh = turretFeedbackSince(view.feedback, this.lastSeq);
    if (fresh.length === 0) return NO_FEEDBACK;
    if (fresh[0].seq > this.lastSeq + 1) this.dropped += fresh[0].seq - this.lastSeq - 1;
    this.lastSeq = fresh[fresh.length - 1].seq;
    return fresh;
  }
}

export type TurretFiredEvent = Extract<TurretEvent, { type: 'fired' }>;
export type TurretImpactEvent = Extract<TurretEvent, { type: 'impact' }>;

/** The cooldown against the longest flight bounds the shells in the air below this. */
export const TURRET_SHELL_POOL = 4;
export const TURRET_BLAST_POOL = 4;
export const TURRET_BLAST_TICKS = 8;
export const TURRET_MUZZLE_LIFT = 2.2;
export const TURRET_MUZZLE_REACH = 2;

export interface TurretShellSlot {
  shotId: number;
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  firedTick: number;
  impactTick: number;
  arc: number;
}

export interface TurretBlastSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  tick: number;
}

export interface TurretBlastFrame {
  /** Flash sphere radius (yd). */
  flash: number;
  /** Ground ring radius (yd), growing to the blast radius. */
  ring: number;
}

/** The placeholder shot: a shell on a parabola from an approximate muzzle to the blast, then a flash and a ring. */
export class TurretShotFx {
  readonly shells: TurretShellSlot[] = Array.from({ length: TURRET_SHELL_POOL }, () => ({
    shotId: 0,
    fromX: 0,
    fromY: 0,
    fromZ: 0,
    toX: 0,
    toY: 0,
    toZ: 0,
    firedTick: 0,
    impactTick: 0,
    arc: 0,
  }));
  readonly blasts: TurretBlastSlot[] = Array.from({ length: TURRET_BLAST_POOL }, () => ({
    active: false,
    x: 0,
    y: 0,
    z: 0,
    tick: 0,
  }));
  private nextShell = 0;
  private nextBlast = 0;

  clear(): void {
    for (const shell of this.shells) shell.shotId = 0;
    for (const blast of this.blasts) blast.active = false;
  }

  /** `originY` is the turret's ground height; the muzzle sits above it, toward the shot. */
  fired(ev: TurretFiredEvent, originY: number): void {
    const slot = this.shells[this.nextShell];
    this.nextShell = (this.nextShell + 1) % this.shells.length;
    const dx = ev.x - ev.fromX;
    const dz = ev.z - ev.fromZ;
    const dist = Math.hypot(dx, dz);
    const ux = dist > 1e-6 ? dx / dist : 0;
    const uz = dist > 1e-6 ? dz / dist : 1;
    slot.shotId = ev.shotId;
    slot.fromX = ev.fromX + ux * TURRET_MUZZLE_REACH;
    slot.fromY = originY + TURRET_MUZZLE_LIFT;
    slot.fromZ = ev.fromZ + uz * TURRET_MUZZLE_REACH;
    slot.toX = ev.x;
    slot.toY = ev.y;
    slot.toZ = ev.z;
    slot.impactTick = ev.impactTick;
    slot.firedTick = ev.impactTick - ev.flightTicks;
    slot.arc = Math.min(6, Math.max(1, dist * 0.12));
  }

  impact(ev: TurretImpactEvent, tick: number): void {
    for (const shell of this.shells) if (shell.shotId === ev.shotId) shell.shotId = 0;
    const slot = this.blasts[this.nextBlast];
    this.nextBlast = (this.nextBlast + 1) % this.blasts.length;
    slot.active = true;
    slot.x = ev.x;
    slot.y = ev.y;
    slot.z = ev.z;
    slot.tick = tick;
  }

  /** Writes the shell's position at `tick`; false when the slot draws nothing. */
  shellAt(index: number, tick: number, out: { x: number; y: number; z: number }): boolean {
    const s = this.shells[index];
    if (!s || s.shotId === 0) return false;
    const span = s.impactTick - s.firedTick;
    const t = span > 0 ? Math.min(1, Math.max(0, (tick - s.firedTick) / span)) : 1;
    if (t >= 1) {
      s.shotId = 0;
      return false;
    }
    out.x = s.fromX + (s.toX - s.fromX) * t;
    out.z = s.fromZ + (s.toZ - s.fromZ) * t;
    out.y = s.fromY + (s.toY - s.fromY) * t + 4 * s.arc * t * (1 - t);
    return true;
  }

  /** Writes the blast's flash and ring at `tick`; false once it has faded. */
  blastAt(index: number, tick: number, out: TurretBlastFrame): boolean {
    const b = this.blasts[index];
    if (!b?.active) return false;
    const age = Math.max(0, tick - b.tick) / TURRET_BLAST_TICKS;
    if (age >= 1) {
      b.active = false;
      return false;
    }
    out.flash = TURRET_WEAPON.blastCore * (1 + age) * (1 - age);
    out.ring = 0.5 + (TURRET_WEAPON.blastRadius - 0.5) * Math.sqrt(age);
    return true;
  }
}
