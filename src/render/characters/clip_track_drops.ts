// VisualDef.clipTrackDrops: rotation tracks removed from named clips when a
// visual is prepared, for bones a bone dial owns (bone_dials.ts).
//
// A dial lays its turn on top of whatever the mixer wrote. That composes with
// a clip that keys the bone at rest, but not with a clip that turns the bone
// itself (a clip that turns a plate half a turn, or swings a hatch leaf
// open), so the dial's turn would land on top of the clip's (a double turn while the clip plays,
// and a second spin through the armour as the clip cross-fades back to rest).
// Dropping those tracks leaves ONE owner of the bone, the dial, driven by the
// mirrored encounter state; the rest of the clip (the body, the plate mounts
// pushing out) plays untouched.
//
// The decision is pure (which tracks go); the clip rebuild is one shallow copy
// per dropped clip, once per prepared visual, never per frame.

import * as THREE from 'three';

/** Clip name -> the bones (GLB node names) whose rotation track is dropped. */
export type ClipTrackDrops = Readonly<Record<string, readonly string[]>>;

/** three sanitizes node names for track bindings (PropertyBinding). */
function trackBone(name: string): string {
  return name.replace(/[[\].:/]/g, '');
}

/** Is `trackName` (three's `<node>.<property>`) the rotation of one of `bones`? */
export function isDroppedTrack(trackName: string, bones: readonly string[]): boolean {
  const dot = trackName.lastIndexOf('.');
  if (dot < 0 || trackName.slice(dot + 1) !== 'quaternion') return false;
  const node = trackName.slice(0, dot);
  for (const b of bones) if (trackBone(b) === node) return true;
  return false;
}

/** The names of `tracks` that stay once `bones` lose their rotation. */
export function keptTrackNames(tracks: readonly string[], bones: readonly string[]): string[] {
  return tracks.filter((t) => !isDroppedTrack(t, bones));
}

/** Rewrite the dropped clips of a prepared visual's clip map in place (each
 *  becomes a copy sharing the kept tracks; the GLB's own clip is untouched,
 *  since a GLB may serve another visual that wants it whole). */
export function applyClipTrackDrops(
  clips: Map<string, THREE.AnimationClip>,
  drops: ClipTrackDrops | undefined,
): void {
  if (!drops) return;
  for (const [name, bones] of Object.entries(drops)) {
    const clip = clips.get(name);
    if (!clip) continue;
    const kept = clip.tracks.filter((t) => !isDroppedTrack(t.name, bones));
    if (kept.length === clip.tracks.length) continue;
    clips.set(name, new THREE.AnimationClip(clip.name, clip.duration, kept, clip.blendMode));
  }
}

/** Is `trackName` the position of one of `bones`? (VisualDef.clipPositionDrops:
 *  an airborne clip that carries its own altitude on its root, drawn by a sim
 *  that already lifts the body, keeps ONE owner of the height.) */
export function isDroppedPositionTrack(trackName: string, bones: readonly string[]): boolean {
  const dot = trackName.lastIndexOf('.');
  if (dot < 0 || trackName.slice(dot + 1) !== 'position') return false;
  const node = trackName.slice(0, dot);
  for (const b of bones) if (trackBone(b) === node) return true;
  return false;
}

/** Rewrite the named clips without the named bones' position tracks (one
 *  shallow copy per clip, once per prepared visual). */
export function applyClipPositionDrops(
  clips: Map<string, THREE.AnimationClip>,
  drops: ClipTrackDrops | undefined,
): void {
  if (!drops) return;
  for (const [name, bones] of Object.entries(drops)) {
    const clip = clips.get(name);
    if (!clip) continue;
    const kept = clip.tracks.filter((t) => !isDroppedPositionTrack(t.name, bones));
    if (kept.length === clip.tracks.length) continue;
    clips.set(name, new THREE.AnimationClip(clip.name, clip.duration, kept, clip.blendMode));
  }
}
