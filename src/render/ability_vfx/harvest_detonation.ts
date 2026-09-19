import { FURY_AUDIO } from '../../fury_audio_core';
import type { AbilityVfxFullSpec } from '../ability_vfx_core';
import { harvestBeat } from './harvest_choreography';
import type { SequencerHost } from './sequencer';

/** Fold one authoritative damage batch into one collision per recipient.
 * There is no presentation delay here: flush before the next visible frame.
 * Lethal first hits and mixed miss/absorb batches still produce one true result. */
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
    x: 0,
    y: 0,
    z: 0,
    spec: null as AbilityVfxFullSpec | null,
  }));

  private readonly anchor = { x: 0, y: 0, z: 0 };

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
    if (at) {
      slot.x = at.x;
      slot.y = at.y;
      slot.z = at.z;
    }
    return true;
  }

  flush(host: SequencerHost, caster?: number): void {
    for (const slot of this.slots) {
      if (!slot.active || !slot.spec || (caster !== undefined && slot.casterId !== caster))
        continue;
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
    }
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.spec = null;
    }
  }
}
