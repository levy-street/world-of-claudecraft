// Fire and Fly monsters on screen, the pool half: how many rigs of each
// template the wave plan can put on screen at once, which to build first,
// which rig and which marker body each monster holds (by id, the living before
// corpses), and the feedback ring consumed once by sequence number. The painter
// is turret_defense_visual.ts; the shots' own timeline is cannon_shell_core.ts.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES) and allocation-free per frame: the
// books and pools are fixed arrays refilled in place; only a revision that brings
// new feedback entries slices them out of the ring.

import { FIRE_AND_FLY_DUNGEON_ID } from '../sim/content/fire_and_fly_arena';
import { fireAndFlyRigId } from '../sim/content/fire_and_fly_looks';
import { dungeonAt } from '../sim/data';
import { type TurretFeedback, turretFeedbackSince } from '../sim/minigames/turret_feedback';

export interface TurretPlanInput {
  readonly kinds: readonly { readonly templateId: string }[];
  readonly waves: readonly { readonly spawns: readonly number[] }[];
  /** A mission's overlap: the most living a wave may carry into the next. */
  readonly overlap?: number;
}

/**
 * The plan as the rig pool sees it: each kind named by its rig, so a template
 * dressed in another body in one scenario never takes a rig built plain in another.
 */
export function turretRigPlan(
  plan: TurretPlanInput & { readonly scenarioId: string },
): TurretPlanInput {
  return {
    kinds: plan.kinds.map((kind) => ({
      templateId: fireAndFlyRigId(kind.templateId, plan.scenarioId),
    })),
    waves: plan.waves,
    overlap: plan.overlap,
  };
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
 * Rigs per template: the most of it any wave spawns, plus the more of two holdovers: the
 * previous wave's of the same template (its corpses, which give their rigs up to the
 * living), or on an overlapping mission the living tail older waves carried in, at most
 * the overlap and at most what earlier waves spawned of it. A tail can skip a wave (a
 * pack leader that outlives the next wave), so the tail is counted over every earlier
 * wave, not the previous one alone. A living monster finding every rig of its template
 * taken takes a corpse's; only a corpse is ever left to its stand-in.
 */
export function turretRigCapacities(plan: TurretPlanInput): Map<string, number> {
  const perWave = templateCountsPerWave(plan);
  const overlap = plan.overlap ?? 0;
  const capacities = new Map<string, number>();
  const spawnedBefore = new Map<string, number>();
  perWave.forEach((counts, w) => {
    for (const [id, count] of counts) {
      const corpses = w > 0 ? (perWave[w - 1].get(id) ?? 0) : 0;
      const tail = Math.min(overlap, spawnedBefore.get(id) ?? 0);
      const need = count + Math.max(corpses, tail);
      capacities.set(id, Math.max(capacities.get(id) ?? 0, need));
    }
    for (const [id, count] of counts) spawnedBefore.set(id, (spawnedBefore.get(id) ?? 0) + count);
  });
  return capacities;
}

/**
 * Marker bodies (stand-in, health bar, strike ring): every body a wave and its predecessor
 * can field, plus on an overlapping plan the living an older wave carried into the
 * predecessor. Only a corpse can be left out (a still older one, lying on past a short
 * wave and the pause): it gives its body up to a living monster (TurretSlotBook).
 */
export function turretBodyCapacity(plan: TurretPlanInput): number {
  let most = 0;
  plan.waves.forEach((wave, w) => {
    const carried = w > 0 ? plan.waves[w - 1].spawns.length + (plan.overlap ?? 0) : 0;
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
 * The run's rigs and pools may be released: no seat shows and the player (drawn at
 * world x `playerX`) stands outside the Fire and Fly arena band. A Replay keeps its
 * seat, a seat that blinks out while the player still stands in the arena (an online
 * resume) keeps them, and so does a player not drawn yet (null): nowhere known is
 * never outside.
 */
export function turretRunResidencyOver(seated: boolean, playerX: number | null): boolean {
  if (seated || playerX === null || !Number.isFinite(playerX)) return false;
  return dungeonAt(playerX)?.id !== FIRE_AND_FLY_DUNGEON_ID;
}

/**
 * Which rig and which marker body each monster holds. Assignments stick to the
 * monster id; a monster only ever takes a READY rig (the rest draw their
 * stand-in), and a living monster may take a ready rig from a corpse of its
 * template, or any corpse's marker body, when none is free. A slot whose monster
 * left the view is released.
 */
export class TurretSlotBook {
  readonly rigTemplate: string[] = [];
  readonly rigReady: boolean[] = [];
  readonly rigId: (number | null)[] = [];
  readonly bodyId: (number | null)[] = [];
  private readonly rigLiving: boolean[] = [];
  private readonly rigStamp: number[] = [];
  private readonly bodyStamp: number[] = [];
  private readonly bodyLiving: boolean[] = [];
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
      this.bodyLiving.push(false);
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

  /** Forgets every rig and body slot: the pools they named were released. */
  clear(): void {
    this.rigTemplate.length = 0;
    this.rigReady.length = 0;
    this.rigId.length = 0;
    this.bodyId.length = 0;
    this.rigLiving.length = 0;
    this.rigStamp.length = 0;
    this.bodyStamp.length = 0;
    this.bodyLiving.length = 0;
    this.rigById.clear();
    this.bodyById.clear();
  }

  assign(monsters: readonly TurretMonsterRef[], templateOf: (kind: number) => string): void {
    const frame = ++this.frame;
    for (const m of monsters) {
      const body = this.bodyById.get(m.id);
      if (body !== undefined) {
        this.bodyStamp[body] = frame;
        this.bodyLiving[body] = m.hp > 0;
      }
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
        if (!this.bodyById.has(m.id)) this.takeBody(m.id, frame, living);
        if (!this.rigById.has(m.id)) this.takeRig(m, templateOf(m.kind), frame, living);
      }
    }
  }

  private takeBody(id: number, frame: number, living: boolean): void {
    let slot = this.bodyId.indexOf(null);
    if (slot < 0 && living) slot = this.bodyLiving.indexOf(false);
    if (slot < 0) return;
    const evicted = this.bodyId[slot];
    if (evicted !== null) this.bodyById.delete(evicted);
    this.bodyId[slot] = id;
    this.bodyStamp[slot] = frame;
    this.bodyLiving[slot] = living;
    this.bodyById.set(id, slot);
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
