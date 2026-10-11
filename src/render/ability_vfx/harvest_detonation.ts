import { FURY_AUDIO } from '../../game/fury_audio_core';
import type { AbilityVfxFullSpec } from '../ability_vfx_core';
import { harvestBeat } from './harvest_choreography';
import type { SequencerHost } from './sequencer';

/** The authored FINAL contact of Red Harvest, measured from its opening cue.
 * The sim resolves the whole cast on the cast tick (the opening selfCast cue
 * and all three damage events arrive in ONE tick), so the client owns the
 * contact timing: the detonation is staged to the beat the cue bed already
 * names instead of firing on the frame the damage lands. One constant, shared
 * with that bed, never a second literal. */
const FINAL_CONTACT_SEC = FURY_AUDIO.red_harvest.times[2];

/** How many casters can hold an opening inside one frame window. Fixed, so
 * the lookup allocates nothing and cannot grow; a caster pushed out by the
 * ring simply detonates on the next frame, the same read a missed opening
 * gets. */
const OPENING_SLOTS = 32;

/** Fold one authoritative damage batch into one collision per recipient, and
 * hold it until the authored final contact of the cast that produced it.
 * Lethal first hits and mixed miss/absorb batches still produce one true
 * result.
 *
 * A batch is staged ONLY when its caster opened exactly one cast in the frame
 * window that produced it. Both other cases detonate on the next frame, for
 * the same reason: never push combat that is already late further into the
 * future.
 *  - No opening at all: remote catch-up, or a caster outside interest range
 *    when the cue was emitted.
 *  - More than one opening in the window: a catch-up burst delivering several
 *    casts together (the earlier batch is force-flushed by the next cast, and
 *    the last one has no runway left to stage into).
 *
 * The clock is the painter's own frame clock, advanced by `advance`, never a
 * wall clock: the detonation belongs to the frames that draw it. */
export class HarvestDetonations {
  private readonly slots = Array.from({ length: 64 }, () => ({
    active: false,
    abilityId: 'red_harvest',
    casterId: 0,
    targetId: 0,
    componentOutcomes: 0,
    tier: 0,
    physicalSecondary: false,
    audio: false,
    // The frame-clock time this slot may play at. Negative infinity means it
    // was never staged, so the next advance plays it.
    dueAt: Number.NEGATIVE_INFINITY,
    x: 0,
    y: 0,
    z: 0,
    spec: null as AbilityVfxFullSpec | null,
  }));

  // The frame window's openings: two fixed parallel rings, so there is no map,
  // no growth and no per-frame allocation.
  private readonly openingCasters = new Int32Array(OPENING_SLOTS).fill(-1);
  private readonly openingCounts = new Uint8Array(OPENING_SLOTS);
  private openingHead = 0;
  private elapsed = 0;

  private readonly anchor = { x: 0, y: 0, z: 0 };

  /** A cast opening was sequenced for this caster in the current frame window. */
  noteOpening(caster: number): void {
    for (let i = 0; i < OPENING_SLOTS; i++) {
      if (this.openingCasters[i] === caster) {
        if (this.openingCounts[i] < 255) this.openingCounts[i]++;
        return;
      }
    }
    this.openingCasters[this.openingHead] = caster;
    this.openingCounts[this.openingHead] = 1;
    this.openingHead = (this.openingHead + 1) % OPENING_SLOTS;
  }

  private stagedDueAt(caster: number): number {
    for (let i = 0; i < OPENING_SLOTS; i++) {
      if (this.openingCasters[i] !== caster) continue;
      return this.openingCounts[i] === 1
        ? this.elapsed + FINAL_CONTACT_SEC
        : Number.NEGATIVE_INFINITY;
    }
    return Number.NEGATIVE_INFINITY;
  }

  record(
    caster: number,
    target: number,
    outcome: 0 | 1 | 2,
    tier: number,
    spec: AbilityVfxFullSpec,
    audio: boolean,
    at?: { x: number; y: number; z: number } | null,
  ): boolean {
    const existing = this.slots.find(
      (s) => s.active && s.casterId === caster && s.targetId === target,
    );
    if (existing) {
      if (outcome === 1 || existing.componentOutcomes === 0)
        existing.componentOutcomes = outcome << 4;
      if (audio && at) {
        existing.audio = true;
        existing.x = at.x;
        existing.y = at.y;
        existing.z = at.z;
      }
      return true;
    }
    const slot = this.slots.find((s) => !s.active);
    if (!slot) return false;
    slot.physicalSecondary = this.slots.some((s) => s.active && s.casterId === caster);
    slot.active = true;
    slot.casterId = caster;
    slot.targetId = target;
    slot.componentOutcomes = outcome << 4;
    slot.tier = tier;
    slot.spec = spec;
    slot.audio = audio && !!at;
    slot.dueAt = this.stagedDueAt(caster);
    if (at) {
      slot.x = at.x;
      slot.y = at.y;
      slot.z = at.z;
    }
    return true;
  }

  /** One frame: play every batch whose authored contact has arrived, then
   * close the opening window (the next events belong to the next window). */
  advance(host: SequencerHost, dt: number): void {
    this.elapsed += Number.isFinite(dt) && dt > 0 ? dt : 0;
    for (const slot of this.slots) {
      if (!slot.active || !slot.spec || slot.dueAt > this.elapsed) continue;
      this.play(host, slot);
    }
    this.openingCasters.fill(-1);
    this.openingCounts.fill(0);
    this.openingHead = 0;
  }

  /** Force this caster's pending batch out now: its next cast owns the stage. */
  flush(host: SequencerHost, caster: number): void {
    for (const slot of this.slots) {
      if (!slot.active || !slot.spec || slot.casterId !== caster) continue;
      this.play(host, slot);
    }
  }

  private play(host: SequencerHost, slot: (typeof this.slots)[number]): void {
    if (!slot.spec) return;
    // The retained slot is also the choreography state; no per-frame wrapper.
    harvestBeat(host, slot as typeof slot & { spec: AbilityVfxFullSpec }, 2, true);
    if (slot.audio && slot.componentOutcomes === 16) {
      const at = host.anchorOf(slot.targetId, 0.55, this.anchor) ?? slot;
      host.abilityAudio?.('impact', 'physical', 1.5, at.x, at.y, at.z, {
        abilityId: 'red_harvest',
        sample: FURY_AUDIO.red_harvest.impacts[2],
        finisher: true,
        lite: slot.physicalSecondary || slot.tier > 0,
        archetype: 'strike',
      });
    }
    slot.active = false;
    slot.spec = null;
    slot.dueAt = Number.NEGATIVE_INFINITY;
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.spec = null;
      slot.dueAt = Number.NEGATIVE_INFINITY;
    }
    this.openingCasters.fill(-1);
    this.openingCounts.fill(0);
    this.openingHead = 0;
    this.elapsed = 0;
  }
}
