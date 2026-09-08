import * as THREE from 'three';
import { SIGNATURE_ABILITIES, SIGNATURE_CONTACT_TIME } from '../ability_vfx/signature_core';
import { poseFuryTracks } from './fury_poses';
import { poseSignatureTracks } from './signature_poses';

export { SIGNATURE_CONTACT_TIME } from '../ability_vfx/signature_core';

const TIMES = [0, 0.045, 0.1, SIGNATURE_CONTACT_TIME, 0.19, 0.32, 0.48, 0.68];
// Contact poses authored in scripts/build_*_ability_anims.mjs. Raw KayKit
// chop/raise donor markers are documented in the shaman exporter.
const SOURCE_CONTACT: Readonly<Record<string, number>> = {
  Cast_Fire: 0.4,
  Cast_Nova: 0.85,
  Cast_Bolt: 1.1,
  Cast_Heal: 0.7,
  Cast_Verdict: 0.6,
  Warlock_Cast_Shadow: 0.6,
  '2H_Melee_Attack_Chop': 1.0,
  Spellcast_Raise: 1.8,
};
export function signatureClipName(id: string): string {
  return `Signature_${id}`;
}
export const SIGNATURE_HOLD_POINT = 0.72;
export function signatureHoldName(id: string): string {
  return `Signature_Hold_${id}`;
}
export const SIGNATURE_CLIP_NAMES = Object.keys(SIGNATURE_ABILITIES).map(signatureClipName);
const SOURCE_ALIASES: Readonly<Record<string, string>> = {
  chain_lightning: 'lightning_bolt',
  abyssal_rift: 'shadow_bolt',
};
const WARRIOR_CONTACT_SOURCES: Readonly<Record<string, string>> = {
  slam: 'Warrior_Brute_Swing',
  overpower: 'Warrior_Redhand',
  shield_slam: 'Warrior_Shieldcrack',
  mortal_strike: 'Warrior_Maiming_Strike',
  execute: 'Warrior_Early_Grave',
  bloodthirst: 'Warrior_Bloodletting',
  victory_rush: 'Warrior_Victory_Rush',
};

/** Re-sample the rig's own authored gesture, preserving all tracks and joint conventions.
 * A crisp release/contact is held briefly, with a longer, smooth recovery. Runs at preparation only. */
export function createSignatureClip(source: THREE.AnimationClip, id: string): THREE.AnimationClip {
  const contact = Math.min(source.duration, SOURCE_CONTACT[source.name] ?? source.duration * 0.5);
  const tail = source.duration - contact;
  const sourceTimes = [
    0,
    contact * 0.2,
    contact * 0.55,
    contact,
    contact,
    contact + tail * 0.36,
    contact + tail * 0.72,
    source.duration,
  ];
  const tracks = source.tracks.map((track) => {
    const copy = track.clone();
    const sampler = (
      track as THREE.KeyframeTrack & {
        createInterpolant(): { evaluate(t: number): ArrayLike<number> };
      }
    ).createInterpolant();
    const values: number[] = [];
    for (const sourceTime of sourceTimes) {
      const sample = sampler.evaluate(sourceTime) as ArrayLike<number>;
      for (let i = 0; i < sample.length; i++) values.push(sample[i]);
    }
    copy.times = new Float32Array(TIMES);
    copy.values = new Float32Array(values);
    return copy;
  });
  poseSignatureTracks(tracks, source, id, false);
  return new THREE.AnimationClip(signatureClipName(id), 0.68, tracks, source.blendMode);
}

/** One gather into a held pose. The visual freezes this at the hold marker,
 * so long casts do not repeat a release gesture every second. */
export function createSignatureHold(source: THREE.AnimationClip, id: string): THREE.AnimationClip {
  const contact = Math.min(source.duration, SOURCE_CONTACT[source.name] ?? source.duration * 0.5);
  const tracks = source.tracks.map((track) => {
    const copy = track.clone(),
      sampler = track.createInterpolant(),
      values: number[] = [];
    for (const fraction of [0, 0.2, 0.45, 0.58, 0.58]) {
      const sample = sampler.evaluate(contact * fraction);
      for (let i = 0; i < sample.length; i++) values.push(sample[i]);
    }
    copy.times = new Float32Array([0, 0.22, 0.48, SIGNATURE_HOLD_POINT, 1.1]);
    copy.values = new Float32Array(values);
    return copy;
  });
  poseSignatureTracks(tracks, source, id, true);
  return new THREE.AnimationClip(signatureHoldName(id), 1.1, tracks, source.blendMode);
}

export function prepareSignatureClips(
  clips: Map<string, THREE.AnimationClip>,
  overrides: Readonly<Record<string, string>> | undefined,
): void {
  for (const id of new Set([
    ...Object.keys(SIGNATURE_ABILITIES),
    ...Object.keys(overrides ?? {}),
  ])) {
    const name =
        id === 'hammer_of_wrath' && overrides?.final_edict
          ? 'Cast_Verdict'
          : (overrides?.[id] ?? overrides?.[SOURCE_ALIASES[id]]),
      source = name ? clips.get(name) : undefined;
    if (source && source.name === WARRIOR_CONTACT_SOURCES[id]) {
      const clip = source.clone();
      clip.name = signatureClipName(id);
      clips.set(clip.name, clip);
      continue;
    }
    if (source && (id === 'raging_gale' || id === 'red_harvest')) {
      const clip = source.name.startsWith('Fury_')
        ? source.clone()
        : createMultiStrikeClip(source, id);
      clip.name = signatureClipName(id);
      clips.set(clip.name, clip);
      continue;
    }
    if (source && (SIGNATURE_ABILITIES[id] || SOURCE_CONTACT[source.name] !== undefined)) {
      clips.set(signatureClipName(id), createSignatureClip(source, id));
      if (SIGNATURE_ABILITIES[id])
        clips.set(signatureHoldName(id), createSignatureHold(source, id));
    }
  }
}

/** Separate contact poses for both blades; sampled once during rig preparation. */
export function createMultiStrikeClip(
  source: THREE.AnimationClip,
  id: string,
): THREE.AnimationClip {
  const harvest = id === 'red_harvest';
  const times = harvest
    ? [0, 0.08, 0.15, 0.24, 0.32, 0.4, 0.49, 0.64, 0.72]
    : [0, 0.08, 0.15, 0.25, 0.34, 0.52, 0.66];
  const phases = harvest
    ? [0, 0.3, 0.58, 0.28, 0.58, 0.25, 0.65, 0.83, 1]
    : [0, 0.3, 0.58, 0.28, 0.65, 0.85, 1];
  const tracks = source.tracks.map((track) => {
    const copy = track.clone(),
      sampler = track.createInterpolant(),
      values: number[] = [];
    for (const phase of phases) {
      const sample = sampler.evaluate(source.duration * phase);
      for (let i = 0; i < sample.length; i++) values.push(sample[i]);
    }
    copy.times = new Float32Array(times);
    copy.values = new Float32Array(values);
    return copy;
  });
  poseFuryTracks(tracks, harvest);
  return new THREE.AnimationClip(
    signatureClipName(id),
    times[times.length - 1],
    tracks,
    source.blendMode,
  );
}
