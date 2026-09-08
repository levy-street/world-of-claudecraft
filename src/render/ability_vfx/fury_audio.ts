import { claimFuryAudio, MELEE_AUDIO, type MeleeAudioId } from '../../fury_audio_core';
import type { SequencerHost } from './sequencer';

/** Retained audio survives visual-slot eviction and lost visual anchors. Its
 * clock is the same presentation dt as the strikes, including Studio pause.
 * Native single-hit Warrior clips share the same ownership and bounded queue. */
export class FuryAudioQueue {
  private readonly slots = Array.from({ length: 24 }, () => ({
    active: false,
    id: 'raging_gale' as MeleeAudioId,
    caster: 0,
    target: 0,
    age: 0,
    count: 0,
    next: 0,
    outcomes: 0,
    x: 0,
    y: 0,
    z: 0,
    secondary: false,
  }));
  private readonly scratch = { x: 0, y: 0, z: 0 };

  reserve(
    host: SequencerHost,
    event: object,
    id: MeleeAudioId,
    caster: number,
    target: number,
    outcome: 0 | 1 | 2,
    ready: (key: string) => boolean,
  ): boolean {
    const cue = MELEE_AUDIO[id];
    let prepared = ready(cue.release);
    for (const key of cue.impacts) if (!ready(key)) prepared = false;
    if (!prepared) return false;
    const duplicate = this.slots.find(
      (s) => s.active && s.id === id && s.caster === caster && s.target === target && s.age < 0.025,
    );
    if (duplicate) {
      if (duplicate.count >= cue.impacts.length) return false;
      duplicate.outcomes |= outcome << (duplicate.count++ * 2);
      claimFuryAudio(event);
      return true;
    }
    const slot = this.slots.find((s) => !s.active);
    if (!slot) return false;
    const at = host.anchorOf(target, 0.5, this.scratch);
    if (!at) return false;
    slot.x = at.x;
    slot.y = at.y;
    slot.z = at.z;
    const from = host.anchorOf(caster, 0.55, this.scratch);
    if (!from) return false;
    slot.secondary = this.slots.some(
      (s) => s.active && s.id === id && s.caster === caster && s.age < 0.025,
    );
    slot.id = id;
    slot.caster = caster;
    slot.target = target;
    slot.age = 0;
    slot.count = 1;
    slot.next = 0;
    slot.outcomes = outcome;
    slot.active = true;
    claimFuryAudio(event);
    if (!slot.secondary)
      host.abilityAudio?.('release', 'physical', 1, from.x, from.y, from.z, {
        abilityId: id,
        sample: cue.release,
        archetype: 'strike',
      });
    return true;
  }

  update(host: SequencerHost, dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      const cue = MELEE_AUDIO[slot.id];
      while (slot.next < slot.count && slot.age >= cue.times[slot.next]) {
        const beat = slot.next++;
        if (((slot.outcomes >> (beat * 2)) & 3) !== 1) continue;
        const at = host.anchorOf(slot.target, 0.5, this.scratch);
        if (at) {
          slot.x = at.x;
          slot.y = at.y;
          slot.z = at.z;
        }
        host.abilityAudio?.('impact', 'physical', 1, slot.x, slot.y, slot.z, {
          abilityId: slot.id,
          sample: cue.impacts[beat],
          lite: slot.secondary,
          finisher: (slot.id === 'red_harvest' && beat === 2) || slot.id === 'execute',
          archetype: 'strike',
        });
      }
      if (slot.age >= 0.75) slot.active = false;
    }
  }
  clear(): void {
    for (const slot of this.slots) slot.active = false;
  }
}
