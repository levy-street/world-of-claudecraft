import * as THREE from 'three';
import { meleeImpactProfile } from '../melee_impact_core';

const TIMES = [0, 0.045, 0.1, 0.15, 0.19, 0.32, 0.48, 0.68];
const MARKERS: Readonly<Record<string, number>> = {
  '1H_Melee_Attack_Slice_Diagonal': 0.8,
  '1H_Melee_Attack_Slice_Horizontal': 0.32,
  '1H_Melee_Attack_Chop': 0.9,
  Dualwield_Melee_Attack_Chop: 0.8,
  Shield_Bash: 0.32,
  Punch_A: 0.32,
  Hunter_Melee_Gut: 0.35,
  Hunter_Melee_Clip: 0.45,
  Hunter_Melee_Counter: 0.62,
  Rogue_Quick_Strike: 0.22,
  Rogue_Backstab: 0.35,
  Rogue_Ambush: 0.85,
  Rogue_Finisher_Slash: 0.65,
};

/** Resample full native tracks once, with contact at 150ms. Special hand
 * actions retain their scoop/loop poses instead of being compressed to a chop. */
export function prepareMeleeClips(
  clips: Map<string, THREE.AnimationClip>,
  overrides?: Readonly<Record<string, string>>,
): void {
  const resolved = { ...overrides };
  if (clips.has('Rogue_Quick_Strike'))
    for (const id of ['hemorrhage', 'venomrend', 'ghostly_strike'])
      resolved[id] ??= 'Rogue_Quick_Strike';
  if (clips.has('1H_Melee_Attack_Slice_Horizontal') && overrides?.mortal_strike)
    resolved.sunder_armor ??= '1H_Melee_Attack_Slice_Horizontal';
  for (const [id, name] of Object.entries(resolved)) {
    if (!meleeImpactProfile(id) && id !== 'blind') continue;
    if (clips.has(`Signature_${id}`)) continue;
    const source = clips.get(name);
    if (!source) continue;
    const contact = Math.min(source.duration, MARKERS[name] ?? source.duration * 0.5);
    let samples = [
      0,
      contact * 0.2,
      contact * 0.6,
      contact,
      contact,
      contact + (source.duration - contact) * 0.3,
      contact + (source.duration - contact) * 0.7,
      source.duration,
    ];
    if (id === 'blind') samples = [0, 0.12, 0.2, 0.28, 0.3, 0.43, 0.59, 0.7];
    if (id === 'garrote') samples = [0, 0.055, 0.12, 0.26, 0.3, 0.54, 0.62, 0.7];
    // The old donor's counter guard is not part of Woundrend. Retain the
    // real windup/strike/recovery poses while skipping that retired mechanic.
    if (id === 'mongoose_bite') samples = [0, 0.44, 0.5, 0.62, 0.64, 0.71, 0.8, 0.9];
    const tracks = source.tracks.map((track) => {
      const copy = track.clone(),
        sampler = track.createInterpolant(),
        values: number[] = [];
      for (const t of samples) {
        const sample = sampler.evaluate(Math.min(t, source.duration)) as ArrayLike<number>;
        for (let i = 0; i < sample.length; i++) values.push(sample[i]);
      }
      copy.times = new Float32Array(TIMES);
      copy.values = new Float32Array(values);
      return copy;
    });
    clips.set(`Signature_${id}`, new THREE.AnimationClip(`Signature_${id}`, 0.68, tracks));
  }
}
